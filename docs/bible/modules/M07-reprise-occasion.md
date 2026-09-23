---
chapitre: M07
titre: Reprise / Occasion / Dépôt-vente
etat: 🔴
verifie_le: 2026-09-18
missions: []
mots_cles: [reprise, REP, occasion, VO, ORO, remise en état, coût de revient, marge, rentabilité par VIN, TVA marge, registre VO, attestation TVA marge, particulier, professionnel, type O, type P, type D, dépôt-vente, commission, reversement, marchands partenaires, offres, appel d'offres, statut de reprise, assistant mobile, photos]
---

# M07 — Reprise / Occasion / Dépôt-vente

> **En une phrase** : racheter la moto d'un client (ou la prendre en dépôt-vente), la remettre en état en imputant chaque pièce et chaque heure à son coût de revient, puis la revendre en TVA sur marge, pour connaître la rentabilité réelle de chaque VIN.

## 1. À quoi ça sert
Le vendeur ouvre une **reprise** depuis un assistant pensé pour tablette et smartphone (particulier ou
professionnel, fiche client, données de la moto, photos). Le dossier `REP-AAAA-NNNNN` sert d'**appel d'offres** :
il est diffusé par mail aux **marchands partenaires**, dont on note les offres. Quand le client accepte une offre
puis que la moto est réceptionnée, la **validation** (checklist, vérification du vendeur + attestation TVA marge
signée, montants et classement) crée l'article occasion (type O en TVA marge, type P à 21 %), l'entrée en stock
valorisée et passe la moto en stock occasion. Les **lignes de remise en état** (pièces, main-d'œuvre, frais)
s'ajoutent au coût de revient du véhicule, jamais en charge atelier. Le module gère aussi un **dépôt-vente**
simple (commission et reversement). Le **registre TVA marge** est dans l'écran Comptabilité (M12).

## 2. Ce qu'on a aujourd'hui

Menu latéral : **Reprises motos clients** (`/tradein`). Le dépôt-vente (`/consignment`) **n'a pas d'entrée de menu**.

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Reprises motos clients → liste (`/tradein`) | Dossiers avec n°, client, moto, date de création, **statut** (Collecté → Envoyé → Accepté → Repris, ou Annulé) avec date/heure du changement, nombre d'offres et meilleure offre ; recherche ; filtres statut et période ; changement manuel de statut ; saisie rapide de l'offre acceptée ; annulation ; bouton Marchands partenaires. |
| Reprises motos clients → Nouvelle reprise (`/tradein/new`) | **Assistant en étapes** : type (particulier / professionnel) → déjà client ? → retrouver ou créer la fiche → données de la moto (pré-remplissage depuis le parc, caractéristiques automatiques, usure détaillée, prix souhaité) → photos et documents → envoi. L'envoi crée la fiche véhicule en statut « Demande de reprise », le lien vendeur, le dossier REP-, téléverse les photos en GED, trace un échange sur la fiche client, crée une carte CRM (source « Reprise ») et ouvre la diffusion aux marchands (lien mail). |
| Reprises motos clients → dossier (`/tradein/$oroId`) | **Fiche de reprise** : reprise, remise en état, **coût de revient**, **marge potentielle** ; lignes de remise en état (pièce en stock, main-d'œuvre, frais) avec ajout/suppression ; clôture de l'ORO ; offres des marchands (ajout, meilleure offre) ; diffusion et **relance** des marchands par mail ; **offre acceptée** ; **Valider la reprise** (3 étapes, attestation TVA marge PDF signée) ; modification à tout moment ; annulation (sortie de stock si déjà validée) ; photos (galerie, retouche, ordre) ; PDF fiche de reprise anonymisée ; facture d'achat pour une reprise professionnelle. |
| Reprises motos clients → Marchands partenaires (`/tradein/partners`) | Fiches marchands (nom, société, mails et téléphones supplémentaires, marques suivies), actif/inactif, mode d'envoi `auto` / `semi_auto`. |
| (URL directe) Dépôt-vente (`/consignment`) | Nouveau dépôt (déposant, n° saisi à la main, prix convenu TTC, commission %), liste, **Régler la vente** (commission + reversement calculés). |
| Stock → Cessions internes (`/stock/cessions`) | Voir M05. |
| Comptabilité → Registre TVA marge (`/accounting`, admin/comptable) | Registre VO chronologique des ventes d'articles O, résumé pour la déclaration, export CSV (M12). |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.tradein.tsx`, `_app.tradein.index.tsx`, `_app.tradein.new.tsx`, `_app.tradein.$oroId.tsx`, `_app.tradein.partners.tsx`, `_app.consignment.tsx` ; registre dans `_app.accounting.tsx` |
| Logique métier | `src/modules/tradein/` : `write-api.ts` (création de la demande, lignes d'ORO, clôture), `validate-api.ts` (validation, annulation, statuts, offre acceptée, **repli localStorage**), `validate-data.ts`, `validate-dialog.tsx`, `accept-offer-dialog.tsx`, `reprise-status.ts` / `reprise-status-badge.tsx`, `partners-api.ts` / `partners-dialog.tsx`, `reprise-wizard.tsx` / `reprise-wizard-data.ts`, `reprise-edit-dialog.tsx`, `reprise-photos-panel.tsx`, `reprise-notes.ts`, `moto-specs.ts`, `sheet-builder.ts`, `reprise-pdf.ts`, `reprise-print.ts`, `validation-pdf.ts`, `attestation-pdf.ts`, `api.ts` (lectures, dépôt-vente) ; `src/modules/crm/api.ts` (`createLead`, `syncLeadRepriseStatus`) ; `src/modules/accounting/api.ts` (registre TVA marge) ; mention TVA marge sur facture : `src/modules/sales/print-document.ts` |
| Tables | `oro` (**dossier de reprise et ORO confondus** : n° REP-, véhicule, statut, coût total + colonnes de validation et de workflow — voir §5), `oro_lines` (pièces / MO / frais imputés), `consignments` (dépôt-vente), `tradein_partners`, `tradein_offers` (voir §5) ; écrit aussi `vehicles`, `vehicle_owners`, `articles`, `stock_moves`, `leads`, `communications` |
| Fonctions SQL (RPC) | `recompute_oro_and_vehicle` (total ORO + `vehicles.cost_price`), `record_stock_move`, `article_stock`, `next_document_number` (séquence `REP`), `settle_consignment`, `stock_value_owned`, `vo_margin_register`, `vo_margin_summary` |
| Fonctions serveur (Edge) | aucune (la diffusion aux marchands passe par un lien `mailto:` du poste) |
| Tâches planifiées | aucune |
| Migrations clés | `supabase/migrations/20260610330000_m7_oro.sql`, `20260612160000_m7_vo_margin.sql`, `20260612230000_m7_consignment.sql`, `20260716090000_m7_tradein_partners.sql`, `20260719120000_m7_tradein_validation.sql`, `20260720090000_m7_reprise_workflow.sql` |
| Tests | `tests/tradein-validate.test.ts`, `tests/reprise-status.test.ts`, `tests/reprise-wizard.test.ts`, `tests/reprise-wished.test.ts`, `tests/reprise-notes.test.ts` (logique pure ; aucun test SQL de la TVA marge ni de l'imputation ORO) |
| Libellés | `src/lib/i18n/fr.ts`, blocs `tradein`, `consign` |

## 4. Règles métier et décisions

- **Flux de reprise** (B3) : reprise (réf. `REP-`) → article occasion O/P + fiche véhicule + ORO dont pièces et MO s'imputent au **coût de revient**. **Décision du 19/07/2026** (commit `b7ed89c`) : la création ne fait plus entrer la moto en stock ; elle devient un **appel d'offres**. L'article et l'entrée de stock ne sont créés qu'à la **validation**. L'annulation d'une reprise validée écrit une sortie de stock inverse (B7), et une re-validation ré-entre la moto.
- **Statuts de reprise** (commit `1550ca5`) : `collecte` → `envoye` (diffusion aux marchands) → `accepte` (offre acceptée par le client : montant, miroir de la meilleure offre, marchand à facturer) → `repris` (validation) ; `annule` hors flux. Le passage à « Envoyé » est automatique à la diffusion et ne recule jamais ; le changement manuel est libre. Le statut est recopié sur la carte CRM liée (`leads.reprise_status`).
- **Validation en 3 étapes** : (1) checklist « l'acheteur confirme avoir reçu », (2) vérification du client + **attestation TVA marge** signée (modèle sectoriel belge, PDF), (3) montants (prix d'achat TTC/HT, prix de vente, prix minimum avec alerte) et classement fournisseur / rayon / sous-rayon / catégorie. Occasion particulier → type **O**, classée `08-01-01`, coût = prix TTC ; professionnel → type **P**, `08-02-01`, coût = prix HT (`stockUnitCost`).
- **Coût de revient** (glossaire) = `prix de reprise + Σ ORO` (`recompute_oro_and_vehicle`). Une ligne « pièce » liée à un article sort la pièce du stock en **cession** (origine `oro`), pas en vente. Marge potentielle affichée = prix de vente − coût de revient.
- **TVA sur marge** (B2, VEN006, COM006, art. 58 §4 CTVA) : pour les articles **O** vendus (FAC, TIK non annulés), marge = max(PV TTC − PA, 0) ; TVA marge = marge × 21/121 ; base = marge / 1,21. Le **PA** est `articles.purchase_price` (prix de reprise, sans l'ORO). Type **P** = TVA 21 % normale, hors registre. La facture d'une vente O porte la mention légale du régime de la marge. Décision client (CLAUDE.md §5) : le comptable corrige après coup, tout doit rester paramétrable et auditable.
- **Dépôt-vente** (type D, glossaire) : le véhicule reste la propriété du déposant et **n'entre pas** dans la valeur de stock (`stock_value_owned` exclut D). À la vente : commission (% du prix TTC ou montant fixe) et reversement = prix − commission.
- **Depuis le 23/09 (décision M-36, mission 03)** : une moto au statut de parc « Dépôt-vente »
  (`depot_vente`, `depot_agent`) reçoit **bien un article de type D** et une entrée de stock de 1
  **sans valeur** (`vehicle_ensure_article`, M03) — 7 motos en production. L'écran `/consignment`
  (dépôt-vente « simple », sans article ni véhicule) n'est pas relié à ce flux : les deux coexistent,
  à unifier dans une carte dédiée.
- **Vente d'une occasion** : depuis le 23/09, la facturation passe la moto en « Vendu », inscrit
  l'acheteur dans `vehicle_owners` et dépublie l'article (déclencheur `trg_moto_sortie_de_stock`,
  M03 §4). Le point « la vente d'une occasion ne passe pas la moto en vendu » de §7 est corrigé.
- **Numérotation** : séquence `REP` par société ; les préfixes `ORO-`, `OCC-` et `DEP-` prévus par CLAUDE.md §4.3 **ne sont pas utilisés** (l'ORO est le dossier REP lui-même ; l'article occasion prend la référence REP ; le n° de dépôt-vente est saisi à la main).
- **Multi-société + audit** : `company_id` + RLS `is_member` sur toutes les tables (lignes d'ORO via l'en-tête) ; triggers `audit_row` sur `oro`, `oro_lines`, `consignments`.

## 5. État en production

Vérifié le 18/09/2026 **dans le code uniquement** : le connecteur Supabase n'était pas authentifié pendant la
session. Constats base repris de la vérification du **14/09** (`etat-projet.md` §2), recoupés par :
`types.ts` **regénéré depuis la base le 11/09** (commit `7d31b6d`, qui cite « trois migrations jamais appliquées »)
et mis à jour le 18/09 sans aucun de ces objets ; aucune migration de rattrapage dans le dépôt depuis.

**Objets utilisés par le code et absents de la base au 14/09 (à revérifier colonne par colonne)** :

| Migration | Objets | Effet réel, d'après le code |
|---|---|---|
| `20260716090000_m7_tradein_partners` | tables `tradein_partners`, `tradein_offers` ; `companies.tradein_dispatch_mode` | Liste des marchands **vide** (bandeau « tables non installées ») ; **ajout d'un marchand ou d'une offre en erreur** ; mode d'envoi mémorisé dans le navigateur du poste. |
| `20260719120000_m7_tradein_validation` | `oro.tradein_status`, `checklist`, `seller_vat_status`, `attestation`, `vat_rate`, `buy_price_ttc`, `buy_price_ht`, `sale_price`, `min_sale_price`, `classification`, `validated_at`, `cancelled_at` | Statut, checklist, attestation, montants et classement **enregistrés uniquement dans le navigateur du poste** (localStorage, `validate-api.ts`). Un autre poste voit « Collecté » (ou « Repris » si la moto est en stock occasion avec un article). Le commentaire du code qui qualifie ces colonnes de « déjà migrées » contredit le constat du 14/09 : à trancher en base. |
| `20260720090000_m7_reprise_workflow` | `oro.dispatched_at`, `accepted_amount`, `best_offer_amount`, `invoice_partner_name`, `accepted_at` ; `leads.oro_id`, `leads.reprise_status` | Offre acceptée et dates de statut **locales au poste** ; la carte CRM est créée **sans lien** vers la reprise (repli de `createLead`) et son étiquette de statut ne se met jamais à jour. |

**Ce qui fonctionne malgré tout** (colonnes d'origine présentes) : créer une demande de reprise (véhicule,
lien vendeur, dossier REP-, photos, carte CRM) ; **valider** une reprise, qui crée bien l'article O/P, l'entrée de
stock valorisée et passe la moto en `stock_vo` ; lignes d'ORO et coût de revient ; annulation avec sortie de
stock ; dépôt-vente ; registre TVA marge. Ce qui est **perdu ou isolé par poste** : tout le suivi (statuts,
offres, marchands, attestation, montants de validation).

Requête de contrôle (lecture seule) :
```sql
select to_regclass('public.tradein_partners'), to_regclass('public.tradein_offers');
select column_name from information_schema.columns
 where table_schema='public' and table_name='oro'
   and column_name in ('tradein_status','checklist','seller_vat_status','attestation','vat_rate','buy_price_ttc',
     'buy_price_ht','sale_price','min_sale_price','classification','validated_at','cancelled_at',
     'dispatched_at','accepted_amount','best_offer_amount','invoice_partner_name','accepted_at');
select column_name from information_schema.columns
 where table_schema='public' and ((table_name='leads' and column_name in ('oro_id','reprise_status'))
   or (table_name='companies' and column_name='tradein_dispatch_mode'));
select count(*) from public.oro;
select has_function_privilege('anon', 'public.vo_margin_register(uuid, date, date)', 'execute');
```


> **Vérifié en base le 18/09/2026** (requête sur `information_schema`) : toujours **absents** — les tables `tradein_partners` et `tradein_offers`, `companies.tradein_dispatch_mode`, `leads.oro_id`, `leads.reprise_status`, et dans `oro` les 17 colonnes `tradein_status`, `checklist`, `seller_vat_status`, `attestation`, `vat_rate`, `buy_price_ttc`, `buy_price_ht`, `sale_price`, `min_sale_price`, `classification`, `validated_at`, `cancelled_at`, `dispatched_at`, `accepted_amount`, `best_offer_amount`, `invoice_partner_name`, `accepted_at`. Les migrations correspondantes du dépôt n'ont jamais été appliquées. Tant qu'elles ne le sont pas, les champs concernés sont perdus sans avertissement.

## 6. Prévu / en cours
- **Appliquer les trois migrations M7** (`etat-projet.md` §7 « À reprendre — Réparations », après véhicules et articles), puis vérifier objet par objet. Après application, les données restées dans le navigateur d'un poste **ne remontent pas seules** : il faut ré-enregistrer chaque dossier depuis le poste qui l'a saisi.
- Restes de l'Epic E6 (`docs/avancement.md`) : reprise depuis le POS (réf. REP en caisse).
- Portail public de demande de reprise (VEN016, phase 2) : l'assistant est « réutilisable sur le site » d'après son en-tête, mais aucune route publique n'existe.
- Envoi réel des mails aux marchands (aujourd'hui `mailto:`), possible via `graph-send-email` (M10).
- Pas de dossier `docs/missions/` à ce jour.

## 7. Limites connues, dettes, pièges
- **Repli localStorage = données invisibles et fragiles** : effacer le navigateur ou changer de poste fait perdre le suivi d'une reprise. Ne pas ajouter d'autres replis de ce type.
- **Validation non atomique** : insertion de l'article, mouvement de stock, mise à jour du véhicule puis métadonnées sont quatre appels successifs depuis le navigateur. Une coupure au milieu laisse un article sans stock ou une moto en stock sans statut « Repris ».
- **Le PAMP de l'article occasion est écrit directement** à l'insertion (`pamp: unitCost`), en plus de l'entrée de stock qui le recalcule : deux chemins d'écriture du PAMP (B5).
- **Le coût de revient reste modifiable à la main** sur la fiche véhicule (M03) et `acceptRepriseOffer` écrase `vehicles.purchase_price` avec le montant accepté sans recalculer `cost_price`.
- **Registre TVA marge** : prend `articles.purchase_price` (prix de reprise) ; suppose un seul article O par ligne et un PV TTC par ligne ; ne gère pas les avoirs. Aucun test automatisé alors que la règle 7 l'exige. À faire valider par le comptable.
- **Fuite possible du registre** : `vo_margin_register` saute le contrôle de société quand l'appelant n'est pas connecté (`auth.uid() is null`). Si l'exécution est ouverte au rôle `anon` (audit Supabase, `etat-projet.md` §5), le registre VO d'une société (VIN, prix, marges) est lisible sans connexion. Idem `settle_consignment` en écriture. **À vérifier en priorité.**
- **Dépôt-vente minimal** : aucun article D ni fiche véhicule créés, n° saisi à la main, pas de statut « restitué » dans l'écran, `settle_consignment` ne vérifie pas que le dépôt est encore `en_depot` (un second règlement écrase le premier), la commission n'est ni facturée ni ventilée en TVA. Écran sans entrée de menu.
- **ORO et reprise confondus** dans la table `oro` : il n'est pas possible d'ouvrir un ORO sur une occasion achetée hors reprise, ni plusieurs ORO pour une même moto depuis l'écran (le calcul SQL, lui, les additionne).
- ~~La vente d'une occasion ne passe pas la moto en « vendu »~~ — **corrigé le 23/09** (M-37, déclencheur sur `stock_moves`, voir M03 §4).
- Les tables récentes sont appelées par un client non typé (`supabase as any`) : les fautes de colonnes ne sont pas détectées à la compilation.

## 8. Exigences du cahier couvertes

| Code | Libellé court | État | Preuve |
|---|---|---|---|
| VEN006 / COM006 | TVA sur marge des VO | 🟦 partiel | `20260612160000_m7_vo_margin.sql`, mention sur facture (`print-document.ts`), attestation PDF (`attestation-pdf.ts`) ; non testé, validation comptable à faire |
| VEN007 | Référencement auto occasions / dépôt-vente avec préfixe | 🟦 partiel | reprises en `REP-` (séquence) et article occasion à la même référence ; `OCC-`/`DEP-` non utilisés, dépôt-vente numéroté à la main |
| VEN008 | Reprise + dépôt-vente avec suivi des commissions | 🟦 partiel | reprise complète dans le code mais suivi inopérant en production (§5) ; dépôt-vente minimal (§7) |
| VEN016 | Portail web de demande de reprise (phase 2) | ⬜ manquant | assistant interne uniquement |
| VEH006 | Rentabilité par véhicule | 🟦 partiel | coût de revient + marge potentielle sur `/tradein/$oroId` ; pas de marge réalisée ni de vue par VIN |
| DOC005 | Fiche de reprise digitale | ✅ fait | `reprise-pdf.ts`, `validation-pdf.ts`, assistant |
| B2 | TVA marge + registre VO | 🟦 partiel | registre et mentions faits ; tests manquants |
| B3 | Flux reprise → article O/P + véhicule + ORO | 🟦 partiel | fonctionne jusqu'à l'entrée en stock ; suivi par poste (§5) ; non atomique |
| Angle mort « ORO / imputation au coût de revient » | | ✅ fait | `addOroLine` + `recompute_oro_and_vehicle` |
| Angle mort « cessions internes typées » | | ✅ fait | voir M05 |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | Reprise flux B3 + ORO (article O/P + véhicule + entrée stock + ORO ; imputation au coût de revient) | `df40a20`, `20260610330000_m7_oro` |
| 2026-06-12 | TVA sur marge : registre + attestation PDF | `db50e7a`, `20260612160000_m7_vo_margin` |
| 2026-06-12 | Dépôt-vente type D, commission, reversement | `1ac7aa2`, `20260612230000_m7_consignment` |
| 2026-07-17 | Assistant mobile complet (parcours 1-14), REP-AAAA-NNNNN, PDF anonymisé, marchands, relance | `1c326e3`, `3dbc2a0`, `6ccbba7`, `20260716090000_m7_tradein_partners` (non appliquée au 14/09) |
| 2026-07-19 | **Refonte** : appel d'offres puis validation en 3 étapes avant entrée en stock | `b7ed89c`, `20260719120000_m7_tradein_validation` (non appliquée au 14/09) |
| 2026-07-19 | Workflow Collecté → Envoyé → Accepté → Repris, offre acceptée, synchro CRM, filtres | `1550ca5`, `f312a06`, `f716cc5`, `20260720090000_m7_reprise_workflow` (non appliquée au 14/09) |
| 2026-08-01 | Usure détaillée, galerie photos avec retouche, PDF allégé, édition à tout moment | `777d0f8` |
| 2026-09-14 | Constat : tout le chantier reprises est « complet dans le code et mort en production » | `docs/etat-projet.md` §2 |
| 2026-09-23 | **Mission 03, « Motos à vendre »** (M-36) : article de type **D** créé pour les motos en dépôt-vente, vente → moto vendue + nouveau propriétaire + dépublication | branche `lot-motos`, migrations `20260923150000` + `20260923151000` (appliquées le 23/09) |
