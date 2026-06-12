# Prompt — Nouvelle discussion « Remise au propre avant go-live »

> Copie-colle le bloc ci-dessous tel quel pour démarrer la prochaine session.

---

Reprends le projet **DMS Ducati Bruxelles** pour la **PHASE DE REMISE AU PROPRE avant go-live**.
On arrête d'ajouter des fonctionnalités « pour faire joli » : on **corrige tout ce qui est simulé, faux ou
manquant** pour atteindre la **parité fonctionnelle avec G8 (Orisha/Futurosoft)** et la **conformité au droit
belge**. Règle d'or : **on ne simule plus rien** — un export produit le format cible réel, un paiement boucle
jusqu'à « payé », un e-mail part vraiment, une écriture comptable est équilibrée.

**AVANT TOUTE CHOSE, lis dans l'ordre :**
1. `docs/audit-complet.md` — l'audit sans complaisance (RÉEL/PARTIEL/SIMULÉ/MANQUANT par module, parité G8,
   droit belge, bugs P0, plan priorisé). **C'est ta feuille de route.**
2. `docs/etat-projet.md` — état, workflow, outillage, pièges.
3. `CLAUDE.md` — règles, glossaire métier FR, invariants B1–B12.
4. `docs/integrations-cles-api.md` — services & clés.
5. Le `docs/g8-fonctions-*.md` du module concerné **avant de coder ce module** (parité, pas approximation).

**PRIORITÉS (dans l'ordre, cf. audit §7) — un commit testé par fonctionnalité :**

P0 — boucler les parcours & produire les vrais formats :
1. **`stripe-webhook`** (Edge Function) : vérifier la signature, passer la commande web en **payée**, générer la
   **facture** (M6) et sortir le **stock réel**. Aujourd'hui le paiement ne se termine jamais.
2. **Moteur d'écritures comptables** : générer de vraies écritures équilibrées — ventilation par compte
   vente/achat selon **rayon×sous-rayon×catégorie×TVA**, **comptes auxiliaires** clients/fournisseurs,
   **TVA collectée/déductible/intracom/marge VO**, règlements sur trésorerie+journal, cessions en analytique.
   **Mapping plan comptable belge (PCMN)** paramétrable. Puis **export Winbooks au VRAI format** (compte tiers
   réel, pas l'UUID actuel). Voir manuel G8 « Compta G8.pdf ».
3. **Format DCS Ducati exact** (ACH001, STANDARD/URGENTE) — demander le gabarit Excel réel au client.
4. **Transmission UBL → Falco / Peppol** : connecteur d'envoi + validation contre le schéma **Peppol BIS 3.0**
   (clé/API Falco + Peppol ID par société). Aujourd'hui on télécharge juste le XML.
5. **`price_changes` append-only (B5/B7)** : créer la table + passer **toute** modification de prix par des
   mouvements tracés. Corriger la **modification en cascade** (qui fait des UPDATE directs) et l'e-shop.

P1 — exigences légales & complétude :
6. **TVA sur marge (B2)** : calcul de la TVA à la revente sur (PV−PA) pour les occasions type O, **registre VO**
   chronologique obligatoire, **attestation TVA marge PDF** (TRAXIO) pré-remplie depuis la fiche véhicule.
7. **E-mails / SMS réels** (Resend + un fournisseur SMS) : confirmation de commande e-shop, **relances** factures,
   **rappels RDV atelier** (la veille), CRM. Edge Functions + `pg_cron` pour les envois datés.
8. **Seed data** (règle 8) : 2 sociétés, 20 clients, 300 articles (tous types A–R/T), 12 véhicules, 5 OR — démos.
9. **Effets de commerce LCR / domiciliation SEPA (pain.008)** : échéancier, génération fichier banque, impayés.
10. **Clôture d'exercice** archivante + éditions pré-clôture (débiteurs, acomptes, chèques/LCR à échéance).
11. **`pg_cron`** : copies de stock auto le 15 et fin de mois (B4) + alerte stock dormant > 4 mois.

P2 — parité fine G8 :
12. **Moteur de tarifs clients** (remise % / coefficient `(PAHT×coef)+TVA=PVTTC` / **remise quantitative à
    paliers**) + import catalogue fournisseur multi-format (formats de mapping réutilisables).
13. **Statistiques avancées** (classement 4 niveaux, comparaison N-1/N-2, meilleures ventes par marge,
    cessions valorisées PV HT + PAMP, taux de transformation).
14. 3e mode d'inventaire (casier à la volée), inventaire tournant, étiquetage différé cumulable (B12).
15. Dépôt-vente (type D) + commission, reprise depuis le POS (réf REP), n° série au POS.
16. Signature électronique, portails client, modèles de documents configurables, CGV au verso.
17. Tâches atelier hors-facturation, checklist « opérations atelier », planning avec taux de charge %.
18. Tests d'intégration : réservations, arrêté/réintégration inventaire, ORO, encours crédit, **RLS**.

**MÉTHODE (non négociable) :**
- Dev + test **EN LOCAL** sur http://localhost:8080, branché sur la vraie DB Supabase. **Ne coupe pas le
  localhost** (relance-le s'il tombe après ajout de routes).
- Migrations : écris-les dans `supabase/migrations/`, applique-les toi-même via le Supabase CLI
  (`db push --linked --yes`), puis régénère `src/integrations/supabase/types.ts`.
- **`bun run build` AVANT chaque push** (doit finir `✓ built`). `git fetch` + `git rebase origin/main` AVANT de
  pousser. **Un commit par fonctionnalité** avec la réf d'exigence.
- Respecte les invariants B1–B12, le glossaire FR, la charte (tokens.css, zéro hex en dur), l'i18n (dictionnaire
  FR, pas de chaîne en dur), **RLS + company_id partout**, tables **stock/prix APPEND-ONLY** (jamais d'UPDATE
  direct), **tests** sur les règles critiques. Mets à jour `docs/avancement.md` ET `docs/audit-complet.md`
  (coche ce qui passe de SIMULÉ/MANQUANT à RÉEL).

**OUTILLAGE / SECRETS (déjà en place, ne jamais committer ni afficher) :**
- Bun : `C:\Users\simon\.bun-cli\bun-windows-x64\bun.exe` | Supabase CLI : `C:\Users\simon\.supabase-cli\supabase.exe`
- Variables d'env User : `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_TOKEN`.
  Projet Supabase ref `ujmrosbgkvgvwfnuryna`. Admin de test `simon@themaul.be`.
- Clés **Stripe / Falco / Resend / SMS / Winbooks (gabarit) / DCS (gabarit)** : à me demander quand le code en a
  besoin (déploiement `supabase functions deploy` + `supabase secrets set`).

**Commence par P0.1 (`stripe-webhook`) puis P0.2 (moteur d'écritures + Winbooks réel)** — ce sont les deux qui
« font semblant » le plus. Avant de coder, **propose-moi le découpage en commits** et coche l'audit au fur et à mesure.
