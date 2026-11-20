-- =====================================================================
-- Parcours G8 n° 19 (docs/g8-inventaire/parcours.md) : OR accident, joue dans ItalTest.
-- G8 : Creation d'un O.R. > onglet Assurance > Nouveau cabinet (ASSURTEST, code tarif associe aux O.R.
--      assurance) > expert + date de passage > franchise a percevoir 250 € > « Accepter demarrage des
--      travaux » > Valider -> OR 5000016 dans la vue « O.R. accident » (cabinet, franchise, expert, passage).
-- Decisions : Q51 (expert / date de passage : une seule info, dossier accident = source, OR miroir),
-- T4 (tarif de l'assureur applique automatiquement aux lignes), Q54 / T4b (l'assureur l'emporte sur le
-- tarif propre du client).
-- DMS (routes/_app.workshop.new.tsx, accident/insurance-api.ts, insurance-panel.tsx) :
--   createRepairOrder (type « accident ») puis ensureAccidentFileForOr -> openAccidentFile (insert
--   accident_files lie a l'OR) ; « Cabinets et experts » : createInsuranceParty (cabinet avec tarif,
--   expert) ; volet Assurance : saveAccidentInsurance = update accident_files (cabinet, franchise,
--   valeurs, demarrage accepte qui / quand) + accident_file_set_expert(..., 'OR') ; tarif : l'editeur lit
--   repair_order_price_list(OR) et re-tarife les lignes (moteur TS), puis updateRepairOrder ecrit les
--   lignes + insurer_price_list_id ; vue « O.R. accident » = listAccidentOrs.
-- Donnees d'essai : client au tarif VIP (MO 90,00), moto, tarif assureur d'essai (remise 10 % tout).
-- Controles : OR accident (numero suivant, km) ; dossier accident unique lie a l'OR ; fiche cabinet
-- (compte comptable, tarif) ; franchise 250 € en montant, demarrage accepte (qui / quand) ; Q51 expert
-- et date recopies sur l'OR + trace accident_expert_change origine « OR » ; Q51 modification depuis le
-- dossier -> OR a jour ; Q54 tarif de l'OR = assureur (pas VIP) ; T4 lignes au tarif assureur ; vue
-- O.R. accident ; franchise > 100 % refusee.
-- Lancement : TESTS_DIR=... python rt.py parcours_g8_19_or_accident.sql (transaction annulee).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. donnees d'essai (proprietaire)
do $s$
declare _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08'; _c uuid; _v uuid; _a uuid;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country, price_list_id)
  values (_co, 'particulier', 'TEST', 'PARCOURS 19 ACCIDENT', 'BE', (select id from public.price_lists where company_id = _co and code = 'VIP'))
  returning id into _c;
  insert into public.vehicles (company_id, vin, plate, brand, model, status, holder_contact_id, notes)
  values (_co, 'ZDMESSAIP19' || to_char(clock_timestamp(), 'HH24MISS'), '1-ESS-019', 'DUCATI', 'ESSAI P19 MONSTER', 'vendu', _c, 'ESSAI A BLANC')
  returning id into _v;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'ESSAI-P19-LEVIER', 'Levier de frein essai P19', 'A', 40, 0, 100, 121, 21) returning id into _a;
  perform set_config('test.c', _c::text, true);
  perform set_config('test.v', _v::text, true);
  perform set_config('test.a', _a::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _c uuid := current_setting('test.c')::uuid;
  _v uuid := current_setting('test.v')::uuid;
  _a uuid := current_setting('test.a')::uuid;
  _mo_art uuid; _rate numeric; _seq record; _exp bigint; _num text; _or uuid; _file uuid; _list uuid; _ins uuid; _exp1 uuid; _exp2 uuid;
  _f record; _pl record; _err text;
begin
  select id into _mo_art from public.articles where company_id = _co and reference = 'MO' and mgmt_type = 'T' limit 1;
  _rate := public.maintenance_hourly_rate_ht(_co);

  -- Clients > Tarifs : tarif de l'assureur (meme moteur que REMISE 15 %).
  insert into public.price_lists (company_id, code, label) values (_co, 'ESSAI-ASSU19', 'Tarif assureur essai P19') returning id into _list;
  insert into public.price_list_rules (company_id, price_list_id, scope, kind, tiers) values (_co, _list, 'all', 'discount', '[{"min_qty":1,"value":10}]');

  -- ------------------------------------------------------------ 1. OR accident + dossier accident (meme enregistrement)
  select * into _seq from public.document_sequences where company_id = _co and doc_type = 'OR';
  _exp := case when _seq.reset_yearly and _seq.current_year is distinct from public._numbering_year() then 1 else _seq.next_value end;
  _num := public.next_document_number(_co, 'OR');
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, operator, repair_type, work_description, status, warranty_status,
                                    total_ht, total_vat, total_ttc)
  values (_co, _num, _c, _v, 9500, 'Chef atelier', 'accident', 'Chute : levier et main-d''oeuvre', 'a_faire', 'aucune', 0, 0, 0)
  returning id into _or;
  insert into public.accident_files (company_id, vehicle_id, contact_id, repair_order_id, quote_document_id, expert_name, created_by)
  values (_co, _v, _c, _or, null, null, auth.uid()) returning id into _file;
  insert into _t(check_name, result) values ('OR accident : n° suivant de la serie OR, km 9 500, dossier accident brouillon lie a l''OR',
    case when right(_num, _seq.padding) = lpad(_exp::text, _seq.padding, '0') and (select mileage from public.repair_orders where id = _or) = 9500
          and (select count(*) from public.accident_files where repair_order_id = _or and status = 'brouillon') = 1 then 'ok' else 'KO' end);

  -- ------------------------------------------------------------ 2. Nouveau cabinet + expert, volet Assurance
  insert into public.insurance_parties (company_id, kind, code, name, city, accounting_account, price_list_id, is_active)
  values (_co, 'cabinet', 'ATP19', 'ASSURTEST P19', 'Bruxelles', '440019', _list, true) returning id into _ins;
  insert into public.insurance_parties (company_id, kind, name, email, is_active) values (_co, 'expert', 'Expert P19 A', 'expert-a@example.invalid', true) returning id into _exp1;
  insert into public.insurance_parties (company_id, kind, name, email, is_active) values (_co, 'expert', 'Expert P19 B', 'expert-b@example.invalid', true) returning id into _exp2;
  insert into _t(check_name, result) values ('fiche cabinet : compte comptable et tarif associe (code du tarif recopie)',
    case when (select accounting_account = '440019' and price_list_id = _list from public.insurance_parties where id = _ins) then 'ok' else 'KO' end);

  update public.accident_files set insurer_id = _ins, deductible_kind = 'montant', deductible_value = 250, market_value = 8000, argus_value = null,
         work_start_accepted = true, work_start_accepted_at = now(), work_start_accepted_by = auth.uid(), insurer = 'ASSURTEST P19'
   where id = _file;
  perform public.accident_file_set_expert(_file, _exp1, current_date + 2, 'OR');
  select * into _f from public.accident_files where id = _file;
  insert into _t(check_name, result) values ('volet Assurance : cabinet, franchise 250 € en montant, demarrage accepte (qui / quand)',
    case when _f.insurer_id = _ins and _f.deductible_kind = 'montant' and _f.deductible_value = 250 and _f.work_start_accepted
          and _f.work_start_accepted_by = auth.uid() and _f.work_start_accepted_at is not null then 'ok' else 'KO ' || row_to_json(_f)::text end);
  insert into _t(check_name, result) values ('Q51 expert et date de passage : dossier source, recopies sur l''OR + trace origine « OR »',
    case when _f.expert_id = _exp1 and _f.expert_name = 'Expert P19 A' and _f.expert_visit_date = current_date + 2
          and (select expert_name = 'Expert P19 A' and expert_date = current_date + 2 from public.repair_orders where id = _or)
          and exists (select 1 from public.events where action = 'accident_expert_change' and entity_id = _file::text and origin = 'OR')
         then 'ok' else 'KO ' || row_to_json(_f)::text end);
  perform public.accident_file_set_expert(_file, _exp2, current_date + 3, 'dossier');
  insert into _t(check_name, result) values ('Q51 expert change depuis le dossier : OR a jour, trace origine « dossier »',
    case when (select expert_name = 'Expert P19 B' and expert_date = current_date + 3 from public.repair_orders where id = _or)
          and exists (select 1 from public.events where action = 'accident_expert_change' and entity_id = _file::text and origin = 'dossier')
         then 'ok' else 'KO' end);

  -- ------------------------------------------------------------ 3. tarif de l'assureur (T4, Q54)
  select * into _pl from public.repair_order_price_list(_or);
  insert into _t(check_name, result) values ('Q54 tarif de l''OR accident = celui de l''assureur, pas le tarif VIP du client',
    case when _pl.source = 'assureur' and _pl.price_list_id = _list and _pl.insurer_id = _ins then 'ok' else 'KO ' || coalesce(row_to_json(_pl)::text, 'aucun') end);
  -- L'editeur re-tarife (moteur TS) : piece 100 et MO 109,74 avec la remise de 10 % de l'assureur.
  perform public.repair_order_write_lines(_or, jsonb_build_array(
    jsonb_build_object('kind', 'piece', 'article_id', _a, 'designation', 'Levier de frein essai P19', 'quantity', 1, 'unit_price_ht', 100,
                       'vat_rate', 21, 'discount_pct', 10, 'is_warranty', false, 'line_ht', 90, 'line_ttc', 108.9),
    jsonb_build_object('kind', 'mo', 'article_id', _mo_art, 'designation', 'Main d''oeuvre', 'quantity', 2, 'unit_price_ht', _rate,
                       'vat_rate', 21, 'discount_pct', 10, 'is_warranty', false, 'line_ht', 197.53, 'line_ttc', 239.01)));
  update public.repair_orders set insurer_price_list_id = _list, total_ht = 287.53, total_vat = 60.38, total_ttc = 347.91 where id = _or;
  insert into _t(check_name, result) values ('T4 lignes au tarif de l''assureur (remise 10 %, MO 2 h x 109,74), tarif retenu sur l''OR',
    case when (select count(*) from public.repair_order_lines where or_id = _or and discount_pct = 10) = 2
          and (select sum(line_ht) from public.repair_order_lines where or_id = _or) = 287.53
          and (select insurer_price_list_id from public.repair_orders where id = _or) = _list then 'ok' else 'KO' end);

  -- ------------------------------------------------------------ 4. vue « O.R. accident » (listAccidentOrs)
  insert into _t(check_name, result) values ('vue O.R. accident : cabinet, franchise, expert, passage, accepte, OR ouvert',
    case when exists (select 1 from public.accident_files a join public.repair_orders o on o.id = a.repair_order_id
                       join public.insurance_parties i on i.id = a.insurer_id
                       where a.company_id = _co and a.repair_order_id is not null and o.status not in ('annule', 'facture')
                         and o.id = _or and i.name = 'ASSURTEST P19' and a.deductible_value = 250 and a.expert_name = 'Expert P19 B'
                         and a.expert_visit_date = current_date + 3 and a.work_start_accepted) then 'ok' else 'KO' end);
  begin
    update public.accident_files set deductible_kind = 'pourcentage', deductible_value = 150 where id = _file;
    insert into _t(check_name, result) values ('franchise en % au-dela de 100 refusee', 'KO acceptee');
  exception when check_violation then
    insert into _t(check_name, result) values ('franchise en % au-dela de 100 refusee', 'ok');
  end;
  insert into _t(check_name, result) values ('un seul dossier accident par OR (findAccidentFileFor)',
    case when (select count(*) from public.accident_files where repair_order_id = _or) = 1 then 'ok' else 'KO' end);
end $s$;

reset role;
select n, check_name, result from _t order by n;
