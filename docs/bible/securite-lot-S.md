# Lot sécurité S — fermer l'accès sans connexion

> Préparé le 19/09/2026 sur la branche `lot-securite`. **Rien n'est appliqué** : ni migration,
> ni fonction serveur, ni secret. Ce document dit quoi appliquer, dans quel ordre, comment
> vérifier et comment revenir en arrière.
> Répond à l'alerte n°1 et à l'alerte n°6 du [README](README.md), à [`00-architecture.md`](00-architecture.md) §9
> et à l'alerte 🔴 « boîtes Outlook » de [M10](modules/M10-crm.md).

## 1. Ce qui est corrigé, en une phrase par point

| # | Avant | Après | Fichier |
|---|---|---|---|
| S1 | 95 fonctions de la base (102 avant le nettoyage e-shop du 18/09) appelables avec la seule clé publique : clôture comptable, paiement SEPA, mouvements de stock, lecture du fichier client… | Plus aucune, sauf `is_member` et `is_admin` (justifié §3). 22 fonctions internes réservées en plus à la clé de service. | `supabase/migrations/20260919100000_securite_s1_droits_execution.sql` |
| S2 | 6 fonctions sans contrôle de société : un compte connecté sans rôle (futur client du portail) lisait l'encours d'un client, le stock, les conditions tarifaires de n'importe quelle société. | Garde `(auth.uid() is null or is_member(société))` ajoutée. | `…100100_securite_s2_gardes_societe.sql` |
| S3 | « Désactiver » un compte ne coupait rien ; le salarié pouvait même se réactiver lui-même par l'API. | `is_member` / `has_role` / `is_admin` exigent un profil actif ; le profil n'est plus modifiable que sur nom, téléphone, société par défaut. | `…100200_securite_s3_comptes_desactives.sql` |
| S4 | Tout salarié pouvait ajouter une boîte Outlook « écoutée » (lire la boîte d'un collègue, envoyer en son nom). | Lecture : membres. Ajout / modification / suppression : administrateurs. | `…100300_securite_s4_boites_mail_admin.sql` |
| S5 | pg_cron appelait `outlook-poll` et `dispatch-notifications` avec la clé publique ; n'importe qui pouvait les déclencher. | Appel avec l'en-tête `x-cron-secret`, lu dans le coffre Vault. | `…100400_securite_s5_cron_secret.sql` |
| S6 | `read-id-doc`, `classify-prospect-email`, `mailbox-diag` sans aucun contrôle ; `outlook-poll`, `dispatch-notifications` ouverts. | Contrôle d'accès dans le code (clé de service, secret pg_cron, ou membre actif de la société). | `supabase/functions/_shared/acces.ts` + les 5 fonctions |
| S7 | `supabase/config.toml` ne déclarait que 4 fonctions sur 11. | Les 11 déclarées, conformes à l'état déployé (§8). | `supabase/config.toml` |
| — | — | Retour arrière, section par section. | `supabase/rollbacks/20260919109999_securite_lot_s_ROLLBACK.sql` (**hors** du dossier migrations, exprès) |

## 2. Ce qui a été vérifié avant d'écrire (lecture seule, 19/09)

- Inventaire complet de `pg_proc` (droits, `SECURITY DEFINER`, présence d'un contrôle de société).
- Appels réels dans le code : les 66 fonctions appelées par `supabase.rpc(...)` dans `src/` et les
  Edge Functions. Aucune des 22 fonctions passées « clé de service » n'est appelée par le navigateur.
- Dépendances : aucune vue, colonne par défaut ou index n'utilise une fonction retirée ; seules
  `is_member` / `is_admin` sont utilisées dans des politiques RLS applicables à anon.
- Pages sans connexion : `/login` et `/reset-password` n'appellent **aucune** fonction SQL (seulement
  `supabase.auth.*`) ; `/reset-password` lit `user_roles` une fois la session ouverte.
- **Répétition générale** : S1 à S4 exécutées pour de vrai dans une transaction annulée
  (`raise exception 'ROLLBACK_TEST'`), puis 50 appels simulés sous 6 identités (anonyme, connecté
  sans rôle, membre, administrateur, administrateur désactivé, clé de service). Résultat conforme
  (§6.3). Aller-retour migration + retour arrière : droits identiques à l'état de départ.
- La base bouge pendant qu'on écrit : le 18/09 au soir, les migrations `m1_public_signup`,
  `m0_portail_client` (22 fonctions `portal_*` / `signup_*`, déjà fermées à anon) et
  `cleanup_remove_eshop_improvements` (e-shop supprimé) ont été passées. S1 est écrite de façon
  générique (boucle sur toutes les fonctions) et **refaire la répétition générale juste avant
  d'appliquer** reste prudent (§5, étape 1).

## 3. Exceptions laissées ouvertes à la clé publique (anon)

| Fonction | Pourquoi elle reste ouverte | Risque |
|---|---|---|
| `is_member(uuid)` | Utilisée dans 23 politiques RLS déclarées pour le rôle `{public}` (donc aussi évaluées pour anon) et, par la table `articles`, dans la politique de stockage `ged_public_products`. Sans le droit, une requête anonyme sur ces tables échouerait (« permission denied for function ») au lieu de renvoyer zéro ligne. | Nul : pour anon, `auth.uid()` est nul, la fonction renvoie toujours `false`. |
| `is_admin(uuid)` | Même raison : utilisée dans des politiques RLS de `articles`, `contacts`, `companies`, `vehicles`… dont certaines sont déclarées pour `{public}`. | Nul, même raisonnement. |
| `unaccent(...)` ×4 | Fonctions de l'extension, propriété de `supabase_admin` : postgres ne peut pas les modifier. | Nul (retire les accents d'un texte). |

