---
chapitre: M6
titre: Ventes & caisse
etat: 🟦
verifie_le: 2026-09-18
missions: []
mots_cles: [devis, facture, ticket, avoir, réservation, bon de livraison, acompte, règlement, caisse, POS, clôture Z, fond de caisse, détaxe, TVA marge, picking list, remise, net forcé, encours]
---

# M6 — Ventes & caisse

> **En une phrase** : tout ce qui sort de la concession contre paiement — devis, réservations, bons de livraison, factures, tickets de caisse et avoirs — avec l'encaissement et la clôture de caisse du jour.

## 1. À quoi ça sert
Le vendeur, le magasinier au comptoir et le comptable l'utilisent pour établir les documents de vente
(du devis jusqu'à la facture), encaisser les règlements (plusieurs modes, acomptes, paiements différés)
et fermer la caisse le soir (comptage du tiroir, journal Z). Chaque document validé fait bouger le stock
de façon traçable. L'atelier (M8) passe par ce module pour transformer un OR en facture, et la compta
(M12) lit ses documents pour produire journaux, registre TVA et exports.

## 2. Ce qu'on a aujourd'hui

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Ventes & Facturation → liste (`/sales`) | Liste des 100 derniers documents de la société ; filtres type, département (magasin / e-shop), contenu (VN / VO / dépôt-vente / sans véhicule), dates, type de client, recherche n° ou client ; pastille de disponibilité du stock par document (B4) ; colonne acompte / solde ; actions rapides imprimer, dupliquer (en brouillon), supprimer (brouillons seulement) ; **purge des devis** antérieurs à une date |
| Ventes → Nouveau document (`/sales/new`) | Éditeur FAC / DEV / TIK / BL / RES : client, véhicule, lignes article ou texte libre, TVA et remise par ligne ; **pied de facture** : mode HT/TTC, remise globale % ou €, **détaxe export** (TVA 0 %), frais de port taxés ou non, **net TTC forcé** ; enregistrement en brouillon ou validation (numéro attribué à la validation) |
| Ventes → fiche document (`/sales/$documentId`) | Consultation, **règlements** (multi-modes, espèces avec rendu de monnaie, règlement « à échéance » puis « marquer perçu »), **acomptes** sur réservation, **conversion** DEV→FAC/RES/BL, RES→FAC/BL, BL→FAC (acomptes reportés, réservation libérée), **générer un avoir** depuis une facture, **imprimer** (mise en page facture G8), **export UBL** (FAC/AVO numérotés, voir M12), **envoi par e-mail** (Outlook) ou **SMS** (file d'attente), pièces jointes GED |
| Caisse → Vente comptoir (`/pos`, onglet 1) | Scan ou recherche d'article → panier → encaisser → ticket (type TIK, stock réel débité) |
| Caisse → Caisse & clôture Z (`/pos`, onglet 2) | Ouvrir une session avec fond de caisse, entrées/sorties d'argent motivées, **journal Z** (encaissements par mode, ventes / acomptes / avoirs, ventilation TVA), **comptage du tiroir par coupure** (500 € → 0,01 €) avec écart théorique / compté, historique des sessions |
| Picking list (`/picking`) | Préparation de commande client : créer une liste depuis un document de vente ou vide, localisation (Buanderie, G.ET.C, P.ET.C, ET@, autre), quantités préparées, statut par ligne (à préparer / partiel / prêt / à recevoir) et global (en cours / prête / livrée) |
| Fiche client (M1) → onglets Documents / Échéances | Documents du client, échéances non soldées, **encours** autorisé / actuel / disponible |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.sales.tsx` (layout), `src/routes/_app.sales.index.tsx`, `src/routes/_app.sales.new.tsx`, `src/routes/_app.sales.$documentId.tsx`, `src/routes/_app.pos.tsx`, `src/routes/_app.picking.tsx` |
| Écriture des documents (totaux, numérotation, stock, conversions, avoirs, règlements, purge) | `src/modules/sales/write-api.ts` |
| Lectures (encours, documents d'un client, stats article) | `src/modules/sales/api.ts` |
| Éditeur de document / règlements | `src/modules/sales/document-editor.tsx`, `src/modules/sales/payment-panel.tsx` |
| Vente comptoir / caisse | `src/modules/sales/pos-sale.tsx`, `src/modules/sales/cash-screen.tsx`, `src/modules/sales/cash-api.ts` |
| Disponibilité du stock sur les documents | `src/modules/sales/availability.ts`, `src/modules/sales/availability-badge.tsx` |
| Impression (HTML imprimé par le navigateur, mention TVA marge, CGV) | `src/modules/sales/print-document.ts` |
| Envoi e-mail / SMS | `src/modules/sales/notify-api.ts` (e-mail via `graph-send-email`, SMS via table `notifications`) |
| Picking list | `src/modules/sales/picking-api.ts` |
| Tables | `documents` (en-tête : type, n°, statut, totaux, pied, filiation `source_document_id`, champs G8 `legacy_number`, `marge`…), `document_lines` (lignes), `document_payments` (règlements, statut `recu` / `attendu`), `document_sequences` (numérotation, M0), `cash_sessions` (sessions de caisse), `cash_movements` (entrées/sorties de fond), `picking_lists`, `picking_list_items`, `notifications` (file SMS/e-mail) |
| Fonctions SQL (RPC) | `next_document_number`, `record_stock_move`, `recompute_document_paid`, `contact_encours`, `cash_z_report`, trigger `guard_closed_period` (refuse un document daté dans une période clôturée, M12) |
| Fonctions serveur (Edge) | `supabase/functions/graph-send-email` (envoi du mail), `supabase/functions/dispatch-notifications` (SMS, inactif faute de fournisseur) |
| Tâches planifiées | `invoice-reminders` (07:00, relance des factures échues, voir M12) |
| Migrations clés | `supabase/migrations/20260610210000_m6_documents.sql`, `…20260610240000_m6_pied_facture.sql`, `…20260610250000_m6_payments.sql`, `…20260610260000_m6_conversions.sql`, `…20260610270000_m6_cash.sql`, `…20260610280000_m6_fix_sequences.sql`, `…20260612320000_m6_line_reference.sql`, `…20260726120000_m6_picking_lists.sql` |
| Libellés | `src/lib/i18n/fr.ts`, blocs `sales`, `pos`, `cash`, `picking`, `availability` |
| Tests | `tests/sales-totals.test.ts` (8 cas : totaux, pied, détaxe, net forcé) |

## 4. Règles métier et décisions
- **Stock selon le type de document** (B4, B7) : FAC et TIK débitent le stock **réel** à la validation ; RES et BL débitent le **disponible** (mouvement de réservation) ; DEV ne touche pas au stock. La conversion RES/BL→FAC libère la réservation puis la facture débite le réel. Tout passe par `record_stock_move` (append-only). Source : `write-api.ts`, `REAL_OUT_DOC_TYPES` / `RESERVE_DOC_TYPES`.
- **Numéro attribué à la validation seulement** (brouillon sans numéro), par société et par type, via `next_document_number` (séquences M0, préfixes `FAC-`, `DEV-`, `TIK-`…). Un brouillon peut être supprimé ; un document validé non.
- **Avoir** (G8 Facturation p.88) : lignes en négatif, réintégration du stock (entrée réel), remboursement des règlements perçus (règlements négatifs), facture d'origine passée en `annulee`.
- **Conversions autorisées** (G8 p.96, p.101-109) : DEV→FAC/RES/BL ; RES→FAC/BL ; BL→FAC. Les acomptes perçus sur la source sont reportés sur la cible ; la source passe en `converti`.
- **Pied de facture** (G8 p.66) : la remise globale porte sur le HT des lignes, pas sur le port ; la TVA est réduite au prorata ; la détaxe force la TVA à 0 (PDV005, mention art. 39 CTVA) ; le net TTC forcé écrase le TTC et la TVA absorbe l'écart.
- **TVA marge (B2)** : à l'impression, si une ligne porte un article de type **O**, la mention légale « régime particulier – biens d'occasion » est ajoutée. **Le calcul de la TVA sur la seule marge n'est pas fait à la vente** : la ligne est taxée comme les autres (taux saisi, 21 % par défaut). La TVA marge est recalculée à part dans le registre VO (M12, `vo_margin_register`). Voir §7.
- **Garantie depuis l'atelier** (B10) : une facture issue d'un OR reprend les pièces en garantie à prix 0 (voir M8).
- **Purge des devis** : seuls les DEV brouillon / validés antérieurs à la date sont supprimés, jamais un devis converti (décision backlog Italobike VTE-09, commit `f4710e3`).
- **Période clôturée** : aucun document ne peut être créé à une date couverte par une clôture d'exercice (M12, trigger `trg_documents_closed_period`).

## 5. État en production
Vérifié le 18/09/2026 (code + base `ujmrosbgkvgvwfnuryna`).
- **Tous les objets utilisés par le code existent en base** : tables `documents`, `document_lines`, `document_payments`, `cash_sessions`, `cash_movements`, `picking_lists`, `picking_list_items`, `notifications`, `reference_values` et toutes leurs colonnes écrites par `write-api.ts` / `cash-api.ts` ; fonctions `next_document_number`, `record_stock_move`, `recompute_document_paid`, `contact_encours`, `cash_z_report`. RLS active sur toutes ces tables.
- **Volumes** : 17 812 documents dont 17 808 repris de G8 (`imported_from`), **seulement 4 documents créés dans l'application** (3 factures), 3 900 lignes (issues surtout des PDF G8), 2 règlements, 1 session de caisse, 0 picking list. Le module est fonctionnel mais **quasiment pas utilisé en conditions réelles**.
- **E-mail d'un document** : part réellement par Outlook (Microsoft Graph), mais **sans pièce jointe** : le texte par défaut annonce le document « en pièce jointe » alors qu'aucun PDF n'est joint.
- **SMS** : mis en file dans `notifications`, jamais envoyé (aucun fournisseur SMS configuré ; `dispatch-notifications` marque `skipped`).
- **Impression** : ouvre une fenêtre HTML et lance l'impression du navigateur ; il n'y a pas de fichier PDF généré ni archivé.
- **Sécurité** : `contact_encours` est exécutable **sans être connecté** et sans contrôle d'appartenance à la société : quiconque connaît l'identifiant d'un contact lit sa limite de crédit et son solde dû. `record_stock_move` accepte un appel anonyme (garde `auth.uid() is not null and …` contournée quand on n'est pas connecté). Voir `00-architecture.md` §9.

## 6. Prévu / en cours
- Chantier « Commandes de pièces » (spécifié, non commencé) : paiement par **QR code**, **terminal Bancontact**, signature électronique — voir `docs/process-commandes-pieces.md`. En attente client : IBAN, marque et modèle du terminal.
- Reste listé dans `docs/avancement.md` (E5) : duplicata, regroupement de BL, n° de série / REP au POS, relances et LCR.
- `TODO(sales-filters)` dans `src/routes/_app.sales.index.tsx` (l. 162) : le filtre VN / VO / dépôt-vente devrait s'appuyer sur `mgmt_type`.

## 7. Limites connues, dettes, pièges
- **TVA marge non calculée à la vente** (invariant B2) : une occasion type O facturée à 21 % sur le prix total produit une facture et des écritures (M12) fausses, tandis que le registre VO recalcule une TVA sur marge : les deux ne concordent pas. Aucun test automatisé ne couvre la TVA marge alors que la règle 7 de `CLAUDE.md` l'exige. À trancher avec le comptable avant la première vente d'occasion.
- **Écritures non atomiques** : `createDocument` enchaîne depuis le navigateur l'insertion de l'en-tête, des lignes puis des mouvements de stock. Une coupure au milieu laisse un document sans lignes ou sans mouvement. Même chose pour `convertDocument` et `generateCreditNote` (plusieurs appels successifs). À déplacer dans une fonction SQL transactionnelle.
- **Suppression de règlements** : `deletePayment` supprime physiquement une ligne de `document_payments`, et la purge des devis supprime des documents. La trace existe (triggers d'audit `trg_docpay_audit` et `trg_documents_audit` vérifiés en base, INSERT/UPDATE/DELETE → `events`), mais la donnée disparaît des tables : un règlement erroné devrait plutôt être annulé par un règlement négatif. `document_lines` n'a **pas** de trigger d'audit.
- **Session de caisse** : une seule session « ouverte » par société est lue, mais rien en base n'empêche d'en ouvrir deux ; la vente comptoir ne rattache pas le ticket à la session (le journal Z travaille par période horaire).
- **Liste limitée à 100 documents** (`listDocuments`), sans pagination : les 17 808 factures G8 ne sont pas toutes atteignables depuis la liste (la recherche et la fiche client restent possibles).
- **Client non typé** : `picking-api.ts` passe par `supabase as any` (types générés non régénérés au moment de l'écriture) : aucune vérification de colonnes à la compilation.
- **Impression** : `print-document.ts` contient des couleurs et polices en dur (`#111`, `Arial`) ; c'est un gabarit d'impression, toléré, mais contraire à la lettre de la règle 9.
- **Relances automatiques** : `_cron_invoice_reminders` enfile chaque jour une relance par facture échue (au plus une par 7 jours). Aujourd'hui sans effet (pas de clé Resend). **Dès que `RESEND_API_KEY` sera posée, ces relances partiront réellement aux clients** : vérifier la liste avant (1 facture échue au 18/09).

## 8. Exigences du cahier couvertes
Référentiel : `docs/cahier-fonctionnel-v2.md`, annexe A (Ventes, Point de Vente).

| Code | Besoin | Statut | Preuve / manque |
|---|---|---|---|
| PDV000 | Paramétrage du module | partiel | Modes de règlement dans `reference_values` (`payment_method`, `visible_pos`) — `write-api.ts` `listPaymentMethods` |
| PDV001 | Encaissement multi-méthodes | fait | `payment-panel.tsx`, `addPayments` |
| PDV002 | Terminal de paiement | manquant | Attente marque/modèle du terminal (`etat-projet.md` §8) |
| PDV003 | Ticket envoyé par e-mail | partiel | `notify-api.ts` envoie un texte par Outlook, sans PDF joint |
| PDV004 | QR code de paiement au POS | manquant | Attente IBAN ; spécifié dans `process-commandes-pieces.md` |
| PDV005 | Détaxe clients étrangers | fait | `computeTotals` (`taxExempt`), mention `sales.taxExemptMention` |
| PDV006 | Remises ligne et pied | fait | `discount_pct`, `global_discount_pct/amount` |
| PDV007 | Comptage du fond par coupure | fait | `cash-screen.tsx` (`DENOMS`), `cash_sessions.denominations` |
| PDV008 | Clôture quotidienne + récap | fait | `cash_z_report`, `closeSession` |
| PDV009 | Remises en banque, arrondis | partiel | Arrondi par net TTC forcé ; sorties de fond motivées ; pas de bordereau de remise en banque |
| VEN000 | Paramétrage du module | partiel | Séquences (M0), modes de règlement |
| VEN001 | Relance automatique des devis | manquant | Seules les factures échues sont relancées (`_cron_invoice_reminders`) |
| VEN002 | Acomptes et conditions de paiement | partiel | Acomptes sur RES reportés à la facture ; échéance ; `condition_reglement` seulement rempli par l'import G8 |
| VEN003 | Signature électronique devis/commande | manquant | `src/modules/documents/signature-pad.tsx` existe mais n'est pas branché sur les ventes (M9) |
| VEN004 | Devis véhicule + accessoires + image | partiel | Véhicule rattachable au document ; pas d'image dans le devis |
| VEN005 | Fiche véhicule A6 | manquant (M3) | Aucune trace dans `src/` |
| VEN006 | TVA sur marge VO | partiel | Mention à l'impression + registre M12 ; pas de calcul à la vente (§7) |
| VEN007 / VEN008 | Préfixes occasion / reprise et dépôt-vente | voir M7 | Hors de ce chapitre |
| VEN009 | Commande moto conditionnée à un acompte | manquant | Aucune règle bloquante dans `write-api.ts` |
| VEN010 | Paiement par QR code bancaire | manquant | Attente IBAN |
| VEN011 | Stripe | voir M11 | `stripe-checkout` / `stripe-webhook` |
| VEN012 | Tableau de bord commercial quotidien | partiel (M13) | `dashboard_kpis` |
| VEN013 | Visibilité des paiements pour les vendeurs | fait | Colonne « Acompte / Solde », badges `sales.badge*` |
| VEN014 | Documents de financement dans la fiche client | partiel (M9) | GED générique sur le contact |
| VEN015 / VEN016 | Portails financement / reprise (Ph. 2) | manquant | Portail client non commencé (`plan-nouveau-client.md`, lot 3) |

Invariants : B4 fait (réservé / réel selon type), B7 partiel (mouvements de stock append-only et audit `events` sur `documents` / `document_payments`, mais suppressions physiques possibles et lignes non auditées), B2 partiel (§7).

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | Fondation documents / lignes / règlements + RLS | `e317794`, `20260610210000_m6_documents.sql` |
| 2026-06-11 | Éditeur ventes, numérotation, stock à la validation | `15e5d7e` |
| 2026-06-11 | Pied de facture, règlements multi-modes, réservations + acomptes, conversions, avoirs | `eb97305`, `b2c61d3`, `cee9cd9`, `a25d435`, `582eeae` |
| 2026-06-11 | Clôture Z, impression, séquences BL/RES/AVO | `449b559`, `f50ba4f`, `bc7ae97` |
| 2026-06-11 | Caisse = vraie vente comptoir | `5107c8a` |
| 2026-06-12 | Facture au format G8 (en-tête, code-barres, bloc véhicule, TVA marge), CGV au verso | `50c6035`, `db10972` |
| 2026-06-12 | Lignes des factures G8 reprises depuis les PDF, PDF d'origine en GED | `8e9093b`, `343ebbf` (voir M14) |
| 2026-07-26 | Filtres de la liste, envoi mail/SMS, purge des devis, picking list, pastille de disponibilité | `309cee7`, `f4710e3`, `2e9cb4b`, `d70ac9e`, `20260726120000_m6_picking_lists.sql` |
| 2026-07-27 | Envoi e-mail par Outlook (Graph) au lieu de Resend | `5df333a` |
| 2026-09-11 | Retour visuel d'enregistrement ; corrections de typage | `7f6ce22`, `c1dd2b7`, `7d31b6d` |
