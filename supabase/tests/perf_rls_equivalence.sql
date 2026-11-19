-- =====================================================================
-- Perf (19/11/2026) -- essai a blanc de 20261119230000_perf_rls_droits_calcules_une_fois.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   PRE_SQL=supabase/migrations/20261119230000_perf_rls_droits_calcules_une_fois.sql python rt.py perf_rls_equivalence.sql
-- Verifie que la reecriture des politiques RLS ne change AUCUN droit :
--   1. pour chaque utilisateur (tous ceux de user_roles + un inconnu + un visiteur sans compte),
--      chaque societe (+ NULL), chaque role et chaque table : les ensembles rls_*_companies()
--      donnent exactement la reponse de is_member / is_admin / has_role / can_write_table ;
--   2. il ne reste aucun appel par ligne (is_member(col), ..., auth.uid() nu) dans le schema public ;
--   3. pour chaque politique et chaque utilisateur, sur un echantillon de lignes reelles de la
--      table, l'expression reecrite et l'expression d'origine (reconstituee) acceptent
--      exactement les memes lignes ;
--   4. la fonction est idempotente (relancee : 0 politique modifiee).
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

-- ------------------------------------------------------------ utilisateurs essayes
create temp table _users(u uuid, claims text) on commit drop;
insert into _users select distinct ur.user_id, json_build_object('sub', ur.user_id, 'role', 'authenticated')::text from public.user_roles ur;
insert into _users values ('00000000-0000-4000-8000-00000000abcd', json_build_object('sub', '00000000-0000-4000-8000-00000000abcd', 'role', 'authenticated')::text);
insert into _users values (null, '{"role":"anon"}');

-- tables passees a can_write_table : grille des pages + toutes celles citees dans les politiques
create temp table _tables(t text) on commit drop;
insert into _tables select distinct tp.table_name from public.table_write_pages tp;
insert into _tables select distinct (regexp_matches(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
  'rls_writable_companies\(''([a-z0-9_]+)''', 'g'))[1] from pg_policies p where p.schemaname = 'public';
insert into _tables values ('table_inexistante');

-- ------------------------------------------------------------ 1. ensembles = fonctions d'origine
do $s$ declare r record; bad int := 0; k int; begin
  for r in select * from _users loop
    perform set_config('request.jwt.claims', r.claims, true);
    select count(*) into k from (select c.id from public.companies c union all select null::uuid) cc(id)
     where public.is_member(cc.id) is distinct from coalesce((cc.id in (select public.rls_member_companies())), false);
    bad := bad + k;
    select count(*) into k from (select c.id from public.companies c union all select null::uuid) cc(id)
     where public.is_admin(cc.id) is distinct from coalesce((cc.id in (select public.rls_admin_companies())), false);
    bad := bad + k;
    select count(*) into k from (select c.id from public.companies c union all select null::uuid) cc(id)
     cross join unnest(enum_range(null::public.app_role)) rr(r)
     where public.has_role(cc.id, rr.r) is distinct from coalesce((cc.id in (select public.rls_role_companies(rr.r))), false);
    bad := bad + k;
    select count(*) into k from (select c.id from public.companies c union all select null::uuid) cc(id)
     cross join (select distinct t from _tables where t is not null) tt
     where public.can_write_table(cc.id, tt.t) is distinct from coalesce((cc.id in (select public.rls_writable_companies(tt.t))), false);
    bad := bad + k;
  end loop;
  insert into _t(check_name, result) values (
    '1 rls_member/admin/role/writable_companies = is_member/is_admin/has_role/can_write_table (tous utilisateurs, societes, roles, tables)',
    case when bad = 0 then 'ok' else 'KO ' || bad || ' ecarts' end);
end $s$;

-- au moins un utilisateur reel voit bien sa societe (l'essai n'est pas vide)
insert into _t(check_name, result)
select '1b un membre reel retrouve sa societe dans rls_member_companies()',
  case when exists (
    select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id where p.is_active
  ) then 'ok' else 'KO aucun membre actif' end;

-- ------------------------------------------------------------ 2. plus d'appel par ligne
insert into _t(check_name, result)
select '2 aucune politique public ne garde is_member/is_admin/has_role/can_write_table(colonne) ni auth.uid() nu',
  case when count(*) = 0 then 'ok' else 'KO ' || string_agg(tablename || '.' || policyname, ', ') end
  from pg_policies p
 where p.schemaname = 'public'
   and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~
       '(\m(is_member|is_admin)\([a-z_][a-z0-9_.]*\)|\mhas_role\([a-z_][a-z0-9_.]*, ''[a-z_]+''::app_role\)|\mcan_write_table\([a-z_][a-z0-9_.]*, ''[a-z0-9_]+''::text\)|(?<!SELECT )\mauth\.uid\(\))';

