---
chapitre: M9
titre: Documents / GED / signatures
etat: 🟦
verifie_le: 2026-09-18
missions: []
mots_cles: [GED, pièce jointe, document, dossier, photo, PDF, signature, signature électronique, CGV, COC, garantie, réception, contrat d'essai, reprise, bridage, financement, attestation, stockage, bucket]
---

# M9 — Documents / GED / signatures

> **En une phrase** : le classeur numérique de la concession — chaque photo, scan ou PDF rattaché à un client, une moto, une facture ou un OR — et les documents imprimés ou signés.

## 1. À quoi ça sert

La GED (gestion électronique des documents) remplace les classeurs papier : on dépose une photo ou
un fichier sur une fiche (client, véhicule, article, facture, OR, tâche d'amélioration), on le range
dans un dossier, on le retrouve et on l'ouvre. La relève mail y dépose aussi automatiquement les
pièces jointes des e-mails reçus des clients. Le module fournit en outre deux briques réutilisables :
un **bloc de signature manuscrite** (doigt, stylet, souris) et un **assainissement du texte des PDF**.
Les générateurs de documents métier (COC, dossier garantie, contrat d'essai, bridage) prévus au cahier
**n'existent pas encore** ; seuls ceux du module Reprises (M7) et les documents de vente (M6 : impression
HTML et, depuis le 19/09, **vrai PDF** envoyé par mail et rangé en GED) sont écrits.

## 2. Ce qu'on a aujourd'hui

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Panneau « Documents » (réutilisé partout, voir ligne suivante) | Déposer un ou plusieurs fichiers (bouton, caméra sur mobile, glisser-déposer) avec un libellé rapide (Réception, Avant atelier, Après atelier, COC, Pièce d'identité, Photo) ; créer des **dossiers** et y glisser les pièces ; filtrer par dossier ; vignettes pour les images ; ouvrir (lien signé valable 1 h) ; renommer ; supprimer. |
| Où le panneau apparaît | Clients → fiche → onglet GED · Véhicules → fiche · Pièces → fiche article → onglet Photos · Ventes → document · Atelier → OR · CRM → carte d'une demande → onglet Documents (pièces du **client**) · Améliorations → tâche |
| Ventes → document → Imprimer | Facture / devis / ticket / BL / avoir au format de la concession, avec les **CGV au verso** si la société en a (M6, `print-document.ts`). |
| Ventes → document → **Aperçu PDF** / **Envoyer par e-mail** (19/09) | PDF du devis / proforma, bon de commande, réservation, BL, facture… ; à l'envoi, le PDF est rangé dans la GED du **client** (dossier « Documents de vente ») et dans celle du **document**, avec la note « Envoyé par e-mail à … depuis … le … ». |
| Reprises → validation (M7) | Signature manuscrite du client sur l'attestation « TVA régime de la marge », PDF d'archive de la reprise déposé en GED sur la moto et sur le client, fiche de reprise PDF. ⚠️ Module M7 inopérant en production (voir chapitre M7). |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | pas de route propre ; panneau inséré dans `src/routes/_app.clients.$contactId.tsx`, `_app.vehicles.$vehicleId.tsx`, `_app.parts.$articleId.tsx`, `_app.sales.$documentId.tsx`, `_app.workshop.$orId.tsx`, `src/modules/crm/lead-detail.tsx`, `src/modules/improvements/task-editor.tsx` |
| Panneau GED | `src/modules/documents/attachments-panel.tsx` |
| Accès aux fichiers | `src/modules/documents/ged-api.ts` (chemin de stockage : `<company_id>/<entity_type>/<entity_id>/<horodatage>_<nom>`) |
| Signature manuscrite | `src/modules/documents/signature-pad.tsx` (utilisé seulement par `src/modules/tradein/validate-dialog.tsx`) |
| PDF des documents de vente (M6) | `src/modules/sales/document-pdf.ts`, `document-pdf-data.ts`, `pdf-print-style.ts` ; envoi + archivage `document-mail-api.ts` |
| Texte des PDF (jsPDF) | `src/modules/documents/pdf-text.ts` (`sanitizePdfText`, `patchPdfText`) |
| Générateurs de documents existants (hors module) | `src/modules/sales/print-document.ts` (M6, HTML imprimable), `src/modules/tradein/attestation-pdf.ts`, `reprise-pdf.ts`, `validation-pdf.ts`, `sheet-builder.ts` (M7, jsPDF) |
| Tables | `attachments` (index des pièces : entité, chemin, type, taille, dossier, empreinte), `document_signatures` (prévue pour les signatures, **inutilisée**), `companies.cgv_text` / `invoice_footer` (CGV et pied de facture) |
| Stockage | bucket privé `ged` (13 191 objets), bucket public `shop-assets` (M11) |
| Fonctions SQL (RPC) | aucune propre ; politique `ged_public_products` pour les photos d'articles publiés (M11) |
| Fonctions serveur (Edge) | `supabase/functions/outlook-poll` dépose les pièces jointes des mails (dossier « E-mails », dédoublonnées par empreinte `content_hash`) ; `supabase/functions/read-id-doc` lit les scans d'identité (M1) et, en mode `carte_grise`, la carte grise d'une moto (M3, mission 04 carte 7 : photo rangée dans la GED du véhicule, dossier « Carte grise ») |
| Tâches planifiées | `outlook-poll` (toutes les 5 min, voir M10) |
| Migrations clés | `supabase/migrations/20260610370000_m9_ged.sql`, `20260612260000_m9_cgv_signatures.sql`, `20260612370000_m9_ged_folders.sql` |
| Libellés | `src/lib/i18n/fr.ts`, bloc `ged` |
| Tests | `tests/pdf-text.test.ts` |

## 4. Règles métier et décisions

- **Une GED unique pour toutes les entités** : une seule table `attachments` (`entity_type` + `entity_id`), un seul panneau. Types utilisés en base : `document`, `vehicle`, `contact`, `article`, `improvement` ; le code utilise aussi `repair_order` et `lead`.
- **Isolement par société** : le premier dossier du chemin est le `company_id` ; les politiques du bucket `ged` exigent `is_member` de cette société. Bucket privé : on n'ouvre un fichier que par lien signé temporaire.
- **Pièces d'un mail = pièces du client** (correctif du 14/09) : la carte CRM affiche la GED du **contact**, pas celle de la demande, sinon les deux dossiers ne se voyaient pas.
- **PDF imprimés** : couleurs et polices en dur autorisées dans les documents imprimés (charte §7) ; tout texte passe par `patchPdfText` pour éviter les caractères parasites (espace fine insécable de `toLocaleString`, correctif `cf8ee9a`).
- **PDF des documents de vente généré dans le navigateur avec jsPDF** (19/09, mission 05 carte 8). Pourquoi : jsPDF est **déjà** une dépendance du projet (PDF de reprise M7), léger, très répandu, compatible Lovable / TanStack Start (chargé à la demande, seulement au clic) ; le même fichier sert à l'aperçu, à la pièce jointe et à l'archive GED, sans aller-retour serveur. Écartés : une Edge Function Deno (il faudrait y réécrire la mise en page et relire toutes les données avec la clé service, pour aucun gain tant qu'aucun PDF ne part sans utilisateur) ; l'impression HTML `window.print()` (aucun fichier à joindre ni à archiver) ; pdf-lib (nouvelle dépendance, pas de mise en page du texte). Couleurs et polices du PDF : **uniquement** `pdf-print-style.ts` (document imprimé, charte §7), jamais dans un composant React. Le jour où un PDF devra partir sans utilisateur connecté (relance automatique), déplacer `document-pdf.ts` (pur) dans une Edge Function.
- **Un PDF envoyé = deux fichiers GED** (client et document), pas une ligne partagée : supprimer l'un ne casse pas l'autre (la suppression efface le fichier du stockage).
- **Prix de vente jamais dans le PDF d'archive de reprise** (demande magasin, en-tête de `validation-pdf.ts`).

## 5. État en production

Vérifié le 18/09/2026 dans le code et dans la base.

- ✅ Table `attachments` (13 178 lignes : 12 703 sur des documents de vente — factures G8 d'origine —, 245 véhicules, 223 contacts, 4 articles, 3 améliorations) et bucket `ged` (13 191 objets) présents ; colonnes `folder` et `content_hash` présentes.
- ✅ Dépôt, dossiers, renommage, ouverture et suppression fonctionnent sur toutes les fiches.
- ✅ CGV : renseignées pour 1 société sur 2, imprimées au verso des factures.
- ⚠️ `document_signatures` existe (0 ligne) mais **aucun code ne l'écrit** : la seule signature réelle (attestation de reprise) est incrustée comme image dans le PDF, sans empreinte ni horodatage en base.
- ⚠️ **Tout membre de la société peut supprimer définitivement n'importe quelle pièce**, y compris les 12 703 factures d'origine reprises de G8 (politique `attachments_all` et `ged_delete` = `is_member`). La suppression est tracée dans `events` (déclencheur `trg_attachments_audit`) mais le fichier est effacé du stockage **avant** la ligne d'index, sans vérifier le résultat : si la seconde étape échoue, le fichier est perdu et la ligne reste.
- 🔴 `read-id-doc` (voir M1) télécharge n'importe quel chemin de la GED avec la clé service role, sans vérifier l'appelant, et est déployée sans vérification de jeton.

## 6. Prévu / en cours

- Signature électronique (horodatage, empreinte, archivage, envoi au client) : listée comme « reste » dans `etat-projet.md` §3.
- Photo de profil et photo de moto dans le portail client, en réutilisant les briques existantes : lot 3 de [`../../plan-nouveau-client.md`](../../plan-nouveau-client.md).
- Signature électronique et QR de paiement au comptoir : spécifiés dans [`../../process-commandes-pieces.md`](../../process-commandes-pieces.md), non commencés.
- Aucune mission `../missions/` n'existe encore pour ce module.

## 7. Limites connues, dettes, pièges

- **Pas de générateur PDF templaté commun** : chaque module écrit le sien (HTML imprimable et PDF jsPDF en M6, jsPDF en M7). Le « générateur PDF en Edge Function » du dossier-projet n'existe pas (choix du 19/09, §4).
- **Signature du PDF de vente** : une case « Bon pour accord » vide, à signer à la main ; pas de signature électronique (VEN003).
- La GED d'une entité est lue par `entity_type` + `entity_id` sans filtre `company_id` côté requête (la RLS s'en charge).
- Les dossiers vides n'existent que dans l'écran (état local) : un dossier sans fichier disparaît au rechargement.
- Aucune limite de taille sur le bucket `ged` (`file_size_limit` nul).
- Les CGV, le pied de facture et le logo n'ont **pas d'écran de saisie** (`companies.cgv_text`, `invoice_footer`, `logo_url`) : modification en base uniquement.
- `signature-pad.tsx` contient une couleur d'encre en dur (`#1a1a1a`), assumée comme contenu imprimé.

## 8. Exigences du cahier couvertes

| Code | Libellé | État | Preuve |
|---|---|---|---|
| DOC000 | Paramétrage standard | 🟦 partiel | libellés rapides en dur dans `attachments-panel.tsx` (`PRESETS`), CGV sans écran |
| DOC001 | Formulaire PDF de demande de COC | ⬜ manquant | séquence `COC` existe (`document_sequences`), aucun générateur |
| DOC002 | Dossier de garantie PDF avec photos | ⬜ manquant | photos d'OR en GED seulement |
| DOC003 | Fiche de réception véhicule digitale | 🟦 partiel | observations de réception sur l'OR (M8) + photos GED `repair_order` ; pas de fiche imprimable ni signée |
| DOC004 | Contrat d'essai moto avec signature électronique | ⬜ manquant | — |
| DOC005 | Fiche de reprise moto digitale | 🟦 partiel | `src/modules/tradein/reprise-pdf.ts`, `validation-pdf.ts` ; inopérant en production (M7) |
| DOC006 | Attestation de bridage / débridage | ⬜ manquant | seule l'attestation « TVA marge » existe (`attestation-pdf.ts`) |
| DOC007 | Dossiers de financement | 🟦 partiel | dépôt générique en GED client, pas de dossier structuré |
| DOC008 | Alias mail pour archivage automatique | 🟦 partiel | `outlook-poll` range les pièces jointes des mails sur la fiche du client expéditeur ; pas d'alias dédié |
| VEN003 | Signature électronique des devis/commandes | ⬜ manquant | `document_signatures` inutilisée ; « lu et approuvé » papier au verso des CGV |
| VEN005 | Fiches véhicule A6 pour le magasin | ⬜ manquant | aucun gabarit A6 dans `src/` |
| VEN014 | Documents de financement dans la fiche client | 🟦 partiel | GED client (onglet GED) |
| VEN015 | Portail de dépôt de documents de financement | ⬜ manquant | pas de portail |
| VEN016 | Portail de demande de reprise avec photos | ⬜ manquant | l'assistant de reprise M7 est interne |
| VEH005 | Gestion documentaire par véhicule | ✅ fait | panneau GED sur `_app.vehicles.$vehicleId.tsx` |
| ATE007 | Photos à la réception du véhicule | ✅ fait | panneau GED sur `_app.workshop.$orId.tsx`, libellé « Réception » |
| ATE008 | Signature client sur l'OR avec envoi automatique | ⬜ manquant | — |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | GED : pièces jointes génériques, bucket privé, RLS par société, panneau sur véhicule / contact / OR | `a453fbd`, migration `20260610370000_m9_ged` |
| 2026-06-11 | Libellés rapides, vignettes, caméra mobile, onglet Photos de l'article | `eed9599` |
| 2026-06-12 | CGV et pied de facture sur la société, table `document_signatures` | migration `20260612260000_m9_cgv_signatures` |
| 2026-06-22 | Dossiers, glisser-déposer, renommage ; pièces jointes des mails en GED, dédoublonnées | `13be403`, `168399a`, migration `20260612370000_m9_ged_folders` |
| 2026-07-19 | Bloc de signature et PDF de validation de reprise (M7) ; assainissement du texte des PDF | `b7ed89c`, `cf8ee9a` |
| 2026-09-14 | La carte CRM affiche les pièces du client | `0e60be2` |
| 2026-09-19 | PDF des documents de vente (jsPDF) : aperçu, pièce jointe du mail, archivé en GED client + document (mission 05 carte 8, mission 02 carte 6) | code seul |
| 2026-09-19 | Carte grise lue par `read-id-doc` (mode `carte_grise`) et rangée dans la GED de la moto (mission 04, carte 7) | branche `lot-m4-moto` |
