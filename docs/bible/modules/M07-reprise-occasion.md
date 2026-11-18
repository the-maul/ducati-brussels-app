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
- **TVA sur marge** (B2, VEN006, COM006, art. 58 §4 CTVA, AR n° 53 ; décision **M-89** du 03/11/2026) : la facture d'une moto **O** ne porte **aucune TVA** (prix TTC = prix convenu, mention légale dans la langue du client, M6). Le **prix d'achat** du régime est le **prix de reprise seul** (`articles.purchase_price`, figé à la vente dans `documents.margin_purchase_price`) ; l'ORO (pièces, main-d'œuvre) n'y entre jamais : ce sont des achats ordinaires. La TVA due se calcule **globalement par période de déclaration** (M12, `vo_margin_periods`) : ventes marge − achats marge + report, marge négative reportée, TVA comprise dans la marge (× 21 / 121). Le registre **par véhicule** (`vo_margin_register`, ventes FAC / TIK et avoirs AVO) montre une marge **indicative**. Un **achat sous régime de la marge** = la première entrée en stock d'une moto O (validation de la reprise) ; le stock initial repris de G8 / Shopify n'en est pas un (à confirmer par le comptable). Impossible de facturer une O sans prix de reprise. Type **P** = TVA 21 % normale, hors registre. La **rentabilité B3** (`PV − (reprise + ORO + frais)`, fiche VIN) est une autre notion, inchangée.
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

- **Registre des véhicules à moteur (AR n° 1 art. 28, M-88, 03/11)** : la **validation** d'une reprise (la fiche passe `repris` → `stock_vo`) inscrit l'entrée de la moto (code 4, vendeur = premier propriétaire) ; l'annulation inscrit la sortie « moto rendue » ; la vente inscrit la sortie et la facture. Le **dépôt-vente** inscrit l'entrée à sa création (code 4), la sortie à la vente (facture) ou à la **restitution** (sans document). Voir [M03](M03-vehicules.md) §4.

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
- **Registre TVA marge** : refait le 03/11/2026 (M-89, migration `20261103160000` **non appliquée**) : prix de reprise figé sur la facture, avoirs pris en compte, base globale par période avec report, tests `tests/tva-marge.test.ts`. Reste à faire valider par le comptable (grilles, code TVA Winbooks, stock initial). Les 53 factures G8 de motos O (2014 →) ne sont pas dans le registre de la marge : déjà déclarées dans G8.
- **Fuite possible du registre** : `vo_margin_register` saute le contrôle de société quand l'appelant n'est pas connecté (`auth.uid() is null`). Si l'exécution est ouverte au rôle `anon` (audit Supabase, `etat-projet.md` §5), le registre VO d'une société (VIN, prix, marges) est lisible sans connexion. Idem `settle_consignment` en écriture. **À vérifier en priorité.** La migration `20261103160000` retire l'exécution à `anon` pour `vo_margin_register`, `vo_margin_purchases` et `vo_margin_periods` (pas encore pour `settle_consignment`).
- **Dépôt-vente minimal** : aucun article D ni fiche véhicule créés, n° saisi à la main, pas de statut « restitué » dans l'écran, `settle_consignment` ne vérifie pas que le dépôt est encore `en_depot` (un second règlement écrase le premier), la commission n'est ni facturée ni ventilée en TVA. Écran sans entrée de menu.
- **ORO et reprise confondus** dans la table `oro` : il n'est pas possible d'ouvrir un ORO sur une occasion achetée hors reprise, ni plusieurs ORO pour une même moto depuis l'écran (le calcul SQL, lui, les additionne).
- ~~La vente d'une occasion ne passe pas la moto en « vendu »~~ — **corrigé le 23/09** (M-37, déclencheur sur `stock_moves`, voir M03 §4).
- Les tables récentes sont appelées par un client non typé (`supabase as any`) : les fautes de colonnes ne sont pas détectées à la compilation.

## 8. Exigences du cahier couvertes

