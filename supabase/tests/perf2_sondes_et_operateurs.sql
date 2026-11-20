-- =====================================================================
-- Perf 2 (20/11/2026) -- essai a blanc de 20261120112000_perf2_sondes_schema_et_operateurs_or.sql.
--   PRE_SQL=supabase/migrations/20261120112000_perf2_sondes_schema_et_operateurs_or.sql python rt.py perf2_sondes_et_operateurs.sql
-- Verifie :
--   1. schema_probe, en utilisateur connecte : chaque sonde de l'application repond comme la
--      requete d'origine `select colonne from table limit 1` (reussite = presente) ;
--      colonne / table inexistante, texte mal forme, autre schema : absents ;
--   2. or_operators = les operateurs distincts des 1 000 derniers OR lus comme avant, pour
--      chaque utilisateur et chaque societe (RLS identique : SECURITY INVOKER) ;
--   3. droits : pas d'execution pour anon.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _checks(c text) on commit drop;
insert into _checks values
  ('repair_order_lines.billed_hours'), ('repair_orders.promised_at'), ('workshop_appointments.mileage'),
  ('repair_orders.insurer_price_list_id'), ('repair_orders.operator_id'), ('repair_order_plan_operations.id'),
  ('workshop_mechanics.id'), ('workshop_time_entries.stop_kind'), ('repair_order_reception_photos.id'),
  ('stock_reservations.id'), ('repair_orders.customer_approval'), ('repair_orders.warranty_cession_code'),
  ('internal_cessions.id'), ('insurance_parties.id'), ('insurance_parties.price_list_id'),
  ('accident_files.id'), ('workshop_loans.id'), ('workshop_loans.driver_name'), ('workshop_loans.customer_vehicle_id'),
  ('ducati_manual_programs.model_year_id'), ('workshop_journeys.or_id'),
  ('repair_orders.colonne_inexistante'), ('table_inexistante.id'), ('repair_orders.id; drop table x'), ('auth.users');
grant select on _checks to authenticated;
create temp table _res(c text, orig boolean) on commit drop;
grant all on _res to authenticated;

do $s$ declare _u uuid; r record; ok boolean; got text[]; bad int := 0; n int := 0; begin
  select ur.user_id into _u from public.user_roles ur where ur.role = 'mecanicien' limit 1;
  if _u is null then select ur.user_id into _u from public.user_roles ur limit 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for r in select c from _checks loop
    begin
      if r.c ~ '^[a-z0-9_]+\.[a-z0-9_]+$' then
        execute format('select %I from public.%I limit 1', split_part(r.c, '.', 2), split_part(r.c, '.', 1));
        ok := true;
      else ok := false; end if;
    exception when others then ok := false; end;
    insert into _res values (r.c, ok);
  end loop;
  got := public.schema_probe(array(select c from _checks));
  for r in select * from _res loop
    n := n + 1;
    if (r.c = any(got)) is distinct from r.orig then bad := bad + 1; raise notice 'KO %', r.c; end if;
  end loop;
  reset role;
  insert into _t(check_name, result) values ('1 schema_probe = select colonne limit 1 (' || n || ' sondes, ' || coalesce(array_length(got, 1), 0) || ' presentes)',
    case when bad = 0 and n > 0 then 'ok' else 'KO ' || bad end);
  perform set_config('request.jwt.claims', '', true);
end $s$;

do $s$ declare u record; co record; a text[]; b text[]; bad int := 0; n int := 0; begin
  for u in select distinct ur.user_id from public.user_roles ur union all select '00000000-0000-4000-8000-00000000abcd'::uuid loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    for co in select id from public.companies loop
      n := n + 1;
      a := public.or_operators(co.id);
      b := array(select distinct btrim(x.operator) from (select ro.operator from public.repair_orders ro
                  where ro.company_id = co.id and ro.operator is not null order by ro.created_at desc limit 1000) x
                 where btrim(x.operator) <> '' order by 1);
      if array(select unnest(a) order by 1) is distinct from b then bad := bad + 1; end if;
    end loop;
    reset role;
  end loop;
  insert into _t(check_name, result) values ('2 or_operators = lecture d''origine (' || n || ' cas utilisateur x societe)',
    case when bad = 0 and n > 0 then 'ok' else 'KO ' || bad end);
  perform set_config('request.jwt.claims', '', true);
end $s$;

insert into _t(check_name, result)
select '3 anon ne peut pas executer schema_probe / or_operators',
  case when not has_function_privilege('anon', 'public.schema_probe(text[])', 'execute')
        and not has_function_privilege('anon', 'public.or_operators(uuid)', 'execute') then 'ok' else 'KO' end;
