-- =====================================================================
-- Decision Q58 (20/11/2026) -- essai a blanc de 20261120102000_m8_picking_veille_ouvree.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   PRE_SQL = supabase/migrations/20261120102000_m8_picking_veille_ouvree.sql
-- Atelier d'essai (ITALBIKE STORE, transaction annulee) : un seul compagnon visible, mardi →
-- samedi ; feries belges coches. Scenario :
--   RDV du mardi 08/12/2026 → veille ouvree = samedi 05/12 ; la liste est due le samedi a 16 h
--   (pas avant), puis en rattrapage dimanche / lundi et le jour meme ; pas le vendredi ;
--   samedi 05/12 ferme (fermeture saisie) → vendredi 04/12 ; RDV du samedi 26/12 → jeudi 24/12
--   (Noel le 25) ; veille calendaire → lundi 07/12 ; reglage trace ; tache de la veille (RDV
--   d'entretien du mardi) → liste creee le samedi.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _wm uuid; _wd int; _b uuid;
  bx text := 'Europe/Brussels';
begin
  update public.workshop_mechanics set visible_in_planning = false where company_id = _co;
  insert into public.workshop_mechanics (company_id, name, visible_in_planning, sort_order, is_active)
  values (_co, 'ESSAI COMPAGNON Q58', true, 999, true) returning id into _wm;
  for _wd in 2..6 loop
    insert into public.workshop_mechanic_hours (company_id, mechanic_id, weekday, am_start, am_end, pm_start, pm_end)
    values (_co, _wm, _wd, '09:00', '12:30', '13:30', '18:00');
  end loop;
  insert into public.workshop_planning_settings (company_id) values (_co) on conflict (company_id) do nothing;
  update public.workshop_planning_settings
     set belgian_holidays = true, picking_auto_mode = 'veille', picking_eve_hour = 16, picking_eve_basis = 'ouvree'
   where company_id = _co;

  insert into _t(check_name, result) values ('reglage par defaut : veille ouvree',
    case when public._workshop_picking_eve_basis(_co) = 'ouvree' then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('jours d''ouverture : mardi 08/12 ouvert, dimanche 06/12 et lundi 07/12 fermes',
    case when public.workshop_day_is_open(_co, '2026-12-08') and not public.workshop_day_is_open(_co, '2026-12-06')
          and not public.workshop_day_is_open(_co, '2026-12-07') then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('RDV du mardi 08/12 → veille ouvree samedi 05/12',
    case when public.workshop_picking_eve_date(_co, '2026-12-08') = '2026-12-05' then 'ok'
         else 'FAIL ' || public.workshop_picking_eve_date(_co, '2026-12-08')::text end);
  insert into _t(check_name, result) values ('liste due samedi 05/12 a 16:30, pas a 10:00, pas vendredi 04/12 a 17:00',
    case when public._workshop_picking_due(_co, timestamp '2026-12-08 09:00' at time zone bx, timestamp '2026-12-05 16:30' at time zone bx)
          and not public._workshop_picking_due(_co, timestamp '2026-12-08 09:00' at time zone bx, timestamp '2026-12-05 10:00' at time zone bx)
          and not public._workshop_picking_due(_co, timestamp '2026-12-08 09:00' at time zone bx, timestamp '2026-12-04 17:00' at time zone bx)
         then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('rattrapage : dimanche, lundi et le jour du RDV',
    case when public._workshop_picking_due(_co, timestamp '2026-12-08 09:00' at time zone bx, timestamp '2026-12-06 08:00' at time zone bx)
          and public._workshop_picking_due(_co, timestamp '2026-12-08 09:00' at time zone bx, timestamp '2026-12-07 08:00' at time zone bx)
          and public._workshop_picking_due(_co, timestamp '2026-12-08 09:00' at time zone bx, timestamp '2026-12-08 07:00' at time zone bx)
          and not public._workshop_picking_due(_co, timestamp '2026-12-08 09:00' at time zone bx, timestamp '2026-12-09 07:00' at time zone bx)
         then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('RDV du samedi 26/12 → jeudi 24/12 (Noel ferie le vendredi 25)',
    case when public.workshop_picking_eve_date(_co, '2026-12-26') = '2026-12-24' then 'ok'
         else 'FAIL ' || public.workshop_picking_eve_date(_co, '2026-12-26')::text end);

  insert into public.workshop_calendar_blocks (company_id, kind, starts_at, ends_at, label)
  values (_co, 'fermeture', timestamp '2026-12-05 00:00' at time zone bx, timestamp '2026-12-06 00:00' at time zone bx, 'ESSAI fermeture')
  returning id into _b;
  insert into _t(check_name, result) values ('samedi 05/12 ferme (fermeture saisie) → vendredi 04/12',
    case when public.workshop_picking_eve_date(_co, '2026-12-08') = '2026-12-04' then 'ok'
         else 'FAIL ' || public.workshop_picking_eve_date(_co, '2026-12-08')::text end);
  delete from public.workshop_calendar_blocks where id = _b;

  update public.workshop_planning_settings set picking_eve_basis = 'calendaire' where company_id = _co;
  insert into _t(check_name, result) values ('veille calendaire : RDV du mardi → lundi 07/12, pas due le samedi',
    case when public.workshop_picking_eve_date(_co, '2026-12-08') = '2026-12-07'
          and not public._workshop_picking_due(_co, timestamp '2026-12-08 09:00' at time zone bx, timestamp '2026-12-05 16:30' at time zone bx)
         then 'ok' else 'FAIL' end);
  update public.workshop_planning_settings set picking_eve_basis = 'ouvree' where company_id = _co;
end $s$;

-- Reglage ecrit par l'ecran (administrateur simule) : trace.
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _res jsonb; _u numeric;
begin
  _u := (public.workshop_parts_settings(_co)->>'urgent_days')::numeric;
  _res := public.workshop_parts_settings_set(_co, 'veille', 16, _u, 'calendaire');
  insert into _t(check_name, result) values ('reglage « veille calendaire » enregistre et trace (ancien / nouveau)',
    case when _res->>'eve_basis' = 'calendaire' and public.workshop_parts_settings(_co)->>'eve_basis' = 'calendaire'
          and exists (select 1 from public.events where action = 'workshop_parts_settings' and new_data->>'eve_basis' = 'calendaire'
                       and old_data->>'eve_basis' = 'ouvree')
         then 'ok' else 'FAIL ' || _res::text end);
  _res := public.workshop_parts_settings_set(_co, 'veille', 16, _u);
  insert into _t(check_name, result) values ('ancien appel sans la veille : le reglage est garde',
    case when _res->>'eve_basis' = 'calendaire' then 'ok' else 'FAIL ' || _res::text end);
  _res := public.workshop_parts_settings_set(_co, 'veille', 16, _u, 'ouvree');
  begin
    perform public.workshop_parts_settings_set(_co, 'veille', 16, _u, 'lendemain');
    insert into _t(check_name, result) values ('valeur inconnue refusee', 'FAIL (acceptee)');
  exception when others then
    insert into _t(check_name, result) values ('valeur inconnue refusee', 'ok');
  end;
end $s$;
reset role;

-- Tache de la veille : un RDV d'entretien du mardi, vu le samedi 16:05.
do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _a uuid; _v uuid; _c uuid; _n int; bx text := 'Europe/Brussels';
        _my text;
begin
  select v.id, v.ducati_model_year_id into _v, _my from public.vehicles v
   where v.company_id = _co and v.ducati_model_year_id is not null limit 1;
  select c.id into _c from public.contacts c where c.company_id = _co and c.type <> 'fournisseur' order by c.created_at limit 1;
  insert into public.workshop_appointments (company_id, contact_id, vehicle_id, starts_at, planned_minutes, status, service_code, unassigned, work_description, mileage)
  values (_co, _c, _v, timestamp '2026-12-08 10:00' at time zone bx, 60, 'prevu', 'annual', true, 'ESSAI Q58', 10000)
  returning id into _a;
  delete from public.picking_lists where appointment_id = _a;   -- au cas ou le declencheur l'aurait faite
  _n := public._cron_workshop_picking_eve(timestamp '2026-12-04 17:05' at time zone bx, _co);
  insert into _t(check_name, result) values ('tache de la veille, vendredi 04/12 : pas encore de liste pour le RDV du mardi',
    case when not exists (select 1 from public.picking_lists where appointment_id = _a and status <> 'annulee') then 'ok' else 'FAIL' end);
  _n := public._cron_workshop_picking_eve(timestamp '2026-12-05 16:05' at time zone bx, _co);
  insert into _t(check_name, result) values ('tache de la veille, samedi 05/12 16:05 : liste du RDV du mardi creee (ou rien a preparer)',
    case when exists (select 1 from public.picking_lists where appointment_id = _a and status <> 'annulee')
           or exists (select 1 from public.events where action = 'picking_auto_failed' and entity_id = _a::text)
           or _n = 0 and not exists (select 1 from public._workshop_service_kit_items(_co, _my, 'annual') k where k.article_id is not null)
         then 'ok' else 'FAIL n=' || _n end);
end $s$;
