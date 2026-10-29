#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
M2 — Reprise des REMPLACEMENTS depuis les tarifs Ducati (colonne « Remplacement »).

Pourquoi : le DMS connaît 16 331 remplacements, hérités de G8. Les trois fichiers
de tarif Ducati en publient 21 051, à jour. C'est la source qui fait foi : elle dit
quelle référence commander aujourd'hui, là où G8 fige l'état du jour de la reprise.

Ce que le script fait, et seulement ça :
  · lit les trois fichiers ListPrice ;
  · pour chaque reference remplacée, si les DEUX références existent comme articles
    du DMS, pose superseded_by_id sur l'ancienne ;
  · ne touche jamais un remplacement déjà posé qui pointe ailleurs : il le SIGNALE
    (un désaccord entre G8 et le tarif se tranche à la main, pas en silence) ;
  · ne transfère aucun stock : ça se fait depuis la fiche article, avec sa trace (B7).

Usage (PowerShell) :
  $env:SUPABASE_SERVICE_ROLE_KEY = [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY","User")
  python tools/migration/import_remplacements_tarif.py "<dossier des .xlsx>"           # ESSAI A BLANC
  python tools/migration/import_remplacements_tarif.py "<dossier des .xlsx>" --apply
"""
import os, re, sys, json, time, zipfile, urllib.request, urllib.error
from xml.etree import ElementTree as ET

REF = "ujmrosbgkvgvwfnuryna"
BASE = f"https://{REF}.supabase.co/rest/v1"
SVC = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
FICHIERS = ["PARTS_ListPrice_09_BE_FR.xlsx", "ACCESSORIES_ListPrice_09_BE_FR.xlsx", "APPAREL_ListPrice_09_BE_FR.xlsx"]
C_REF, C_REMP = 0, 6

if not SVC:
    sys.exit("SUPABASE_SERVICE_ROLE_KEY manquant dans l'environnement.")


def req(method, path, body=None, prefer=None):
    for essai in range(10):
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
            if essai == 9:
                sys.exit(f"{method} {path} -> reseau indisponible apres 10 essais : {e}")
            time.sleep(min(60, 5 * (essai + 1)))


def lignes(path):
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
        yield [d.get(i, "") for i in range(12)]


norm = lambda s: re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("--"):
        sys.exit('Usage : import_remplacements_tarif.py "<dossier des .xlsx>" [--apply]')
    dossier = sys.argv[1]
    apply = "--apply" in sys.argv

    # 1. Les remplacements publiés par Ducati.
    paires = {}
    for f in FICHIERS:
        chemin = os.path.join(dossier, f)
        if not os.path.exists(chemin):
            print(f"   fichier absent, ignore : {f}")
            continue
        n = 0
        for i, r in enumerate(lignes(chemin)):
            if i == 0:
                continue
            ancienne, nouvelle = (r[C_REF] or "").strip(), (r[C_REMP] or "").strip()
            if ancienne and nouvelle and norm(ancienne) != norm(nouvelle):
                paires[norm(ancienne)] = norm(nouvelle)
                n += 1
        print(f"   {f.split('_')[0].ljust(12)} : {n} remplacement(s)")
    print(f"Tarif Ducati : {len(paires)} remplacement(s) au total")

    # 2. Le referentiel du DMS.
    co = req("GET", "companies?select=id,code")
    cid = next((c["id"] for c in co if (c.get("code") or "").lower() == "italbike"), co[0]["id"])
    print("Lecture du referentiel du DMS...", flush=True)
    par_ref, par_id, page, taille = {}, {}, 0, 1000
    while True:
        lot = req("GET", f"articles?select=id,reference,superseded_by_id&company_id=eq.{cid}"
                         f"&limit={taille}&offset={page * taille}")
        if not lot:
            break
        for a in lot:
            par_ref[norm(a["reference"])] = a
            par_id[a["id"]] = a
        if len(lot) < taille:
            break
        page += 1
    print(f"   {len(par_ref)} articles")

    a_poser, deja_ok, desaccords, hors_dms = [], 0, [], 0
    for ancienne, nouvelle in paires.items():
        va, vn = par_ref.get(ancienne), par_ref.get(nouvelle)
        if not va or not vn:
            hors_dms += 1
            continue
        if va["superseded_by_id"] == vn["id"]:
            deja_ok += 1
        elif va["superseded_by_id"]:
            # Deux sources, deux remplacants : ce n'est pas un conflit a trancher, ce
            # sont souvent deux pieces pour des motos differentes (constate avec le
            # client le 30/10/2026). On garde le choix du DMS par defaut et on
            # enregistre l'autre comme remplacant possible.
            actuel = par_id.get(va["superseded_by_id"])
            desaccords.append((va["reference"], (actuel or {}).get("reference", "?"), vn["reference"]))
            if apply:
                req("POST", "article_replacement_options",
                    {"company_id": cid, "article_id": va["id"], "candidate_id": vn["id"],
                     "source": "tarif_ducati"},
                    prefer="return=minimal,resolution=ignore-duplicates")
        else:
            a_poser.append((va, vn))

    if apply:
        for i, (va, vn) in enumerate(a_poser, 1):
            req("PATCH", f"articles?id=eq.{va['id']}", {"superseded_by_id": vn["id"]}, prefer="return=minimal")
            if i % 200 == 0:
                print(f"   {i} / {len(a_poser)}", flush=True)

    print()
    print("APPLIQUE" if apply else "ESSAI A BLANC — rien n'a ete ecrit")
    print(f"   remplacements poses        : {len(a_poser)}")
    print(f"   deja corrects              : {deja_ok}")
    print(f"   une des deux refs absente  : {hors_dms}")
    print(f"   DEUX REMPLACANTS POSSIBLES : {len(desaccords)}")
    for anc, g8, tarif in desaccords[:10]:
        print(f"      {anc.ljust(14)} : {g8} (defaut, G8) ou {tarif} (tarif Ducati)")
    if desaccords:
        print("   (le choix par defaut ne bouge pas ; l'autre est enregistre comme")
        print("    remplacant possible, la fiche montrera les motos de chacun)")


if __name__ == "__main__":
    main()
