# Journal de bord — session nocturne autonome (Atlas)

> Démarré 2026-07-25 ~23h. Objectif : traiter 100% du backlog Italobike (37 items / 7 modules).
> Backup GitHub : repo `the-maul/ducati-backup` (commit 579601f figé) + tag `backup-20260725-224552`.
> Accès complets : GitHub (PAT), Supabase service_role + Management API (migrations applicables en direct).

## Environnement
- Bun ~/.bun/bin ; `bun run build` = juge de paix (exit 0 ~25s).
- Claude Code CLI (support@themaul.be) pour déléguer le code : 1 à la fois, background + notify.
- Helper SQL : `python3 ~/.hermes/secrets/sbq.py "<SQL>"` applique/interroge la base Ducati.
- Pas de Lovable (jamais utilisé) → git normal + Netlify.

## Méthode par item
1. Relire la demande client dans le .docx source (vérifier compréhension Era).
2. Cartographier sur le code existant (grep + lecture).
3. Déléguer le code à Claude Code (brief précis avec faits vérifiés).
4. Vérifier moi-même : diff réel + rebuild indépendant + test données réelles.
5. Commit tracé `type(scope): desc (CODE)`. 1 lot = 1 branche = 1 PR.

## Avancement par lot
| Lot | Module | Statut | PR |
|---|---|---|---|
| 1 | Contacts / CRM | 🟢 9/14 items (commits 735aff7, bda3c76) | **PR #1** |
| 2 | Pièces & Accessoires | 🟦 batch A en cours | branche feat/lot-2-parts |
| 3 | Stock & Inventaire | ⬜ | |
| 4 | Ventes & Facturation | ⬜ | |
| 5 | Commandes / Documents | ⬜ | |

## Lot 1 — détail
FAIT: dropdown conditions paiement · retrait champs tarifaires · intérêt Piste · motif surveillance (+migration watch_note APPLIQUÉE) · étoile VIP+alerte près du nom (liste+fiche) · colonne code client · limite 2 fiches liées + pop-up héritage · pop-up débiteur.
RESTE (reporté lots transverses): fil d'Ariane global · sticky save/cancel global · matching auto lead↔moto · IBAN via CODA.

## Découvertes utiles
- Edge Functions déjà présentes: dispatch-notifications, graph-send-email (Outlook/Graph), outlook-poll, read-id-doc, stripe-checkout, stripe-webhook. → envoi email réel = infra partielle existante (Graph), SMS à ajouter.
- listStock expose real_qty/reserved_qty/available_qty (triple stock direct).
- Module Familles (/parts/families) : CRUD 3 niveaux déjà fonctionnel (i18n à finir, pas d'édition/rename).
- Données réelles: 8090 contacts (8084 avec code, 9 en surveillance).

## Migrations à appliquer (suivi)
- 20260726090000_m1_contact_watch_note.sql → APPLIQUÉE ✅
- (lot 2) supplier_availability + bin_location_2 → à appliquer après vérif

## Notes / blocages externes
- SMS: aucun provider configuré → à mettre en place (Edge Function + clé). Email: Graph/Outlook déjà câblé (à vérifier config).
- « Solder compte » pop-up débiteur: TODO flux paiement M6.
- IBAN via CODA: dépend d'un import CODA bancaire (à spécifier).
