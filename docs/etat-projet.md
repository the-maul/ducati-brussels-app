# État du projet — DMS Ducati Bruxelles (document de reprise)

> **À LIRE EN PREMIER dans une nouvelle conversation.** Où on en est, comment travailler,
> les pièges, ce qui reste.
> **Dernière mise à jour : 2026-09-14.** Branche `main`, dernier commit poussé : voir `git log`.
>
> Voir aussi : [`../CLAUDE.md`](../CLAUDE.md) (règles, invariants, glossaire) ·
> [`avancement.md`](avancement.md) (checklist des 140 exigences) ·
> [`plan-nouveau-client.md`](plan-nouveau-client.md) (**chantier en cours**) ·
> [`process-commandes-pieces.md`](process-commandes-pieces.md) (chantier spécifié, non commencé) ·
> [`deploiement-netlify.md`](deploiement-netlify.md) · [`integrations-cles-api.md`](integrations-cles-api.md) ·
> [`../.claude/skills/dev-sur-github/SKILL.md`](../.claude/skills/dev-sur-github/SKILL.md) (protocole Git).

---


> 📖 **Depuis le 18/09/2026, la référence complète est la [bible](bible/README.md)** : un chapitre par
> module, les missions, le journal des décisions. Ce document-ci reste le résumé de reprise.

## 1. Résumé en dix lignes

Les **14 modules ont un cœur fonctionnel réel** et tournent sur la vraie base, avec les données
reprises de G8 : 8 094 contacts, 3 299 véhicules, 17 700 factures historiques, 101 fournisseurs.
L'application est déployée automatiquement sur **Netlify** à chaque push sur `main`.
Lovable a été abandonné et toute mention retirée du code le 10/08.

Le gros du travail de juillet a porté sur le **backlog client Italobike** (37 demandes, 8 lots fusionnés)
et sur les **reprises de motos**. Le 11/09 a été consacré aux **fiches clients** (code automatique,
doublons, actions groupées), au **retour visuel d'enregistrement** et à la **vérification TVA**.

⚠️ **Le point le plus important de ce document est le §2.** Une partie du code parti en production
s'appuie sur des colonnes qui n'existent pas en base. Trois écrans sont cassés sans que ça se voie.

---

## 2. ⚠️ Dérive entre le dépôt et la base — à traiter en priorité

**Une migration versionnée dans `supabase/migrations/` n'est PAS appliquée par le déploiement.**
C'est une étape distincte, manuelle, sur Supabase. Quand elle est oubliée, PostgREST rejette
**tout** l'INSERT ou l'UPDATE en 400 (`PGRST204`), pas seulement le champ nouveau : l'écran entier
devient non enregistrable, sans message clair.

