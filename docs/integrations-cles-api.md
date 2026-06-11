# Intégrations & clés API — DMS Ducati Bruxelles

> Liste **globale** des services externes et des secrets nécessaires, par module.
> Règle (CLAUDE.md §5) : les secrets sont fournis par le client et stockés **côté serveur**
> (variables d'env / **Supabase Edge Function secrets**), **jamais commités**, jamais en clair dans le front.
> Statut : ✅ en place · 🟡 à fournir · ⚪ optionnel / plus tard.

| # | Service | Sert à (module) | Clés / secrets | Où | Statut |
|---|---|---|---|---|---|
| 1 | **Supabase** | tout (DB, Auth, Storage, Edge, Realtime) | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, anon key, project ref `ujmrosbgkvgvwfnuryna` | env User (dev) / Supabase | ✅ |
| 2 | **GitHub** | dépôt / CI | `GITHUB_TOKEN` (PAT) | env User | ✅ |
| 3 | **Stripe** | E-shop — paiement en ligne (M11) | `STRIPE_SECRET_KEY` (Edge), `STRIPE_PUBLISHABLE_KEY` (front, optionnel), `STRIPE_WEBHOOK_SECRET` (webhook) | Supabase secrets | 🟡 |
| 4 | **Falco (Peppol)** | Factures sortantes **UBL/Peppol** (M12) | clé/identifiants API Falco + **Peppol participant ID** par société (déjà saisissable dans Paramètres → Sociétés) | Supabase secrets + champ société | 🟡 |
| 5 | **Winbooks** | Export comptable (M12) | format d'import du comptable (gabarit) ; API si transfert auto | (fichier) / Supabase secrets | 🟡 |
| 6 | **Resend** (e-mails) | Confirmations commande e-shop, rappels RDV atelier, relances clients (M8/M10/M11/M12) | `RESEND_API_KEY` + domaine expéditeur vérifié | Supabase secrets | 🟡 |
| 7 | **Passerelle SMS** | Rappels RDV atelier, notifications fin de travaux (M8/M10) | clé API du fournisseur (ex. Twilio / Spryng / MessageBird) + n° expéditeur | Supabase secrets | 🟡 |
| 8 | **Microsoft Graph** | Mail/agenda Microsoft 365 (si intégration) (M10) | `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_TENANT_ID` | Supabase secrets | ⚪ |
| 9 | **OVH — domaine & DNS** | Rattacher un **nom de domaine** à la vitrine publique `/shop/{slug}` (M11) | accès OVH (manager) ; API OVH si automatisation (`OVH_APP_KEY/SECRET/CONSUMER`) | déploiement / OVH | 🟡 |
| 10 | **VIES** (Commission UE) | Validation n° TVA intracom (M1) | aucune clé (service public) | — | ✅ |
| 11 | **Ducati DCS** | Commandes fournisseur Ducati (M4) | **pas d'API** (export Excel imposé STANDARD/URGENTE) | — | ✅ (export fait) |

---

## Détails par intégration

### 3. Stripe (paiement e-shop)
- **Edge Function** `supabase/functions/stripe-checkout` (déjà écrite) crée la session de paiement.
  - Déploiement : `supabase functions deploy stripe-checkout` puis `supabase secrets set STRIPE_SECRET_KEY=sk_...`
  - Tant que la clé n'est pas posée, la commande est enregistrée en **« en attente de paiement »** (dégradé propre).
- **À venir** : `stripe-webhook` (vérifie la signature avec `STRIPE_WEBHOOK_SECRET`, passe la commande en **payée**, génère la facture + sort le stock réel). URL webhook à déclarer dans le dashboard Stripe.
- Clés : `sk_test_…` puis `sk_live_…` ; `pk_…` côté front si Stripe Elements ; `whsec_…` pour le webhook.

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
1. **Stripe** : `sk_test`, puis `sk_live` + `whsec` (webhook). 
2. **Falco** : credentials API + confirmation du Peppol ID par société.
3. **Resend** : `RESEND_API_KEY` + domaine d'envoi.
4. **SMS** : fournisseur choisi + clé API + n° expéditeur.
5. **Winbooks** : un fichier d'import exemple du comptable.
6. **OVH** : le(s) nom(s) de domaine à rattacher (config DNS faite ensemble).
