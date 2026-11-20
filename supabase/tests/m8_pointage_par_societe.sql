-- =====================================================================
-- Decision du 20/11/2026 (bug de la revue UX) -- « un seul pointage actif » vaut PAR SOCIETE.
-- Essai a blanc de 20261120100000_m8_tablette_partagee.sql (+ 20261120101000 pour la fin de journee).
-- A executer DANS UNE TRANSACTION ANNULEE :
--   PRE_SQL = supabase/migrations/20261120100000_m8_tablette_partagee.sql ;
--             supabase/migrations/20261120101000_m8_fin_de_journee_question.sql
-- Le meme compte (administrateur des deux societes) pointe dans ITALBIKE STORE et dans ItalTest
-- (societe de test) : les deux pointages ne s'interrompent pas l'un l'autre ; Pause / Terminer /
-- fin de journee / identite partagee d'une societe ne touchent jamais l'autre.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare
  _ib uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _tt uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _me uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e'; _c1 uuid; _c2 uuid; _o1 uuid; _o2 uuid; _wm uuid;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country) values (_ib, 'particulier', 'TEST', 'SOCIETE IB', 'BE') returning id into _c1;
  insert into public.contacts (company_id, type, first_name, last_name, country) values (_tt, 'particulier', 'TEST', 'SOCIETE TT', 'BE') returning id into _c2;
  insert into public.repair_orders (company_id, number, contact_id, mileage, status) values (_ib, 'ESSAI-SOC-IB', _c1, 1000, 'a_faire') returning id into _o1;
  insert into public.repair_orders (company_id, number, contact_id, mileage, status) values (_tt, 'ESSAI-SOC-TT', _c2, 1000, 'a_faire') returning id into _o2;
  update public.workshop_time_entries set ended_at = now(), minutes = 0
   where mechanic_id = _me and mechanic_code is null and ended_at is null and kind in ('travail', 'improductif');
  -- Compagnon de la societe de test avec un code, pour l'identite partagee.
  insert into public.workshop_mechanics (company_id, name, visible_in_planning, sort_order, is_active)
  values (_tt, 'ESSAI SOCIETE TT', true, 999, true) returning id into _wm;
  insert into public.workshop_mechanic_pins (mechanic_id, company_id, pin_hash) values (_wm, _tt, extensions.crypt('1357', extensions.gen_salt('bf', 4)));
  perform set_config('test.o1', _o1::text, true);
  perform set_config('test.o2', _o2::text, true);
  perform set_config('test.wm', _wm::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _ib uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _tt uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _me uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _o1 uuid := current_setting('test.o1')::uuid; _o2 uuid := current_setting('test.o2')::uuid; _wm uuid := current_setting('test.wm')::uuid;
  _r1 jsonb; _r2 jsonb; _res jsonb; _e1 uuid; _e2 uuid; _s uuid;
begin
  _r1 := public.workshop_work_start(_o1);
  _r2 := public.workshop_work_start(_o2);
  _e1 := (_r1->>'entry_id')::uuid; _e2 := (_r2->>'entry_id')::uuid;
  insert into _t(check_name, result) values ('Demarrer dans ItalTest ne demande pas de mettre en pause le pointage d''ITALBIKE',
    case when _r1->>'status' = 'started' and _r2->>'status' = 'started' then 'ok' else 'FAIL ' || _r1::text || ' / ' || _r2::text end);
  insert into _t(check_name, result) values ('les deux pointages restent ouverts, chacun dans sa societe',
    case when (select count(*) from public.workshop_time_entries where id in (_e1, _e2) and ended_at is null) = 2
          and (select company_id from public.workshop_time_entries where id = _e1) = _ib
          and (select company_id from public.workshop_time_entries where id = _e2) = _tt
         then 'ok' else 'FAIL' end);

  -- Pause depuis la pointeuse d'ItalTest (ni OR ni pointage donnes) : seul le pointage d'ItalTest.
  _res := public.workshop_work_pause('autre', null, null, null, null, 'chrono', _tt);
  insert into _t(check_name, result) values ('Pause dans ItalTest : seul le pointage d''ItalTest, celui d''ITALBIKE tourne encore',
    case when _res->>'entry_id' = _e2::text
          and exists (select 1 from public.workshop_time_entries where id = _e2 and ended_at is not null)
          and exists (select 1 from public.workshop_time_entries where id = _e1 and ended_at is null)
         then 'ok' else 'FAIL ' || _res::text end);

  -- Un pointage donne d'une autre societe que celle de l'ecran : rien n'est fait.
  _res := public.workshop_work_stop(null, _e1, null, 'stop', 'screen', _tt);
  insert into _t(check_name, result) values ('Terminer depuis ItalTest sur le pointage d''ITALBIKE : refuse (rien ne se passe)',
    case when _res->>'status' = 'none' and exists (select 1 from public.workshop_time_entries where id = _e1 and ended_at is null)
         then 'ok' else 'FAIL ' || _res::text end);

  -- Reprendre dans ItalTest pendant qu'ITALBIKE tourne : pas de confirmation, pas d'interruption.
  _res := public.workshop_work_start(_o2);
  insert into _t(check_name, result) values ('Reprendre dans ItalTest : sans toucher ITALBIKE',
    case when _res->>'status' = 'resumed' and exists (select 1 from public.workshop_time_entries where id = _e1 and ended_at is null)
         then 'ok' else 'FAIL ' || _res::text end);
  _e2 := (_res->>'entry_id')::uuid;

  -- Fin de journee : les questions d'une societe ne listent jamais l'autre.
  insert into _t(check_name, result) values ('fin de journee : les questions dues d''ItalTest ne listent pas ITALBIKE (et inversement)',
    case when not exists (select 1 from public.workshop_end_of_day_due(_tt) d where d.entry_id = _e1)
          and not exists (select 1 from public.workshop_end_of_day_due(_ib) d where d.entry_id = _e2)
         then 'ok' else 'FAIL' end);

  -- Identite partagee ouverte dans ItalTest : ne voit ni ne touche un pointage d'ITALBIKE.
  _res := public.workshop_shared_identify(_tt, _wm, '1357');
  _s := (_res->>'session')::uuid;
  begin
    perform public.workshop_shared_work_pause(_s, 'autre', null, _e1);
    insert into _t(check_name, result) values ('identite partagee d''ItalTest : le pointage d''ITALBIKE est refuse', 'FAIL (accepte)');
  exception when others then
    insert into _t(check_name, result) values ('identite partagee d''ItalTest : le pointage d''ITALBIKE est refuse',
      case when sqlstate = '42501' and exists (select 1 from public.workshop_time_entries where id = _e1 and ended_at is null) then 'ok' else 'FAIL ' || sqlerrm end);
  end;
  begin
    perform public.workshop_shared_work_start(_s, _o1);
    insert into _t(check_name, result) values ('identite partagee d''ItalTest : un OR d''ITALBIKE est refuse', 'FAIL (accepte)');
  exception when others then
    insert into _t(check_name, result) values ('identite partagee d''ItalTest : un OR d''ITALBIKE est refuse', case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end);
  end;

  -- Arret automatique demande par l'ecran d'ItalTest : ITALBIKE n'est pas touche.
  perform public.workshop_time_auto_stop(_tt);
  insert into _t(check_name, result) values ('arret automatique lance depuis ItalTest : le pointage d''ITALBIKE n''est pas touche',
    case when exists (select 1 from public.workshop_time_entries where id = _e1 and ended_at is null) then 'ok' else 'FAIL' end);
end $s$;
reset role;