Ce défaut s'est déjà produit trois fois : fiches clients (de juin au 11/09), commandes fournisseur
(jusqu'au 11/09), et vérification TVA. **Il reste actif ailleurs.**

### Vérifié en base le 2026-09-14 — objets absents alors que le code les utilise

| Migration non appliquée | Objets manquants | Conséquence |
|---|---|---|
| `20260716090000_m3_vehicles_papers_100hp` | `vehicles.papers_100hp` | **Aucune fiche véhicule enregistrable** : le formulaire envoie ce champ à chaque écriture |
| `20260720130000_m2_article_year_facets` | `articles.year_from`, `year_to`, fonction `article_facets` | **Aucune fiche article enregistrable** : même cause |
| `20260716090000_m7_tradein_partners` | tables `tradein_partners`, `tradein_offers`, `companies.tradein_dispatch_mode` | Partenaires et offres de reprise inopérants |
| `20260719120000_m7_tradein_validation` | `oro.tradein_status`, `checklist`, et le bloc de validation | Validation de reprise inopérante |
| `20260720090000_m7_reprise_workflow` | `oro.dispatched_at`, `accepted_amount`, `best_offer_amount`, `leads.oro_id`, `leads.reprise_status` | Workflow de reprise inopérant |
| `20260714090000_m2_import_settings_ppc_rules` | tables `article_import_settings`, `ppc_price_rules`, `companies.price_floor_min/threshold` | Réglages d'import tarifaire repliés sur un stockage local par poste |
| `20260613300000_m1_contacts_private_block` | bloc d'adresse privée sur `contacts` | Sans effet : **aucun code ne s'en sert**, migration morte |

> **Tout le chantier « reprises » de juillet** (assistant mobile, statuts, envoi aux marchands,
> acceptation d'offre) est **complet dans le code et mort en production** pour cette seule raison.

### Comment vérifier (ne pas se fier à l'historique Supabase)

La table `supabase_migrations.schema_migrations` **n'est pas fiable** : une migration passée à la main
dans l'éditeur SQL n'y est pas enregistrée. Seule la **présence réelle des objets** fait foi :

```sql
select to_regclass('public.tradein_partners') is not null as table_presente;
select exists(select 1 from information_schema.columns
              where table_schema='public' and table_name='vehicles' and column_name='papers_100hp');
```

### Règle à appliquer désormais

1. Toute migration écrite est **appliquée et vérifiée** avant de clore le lot.
2. Le tableau « Migrations Supabase — état d'application » de [`avancement.md`](avancement.md) est tenu à jour.
3. Un `PATCH` en 400 sans erreur Postgres associée dans `edge_logs` = signature d'une colonne inconnue.

---

## 3. Où on en est, par module

| Module | État | Ce qui est démontrable |
|---|---|---|
| **M0 Socle** | ✅ | Login, multi-société, rôles + RLS, audit append-only, séquences de numérotation, tables de paramètres, **utilisateurs équipe et clients**, **invitation par e-mail**, **choisir / changer son mot de passe** |
| **M1 Contacts** | ✅ | Fiche parité G8, **code client automatique**, **détection de doublons**, **suppression sûre**, **actions groupées** (archiver, statut, drapeaux, lier, fusionner), VIP et surveillance, liaison pro/privé, **vérification TVA VIES** |
| **M2 Articles & tarifs** | 🟦 | Référentiel A–R/T, PAMP, casiers, code-barres, familles en cascade, import tarifs, applicabilités, étiquettes · **bloqué** : enregistrement d'un article (§2) |
| **M3 Véhicules** | 🟦 | Fiche VIN parité G8, parc, historique propriétaires, extension My Ducati (moto, garantie, entretiens, bulletins) · **bloqué** : enregistrement d'un véhicule (§2) |
| **M4 Achats & réceptions** | ✅ | Fournisseurs, réception → stock + PAMP, châssis → véhicule, échéancier, proposition de commande, export DCS |
| **M5 Stock & inventaire** | ✅ | Triple stock, mouvements append-only, 3 modes d'inventaire, tournant, copies datées, dépréciation, étiquetage différé |
| **M6 Ventes & POS** | ✅ | Devis → facture, avoirs, encaissement multi-modes, clôture Z, picking list, facture PDF au format de la concession |
| **M7 Reprise / Occasion** | 🔴 | Code complet : assistant mobile, photos, PDF, statuts, marchands, dépôt-vente, TVA marge · **inopérant en production** (§2) |
| **M8 Atelier** | ✅ | OR cycle complet, garantie avec refus partiel, chronos, planning, moto accidentée et aide Ducati 15 % |
| **M9 Documents / GED** | 🟦 | Pièces jointes, dossiers, glisser-déposer, 716 factures d'origine attachées, CGV · reste : signature électronique |
| **M10 CRM** | 🟦 | **CRM commercial** en onglet (atelier prévu), cartes avec une seule tâche à la fois, échanges et réponse par mail depuis la carte, **note résumée automatiquement à chaque échange**, mails Outlook entrants et sortants, matching client ↔ moto en stock · reste : CRM atelier, campagnes, SMS |
| **M11 Site & e-shop** | 🟡 | Constructeur de site, vitrine publique, panier, Stripe bouclé en test · **à trancher** : le vrai site est-il Shopify ? |
| **M12 Compta** | 🟡 | PCMN, écritures équilibrées, registre TVA, TVA marge VO, SEPA, clôture, export Winbooks · reste : Falco live, gabarit du comptable |
| **M13 Reporting** | ✅ | Tableau de bord, CA 12 mois, top articles, productivité atelier, comparaison N-1 |
| **M14 Migration G8** | ✅ | Imports clients, fournisseurs, véhicules, factures, avec détail des lignes et PDF d'origine |

Légende : ✅ utilisable · 🟦 cœur fait, finitions en cours · 🟡 en attente d'une clé ou d'une décision · 🔴 cassé en production.

### Qualité du code

21 erreurs TypeScript subsistent au 11/09, contre 78 avant. Trois d'entre elles viennent
directement des migrations non appliquées du §2.

---

## 4. Comment travailler

### Cycle pour une fonctionnalité

1. **Demander un backup** si le changement est conséquent. Règle absolue, voir
   [`../CLAUDE.md`](../CLAUDE.md) §5.0 et le skill `dev-sur-github`.
2. Écrire le code dans `src/`, la migration dans `supabase/migrations/`.
3. **Appliquer la migration à la main sur Supabase**, puis régénérer `src/integrations/supabase/types.ts`.
4. **Vérifier la présence réelle des objets en base** (§2).
5. Builder : le build doit passer avant tout push.
6. Tester, y compris les tests automatisés.
7. Commit au format imposé (voir ci-dessous), `git fetch` + `git rebase origin/main`, puis push.
8. Mettre à jour [`avancement.md`](avancement.md).

### Format des messages de commit — imposé

Le CRM du client publie **la ligne de sujet telle quelle** comme intitulé de tâche. Elle doit donc
commencer par ce que le changement fait dans l'application, en français courant :

```
<Ce que ça change pour l'utilisateur> — type(scope): description CODE
```

Exemple : `Fiches clients : le bouton Enregistrer reste grisé tant que rien n'a changé — feat(ux): useIsDirty`

Le corps du message reste technique, il n'est pas publié.

### Commandes

```bash
npm install          # ou bun install
npm run build        # juge de paix, doit passer avant tout push
npm run dev          # serveur de développement
npm run lint
bun test             # 26 fichiers de tests ; il n'y a pas de script npm "test"
npx tsc --noEmit     # 21 erreurs connues au 14/09
```

Stack : **TanStack Start** en rendu serveur, React 19, Vite 7, Tailwind 4, shadcn/ui,
Supabase, Bun. Les routes sont fichier par fichier dans `src/routes/` ; `routeTree.gen.ts` est
**généré, ne pas l'éditer**. La logique métier vit dans `src/modules/<module>/`.

---

## 5. Déploiement et intégrations

- **Netlify**, branché sur `main` : chaque push reconstruit le site. Commande `bun run build`,
  publication depuis `dist/`. Configuration dans [`../netlify.toml`](../netlify.toml).
  Netlify ne renvoie **aucun statut à GitHub** : un build cassé ne se voit pas depuis le dépôt.
  Le compte est un compte privé détenu par l'intégrateur.
  **Adresse publique de l'application : https://ducatilive.netlify.app**
- **Supabase** : base, authentification, stockage, fonctions serveur, `pg_cron`.
- **Fonctions serveur déployées** : `outlook-poll` (relève des mails, plusieurs boîtes),
  `classify-prospect-email` (analyse d'un mail inconnu par Claude), `graph-send-email` (envoi réel),
  `summarize-exchange` (un paragraphe par échange dans la note de la demande, par Claude),
  `send-account-invitation` (invitation à choisir son mot de passe, envoyée par Outlook),
  `mailbox-diag` (diagnostic en lecture d'une boîte Outlook),
  `dispatch-notifications` (file d'attente, pointe vers Resend sans clé donc inactive),
  `read-id-doc` (lecture de pièces d'identité par Claude), `vies-check` (TVA),
  `stripe-checkout`, `stripe-webhook`.
- **Clé `ANTHROPIC_API_KEY` posée le 14/09/2026.** Elle avait toujours manqué : `read-id-doc`,
  construite en juillet, répondait « non configurée » depuis le premier jour et n'a jamais
  fonctionné en production. Les deux fonctions qui appellent Claude marchent désormais.
- **CRM du client** : un webhook envoie chaque push au CRM, qui crée une tâche « à valider ».
  Fonctionne depuis le 11/09. C'est la raison du format de commit imposé.

### ⚠️ Authentification Supabase mal configurée

L'URL du site est encore `http://localhost:3000` et la liste des redirections autorisées pointe
vers d'anciennes adresses Lovable. Conséquence : les e-mails de réinitialisation **envoyés par
Supabase lui-même** envoient les utilisateurs au mauvais endroit. À corriger dans le tableau de
bord Supabase (Authentication → URL Configuration) : URL du site `https://ducatilive.netlify.app`.

**Les invitations de l'écran Utilisateurs ne sont pas concernées** (18/09) : elles sont envoyées
par Outlook et leur lien mène directement à `/reset-password` de l'application, avec un jeton à
usage unique consommé seulement à la validation du formulaire.

### Sécurité — signalé par l'audit Supabase

- 90 fonctions `SECURITY DEFINER` appelables sans être connecté, et autant par un utilisateur connecté.
- Protection contre les mots de passe compromis désactivée.
- Extension `pg_net` installée dans le schéma public.

À revoir avant l'ouverture d'un portail client.

---

## 6. Pièges connus

1. **Migrations non appliquées** : le piège n°1, voir §2.
2. **Apostrophes et guillemets courbes** : il n'y a pas de build local systématique ; un guillemet
   courbe dans du code source casse le build Netlify sans prévenir. Vérifier le diff avant de commiter.
   Les fichiers `.md` ne sont pas concernés.
3. **`routeTree.gen.ts`** est régénéré en continu : ne pas le modifier à la main.
4. **Tailwind 4** : pas d'import relatif d'un CSS local ; `tokens.css` est chargé par un lien séparé.
   Couleurs en `oklch` uniquement.
5. **Énumérations Postgres** : `ALTER TYPE ... ADD VALUE` doit être dans sa propre migration.
6. **Plusieurs personnes poussent sur `main`** : toujours `git fetch` puis `git rebase origin/main`
   avant de pousser. Jamais de push forcé.
7. **Verrou Supabase** : ne jamais appeler une méthode Supabase à l'intérieur de `onAuthStateChange`,
   cela bloque l'application au rechargement.
8. **Statut « prospect »** : les 8 094 contacts repris de G8 le portent tous. Le tri est prévu au
   chantier en cours, voir [`plan-nouveau-client.md`](plan-nouveau-client.md).

---

## 7. Chantiers

### En cours — Nouveau client

Acquisition des prospects par mail, site, comptoir et téléphone, puis compte client et portail.
Plan détaillé, décisions et découpage en lots : [`plan-nouveau-client.md`](plan-nouveau-client.md).

**Fait et en production (au 18/09/2026)** :

- **Capture des mails** sur quatre boîtes (domenico@, info@, shop@, occasions@). Un expéditeur
  inconnu qui fait une demande devient une fiche **prospect** avec une carte CRM ; les formulaires
  du site relayés par Shopify sont reconnus. Un mail ne peut plus se perdre en cas d'erreur.
- **Carte CRM** : une seule tâche ouverte à la fois (garanti en base, jamais de carte en double),
  trois sorties « C'est fait » / « Modifier la tâche » / « Archiver la carte », historique des
  tâches, documents, suivi nominatif, cloche des demandes en retard.
- **Échanges** : réponse par mail depuis la carte. La boîte proposée par défaut est **celle qui a
  reçu le mail du client** ; on peut choisir une autre boîte partagée ou **sa propre adresse**.
  Un envoi depuis une adresse personnelle est enregistré dans la carte au moment de l'envoi.
- **Note de la demande** : chaque nouvel échange (mail, appel, SMS) y ajoute automatiquement un
  paragraphe daté qui résume où en est la demande. Jamais deux fois le même.
- **Plusieurs CRM** : chaque demande appartient à un CRM. Seul le **CRM commercial** existe ; le
  CRM atelier s'ajoutera sans refonte.
- **Utilisateurs** (Paramètres → Utilisateurs) : comptes **équipe** (rôles existants : commercial =
  vendeur, technicien = mécanicien / chef d'atelier, manager = administrateur) et comptes
  **client** rattachés à leur fiche, créée au besoin. Mot de passe fixé par l'administrateur, ou
  **invitation par e-mail** pour que la personne choisisse le sien. Chacun peut changer son mot
  de passe depuis le menu utilisateur.
- **Responsable par défaut** des nouvelles demandes du CRM commercial, réglable dans le même écran,
  avec reprise optionnelle des tâches en cours de l'ancien responsable.

**Reste** : écran de fusion des doublons de clients, portail client (lot 3), borne comptoir et
questionnaire du site (lot 4), CRM atelier.

### Spécifié, non commencé — Commandes de pièces

Nouveau classement des commandes en `urgente / standard / excel / accident`, écrans de proposition,
agrégation par fournisseur, paiement par QR, terminal Bancontact, signature électronique,
classeur Excel Ducati. Spécification complète : [`process-commandes-pieces.md`](process-commandes-pieces.md).

### À reprendre — Réparations

Appliquer les migrations du §2, en commençant par les véhicules et les articles qui bloquent
l'enregistrement, puis le module de reprises.

---

## 8. En attente du client

| Élément | Pour quoi |
|---|---|
| Clé Stripe de production | Paiement réel sur la boutique |
| Identifiants Falco | Envoi réel des factures au format Peppol |
| Fournisseur SMS et clé | Rappels de rendez-vous, notifications de fin de travaux |
| Fichier d'exemple du comptable | Calage exact de l'export Winbooks |
| IBAN de la concession | QR code de virement au comptoir |
| Marque et modèle du terminal Bancontact | Encaissement au comptoir |
| Décision sur le site public | Shopify ou la vitrine intégrée au DMS |
