---
chapitre: M12
titre: Compta & exports
etat: 🟡
verifie_le: 2026-09-18
missions: []
mots_cles: [comptabilité, journal des ventes, registre TVA, TVA marge, registre VO, écritures, PCMN, plan comptable, Winbooks, UBL, Peppol, Falco, SEPA, domiciliation, pain.008, clôture d'exercice, bascule comptable, relance impayés]
---

# M12 — Compta & exports

> **En une phrase** : transformer les ventes et les encaissements en journaux, registre TVA, écritures comptables et fichiers d'export pour le comptable (Winbooks), la facturation électronique (UBL / Peppol) et la banque (SEPA).

## 1. À quoi ça sert
Le comptable interne et l'administrateur l'utilisent pour sortir le journal des ventes et le registre
TVA d'une période, générer des écritures comptables équilibrées sur le plan comptable belge (PCMN),
les exporter vers Winbooks, tenir le registre de TVA sur marge des occasions, préparer les
prélèvements SEPA et clôturer une période. **Décision client** (`CLAUDE.md` §5) : le DMS produit
journaux, factures UBL et registres ; le comptable du client tient les livres et corrige après coup.
Tout doit donc rester paramétrable (comptes, taux, journaux) et exportable.

## 2. Ce qu'on a aujourd'hui

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Comptabilité (`/accounting`, rôles admin / comptable dans le menu) | Choisir une période ; **date de bascule** « Compta à partir du » ; **journal des ventes** (clic → ouvre la facture) ; **registre TVA** ventilé par taux ; **écritures comptables** : générer (idempotent), voir chaque pièce avec contrôle « équilibrée / déséquilibrée » ; **export Winbooks** (CSV format « Actage ») ; **registre de la marge** des occasions type O : tableau **par période** (mois / trimestre : achats, ventes, report entrant, marge, base, **TVA due**, report sortant), registre par véhicule (marge indicative, attestation imprimable), achats sous régime de la marge, export CSV et **OD Winbooks** (M-89, migration `20261103160000` à poser) |
| Comptabilité → Domiciliations SEPA (`/accounting-sepa`) | Mandats de prélèvement (client, RUM, IBAN, BIC, date de signature, type de séquence) ; remise SEPA : factures à prélever jusqu'à une date → fichier **pain.008** + encaissement enregistré ; **impayé** : remet la facture en dû |
| Comptabilité → Clôture d'exercice (`/accounting-closure`) | Éditions pré-clôture : clients débiteurs à une date, acomptes en cours, effets / chèques à échéance (exports CSV) ; **clôturer la période** (fige la période et archive un arrêté de stock) ; historique des clôtures |
| Ventes → fiche d'une facture ou d'un avoir (M6) | **Export UBL** Peppol BIS 3.0 (fichier XML téléchargé, à transmettre via Falco) |
| (automatique) | Relance quotidienne des factures échues (e-mail en file d'attente) |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.accounting.tsx`, `src/routes/_app.accounting-sepa.tsx`, `src/routes/_app.accounting-closure.tsx` |
| Journaux, registres, écritures, Winbooks, TVA marge, clôture, UBL | `src/modules/accounting/api.ts` |
| Construction du XML UBL | `src/modules/accounting/ubl.ts` |
| SEPA pain.008 | `src/modules/accounting/sepa.ts` |
| Paramètres société (IBAN, BIC, n° créancier SEPA, identifiant Peppol, comptes par défaut) | `src/modules/settings/companies-api.ts`, `src/routes/_app.settings.companies.tsx` (M0) |
| Tables | `chart_of_accounts` (PCMN, 26 comptes par société), `account_mappings` (règles dimension → compte / journal, 26 lignes), `accounting_entries` (pièces), `accounting_entry_lines` (lignes débit / crédit), `accounting_exports` (journal des exports : `ubl`, `winbooks`), `fiscal_closures` (périodes clôturées), `sepa_mandates` ; colonnes société `accounting_start_date`, `iban`, `bic`, `sepa_creditor_id`, `peppol_id`, `*_account_default` |
| Fonctions SQL (RPC) | `sales_journal`, `vat_register`, `generate_accounting_entries` (→ `generate_sales_entries` + `generate_payment_entries`), `generate_auxiliary_accounts`, `resolve_account`, `resolve_journal`, `_accounting_cutover`, `set_accounting_cutover`, `vo_margin_register`, `vo_margin_summary`, `debtors_list`, `pending_deposits`, `pending_effects`, `close_fiscal_year`, trigger `guard_closed_period`, `sepa_collectable`, `record_sepa_collection`, `record_sepa_unpaid`, `_recompute_paid_unchecked`, `_cron_invoice_reminders`, `enqueue_notification` |
| Fonctions serveur (Edge) | aucune propre au module ; `dispatch-notifications` envoie les relances (inactif sans Resend) |
| Tâches planifiées | `invoice-reminders` (tous les jours 07:00) ; `dispatch-notifications` (toutes les 10 min) |
| Migrations clés | `supabase/migrations/20260610400000_m12_accounting.sql`, `…20260612120000_m12_chart_of_accounts.sql`, `…20260612130000_m12_entry_engine.sql`, `…20260612160000_m7_vo_margin.sql`, `…20260612180000_m12_sepa_mandates.sql`, `…20260612190000_m12_fiscal_closure.sql`, `…20260612300000_m12_vat_register_header.sql`, `…20260612310000_m12_accounting_cutover.sql` |
| Libellés | `src/lib/i18n/fr.ts`, bloc `accounting` |
| Tests | `tests/ubl.test.ts` (3 cas), `tests/sepa-pain008.test.ts` (5 cas) |

## 4. Règles métier et décisions
- **Multi-société (COM005)** : toutes les fonctions prennent `_company` ; plan comptable, mappings, journaux et séquences sont par société.
- **Date de bascule** (commit `a16d7a4`) : seules les factures à partir de `companies.accounting_start_date` génèrent TVA à déclarer, écritures et export Winbooks. L'historique G8 reste consultable mais n'est pas re-déclaré (déjà fait dans G8). Les deux sociétés ont une date posée en base.
- **Écritures** : ventes = client TTC au débit / ventes HT par compte × taux / TVA collectée au crédit ; règlements = trésorerie / client. Append-only, idempotentes, équilibre contrôlé à l'affichage. Comptes résolus par `account_mappings` (paramétrables, pas figés en dur).
- **Winbooks** : une ligne par ligne d'écriture, compte général PCMN réel + compte tiers réel, montant signé (débit +, crédit −). Colonnes à caler sur le fichier exemple du comptable (attendu).
- **TVA sur marge (B2, COM006, art. 58 §4 CTVA, AR n° 53 art. 3 ; décision M-89 du 03/11/2026)** : la facture d'une moto O ne porte aucune TVA (M6). La TVA due se calcule **globalement par période de déclaration** (`vo_margin_periods(_company, _from, _to, _granularity)`, réglage `period` = mois ou trimestre) : `marge = ventes marge − achats marge + report entrant` ; marge ≤ 0 → ni base ni TVA, **report** sur la période suivante ; marge > 0 → `base = marge × 100 / (100 + taux)`, `TVA due = marge − base` (taux réglable, 21). **Ventes marge** = documents FAC / TIK / AVO en `vat_scheme = 'marge'` (avoir négatif, facture annulée par avoir : les deux restent). **Achats marge** = première entrée en stock d'une moto O avec prix de reprise (`vo_margin_purchases`) ; stock initial repris de G8 / Shopify (origine `import` / `moto_parc`) exclu. Le tout part de la **date de bascule**. Registre par véhicule (`vo_margin_register`, marge indicative) et vue `v_vo_margin_declaration`. Le **registre TVA ordinaire** (`vat_register`) exclut les ventes marge ; les écritures de vente marge vont au compte `700200` (mapping `sales_margin`) sans TVA, et `generate_margin_period_entries` passe l'OD de fin de période `700200` / `451090` (mapping `vat_margin`) = TVA due. **Réglages** : Paramètres → Tables → « TVA marge (occasions) — réglages » (`rate`, `period`, `grid_sales` 00, `grid_base` 03, `grid_vat` 54, `winbooks_vat_code` MARGE, `winbooks_journal` OD) : **à confirmer par le comptable**. Type P = TVA 21 % normale, hors registre.
- **UBL** : Peppol BIS 3.0, avoir si `doc_type = 'AVO'`, détaxe prise en compte. Transmission via Falco prévue (décision client, `integrations-cles-api.md` §4).
- **SEPA** : la génération du pain.008 **enregistre immédiatement** l'encaissement (règlement `DOM`) sur chaque facture ; un rejet se traite par « Impayé » (règlement négatif, B7).
- **Clôture** : `close_fiscal_year` fige la période (trigger `trg_documents_closed_period` refuse tout document daté dedans) et archive un arrêté de stock.
- **Relances** : au plus une relance par facture échue tous les 7 jours (`enqueue_notification`, dédoublonnage sur `template` + `entity_id`).
- **Registre des véhicules à moteur (AR n° 1 art. 28, M-88, 03/11)** : second registre légal à côté du registre VO (TVA marge). Tenu par le DMS (étude caisse D5) dans `vehicle_register`, exportable en **CSV** et **PDF** pour le comptable ou un contrôle ; **référence de facture au plus tard fin du mois suivant la sortie** (compteur dans la cloche). Codes de nature et tolérances à **confirmer par le comptable** (paramétrables, Paramètres → Tables). Conservation : art. 60 CTVA, **10 ans** depuis 2023 (les guides de 2018 disent 7 ans). Voir [M03](M03-vehicules.md) §4.

## 5. État en production
Vérifié le 18/09/2026 (code + base).
- **Tous les objets utilisés par le code existent en base** (tables, colonnes société, 20 fonctions ci-dessus). RLS active partout ; trigger d'audit `trg_acctentry_audit` sur `accounting_entries`.
- **Volumes** : 76 pièces / 223 lignes d'écriture générées, 2 exports tracés (un UBL, un Winbooks), 1 mandat SEPA, 0 clôture.
- **Paramètres société incomplets** : IBAN renseigné sur 1 société sur 2 ; **aucun n° de créancier SEPA** (le fichier pain.008 part alors avec un identifiant factice `BE00ZZZ000000000000`) ; **aucun identifiant Peppol**.
- **Falco** : pas de connecteur ; l'UBL est seulement téléchargé. Identifiants Falco attendus du client.
- **Relances** : la tâche `invoice-reminders` tourne (succès en base) ; les 13 notifications en file sont toutes `skipped` (pas de `RESEND_API_KEY`). Aucune relance n'est réellement partie.
- **Sécurité — grave** : plusieurs fonctions du module sont exécutables **sans être connecté** avec la clé publique du site, et leur garde laisse passer un appel anonyme :
  - en lecture (`auth.uid() is null or is_member(...)`) : `sales_journal`, `vat_register`, `vo_margin_register`, `debtors_list`, `pending_deposits`, `pending_effects`, `sepa_collectable` → chiffre d'affaires, débiteurs (noms, montants) lisibles ;
  - en écriture (`auth.uid() is not null and not is_member(...)` → exception) : `close_fiscal_year`, `set_accounting_cutover`, `generate_sales_entries`, `generate_payment_entries`, `generate_auxiliary_accounts`, `record_sepa_collection`, `record_sepa_unpaid`, `enqueue_notification` → un anonyme peut **clôturer une période**, **déplacer la date de bascule** ou **marquer une facture payée**.
  - Seule barrière : il faut connaître l'identifiant (UUID) de la société ou du document. Il n'est pas publié aujourd'hui, mais `shop_public_info` le renvoie à tout visiteur dès qu'une boutique M11 est publiée. Détail et correctif proposé : `00-architecture.md` §9.
- Les fonctions `_cron_invoice_reminders` et `_cron_appointment_reminders` sont elles aussi appelables anonymement (déclenchement d'envois de masse dès que Resend sera actif).

## 6. Prévu / en cours
- En attente client (`etat-projet.md` §8) : identifiants **Falco**, **fichier exemple du comptable** (gabarit Winbooks exact), IBAN.
- Reste noté dans `docs/avancement.md` (E11) : connecteur Falco live, validation Peppol fine, gabarit Winbooks exact.
- Rapprochement bancaire et numérisation des factures d'achat (COM001, COM002) : non planifiés.

## 7. Limites connues, dettes, pièges
- **TVA marge** : facture, registre et écritures concordent depuis le 03/11/2026 (M-89), **une fois la migration `20261103160000_m6_tva_marge_a_la_vente.sql` posée** (non appliquée au 03/11). À faire valider par le comptable : grilles, code TVA et journal Winbooks, comptes 700200 / 451090, OD de fin de période (débit ventes marge / crédit TVA sur marge), exclusion du stock initial des achats. Constat du 03/11 : 87 articles O en base dont 84 issus de la migration (stock initial), 53 factures G8 de motos O (2014 →, avant la bascule).
- **Registre TVA ordinaire et brouillons** (constaté le 03/11 pendant l'essai à blanc, non corrigé) : `vat_register` compte tout document FAC / TIK / AVO non annulé, **brouillons compris**.
- **Prix d'achat du registre VO** : `vo_margin_register` prend `articles.purchase_price` (et non le coût de revient avec l'ORO, B3). Pour une reprise, frais de remise en état exclus : à confirmer avec le comptable.
- **SEPA optimiste** : l'encaissement est enregistré dès la génération du fichier, avant tout retour de la banque ; les erreurs de `record_sepa_collection` sont ignorées dans la boucle (`sepa.ts`).
- **Winbooks** : colonnes provisoires ; format à caler dès réception du fichier du comptable.
- **Rôles** : le menu Comptabilité n'est affiché qu'aux rôles `admin` et `comptable`, mais les tables et fonctions ne contrôlent que l'**appartenance à la société** : tout membre (mécanicien, vendeur) peut appeler les fonctions comptables par l'API.
- **Écriture UBL** : identifiant Peppol du client toujours `null` ; client comptoir nommé « Client comptoir ».

## 8. Exigences du cahier couvertes
Référentiel : `docs/cahier-fonctionnel-v2.md`, annexe A (Comptabilité, 7 exigences).

| Code | Besoin | Statut | Preuve / manque |
|---|---|---|---|
| COM000 | Paramétrage du module | fait | `chart_of_accounts`, `account_mappings`, date de bascule, champs société |
| COM001 | Rapprochement et consolidation des paiements | partiel | Règlements et écritures de trésorerie ; pas d'import de relevé bancaire |
| COM002 | Numérisation et traitement auto des factures | manquant | Aucune lecture de factures d'achat |
| COM003 | Relances automatiques des impayés | partiel | `_cron_invoice_reminders` + file ; aucun envoi réel (Resend absent) |
| COM004 | Tableaux de bord et rapports personnalisés | partiel | Voir M13 ; éditions pré-clôture ici |
| COM005 | Multi-société ITALBIKE STORE + NL INVEST | fait | `_company` partout, 2 sociétés en base, plan comptable par société |
| COM006 | Régime TVA sur marge VO | fait, à valider | M-89 : facture sans TVA, base globale par période avec report, registre par véhicule, écritures et OD, exports CSV / Winbooks ; migration `20261103160000` à poser, comptable à consulter (§7) |

Invariants : **B2** partiel (registre VO fait, calcul à la vente et en écritures absent) ; **B7** respecté pour les écritures (append-only, audit).

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | Journal des ventes, registre TVA, export UBL, premier export Winbooks | `73d198c`, `20260610400000_m12_accounting.sql` |
| 2026-06-12 | Plan comptable PCMN + mapping paramétrable + auxiliaires | `b1bb48b`, `20260612120000_m12_chart_of_accounts.sql` |
| 2026-06-12 | Moteur d'écritures équilibrées | `92db68b`, `20260612130000_m12_entry_engine.sql` |
| 2026-06-12 | Export Winbooks au format Actage depuis les écritures | `2c0ae3f` |
| 2026-06-12 | TVA sur marge VO : registre + attestation | `db50e7a`, `20260612160000_m7_vo_margin.sql` |
| 2026-06-12 | Domiciliation SEPA pain.008 + mandats + impayés | `0558d73`, `20260612180000_m12_sepa_mandates.sql` |
| 2026-06-12 | Clôture d'exercice + éditions pré-clôture | `b266c10`, `20260612190000_m12_fiscal_closure.sql` |
| 2026-06-12 | Registre TVA incluant les factures migrées | `02b1ee4`, `20260612300000_m12_vat_register_header.sql` |
| 2026-06-12 | Date de bascule comptable | `a16d7a4`, `20260612310000_m12_accounting_cutover.sql` |
| 2026-06-12 | Relances factures planifiées | `20260612240000_m10_notifications.sql` |
| 2026-09-11 | Paramètres RPC corrigés, retour visuel | `7d31b6d`, `7f6ce22` |
| 2026-11-03 | **Registre des véhicules à moteur** (art. 28) : export CSV / PDF, alerte de facture à inscrire (M-88) | branche `lot-registre-vehicules`, migration `20261103190000_m3_registre_vehicules_moteur.sql` (**non appliquée**) |
| 2026-11-03 | **Registre de la marge par période** (B2, COM006, M-89) : base globale par période (ventes − achats + report), TVA due, registre par véhicule (avec avoirs), achats sous régime de la marge, vue `v_vo_margin_declaration`, export CSV et OD Winbooks, réglages « TVA marge (occasions) », registre TVA ordinaire sans les ventes marge, écritures au compte 700200 | branche `lot-tva-marge` ; `20261103160000_m6_tva_marge_a_la_vente.sql` **non appliquée** |
