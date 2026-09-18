-- ============================================================================================
-- ROLLBACK — ne pas appliquer sauf incident.
-- ============================================================================================
-- Retour arrière du LOT SÉCURITÉ S (migrations 20260919100000 à 20260919100400).
-- Réf. docs/bible/securite-lot-S.md §9 (retour arrière) et §7 (risques de casse).
--
-- Ce fichier est VOLONTAIREMENT hors de supabase/migrations/ : `supabase db push` ne doit
-- jamais l'appliquer. À exécuter à la main dans l'éditeur SQL, SECTION PAR SECTION, dans
-- l'ordre inverse (S5 → S1), en ne passant que les sections nécessaires.
--
-- Rétablir S1 rouvre la faille (fonctions appelables sans connexion) : à ne faire que pour
-- remettre le service en route, le temps de corriger. Préférer le bloc « ciblé » (1.b) qui
-- ne rouvre qu'une fonction.
-- ============================================================================================


-- --------------------------------------------------------------------------------------------
-- S5 — Tâches planifiées : retour à l'appel SANS secret.
-- À n'utiliser que si les Edge Functions déployées sont les ANCIENNES versions (sans contrôle).
-- Si les nouvelles versions sont déployées, cet appel serait refusé (403) : corriger plutôt le
-- secret (Vault « cron_secret » = secret Edge CRON_SECRET).
-- --------------------------------------------------------------------------------------------
select cron.schedule('outlook-poll', '*/5 * * * *', $cron$
  select net.http_post('https://ujmrosbgkvgvwfnuryna.supabase.co/functions/v1/outlook-poll',
    '{}'::jsonb, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json'));
$cron$);
select cron.schedule('dispatch-notifications', '*/10 * * * *', $cron$
  select net.http_post('https://ujmrosbgkvgvwfnuryna.supabase.co/functions/v1/dispatch-notifications',
    '{}'::jsonb, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json'));
$cron$);


-- --------------------------------------------------------------------------------------------
-- S4 — company_mailboxes : retour à la politique unique « tout membre ».
-- --------------------------------------------------------------------------------------------
drop policy if exists company_mailboxes_select on public.company_mailboxes;
drop policy if exists company_mailboxes_insert on public.company_mailboxes;
drop policy if exists company_mailboxes_update on public.company_mailboxes;
drop policy if exists company_mailboxes_delete on public.company_mailboxes;
create policy company_mailboxes_all on public.company_mailboxes
  for all to authenticated
  using (is_member(company_id))
  with check (is_member(company_id));


-- --------------------------------------------------------------------------------------------
-- S3 — Comptes désactivés : is_member / has_role sans contrôle de is_active ; UPDATE complet
-- du profil rendu à l'intéressé (état du 18/09).
-- --------------------------------------------------------------------------------------------
create or replace function public.is_member(_company uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.company_id = _company
  );
$$;

create or replace function public.has_role(_company uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.company_id = _company and ur.role = _role
  );
$$;

grant update on table public.profiles to anon, authenticated;


-- --------------------------------------------------------------------------------------------
-- S2 — Gardes de société : définitions du 18/09 (copiées depuis pg_get_functiondef).
-- --------------------------------------------------------------------------------------------
drop function if exists public.resolve_customer_price(uuid, uuid, uuid, numeric);
alter function public._resolve_customer_price_unchecked(uuid, uuid, uuid, numeric)
  rename to resolve_customer_price;
grant execute on function public.resolve_customer_price(uuid, uuid, uuid, numeric)
  to public, anon, authenticated, service_role;

create or replace function public.contact_encours(_contact uuid)
returns table(authorized numeric, current_due numeric, available numeric)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    coalesce((select credit_limit from public.contacts where id = _contact), 0) as authorized,
    coalesce((select sum(total_ttc - paid_amount) from public.documents
              where contact_id = _contact and doc_type = 'FAC' and status <> 'annulee'
              and total_ttc - paid_amount > 0), 0) as current_due,
    coalesce((select credit_limit from public.contacts where id = _contact), 0)
      - coalesce((select sum(total_ttc - paid_amount) from public.documents
                  where contact_id = _contact and doc_type = 'FAC' and status <> 'annulee'
                  and total_ttc - paid_amount > 0), 0) as available;
$$;

create or replace function public.article_stock(_article uuid)
returns table(real_qty numeric, reserved_qty numeric, available_qty numeric)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    coalesce(sum(case when not is_reservation then qty_delta else 0 end), 0) as real_qty,
    coalesce(sum(case when is_reservation then qty_delta else 0 end), 0) as reserved_qty,
    coalesce(sum(case when not is_reservation then qty_delta else 0 end), 0)
      - coalesce(sum(case when is_reservation then qty_delta else 0 end), 0) as available_qty
  from public.stock_moves where article_id = _article;
$$;

create or replace function public.or_worked_minutes(_or uuid)
returns numeric
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(sum(minutes), 0) from public.workshop_time_entries
  where or_id = _or and kind = 'travail' and minutes is not null;
$$;

create or replace function public.default_assignee(_company uuid)
returns uuid
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select nullif(rv.extra->>'user_id', '')::uuid
       from public.reference_values rv
      where rv.company_id = _company and rv.table_key = 'lead_task'
        and rv.code = 'default_assignee' and rv.is_active),
    (select ur.user_id from public.user_roles ur
      where ur.company_id = _company and ur.role = 'admin'
      order by ur.created_at limit 1)
  );