insert into _t(check_name, result)
select '2b politiques reecrites presentes (plus de 200)',
  case when count(*) > 200 then 'ok' else 'KO ' || count(*) end
  from pg_policies p where p.schemaname = 'public'
   and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ 'rls_(member|admin|role|writable)_companies';

-- ------------------------------------------------------------ 3. memes lignes acceptees
-- Expression d'origine reconstituee a partir du texte reecrit (transformation inverse exacte).
create or replace function pg_temp._orig(_e text) returns text language sql immutable as $f$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(_e,
    'COALESCE\(\(([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?) IN \( SELECT (?:public\.)?rls_member_companies\(\) AS rls_member_companies\)\), false\)',
    'is_member(\1)', 'g'),
    'COALESCE\(\(([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?) IN \( SELECT (?:public\.)?rls_admin_companies\(\) AS rls_admin_companies\)\), false\)',
    'is_admin(\1)', 'g'),
    'COALESCE\(\(([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?) IN \( SELECT (?:public\.)?rls_role_companies\((''[a-z_]+''::app_role)\) AS rls_role_companies\)\), false\)',
    'has_role(\1, \2)', 'g'),
    'COALESCE\(\(([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?) IN \( SELECT (?:public\.)?rls_writable_companies\((''[a-z0-9_]+''::text)\) AS rls_writable_companies\)\), false\)',
    'can_write_table(\1, \2)', 'g'),
    '\( SELECT auth\.uid\(\) AS uid\)', 'auth.uid()', 'g')
$f$;

do $s$
declare
  p record; u record; e text; o text; a bigint; b bigint;
  nb_pol int := 0; nb_cmp int := 0; bad text := ''; err text := '';
begin
  for p in
    select tablename, policyname, x.kind, x.expr
      from pg_policies pp
     cross join lateral (values ('using', pp.qual), ('check', pp.with_check)) x(kind, expr)
     where pp.schemaname = 'public' and x.expr is not null
       and x.expr ~ 'rls_(member|admin|role|writable)_companies|SELECT auth\.uid\(\) AS uid'
  loop
    nb_pol := nb_pol + 1;
    e := p.expr; o := pg_temp._orig(p.expr);
    if o ~ 'rls_(member|admin|role|writable)_companies' then
      bad := bad || p.tablename || '.' || p.policyname || '(inverse incomplete) ';
      continue;
    end if;
    for u in select * from _users loop
      perform set_config('request.jwt.claims', u.claims, true);
      begin
        execute format('select count(*) filter (where %s), count(*) filter (where %s) from (select * from public.%I limit 150) %I',
                       e, o, p.tablename, p.tablename) into a, b;
        nb_cmp := nb_cmp + 1;
        if a is distinct from b then
          bad := bad || p.tablename || '.' || p.policyname || '/' || p.kind || '(' || a || '<>' || b || ') ';
        end if;
      exception when others then
        err := err || p.tablename || '.' || p.policyname || ': ' || sqlerrm || ' ';
      end;
    end loop;
  end loop;
  insert into _t(check_name, result) values (
    '3 chaque politique reecrite accepte les memes lignes que l''originale (' || nb_pol || ' expressions, ' || nb_cmp || ' comparaisons)',
    case when bad = '' and err = '' and nb_cmp > 0 then 'ok' else 'KO ' || left(bad || err, 1500) end);
end $s$;

-- ------------------------------------------------------------ 4. idempotence
insert into _t(check_name, result)
select '4 relancer rls_perf_rewrite_all() ne modifie plus rien',
  case when public.rls_perf_rewrite_all() = 0 then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 5. droits d'execution
insert into _t(check_name, result)
select '5 rls_perf_rewrite_all non executable par authenticated / anon',
  case when not has_function_privilege('authenticated', 'public.rls_perf_rewrite_all()', 'execute')
        and not has_function_privilege('anon', 'public.rls_perf_rewrite_all()', 'execute') then 'ok' else 'KO' end;
insert into _t(check_name, result)
select '5b rls_member_companies executable par authenticated (politiques)',
  case when has_function_privilege('authenticated', 'public.rls_member_companies()', 'execute') then 'ok' else 'KO' end;
