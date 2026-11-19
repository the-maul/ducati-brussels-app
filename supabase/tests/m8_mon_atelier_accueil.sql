-- =====================================================================
-- Parcours mecanicien, lot F (19/11/2026) — essai a blanc de 20261119290000_m8_mon_atelier_accueil.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119290000_m8_mon_atelier_accueil.sql \
--      supabase/tests/m8_mon_atelier_accueil.sql; echo "rollback;") > t.sql
-- Scenario : colonne et contrainte presentes ; migration rejouable ; un compte connecte (claims
-- JWT simulees) enregistre SA page d'accueil (valeurs permises), une valeur inconnue est refusee ;
-- il ne peut ni lire ni modifier la ligne d'un autre compte ; aucune politique nouvelle sur
-- profiles ; les colonnes relues par l'ecran existent et se lisent.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

insert into _t(check_name, result)
select 'colonne profiles.home_page presente',
  case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'home_page') then 'ok' else 'FAIL' end;
insert into _t(check_name, result)
select 'contrainte des valeurs presente',
  case when exists (select 1 from pg_constraint where conname = 'profiles_home_page_check') then 'ok' else 'FAIL' end;

-- Rejouable : la meme migration une deuxieme fois ne casse rien.
do $r$ begin
  alter table public.profiles add column if not exists home_page text;
  if not exists (select 1 from pg_constraint where conname = 'profiles_home_page_check' and conrelid = 'public.profiles'::regclass) then
    raise exception 'contrainte perdue';
  end if;
  insert into _t(check_name, result) values ('migration rejouable', 'ok');
end $r$;

insert into _t(check_name, result)
select 'politiques de profiles inchangees (lecture / modification de sa ligne seulement)',
  case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles') = 2
        and exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles_update_own')
        and exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles_select_own')
       then 'ok' else 'FAIL ' || (select string_agg(policyname, ',') from pg_policies where tablename = 'profiles') end;

insert into _t(check_name, result)
select 'droit colonne : modifier home_page oui, is_active toujours non',
  case when has_column_privilege('authenticated', 'public.profiles', 'home_page', 'UPDATE')
        and not has_column_privilege('authenticated', 'public.profiles', 'is_active', 'UPDATE')
        and has_column_privilege('authenticated', 'public.profiles', 'home_page', 'SELECT')
       then 'ok' else 'FAIL' end;

-- Deux comptes reels : le premier joue le mecanicien, le second « un autre compte ».
do $s$
declare _me uuid; _other uuid;
begin
  select ur.user_id into _me from public.user_roles ur join public.profiles p on p.id = ur.user_id order by ur.user_id limit 1;
  select p.id into _other from public.profiles p where p.id <> _me order by p.id limit 1;
  perform set_config('test.me', _me::text, true);
  perform set_config('test.other', coalesce(_other::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', _me, 'role', 'authenticated')::text, true);
end $s$;
set local role authenticated;

do $s$
declare _me uuid := current_setting('test.me')::uuid; _other text := current_setting('test.other'); _v text; _n int; _err text;
begin
  update public.profiles set home_page = 'my_workshop' where id = _me;
  get diagnostics _n = row_count;
  select home_page into _v from public.profiles where id = _me;
  insert into _t(check_name, result) values ('le compte enregistre « Mon atelier »',
    case when _n = 1 and _v = 'my_workshop' then 'ok' else 'FAIL ' || _n || ' ' || coalesce(_v, 'NULL') end);

  update public.profiles set home_page = 'dashboard' where id = _me;
  select home_page into _v from public.profiles where id = _me;
  insert into _t(check_name, result) values ('le compte enregistre « Tableau de bord »', case when _v = 'dashboard' then 'ok' else 'FAIL ' || coalesce(_v, 'NULL') end);

  update public.profiles set home_page = null where id = _me;
  select home_page into _v from public.profiles where id = _me;
  insert into _t(check_name, result) values ('retour a « selon mon role » (null)', case when _v is null then 'ok' else 'FAIL ' || _v end);

  begin
    update public.profiles set home_page = 'planning' where id = _me;
    _err := 'aucune erreur';
  exception when check_violation then _err := 'refus';
  end;
  insert into _t(check_name, result) values ('valeur inconnue refusee', case when _err = 'refus' then 'ok' else 'FAIL ' || _err end);

  if _other <> '' then
    update public.profiles set home_page = 'my_workshop' where id = _other::uuid;
    get diagnostics _n = row_count;
    insert into _t(check_name, result) values ('la ligne d''un autre compte ne se modifie pas', case when _n = 0 then 'ok' else 'FAIL ' || _n end);
    select count(*) into _n from public.profiles where id = _other::uuid;
    insert into _t(check_name, result) values ('la ligne d''un autre compte ne se lit pas', case when _n = 0 then 'ok' else 'FAIL ' || _n end);
  else
    insert into _t(check_name, result) values ('la ligne d''un autre compte ne se modifie pas', 'ok');
    insert into _t(check_name, result) values ('la ligne d''un autre compte ne se lit pas', 'ok');
  end if;

  -- Ce que relit l'ecran « Mon atelier » (colonnes nommees) : lisible sans erreur par le compte.
  begin
    perform id, name, user_id, is_active from public.workshop_mechanics where false;
    perform id, kind, or_id, mechanic_id, mechanic_code, mechanic_name, journey_operation, started_at, ended_at, minutes, stop_kind, stop_reason, task_code
      from public.workshop_time_entries where false;
    perform or_id, work_state, running_by, running_since from public.workshop_or_work_status where false;
    perform or_id, total, done, not_done from public.repair_order_plan_progress where false;
    perform or_id, status, missing_required from public.repair_order_receptions where false;
    perform repair_order_id, appointment_id, qty_needed, qty_reserved, qty_consumed, status from public.stock_reservations where false;
    perform repair_order_id, appointment_id, status from public.picking_lists where false;
    perform id, number, status, operator, operator_id, service_code, customer_approval from public.repair_orders where false;
    perform id, starts_at, status, or_id, mechanic_id, mechanic_name, unassigned, service_code from public.workshop_appointments where false;
    _err := 'ok';
  exception when others then _err := sqlerrm; end;
  insert into _t(check_name, result) values ('colonnes relues par l''ecran presentes et lisibles', case when _err = 'ok' then 'ok' else 'FAIL ' || _err end);
end $s$;

reset role;
select * from _t order by n;
