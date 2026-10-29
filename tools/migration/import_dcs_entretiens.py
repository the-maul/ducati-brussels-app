#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
M8 — Import de l'EXTRACT DCS « ENTRETIEN EN RETARD 180 JOURS + 6 MOIS A VENIR » (mission 07, carte 4).

Le concessionnaire sort ce fichier a la main de DCS : une feuille « Export », colonnes
VIN, Warranty Start Date (serie Excel), WA Dealer, WA Dealer Country, Maintenance Planned Date
(serie Excel), Maintenance Type (« Annual Service », « Oil Service », « Oil Service 1000km/600mi »),
Day(s) Before Maintenance ; derniere ligne « Applied filters: … » a ignorer ; chaines inline.

Ce que fait le script :
  · lit le xlsx (sans dependance : zipfile + xml, chaines inline ET sharedStrings) ;
  · rapport : motos connues / inconnues du DMS (liste des VIN inconnus), proprietaires
    joignables par e-mail, lignes deja importees (relancable : un VIN deja importe pour la
    meme date et le meme type ne cree pas de doublon) ;
  · --apply : appelle la fonction SQL dcs_maintenance_import (la meme que le bouton
    « Importer l'extract DCS » de l'application), qui depose les lignes, remplit le debut de
    garantie vide des motos et recalcule leur prochain entretien.

Regles : rien n'est ecrit sans --apply ; le fichier n'est jamais commite (donnees clients).
Prerequis : migration 20261031100000_m8_prochain_entretien.sql appliquee.

