-- =====================================================================
-- Decision Q57 (20/11/2026) -- essai a blanc de 20261120101000_m8_fin_de_journee_question.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) :
--   PRE_SQL = supabase/migrations/20261120100000_m8_tablette_partagee.sql ;
--             supabase/migrations/20261120101000_m8_fin_de_journee_question.sql
-- Scenario (compagnon d'essai : fin d'horaire HIER a 16:30, heure de Bruxelles) :
--   ITALBIKE passe en mode « question » ; un pointage oublie depuis hier 15:00 :
--   la question est posee a 16:30, la pause automatique tombe a 16:35 (fin + 5 min) — motif
--   « fin de journee (automatique) », trace — meme sans aucun ecran (tache serveur) ;
--   « Oui, je continue » repousse la question de 1 h : rien n'est arrete, la question n'est plus
--   due, et la reponse vaut pour un autre pointage du meme mecanicien le meme jour ;
--   « Mettre en pause » : pointage en pause, motif « Pause / fin de journee », trace ;
--   le pointage d'un autre : on ne repond pas a sa place (sauf chef d'atelier / admin) ;
--   mode « arret a l'heure de fin » (lot A) inchange.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _c uuid; _v uuid; _wm uuid; _yd date; _dow int; _or uuid; _or2 uuid;
  _e1 uuid; _e2 uuid; _e3 uuid; _me uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e'; _res jsonb; _n int;
