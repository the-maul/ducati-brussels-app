-- =====================================================================
-- Perf (19/11/2026) -- essai a blanc de 20261119231000_perf_index_listes_et_tableau_de_bord.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises :
--   PRE_SQL="<migrations>/20261119230000_perf_rls_droits_calcules_une_fois.sql;<migrations>/20261119231000_perf_index_listes_et_tableau_de_bord.sql"
--   python rt.py perf_index_tableau_de_bord.sql
-- Verifie : index poses ; le tableau de bord donne EXACTEMENT les memes chiffres qu'avant
-- (version d'origine reconstruite dans pg_temp a partir du texte patche), pour chaque
-- utilisateur et chaque societe ; la valeur du stock = somme de article_stock_list.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

insert into _t(check_name, result)
select '1 index des listes et des cles du RDV poses (5)',
  case when count(*) = 5 then 'ok' else 'KO ' || count(*) end
  from pg_indexes where schemaname = 'public'
   and indexname in ('idx_documents_company_issue_date', 'idx_vehicles_company_created', 'idx_appt_or', 'idx_appt_contact', 'idx_appt_vehicle');

insert into _t(check_name, result)
select '2 dashboard_kpis ne passe plus par article_stock_list',
  case when pg_get_functiondef('public.dashboard_kpis(uuid)'::regprocedure) not like '%article_stock_list%' then 'ok' else 'KO' end;

-- Version d'origine, reconstruite : meme texte, expression d'origine remise.
do $s$ declare _def text; begin
  _def := pg_get_functiondef('public.dashboard_kpis(uuid)'::regprocedure);
  _def := replace(_def, '(select sum(round(coalesce(s.real_qty, 0) * a.pamp, 2))
        from public.articles a
        left join (select m.article_id, sum(m.qty_delta) as real_qty
                     from public.stock_moves m where not m.is_reservation group by m.article_id) s
          on s.article_id = a.id
       where a.company_id = _company)', '(select sum(stock_value) from public.article_stock_list(_company))');
  _def := replace(_def, 'FUNCTION public.dashboard_kpis(', 'FUNCTION pg_temp.dashboard_kpis_orig(');
  execute _def;
end $s$;

do $s$ declare u record; c record; a jsonb; b jsonb; bad int := 0; n int := 0; begin
  for u in select distinct ur.user_id from public.user_roles ur
           union all select '00000000-0000-4000-8000-00000000abcd'::uuid loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    for c in select id from public.companies loop
      a := public.dashboard_kpis(c.id);
      b := pg_temp.dashboard_kpis_orig(c.id);
      n := n + 1;
      if a is distinct from b then bad := bad + 1; end if;
    end loop;
  end loop;
  insert into _t(check_name, result) values (
    '3 dashboard_kpis = version d''origine pour chaque utilisateur et societe (' || n || ' cas)',
    case when bad = 0 and n > 0 then 'ok' else 'KO ' || bad end);
end $s$;

do $s$ declare _u uuid; _c uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; v1 numeric; v2 numeric; begin
  select ur.user_id into _u from public.user_roles ur join public.profiles p on p.id = ur.user_id
   where ur.company_id = _c and ur.role = 'admin' and p.is_active limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  v1 := (public.dashboard_kpis(_c) ->> 'stock_value')::numeric;
  v2 := coalesce((select sum(stock_value) from public.article_stock_list(_c)), 0);
  insert into _t(check_name, result) values (
    '4 valeur du stock du tableau de bord = somme de article_stock_list (' || coalesce(v1::text, 'null') || ')',
    case when v1 = v2 and v1 is not null then 'ok' else 'KO ' || coalesce(v1::text, 'null') || ' <> ' || coalesce(v2::text, 'null') end);
end $s$;
