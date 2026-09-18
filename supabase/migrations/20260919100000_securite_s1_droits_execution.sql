-- LOT SÉCURITÉ S1 — Droits d'exécution des fonctions du schéma public.
-- Réf. docs/bible/securite-lot-S.md §S1 (ordre d'application, vérifications, retour arrière).
--
-- Avant : EXECUTE accordé à PUBLIC et à anon sur 102 des 137 fonctions (droit par défaut de
-- PostgreSQL + privilèges par défaut Supabase, jamais retirés). La clé anon étant publique,
-- n'importe qui pouvait appeler, par exemple, close_fiscal_year ou record_sepa_collection.
--
-- Après :
--   1. plus AUCUNE fonction exécutable par PUBLIC ni par anon, sauf 2 exceptions justifiées ;
--   2. authenticated garde exactement ce qu'il avait (on n'élargit rien : les 4 fonctions
--      déjà réservées à la clé de service le restent) ;
--   3. service_role peut tout exécuter (Edge Functions, scripts) ;
--   4. 22 fonctions internes (tâches planifiées, relève Outlook, aides comptables, variantes
--      « _unchecked ») passent en « clé de service uniquement » : un compte connecté sans rôle
--      (futur client du portail) pouvait les appeler et, par exemple, consommer des numéros de
--      facture (_next_document_number_unchecked) ou écrire dans le CRM de n'importe quelle société.
--   5. les fonctions créées plus tard par postgres ne sont plus exécutables par PUBLIC / anon
--      par défaut : une future fonction publique devra être ouverte explicitement.
--
-- Exceptions laissées à anon (2) :
--   - is_member(uuid), is_admin(uuid) : appelées dans 20 politiques RLS déclarées pour le rôle
--     {public} (donc évaluées aussi pour anon) et, indirectement, par la politique de stockage
--     ged_public_products. Sans EXECUTE, une requête anonyme sur ces tables échouerait en
--     « permission denied for function » au lieu de renvoyer zéro ligne. Pour anon,
--     auth.uid() est nul : les deux fonctions renvoient toujours false, elles ne révèlent rien.
--
-- Fermé volontairement à anon : l'e-shop (shop_public_site, shop_public_catalog,
-- shop_public_info, place_web_order, web_order_public_status). Décision W-1 du 18/09 : le site
-- public est Shopify, l'e-shop du DMS sera supprimé ; aucune boutique publiée au 18/09
-- (shop_settings.published = false partout). Ré-ouverture possible : voir le fichier de retour
-- arrière, bloc « e-shop ».
--
-- Les pages accessibles sans connexion (/login, /reset-password) n'appellent AUCUNE fonction
-- SQL (seulement supabase.auth.*) ; /reset-password lit user_roles une fois connecté.
--
-- Les fonctions de l'extension unaccent (propriétaire supabase_admin) ne sont pas touchées :
-- postgres n'a pas le droit de les modifier, et elles sont sans danger.
--
-- NON APPLIQUÉE. À appliquer par l'intégrateur, après sauvegarde.
--
-- Le lot portail client / inscription publique (migrations m0_portail_client et
-- m1_public_signup, passées en base le 18/09) a ajouté 22 fonctions portal_* / signup_* déjà
-- fermées à anon : la boucle ci-dessous les laisse telles quelles (authenticated conservé).
--
-- Copie des droits AVANT modification, pour un retour arrière exact (fichier
-- supabase/rollbacks/20260919109999_securite_lot_s_ROLLBACK.sql). Schéma non exposé par
-- l'API (PostgREST n'expose que public et graphql_public) ; aucune donnée personnelle.
create schema if not exists securite_lot_s;
revoke all on schema securite_lot_s from public, anon, authenticated;
create table if not exists securite_lot_s.acl_avant_s1 (
  signature           text primary key,   -- ex. public.contact_encours(uuid)
  acl                 text,               -- pg_proc.proacl brut, pour mémoire
  exec_public         boolean not null,
  exec_anon           boolean not null,
  exec_authenticated  boolean not null,
  exec_service_role   boolean not null,
  saved_at            timestamptz not null default now()
);
revoke all on table securite_lot_s.acl_avant_s1 from public, anon, authenticated;

