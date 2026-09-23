#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
M14 / M5 — Import d'un INVENTAIRE G8 (« Inventaire du stock réel par RAYON ») vers Supabase.

Décision M-44 : l'inventaire G8 fait foi à sa date. Tout écart ultérieur passe par un
mouvement tracé (`stock_moves`), jamais par un UPDATE de stock (B7).

Ce que fait l'outil
-------------------
1. lit le .xlsx sans dépendance (le xlsx est un zip de XML, comme `import_g8.py`) ;
2. dépose les lignes dans `inventory_import_lines` (table de dépôt, relançable) ;
3. rapproche chaque ligne du DMS — par VIN pour les motos, par référence normalisée sinon ;
4. DRY-RUN : dit ce qu'il ferait (articles trouvés / à créer, mouvements, PAMP, casiers) ;
5. --apply : crée les articles manquants, pose UN mouvement d'inventaire par ligne
   (quantité = stock du fichier − stock calculé), le PAMP, le prix d'achat et le casier ;
6. contrôles d'après import + rapprochement des châssis des motos du site (référence `WEB-…`).

Une relance à l'identique ne crée AUCUN mouvement : les deltas retombent à zéro.

Usage (PowerShell)
------------------
  $env:SUPABASE_SERVICE_ROLE_KEY = [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY","User")

  python tools/migration/import_inventaire_g8.py "<fichier.xlsx>"                  # DRY-RUN
  python tools/migration/import_inventaire_g8.py "<fichier.xlsx>" --apply          # import réel
  python tools/migration/import_inventaire_g8.py "<fichier.xlsx>" --rapport        # contrôles seuls
  python tools/migration/import_inventaire_g8.py "<fichier.xlsx>" --vins           # châssis des motos du site
  python tools/migration/import_inventaire_g8.py "<fichier.xlsx>" --vins --apply

Modes hors ligne (aucun accès base — servent aux tests) :
  python tools/migration/import_inventaire_g8.py "<fichier.xlsx>" --lire
  python tools/migration/import_inventaire_g8.py "<fichier.xlsx>" --deltas stock_actuel.json

Options : --origin, --ref, --company, --limite (taille de lot), --inventaire-du AAAA-MM-JJ.
"""

import argparse
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request
import zipfile
from xml.etree import ElementTree as ET

PROJECT_REF = "ujmrosbgkvgvwfnuryna"
BASE = f"https://{PROJECT_REF}.supabase.co/rest/v1"
COMPANY_ITALBIKE = "3d9f0f13-a691-4d07-ad58-34590df86e33"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
EPOCH = datetime.date(1899, 12, 30)
BATCH_STAGE = 500          # lignes envoyées par appel de dépôt
BATCH_APPLY = 250          # lignes appliquées par appel (tient sous les 8 s de PostgREST)

# En-têtes attendus du rapport G8, dans l'ordre. La lecture reste tolérante :
# on retrouve chaque colonne par son libellé, pas par sa position.
COLUMNS = {
    "reference": ("référence", "reference"),
    "designation": ("désignation", "designation"),
    "vin": ("châssis", "chassis"),
    "real_qty": ("stock réel", "stock reel"),
    "avail_qty": ("stock dispo",),
    "pamp": ("p.a.m.p.", "pamp"),
    "stock_value": ("valeur de stock",),
    "last_in": ("dernière date d'entrée", "derniere date d'entree"),
    "last_out": ("dernière date de sortie", "derniere date de sortie"),
    "bin_location": ("code casier",),
    "supplier": ("fournisseur",),
    "rayon": ("rayon",),
    "sous_rayon": ("sous-rayon",),
    "categorie": ("catégorie", "categorie"),
    "barcode": ("code barre",),
}


def die(msg):
    print("ERREUR:", msg)
    sys.exit(1)


# ---------------------------------------------------------------------
# Lecture du .xlsx (zip de XML — aucune dépendance, comme import_g8.py)
# ---------------------------------------------------------------------
def _col_idx(ref):
    letters = re.match(r"([A-Z]+)", ref or "")
    if not letters:
        return 0
    n = 0
    for ch in letters.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_sheet(path):
    """Rend la première feuille comme une liste de listes de chaînes."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        t = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in t.findall(f"{NS}si"):
            shared.append("".join(n.text or "" for n in si.iter(f"{NS}t")))
    sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml", n))
    if not sheets:
        die(f"{path} ne contient aucune feuille.")
    t = ET.fromstring(z.read(sheets[0]))
    sd = t.find(f"{NS}sheetData")
    out = []
    for row in sd.findall(f"{NS}row"):
        cells, maxc = {}, -1
        for c in row.findall(f"{NS}c"):
            ci = _col_idx(c.get("r"))
            maxc = max(maxc, ci)
            ty = c.get("t")
            v = c.find(f"{NS}v")
            txt = ""
            if ty == "s" and v is not None:
                txt = shared[int(v.text)]
            elif v is not None:
                txt = v.text
            else:
                isn = c.find(f"{NS}is")
                if isn is not None:
                    txt = "".join(n.text or "" for n in isn.iter(f"{NS}t"))
            cells[ci] = (txt or "").strip()
        out.append([cells.get(i, "") for i in range(maxc + 1)])
    return out


def norm_ref(s):
    """Référence normalisée : majuscules, sans espaces ni ponctuation (même forme qu'en base)."""
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def num(v):
    if v in (None, ""):
        return None
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def xl_date(v):
    """Numéro de série Excel → date ISO (None si vide ou non numérique)."""
    n = num(v)
    if n is None or n <= 0:
        return None
    return (EPOCH + datetime.timedelta(days=int(n))).isoformat()


def parse_inventory(path):
    """Lit le fichier d'inventaire et rend (lignes utiles, diagnostic).

    Une ligne est UTILE si elle porte une référence normalisable et une quantité
    numérique. Tout le reste (sous-totaux, lignes de rayon, lignes vides) est écarté
    et compté dans le diagnostic.
    """
    rows = read_sheet(path)
    if not rows:
        die(f"{path} est vide.")
    header = [h.strip().lower() for h in rows[0]]
    idx = {}
    for key, labels in COLUMNS.items():
        for i, h in enumerate(header):
            if any(h.startswith(lb) for lb in labels):
                idx[key] = i
                break
    for required in ("reference", "real_qty"):
        if required not in idx:
            die(f"Colonne « {required} » introuvable dans l'en-tête : {rows[0]}")

    def cell(r, key):
        i = idx.get(key)
        return (r[i] if i is not None and i < len(r) else "").strip()

    lines, ignored = [], {"sans_reference": 0, "sans_quantite": 0, "vides": 0}
    for n, r in enumerate(rows[1:], start=2):
        if not any(c for c in r):
            ignored["vides"] += 1
            continue
        ref = cell(r, "reference")
        if not norm_ref(ref):
            ignored["sans_reference"] += 1
            continue
        qty = num(cell(r, "real_qty"))
        if qty is None:
            ignored["sans_quantite"] += 1
            continue
        pamp = num(cell(r, "pamp"))
        lines.append({
            "line_no": n,
            "reference": ref,
            "reference_norm": norm_ref(ref),
            "designation": cell(r, "designation") or None,
            "vin": (cell(r, "vin").upper() or None),
            "real_qty": qty,
            "avail_qty": num(cell(r, "avail_qty")),
            "pamp": pamp,
            "stock_value": num(cell(r, "stock_value")),
            "bin_location": cell(r, "bin_location") or None,
            "supplier": cell(r, "supplier") or None,
            "rayon": cell(r, "rayon") or None,
            "sous_rayon": cell(r, "sous_rayon") or None,
            "categorie": cell(r, "categorie") or None,
            "barcode": cell(r, "barcode") or None,
            "last_in": xl_date(cell(r, "last_in")),
            "last_out": xl_date(cell(r, "last_out")),
        })
    return lines, ignored


def diagnose(lines):
    """Chiffres d'analyse du fichier (sans toucher à la base)."""
    refs, dup_refs = {}, {}
    vins, dup_vins = {}, {}
    rayons = {}
    for l in lines:
        refs[l["reference_norm"]] = refs.get(l["reference_norm"], 0) + 1
        if l["vin"]:
            vins[l["vin"]] = vins.get(l["vin"], 0) + 1
        rayons[l["rayon"] or "(sans rayon)"] = rayons.get(l["rayon"] or "(sans rayon)", 0) + 1
    dup_refs = {k: v for k, v in refs.items() if v > 1}
    dup_vins = {k: v for k, v in vins.items() if v > 1}
    motos = [l for l in lines if l["vin"]]
    dup_hors_motos = {}
    seen = {}
    for l in lines:
        if not l["vin"]:
            seen[l["reference_norm"]] = seen.get(l["reference_norm"], 0) + 1
    dup_hors_motos = {k: v for k, v in seen.items() if v > 1}
    return {
        "lignes_utiles": len(lines),
        "references_distinctes": len(refs),
        "references_en_double": len(dup_refs),
        "lignes_en_double": sum(dup_refs.values()),
        "doublons_hors_motos": len(dup_hors_motos),
        "lignes_motos": len(motos),
        "vin_distincts": len(vins),
        "vin_en_double": len(dup_vins),
        "lignes_negatives": sum(1 for l in lines if l["real_qty"] < 0),
        "lignes_a_zero": sum(1 for l in lines if l["real_qty"] == 0),
        "lignes_pamp_nul": sum(1 for l in lines if not l["pamp"]),
        "lignes_sans_casier": sum(1 for l in lines if not l["bin_location"]),
        "quantite_totale": round(sum(l["real_qty"] for l in lines), 3),
        "valeur_totale": round(sum(l["stock_value"] or 0 for l in lines), 2),
        "valeur_recalculee": round(sum(l["real_qty"] * (l["pamp"] or 0) for l in lines), 2),
        "rayons": dict(sorted(rayons.items(), key=lambda kv: -kv[1])),
    }


def compute_deltas(lines, stock_actuel):
    """Delta d'inventaire par ligne : quantité cible − stock calculé aujourd'hui.

    `stock_actuel` : { référence normalisée (ou VIN) : quantité réelle en base }.
    Aucun mouvement n'est produit pour un delta nul — c'est ce qui rend une relance
    à l'identique silencieuse.
    """
    out = []
    for l in lines:
        cle = l["vin"] or l["reference_norm"]
        cur = float(stock_actuel.get(cle, stock_actuel.get(l["reference_norm"], 0)) or 0)
        delta = round(l["real_qty"] - cur, 3)
        out.append({
            "line_no": l["line_no"],
            "cle": cle,
            "stock_actuel": cur,
            "stock_cible": l["real_qty"],
            "delta": delta,
            "mouvement": delta != 0,
            # Le PAMP ne repart du coût que sur une ENTRÉE posée sur un stock ≤ 0 (B5).
            "cout_unitaire": l["pamp"] if (delta > 0 and (l["pamp"] or 0) > 0 and cur <= 0) else None,
        })
    return out


# ---------------------------------------------------------------------
# Appels Supabase (REST / RPC)
# ---------------------------------------------------------------------
def _svc():
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        die("SUPABASE_SERVICE_ROLE_KEY manquant dans l'environnement.")
    return key


def rpc(name, payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(f"{BASE}/rpc/{name}", data=body, method="POST")
    key = _svc()
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        die(f"rpc {name} -> {e.code}: {e.read().decode()[:500]}")


def show(title, data):
    print(f"\n--- {title} ---")
    if isinstance(data, dict):
        width = max((len(k) for k in data), default=0)
        for k, v in data.items():
            if isinstance(v, dict):
                print(f"  {k.ljust(width)} :")
                for k2, v2 in v.items():
                    print(f"      {k2} : {v2}")
            else:
                print(f"  {k.ljust(width)} : {v}")
    else:
        print(json.dumps(data, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------
def main():
    # La console Windows est en cp1252 : sans cela, une désignation accentuée fait planter l'affichage.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Import d'un inventaire G8 dans le DMS.")
    ap.add_argument("fichier", help="export G8 « Inventaire du stock réel par RAYON » (.xlsx)")
    ap.add_argument("--apply", action="store_true", help="écrit réellement (sinon dry-run)")
    ap.add_argument("--rapport", action="store_true", help="contrôles d'après import uniquement")
    ap.add_argument("--vins", action="store_true", help="châssis des motos du site (référence WEB-…)")
    ap.add_argument("--lire", action="store_true", help="hors ligne : analyse du fichier en JSON")
    ap.add_argument("--deltas", metavar="STOCK.json",
                    help="hors ligne : calcule les deltas contre un stock actuel en JSON")
    ap.add_argument("--origin", default=None, help="origine des mouvements (défaut : déduite de la date)")
    ap.add_argument("--ref", default=None, help="n° d'inventaire porté par les mouvements")
    ap.add_argument("--company", default=COMPANY_ITALBIKE)
    ap.add_argument("--limite", type=int, default=BATCH_APPLY, help="lignes par lot d'application")
    ap.add_argument("--inventaire-du", dest="counted_at", default=None, help="AAAA-MM-JJ de l'arrêté")
    a = ap.parse_args()

    lines, ignored = parse_inventory(a.fichier)
    diag = diagnose(lines)

    # ---- modes hors ligne (tests) -------------------------------------
    if a.lire:
        print(json.dumps({"ignorees": ignored, "diagnostic": diag, "lignes": lines},
                         ensure_ascii=False))
        return
    if a.deltas:
        with open(a.deltas, encoding="utf-8") as f:
            stock = json.load(f)
        print(json.dumps(compute_deltas(lines, stock), ensure_ascii=False))
        return

    # ---- date de l'arrêté et origine ----------------------------------
    counted = a.counted_at
    if not counted:
        m = re.search(r"(\d{2})-(\d{2})-(\d{4})", os.path.basename(a.fichier))
        counted = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else datetime.date.today().isoformat()
    jour = counted.replace("-", "")
    origin = a.origin or f"import:g8-inventaire-{jour}"
    ref = a.ref or f"INV-G8-{jour}"

    print(f"Fichier      : {os.path.basename(a.fichier)}")
    print(f"Inventaire   : {counted}   origine « {origin} »   n° « {ref} »")
    show("ANALYSE DU FICHIER", {"lignes_ignorees": ignored, **diag})

    import_id = rpc("inventory_import_open", {
        "_company": a.company, "_origin": origin, "_ref": ref,
        "_source_file": os.path.basename(a.fichier), "_counted_at": f"{counted}T00:00:00Z",
    })
    print(f"\nInventaire en base : {import_id}")

    if a.rapport:
        show("CONTRÔLES", rpc("inventory_import_report", {"_import": import_id}))
        return

    if a.vins:
        cands = rpc("inventory_import_vin_candidates", {"_import": import_id})
        print(f"\n--- CHÂSSIS DES MOTOS DU SITE : {len(cands or [])} rapprochement(s) possible(s) ---")
        for c in cands or []:
            mark = "RETENU " if c["retenu"] else "écarté "
            print(f"  {mark} {c['vehicle_reference']} « {c['vehicle_model']} » ← ligne {c['line_no']} "
                  f"{c['file_designation']} / {c['vin']} (marge {c['marge_pct']} %, "
                  f"{c['n_candidats_moto']}×{c['n_candidats_ligne']} candidats)")
        show("CHÂSSIS", rpc("inventory_import_complete_vins",
                            {"_import": import_id, "_apply": bool(a.apply)}))
        return

    # ---- dépôt des lignes ---------------------------------------------
    total = 0
    for i in range(0, len(lines), BATCH_STAGE):
        total += rpc("inventory_import_stage",
                     {"_import": import_id, "_lines": lines[i:i + BATCH_STAGE]}) or 0
        print(f"  ... {min(i + BATCH_STAGE, len(lines))}/{len(lines)} lignes déposées")
    print(f"Lignes déposées : {total}")

    show("RAPPROCHEMENT", rpc("inventory_import_resolve", {"_import": import_id}))
    show("DRY-RUN (ce qui serait écrit)", rpc("inventory_import_preview", {"_import": import_id}))

    if not a.apply:
        print("\n(dry-run — relancer avec --apply pour écrire)")
        return

    # ---- application par lots -----------------------------------------
    cumul = {}
    while True:
        st = rpc("inventory_import_apply", {"_import": import_id, "_limit": a.limite})
        for k, v in st.items():
            if isinstance(v, (int, float)) and k not in ("reste_a_traiter", "duration_ms"):
                cumul[k] = round(cumul.get(k, 0) + v, 3)
        print(f"  ... {st['lignes_traitees']} lignes ({st['duration_ms']} ms), "
              f"reste {st['reste_a_traiter']}")
        if st["reste_a_traiter"] == 0 or st["lignes_traitees"] == 0:
            break
    show("IMPORT RÉEL", cumul)
    show("CONTRÔLES", rpc("inventory_import_report", {"_import": import_id}))


if __name__ == "__main__":
    main()
