-- =====================================================================
-- Decision Q60 (20/11/2026) -- essai a blanc de 20261120100000_m8_tablette_partagee.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   PRE_SQL = supabase/migrations/20261120100000_m8_tablette_partagee.sql
-- Aucun compte n'est cree : le compte administrateur d'essai joue la « tablette atelier »
-- (mode partage pose directement, transaction annulee).
-- Scenario :
--   code a 4 chiffres pose par l'administrateur (illisible : seul le hachage est garde, jamais trace) ;
--   compte en mode partage : Demarrer sans « Qui etes-vous ? » refuse ;
--   mauvais code -> refus trace, 5 erreurs -> blocage ; bon code -> identite (2 min) ;
--   Demarrer sous l'identite -> pointage AU NOM DU MECANICIEN (code JOHN-like, pas le compte
--   tablette), trace « qui a agi, depuis quel compte » ; un seul pointage actif ;
--   compagnon relie a un compte -> pointage sur CE compte (mechanic_id) ;
--   Pause / Terminer sous l'identite ; le pointage d'un autre refuse ;
--   identite expiree -> redemandee (28000) ; trace d'un geste (operation cochee) ;
--   mode du compte : la fiche compagnon du compte tablette est cachee du planning.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _c uuid; _v uuid; _wm uuid; _wm2 uuid; _u2 uuid; _or uuid; _or2 uuid;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values (_co, 'particulier', 'TEST', 'TABLETTE PARTAGEE', 'BE') returning id into _c;
  insert into public.vehicles (company_id, brand, model, status, notes)
  values (_co, 'DUCATI', 'ESSAI Q60', 'vendu', 'ESSAI A BLANC') returning id into _v;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values (_co, 'ESSAI-Q60-1', _c, _v, 1000, 'a_faire') returning id into _or;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values (_co, 'ESSAI-Q60-2', _c, _v, 1000, 'a_faire') returning id into _or2;
  -- Compagnon sans compte (comme John, Livio, Luis).
  insert into public.workshop_mechanics (company_id, name, visible_in_planning, sort_order, is_active)
  values (_co, 'Essaï Tablette', true, 998, true) returning id into _wm;
  -- Compagnon relie a un compte (Simon-atelier en production) : on reutilise sa fiche.
  select m.id, m.user_id into _wm2, _u2 from public.workshop_mechanics m
   where m.company_id = _co and m.user_id is not null and m.user_id <> 'd9409378-a554-4cb2-97d6-e0b84aba204e' and m.is_active
   order by m.sort_order limit 1;
  update public.workshop_time_entries set ended_at = now(), minutes = 0
   where (mechanic_id in ('d9409378-a554-4cb2-97d6-e0b84aba204e', _u2) and mechanic_code is null) and ended_at is null and kind in ('travail', 'improductif');
  insert into public.workshop_tablet_accounts (company_id, user_id, mode) values (_co, 'd9409378-a554-4cb2-97d6-e0b84aba204e', 'shared')
  on conflict (company_id, user_id) do update set mode = 'shared';
  if _wm2 is not null then
    insert into public.workshop_mechanic_pins (mechanic_id, company_id, pin_hash)
    values (_wm2, _co, extensions.crypt('7777', extensions.gen_salt('bf', 4)))
    on conflict (mechanic_id) do update set pin_hash = excluded.pin_hash;
  end if;
  perform set_config('test.or', _or::text, true);
  perform set_config('test.or2', _or2::text, true);
  perform set_config('test.wm', _wm::text, true);
  perform set_config('test.wm2', coalesce(_wm2::text, ''), true);
  perform set_config('test.u2', coalesce(_u2::text, ''), true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _me uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _or uuid := current_setting('test.or')::uuid;
  _or2 uuid := current_setting('test.or2')::uuid;
  _wm uuid := current_setting('test.wm')::uuid;
  _wm2 uuid := nullif(current_setting('test.wm2'), '')::uuid;
  _u2 uuid := nullif(current_setting('test.u2'), '')::uuid;
  _res jsonb; _s uuid; _s2 uuid; _e uuid; _err text; _state text; _i int;
begin
  -- ------------------------------------------------------------ codes
  _res := public.workshop_mechanic_pin_set(_wm, '4821');
  insert into _t(check_name, result) values ('code a 4 chiffres pose par l''administrateur',
    case when _res->>'status' = 'set' then 'ok' else 'FAIL ' || _res::text end);
  insert into _t(check_name, result) values ('code illisible depuis l''application (table sans droit de lecture)',
    case when not has_table_privilege('authenticated', 'public.workshop_mechanic_pins', 'select') then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('le code n''est jamais ecrit dans events',
    case when not exists (select 1 from public.events where action = 'workshop_mechanic_pin_set' and entity_id = _wm::text
                           and (new_data::text like '%4821%' or coalesce(old_data::text, '') like '%4821%'))
              and exists (select 1 from public.events where action = 'workshop_mechanic_pin_set' and entity_id = _wm::text)
         then 'ok' else 'FAIL' end);
  begin
    perform public.workshop_mechanic_pin_set(_wm, '12a4');
    insert into _t(check_name, result) values ('code qui n''est pas fait de 4 chiffres refuse', 'FAIL (accepte)');
  exception when others then
    insert into _t(check_name, result) values ('code qui n''est pas fait de 4 chiffres refuse', case when sqlstate = '22023' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
  insert into _t(check_name, result) values ('« Qui etes-vous ? » propose le compagnon, avec son code',
    case when exists (select 1 from public.workshop_shared_mechanics(_co) m where m.id = _wm and m.has_pin) then 'ok' else 'FAIL' end);

  -- ------------------------------------------------------------ compte en mode partage (pose a la preparation)
  insert into _t(check_name, result) values ('le compte se sait en mode partage',
    case when public.workshop_tablet_mode(_co)->>'mode' = 'shared' then 'ok' else 'FAIL' end);
  begin
    perform public.workshop_work_start(_or);
    insert into _t(check_name, result) values ('mode partage : Demarrer sans identite refuse', 'FAIL (accepte)');
  exception when others then
    insert into _t(check_name, result) values ('mode partage : Demarrer sans identite refuse', case when sqlstate = '28000' then 'ok' else 'FAIL ' || sqlerrm end);
  end;

  _res := public.workshop_shared_identify(_co, _wm, '0000');
  insert into _t(check_name, result) values ('mauvais code : refuse et trace (sans ouvrir d''identite)',
    case when _res->>'status' = 'wrong_code'
          and exists (select 1 from public.events where action = 'workshop_shared_pin_failed' and entity_id = _wm::text)
         then 'ok' else 'FAIL ' || _res::text end);

  _res := public.workshop_shared_identify(_co, _wm, '4821');
  _s := (_res->>'session')::uuid;
  insert into _t(check_name, result) values ('bon code : identite ouverte pour 120 s (reglage par defaut)',
    case when _res->>'status' = 'ok' and (_res->>'ttl_seconds')::int = 120 and _s is not null then 'ok' else 'FAIL ' || _res::text end);

  -- ------------------------------------------------------------ pointage au nom du mecanicien
  _res := public.workshop_shared_work_start(_s, _or, 'op1');
  _e := (_res->>'entry_id')::uuid;
  insert into _t(check_name, result) values ('Demarrer sous l''identite : pointage au nom du mecanicien (code ESSAITABLETTE, pas le compte tablette)',
    case when _res->>'status' = 'started' and exists (select 1 from public.workshop_time_entries
      where id = _e and or_id = _or and ended_at is null and mechanic_id is null and mechanic_code = 'ESSAITABLETTE'
        and workshop_mechanic_id = _wm and mechanic_name = 'Essaï Tablette')
    then 'ok' else 'FAIL ' || _res::text end);
  insert into _t(check_name, result) values ('trace : qui a agi (le compagnon), depuis quel compte (la tablette)',
    case when exists (select 1 from public.events where action = 'workshop_shared_action' and entity_id = _or::text
                        and new_data->>'gesture' = 'start' and new_data->>'acting_mechanic' = 'Essaï Tablette'
                        and new_data->>'from_account' = _me::text and actor_id = _me)
         then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('le compte tablette n''a aucun pointage a son nom',
    case when not exists (select 1 from public.workshop_time_entries where mechanic_id = _me and or_id in (_or, _or2)) then 'ok' else 'FAIL' end);

  _res := public.workshop_shared_work_start(_s, _or2);
  insert into _t(check_name, result) values ('un seul pointage actif par mecanicien : autre OR -> confirmation demandee',
    case when _res->>'status' = 'needs_confirm' then 'ok' else 'FAIL ' || _res::text end);

  _res := public.workshop_shared_current(_s);
  insert into _t(check_name, result) values ('bandeau de la tablette : pointage en cours du compagnon identifie',
    case when (_res->'open'->>'id')::uuid = _e then 'ok' else 'FAIL ' || _res::text end);

  _res := public.workshop_shared_work_pause(_s, 'attente_piece', _or);
  insert into _t(check_name, result) values ('Pause sous l''identite : pointage du mecanicien en pause, trace',
    case when _res->>'status' = 'paused' and exists (select 1 from public.workshop_time_entries where id = _e and stop_kind = 'pause' and stop_reason = 'attente_piece')
          and exists (select 1 from public.events where action = 'workshop_shared_action' and new_data->>'gesture' = 'pause' and new_data->>'acting_mechanic' = 'Essaï Tablette')
         then 'ok' else 'FAIL ' || _res::text end);

  _res := public.workshop_shared_work_start(_s, _or);
  insert into _t(check_name, result) values ('Reprendre sous l''identite : meme operation, nouveau pointage du mecanicien',
    case when _res->>'status' = 'resumed' and _res->>'operation' = 'op1' then 'ok' else 'FAIL ' || _res::text end);
  _e := (_res->>'entry_id')::uuid;

  -- Compagnon relie a un compte : son pointage va sur son compte.
  if _wm2 is not null then
    _res := public.workshop_shared_identify(_co, _wm2, '7777');
    _s2 := (_res->>'session')::uuid;
    _res := public.workshop_shared_work_start(_s2, _or2, null, true);
    insert into _t(check_name, result) values ('compagnon relie a un compte : pointage sur CE compte (comme sur sa propre tablette)',
      case when _res->>'status' = 'started' and exists (select 1 from public.workshop_time_entries
        where id = (_res->>'entry_id')::uuid and mechanic_id = _u2 and mechanic_code is null and workshop_mechanic_id = _wm2)
      then 'ok' else 'FAIL ' || _res::text end);
    begin
      perform public.workshop_shared_current(_s);
      insert into _t(check_name, result) values ('une seule identite a la fois : la precedente est close', 'FAIL (encore valable)');
    exception when others then
      insert into _t(check_name, result) values ('une seule identite a la fois : la precedente est close', case when sqlstate = '28000' then 'ok' else 'FAIL ' || sqlerrm end);
    end;
    begin
      perform public.workshop_shared_work_stop(_s2, null, _e);
      insert into _t(check_name, result) values ('le pointage d''un autre mecanicien : refuse', 'FAIL (accepte)');
    exception when others then
      insert into _t(check_name, result) values ('le pointage d''un autre mecanicien : refuse', case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end);
    end;
    _res := public.workshop_shared_identify(_co, _wm, '4821');
    _s := (_res->>'session')::uuid;
  else
    insert into _t(check_name, result) values ('compagnon relie a un compte : (aucun en base, controle saute)', 'ok');
  end if;

  _res := public.workshop_shared_work_stop(_s, _or);
  insert into _t(check_name, result) values ('Terminer sous l''identite : pointage clos « Terminer », trace',
    case when _res->>'status' = 'stopped' and exists (select 1 from public.workshop_time_entries where id = _e and stop_kind = 'stop')
          and exists (select 1 from public.events where action = 'workshop_shared_action' and new_data->>'gesture' = 'finish')
         then 'ok' else 'FAIL ' || _res::text end);

  _res := public.workshop_shared_trace(_s, 'operation_set', 'repair_order_plan_operations', gen_random_uuid()::text, '{"status":"fait"}'::jsonb);
  insert into _t(check_name, result) values ('autre geste (operation cochee) : trace qui / depuis quel compte',
    case when _res->>'status' = 'traced' and exists (select 1 from public.events where action = 'workshop_shared_action'
           and new_data->>'gesture' = 'operation_set' and new_data->>'status' = 'fait' and new_data->>'from_account' = _me::text)
         then 'ok' else 'FAIL ' || _res::text end);

  perform set_config('test.s', _s::text, true);
end $s$;
reset role;

-- Identite expiree (horloge avancee a la main) : redemandee.
update public.workshop_shared_sessions set expires_at = now() - interval '1 second' where id = current_setting('test.s')::uuid;
set local role authenticated;
do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _wm uuid := current_setting('test.wm')::uuid;
        _s uuid := current_setting('test.s')::uuid; _or uuid := current_setting('test.or')::uuid; _res jsonb; _i int;
begin
  begin
    perform public.workshop_shared_work_start(_s, _or);
    insert into _t(check_name, result) values ('identite expiree (2 min) : redemandee', 'FAIL (acceptee)');
  exception when others then
    insert into _t(check_name, result) values ('identite expiree (2 min) : redemandee', case when sqlstate = '28000' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
  for _i in 1..5 loop perform public.workshop_shared_identify(_co, _wm, '9999'); end loop;
  _res := public.workshop_shared_identify(_co, _wm, '4821');
  insert into _t(check_name, result) values ('5 codes faux en 10 min : compagnon bloque, meme avec le bon code',
    case when _res->>'status' = 'locked' then 'ok' else 'FAIL ' || _res::text end);
end $s$;
reset role;

-- ------------------------------------------------------------ mode du compte (fiche cachee)
do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _u uuid; _wm uuid; _res jsonb;
begin
  select m.user_id, m.id into _u, _wm from public.workshop_mechanics m
   where m.company_id = _co and m.user_id is not null and m.user_id <> 'd9409378-a554-4cb2-97d6-e0b84aba204e'
     and m.is_active order by m.sort_order desc limit 1;
  if _u is null then
    insert into _t(check_name, result) values ('mode partage d''un compte : (aucun compte relie, controle saute)', 'ok');
    return;
  end if;
  perform set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
  _res := public.workshop_tablet_mode_set(_co, _u, 'shared');
  insert into _t(check_name, result) values ('compte passe en tablette partagee : sa fiche compagnon est cachee du planning, trace',
    case when (select not is_active and not visible_in_planning from public.workshop_mechanics where id = _wm)
          and exists (select 1 from public.events where action = 'workshop_tablet_mode_set' and entity_id = _u::text)
         then 'ok' else 'FAIL ' || _res::text end);
  perform public.workshop_mechanic_sync(_u, _co);
  insert into _t(check_name, result) values ('la synchronisation des roles ne reactive pas la fiche du compte tablette',
    case when (select not is_active from public.workshop_mechanics where id = _wm) then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('aucun role change (droits du compte inchanges)',
    case when exists (select 1 from public.user_roles where user_id = _u and company_id = _co) then 'ok' else 'FAIL' end);
end $s$;
