# Journal de bord — session nocturne autonome (Atlas)

> Démarré 2026-07-25 ~23h. Objectif : traiter 100% du backlog Italobike (37 items / 7 modules).
> Backup GitHub : repo `the-maul/ducati-backup` (commit 579601f figé) + tag `backup-20260725-224552`.
> Règles Sim : vérifier compréhension Era vs doc client · Claude Code pour le code · tester réel ·
> ne pas bloquer sur dépendance externe (mettre en place + note + continuer) · pas de faille sécu · autonomie totale.

## Méthode
- 1 lot = 1 branche `feat/lot-N-<module>` = commits tracés `type(scope): desc (CODE)`.
- Baseline build DOIT passer avant/après chaque lot (`bun run build` → exit 0).
- Migrations SQL versionnées dans `supabase/migrations/` (Lovable les applique au deploy).
- i18n FR obligatoire (`t()`), pas de chaîne en dur, tokens CSS, append-only, RLS+company_id.
- Rebase `origin/main` avant push (Lovable co-auteur).

## Suivi build baseline
- (en cours de vérification)

## Notes / blocages (dépendances externes)
- (à remplir : clés SMS/Resend, format DCS/Winbooks, provider CODA/IBAN…)

## Avancement par lot
| Lot | Module | Statut |
|---|---|---|
| 0 | Prérequis (familles/imports) | ⬜ |
| 1 | Contacts / CRM | ⬜ |
| 2 | Pièces & Accessoires | ⬜ |
| 3 | Stock & Inventaire | ⬜ |
| 4 | Ventes & Facturation | ⬜ |
| 5 | Commandes / Documents | ⬜ |