$$;

create or replace function public.transfer_stock_on_replace(_from uuid, _to uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare _real numeric; _pamp numeric;
begin
  select real_qty into _real from public.article_stock(_from);
  select pamp into _pamp from public.articles where id = _from;
  if _real is null or _real = 0 then return; end if;
  -- sortie de l'ancienne, entrée valorisée dans la nouvelle (recalcule le PAMP cible)
  perform public.record_stock_move(_from, 'transfert', -_real, null, false, null, 'replacement', _to::text, 'Remplacement de référence');
  perform public.record_stock_move(_to,   'transfert',  _real, _pamp, false, null, 'replacement', _from::text, 'Remplacement de référence');
end $$;

notify pgrst, 'reload schema';


-- --------------------------------------------------------------------------------------------
-- S1 — 1.a Retour COMPLET aux droits d'avant S1 (rouvre la faille, voir en-tête).
-- Rétablit EXACTEMENT les droits copiés par S1 dans securite_lot_s.acl_avant_s1, fonction par
-- fonction (les fonctions déjà fermées à anon avant le lot, comme portal_* ou
-- pending_exchange_summaries, restent fermées). Passer la section S2 AVANT celle-ci (S2
-- renomme resolve_customer_price). Les fonctions créées après S1 ne sont pas touchées.
-- --------------------------------------------------------------------------------------------
do $$
declare b record; n int := 0;
begin
  for b in select * from securite_lot_s.acl_avant_s1 loop
    if to_regprocedure(b.signature) is null then
      raise notice 'rollback S1 : % n''existe plus, ignorée', b.signature;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', b.signature);
    if b.exec_public        then execute format('grant execute on function %s to public', b.signature); end if;
    if b.exec_anon          then execute format('grant execute on function %s to anon', b.signature); end if;
    if b.exec_authenticated then execute format('grant execute on function %s to authenticated', b.signature); end if;
    if b.exec_service_role  then execute format('grant execute on function %s to service_role', b.signature); end if;
    n := n + 1;
  end loop;
  raise notice 'rollback S1 : droits rétablis sur % fonctions', n;
end $$;
alter default privileges for role postgres grant execute on functions to public;
alter default privileges for role postgres in schema public grant execute on functions to anon;
-- La copie peut être conservée (schéma non exposé). Pour la supprimer une fois le lot validé :
--   drop schema securite_lot_s cascade;


-- --------------------------------------------------------------------------------------------
-- S1 — 1.b Retour CIBLÉ (à préférer) : rouvrir UNE fonction à authenticated ou à anon.
-- Exemple, si un écran appelait une fonction passée « clé de service uniquement » :
--   grant execute on function public.<nom>(<types>) to authenticated;
-- (Les fonctions de l'e-shop, shop_public_* / place_web_order / web_order_public_status, ont été
--  supprimées de la base le 18/09 par la migration cleanup_remove_eshop_improvements, décision W-1 :
--  il n'y a plus rien à rouvrir de ce côté.)
-- --------------------------------------------------------------------------------------------
