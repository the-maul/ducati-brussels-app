#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
M2 — Reprise de l'existant : traduction des designations d'articles en FR / NL / EN / IT.

Decision client du 30/10/2026 (I18N002) : « quand une donnee rentre elle doit etre
traduite ». Les 93 782 articles deja en base n'ont pas de traduction : ce script les
passe par le meme moteur que l'application (Edge Function translate-designations :
glossaire mecanique, memoire de traduction, puis Claude pour ce qui manque).

Pour chaque article restant a traduire (designation_translated_at NULL) :
  · designation_source      = l'original (la designation actuelle si l'original est vide),
  · designation_source_lang = la langue detectee,
  · designation_i18n        = les quatre versions,
  · designation             = la version FR (reste l'original quand il est deja en FR),
  · designation_translated_at = maintenant.
Un article qui ne recoit pas de traduction garde designation_translated_at NULL :
relancer le script le reprend (reprise naturelle, aucun etat a garder).

Regles du projet respectees :
  · rien n'est ecrit sans --apply ;
  · l'essai a blanc (defaut) compte, detecte les langues, estime le cout Claude
    SANS appeler Claude (mode detect de la fonction : glossaire + memoire seulement).

Usage (PowerShell) :
  $env:SUPABASE_SERVICE_ROLE_KEY = [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY","User")
  python tools/migration/traduire_designations.py                      # ESSAI A BLANC : tout compter, cout estime
  python tools/migration/traduire_designations.py --lang it,en         # essai a blanc, designations IT et EN seulement
  python tools/migration/traduire_designations.py --lang it,en --apply # traduit et ecrit (IT / EN)
  python tools/migration/traduire_designations.py --tout --apply       # tout, y compris le FR deja en place (-> NL / EN / IT)
Options : --limit N (s'arreter apres N articles), --lot 50 (taille des lots, 50 maximum).

Prerequis : migration 20261030140000 appliquee, fonction translate-designations deployee,
secret ANTHROPIC_API_KEY pose cote Edge Functions.
"""
import os, sys, json, time, datetime, urllib.request, urllib.error

REF = "ujmrosbgkvgvwfnuryna"
BASE = f"https://{REF}.supabase.co/rest/v1"
FN = f"https://{REF}.supabase.co/functions/v1/translate-designations"
SVC = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
LANGS = ("fr", "nl", "en", "it")

# Estimation du cout Claude (claude-opus-5 : 5 USD / M jetons en entree, 25 USD / M en sortie).
# Par libelle envoye : ~25 jetons d'entree (ligne + part des consignes), ~55 jetons de sortie (4 langues en JSON).
PRIX_IN, PRIX_OUT = 5.0 / 1_000_000, 25.0 / 1_000_000
JETONS_IN_PAR_LIBELLE, JETONS_OUT_PAR_LIBELLE, JETONS_IN_PAR_APPEL = 25, 55, 450

if not SVC:
    sys.exit("SUPABASE_SERVICE_ROLE_KEY manquant dans l'environnement.")


def req(method, url, body=None, prefer=None, timeout=120):
    """Appel HTTP avec reessais : une reprise longue ne doit pas mourir sur une coupure."""
    for essai in range(5):
        r = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method)
        r.add_header("apikey", SVC)
        r.add_header("Authorization", f"Bearer {SVC}")
        r.add_header("Content-Type", "application/json")
        if prefer:
            r.add_header("Prefer", prefer)
        try:
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:300]
            if e.code in (502, 503, 504, 429) and essai < 4:
                time.sleep(5 * (essai + 1))
                continue
            sys.exit(f"{method} {url} -> {e.code}: {detail}")
        except Exception as e:
            if essai == 4:
                sys.exit(f"{method} {url} -> reseau indisponible apres 5 essais : {e}")
            time.sleep(5 * (essai + 1))


def lire_articles(cid, limite):
    """Articles restant a traduire, par cle (id) : le jeu ne bouge pas sous nos pieds."""
    dernier, total = "", 0
    while True:
        page = req("GET", f"{BASE}/articles?select=id,reference,designation,designation_source,designation_source_lang"
                          f"&company_id=eq.{cid}&is_active=eq.true&designation_translated_at=is.null"
                          f"&id=gt.{dernier or '00000000-0000-0000-0000-000000000000'}&order=id&limit=1000")
        if not page:
            return
        for a in page:
            yield a
            total += 1
            if limite and total >= limite:
                return
        dernier = page[-1]["id"]
        if len(page) < 1000:
            return


def source_de(a):
    return " ".join(str(a.get("designation_source") or a.get("designation") or "").split())


def lots(seq, n):
    lot = []
    for x in seq:
        lot.append(x)
        if len(lot) >= n:
            yield lot
            lot = []
    if lot:
        yield lot


def appeler(items, mode):
    r = req("POST", FN, {"items": items, "mode": mode}, timeout=300)
    if not r or not isinstance(r.get("data"), list):
        sys.exit(f"Reponse inattendue de la fonction : {str(r)[:300]}")
    return r


def main():
    args = sys.argv[1:]
    apply = "--apply" in args
    tout = "--tout" in args
    langs = None
    limite = 0
    taille = 50
    for i, a in enumerate(args):
        if a == "--lang" and i + 1 < len(args):
            langs = {l.strip().lower() for l in args[i + 1].split(",") if l.strip()}
        if a == "--limit" and i + 1 < len(args):
            limite = int(args[i + 1])
        if a == "--lot" and i + 1 < len(args):
            taille = max(1, min(50, int(args[i + 1])))
    if langs and not langs <= set(LANGS) | {"?"}:
        sys.exit(f"--lang accepte fr, nl, en, it, ? (recu : {', '.join(sorted(langs))})")
    if apply and not (langs or tout):
        sys.exit("--apply demande une portee : --lang it,en (langues detectees) ou --tout (tous les articles).")

    co = req("GET", f"{BASE}/companies?select=id,code")
    cid = next((c["id"] for c in co if (c.get("code") or "").lower() == "italbike"), co[0]["id"])

    print("APPLICATION" if apply else "ESSAI A BLANC — rien n'est ecrit, Claude n'est pas appele")
    print(f"Portee : {'toutes les langues' if not langs else 'langues ' + ', '.join(sorted(langs))}"
          f"{' (limite ' + str(limite) + ')' if limite else ''}")
    print("Lecture des articles a traduire…", flush=True)

    stats = {"vus": 0, "retenus": 0, "glossaire": 0, "memoire": 0, "claude": 0, "sans": 0, "ecrits": 0, "erreurs": 0}
    par_langue = {}
    jetons_in = jetons_out = 0
    t0 = time.time()
    exemples = []

    for lot in lots(lire_articles(cid, limite), taille):
        stats["vus"] += len(lot)
        textes = [source_de(a) for a in lot]
        # 1. Detection (glossaire + memoire, sans Claude) : langue, couverture, ce qui irait a Claude.
        det = appeler([{"text": t, "lang": a.get("designation_source_lang") or None} for t, a in zip(textes, lot)], "detect")
        par_texte = {d["text"]: d for d in det["data"]}
        retenus = []
        for a, t in zip(lot, textes):
            d = par_texte.get(t)
            if not d:
                continue
            lang = d.get("lang") or "?"
            par_langue[lang] = par_langue.get(lang, 0) + 1
            if langs and lang not in langs:
                continue
            retenus.append((a, t, d))
        stats["retenus"] += len(retenus)
        a_claude = [t for _, t, d in retenus if d.get("from") == "aucune"]
        stats["glossaire"] += sum(1 for _, _, d in retenus if d.get("from") == "glossaire")
        stats["memoire"] += sum(1 for _, _, d in retenus if d.get("from") == "memoire")
        if a_claude:
            jetons_in += JETONS_IN_PAR_APPEL + JETONS_IN_PAR_LIBELLE * len(a_claude)
            jetons_out += JETONS_OUT_PAR_LIBELLE * len(a_claude)
        if len(exemples) < 5:
            for _, t, d in retenus:
                if d.get("i18n") and len(exemples) < 5:
                    exemples.append((t, d["i18n"].get("fr"), d.get("from")))

        if not apply or not retenus:
            continue

        # 2. Traduction complete (Claude pour ce qui manque) puis ecriture article par article.
        res = appeler([{"text": t, "lang": d.get("lang") if d.get("lang") != "?" else None} for _, t, d in retenus], "translate")
        if res.get("error"):
            print(f"   attention : {res['error']} {res.get('detail') or ''}")
        stats["claude"] += (res.get("usage") or {}).get("claude_items", 0)
        resultats = {d["text"]: d for d in res["data"]}
        maintenant = datetime.datetime.now(datetime.timezone.utc).isoformat()
        for a, t, _ in retenus:
            d = resultats.get(t)
            if not d or not d.get("i18n"):
                stats["sans"] += 1
                continue
            i18n = d["i18n"]
            patch = {
                "designation": i18n.get("fr") or t,
                "designation_source": t,
                "designation_source_lang": d.get("lang") or "?",
                "designation_i18n": {l: i18n.get(l) or t for l in LANGS},
                "designation_translated_at": maintenant,
            }
            try:
                req("PATCH", f"{BASE}/articles?id=eq.{a['id']}", patch, prefer="return=minimal")
                stats["ecrits"] += 1
            except SystemExit:
                raise
            except Exception as e:
                stats["erreurs"] += 1
                print(f"   {a.get('reference')} : {e}")

        if stats["vus"] % 1000 < taille:
            ecoule = time.time() - t0
            print(f"   {stats['vus']:>6} articles vus, {stats['ecrits']:>6} ecrits, {int(ecoule)} s", flush=True)

    print()
    print(f"Articles a traduire vus      : {stats['vus']}")
    print(f"Retenus dans la portee       : {stats['retenus']}")
    print("Langues detectees            : " + ", ".join(f"{k} {v}" for k, v in sorted(par_langue.items())))
    print(f"   couverts par le glossaire : {stats['glossaire']}")
    print(f"   deja en memoire           : {stats['memoire']}")
    a_envoyer = stats["retenus"] - stats["glossaire"] - stats["memoire"]
    print(f"   a envoyer a Claude        : {a_envoyer}")
    cout = jetons_in * PRIX_IN + jetons_out * PRIX_OUT
    print(f"Cout Claude estime           : ~{jetons_in + jetons_out:,} jetons, ~{cout:.2f} USD"
          f" ({'facture a l application' if apply else 'avant application'})")
    if exemples:
        print("Exemples :")
        for t, fr, origine in exemples:
            print(f"   {t}  ->  {fr}   [{origine}]")
    if apply:
        print(f"Ecrits : {stats['ecrits']}   sans traduction (a relancer) : {stats['sans']}   erreurs : {stats['erreurs']}"
              f"   libelles traduits par Claude : {stats['claude']}")
    else:
        print("Relancer avec --apply (et --lang ... ou --tout) pour ecrire.")


if __name__ == "__main__":
    main()
