# Plan « Nouveau client » — acquisition, fiche, compte et portail

> **Chantier en cours.** Ouvert le **2026-09-14**. Ce document est la **source de vérité** du chantier :
> décisions prises, état des briques existantes, découpage en lots, critères d'acceptation.
> À lire avant de toucher à la capture des mails, à l'inscription client ou au portail.
> Voir aussi : [`etat-projet.md`](etat-projet.md) (état général), [`../CLAUDE.md`](../CLAUDE.md) (règles).

---

## 1. Le problème

Aujourd'hui, un prospect qui écrit à la concession est **perdu**. Le mail reste dans la boîte Outlook.
La relève automatique existe et tourne, mais elle **ignore délibérément tout expéditeur inconnu** :
la fonction `ingest_inbound_email` renvoie `matched = false` et ne crée rien.

Objectif : qu'une demande d'information devienne **une fiche client, une tâche CRM et une invitation
à créer un compte**, quel que soit le canal d'arrivée.

---

## 2. Les quatre canaux d'entrée

| # | Canal | Ce qui doit se passer |
|---|---|---|
| 1 | **E-mail** vers une boîte d'écoute | Analyse du mail, création d'une fiche « prospect » préremplie, tâche CRM, invitation à créer un compte |
| 2 | **Site web** (questionnaire → `shop@ducatibxl.be`) | Identique au canal 1 |
| 3 | **Comptoir** (l'atelier renvoie toujours vers le comptoir) | Tablette en libre-service : le client crée lui-même son compte et sa fiche. Plus un encodage manuel par le vendeur |
| 4 | **Téléphone** | Encodage manuel par le vendeur |

---

## 3. Décisions déjà prises (client, 2026-09-14)

- **D1 — Pas de branche « ignorer » séparée.** C'est l'analyse du mail par l'IA qui décide.
  Elle ne crée une fiche **que** si c'est une demande d'information d'un prospect, sur un véhicule,
  une pièce ou un renseignement. Un fournisseur, une newsletter, un mail de Ducati ou un indésirable
  ne produit **rien**.
- **D2 — Tri du fichier repris de G8.** Un contact **sans facture identifiée reste prospect**.
  Un contact **avec au moins une facture devient client**. Tout nouvel arrivant entre en **prospect**.
- **D3 — Détection des doublons.** C'est **l'adresse e-mail** qui détermine si le contact est nouveau.
  En cas de **ressemblance** (nom et prénom identiques, ou même société), on **propose une fusion**,
  **validée à la main**. Jamais de fusion automatique.
- **D4 — Envoi des e-mails.** On passe par **Outlook / Microsoft Graph**, déjà opérationnel.
  Pas de Resend, pas de nouveau fournisseur, pas de domaine à faire vérifier.

### Chiffres du tri D2 (relevés le 2026-09-14)

| Mesure | Valeur |
|---|---|
| Contacts au total | 8 094 |
| dont fournisseurs (hors tri) | 101 |
| Avec au moins une facture → **client** | 4 165 |
| Restants → **prospect** | ~3 828 |
| Contacts avec un e-mail renseigné | 6 134 |
| Adresses e-mail portées par plusieurs fiches | 112 (hors fournisseurs) |
| dont **mêmes nom et prénom** → vrais doublons à fusionner | 28 |
| dont **noms différents** → adresse partagée, à conserver | 84 |

> **La reconnaissance par e-mail n'est pas suffisante à elle seule.** 84 adresses sont partagées par
> des personnes différentes : un couple, une famille, ou l'adresse générale d'une société. Un mail
> venant d'une de ces adresses est **ambigu** et ne doit pas être rattaché au hasard : il faut
> demander à qui le rattacher dans la tâche CRM. Seuls les 28 cas à nom identique relèvent de la fusion.

---

## 4. Ce qui existe déjà (ne pas réécrire)

| Brique | État | Emplacement |
|---|---|---|
| Relève Outlook toutes les 5 min, idempotente, pièces jointes en GED | ✅ | `supabase/functions/outlook-poll/index.ts` |
| Journalisation d'un mail sur un contact connu | ✅ | RPC `ingest_inbound_email` (migration `20260612350000`) |
| Envoi d'e-mail depuis la boîte de la société | ✅ envois réels confirmés | `supabase/functions/graph-send-email/index.ts` |
| Appel Claude avec **sortie au format imposé** (gabarit à copier) | ✅ | `supabase/functions/read-id-doc/index.ts` |
| Clé `ANTHROPIC_API_KEY` posée côté Supabase | ✅ | secret Edge Function |
| Statut `prospect / client / client_piece / client_atelier` | ✅ enum en base | type `contact_status` |
| Détection de doublons (nom, ville, téléphone, e-mail) | ✅ | RPC `contacts_find_duplicates` |
| Champs professionnels séparés des champs privés | ✅ | `contacts.company_name`, `vat_number`, `email_pro`, `phone_pro`, `mobile_pro`, `contact_name` |
| Prise de photo caméra + galerie + recadrage + compression | ✅ écrit deux fois | `src/modules/contacts/id-docs.tsx`, `src/modules/tradein/reprise-photos-panel.tsx` |
| Motif de page publique (RPC `security definer` ouvertes à `anon`) | ✅ | `src/routes/shop.$slug.tsx`, migration `20260610440000` |
| File de notifications (relance, programmation, traçabilité) | 🟡 pointe vers Resend sans clé, tout part en « ignoré » | table `notifications`, `supabase/functions/dispatch-notifications/index.ts` |
| Pipeline CRM (leads, étapes, journal des communications) | ✅ | tables `leads`, `communications` |

### Limites connues à corriger

1. **La relève ne lit qu'un aperçu de 255 caractères** du corps du mail (`bodyPreview`), et 25 messages
   par passage. L'analyse a besoin du **corps complet**.
2. **Une seule boîte d'écoute par société** (`companies.inbound_mailbox`, champ texte simple).
   Il en faut au moins deux : la boîte générale et `shop@ducatibxl.be`.
3. **Aucune colonne d'origine** sur `contacts`. Impossible aujourd'hui de distinguer une fiche créée
   automatiquement d'une fiche saisie par un vendeur.
4. **Le portail client n'existe pas et ne peut pas exister en l'état.** Toute la sécurité repose sur
   « cet utilisateur est-il membre de la société » (`profiles` + `user_roles`, rôles internes
   uniquement). Un client n'est pas membre : il ne verrait rien.

---

## 5. Architecture cible

```
Boîtes Outlook (générale + shop@)
        │  relève toutes les 5 min, corps complet
        ▼
  ingest_inbound_email
        │
        ├── expéditeur connu ──────────────► journal du contact (inchangé)
        │
        └── expéditeur inconnu
                │
                ▼
        Analyse Claude (1 appel, sortie au format imposé)
                │
                ├── pas un prospect ──────► rien, seulement une trace
                │
                └── prospect
                        ├─► fiche contact, statut « prospect », origine « mail »
                        ├─► tâche CRM (demande, date, canal, contact)
                        ├─► doublon possible ? ──► proposition de fusion à valider
                        └─► invitation par e-mail (jeton à usage unique)
                                    │
                                    ▼
                           Page d'inscription publique
                                    │
                                    ▼
                        Compte client ⇄ fiche contact
                                    │
                                    ▼
                        Portail client (mobile d'abord)
```

---

## 6. Découpage en lots

Chaque lot = une branche, une PR, un titre lisible par le client. Chaque lot est **testé et montré**
avant de passer au suivant. Les migrations sont **appliquées à la main sur Supabase** et cochées dans
le tableau de `docs/avancement.md` (voir le risque n°1 au §8).

### Lot 0 — Décisions et fondations

**But** : lever les inconnues et poser le socle de données.

- [ ] Trancher les questions ouvertes du §7.
- [x] Migration : plusieurs boîtes d'écoute par société, **avec un curseur de relève par boîte**
      (un curseur unique ferait sauter des mails sur la seconde boîte relevée).
- [x] Migration : colonne `contacts.origin` (`mail`, `web`, `comptoir`, `manuel`, `import_g8`),
      rétro-remplie à `import_g8` pour les fiches reprises de G8.
- [x] Migration : table `contact_invitations` (jeton, contact, expiration, usage unique).
- [ ] Revue des **28 vrais doublons** d'e-mail, fusion validée à la main.

**Fait quand** : les migrations sont appliquées **et vérifiées en base**, les 28 doublons sont traités.

### Lot 1 — Capture des mails

**But** : plus aucun prospect perdu. Ce lot apporte de la valeur **seul**, même si le portail ne sort jamais.

- [ ] La relève lit le corps complet du mail et plusieurs boîtes.
- [ ] Branche « expéditeur inconnu » dans `ingest_inbound_email`.
- [ ] Fonction d'analyse : un appel Claude, sortie au format imposé, qui répond à
      « est-ce un prospect ? » et extrait nom, prénom, téléphone, société, numéro de TVA,
      objet de la demande, et le côté **privé ou professionnel**.
- [ ] Création de la fiche en statut « prospect » avec l'origine renseignée.
- [ ] Création de la tâche CRM rattachée, avec la demande et la date.
- [ ] Proposition de fusion si ressemblance, jamais automatique.
- [ ] Trace systématique, y compris pour les mails écartés.

**Fait quand** : un mail de test envoyé depuis une adresse inconnue produit une fiche et une tâche ;
un mail de fournisseur ou une newsletter ne produit rien ; un mail d'un client connu se comporte
comme avant.

### Lot 2 — Invitation et compte client

- [ ] Génération du jeton et du lien d'invitation.
- [ ] File de notifications rebranchée sur Outlook au lieu de Resend.
- [ ] Modèle d'e-mail d'invitation, avec lien de désinscription.
- [ ] Page d'inscription publique qui consomme le jeton.
- [ ] Rattachement du compte de connexion à la fiche contact existante.
- [ ] Règles d'accès : un client ne voit **que** ses propres données.

**Fait quand** : le lien reçu par mail mène à un compte rattaché à la bonne fiche, sans créer de doublon,
et un client connecté ne peut lire aucune donnée d'un autre client.

### Lot 3 — Portail client

- [ ] Vue téléphone d'abord : ses véhicules, ses entretiens, ses achats, ses informations.
- [ ] En lecture seule dans un premier temps.
- [ ] Complétion accompagnée du profil, sans lourdeur.
- [ ] Photo de profil et photo de moto, appareil photo ou galerie, en réutilisant l'existant.

**Fait quand** : un client de test retrouve ses factures et son véhicule sur son téléphone.

### Lot 4 — Comptoir et site

- [ ] La page d'inscription en **mode borne** sur tablette : session qui se réinitialise après chaque client.
- [ ] Message de confirmation : « Bravo et merci pour votre enregistrement. Bienvenue chez Ducati Bruxelles.
      Vous pourrez désormais retrouver vos informations et celles de vos achats et de vos véhicules
      directement sur [adresse de l'application] ».
- [ ] Chemin d'encodage manuel pour le vendeur.
- [ ] Intégration de la page d'inscription sur le site public.

**Fait quand** : un client s'enregistre seul sur la tablette et reçoit le message ; le vendeur peut aussi
encoder à la main.

### Lot 5 — Finitions

- [ ] Le questionnaire du site entre dans le même tuyau que les mails.
- [ ] Tri du fichier G8 : passage en « client » des 4 165 contacts facturés (décision D2).
- [ ] Notification interne quand un prospect s'inscrit.

---

## 7. Questions ouvertes (à trancher au Lot 0)

1. **Le site public est-il Shopify ?** Le dépôt contient un constructeur de site et une boutique
   complète avec panier et paiement (`src/modules/web/`, route `/shop/{slug}`). Shopify n'y est
   mentionné qu'en inspiration graphique, il n'existe **aucune intégration**. Si le vrai site est
   Shopify, ce module devient du poids mort et la page d'inscription doit être **intégrable ailleurs**.
2. **Quelles boîtes mail exactement** faut-il écouter, et sous quelle société ?
3. **Le portail vit-il sur le même domaine** que le DMS, ou sur un sous-domaine séparé ?
4. **Que voit un client d'une société par rapport à l'autre** (ITALBIKE STORE et NL INVEST) ?

---

## 8. Risques

1. **Les migrations ne sont pas appliquées** (risque principal). Une migration versionnée n'est **pas**
   appliquée par le déploiement : quelqu'un doit l'exécuter à la main sur Supabase. Le module de reprises
   de juillet est complet dans le code et **mort en production** pour cette seule raison. Chaque lot de
   ce plan dépend d'une migration. Elles doivent être appliquées **et vérifiées** à la fin de chaque lot.
2. **Sécurité du portail.** L'audit signale déjà de nombreuses fonctions sensibles appelables sans être
   connecté. Chaque nouvelle fonction publique doit être écrite avec le minimum de surface.
3. **RGPD.** Créer une fiche et répondre à quelqu'un qui écrit relève de l'intérêt légitime. Le
   démarchage ultérieur demande un consentement : la case va sur le **formulaire d'inscription**, pas
   dans la fiche créée automatiquement. Le champ `contacts.marketing_opt_out` existe déjà.
4. **Volume et boucles.** Listes de diffusion, réponses automatiques, retours d'erreur : prévoir un
   garde-fou avant d'ouvrir la création automatique en production.
