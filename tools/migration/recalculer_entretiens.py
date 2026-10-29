#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
M8 — Reprise : recalcule le PROCHAIN ENTRETIEN de toutes les motos (mission 07, carte 4).

Appelle vehicle_maintenance_recompute_batch par lots de 200 (3 364 motos) et affiche combien
de motos ont une echeance et par source (or_dms, invoice_g8, client, dcs_extract, plan).

Sans --apply : etat des lieux seulement (motos, VIN, dates de depart, factures d'entretien,
extract DCS deja importe, lignes courantes existantes), rien n'est ecrit.
Prerequis : migration 20261031100000_m8_prochain_entretien.sql appliquee.

Usage (PowerShell) :
  $env:SUPABASE_SERVICE_ROLE_KEY = [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY","User")
  python tools/migration/recalculer_entretiens.py            # ESSAI A BLANC (etat des lieux)
  python tools/migration/recalculer_entretiens.py --apply    # recalcule toutes les motos
"""
import os, sys, json, time, urllib.request, urllib.error

REF = "ujmrosbgkvgvwfnuryna"
BASE = f"https://{REF}.supabase.co/rest/v1"
SVC = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SVC:
    sys.exit("SUPABASE_SERVICE_ROLE_KEY manquant dans l'environnement.")


def req(method, path, body=None, prefer=None, ok404=False):
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
                if prefer and "count=" in prefer:
                    return resp.headers.get("Content-Range", "")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            if ok404 and e.code in (404, 400):
                return None
            sys.exit(f"{method} {path} -> {e.code}: {e.read().decode()[:400]}")
        except Exception as e:
            if essai == 4:
                sys.exit(f"{method} {path} -> reseau indisponible apres 5 essais : {e}")
            time.sleep(5 * (essai + 1))


def compter(path):
    """Nombre de lignes via Content-Range (sans rapatrier les donnees) ; None si la colonne ou la table manque."""
    rng = req("GET", path + ("&" if "?" in path else "?") + "select=id&limit=1", prefer="count=exact", ok404=True)
    if rng is None:
        return None
    try:
        return int(str(rng).split("/")[-1])
    except ValueError:
        return 0


def ligne(libelle, n, absent="colonne absente (migration 20261031100000 non appliquee)"):
    print(f"   {libelle.ljust(28)}: " + (f"{n:>6}" if n is not None else absent))


def main():
    apply = "--apply" in sys.argv
    co = req("GET", "companies?select=id,code")
    cid = next((c["id"] for c in co if (c.get("code") or "").lower() == "italbike"), co[0]["id"])

    print("Etat des lieux (societe Italbike)")
    ligne("motos", compter(f"vehicles?company_id=eq.{cid}"))
    ligne("avec VIN", compter(f"vehicles?company_id=eq.{cid}&vin=not.is.null"))
    ligne("avec debut de garantie", compter(f"vehicles?company_id=eq.{cid}&warranty_start=not.is.null"))
    ligne("avec mise en circulation", compter(f"vehicles?company_id=eq.{cid}&first_registration_date=not.is.null"))
    ligne("avec entretien declare", compter(f"vehicles?company_id=eq.{cid}&last_service_at=not.is.null"))
    absent = "table absente (migration 20261031100000 non appliquee)"
    ligne("lignes de l'extract DCS", compter(f"dcs_maintenance_imports?company_id=eq.{cid}"), absent)
    ligne("echeances courantes posees", compter(f"vehicle_maintenance_due?company_id=eq.{cid}&is_current=eq.true"), absent)

    if not apply:
        print()
        print("ESSAI A BLANC — rien n'a ete ecrit. Relancer avec --apply pour recalculer toutes les motos.")
        return

    print()
    print("Recalcul par lots de 200…", flush=True)
    after, done, with_due, by_source = None, 0, 0, {}
    debut = time.time()
    while True:
        r = req("POST", "rpc/vehicle_maintenance_recompute_batch", {"_company": cid, "_after": after, "_limit": 200})
        if not r or not r.get("done"):
            break
        done += r["done"]
        with_due += r["with_due"]
        for k, v in (r.get("by_source") or {}).items():
            by_source[k] = by_source.get(k, 0) + v
        after = r["last_id"]
        print(f"   {done} moto(s)…", flush=True)
        if r["done"] < 200:
            break

    print()
    print(f"APPLIQUE en {time.time() - debut:.0f} s")
    print(f"   motos recalculees           : {done:>6}")
    print(f"   avec une echeance           : {with_due:>6}")
    print(f"   sans echeance (rien de connu): {done - with_due:>5}")
    for k, v in sorted(by_source.items(), key=lambda x: -x[1]):
        print(f"      {k.ljust(14)} {v:>6}")


if __name__ == "__main__":
    main()
