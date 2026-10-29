#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
M14 / M2 — Reprise de l'EXPORT G8 DU STOCK (« Export JJ.MM.AA.xlsx », 33 colonnes).

Ce que la reprise de juin 2026 n'avait pas transmis, et que ce fichier apporte :
  · les VERROUS de prix (« Prix achat bloque », « Prix vente bloque ») — sans eux,
    un import de tarif ecrase un prix que le patron avait fixe volontairement ;
  · la ROTATION (« Dernier achat », « Derniere vente ») — last_sold_at et
    last_purchased_at sont vides sur les 93 757 articles du DMS ;
  · le PRIX D'ACHAT et le PAMP, absents sur la plupart des articles ;
  · le CASIER et le stock reel, pour controle.

Regles du projet respectees :
  · B7 — un ecart de stock passe par un mouvement trace, jamais par un UPDATE ;
  · B5 — le PAMP n'est jamais ecrase a la legere : on ne le pose que s'il est vide ;
  · rien n'est ecrit sans --apply.

Usage (PowerShell) :
  $env:SUPABASE_SERVICE_ROLE_KEY = [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY","User")
  python tools/migration/import_stock_g8.py "<fichier.xlsx>"            # ESSAI A BLANC
  python tools/migration/import_stock_g8.py "<fichier.xlsx>" --apply    # ecrit
  python tools/migration/import_stock_g8.py "<fichier.xlsx>" --apply --sans-stock
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
    """Appel REST, avec reessais : une reprise longue ne doit pas mourir sur une coupure."""
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
            with urllib.request.urlopen(r, timeout=60) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            sys.exit(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}")
        except Exception as e:
            if essai == 4:
                sys.exit(f"{method} {path} -> reseau indisponible apres 5 essais : {e}")
            time.sleep(5 * (essai + 1))


# ---------------------------------------------------------------- lecture du xlsx
def lire(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        t = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in t.findall(NS + "si"):
            shared.append("".join(n.text or "" for n in si.iter(NS + "t")))
    feuille = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml", n))[0]
    t = ET.fromstring(z.read(feuille))

    def col(ref):
        m = re.match(r"([A-Z]+)", ref or "")
        n = 0
        if not m:
            return 0
        for ch in m.group(1):
            n = n * 26 + (ord(ch) - 64)
        return n - 1

    for r in t.iter(NS + "row"):
        d = {}
        for c in r.findall(NS + "c"):
            v = c.find(NS + "v")
            d[col(c.get("r"))] = "" if v is None else (
                shared[int(v.text)] if c.get("t") == "s" and v.text and v.text.isdigit() else (v.text or ""))
        yield [d.get(i, "") for i in range(33)]


def nombre(v):
    try:
        return float(str(v).replace(",", ".").strip())
    except Exception:
        return None


def date_excel(v):
    """G8 exporte les dates en serie Excel (45659 = 12/01/2025)."""
    n = nombre(v)
    if not n or n < 1000:
        return None
    return (EPOCH + datetime.timedelta(days=int(n))).isoformat()


def oui(v):
    return str(v or "").strip().lower() in ("oui", "o", "true", "1", "yes")


# Colonnes du fichier (verifiees sur Export 28.10.26.xlsx)
C_REF, C_DES, C_REEL, C_CASIER = 0, 1, 4, 9
C_ACHAT, C_PAMP, C_REMP = 21, 22, 23
C_DERNIER_ACHAT, C_DERNIERE_VENTE = 25, 26
C_ACHAT_BLOQUE, C_VENTE_BLOQUE = 30, 31


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("--"):
        sys.exit("Usage : import_stock_g8.py \"<fichier.xlsx>\" [--apply] [--sans-stock]")
    fichier = sys.argv[1]
    apply = "--apply" in sys.argv
    sans_stock = "--sans-stock" in sys.argv

    co = req("GET", "companies?select=id,code")
    cid = next((c["id"] for c in co if (c.get("code") or "").lower() == "italbike"), co[0]["id"])

    lignes = [r for i, r in enumerate(lire(fichier)) if i > 0 and (r[C_REF] or "").strip()]
    print(f"Fichier : {os.path.basename(fichier)} — {len(lignes)} ligne(s)")

    # Le referentiel, en une fois (93 757 articles) : une requete par article serait interminable.
    print("Lecture du referentiel du DMS…", flush=True)
    articles, page, taille = {}, 0, 1000
    while True:
        lot = req("GET", f"articles?select=id,reference,purchase_price,pamp,price_sale_locked,"
                         f"price_purchase_locked,last_sold_at,last_purchased_at,bin_location"
                         f"&company_id=eq.{cid}&limit={taille}&offset={page * taille}")
        if not lot:
            break
        for a in lot:
            articles[(a["reference"] or "").strip().upper()] = a
        if len(lot) < taille:
            break
        page += 1
    print(f"   {len(articles)} articles connus du DMS")

    inconnus = []
    maj = {"verrou_vente": [], "verrou_achat": [], "derniere_vente": [], "dernier_achat": [],
           "prix_achat": [], "pamp": [], "casier": []}

    for r in lignes:
        ref = (r[C_REF] or "").strip().upper()
        a = articles.get(ref)
        if not a:
            # Reference presente dans G8 mais absente du DMS : c'est un article cree
            # dans G8 depuis la reprise de juin. On le cree, avec ce que le fichier
            # en dit. Le stock, lui, passera par import_inventaire_g8.py (B7).
            inconnus.append(ref)
            if apply:
                nouveau = {
                    "company_id": cid,
                    "reference": r[C_REF].strip(),
                    "designation": (r[C_DES] or "").strip() or "Libelle a completer",
                    "mgmt_type": "A",
                    "to_complete": not (r[C_DES] or "").strip(),
                }
                pa = nombre(r[C_ACHAT])
                if pa: nouveau["purchase_price"] = pa
                pamp = nombre(r[C_PAMP])
                if pamp: nouveau["pamp"] = pamp
                casier = (r[C_CASIER] or "").strip()
                if casier: nouveau["bin_location"] = casier
                if oui(r[C_VENTE_BLOQUE]): nouveau["price_sale_locked"] = True
                if oui(r[C_ACHAT_BLOQUE]): nouveau["price_purchase_locked"] = True
                d = date_excel(r[C_DERNIERE_VENTE])
                if d: nouveau["last_sold_at"] = d
                d = date_excel(r[C_DERNIER_ACHAT])
                if d: nouveau["last_purchased_at"] = d
                req("POST", "articles", nouveau, prefer="return=minimal")
            continue
        patch = {}
        if oui(r[C_VENTE_BLOQUE]) and not a.get("price_sale_locked"):
            patch["price_sale_locked"] = True
            maj["verrou_vente"].append(ref)
        if oui(r[C_ACHAT_BLOQUE]) and not a.get("price_purchase_locked"):
            patch["price_purchase_locked"] = True
            maj["verrou_achat"].append(ref)
        d = date_excel(r[C_DERNIERE_VENTE])
        if d and not a.get("last_sold_at"):
            patch["last_sold_at"] = d
            maj["derniere_vente"].append(ref)
        d = date_excel(r[C_DERNIER_ACHAT])
        if d and not a.get("last_purchased_at"):
            patch["last_purchased_at"] = d
            maj["dernier_achat"].append(ref)
        pa = nombre(r[C_ACHAT])
        if pa and not nombre(a.get("purchase_price")):
            patch["purchase_price"] = pa
            maj["prix_achat"].append(ref)
        pamp = nombre(r[C_PAMP])
        if pamp and not nombre(a.get("pamp")):
            patch["pamp"] = pamp
            maj["pamp"].append(ref)
        casier = (r[C_CASIER] or "").strip()
        if casier and not (a.get("bin_location") or "").strip():
            patch["bin_location"] = casier
            maj["casier"].append(ref)

        if patch and apply:
            req("PATCH", f"articles?id=eq.{a['id']}", patch, prefer="return=minimal")

    print()
    print("APPLIQUE" if apply else "ESSAI A BLANC — rien n'a ete ecrit")
    for k, v in maj.items():
        if v:
            print(f"   {k.ljust(16)} : {len(v):>5}   ex. {', '.join(v[:3])}")
    if inconnus:
        quoi = "crees dans le DMS" if apply else "absents du DMS (a creer)"
        print(f"   {quoi.ljust(24)} : {len(inconnus):>5}   ex. {', '.join(inconnus[:3])}")
    if sans_stock:
        print("   (le controle des ecarts de stock a ete demande en moins)")
    else:
        print("   les ecarts de stock ne sont PAS traites ici : ils passent par")
        print("   import_inventaire_g8.py, qui pose un mouvement trace (B7).")


if __name__ == "__main__":
    main()
