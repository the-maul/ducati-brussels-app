---
mission: 01
titre: Nouveau client — prospects, comptes, portail
etat: 🟦
ouverte_le: 2026-09-14
modules: [M00, M01, M10, M11]
---

# Mission 01 — Nouveau client

> **Objectif** : toute personne qui contacte la concession devient une fiche client suivie dans le CRM,
> reçoit un compte, et retrouve ses véhicules et achats sur son téléphone.

Journal détaillé du chantier (analyse, chiffres, défauts trouvés) : [`../../plan-nouveau-client.md`](../../plan-nouveau-client.md).
Ce fichier-ci est le **tableau de bord** : où on en est, en une minute.

## 1. Le besoin

Quatre canaux d'entrée : **e-mail**, **site web** (formulaire → shop@), **comptoir** (tablette en
libre-service), **téléphone** (encodage par le vendeur). Chaque demande doit produire une fiche
prospect, une carte CRM avec une tâche, et une invitation à créer un compte.

## 2. Décisions

Voir [journal des décisions](../decisions.md), entrées D1 à D4 (14/09) et celles du 18/09.

## 3. Lots

| Lot | Contenu | Fait quand | État | Date |
|---|---|---|---|---|
| 0 | Fondations : boîtes d'écoute multiples, origine du contact, table d'invitations | Migrations appliquées et vérifiées | ✅ | 14/09 |
| 1 | Capture des mails : analyse par IA, fiche prospect, carte CRM avec tâche, relais Shopify reconnus | Un vrai mail inconnu crée fiche + carte + tâche | ✅ | 14/09 |
| 1b | Carte CRM : une tâche à la fois, 3 sorties, archivage, échanges, réponse par mail, note résumée à chaque échange, boîte de réponse = celle qui a reçu | Retours client du 14/09 et du 18/09 intégrés | ✅ | 18/09 |
| 1c | **Écran de fusion des doublons** (28 vrais doublons, 84 adresses partagées) | Un administrateur valide ou refuse chaque fusion proposée | ⬜ | — |
| 2 | Comptes : utilisateurs équipe et client, invitation Outlook, choisir / changer son mot de passe, responsable par défaut | Un client invité choisit son mot de passe et son compte est lié à sa fiche | ✅ | 18/09 |
| 3 | **Portail client** sur téléphone : véhicules, entretiens, achats, informations | Un client de test retrouve factures et véhicule sur son téléphone | ⬜ | — |
| 4 | **Borne comptoir** (tablette) + encodage manuel + page d'inscription intégrable au site | Un client s'enregistre seul à la tablette et reçoit le message de bienvenue | 🟦 lien du site Shopify prêt (W-5) : `/app-client` « bientôt disponible » + « Prévenez-moi », bascule vers `/inscription` dans Paramètres → Application client ([guide](../guides/lien-site-shopify.md)) ; encodage manuel au CRM : carte créée à la main reliée à une fiche client (branche `lot-carte-fiche`), **corrigée le 19/09** (branche `lot-lead-fiche` : les boutons plantaient avant d'atteindre la base) | 19/09 |
| 5 | Finitions : questionnaire du site dans le même tuyau, tri G8 (4 165 contacts facturés → client), notification d'inscription | Les trois points faits | 🟦 notification d'inscription (cloche) et tri G8 faits (4 165 fiches → client) ; reste le questionnaire du site | 18/09 |

## 4. Questions en attente

Voir [`../questions-en-attente.md`](../questions-en-attente.md), section « Mission 01 ».

## 5. Ce qui a changé dans l'application

| Module | Changement | Quand |
|---|---|---|
| [M10 CRM](../modules/M10-crm.md) | Création automatique des prospects par mail, carte à une tâche, archivage, échanges, note résumée, onglet CRM commercial | 14–18/09 |
| [M00 Socle](../modules/M00-socle.md) | Comptes équipe et client, invitation, mot de passe, responsable par défaut | 18/09 |
| [M01 Contacts](../modules/M01-contacts.md) | Origine du contact, statut prospect, tri par date d'arrivée, compte client lié à la fiche | 14–18/09 |
| [M01 Contacts](../modules/M01-contacts.md) | **Tri G8 (D2)** : 4 165 fiches avec au moins une facture passées en « client », 3 945 restent « prospect » (dont 101 fournisseurs) ; retour arrière prêt (lot 5, migration `20260919160000`) | 18/09 |
| [M00 Socle](../modules/M00-socle.md) | **Lien du site Shopify (W-5)** : page publique `/app-client` « Notre application client sera bientôt disponible » avec « Prévenez-moi à l'ouverture » ; interrupteur, adresse à copier, liste et export CSV dans Paramètres → Application client (lot 4, migration `20260919240000`) | 19/09 |
| [M10 CRM](../modules/M10-crm.md) | **Carte créée à la main → fiche client** : « Nouvelle demande » et « Relier ou créer la fiche client » plantaient dans le navigateur (appel `rpc` détaché du client Supabase) ; corrigé, test `tests/rpc-bound.test.ts` (lot 4, branche `lot-lead-fiche`, aucune migration) | 19/09 |
| [M00 Socle](../modules/M00-socle.md) / [M10 CRM](../modules/M10-crm.md) | **Cloche** : « Nouvelle inscription : Prénom Nom (borne / en ligne) », cliquable vers la fiche, lu par utilisateur, 7 derniers jours ; aucun e-mail ni SMS (lot 5, migration `20260919170000`) | 18/09 |

## 6. Risques et points d'attention

- **RGPD** : la case de consentement marketing va sur le formulaire d'inscription, pas sur la fiche
  créée automatiquement.
- **Portail = surface publique** : chaque fonction ouverte aux clients doit être écrite avec le
  minimum d'accès. Un client ne doit voir que ses propres données.
- **Adresses partagées** (84) : un mail venant d'une adresse commune à plusieurs fiches ne doit pas
  être rattaché au hasard.

- 19/09 (ronde) : Simon demande une notification atelier pour les demandes de RDV du portail → déjà couvert par la cloche par rôle (N-1 : mécanicien, chef d'atelier, admin) ; carte « Espace client : demander un rendez-vous atelier » repassée à valider.