| Code | Libellé court | État | Preuve |
|---|---|---|---|
| VEN006 / COM006 | TVA sur marge des VO | 🟦 fait, à valider | M-89 : vente sans TVA, registre par véhicule et par période (`20261103160000`, non appliquée), attestation PDF (`attestation-pdf.ts`), tests `tests/tva-marge.test.ts` ; validation comptable à faire |
| VEN007 | Référencement auto occasions / dépôt-vente avec préfixe | 🟦 partiel | reprises en `REP-` (séquence) et article occasion à la même référence ; `OCC-`/`DEP-` non utilisés, dépôt-vente numéroté à la main |
| VEN008 | Reprise + dépôt-vente avec suivi des commissions | 🟦 partiel | reprise complète dans le code mais suivi inopérant en production (§5) ; dépôt-vente minimal (§7) |
| VEN016 | Portail web de demande de reprise (phase 2) | ⬜ manquant | assistant interne uniquement |
| VEH006 | Rentabilité par véhicule | 🟦 partiel | coût de revient + marge potentielle sur `/tradein/$oroId` ; pas de marge réalisée ni de vue par VIN |
| DOC005 | Fiche de reprise digitale | ✅ fait | `reprise-pdf.ts`, `validation-pdf.ts`, assistant |
| B2 | TVA marge + registre VO | 🟦 fait, à valider | régime de la marge à la vente, base globale par période, 17 tests ; migration à poser |
| B3 | Flux reprise → article O/P + véhicule + ORO | 🟦 partiel | fonctionne jusqu'à l'entrée en stock ; suivi par poste (§5) ; non atomique |
| Angle mort « ORO / imputation au coût de revient » | | ✅ fait | `addOroLine` + `recompute_oro_and_vehicle` |
| Angle mort « cessions internes typées » | | ✅ fait | voir M05 |

## Ajouté le 18/11 — rattrapage G8 : cessions internes / O.R.O en document

> Lot `lot-g8-cessions`. Sources G8 : `docs/g8-inventaire/07-atelier.md` §10 et §15, `03-vehicules.md`
> (reprise → cession automatique), `parcours.md` n° 10. Migration `20261118240000_m7_cessions_internes.sql`
> (**non appliquée**), essai à blanc `supabase/tests/m7_cessions_internes.sql` (20 contrôles « ok »).

**Décision de Simon (18/11/2026)** : le coût des pièces d'une remise en état / cession interne est
**au PAMP par défaut** ; on peut choisir **le dernier prix d'achat** (réglage de la société et, sur chaque
cession, la liste « Valorisation des pièces »). Dernier prix d'achat = coût unitaire de la dernière entrée
valorisée du stock (réception), à défaut le PA de la fiche article. Repli : sans PAMP on prend le PA, et
inversement.

**Ce qui existe maintenant**

| Écran | Ce qu'on y fait |
|---|---|
| Stock → Cessions internes (`/stock/cessions`, aussi bouton « Cessions internes / O.R.O » de l'Atelier) | Onglets **Documents** (en cours, validées, archivées, annulées ; recherche n° / client / châssis / plaque / référence ; type ; période), **Par rayon** (quantité, HT au PAMP, HT à la vente), **Détaillées** (référence, désignation, quantité, HT PAMP, HT vente, moto / client, châssis, type, n°), **Mouvements** (ancien journal des mouvements « cession »), **Réglages** ; export CSV ; **Nouvelle cession**. |
| Document (`/stock/cessions?doc=<id>`) | Type de cession (comptabilisée ou non, compte, journal), opérateur (équipe), moto (n° de série, facultative), client = dernier propriétaire connu, valorisation PAMP / dernier PA, travaux, note interne ; lignes **pièce** (au PAMP ou PA, PV HT noté, TVA 0), **main-d'œuvre** (heures internes valorisées à l'article de MO ou au coût horaire interne, heures passées, mécanicien, bouton « Pointeuse »), **frais**, **texte** ; **pointer sur cette cession** (pointeuse) ; **Valider** → fenêtre **prix de revient** ; archiver / désarchiver ; annuler (ouverte seulement) ; **impression** cession + fiche de travail, en PAMP / prix de vente / prix d'achat, coordonnées de l'ancien propriétaire en option. |
| Reprises → dossier (`/tradein/$oroId`) | Le formulaire de lignes d'ORO est remplacé par le panneau **Remise en état (cessions)** de la moto (liste, montant imputé, historique du coût de revient, nouvelle remise en état). Les anciennes lignes d'ORO restent affichées (et comptées) si elles existent. |
| Paramètres → Tables | « Types de cession interne » : + **compte de cession** et **journal** ; nouvelle table « Cessions internes — réglages » (`cession_settings`). |

**Règles**
- **Coût de revient de la moto** = prix d'achat / reprise + anciennes lignes d'ORO + cessions **comptabilisées
  validées** (total + options). Un seul calcul (`_vehicle_cost_recompute`), appelé à la validation d'une
  cession, par `recompute_oro_and_vehicle`, et quand le prix d'achat change ou que la moto entre en stock
  occasion. Chaque changement : une ligne **append-only** dans `vehicle_cost_changes` (ancien, delta, nouveau,
  source) + un `events` « cout_de_revient ». Une cession **non comptabilisée** (ex. 03 besoin atelier) sort
  le stock sans toucher au coût de revient.
