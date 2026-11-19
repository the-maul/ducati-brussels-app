-- =====================================================================
-- Parcours mecanicien, lot D (19/11/2026) — essai a blanc de 20261119271000_m8_reparation_guidee.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119271000_m8_reparation_guidee.sql \
--      supabase/tests/m8_reparation_guidee.sql; echo "rollback;") > t.sql
-- Joue un administrateur d'ITALBIKE STORE (claims JWT simulees). Scenario :
--   OR « annuel + huile » d'une moto reliee au manuel d'atelier (Scrambler Cafe Racer 2019) :
--   liste des operations du manuel, procedures reliees, sans doublon a la 2e ouverture ;
--   operation de vidange reliee aux lignes de l'OR (kit) ; moto au plan Ducati seulement (848 / 1098
--   / 1198) : operations du plan ; OR sans entretien : rien ;
--   cocher « fait » = qui, quand, pointage en cours et son operation ; avancement x / y ;
--   « non faite » : motif obligatoire, refus du client = intervention reportee, retour « a faire » =
--   reportee abandonnee ; texte « non realisees » pour la facture ;
--   « Terminer » refuse tant qu'une obligatoire reste, puis pointage arrete + OR « Pret » + SMS
--   traite ; liste figee une fois cochee ; pas d'ecriture directe.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _c uuid; _v uuid; _v2 uuid; _or uuid; _or2 uuid; _or3 uuid; _art uuid;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values (_co, 'particulier', 'TEST', 'REPARATION GUIDEE', 'BE') returning id into _c;
  insert into public.vehicles (company_id, brand, model, status, notes, ducati_model_year_id, maintenance_usage)
  values (_co, 'DUCATI', 'ESSAI SCRAMBLER CAFE RACER', 'vendu', 'ESSAI A BLANC', '900', 'route') returning id into _v;
  insert into public.vehicles (company_id, brand, model, status, notes, ducati_model_year_id, maintenance_usage)
  values (_co, 'DUCATI', 'ESSAI 1098', 'vendu', 'ESSAI A BLANC', '304', 'route') returning id into _v2;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status, service_code)
  values (_co, 'ESSAI-OPS-1', _c, _v, 15000, 'a_faire', 'oil') returning id into _or;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status, service_code)
  values (_co, 'ESSAI-OPS-2', _c, _v2, 12000, 'a_faire', 'annual') returning id into _or2;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status, reason_code)
  values (_co, 'ESSAI-OPS-3', _c, _v, 15000, 'a_faire', 'pneus') returning id into _or3;
  -- Ligne d'huile du kit sur l'OR (Q49).
  select k.article_id into _art from public._workshop_service_kit_items(_co, '900', 'oil') k where k.family_code = 'huile_moteur' limit 1;
  insert into public.repair_order_lines (or_id, kind, article_id, designation, quantity, unit_price_ht, vat_rate, discount_pct, is_warranty, line_ht, line_ttc, sort_order)
  values (_or, 'piece', _art, 'Huile moteur (kit)', 3.4, 10, 21, 0, false, 34, 41.14, 1);
  perform set_config('test.or', _or::text, true);
  perform set_config('test.or2', _or2::text, true);
  perform set_config('test.or3', _or3::text, true);
  perform set_config('test.art', coalesce(_art::text, ''), true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _me uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _or uuid := current_setting('test.or')::uuid;
  _or2 uuid := current_setting('test.or2')::uuid;
  _or3 uuid := current_setting('test.or3')::uuid;
  _res jsonb; _n int; _n2 int; _err text; _vid uuid; _op uuid; _op2 uuid; _e uuid; _def uuid; x record; _txt text;
begin
  -- Le compte d'essai peut avoir un travail ouvert en production : on le laisse hors du scenario.
  update public.workshop_time_entries set ended_at = now(), minutes = 0
   where mechanic_id = _me and mechanic_code is null and ended_at is null and kind in ('travail', 'improductif');

  -- ------------------------------------------------------------ liste depuis le manuel
  _res := public.repair_order_operations_init(_or);
  select count(*) into _n from public.repair_order_plan_operations where or_id = _or;
  insert into _t(check_name, result) values ('OR annuel + huile, moto au manuel : operations du manuel, une case chacune',
    case when _res->>'status' = 'created' and _res->>'source' = 'manuel' and _n >= 10
          and not exists (select 1 from public.repair_order_plan_operations where or_id = _or and status <> 'a_faire')
    then 'ok' else 'FAIL ' || _res::text || ' n=' || _n end);
  insert into _t(check_name, result) values ('operations dans l''ordre du manuel, cles op1..opN (pointage du parcours)',
    case when (select bool_and(op_key = 'op' || sort_order) from public.repair_order_plan_operations where or_id = _or) then 'ok' else 'FAIL' end);
  select id into _vid from public.repair_order_plan_operations where or_id = _or and public._norm_text(label) like 'vidange de l huile moteur%' limit 1;
  insert into _t(check_name, result) values ('vidange huile : procedure pas a pas du manuel reliee',
    case when (select procedure_id from public.repair_order_plan_operations where id = _vid) is not null
          and exists (select 1 from public.ducati_manual_procedures p where p.id = (select procedure_id from public.repair_order_plan_operations where id = _vid))
    then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('vidange huile : consomme huile moteur + filtre (familles du kit)',
    case when (select family_codes from public.repair_order_plan_operations where id = _vid) @> array['huile_moteur', 'filtre_huile'] then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('une operation sans procedure reste dans la liste (mode operatoire non disponible)',
    case when exists (select 1 from public.repair_order_plan_operations where or_id = _or and procedure_id is null and mandatory) then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('vidange huile pointe vers la ligne de l''OR (kit)',
    case when current_setting('test.art') = '' then 'ok (pas de kit en base)'
         when exists (select 1 from public.repair_order_operations_lines(_or) l where l.operation_id = _vid and l.family_code = 'huile_moteur' and l.designation = 'Huile moteur (kit)')
    then 'ok' else 'FAIL' end);

  _res := public.repair_order_operations_init(_or);
  select count(*) into _n2 from public.repair_order_plan_operations where or_id = _or;
  insert into _t(check_name, result) values ('2e ouverture : liste rendue telle quelle, sans doublon',
    case when _res->>'status' = 'exists' and _n2 = _n then 'ok' else 'FAIL ' || _res::text end);

  -- ------------------------------------------------------------ plan Ducati / sans entretien
  _res := public.repair_order_operations_init(_or2);
  insert into _t(check_name, result) values ('moto au plan Ducati seulement : operations du plan d''entretien',
    case when _res->>'status' = 'created' and _res->>'source' = 'plan'
          and exists (select 1 from public.repair_order_plan_operations where or_id = _or2 and plan_operation_id is not null)
    then 'ok' else 'FAIL ' || _res::text end);
  _res := public.repair_order_operations_init(_or3);
  insert into _t(check_name, result) values ('OR sans entretien (pneus) : aucune operation',
    case when _res->>'status' = 'no_service' and not exists (select 1 from public.repair_order_plan_operations where or_id = _or3) then 'ok' else 'FAIL ' || _res::text end);

  -- ------------------------------------------------------------ cocher, tracer, avancement
  _res := public.workshop_work_start(_or, 'op1');
  _e := (_res->>'entry_id')::uuid;
  select id into _op from public.repair_order_plan_operations where or_id = _or and op_key = 'op1';
  _res := public.repair_order_operation_set(_op, 'fait');
  insert into _t(check_name, result) values ('cocher « fait » : qui, quand, pointage en cours et son operation',
    case when exists (select 1 from public.repair_order_plan_operations where id = _op and status = 'fait' and done_by = _me
                       and done_at is not null and done_by_name is not null and time_entry_id = _e and time_entry_operation = 'op1')
    then 'ok' else 'FAIL ' || _res::text end);
  insert into _t(check_name, result) values ('cocher « fait » : trace dans events',
    case when exists (select 1 from public.events where entity_id = _or::text and action = 'repair_order_operation_done'
                       and new_data->>'operation_id' = _op::text and new_data->>'time_entry_id' = _e::text)
    then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('avancement x / y sur l''OR (vue)',
    case when exists (select 1 from public.repair_order_plan_progress where or_id = _or and done = 1 and total = _n
                       and mandatory_open = mandatory_total - 1)
    then 'ok' else 'FAIL' end);
  _res := public.repair_order_operation_set(_op, 'a_faire');
  insert into _t(check_name, result) values ('decocher : revient « a faire », trace',
    case when exists (select 1 from public.repair_order_plan_operations where id = _op and status = 'a_faire' and done_by is null and time_entry_id is null)
          and exists (select 1 from public.events where entity_id = _or::text and action = 'repair_order_operation_reset')
    then 'ok' else 'FAIL' end);
  perform public.repair_order_operation_set(_op, 'fait');

  -- ------------------------------------------------------------ non faite
  select id into _op2 from public.repair_order_plan_operations where or_id = _or and op_key = 'op2';
  begin
    perform public.repair_order_operation_set(_op2, 'non_fait');
    _err := 'aucune erreur';
  exception when others then _err := sqlerrm; end;
  insert into _t(check_name, result) values ('« non faite » sans motif refusee',
    case when _err like '%motif obligatoire%' then 'ok' else 'FAIL ' || _err end);
  begin
    perform public.repair_order_operation_set(_op2, 'non_fait', 'flemme');
    _err := 'aucune erreur';
  exception when others then _err := sqlerrm; end;
  insert into _t(check_name, result) values ('« non faite » avec un motif inconnu refusee',
    case when _err like '%Motif inconnu%' then 'ok' else 'FAIL ' || _err end);
  _res := public.repair_order_operation_set(_op2, 'non_fait', 'refus_client', 'Le client repasse le mois prochain');
  _def := (_res->>'deferred_intervention_id')::uuid;
  insert into _t(check_name, result) values ('« non faite » refus du client : motif, note, intervention reportee creee',
    case when exists (select 1 from public.repair_order_plan_operations where id = _op2 and status = 'non_fait' and not_done_reason = 'refus_client'
                       and not_done_note = 'Le client repasse le mois prochain' and done_by = _me)
          and exists (select 1 from public.deferred_interventions d join public.repair_order_plan_operations o on o.id = _op2
                       where d.id = _def and d.repair_order_id = _or and d.label = o.label and d.status = 'a_planifier')
    then 'ok' else 'FAIL ' || _res::text end);
  _txt := public.repair_order_operations_not_done_text(_or);
  insert into _t(check_name, result) values ('texte « operations non realisees » (notes de la facture, impression)',
    case when _txt like 'Opérations non réalisées : %Refus du client : Le client repasse le mois prochain%' then 'ok' else 'FAIL ' || coalesce(_txt, 'NULL') end);
  perform public.repair_order_operation_set(_op2, 'a_faire');
  insert into _t(check_name, result) values ('« non faite » annulee : intervention reportee abandonnee',
    case when (select status from public.deferred_interventions where id = _def) = 'abandonne'
          and (select deferred_intervention_id from public.repair_order_plan_operations where id = _op2) is null
    then 'ok' else 'FAIL' end);
  perform public.repair_order_operation_set(_op2, 'non_fait', 'pas_necessaire');
  insert into _t(check_name, result) values ('« non faite » pas necessaire : sans intervention reportee',
    case when (select deferred_intervention_id from public.repair_order_plan_operations where id = _op2) is null
          and (select status from public.repair_order_plan_operations where id = _op2) = 'non_fait'
    then 'ok' else 'FAIL' end);

  -- ------------------------------------------------------------ liste figee
  begin
    perform public.repair_order_operations_init(_or, true);
    _err := 'aucune erreur';
  exception when others then _err := sqlerrm; end;
  insert into _t(check_name, result) values ('liste deja cochee : ne se reconstruit plus',
    case when _err like '%deja cochees%' then 'ok' else 'FAIL ' || _err end);

  -- ------------------------------------------------------------ Terminer
  begin
    perform public.repair_order_operations_finish(_or);
    _err := 'aucune erreur';
  exception when others then _err := sqlerrm; end;
  insert into _t(check_name, result) values ('« Terminer » refuse tant qu''une obligatoire reste a faire',
    case when _err like '%obligatoire%' and (select status from public.repair_orders where id = _or) = 'en_cours' then 'ok' else 'FAIL ' || _err end);

  for x in select id from public.repair_order_plan_operations where or_id = _or and mandatory and status = 'a_faire' loop
    perform public.repair_order_operation_set(x.id, 'fait');
  end loop;
  _res := public.repair_order_operations_finish(_or);
  insert into _t(check_name, result) values ('« Terminer » : OR « Pret »',
    case when _res->>'status' = 'pret' and (select status from public.repair_orders where id = _or) = 'pret' then 'ok' else 'FAIL ' || _res::text end);
  insert into _t(check_name, result) values ('« Terminer » : pointage arrete (fin « Terminer »)',
    case when (_res->>'time_entries_stopped')::int = 1
          and exists (select 1 from public.workshop_time_entries where id = _e and ended_at is not null and stop_kind = 'stop')
          and not exists (select 1 from public.workshop_time_entries where or_id = _or and kind = 'travail' and ended_at is null)
    then 'ok' else 'FAIL ' || _res::text end);
  insert into _t(check_name, result) values ('« Terminer » : SMS de fin de travaux traite par le mecanisme existant, trace',
    case when (exists (select 1 from public.notifications where template = 'workshop_ready' and entity_id = _or::text)
               or exists (select 1 from public.events where entity_id = _or::text and action in ('sms_ready_not_queued', 'sms_ready_error')))
          and exists (select 1 from public.events where entity_id = _or::text and action = 'repair_order_operations_finished')
    then 'ok' else 'FAIL ' || _res::text end);
  begin
    perform public.repair_order_operations_finish(_or);
    _err := 'aucune erreur';
  exception when others then _err := sqlerrm; end;
  insert into _t(check_name, result) values ('« Terminer » une 2e fois refuse (deja pret)',
    case when _err like '%Pret%' then 'ok' else 'FAIL ' || _err end);

  -- ------------------------------------------------------------ ecriture directe interdite
  begin
    update public.repair_order_plan_operations set status = 'fait' where or_id = _or2;
    get diagnostics _n = row_count;
    _err := 'lignes ' || _n;
  exception when others then _err := 'refus'; end;
  insert into _t(check_name, result) values ('mise a jour directe des operations refusee (fonctions seulement)',
    case when _err in ('refus', 'lignes 0') then 'ok' else 'FAIL ' || _err end);
end $s$;

reset role;
select * from _t order by n;