**Fermées volontairement** : les fonctions de l'e-shop (`shop_public_*`, `place_web_order`,
`web_order_public_status`) — décision W-1, et elles ont de toute façon été supprimées de la base
le 18/09. Les nouvelles fonctions de l'inscription publique (`signup_*`) étaient déjà réservées à
la clé de service : inchangé.

**À retenir pour la suite** : S1 retire aussi le droit « par défaut ». Une fonction créée demain
ne sera **pas** appelable sans connexion. Si un lot (portail, inscription) en a besoin, sa
migration doit l'écrire : `grant execute on function public.<nom>(<types>) to anon;` avec un
commentaire qui justifie.

## 4. Détail des corrections

### S1 — Droits d'exécution
- Boucle sur les 126 fonctions de `public` appartenant à postgres : `revoke … from public, anon`,
  `grant … to service_role`, et `grant … to authenticated` **seulement si** authenticated l'avait
  déjà (on ne rouvre pas les fonctions déjà réservées, ex. `pending_exchange_summaries`, `portal_*`
  internes).
- Copie des droits d'avant dans `securite_lot_s.acl_avant_s1` (schéma non exposé par l'API) :
  c'est ce qui permet un retour arrière exact.
- **22 fonctions internes → clé de service uniquement** (un connecté sans rôle pouvait les appeler) :
  - tâches planifiées : `_cron_appointment_reminders`, `_cron_dormant_alert`,
    `_cron_invoice_reminders`, `_cron_maybe_stock_copy`, `_cron_stock_copies` ;
  - variantes sans contrôle : `_next_document_number_unchecked` (un client du portail pouvait
    **consommer des numéros de facture**, trou dans la numérotation), `_recompute_paid_unchecked` ;
  - aides comptables et stock : `_account_label`, `_accounting_cutover`, `_doc_margin`,
    `resolve_account`, `resolve_journal`, `bin_stock`, `learn_ducati_vds` ;
  - relève Outlook : `ingest_email`, `ingest_inbound_email`, `set_inbound_cursor`,
    `set_mail_cursors`, `set_mailbox_cursors`, `create_prospect_from_email`, `log_ignored_email`,
    `contacts_match_candidates` (ces trois dernières créaient fiches et demandes CRM dans
    n'importe quelle société).
- Privilèges par défaut : `revoke execute on functions from public` (postgres) et `from anon`
  (schéma public).

### S2 — Contrôle de société ajouté
`contact_encours`, `article_stock`, `or_worked_minutes`, `default_assignee` (lecture : aucune ligne,
zéro ou null pour un non-membre), `transfer_stock_on_replace` (exception « Accès refusé », et refus
si les deux articles ne sont pas de la même société), `resolve_customer_price` (la fonction
d'origine est renommée `_resolve_customer_price_unchecked`, une enveloppe contrôle puis l'appelle :
pas de recopie des 60 lignes de calcul).

Les fonctions d'**écriture** `SECURITY DEFINER` (stock, paiement, clôture, numérotation) ont été
testées avec un utilisateur connecté **sans rôle** : toutes refusent (« Accès refusé ») —
`record_stock_move`, `record_price_change`, `record_inventory_count`, `enqueue_label`,
`reset_real_stock`, `generate_stock_snapshot`, `reintegrate_snapshot`, `next_document_number`,
`recompute_document_paid`, `record_sepa_collection`, `record_sepa_unpaid`, `close_fiscal_year`,
`set_accounting_cutover`, `generate_accounting_entries`, `generate_auxiliary_accounts`,
`recompute_oro_and_vehicle`, `enqueue_notification`, `create_company`, `contact_delete_safe`.
Seules passaient les fonctions internes listées plus haut (certaines n'échouaient que par accident, faute de compte réel dans le test), désormais fermées par S1.

Les 30 gardes existantes écrites `auth.uid() is null or …` / `auth.uid() is not null and …` ne
sont **pas** réécrites : depuis S1, `auth.uid()` nul ne peut plus venir que de la clé de service,
de pg_cron ou d'une autre fonction serveur. Les durcir (tester explicitement le rôle
`service_role`) est une amélioration possible, pas une urgence.

### S3 — Comptes désactivés
- `is_member` et `has_role` joignent `profiles` et exigent `is_active` ; `is_admin` suit.
  Effet **immédiat**, même si le jeton de l'utilisateur est encore valide.
- Choix « fermé par défaut » : un compte sans profil n'est membre de rien (0 cas au 19/09).
- `profiles` : `UPDATE` limité à `full_name`, `phone`, `default_company_id`.
- **Coût mesuré** (transaction annulée, `select count(*) from contacts`, 8 108 lignes, politique
  RLS évaluée ligne à ligne) : **130 ms → 212 ms** (+60 %, environ 10 µs par ligne). Deux variantes
  (EXISTS imbriqué, plpgsql) ne font pas mieux (211 ms, 234 ms). Les écrans paginés et les
  recherches par fonction (`contacts_search` appelle `is_member` une seule fois) ne sont pas
  sensiblement touchés ; seuls les parcours complets d'une grande table le sont.
- Le portail client (`_portal_ctx`) contrôlait déjà `is_active` de son côté.
- Recommandé en complément (non fait) : à la désactivation, bannir aussi le compte dans Supabase
  Auth (`auth.admin.updateUserById(id, { ban_duration: '876000h' })` dans
  `src/lib/auth/admin.functions.ts`, `setUserActive`) pour bloquer la connexion elle-même.

### S4 — Boîtes Outlook
Politique unique `company_mailboxes_all` remplacée par 4 politiques (lecture membres, écriture
admin). Aucun écran n'écrit aujourd'hui dans la table. Reste à vérifier côté Microsoft 365 : une
stratégie d'accès Exchange limitant l'application Azure aux 4 boîtes (défense indépendante du DMS).

### S5 / S6 — Fonctions serveur
Module commun `supabase/functions/_shared/acces.ts` :
- **clé de service** : `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (comparaison en temps constant) ;
- **pg_cron** : en-tête `x-cron-secret` égal au secret `CRON_SECRET` (32 caractères minimum ; secret
  absent = refus) ;
- **utilisateur** : jeton vérifié par `GET /auth/v1/user`, puis rôles dans `user_roles` et
  `profiles.is_active = true`. La clé anon n'est pas un utilisateur : refusée.

| Fonction | Qui est accepté | Réponse sinon |
|---|---|---|
| `read-id-doc` | clé de service ; membre actif de la société de **chaque** fichier (1er segment du chemin GED) | 401 / 403, chemin avec `..` : 400 |
| `classify-prospect-email` | clé de service (appel normal par `outlook-poll`) ; membre actif de `companyId` passé dans le corps | 401 / 403 |
| `mailbox-diag` | clé de service ; membre actif de la société de la boîte | 401 / 403 |
| `outlook-poll` | secret pg_cron ; clé de service ; membre actif d'au moins une société (bouton de la fiche contact) | 403 |
| `dispatch-notifications` | secret pg_cron ; clé de service | 403 |

Pourquoi un secret partagé plutôt que la clé de service dans pg_cron : c'est la solution la plus
simple qui ne met pas la clé « toute puissance » dans la base, et la valeur n'apparaît nulle part
en clair (ni dans `cron.job.command`, ni dans le dépôt).

## 5. Ordre d'application

> **Règle CLAUDE.md §5.0** : demander au client si l'on fait un backup, et attendre sa réponse,
> avant l'étape 1. Faire aussi une sauvegarde de la base (Supabase → Database → Backups).

1. **Refaire la répétition générale** sur la base du jour : exécuter le contenu de S1 à S4 dans un
   bloc `DO $$ … raise exception 'ROLLBACK_TEST'; $$` (rien n'est conservé). Si une fonction citée
   par S1 a disparu ou changé de signature, la migration échoue sur la ligne concernée : l'adapter.
2. **Appliquer S1, S2, S3, S4** (dans cet ordre, ensemble). Puis §6.1 et §6.2.
3. **Tester l'application** avec un compte membre non administrateur (§6.4). En cas de casse, voir §7.
4. **Créer le secret pg_cron** (valeur aléatoire, 32 caractères minimum, ne jamais la commiter) :
   ```sql
   select vault.create_secret('<VALEUR>', 'cron_secret', 'En-tête x-cron-secret des tâches pg_cron');
   ```
   ```bash
   npx supabase@2.117.0 secrets set CRON_SECRET=<VALEUR> --project-ref ujmrosbgkvgvwfnuryna
   ```
5. **Appliquer S5** (échoue exprès si le secret Vault manque). Les anciennes fonctions ignorent
   l'en-tête : rien ne casse entre les étapes 5 et 6.
6. **Déployer les 5 fonctions** (le dossier `_shared` est emporté automatiquement par le CLI ; avec
   l'outil MCP `deploy_edge_function`, joindre `../_shared/acces.ts`) :
   ```bash
   for f in classify-prospect-email outlook-poll dispatch-notifications read-id-doc mailbox-diag; do
     npx supabase@2.117.0 functions deploy $f --project-ref ujmrosbgkvgvwfnuryna --use-api
   done
   ```
   `config.toml` porte désormais `verify_jwt` pour les 11 fonctions : plus besoin de
   `--no-verify-jwt`, et un redéploiement ne change plus leur comportement.
7. Vérifications §6.5 et §6.6, puis régénérer `src/integrations/supabase/types.ts`
   (`resolve_customer_price` a été recréée, même signature).

## 6. Vérifications après application

### 6.1 Anon ne peut plus rien exécuter (éditeur SQL)
```sql
select p.proname
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and has_function_privilege('anon', p.oid, 'EXECUTE')
 order by 1;
-- Attendu : is_admin, is_member, unaccent, unaccent, unaccent_init, unaccent_lexize. Rien d'autre.
```

### 6.2 Droits, politiques, profil
```sql
-- Fonctions fermées aux connectés (clé de service uniquement) : les 22 de S1 + celles déjà
-- réservées avant (pending_exchange_summaries, append_lead_exchange_note, next_contact_code,
-- set_contact_code, signup_*, _portal_* internes…) + _resolve_customer_price_unchecked.
select p.proname from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and not has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1;

select policyname, cmd from pg_policies where tablename = 'company_mailboxes' order by 1;
-- Attendu : company_mailboxes_delete, _insert, _select, _update (plus de _all).

select has_column_privilege('authenticated', 'public.profiles', 'is_active', 'UPDATE') as peut_se_reactiver,
       has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') as peut_changer_son_nom;
-- Attendu : false, true.

select count(*) from securite_lot_s.acl_avant_s1;   -- copie des droits d'avant : > 0
```

### 6.3 Preuve par simulation (rien n'est conservé)
Remplacer `<MEMBRE>` par l'identifiant d'un compte membre et `<SOCIETE>` par sa société.
```sql
do $$
declare r text := ''; n bigint; co uuid := '<SOCIETE>';
begin
  -- 1. anonyme : doit être refusé
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin
    perform public.close_fiscal_year(co, '2020-01-01', '2020-12-31', 'test');
    r := r || ' | ANON A PU CLOTURER (!)';
  exception when others then r := r || ' | anon refusé : ' || sqlerrm; end;
  select count(*) into n from public.contacts;
  r := r || ' | anon voit ' || n || ' contacts (attendu 0)';
  execute 'reset role';
  -- 2. membre : doit fonctionner
  perform set_config('request.jwt.claims', '{"sub":"<MEMBRE>","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.contacts;
  r := r || ' | membre voit ' || n || ' contacts (attendu > 0)';
  r := r || ' | numéro : ' || public.next_document_number(co, 'FAC');
  execute 'reset role';
  raise exception 'ROLLBACK_TEST %', r;   -- annule tout, y compris le numéro consommé
end $$;
```
Résultat de la répétition du 19/09 (extrait) : anon → « permission denied » sur
`contacts_search`, `close_fiscal_year`, `record_stock_move`, `_cron_invoice_reminders` ; anon voit
0 contact, 0 article, 0 objet de stockage ; connecté sans rôle → refusé sur les 8 fonctions
internes, 0 ligne sur l'encours, le stock, l'OR ; membre → 8 108 contacts, encours, stock, prix,
numéro de facture, mouvement de stock, remplacement de référence, déclencheurs d'audit : OK ;
membre non admin → ne peut ni ajouter ni modifier une boîte mail, ne peut pas se réactiver ;
admin désactivé → 0 contact, `is_admin` faux, numérotation refusée ; clé de service → tout passe.

### 6.4 Parcours à cliquer dans l'application (compte membre non administrateur)
Clients : liste, recherche, fiche (encours de crédit). Pièces : fiche article (triple stock),
remplacement de référence. Ventes : nouvelle facture avec un client à conditions tarifaires
(prix client), numéro attribué. Atelier : chrono d'un OR (minutes travaillées). CRM : demande
(responsable par défaut), réponse par e-mail (liste des boîtes), bouton « relever » de la fiche
contact. Contacts : lecture automatique d'une pièce d'identité. Stock : inventaire, arrêté.
Comptabilité (compte comptable) : journaux, génération des écritures.

### 6.5 Fonctions serveur (terminal ; `ANON` = clé publique du site)
```bash
U=https://ujmrosbgkvgvwfnuryna.supabase.co
for f in read-id-doc classify-prospect-email mailbox-diag outlook-poll dispatch-notifications; do
  echo "$f : $(curl -s -o /dev/null -w '%{http_code}' -X POST $U/functions/v1/$f \
    -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -d '{}')"
done
# Attendu : 401 ou 403 partout (avant : 200 / 400 / 500).
curl -s -X POST $U/rest/v1/rpc/debtors_list -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d '{"_company":"00000000-0000-0000-0000-000000000000","_as_of":"2026-01-01"}'
# Attendu : code 42501 « permission denied for function debtors_list ».
```

### 6.6 Tâches planifiées (20 minutes après l'étape 6)
```sql
select jobname, command like '%x-cron-secret%' as avec_secret, command like '%eyJ%' as cle_en_clair
  from cron.job where jobname in ('outlook-poll', 'dispatch-notifications');
-- Attendu : avec_secret = true, cle_en_clair = false.

select status_code, count(*) from net._http_response
 where created > now() - interval '20 minutes' group by 1;
-- Attendu : 200 uniquement. Des 403 = secret Vault ≠ secret CRON_SECRET des fonctions.

select max(occurred_at) from public.communications where channel = 'email';
-- Doit continuer d'avancer (la relève Outlook tourne).
```

## 7. Risques de casse et comment les détecter

1. **Un appel oublié vers une fonction fermée.** Un écran, une fonction serveur Netlify, un script
   ou un lot en cours (portail, inscription) appelle avec la clé publique ou un compte connecté une
   des 22 fonctions passées « clé de service », ou une fonction publique future sans `grant`.
   *Symptôme* : erreur « permission denied for function X » (code 42501, HTTP 401/403 de PostgREST).
   *Détection* : Supabase → Logs → Postgres / API, filtre `permission denied for function` ;
   console du navigateur. *Correction* : rollback ciblé 1.b (un seul `grant`), jamais le retour
   complet.
2. **Relève Outlook et notifications arrêtées sans bruit.** Secret Vault et secret `CRON_SECRET`
   différents, ou fonctions déployées avant le secret, ou `_shared` absent au déploiement → 403 /
   500 à chaque passage ; plus aucun mail n'entre dans le CRM. *Détection* : §6.6
   (`net._http_response`, date du dernier e-mail), journal de la fonction dans Supabase.
   *Correction* : recréer le secret identique des deux côtés ; en dernier recours, section S5 du
   rollback **avec les anciennes fonctions**.
3. **Un salarié perd tout l'accès.** Compte désactivé par erreur, ou compte sans ligne `profiles`
   (0 au 19/09, mais un compte créé hors de l'écran Utilisateurs n'en aurait pas) : écrans vides,
   aucune erreur visible. Et ralentissement des parcours complets de grandes tables (+60 %).
   *Détection* :
   ```sql
   select ur.user_id, p.id is null as sans_profil, p.is_active
     from public.user_roles ur left join public.profiles p on p.id = ur.user_id
    where p.id is null or not p.is_active;
   ```
   *Correction* : réactiver le profil (écran Utilisateurs) ou créer la ligne `profiles`.

Autres effets connus, sans gravité :
- `read-id-doc` refusé (403) s'affiche dans l'interface comme « fonction non installée »
  (`src/modules/contacts/id-docs.tsx` ne distingue pas les codes) : message trompeur, pas de perte.
- `contact_encours` renvoie désormais **aucune ligne** pour un client inconnu (avant : une ligne de
  zéros) ; le front traite déjà ce cas comme des zéros.
- Une future migration qui recrée une fonction avec `create or replace` garde ses droits ; une
  fonction **nouvelle** n'est plus ouverte à anon par défaut (voulu).

## 8. `config.toml` et état déployé

État lu via l'API Supabase le 19/09 (liste des Edge Functions) :

| Fonction | Déployée | `config.toml` avant | `config.toml` après |
|---|---|---|---|
| stripe-checkout, stripe-webhook, dispatch-notifications, outlook-poll | `false` | `false` | `false` |
| read-id-doc, classify-prospect-email, mailbox-diag, graph-send-email, vies-check | `false` | **absente** (le CLI aurait redéployé en `true`) | `false` |
| summarize-exchange, send-account-invitation | `true` | **absente** | `true` |

Choix : ne pas passer les nouvelles fonctions contrôlées à `verify_jwt = true`. La clé publique est
elle-même un jeton valide : ce réglage ne bloque que les appels sans aucun jeton, déjà refusés par
le code ; et il casserait les appels le jour où le projet passera aux nouvelles clés d'API
(`sb_secret_…`, qui ne sont pas des jetons JWT).

## 9. Retour arrière

Fichier `supabase/rollbacks/20260919109999_securite_lot_s_ROLLBACK.sql`, commenté
« ROLLBACK — ne pas appliquer sauf incident ». Hors de `supabase/migrations/` pour que
`db push` ne le passe jamais. Sections S5 → S1, à exécuter une par une, dans cet ordre, seulement
celles nécessaires :
- **S5** : tâches pg_cron sans secret (seulement avec les anciennes fonctions déployées) ;
- **S4** : politique unique `company_mailboxes_all` ;
- **S3** : `is_member` / `has_role` d'origine, `UPDATE` complet du profil ;
- **S2** : définitions d'origine des 6 fonctions (copiées de la base le 19/09), `resolve_customer_price`
  renommée à l'identique ;
- **S1** : 1.a retour complet, fonction par fonction, **depuis la copie**
  `securite_lot_s.acl_avant_s1` (vérifié : droits identiques à l'état de départ) ; 1.b retour ciblé,
  un `grant` sur une seule fonction — **à préférer**.

Fonctions serveur : redéployer la version précédente depuis `main` (`git show main:supabase/functions/<nom>/index.ts`).

## 10. Hors de ce lot (à planifier)

- Bannir le compte dans Supabase Auth à la désactivation (§4, S3).
- Durcir les 30 gardes `auth.uid() is null or …` (§4, S2).
- Alertes Supabase restantes : protection contre les mots de passe compromis désactivée, `pg_net`
  installé dans `public`.
- La RLS ne distingue toujours pas les rôles (`00-architecture.md` §9, « Rôles ») : un magasinier peut
  lire la comptabilité par l'API. Sujet distinct.
- Stratégie d'accès Exchange limitant l'application Azure aux boîtes de la concession (S4).
