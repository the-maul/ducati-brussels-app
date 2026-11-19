-- =====================================================================
-- Perf (plainte client du 19/11/2026 : « tout prend un temps de dingue a charger »).
--
-- CAUSE MESUREE : les politiques RLS appellent les fonctions de droits
-- (is_member, is_admin, has_role, can_write_table) UNE FOIS PAR LIGNE lue.
-- Ces fonctions sont SECURITY DEFINER + SET search_path : PostgreSQL ne peut pas
-- les « deplier » dans la requete, chaque appel coute 25 a 250 microsecondes.
--   EXPLAIN ANALYZE, utilisateur admin d'ITALBIKE (19/11) :
--     documents, 50 derniers (liste ventes)      4 553 ms   (17 814 lignes x 2 fonctions)
--     contacts, comptage                            218 ms
--     vehicles, 50 derniers                         140 ms
--   apres cette migration (meme requete, meme utilisateur, transaction annulee) :
--     documents 31 ms, vehicles 7,8 ms (voir supabase/tests/perf_rls_equivalence.sql).
--
-- CORRECTION, STRICTEMENT EQUIVALENTE (aucun droit ne change) :
--   is_member(X)            -> COALESCE((X IN (SELECT rls_member_companies())), false)
--   is_admin(X)             -> COALESCE((X IN (SELECT rls_admin_companies())), false)
--   has_role(X, 'r')        -> COALESCE((X IN (SELECT rls_role_companies('r'))), false)
--   can_write_table(X, 't') -> COALESCE((X IN (SELECT rls_writable_companies('t'))), false)
--   auth.uid()              -> (SELECT auth.uid())
-- Le « SELECT » sans reference a la ligne est calcule une seule fois par requete
-- (hashed SubPlan), puis chaque ligne ne fait qu'une recherche dans une table de hachage.
--
-- Pourquoi c'est equivalent : chaque fonction rls_*_companies() renvoie les societes de
-- user_roles de l'utilisateur courant POUR LESQUELLES LA FONCTION D'ORIGINE REPOND VRAI.
-- Or chacune des 4 fonctions d'origine ne peut repondre vrai que pour une societe ou
-- l'utilisateur a au moins une ligne dans user_roles. Donc, pour toute societe X :
--   f(X) = vrai  <=>  X appartient a l'ensemble.
-- Les fonctions d'origine ne renvoient jamais NULL (exists) : COALESCE(..., false) donne
-- exactement le meme resultat, y compris pour X NULL et sous un NOT. Les fonctions
-- d'origine sont reutilisees telles quelles : une evolution future de is_member ou
-- can_write_table s'applique automatiquement.
-- Non touches : can_manage_accounting et _accounting_can_transfer (ils repondent vrai
-- sans utilisateur pour la cle de service : pas equivalents a un ensemble de societes).
--
-- La reecriture est faite par public.rls_perf_rewrite_all() sur pg_policies (schema public),
-- par ALTER POLICY : nom, commande, roles et caractere permissif ne changent pas.
-- Idempotente. A RELANCER (select public.rls_perf_rewrite_all();) apres une migration qui
-- ajoute des politiques ecrites avec is_member(company_id) & co.
-- =====================================================================

-- ---------------------------------------------------------------- ensembles de societes
create or replace function public.rls_member_companies()
returns setof uuid language sql stable security definer
set search_path = public, pg_temp as $f$
  select distinct ur.company_id from public.user_roles ur
   where ur.user_id = auth.uid() and public.is_member(ur.company_id)
$f$;

create or replace function public.rls_admin_companies()
returns setof uuid language sql stable security definer
set search_path = public, pg_temp as $f$
  select distinct ur.company_id from public.user_roles ur
   where ur.user_id = auth.uid() and public.is_admin(ur.company_id)
$f$;

create or replace function public.rls_role_companies(_role public.app_role)
returns setof uuid language sql stable security definer
set search_path = public, pg_temp as $f$
  select distinct ur.company_id from public.user_roles ur
   where ur.user_id = auth.uid() and public.has_role(ur.company_id, _role)