Usage (PowerShell) :
  $env:SUPABASE_SERVICE_ROLE_KEY = [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY","User")
  python tools/migration/import_dcs_entretiens.py "<fichier.xlsx>"            # ESSAI A BLANC
  python tools/migration/import_dcs_entretiens.py "<fichier.xlsx>" --apply    # ecrit
"""
import os, re, sys, json, time, zipfile, datetime, urllib.request, urllib.error
from xml.etree import ElementTree as ET

REF = "ujmrosbgkvgvwfnuryna"
BASE = f"https://{REF}.supabase.co/rest/v1"
SVC = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
EPOCH = datetime.date(1899, 12, 30)

if not SVC:
    sys.exit("SUPABASE_SERVICE_ROLE_KEY manquant dans l'environnement.")


def req(method, path, body=None, prefer=None):
    """Appel REST avec reessais ; une erreur HTTP arrete tout (rien n'est a moitie fait)."""
    for essai in range(5):
        r = urllib.request.Request(f"{BASE}/{path}",
                                   data=(json.dumps(body).encode() if body is not None else None),
                                   method=method)
        r.add_header("apikey", SVC)
        r.add_header("Authorization", f"Bearer {SVC}")
        r.add_header("Content-Type", "application/json")
        if prefer:
            r.add_header("Prefer", prefer)
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            sys.exit(f"{method} {path} -> {e.code}: {e.read().decode()[:400]}")
        except Exception as e:
            if essai == 4:
                sys.exit(f"{method} {path} -> reseau indisponible apres 5 essais : {e}")
            time.sleep(5 * (essai + 1))


# ---------------------------------------------------------------- lecture du xlsx
def _col(ref):
    m = re.match(r"([A-Z]+)", ref or "")
    n = 0
    if not m:
        return None
    for ch in m.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def lire(path):
    """Lignes de la premiere feuille (ou « Export »), cellules en texte brut (dates = serie Excel)."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        t = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in t.findall(NS + "si"):
            shared.append("".join(n.text or "" for n in si.iter(NS + "t")))
    feuilles = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml", n))
    t = ET.fromstring(z.read(feuilles[0]))
    rows = []
    for r in t.iter(NS + "row"):
        d = {}
        pos = 0
        for c in r.findall(NS + "c"):
            idx = _col(c.get("r"))
            if idx is None:
                idx = pos
            pos = idx + 1
            v = c.find(NS + "v")
            if c.get("t") == "inlineStr":
                d[idx] = "".join(n.text or "" for n in c.iter(NS + "t"))
            elif c.get("t") == "s" and v is not None and (v.text or "").isdigit():
                d[idx] = shared[int(v.text)]
            else:
                d[idx] = "" if v is None else (v.text or "")
        width = (max(d) + 1) if d else 0
        rows.append([d.get(i, "") for i in range(width)])
    return rows


def date_excel(v):
    s = str(v or "").strip()
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return s[:10]
    m = re.match(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$", s)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    try:
        n = float(s.replace(",", "."))
    except ValueError:
        return None
    if n < 1000:
        return None
    return (EPOCH + datetime.timedelta(days=int(n))).isoformat()


def entier(v):
    try:
        return int(float(str(v).replace(",", ".").strip()))
    except (ValueError, TypeError):
        return None


def normaliser_vin(v):
    return re.sub(r"[^A-Z0-9]", "", str(v or "").upper())


def parser(rows):
    """Miroir de parseDcsRows (src/modules/workshop/maintenance-due.ts)."""
    header = next((i for i, r in enumerate(rows) if any(str(c).strip().upper() == "VIN" for c in r)), None)
    if header is None:
        sys.exit("En-tete introuvable : ce n'est pas l'extract DCS (colonne VIN attendue).")
    h = [str(c).strip().lower() for c in rows[header]]

    def col(*needles):
        return next((i for i, x in enumerate(h) if any(n in x for n in needles)), None)

    c_vin, c_w, c_p, c_t, c_d, c_dl = col("vin"), col("warranty start"), col("planned date", "maintenance planned"), col("maintenance type", "type"), col("day"), col("wa dealer")
    out, ignorees = [], []
    for i in range(header + 1, len(rows)):
        r = rows[i]
        cell = lambda c: (str(r[c]).strip() if c is not None and c < len(r) else "")
        raw = cell(c_vin)
        if not raw and all(str(c).strip() == "" for c in r):
            continue
        if raw.lower().startswith("applied filters") or (not raw and r and str(r[0]).strip().lower().startswith("applied filters")):
            ignorees.append((i + 1, "filters"))
            continue
        vin = normaliser_vin(raw)
        if len(vin) != 17:
            ignorees.append((i + 1, "vin"))
            continue
        planned = date_excel(cell(c_p))
        if not planned:
            ignorees.append((i + 1, "date"))
            continue
        out.append({
            "row": i + 1, "vin": vin,
            "warranty_start": date_excel(cell(c_w)),
            "planned_date": planned,
            "maintenance_type": cell(c_t) or "Annual Service",
            "days_before": entier(cell(c_d)),
            "dealer": cell(c_dl) or None,
        })
    return out, ignorees


def dedoublonner(lignes):
    vus, gardees, doublons = set(), [], []
    for l in lignes:
        k = (l["vin"], l["planned_date"], l["maintenance_type"].strip().lower())
        if k in vus:
            doublons.append(l)
        else:
            vus.add(k)
            gardees.append(l)
    return gardees, doublons


# ---------------------------------------------------------------- principal
def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("--"):
        sys.exit("Usage : import_dcs_entretiens.py \"<fichier.xlsx>\" [--apply]")
    fichier = sys.argv[1]
    apply = "--apply" in sys.argv

    lignes, ignorees = parser(lire(fichier))
    lignes, doublons = dedoublonner(lignes)
    print(f"Fichier : {os.path.basename(fichier)} — {len(lignes)} ligne(s) utile(s), "
          f"{len(doublons)} doublon(s) dans le fichier, {len(ignorees)} ligne(s) ignoree(s)")
    if not lignes:
        sys.exit("Rien a importer.")

    co = req("GET", "companies?select=id,code")
    cid = next((c["id"] for c in co if (c.get("code") or "").lower() == "italbike"), co[0]["id"])

    # Essai a blanc et apply passent par la meme fonction SQL que l'ecran : _apply decide.
    rapport = req("POST", "rpc/dcs_maintenance_import",
                  {"_company": cid, "_file": os.path.basename(fichier), "_rows": lignes, "_apply": apply})

    types = {}
    for l in lignes:
        types[l["maintenance_type"]] = types.get(l["maintenance_type"], 0) + 1

    print()
    print("APPLIQUE" if apply else "ESSAI A BLANC — rien n'a ete ecrit")
    print(f"   lignes lues           : {rapport['rows']:>5}")
    for k, v in sorted(types.items(), key=lambda x: -x[1]):
        print(f"      {k.ljust(26)} {v:>5}")
    print(f"   motos connues du DMS  : {rapport['known']:>5}   ({rapport['vehicles']} moto(s) distincte(s))")
    print(f"   VIN inconnus du DMS   : {rapport['unknown']:>5}")
    for v in rapport["unknown_vins"]:
        print(f"      {v}")
    print(f"   proprietaires + e-mail: {rapport['owners_with_email']:>5}")
    print(f"   nouvelles lignes      : {rapport['inserted']:>5}")
    print(f"   deja importees        : {rapport['duplicates']:>5}   (relance sans doublon)")
    if rapport["invalid"]:
        print(f"   lignes invalides      : {rapport['invalid']:>5}")
    if apply:
        print(f"   motos recalculees     : {rapport['recomputed']:>5}")
    else:
        print("   relancer avec --apply pour deposer les lignes et recalculer le prochain entretien.")


if __name__ == "__main__":
    main()
