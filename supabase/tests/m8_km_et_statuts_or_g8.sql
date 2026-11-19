-- =====================================================================
-- Decisions atelier du 18/11/2026 (Q42 km, Q43 statuts) — essai a blanc de
-- 20261119190000_m8_km_et_statuts_or_g8.sql. A executer DANS UNE TRANSACTION ANNULEE, migration
-- comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119190000_m8_km_et_statuts_or_g8.sql \
--      supabase/tests/m8_km_et_statuts_or_g8.sql; echo "rollback;") > t.sql
-- Joue un administrateur d'ITALBIKE STORE (claims JWT simulees). Scenario :
--   Q42 : OR avec moto sans km refuse ; avec km accepte ; modification de l'OR sans toucher a la
--         moto (km vide garde) acceptee ; moto rattachee a un OR sans moto sans km refusee ; RDV avec
--         moto sans km refuse, RDV sans moto accepte, demande de l'espace client acceptee.
--   Q43 : OR cree « a faire » depuis le RDV → le RDV passe « receptionne » (arrive) ; premier
--         pointage de travail → OR « en cours » + RDV « travaux commences » + trace events ;
--         « Demarrer » sur un autre OR → en cours ; Demarrer refuse si accord client en attente.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare _c uuid; _v uuid; _v2 uuid;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'particulier', 'TEST', 'KM STATUTS OR', 'BE') returning id into _c;
  insert into public.vehicles (company_id, brand, model, status, notes)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'DUCATI', 'ESSAI KM 1', 'vendu', 'ESSAI A BLANC') returning id into _v;
  insert into public.vehicles (company_id, brand, model, status, notes)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'DUCATI', 'ESSAI KM 2', 'vendu', 'ESSAI A BLANC') returning id into _v2;
  perform set_config('test.c', _c::text, true);
  perform set_config('test.v', _v::text, true);
  perform set_config('test.v2', _v2::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _c uuid := current_setting('test.c')::uuid;
  _v uuid := current_setting('test.v')::uuid;
  _v2 uuid := current_setting('test.v2')::uuid;
  _or uuid; _or2 uuid; _or3 uuid; _rdv uuid; _err text; _st text;
begin
  -- ------------------------------------------------------------ Q42 km a la creation de l'OR
  begin
    insert into public.repair_orders (company_id, number, contact_id, vehicle_id, status)
    values (_co, 'ESSAI-KM-0', _c, _v, 'a_faire');
    insert into _t(check_name, result) values ('Q42 OR avec moto sans km : refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('Q42 OR avec moto sans km : refuse', case when _err like 'Kilometrage obligatoire%' then 'ok' else 'FAIL ' || _err end);
  end;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values (_co, 'ESSAI-KM-1', _c, _v, 12000, 'a_faire') returning id into _or;
  insert into _t(check_name, result) values ('Q42 OR avec moto et km : accepte', case when _or is not null then 'ok' else 'FAIL' end);

  -- Modifier l'OR ensuite : le km n'est plus redemande (meme vide), il reste modifiable.
  begin
    update public.repair_orders set mileage = null, work_description = 'TEST modif' where id = _or;
    update public.repair_orders set mileage = 12500 where id = _or;
    insert into _t(check_name, result) values ('Q42 modification de l''OR sans toucher a la moto : km non redemande',
      case when (select mileage from public.repair_orders where id = _or) = 12500 then 'ok' else 'FAIL' end);
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('Q42 modification de l''OR sans toucher a la moto : km non redemande', 'FAIL ' || _err);
  end;

  -- OR sans moto (moto a creer) puis moto rattachee : km exige a ce moment-la.
  insert into public.repair_orders (company_id, number, contact_id, status) values (_co, 'ESSAI-KM-2', _c, 'a_faire') returning id into _or2;
  begin
    update public.repair_orders set vehicle_id = _v2 where id = _or2;
    insert into _t(check_name, result) values ('Q42 moto rattachee sans km : refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('Q42 moto rattachee sans km : refuse', case when _err like 'Kilometrage obligatoire%' then 'ok' else 'FAIL ' || _err end);
  end;
  update public.repair_orders set vehicle_id = _v2, mileage = 800 where id = _or2;
  insert into _t(check_name, result) values ('Q42 moto rattachee avec km : accepte',
    case when (select vehicle_id from public.repair_orders where id = _or2) = _v2 then 'ok' else 'FAIL' end);

  -- RDV : moto choisie = km obligatoire ; sans moto = possible ; demande de l'espace client = possible.
  begin
    insert into public.workshop_appointments (company_id, contact_id, vehicle_id, starts_at, planned_minutes, status)
    values (_co, _c, _v, now() + interval '3 days', 60, 'prevu');
    insert into _t(check_name, result) values ('Q42 RDV avec moto sans km : refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('Q42 RDV avec moto sans km : refuse', case when _err like 'Kilometrage obligatoire%' then 'ok' else 'FAIL ' || _err end);
  end;
  begin
    insert into public.workshop_appointments (company_id, contact_id, starts_at, planned_minutes, status)
    values (_co, _c, now() + interval '3 days', 60, 'prevu');
    insert into public.workshop_appointments (company_id, contact_id, vehicle_id, starts_at, planned_minutes, status, source)
    values (_co, _c, _v, now() + interval '4 days', 60, 'demande', 'portail');
    insert into _t(check_name, result) values ('Q42 RDV sans moto et demande client sans km : acceptes', 'ok');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('Q42 RDV sans moto et demande client sans km : acceptes', 'FAIL ' || _err);
  end;

  -- ------------------------------------------------------------ Q43 statuts
  insert into public.workshop_appointments (company_id, contact_id, vehicle_id, mileage, starts_at, planned_minutes, status)
  values (_co, _c, _v, 12000, now() + interval '1 hour', 60, 'prevu') returning id into _rdv;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values (_co, 'ESSAI-ST-1', _c, _v, 12000, 'a_faire') returning id into _or3;
  -- Meme si l'ecran envoyait encore l'ancien statut « en cours », le RDV s'aligne sur l'OR.
  update public.workshop_appointments set or_id = _or3, status = 'en_cours' where id = _rdv;
  insert into _t(check_name, result) values ('Q43 OR cree depuis le RDV « a faire » → RDV « receptionne » (arrive)',
    case when (select status from public.workshop_appointments where id = _rdv) = 'arrive'
          and (select status from public.repair_orders where id = _or3) = 'a_faire' then 'ok' else 'FAIL' end);

  -- Premier pointage de travail : l'OR passe en cours, le RDV suit, trace explicite.
  insert into public.workshop_time_entries (company_id, mechanic_id, mechanic_name, kind, or_id)
  values (_co, auth.uid(), 'TEST MECANO', 'travail', _or3);
  insert into _t(check_name, result) values ('Q43 premier pointage → OR « en cours »',
    case when (select status from public.repair_orders where id = _or3) = 'en_cours' then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('Q43 premier pointage → RDV « travaux commences » (en_cours)',
    case when (select status from public.workshop_appointments where id = _rdv) = 'en_cours' then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('Q43 trace events repair_order_work_started (chrono)',
    case when exists (select 1 from public.events where entity_id = _or3::text and action = 'repair_order_work_started' and origin = 'chrono')
         then 'ok' else 'FAIL' end);
  -- Un second pointage ne touche plus a rien (OR deja en cours, pas de seconde trace). Il vient d'un
  -- autre mecanicien (code mecano) : un meme compte n'a qu'un pointage actif (lot A, 20261119241000).
  insert into public.workshop_time_entries (company_id, mechanic_code, mechanic_name, kind, or_id)
  values (_co, 'TEST-M2', 'TEST MECANO 2', 'travail', _or3);
  insert into _t(check_name, result) values ('Q43 second pointage : pas de seconde trace',
    case when (select count(*) from public.events where entity_id = _or3::text and action = 'repair_order_work_started') = 1 then 'ok' else 'FAIL' end);

  -- Action explicite « Demarrer ».
  _st := public.repair_order_start(_or);
  insert into _t(check_name, result) values ('Q43 Demarrer : OR « en cours » + trace ecran',
    case when _st = 'en_cours' and (select status from public.repair_orders where id = _or) = 'en_cours'
          and exists (select 1 from public.events where entity_id = _or::text and action = 'repair_order_work_started' and origin = 'screen')
         then 'ok' else 'FAIL' end);
  update public.repair_orders set customer_approval = 'en_attente' where id = _or2;
  begin
    perform public.repair_order_start(_or2);
    insert into _t(check_name, result) values ('Q43 Demarrer refuse si accord client en attente', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('Q43 Demarrer refuse si accord client en attente', case when _err like '%accord du client%' then 'ok' else 'FAIL ' || _err end);
  end;
end $s$;

reset role;
select n, check_name, result from _t order by n;