$f$;

create or replace function public.rls_writable_companies(_table text)
returns setof uuid language sql stable security definer
set search_path = public, pg_temp as $f$
  select distinct ur.company_id from public.user_roles ur
   where ur.user_id = auth.uid() and public.can_write_table(ur.company_id, _table)
$f$;

-- Memes droits d'execution que les fonctions d'origine (is_member / is_admin : anon aussi).
revoke all on function public.rls_member_companies() from public;
revoke all on function public.rls_admin_companies() from public;
revoke all on function public.rls_role_companies(public.app_role) from public;
revoke all on function public.rls_writable_companies(text) from public;
grant execute on function public.rls_member_companies() to anon, authenticated, service_role;
grant execute on function public.rls_admin_companies() to anon, authenticated, service_role;
grant execute on function public.rls_role_companies(public.app_role) to authenticated, service_role;
grant execute on function public.rls_writable_companies(text) to authenticated, service_role;

comment on function public.rls_member_companies() is
  'Perf RLS : societes ou is_member() repond vrai pour l''utilisateur courant (calcule une fois par requete).';
comment on function public.rls_writable_companies(text) is
  'Perf RLS : societes ou can_write_table(_, table) repond vrai pour l''utilisateur courant.';

-- ---------------------------------------------------------------- reecriture d'une expression
create or replace function public._rls_perf_rewrite(_expr text)
returns text language sql immutable set search_path = public, pg_temp as $f$
  select case when _expr is null then null else
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(_expr,
      '\m(?:public\.)?is_member\(([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\)',
      'COALESCE((\1 IN ( SELECT public.rls_member_companies())), false)', 'g'),
      '\m(?:public\.)?is_admin\(([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\)',
      'COALESCE((\1 IN ( SELECT public.rls_admin_companies())), false)', 'g'),
      '\m(?:public\.)?has_role\(([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?), (''[a-z_]+''::(?:public\.)?app_role)\)',
      'COALESCE((\1 IN ( SELECT public.rls_role_companies(\2))), false)', 'g'),
      '\m(?:public\.)?can_write_table\(([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?), (''[a-z0-9_]+''::text)\)',
      'COALESCE((\1 IN ( SELECT public.rls_writable_companies(\2))), false)', 'g'),
      '(?<!SELECT )\mauth\.uid\(\)',
      '( SELECT auth.uid())', 'g')
  end
$f$;

-- ---------------------------------------------------------------- application a toutes les politiques
create or replace function public.rls_perf_rewrite_all()
returns integer language plpgsql
set search_path = public, extensions, pg_temp as $f$
declare
  r record; nq text; nw text; n int := 0;
begin
  for r in
    select p.tablename, p.policyname, p.qual, p.with_check
      from pg_policies p where p.schemaname = 'public'
     order by p.tablename, p.policyname
  loop
    nq := public._rls_perf_rewrite(r.qual);
    nw := public._rls_perf_rewrite(r.with_check);
    if nq is distinct from r.qual or nw is distinct from r.with_check then
      execute format('alter policy %I on public.%I', r.policyname, r.tablename)
        || case when r.qual is not null then format(' using (%s)', nq) else '' end
        || case when r.with_check is not null then format(' with check (%s)', nw) else '' end;
      n := n + 1;
    end if;
  end loop;
  return n;
end $f$;

revoke all on function public._rls_perf_rewrite(text) from public, anon, authenticated;
revoke all on function public.rls_perf_rewrite_all() from public, anon, authenticated;
comment on function public.rls_perf_rewrite_all() is
  'Perf RLS (20261119230000) : reecrit les politiques du schema public pour calculer les droits une fois par requete. Idempotente ; a relancer apres l''ajout de politiques utilisant is_member/is_admin/has_role/can_write_table.';

do $m$ declare n int; begin
  n := public.rls_perf_rewrite_all();
  raise notice 'perf RLS : % politiques reecrites', n;
end $m$;