begin
  insert into _t(check_name, result) values ('decision du client : ITALBIKE STORE en mode « question » de fin de journee',
    case when (select auto_stop_mode from public.workshop_planning_settings where company_id = _co) = 'ask'
          and (select end_of_day_prompt_minutes = 5 and end_of_day_snooze_minutes = 60 from public.workshop_planning_settings where company_id = _co)
         then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('tache serveur toutes les 5 minutes',
    case when exists (select 1 from cron.job where jobname = 'workshop-time-auto-stop' and schedule = '*/5 * * * *') then 'ok' else 'FAIL' end);

  insert into public.contacts (company_id, type, first_name, last_name, country)
  values (_co, 'particulier', 'TEST', 'FIN DE JOURNEE', 'BE') returning id into _c;
  insert into public.vehicles (company_id, brand, model, status, notes)
  values (_co, 'DUCATI', 'ESSAI Q57', 'vendu', 'ESSAI A BLANC') returning id into _v;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values (_co, 'ESSAI-Q57-1', _c, _v, 1000, 'en_cours') returning id into _or;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values (_co, 'ESSAI-Q57-2', _c, _v, 1000, 'en_cours') returning id into _or2;
  _yd := (now() at time zone 'Europe/Brussels')::date - 1;
  _dow := extract(isodow from _yd)::int;
  insert into public.workshop_mechanics (company_id, name, visible_in_planning, sort_order, is_active)
  values (_co, 'ESSAI COMPAGNON Q57', false, 999, true) returning id into _wm;
  insert into public.workshop_mechanic_hours (company_id, mechanic_id, weekday, am_start, am_end, pm_start, pm_end)
  values (_co, _wm, _dow, '08:00', '12:00', '13:00', '16:30');

  -- Pointage oublie (code mecano, tablette eteinte) depuis hier 15:00.
  insert into public.workshop_time_entries (company_id, mechanic_code, mechanic_name, workshop_mechanic_id, or_id, kind, started_at)
  values (_co, 'ESSAIQ57', 'ESSAI COMPAGNON Q57', _wm, _or, 'travail', (_yd + time '15:00') at time zone 'Europe/Brussels')
  returning id into _e1;
  insert into _t(check_name, result) values ('question posee a la fin de l''horaire (hier 16:30)',
    case when public.workshop_time_entry_ask_at(_e1) = (_yd + time '16:30') at time zone 'Europe/Brussels' then 'ok'
         else 'FAIL ' || public.workshop_time_entry_ask_at(_e1)::text end);

  -- Pointages du compte d'essai : on ferme ce qui serait ouvert en production.
  update public.workshop_time_entries set ended_at = now(), minutes = 0
   where mechanic_id = _me and mechanic_code is null and ended_at is null and kind in ('travail', 'improductif');
  insert into public.workshop_time_entries (company_id, mechanic_id, mechanic_name, workshop_mechanic_id, or_id, kind, started_at)
  values (_co, _me, 'ESSAI ADMIN', _wm, _or2, 'travail', (_yd + time '14:00') at time zone 'Europe/Brussels')
  returning id into _e2;
  perform set_config('test.e1', _e1::text, true);
  perform set_config('test.e2', _e2::text, true);
  perform set_config('test.wm', _wm::text, true);
  perform set_config('test.or2', _or2::text, true);
  perform set_config('test.yd', _yd::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _me uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _e1 uuid := current_setting('test.e1')::uuid; _e2 uuid := current_setting('test.e2')::uuid;
  _wm uuid := current_setting('test.wm')::uuid; _or2 uuid := current_setting('test.or2')::uuid;
  _yd date := current_setting('test.yd')::date; _res jsonb; _e3 uuid; _n int;
begin
  insert into _t(check_name, result) values ('questions dues : les deux pointages ouverts depuis hier',
    case when (select count(*) from public.workshop_end_of_day_due(_co) d where d.entry_id in (_e1, _e2)) = 2 then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('pause prevue a l''heure de la question + 5 min (hier 16:35)',
    case when (select d.pause_at from public.workshop_end_of_day_due(_co) d where d.entry_id = _e1) = (_yd + time '16:35') at time zone 'Europe/Brussels'
         then 'ok' else 'FAIL' end);

  -- « Oui, je continue » sur le pointage du compte connecte.
  _res := public.workshop_end_of_day_answer(_e2, 'continue');
  insert into _t(check_name, result) values ('« Oui, je continue » : question repoussee de 1 h, trace',
    case when _res->>'status' = 'continue' and (_res->>'next_ask_at')::timestamptz between now() + interval '59 minutes' and now() + interval '61 minutes'
          and exists (select 1 from public.events where action = 'workshop_end_of_day_continue' and new_data->>'time_entry_id' = _e2::text)
          and exists (select 1 from public.workshop_end_of_day_answers where time_entry_id = _e2 and answer = 'continue')
         then 'ok' else 'FAIL ' || _res::text end);

  -- Le filet de securite serveur (meme appel que pg_cron).
  _n := public.workshop_time_auto_stop(_co);
  insert into _t(check_name, result) values ('sans reponse : pointage en pause a 16:35 exactement, motif « fin de journee (automatique) », trace',
    case when exists (select 1 from public.workshop_time_entries where id = _e1 and stop_kind = 'auto_stop' and stop_reason = 'fin_journee_auto'
                        and ended_at = (_yd + time '16:35') at time zone 'Europe/Brussels' and minutes = 95)
          and exists (select 1 from public.events where action = 'workshop_work_auto_stopped' and new_data->>'time_entry_id' = _e1::text
                        and new_data->>'stop_reason' = 'fin_journee_auto')
         then 'ok' else 'FAIL n=' || _n end);
  insert into _t(check_name, result) values ('« je continue » : le pointage n''est pas arrete',
    case when exists (select 1 from public.workshop_time_entries where id = _e2 and ended_at is null) then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('« je continue » : la question n''est plus due pendant 1 h',
    case when not exists (select 1 from public.workshop_end_of_day_due(_co) d where d.entry_id = _e2) then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('pointage en pause automatique = « en pause » pour l''OR (vue d''etat)',
    case when (select work_state from public.workshop_or_work_status where or_id = (select or_id from public.workshop_time_entries where id = _e1)) = 'paused'
         then 'ok' else 'FAIL' end);

  -- Changer d'OR le meme jour : la reponse vaut pour le nouveau pointage.
  perform public.workshop_work_pause('autre', null, _e2);
  insert into public.workshop_time_entries (company_id, mechanic_id, mechanic_name, workshop_mechanic_id, or_id, kind, started_at)
  values (_co, _me, 'ESSAI ADMIN', _wm, _or2, 'travail', (_yd + time '17:10') at time zone 'Europe/Brussels')
  returning id into _e3;
  insert into _t(check_name, result) values ('autre pointage du meme jour (17:10) : la reponse « je continue » vaut aussi',
    case when public.workshop_time_entry_ask_at(_e3) > now() + interval '55 minutes' then 'ok'
         else 'FAIL ' || public.workshop_time_entry_ask_at(_e3)::text end);

  _res := public.workshop_end_of_day_answer(_e3, 'pause');
  insert into _t(check_name, result) values ('« Mettre en pause » : pointage en pause, motif fin de journee, trace',
    case when _res->>'status' = 'paused'
          and exists (select 1 from public.workshop_time_entries where id = _e3 and stop_kind = 'pause' and stop_reason = 'fin_journee')
          and exists (select 1 from public.events where action = 'workshop_end_of_day_pause' and new_data->>'time_entry_id' = _e3::text)
         then 'ok' else 'FAIL ' || _res::text end);

  _res := public.workshop_end_of_day_answer(_e1, 'continue');
  insert into _t(check_name, result) values ('reponse apres la pause automatique : rien a rouvrir',
    case when _res->>'status' = 'already_closed' then 'ok' else 'FAIL ' || _res::text end);
end $s$;
reset role;

-- Un pointage d'un autre : un mecanicien simple ne repond pas a sa place.
do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _u uuid; _e uuid; _wm uuid := current_setting('test.wm')::uuid;
begin
  select ur.user_id into _u from public.user_roles ur
   where ur.company_id = _co and ur.role = 'mecanicien'
     and not exists (select 1 from public.user_roles x where x.user_id = ur.user_id and x.company_id = _co and x.role in ('admin', 'chef_atelier'))
   limit 1;
  if _u is null then
    insert into _t(check_name, result) values ('le pointage d''un autre : refuse (aucun mecanicien simple en base, saute)', 'ok');
    return;
  end if;
  insert into public.workshop_time_entries (company_id, mechanic_code, mechanic_name, workshop_mechanic_id, kind, started_at)
  values (_co, 'ESSAIQ57B', 'ESSAI B', _wm, 'travail', now() - interval '3 hours') returning id into _e;
  perform set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  begin
    perform public.workshop_end_of_day_answer(_e, 'continue');
    insert into _t(check_name, result) values ('le pointage d''un autre : un mecanicien ne repond pas a sa place', 'FAIL (accepte)');
  exception when others then
    insert into _t(check_name, result) values ('le pointage d''un autre : un mecanicien ne repond pas a sa place', case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
end $s$;

-- Mode « arret a l'heure de fin » (lot A) : inchange.
do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _wm uuid := current_setting('test.wm')::uuid;
        _yd date := current_setting('test.yd')::date; _e uuid;
begin
  update public.workshop_planning_settings set auto_stop_mode = 'end_of_schedule' where company_id = _co;
  insert into public.workshop_time_entries (company_id, mechanic_code, mechanic_name, workshop_mechanic_id, kind, started_at)
  values (_co, 'ESSAIQ57C', 'ESSAI COMPAGNON Q57', _wm, 'travail', (_yd + time '15:30') at time zone 'Europe/Brussels') returning id into _e;
  perform set_config('request.jwt.claims', '', true);
  perform public.workshop_time_auto_stop(_co);
  insert into _t(check_name, result) values ('mode « arret a l''heure de fin » : arret a 16:30 (lot A inchange)',
    case when exists (select 1 from public.workshop_time_entries where id = _e and stop_kind = 'auto_stop' and stop_reason = 'fin_journee'
                        and ended_at = (_yd + time '16:30') at time zone 'Europe/Brussels') then 'ok' else 'FAIL' end);
end $s$;
