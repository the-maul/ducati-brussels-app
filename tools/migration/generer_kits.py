#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
M8 / mission 07 carte 2 — GENERATION DES KITS D'ENTRETIEN pour tout le parc.

Ce que fait la generation (migration 20261103200000_m8_kits_generation.sql) :
  . pour chaque modele-annee du catalogue Ducati qui a des vues eclatees (2 399 le 03/11),
    la famille de moteur, puis les kits « annuel + huile », « annuel » (+ « 1 000 km » et
    les autres echeances quand la source les prevoit) ;
  . le besoin vient du manuel d'atelier, sinon du plan Ducati, sinon de la regle
    « annuel + huile = vidange + filtre » ; la reference vient des vues eclatees ;
  . deux references pour le meme besoin : on garde les deux (M-84) ;
  . un kit corrige par l'atelier n'est jamais reecrit (M-41) ; relancer ne recree rien.

Regles du projet respectees :
  . rien n'est ecrit sans --apply ; l'essai a blanc tourne dans une transaction ANNULEE ;
  . aucun mouvement de stock ; chaque lot laisse une ligne dans `events`.

Usage (PowerShell, depuis la racine du depot) :
  # ESSAI A BLANC (defaut) : transaction annulee via la CLI Supabase (depot lie au projet).
  # La migration est rejouee DANS la transaction : l'essai marche avant comme apres son application.
  python tools/migration/generer_kits.py                       # 200 modeles-annees depuis le debut
  python tools/migration/generer_kits.py --echantillon 400 --depuis 800

  # ECRITURE (migration appliquee d'abord) : par lots via l'API, cle de service.
  $env:SUPABASE_SERVICE_ROLE_KEY = [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY","User")
  python tools/migration/generer_kits.py --apply                # tout le parc
  python tools/migration/generer_kits.py --apply --depuis 900   # reprise apres coupure

Options : --societe <uuid> (defaut ITALBIKE STORE), --lot <n> (defaut 15 : sous le delai
PostgREST de 8 s), --echantillon <n>, --depuis <offset>.
"""
import os, sys, json, time, subprocess, tempfile, pathlib, urllib.request, urllib.error

REF = "ujmrosbgkvgvwfnuryna"
BASE = f"https://{REF}.supabase.co/rest/v1"
CLI = ["npx", "--yes", "supabase@2.117.0", "db", "query", "--linked", "--project-ref", REF]
ITALBIKE = "3d9f0f13-a691-4d07-ad58-34590df86e33"
ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20261103200000_m8_kits_generation.sql"


def arg(nom, defaut):
    if nom in sys.argv:
        i = sys.argv.index(nom)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return defaut


def entier(nom, defaut):
    try:
        return max(0, int(arg(nom, defaut)))
    except ValueError:
        sys.exit(f"{nom} attend un nombre.")


def rpc(svc, fn, body):
    """Appel RPC avec reessais : une generation longue ne doit pas mourir sur une coupure."""
    for essai in range(5):
        r = urllib.request.Request(f"{BASE}/rpc/{fn}", data=json.dumps(body).encode(), method="POST")
        r.add_header("apikey", svc)
        r.add_header("Authorization", f"Bearer {svc}")
        r.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(r, timeout=60) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            if e.code in (500, 502, 503, 504) and essai < 4:
                time.sleep(5 * (essai + 1))
                continue
            sys.exit(f"rpc {fn} -> {e.code}: {msg}")
        except Exception as e:
            if essai == 4:
                sys.exit(f"rpc {fn} -> reseau indisponible apres 5 essais : {e}")
            time.sleep(5 * (essai + 1))


def essai_a_blanc(societe, lot, depuis, echantillon):
    lots = max(1, -(-echantillon // lot))
    sql = "\n".join([
        "begin;",
        "set local statement_timeout = 0;",
        MIGRATION.read_text(encoding="utf-8"),
        # la cle de service (comme le script en --apply), sans personne simulee
        "select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);",
        f"create temp table _gen as select public.maintenance_kit_generate_all('{societe}', {lot}, {depuis}, {lots}) as r;",
        "select jsonb_build_object(",
        "  'generation', (select r from _gen),",
        "  'kits_par_type', (select jsonb_object_agg(coalesce(kind, '?') || '/' || coalesce(src, '?'), n) from (",
        f"     select k.service_kind kind, k.source src, count(*) n from public.maintenance_kits k where k.company_id = '{societe}' and k.status = 'actif' group by 1, 2) z),",
        "  'lignes', (select jsonb_build_object('total', count(*),",
        "       'sur', count(*) filter (where i.confidence = 'sur'),",
        "       'plusieurs_refs', count(*) filter (where cardinality(coalesce(i.catalog_refs, array[]::text[])) > 1),",
        "       'absent', count(*) filter (where i.confidence = 'absent'),",
        "       'besoin_manuel', count(*) filter (where i.provenance ->> 'besoin' = 'manuel'),",
        "       'besoin_plan', count(*) filter (where i.provenance ->> 'besoin' = 'plan'),",
        "       'besoin_regle', count(*) filter (where i.provenance ->> 'besoin' = 'regle'))",
        f"     from public.maintenance_kit_items i where i.company_id = '{societe}')",
        ") as resume;",
        "rollback;",
    ])
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(sql)
        chemin = f.name
    try:
        print(f"ESSAI A BLANC (transaction annulee) : {echantillon} modeles-annees depuis {depuis}, lots de {lot}…")
        out = subprocess.run(CLI + ["-f", chemin], cwd=ROOT, capture_output=True, text=True,
                             encoding="utf-8", shell=(os.name == "nt"))
    finally:
        os.unlink(chemin)
    if out.returncode != 0:
        sys.exit(f"Echec de l'essai : {(out.stderr or out.stdout)[:800]}")
    texte = out.stdout
    debut = texte.find("{")
    try:
        data = json.loads(texte[debut:])
        resume = data["rows"][0]["resume"]
    except Exception:
        print(texte)
        return
    g = resume.get("generation") or {}
    print(f"  modeles-annees parcourus : {g.get('model_years')} / {g.get('total_model_years')}"
          f" (dont {g.get('with_manual')} avec un manuel d'atelier)")
    print(f"  source du besoin : manuel {g.get('source_manuel')} · plan {g.get('source_plan')} · regle {g.get('source_regle')}"
          f" · sans famille de moteur {g.get('unknown_family')}")
    print(f"  kits crees {g.get('created')} · reutilises {g.get('reused')} · corriges respectes {g.get('skipped')}"
          f" · rattachements {g.get('linked')}")
    print(f"  kits par type/source : {json.dumps(resume.get('kits_par_type'), ensure_ascii=False)}")
    print(f"  lignes : {json.dumps(resume.get('lignes'), ensure_ascii=False)}")
    print("Rien n'a ete ecrit. Pour ecrire : --apply (migration appliquee d'abord).")


def ecrire(societe, lot, depuis):
    svc = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not svc:
        sys.exit("SUPABASE_SERVICE_ROLE_KEY manquant dans l'environnement.")
    offset, t0 = depuis, time.time()
    tot = {k: 0 for k in ("model_years", "created", "reused", "linked", "skipped", "items_multi_ref", "items_absent")}
    while True:
        r = rpc(svc, "maintenance_kit_generate", {"_company": societe, "_limit": lot, "_offset": offset, "_model_year": None})
        for k in tot:
            tot[k] += int(r.get(k) or 0)
        offset = int(r.get("next_offset") or offset)
        total = int(r.get("total_model_years") or 0)
        pct = round(100 * offset / total) if total else 0
        print(f"  {offset} / {total} ({pct} %) · {tot['created']} kits crees · {tot['linked']} rattachements"
              f" · {tot['items_multi_ref']} lignes a plusieurs references · lot {r.get('elapsed_ms')} ms", flush=True)
        if r.get("done"):
            break
    print(f"Termine en {round(time.time() - t0)} s : {json.dumps(tot, ensure_ascii=False)}")
    print(f"Relancable a l'identique : rien n'est recree, aucun kit corrige n'est touche.")


def main():
    societe = arg("--societe", ITALBIKE)
    lot = max(1, entier("--lot", 15))
    depuis = entier("--depuis", 0)
    if "--apply" in sys.argv:
        ecrire(societe, lot, depuis)
    else:
        essai_a_blanc(societe, lot, depuis, max(1, entier("--echantillon", 200)))


if __name__ == "__main__":
    main()
