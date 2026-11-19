-- =====================================================================
-- Parcours mecanicien, lots 0 et A (19/11/2026) — essai a blanc de
-- 20261119240000_m8_figures_manuel_lecture.sql et 20261119241000_m8_pointage_pause_reprise.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119240000_m8_figures_manuel_lecture.sql \
--      supabase/migrations/20261119241000_m8_pointage_pause_reprise.sql \
--      supabase/tests/m8_pointage_pause_reprise.sql; echo "rollback;") > t.sql
-- Joue un administrateur d'ITALBIKE STORE (claims JWT simulees). Scenario :
--   lot 0 : un compte de l'equipe lit les figures du bucket wsm-images ;
--   Demarrer → pointage ouvert + OR « en cours » + trace ; deuxieme Demarrer = deja en cours ;
--   Pause (motif) → pointage clos, motif, statut d'OR propose (attente pieces) ; motif inconnu refuse ;
--   Reprendre → nouveau pointage sur la meme operation, OR « en cours », trace « resumed » ;
--   deux OR → confirmation demandee, puis un seul pointage actif (l'ancien en pause « autre OR ») ;
--   Terminer → pointage clos, statut de l'OR inchange ; temps total exact (50 + 30 = 80 min) ;
--   vue d'etat (en cours / en pause / termine) ; accord client en attente refuse ;
--   arret automatique (horaire du compagnon, fin du planning, heures sup → minuit) ;
--   un pointage clos ne se modifie pas en direct ; correction tracee par l'atelier.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _c uuid; _v uuid; _wm uuid; _yd date; _dow int;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values (_co, 'particulier', 'TEST', 'POINTAGE PAUSE', 'BE') returning id into _c;
  insert into public.vehicles (company_id, brand, model, status, notes)
  values (_co, 'DUCATI', 'ESSAI POINTAGE', 'vendu', 'ESSAI A BLANC') returning id into _v;
  -- Compagnon d'essai : fin de journee 16:30 hier (arret automatique d'apres l'horaire).
  _yd := (now() at time zone 'Europe/Brussels')::date - 1;
  _dow := extract(isodow from _yd)::int;
  insert into public.workshop_mechanics (company_id, name, visible_in_planning, sort_order, is_active)
  values (_co, 'ESSAI COMPAGNON AUTO', false, 999, true) returning id into _wm;
  insert into public.workshop_mechanic_hours (company_id, mechanic_id, weekday, am_start, am_end, pm_start, pm_end)
  values (_co, _wm, _dow, '08:00', '12:00', '13:00', '16:30');
  insert into public.workshop_planning_settings (company_id) values (_co) on conflict (company_id) do nothing;
  update public.workshop_planning_settings set auto_stop_mode = 'end_of_schedule', day_end = '18:00' where company_id = _co;
  perform set_config('test.c', _c::text, true);
  perform set_config('test.v', _v::text, true);
  perform set_config('test.wm', _wm::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _c uuid := current_setting('test.c')::uuid;
  _v uuid := current_setting('test.v')::uuid;
  _wm uuid := current_setting('test.wm')::uuid;
  _me uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _or uuid; _or2 uuid; _or3 uuid; _res jsonb; _e1 uuid; _e2 uuid; _e3 uuid; _err text; _n int;
  _yd date := (now() at time zone 'Europe/Brussels')::date - 1;
  _a1 uuid; _a2 uuid; _a3 uuid; _w record;
begin
  -- ------------------------------------------------------------ lot 0 : figures lisibles
  insert into _t(check_name, result) values ('lot 0 : un compte de l''equipe lit les figures du bucket wsm-images',
    case when exists (select 1 from storage.objects where bucket_id = 'wsm-images' and name = 'edocdmimages/CE/CE1C436F9C173F1877926DD993027855.png')
         then 'ok' else 'FAIL' end);

  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values (_co, 'ESSAI-PT-1', _c, _v, 1000, 'a_faire') returning id into _or;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values (_co, 'ESSAI-PT-2', _c, _v, 1000, 'a_faire') returning id into _or2;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status, customer_approval)
  values (_co, 'ESSAI-PT-3', _c, _v, 1000, 'a_faire', 'en_attente') returning id into _or3;

  -- Le compte d'essai peut avoir un travail ouvert en production : on le laisse hors du scenario.
  update public.workshop_time_entries set ended_at = now(), minutes = 0
   where mechanic_id = _me and mechanic_code is null and ended_at is null and kind in ('travail', 'improductif');

  -- ------------------------------------------------------------ Demarrer
  _res := public.workshop_work_start(_or, 'op3');
  _e1 := (_res->>'entry_id')::uuid;
  insert into _t(check_name, result) values ('Demarrer : pointage de travail ouvert sur l''OR et l''operation',
    case when _res->>'status' = 'started' and exists (select 1 from public.workshop_time_entries
      where id = _e1 and or_id = _or and kind = 'travail' and ended_at is null and journey_operation = 'op3' and mechanic_id = _me)
    then 'ok' else 'FAIL ' || _res::text end);
  insert into _t(check_name, result) values ('Demarrer : OR « en cours »',
    case when (select status from public.repair_orders where id = _or) = 'en_cours' then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('Demarrer : traces events (OR demarre + pointage)',
    case when exists (select 1 from public.events where entity_id = _or::text and action = 'repair_order_work_started')
          and exists (select 1 from public.events where entity_id = _or::text and action = 'workshop_work_started')
    then 'ok' else 'FAIL' end);
  _res := public.workshop_work_start(_or, null);
  insert into _t(check_name, result) values ('Demarrer deux fois : « deja en cours », pas de second pointage',
    case when _res->>'status' = 'already' and (select count(*) from public.workshop_time_entries where or_id = _or and ended_at is null) = 1
    then 'ok' else 'FAIL ' || _res::text end);

  -- Vue d'etat : en cours, par qui, depuis quand.
  select * into _w from public.workshop_or_work_status where or_id = _or;
  insert into _t(check_name, result) values ('Vue d''etat : « en cours » avec le mecanicien et l''heure',
    case when _w.work_state = 'running' and _w.running_by is not null and _w.running_since is not null and _w.running_operation = 'op3'
    then 'ok' else 'FAIL ' || coalesce(_w.work_state, 'null') end);

  -- ------------------------------------------------------------ Pause
  begin
    perform public.workshop_work_pause('pas_un_motif', _or);
    insert into _t(check_name, result) values ('Pause : motif inconnu refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('Pause : motif inconnu refuse', case when _err like 'Motif de pause inconnu%' then 'ok' else 'FAIL ' || _err end);
  end;
  -- 50 minutes de travail avant la pause.
  update public.workshop_time_entries set started_at = now() - interval '50 minutes' where id = _e1;
  _res := public.workshop_work_pause('attente_piece', _or, null, 'attente_pieces');
  insert into _t(check_name, result) values ('Pause : pointage clos avec motif et minutes exactes (50)',
    case when _res->>'status' = 'paused' and exists (select 1 from public.workshop_time_entries
      where id = _e1 and ended_at is not null and stop_kind = 'pause' and stop_reason = 'attente_piece' and minutes = 50.00)
    then 'ok' else 'FAIL ' || _res::text end);
  insert into _t(check_name, result) values ('Pause « attente piece » : OR passe « pieces en commande » (propose)',
    case when (select status from public.repair_orders where id = _or) = 'attente_pieces' and (_res->>'or_status_changed')::boolean
          and exists (select 1 from public.events where entity_id = _or::text and action = 'repair_order_status_from_pause')
    then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('Pause : trace events workshop_work_paused',
    case when exists (select 1 from public.events where entity_id = _or::text and action = 'workshop_work_paused'
                       and new_data->>'stop_reason' = 'attente_piece') then 'ok' else 'FAIL' end);
  select * into _w from public.workshop_or_work_status where or_id = _or;
  insert into _t(check_name, result) values ('Vue d''etat : « en pause » avec le motif',
    case when _w.work_state = 'paused' and _w.last_stop_reason = 'attente_piece' then 'ok' else 'FAIL ' || coalesce(_w.work_state, 'null') end);

  -- ------------------------------------------------------------ Reprendre
  _res := public.workshop_work_start(_or, null);
  _e2 := (_res->>'entry_id')::uuid;
  insert into _t(check_name, result) values ('Reprendre : nouveau pointage, meme operation (op3)',
    case when _res->>'status' = 'resumed' and _e2 <> _e1 and exists (select 1 from public.workshop_time_entries
      where id = _e2 and or_id = _or and ended_at is null and journey_operation = 'op3') then 'ok' else 'FAIL ' || _res::text end);
  insert into _t(check_name, result) values ('Reprendre : OR repasse « en cours » + trace workshop_work_resumed',
    case when (select status from public.repair_orders where id = _or) = 'en_cours'
          and exists (select 1 from public.events where entity_id = _or::text and action = 'workshop_work_resumed') then 'ok' else 'FAIL' end);

  -- ------------------------------------------------------------ Deux OR : un seul actif
  _res := public.workshop_work_start(_or2, null);
  insert into _t(check_name, result) values ('Deux OR : confirmation demandee, rien ne change',
    case when _res->>'status' = 'needs_confirm' and (_res->'current'->>'or_id')::uuid = _or
          and (select count(*) from public.workshop_time_entries where mechanic_id = _me and mechanic_code is null and ended_at is null and kind = 'travail') = 1
    then 'ok' else 'FAIL ' || _res::text end);
  update public.workshop_time_entries set started_at = now() - interval '30 minutes' where id = _e2;
  _res := public.workshop_work_start(_or2, null, true);
  _e3 := (_res->>'entry_id')::uuid;
  insert into _t(check_name, result) values ('Deux OR confirme : l''ancien en pause « autre OR », un seul pointage actif',
    case when (_res->>'switched_from')::uuid = _e2
          and exists (select 1 from public.workshop_time_entries where id = _e2 and stop_kind = 'switch' and stop_reason = 'autre_or' and minutes = 30.00)
          and (select count(*) from public.workshop_time_entries where mechanic_id = _me and mechanic_code is null and ended_at is null and kind in ('travail', 'improductif')) = 1
          and exists (select 1 from public.workshop_time_entries where id = _e3 and or_id = _or2 and ended_at is null)
    then 'ok' else 'FAIL ' || _res::text end);
  begin
    insert into public.workshop_time_entries (company_id, mechanic_id, mechanic_name, kind, or_id)
    values (_co, _me, 'DOUBLON', 'travail', _or);
    insert into _t(check_name, result) values ('Un seul pointage actif garanti en base (index unique)', 'FAIL accepte');
  exception when unique_violation then
    insert into _t(check_name, result) values ('Un seul pointage actif garanti en base (index unique)', 'ok');
  end;

  -- ------------------------------------------------------------ Terminer + temps total
  _res := public.workshop_work_stop(_or2);
  insert into _t(check_name, result) values ('Terminer : pointage clos (stop), statut de l''OR inchange (en cours)',
    case when _res->>'status' = 'stopped' and exists (select 1 from public.workshop_time_entries where id = _e3 and stop_kind = 'stop' and ended_at is not null)
          and (select status from public.repair_orders where id = _or2) = 'en_cours' then 'ok' else 'FAIL ' || _res::text end);
  insert into _t(check_name, result) values ('Temps total exact de l''OR : 50 + 30 = 80 min (pointeuse, B11)',
    case when public.or_worked_minutes(_or) = 80.00 then 'ok' else 'FAIL ' || public.or_worked_minutes(_or)::text end);
  select * into _w from public.workshop_or_work_status where or_id = _or2;
  insert into _t(check_name, result) values ('Vue d''etat : « termine » apres Terminer',
    case when _w.work_state = 'stopped' then 'ok' else 'FAIL ' || coalesce(_w.work_state, 'null') end);

  -- ------------------------------------------------------------ Accord client en attente
  begin
    perform public.workshop_work_start(_or3, null, true);
    insert into _t(check_name, result) values ('Demarrer refuse si l''accord du client est en attente', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('Demarrer refuse si l''accord du client est en attente', case when _err like '%accord du client en attente%' then 'ok' else 'FAIL ' || _err end);
  end;

  -- ------------------------------------------------------------ Arret automatique
  -- a1 : compagnon avec horaire (fin 16:30 hier) ; a2 : sans compagnon → fin du planning (18:00) ;
  -- a3 : commence apres la fin (heures sup, 19:00) → minuit.
  insert into public.workshop_time_entries (company_id, mechanic_code, mechanic_name, workshop_mechanic_id, kind, or_id, started_at)
  values (_co, 'ESSAI-A1', 'ESSAI COMPAGNON AUTO', _wm, 'travail', _or, (_yd + time '10:00') at time zone 'Europe/Brussels') returning id into _a1;
  insert into public.workshop_time_entries (company_id, mechanic_code, mechanic_name, kind, or_id, started_at)
  values (_co, 'ESSAI-A2', 'ESSAI SANS HORAIRE', 'travail', _or, (_yd + time '10:00') at time zone 'Europe/Brussels') returning id into _a2;
  insert into public.workshop_time_entries (company_id, mechanic_code, mechanic_name, kind, or_id, started_at)
  values (_co, 'ESSAI-A3', 'ESSAI HEURES SUP', 'travail', _or, (_yd + time '19:00') at time zone 'Europe/Brussels') returning id into _a3;
  _n := public.workshop_time_auto_stop(_co);
  insert into _t(check_name, result) values ('Arret automatique : pointage clos a la fin de l''horaire du compagnon (16:30)',
    case when exists (select 1 from public.workshop_time_entries where id = _a1 and stop_kind = 'auto_stop' and stop_reason = 'fin_journee'
                       and ended_at = (_yd + time '16:30') at time zone 'Europe/Brussels' and minutes = 390.00) then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('Arret automatique : sans horaire, fin de journee du planning (18:00)',
    case when exists (select 1 from public.workshop_time_entries where id = _a2 and stop_kind = 'auto_stop'
                       and ended_at = (_yd + time '18:00') at time zone 'Europe/Brussels') then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('Arret automatique : commence apres la fin (heures sup) → arrete a minuit',
    case when exists (select 1 from public.workshop_time_entries where id = _a3 and stop_kind = 'auto_stop'
                       and ended_at = ((_yd + 1)::timestamp) at time zone 'Europe/Brussels') then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('Arret automatique : trace events workshop_work_auto_stopped (origine auto)',
    case when _n >= 3 and (select count(*) from public.events where action = 'workshop_work_auto_stopped' and origin = 'auto'
                                and new_data->>'time_entry_id' in (_a1::text, _a2::text, _a3::text)) = 3 then 'ok' else 'FAIL ' || _n end);

  -- Reglage « off » : rien n'est arrete.
  update public.workshop_planning_settings set auto_stop_mode = 'off' where company_id = _co;
  insert into public.workshop_time_entries (company_id, mechanic_code, mechanic_name, kind, or_id, started_at)
  values (_co, 'ESSAI-A4', 'ESSAI OFF', 'travail', _or, (_yd + time '10:00') at time zone 'Europe/Brussels') returning id into _a1;
  perform public.workshop_time_auto_stop(_co);
  insert into _t(check_name, result) values ('Arret automatique « off » : le pointage reste ouvert',
    case when (select ended_at from public.workshop_time_entries where id = _a1) is null then 'ok' else 'FAIL' end);

  -- ------------------------------------------------------------ Pointage clos : correction tracee
  begin
    update public.workshop_time_entries set ended_at = ended_at + interval '1 hour' where id = _a2;
    insert into _t(check_name, result) values ('Pointage clos : fin non modifiable en direct', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('Pointage clos : fin non modifiable en direct', case when _err like 'Pointage clos%' then 'ok' else 'FAIL ' || _err end);
  end;
  _res := public.workshop_time_entry_correct(_a2, (_yd + time '17:00') at time zone 'Europe/Brussels', 'Parti a 17 h');
  insert into _t(check_name, result) values ('Correction par l''atelier : nouvelle fin, minutes recalculees, trace',
    case when exists (select 1 from public.workshop_time_entries where id = _a2 and minutes = 420.00 and corrected_at is not null)
          and exists (select 1 from public.events where entity_id = _a2::text and action = 'workshop_time_entry_corrected') then 'ok' else 'FAIL ' || _res::text end);
end $s$;

reset role;
select * from _t order by n;