-- « on conflict do nothing » : repasser la migration ne doit pas écraser la copie d'origine.
insert into securite_lot_s.acl_avant_s1
  (signature, acl, exec_public, exec_anon, exec_authenticated, exec_service_role)
select format('public.%I(%s)', p.proname, oidvectortypes(p.proargtypes)),
       p.proacl::text,
       exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                where x.grantee = 0 and x.privilege_type = 'EXECUTE'),
       exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                where x.grantee = 'anon'::regrole and x.privilege_type = 'EXECUTE'),
       exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                where x.grantee = 'authenticated'::regrole and x.privilege_type = 'EXECUTE'),
       exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                where x.grantee = 'service_role'::regrole and x.privilege_type = 'EXECUTE')
  from pg_proc p
  join pg_roles o on o.oid = p.proowner
 where p.pronamespace = 'public'::regnamespace
   and p.prokind in ('f', 'p')
   and o.rolname = 'postgres'
on conflict (signature) do nothing;

do $$
declare
  f record;
  keep_auth boolean;
  n int := 0;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
      from pg_proc p
      join pg_roles o on o.oid = p.proowner
     where p.pronamespace = 'public'::regnamespace
       and p.prokind in ('f', 'p')
       and o.rolname = 'postgres'
  loop
    -- Ce qu'authenticated pouvait faire AVANT (directement ou via PUBLIC) : on le conserve.
    keep_auth := has_function_privilege('authenticated', f.oid, 'EXECUTE');
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if keep_auth then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    n := n + 1;
  end loop;
  raise notice 'S1 : droits revus sur % fonctions', n;
end $$;

-- Fonctions internes : clé de service (et postgres, propriétaire) uniquement.
-- Aucune n'est appelée par le navigateur (vérifié dans src/ le 19/09) ; elles sont appelées
-- par pg_cron (rôle postgres), par d'autres fonctions SECURITY DEFINER (qui s'exécutent en
-- tant que postgres) ou par les Edge Functions avec la clé de service.
revoke execute on function public._cron_appointment_reminders() from authenticated;
revoke execute on function public._cron_dormant_alert() from authenticated;
revoke execute on function public._cron_invoice_reminders() from authenticated;
revoke execute on function public._cron_maybe_stock_copy() from authenticated;
revoke execute on function public._cron_stock_copies() from authenticated;
revoke execute on function public._next_document_number_unchecked(uuid, text) from authenticated;
revoke execute on function public._recompute_paid_unchecked(uuid) from authenticated;
revoke execute on function public._account_label(uuid, text) from authenticated;
revoke execute on function public._accounting_cutover(uuid) from authenticated;
revoke execute on function public._doc_margin(uuid) from authenticated;
revoke execute on function public.resolve_account(uuid, text, text) from authenticated;
revoke execute on function public.resolve_journal(uuid, text, text) from authenticated;
revoke execute on function public.bin_stock(uuid, text) from authenticated;
revoke execute on function public.learn_ducati_vds(text, text, integer, integer, text) from authenticated;
-- Relève Outlook (outlook-poll, clé de service) :
revoke execute on function public.ingest_email(uuid, text, text, text, text, text, timestamptz, text) from authenticated;
revoke execute on function public.ingest_inbound_email(uuid, text, text, text, timestamptz, text) from authenticated;
revoke execute on function public.set_inbound_cursor(uuid, timestamptz) from authenticated;
revoke execute on function public.set_mail_cursors(uuid, timestamptz, timestamptz) from authenticated;
revoke execute on function public.set_mailbox_cursors(uuid, timestamptz, timestamptz) from authenticated;
revoke execute on function public.create_prospect_from_email(uuid, text, text, text, timestamptz, text, jsonb) from authenticated;
revoke execute on function public.log_ignored_email(uuid, text, text, timestamptz, text, text) from authenticated;
revoke execute on function public.contacts_match_candidates(uuid, text, text, text, text, uuid) from authenticated;

-- Exceptions anon (voir en-tête).
grant execute on function public.is_member(uuid) to anon;
grant execute on function public.is_admin(uuid) to anon;

-- Fonctions créées à l'avenir par postgres : plus d'EXECUTE implicite pour PUBLIC ni anon.
-- (authenticated et service_role le gardent via le privilège par défaut du schéma public.)
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
