# Intégrations & clés API — DMS Ducati Bruxelles

> Liste **globale** des services externes et des secrets nécessaires, par module.
> Règle (CLAUDE.md §5) : les secrets sont fournis par le client et stockés **côté serveur**
> (variables d'env / **Supabase Edge Function secrets**), **jamais commités**, jamais en clair dans le front.
> Statut : ✅ en place · 🟡 à fournir · ⚪ optionnel / plus tard.

| # | Service | Sert à (module) | Clés / secrets | Où | Statut |
|---|---|---|---|---|---|
| 1 | **Supabase** | tout (DB, Auth, Storage, Edge, Realtime) | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, anon key, project ref `ujmrosbgkvgvwfnuryna` | env User (dev) / Supabase | ✅ |
| 2 | **GitHub** | dépôt / CI | `GITHUB_TOKEN` (PAT) | env User | ✅ |
| 3 | **Stripe** | **QR de paiement Bancontact / carte sans supplément** au comptoir et lien de paiement à distance (M6, PDV040, 03/11/2026) | `STRIPE_SECRET_KEY` (Edge, `sk_test_…` d'abord), `STRIPE_WEBHOOK_SECRET` (`whsec_…`, webhook) ; optionnel `APP_PUBLIC_URL` (adresse de l'application pour la page de retour) | Supabase secrets | 🟡 code fait, à déployer |
| 4 | **Falco (Peppol)** | Factures sortantes **UBL/Peppol** (M12) | clé/identifiants API Falco + **Peppol participant ID** par société (déjà saisissable dans Paramètres → Sociétés) | Supabase secrets + champ société | 🟡 |
| 5 | **Winbooks** | Export comptable (M12) | format d'import du comptable (gabarit) ; API si transfert auto | (fichier) / Supabase secrets | 🟡 |
| 6 | **Resend** (e-mails) | Confirmations commande e-shop, rappels RDV atelier, relances clients (M8/M10/M11/M12) | `RESEND_API_KEY` + domaine expéditeur vérifié | Supabase secrets | 🟡 |
| 7 | **Passerelle SMS** | Rappels RDV atelier, notifications fin de travaux (M8/M10) | clé API du fournisseur (ex. Twilio / Spryng / MessageBird) + n° expéditeur | Supabase secrets | 🟡 |
| 8 | **Microsoft Graph** | Mail/agenda Microsoft 365 (si intégration) (M10) | `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_TENANT_ID` | Supabase secrets | ⚪ |
| 9 | **OVH — domaine & DNS** | Rattacher un **nom de domaine** à la vitrine publique `/shop/{slug}` (M11) | accès OVH (manager) ; API OVH si automatisation (`OVH_APP_KEY/SECRET/CONSUMER`) | déploiement / OVH | 🟡 |
| 10 | **VIES** (Commission UE) | Validation n° TVA intracom (M1) | aucune clé (service public) | — | ✅ |
| 12 | **Anthropic — Claude API** | Lecture automatique des permis et cartes d'identité (M1, fonction `read-id-doc`) · **analyse des mails entrants** pour créer un prospect (M10, fonction `classify-prospect-email`) | `ANTHROPIC_API_KEY` | Supabase secrets | ✅ **posée le 14/09/2026** |
| 11 | **Ducati DCS** | Commandes fournisseur Ducati (M4) | **pas d'API** (export Excel imposé STANDARD/URGENTE) | — | ✅ (export fait) |

---

## Détails par intégration

### 3. Stripe (QR de paiement au comptoir, lien à distance — PDV040, 03/11/2026)
> Correction : jusqu'au 03/11 ce paragraphe disait « `stripe-checkout` déjà écrite ». C'était faux (rien
> dans le dépôt depuis la suppression du 18/09). Les deux fonctions ont été écrites le 03/11 pour le **QR
> sans supplément** (étude `docs/etudes/2026-11-paiements-comptoir.md` §3, décision du 03/11). L'e-shop
> passe par Shopify Payments (M11), pas par ces fonctions.

- **`supabase/functions/stripe-checkout`** (utilisateur connecté, membre actif) : `status` (clé posée ?
  mode de la clé, réglage société, adresse du webhook), `create` (règlement **attendu** `STRIPE` + session
  Stripe Checkout du **montant exact**, Bancontact / carte / Wero selon Paramètres → Paiement Stripe,
  metadata `company_id` / `document_id` / `payment_id`, retour `/paiement/merci`), `cancel` (session expirée
  chez Stripe puis règlement annulé).
- **`supabase/functions/stripe-webhook`** (appelée par Stripe, sans jeton) : signature `Stripe-Signature`
  vérifiée avec `STRIPE_WEBHOOK_SECRET` (5 min de tolérance), paiement réussi → règlement **reçu** (frais Stripe
  notés à part), session expirée → **annulé**, idempotent (`stripe_events`).
- **Aucun supplément** (art. VII.30 § 3 CDE) : frais Stripe (Bancontact 0,35 €, cartes EEE 1,5 % + 0,25 €) à la
  charge du magasin. **Mode test par défaut** : le réglage société (test / réel) doit correspondre à la clé
  (`sk_test_…` / `sk_live_…`), sinon rien ne part ; sans clé, le bouton est masqué avec un message.
- **Mise en route** (dans cet ordre, après backup, règle 5.0) :
  1. Migration : `npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f supabase/migrations/20261103260000_m6_paiement_stripe.sql`
  2. Fonctions : `npx supabase@2.117.0 functions deploy stripe-checkout --project-ref ujmrosbgkvgvwfnuryna`
     puis `npx supabase@2.117.0 functions deploy stripe-webhook --project-ref ujmrosbgkvgvwfnuryna`
     (`verify_jwt = false` pour les deux dans `supabase/config.toml` : contrôle dans le code).
  3. Secrets : `npx supabase@2.117.0 secrets set STRIPE_SECRET_KEY=sk_test_... --project-ref ujmrosbgkvgvwfnuryna`
     (facultatif : `APP_PUBLIC_URL=https://<adresse de l'application>`).
  4. **Webhook à déclarer chez Stripe** (tableau de bord → Développeurs → Webhooks → Ajouter un endpoint) :
     URL `https://ujmrosbgkvgvwfnuryna.supabase.co/functions/v1/stripe-webhook`, événements
     `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded` ;
     copier le secret de signature puis `npx supabase@2.117.0 secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref ujmrosbgkvgvwfnuryna`.
  5. Paramètres → Paiement Stripe : activer, moyens (Bancontact + carte), mode **Test**.
  6. Passage en réel : clé `sk_live_…` + nouveau webhook en mode live (son propre `whsec_…`), puis mode **Réel**.
- Clés : `sk_test_…` puis `sk_live_…` ; `whsec_…` pour le webhook. Pas de clé publique `pk_…` (Checkout hébergé).

### 4. Falco / Peppol (e-facturation M12)
- L'**UBL** (Peppol BIS 3.0) est déjà généré (bouton « Export UBL » + tests).
- Pour l'**envoi automatique** via Falco : API/credentials Falco + **Peppol participant ID** par société
  (champ « Identifiant Peppol » déjà éditable dans **Paramètres → Sociétés**, ex. `9925:BE0xxxxxxxxx`).
- À clarifier : endpoint/API de dépôt Falco, format attendu (UBL brut vs enveloppe).

### 5. Winbooks (compta M12)
- Export **CSV** journal des ventes déjà fourni ; **aligner les colonnes** sur le gabarit d'import du comptable
  (Winbooks « Actage »). Fournir un fichier exemple attendu.

### 6–7. Resend + SMS (notifications)
- Cas d'usage : e-mail de confirmation de commande e-shop, **rappel RDV atelier la veille** (flag déjà posé),
  notification **fin de travaux**, relances factures impayées.
- Implémentation : Edge Functions `send-email` / `send-sms` + `pg_cron` pour les rappels datés.

### 9. OVH — domaine de la vitrine
- La vitrine publique est servie à `/shop/{slug}` (ex. `/shop/italbike`) **sans authentification**.
- Champ **« Domaine personnalisé (OVH) »** déjà présent dans E-shop → Réglages (stocké sur la boutique ;
  les RPC publiques acceptent slug **ou** domaine).
- **Étape déploiement** : pointer le domaine OVH (enregistrement A/CNAME) vers l'hébergement de l'app, puis
  router `/` du domaine vers `/shop/{domaine}` (réécriture côté hébergeur). Pas de code applicatif requis,
  juste la config DNS + reverse-proxy/redirect.

---

## Récapitulatif « à me fournir »
1. **Stripe** : `sk_test` + `whsec` de test (QR sans supplément, code prêt depuis le 03/11), puis `sk_live` + `whsec` live, compte au nom d'ITALBIKE STORE. 
2. **Falco** : credentials API + confirmation du Peppol ID par société.
3. **Resend** : `RESEND_API_KEY` + domaine d'envoi.
4. **SMS** : fournisseur choisi + clé API + n° expéditeur.
5. **Winbooks** : un fichier d'import exemple du comptable.
6. **OVH** : le(s) nom(s) de domaine à rattacher (config DNS faite ensemble).
7. ~~**Anthropic** : `ANTHROPIC_API_KEY`~~ — **posée le 14/09/2026.** Elle avait toujours manqué,
   ce qui rendait inertes deux fonctionnalités déjà construites : la lecture automatique des permis
   et cartes d'identité (depuis juillet, jamais fonctionnelle en production) et la création de
   prospects à partir des mails. La facturation de l'API est distincte de l'abonnement Claude :
   il faut du crédit sur le compte Anthropic, sinon la clé existe mais les appels échouent.