- **Fenêtre prix de revient** (miroir de G8) : prix brut (PV conseillé HT / TTC, prix d'achat, marge PA) ;
  prix net = ancien prix de revient + cession actuelle + autres cessions + options = nouveau prix de revient ;
  marge sur prix de revient (€ et % du PV HT) ; prix de vente client HT / TTC (simulé, il se modifie sur la
  fiche moto). Règles pures : `src/modules/tradein/cessions/rules.ts` (`computeCostWindow`), tests
  `tests/cessions-prix-de-revient.test.ts` (PAMP et PA, exemple G8 5 000 → 5 028,95).
- **Validation** (`validate_internal_cession`) : revalorise les lignes d'article aux valeurs du jour, sort
  du stock les pièces de type A (`record_stock_move`, type `cession`, origine `cession`, réf. = n°), fige
  les totaux (coût, PAMP, PA, vente) et le document (plus aucune ligne ni changement de statut à la main).
- **Automatismes** (réglages `cession_settings`) : à la validation d'une reprise (moto « Demande de
  reprise » → stock occasion), une cession du type `reprise_cession_type` (01 Cession VO) s'ouvre d'office
  (`auto_open_on_reprise`) ; à la vente de la moto (statut vendu / livré), ses cessions ouvertes et
  validées passent en archives (`auto_archive_on_sale`), désarchivables. Un échec de l'ouverture
  automatique ne bloque jamais la reprise (trace `events` « cession_auto_echec »).
- **Numérotation** : séquence `ORO` (préfixe ORO-), commune à tous les types de cession (G8 : même
  compteur que les OR).
- **Pointeuse** : `workshop_time_entries.cession_id` ; « Pointer sur cette cession » clôt le pointage de
  travail en cours (même règle que la pointeuse) ; `cession_worked_minutes` donne les heures passées.

**Où** : `src/modules/tradein/cessions/` (`rules.ts`, `api.ts`, `print.ts`, `cessions-screen.tsx`,
`cession-document.tsx`, `cession-cost-dialog.tsx`, `cession-new-dialog.tsx`, `vehicle-cessions-panel.tsx`) ;
route `src/routes/_app.stock.cessions.tsx` ; tables `internal_cessions`, `internal_cession_lines`,
`vehicle_cost_changes` ; RPC `open_internal_cession`, `add_internal_cession_line`,
`set_internal_cession_cost_basis`, `validate_internal_cession`, `archive_internal_cession`,
`unarchive_internal_cession`, `cancel_internal_cession`, `internal_cession_cost_context`,
`internal_cession_report`, `cession_worked_minutes`, `article_last_purchase_price`.

**Pas fait dans ce lot** : onglets « Garanties » et « Garanties / CA » de la liste G8 (lot OR garantie) ;
cession automatique à la création d'un dépôt-vente (décisions en attente) ; annulation d'une cession
**validée** (retour en stock + baisse du coût) ; productivité « temps cessions internes » (lot statistiques,
qui peut lire `workshop_time_entries.cession_id` et `internal_cession_lines.hours_spent`) ; panneau des
cessions sur la fiche moto (composant `VehicleCessionsPanel` prêt, à monter par le lot parc) ; écritures
comptables des cessions (compte / journal saisis, aucun export).

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
| 2026-11-03 | **Registre des véhicules à moteur** : reprise validée et dépôt-vente inscrits à l'entrée, vente / restitution à la sortie (M-88) | branche `lot-registre-vehicules`, migration `20261103190000_m3_registre_vehicules_moteur.sql` (**non appliquée**) |
| 2026-11-03 | **TVA sur la marge à la vente** (B2, M-89) : vente d'une O sans TVA, prix de reprise seul figé sur la facture, registre par véhicule (ventes et avoirs) et TVA due globale par période (M12) ; rentabilité B3 inchangée | branche `lot-tva-marge` ; `20261103160000_m6_tva_marge_a_la_vente.sql` **non appliquée** |
| 2026-11-18 | **Cessions internes / O.R.O en document** (rattrapage G8) : document multi-lignes sur une moto, pièces au PAMP (défaut) ou au dernier PA, MO en heures internes reliée à la pointeuse, fenêtre prix de revient, coût de revient append-only, cession VO ouverte à la reprise, archivage à la vente, listes par rayon / détaillées / archives, impression PAMP / PV / PA | branche `lot-g8-cessions`, `20261118240000_m7_cessions_internes.sql` **non appliquée** |
