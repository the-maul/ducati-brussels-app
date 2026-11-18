-- =====================================================================
-- Rattrapage G8 (18/11/2026), lot « temps MO » -- essai a blanc de la migration
-- 20261118110000_m8_temps_main_oeuvre.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118110000_m8_temps_main_oeuvre.sql \
--      supabase/tests/m8_temps_mo.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Avant la migration : verifier qu'aucune facture d'OR n'existe en double (sinon l'index unique
-- n'est pas pose, la garde par verrou reste active) :
--   select o.number, count(*) from documents d join repair_orders o on o.invoice_document_id = d.id
--    where d.doc_type = 'FAC' and d.status <> 'annulee' group by 1 having count(*) > 1;
-- Scenario, administrateur simule d'ITALBIKE STORE :
--   OR avec une ligne MO classique (temps saisi), une carte du check-up et une piece ;
--   controle du temps (quantite MO = heures facturees, montants et totaux recalcules) ;
--   reecriture des lignes : le temps de la carte est garde, les heures facturees suivent la
--   quantite ; regle G8 heures internes -> facturees a zero ; pointages (presence, travail,
--   improductif) -> temps pointe de l'OR et productivite (a facturer puis facture) ;
--   facture : une 2e facture du meme OR est refusee, la validation passe l'OR « facture »
--   dans la meme transaction, OR facture fige.
-- Le meme scenario tourne en local sur PGlite (tables simplifiees, + garantie couverte / refus total et
-- la fonction repair_order_write_lines du lot garantie 20261118130000) : 33 / 33 ok le 18/11/2026.
-- Ordre d application : 20261118110000 puis 20261118130000 (qui reprend aussi le temps MO).
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _contact uuid; _or uuid; _card uuid; _mo uuid; _doc uuid; _err text; _r record; _n int;
begin
  select id into _contact from public.contacts
   where company_id = _co and type <> 'fournisseur' and is_active order by created_at limit 1;
  insert into public.repair_orders (company_id, number, contact_id, status)
  values (_co, 'OR-ESSAI-TEMPS-MO', _contact, 'en_cours') returning id into _or;

  -- 1. lignes : MO classique avec temps, carte check-up sans temps, piece
  perform public.repair_order_write_lines(_or, jsonb_build_array(
    jsonb_build_object('kind', 'mo', 'designation', 'MO_ATELIER', 'quantity', 1.5, 'unit_price_ht', 63.47, 'line_ht', 95.21, 'line_ttc', 115.2,
                       'mechanic_code', 'ESSAI13', 'mechanic_name', 'Jeremy', 'billed_hours', 1.5, 'worked_hours', 2, 'work_date', '2026-11-18'),
    jsonb_build_object('kind', 'mo', 'designation', 'Entretien', 'quantity', 1, 'unit_price_ht', 63.47, 'checkup_key', 'essai-k1', 'checkup_state', 'a_faire'),
    -- montants envoyes par l ecran (write-api.ts calcule line_ht / line_ttc), la fonction ne les recalcule pas
    jsonb_build_object('kind', 'piece', 'designation', 'Filtre', 'quantity', 1, 'unit_price_ht', 10, 'line_ht', 10, 'line_ttc', 12.1, 'mechanic_code', 'X')));
  select * into _r from public.repair_order_lines where or_id = _or and designation = 'MO_ATELIER';
  _mo := _r.id;
  insert into _t(check_name, result) values
    ('ligne MO : temps enregistre', case when _r.billed_hours = 1.5 and _r.worked_hours = 2 and _r.mechanic_code = 'ESSAI13' then 'ok' else 'FAIL ' || row_to_json(_r)::text end);
  select * into _r from public.repair_order_lines where or_id = _or and kind = 'piece';
  insert into _t(check_name, result) values
    ('piece : jamais de temps MO', case when _r.mechanic_code is null and _r.billed_hours is null then 'ok' else 'FAIL ' || row_to_json(_r)::text end);

  -- 2. controle du temps (carte : 1,25 h facturee, 1,5 h passee)
  select id into _card from public.repair_order_lines where or_id = _or and checkup_key = 'essai-k1';
  perform public.repair_order_time_control(_or, jsonb_build_array(
    jsonb_build_object('id', _card, 'mechanic_code', 'ESSAI3', 'mechanic_name', 'John', 'work_date', '2026-11-18', 'billed_hours', 1.25, 'worked_hours', 1.5),
    jsonb_build_object('id', _mo, 'mechanic_code', 'ESSAI13', 'mechanic_name', 'Jeremy', 'work_date', '2026-11-18', 'billed_hours', 1.5, 'worked_hours', 2)));
  select * into _r from public.repair_order_lines where id = _card;
  insert into _t(check_name, result) values
    ('controle : quantite MO = heures facturees', case when _r.quantity = 1.25 and _r.billed_hours = 1.25 then 'ok' else 'FAIL ' || row_to_json(_r)::text end),
    ('controle : montant 1,25 x 63,47 = 79,34', case when _r.line_ht = 79.34 then 'ok' else 'FAIL ' || _r.line_ht end);
  insert into _t(check_name, result)
  select 'controle : totaux de l OR recalcules', case when total_ht = 95.21 + 79.34 + 10 then 'ok' else 'FAIL ' || total_ht end
    from public.repair_orders where id = _or;

  -- 3. reecriture : la carte ne renvoie pas son temps ; nouvelle quantite 2 h
  perform public.repair_order_write_lines(_or, jsonb_build_array(
    jsonb_build_object('kind', 'mo', 'designation', 'MO_ATELIER', 'quantity', 1.5, 'unit_price_ht', 63.47,
                       'mechanic_code', 'ESSAI13', 'mechanic_name', 'Jeremy', 'billed_hours', 1.5, 'worked_hours', 2, 'work_date', '2026-11-18'),
    jsonb_build_object('kind', 'mo', 'designation', 'Entretien', 'quantity', 2, 'unit_price_ht', 63.47, 'checkup_key', 'essai-k1', 'checkup_state', 'a_faire')));
  select * into _r from public.repair_order_lines where or_id = _or and checkup_key = 'essai-k1';
  insert into _t(check_name, result) values
    ('reecriture : temps de la carte garde', case when _r.mechanic_code = 'ESSAI3' and _r.worked_hours = 1.5 then 'ok' else 'FAIL ' || row_to_json(_r)::text end),
    ('reecriture : heures facturees = quantite', case when _r.billed_hours = 2 then 'ok' else 'FAIL ' || coalesce(_r.billed_hours::text, 'null') end);

  -- 4. regle G8 : heures internes -> facturees remises a zero
  _card := _r.id;
  perform public.repair_order_time_control(_or, jsonb_build_array(
    jsonb_build_object('id', _card, 'mechanic_code', 'ESSAI3', 'billed_hours', 2, 'worked_hours', 2, 'internal_hours', 1)));
  select * into _r from public.repair_order_lines where id = _card;
  insert into _t(check_name, result) values
    ('heures internes -> facturees a zero', case when _r.billed_hours = 0 and _r.quantity = 0 and _r.internal_hours = 1 and _r.line_ht = 0 then 'ok' else 'FAIL ' || row_to_json(_r)::text end);

  -- 5. pointages + temps pointe de l'OR
  insert into public.workshop_time_entries (company_id, mechanic_code, mechanic_name, or_id, kind, started_at, ended_at, minutes) values
    (_co, 'ESSAI13', 'Jeremy', _or, 'travail', '2026-11-18 08:00+01', '2026-11-18 10:00+01', 120),
    (_co, 'ESSAI13', 'Jeremy', null, 'presence', '2026-11-18 07:30+01', '2026-11-18 16:30+01', 540),
    (_co, 'ESSAI13', 'Jeremy', null, 'improductif', '2026-11-18 10:00+01', '2026-11-18 10:30+01', 30);
  insert into _t(check_name, result)
  select 'temps pointe de l OR (2 h)', case when pointed_h = 2 then 'ok' else 'FAIL ' || pointed_h end
    from public.repair_order_time_summary(_or) where mechanic_key = 'ESSAI13';
  select * into _r from public.workshop_productivity_detail(_co, '2026-11-18', '2026-11-18') where mechanic_key = 'ESSAI13';
  insert into _t(check_name, result) values
    ('productivite : presence 9 / pointe 2 / improductif 0,5', case when _r.presence_h = 9 and _r.pointed_h = 2 and _r.improductive_h = 0.5 then 'ok' else 'FAIL ' || row_to_json(_r)::text end),
    ('productivite : OR ouvert = 1,5 h a facturer', case when _r.to_bill_h = 1.5 and _r.billed_h = 0 then 'ok' else 'FAIL ' || row_to_json(_r)::text end);

  -- 6. facture unique et atomique
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, repair_order_id)
  values (_co, 'FAC', 'brouillon', _contact, '2026-11-18', _or) returning id into _doc;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, line_ht, line_ttc)
  values (_doc, 'MO_ATELIER', 1.5, 63.47, 95.21, 115.2);
  begin
    insert into public.documents (company_id, doc_type, status, contact_id, issue_date, repair_order_id)
    values (_co, 'FAC', 'brouillon', _contact, '2026-11-18', _or);
    _err := null;
  exception when others then _err := sqlerrm;
  end;
  insert into _t(check_name, result) values
    ('2e facture du meme OR refusee', case when _err is not null then 'ok' else 'FAIL acceptee' end);
  update public.documents set status = 'validee', number = 'FAC-ESSAI-TEMPS-MO' where id = _doc;
  insert into _t(check_name, result)
  select 'validation -> OR facture (meme transaction)', case when status = 'facture' and invoice_document_id = _doc then 'ok' else 'FAIL ' || status end
    from public.repair_orders where id = _or;
  begin
    perform public.repair_order_write_lines(_or, '[]'::jsonb);
    _err := null;
  exception when others then _err := sqlerrm;
  end;
  insert into _t(check_name, result) values ('OR facture : lignes figees', case when _err is not null then 'ok' else 'FAIL modifiees' end);
  begin
    perform public.repair_order_time_control(_or, '[]'::jsonb);
    _err := null;
  exception when others then _err := sqlerrm;
  end;
  insert into _t(check_name, result) values ('OR facture : controle du temps refuse', case when _err is not null then 'ok' else 'FAIL accepte' end);
  select * into _r from public.workshop_productivity_detail(_co, '2026-11-18', '2026-11-18') where mechanic_key = 'ESSAI13';
  insert into _t(check_name, result) values
    ('productivite : OR facture = 1,5 h facturee', case when _r.billed_h = 1.5 and _r.to_bill_h = 0 then 'ok' else 'FAIL ' || row_to_json(_r)::text end);
  select count(*) into _n from pg_indexes where indexname = 'uq_documents_invoice_per_repair_order';
  insert into _t(check_name, result) values ('index unique pose', case when _n = 1 then 'ok' else 'FAIL (doublons existants ?)' end);
end $s$;

select n, check_name, result from _t order by n;
