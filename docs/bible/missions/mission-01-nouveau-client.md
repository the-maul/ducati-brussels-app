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
| 4 | **Borne comptoir** (tablette) + encodage manuel + page d'inscription intégrable au site | Un client s'enregistre seul à la tablette et reçoit le message de bienvenue | 🟦 **écran d'accueil de la borne à 3 tuiles (K-7, 21/09, à valider, branche `lot-borne`, migration `20260921180000` non appliquée)** ; lien du site Shopify prêt (W-5) : `/app-client` « bientôt disponible » + « Prévenez-moi », bascule vers `/inscription` dans Paramètres → Application client ([guide](../guides/lien-site-shopify.md)) ; encodage manuel au CRM : carte créée à la main reliée à une fiche client (branche `lot-carte-fiche`), **corrigée le 19/09** (branche `lot-lead-fiche` : les boutons plantaient avant d'atteindre la base) | 19/09 |
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
| [M00 Socle](../modules/M00-socle.md) | **Borne : écran d'accueil à 3 tuiles (K-7)** : « Configurer ma Ducati » (configurateur officiel Belgique FR), « Créer mon compte », « Nos occasions » (site Ducati Bruxelles) ; bouton « Accueil » sur le formulaire ; toute remise à zéro (inactivité 90 s, bienvenue 15 s, bouton retour) ramène à l'accueil ; adresses réglables dans Paramètres → Borne d'inscription (vide = case masquée). Pas de cadre : les deux sites l'interdisent, retour assuré par l'application kiosque ([guide](../guides/borne-kiosque.md) §3 bis). Lot 4, migration `20260921180000` (deux colonnes de `signup_settings`, **non appliquée** : en attendant, adresses par défaut et réglage en lecture seule), test `tests/kiosk-links.test.ts` | 21/09 |
| [M00 Socle](../modules/M00-socle.md) / [M10 CRM](../modules/M10-crm.md) | **Cloche** : « Nouvelle inscription : Prénom Nom (borne / en ligne) », cliquable vers la fiche, lu par utilisateur, 7 derniers jours ; aucun e-mail ni SMS (lot 5, migration `20260919170000`) | 18/09 |
| [M01 Contacts](../modules/M01-contacts.md) / [M00 Socle](../modules/M00-socle.md) | **Retour client du 21/09 (carte « Inscription en ligne : créer mon compte et choisir ma moto »)** : e-mail rangé dans le GSM corrigé et fiches réparées ; E-mail dans un champ distinct (lecture seule) de Mon profil ; téléphones au format unique (préfixe pays + numéro, stockés `+32470123456`, affichés `+32 470 12 34 56`) ; permis en deux photos recto / verso ; carte « Complétez votre profil » avec pourcentage coloré et bouton « Finaliser mon profil » (branche `lot-profil`, migration `20260921160000`, à appliquer) | 21/09 |
| [M10 CRM](../modules/M10-crm.md) | **Carte ERP « Carte CRM seulement si le client demande à être recontacté »** (retour du 21/09 : « Ne pas laisser la possibilité de mettre un mail dans champs téléphone ») : le téléphone de la **carte** (`leads.phone`, distinct de la fiche) passe par le composant téléphone, est refusé à l'écran s'il n'est pas un numéro et est enregistré en E.164 ; garde-fou et réparation en base (branche `lot-signature`, migration `20260921190000`, à appliquer) | 21/09 |
| [M03 Véhicules](../modules/M03-vehicules.md) / [M01 Contacts](../modules/M01-contacts.md) | **Carte « Inscription en ligne », suite du retour du 21/09 : marques et modèles TOUTES MARQUES avec recherche.** « Autre marque » n'est plus un champ libre : marque → modèle → année, avec un champ de recherche qui propose au fur et à mesure (inscription en ligne, borne du comptoir) ; « Ajouter ma moto » de l'espace client propose les mêmes marques et modèles. « Je ne trouve pas ma moto » garde la saisie libre, qui alimente la file « marques à valider » sans polluer la liste officielle. **motoplanete.com n'est pas recopié** (M-49) : données du domaine public vPIC/NHTSA (**1 667 marques, 10 558 modèles**) + nos propres fiches. Branche `lot-marques`, migrations `20261005100000` et `20261005101000` **appliquées** | 05/10 |
| [M10 CRM](../modules/M10-crm.md) | **Carte « Invitation à rejoindre l'application sous chaque mail envoyé » (retour du 21/09)** : le pied d'invitation dit maintenant que l'espace client donne accès aux **factures**, au **suivi des interventions atelier** et au **contact direct avec l'équipe pour toute demande commerciale** ; adresse, téléphone et site lus sur la fiche société (`mail_signature_*`), jamais en dur, et affichés une seule fois (M-51). Branche `lot-marques`, migration `20261005102000` **appliquée** ; fonction `graph-send-email` **à déployer** | 05/10 |
| [M09 Documents](../modules/M09-documents.md) / [M01 Contacts](../modules/M01-contacts.md) / [M03 Véhicules](../modules/M03-vehicules.md) | **Carte « Espace client : mes motos, entretiens et factures » — retour de Simon du 05/10.** Carte d’identité ajoutée au même rang que le permis ; **recto ET verso** pour tous les documents (permis, carte d’identité, carte grise, assurance, COC, contrôle technique) avec « ce document n’a pas de verso » pour ne bloquer personne ; le client **voit** (plein écran) et **supprime** ses documents (confirmation, trace `events`, fichier effacé du stockage) ; limite **10 Mo** annoncée avant l’envoi, images réduites à 1 200 px, PDF trop lourd refusé avec un message clair ; « Autres documents » accepte **plusieurs** fichiers, chacun avec son libellé ; **miniature** à la place du nom de fichier. Et la cause du « moto en attente de validation alors que tout est enregistré » : le rapprochement ne se faisait que par VIN ou plaque, absents des déclarations d’inscription (M-58 à M-63) — **1 déclaration sur 6 corrigée**. Branche `lot-portail-docs`, migration `20261005130000` **appliquée** | 05/10 |
| [M10 CRM](../modules/M10-crm.md) / [M00 Socle](../modules/M00-socle.md) | **Carte ERP « Signature de mail selon l'adresse d'envoi »** (P-7) : signature sous chaque mail envoyé par l'application (nom + fonction pour une adresse personnelle, nom de la boîte pour une boîte partagée, coordonnées de la concession) ; réglages dans Paramètres → Sociétés, « Ma signature e-mail » (menu du compte) et Paramètres → Utilisateurs ; aperçu dans « Vérifier sans envoyer » (branche `lot-signature`, migration `20260921191000`, à appliquer ; `graph-send-email` à déployer) | 21/09 |
| [M01 Contacts](../modules/M01-contacts.md) | **Retour de Simon du 05/10 — fiche liée** : quand une fiche privée est liée à une fiche pro, le **prénom et le nom de la fiche pro sont ceux de la fiche privée** et ne sont plus modifiables (grisés, « repris de la fiche privée de … » + lien) ; ils suivent tout renommage de la personne et redeviennent modifiables si on délie. S'il y a **plusieurs** fiches privées liées (couple, deux gérants), rien n'est repris et l'écran le dit. La **recherche de contacts trouve une fiche par le nom de sa fiche liée** (chercher « AGM FISC » remonte la personne, et l'inverse) et la fiche liée s'affiche **sous la ligne du contact, en plus clair**, dans la liste des clients et dans les sélecteurs de contact des documents. Règle tenue par **déclencheurs en base** (M-62 à M-65), tracée dans `events`. Branche `lot-fiche-liee`, migrations `20261005140000` et `20261005141000` (**à appliquer**) | 05/10 |

## 6. Risques et points d'attention

- **RGPD** : la case de consentement marketing va sur le formulaire d'inscription, pas sur la fiche
  créée automatiquement.
- **Portail = surface publique** : chaque fonction ouverte aux clients doit être écrite avec le
  minimum d'accès. Un client ne doit voir que ses propres données.
- **Adresses partagées** (84) : un mail venant d'une adresse commune à plusieurs fiches ne doit pas
  être rattaché au hasard.

- 19/09 (ronde) : Simon demande une notification atelier pour les demandes de RDV du portail → déjà couvert par la cloche par rôle (N-1 : mécanicien, chef d'atelier, admin) ; carte « Espace client : demander un rendez-vous atelier » repassée à valider.
