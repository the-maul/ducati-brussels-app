-- =====================================================================
-- Parcours G8 n° 18 (docs/g8-inventaire/parcours.md) : OR garantie, joue dans ItalTest.
-- G8 : Creation d'un O.R. > client > moto > km > onglet Garantie : cession 05 « Garantie fournisseur »,
--      avancement « Demande de prise en charge en attente » > ligne « Garantie/Cession article » : la
--      ligne passe a 0 € avec un « G » > Valider -> OR 5000015 dans la vue « O.R. garantie » (en attente).
--      Puis (suite B10) : prise en charge acceptee -> facturation, cout de la garantie suivi.
-- Decisions : Q33 (la piece sous garantie sort par la facture client a 0 € + cout fige, pas par une
-- cession), T2 (cession 05 non comptabilisee), T3 (taux MO garantie 83,00 HT).
-- DMS (src/modules/workshop/write-api.ts, warranty/rules.ts et warranty/api.ts) :
--   createRepairOrder (type de reparation « garantie_ducati » -> cession 05 proposee ; choisir la cession
--     sur un OR sans prise en charge le passe « en_attente » + commentaire « Demande de garantie pour le
--     chassis … immat. … ») ; lignes cochees garantie a 0 € (lineCoveredByWarranty) par
--     repair_order_write_lines ; vue « O.R. garantie » = listWarrantyOrs ; setWarrantyStatus('accepte') ;
--   « Transformer en facture » (refuse par l'ecran tant que « en_attente ») : repair_order_time_control
--     (MO couverte : quantite = heures garanties) puis transformToInvoice (lignes couvertes a 0 €) ;
--     au passage « facture », la base fige le cout (trg_ro_impute_warranty) et ouvre le suivi fournisseur.
-- Donnees d'essai : client, moto, piece recue 2 x 12,00 (PAMP 12, PV 30 HT), fournisseur principal.
-- Controles : T2 / T3 ; OR (numero suivant, cession 05, en attente, commentaire) ; lignes « G » a 0 € ;
-- vue O.R. garantie ; acceptation tracee ; controle du temps garanti ; facture a 0 € (numero suivant,
-- lignes a 0) et OR facture ; B7 stock -1 par la facture ; Q33 cout fige (piece au PAMP, MO 1 h x 83) ;
-- suivi « attente remboursement » (05) ; vue Garanties ; productivite : 1 h en heures garanties.
-- Lancement : TESTS_DIR=... python rt.py parcours_g8_18_or_garantie.sql (transaction annulee).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. donnees d'essai (proprietaire)
do $s$
declare _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08'; _c uuid; _v uuid; _a uuid; _sup uuid;
begin
  select id into _sup from public.contacts where company_id = _co and type = 'fournisseur' order by created_at limit 1;
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values (_co, 'particulier', 'TEST', 'PARCOURS 18 GARANTIE', 'BE') returning id into _c;
  insert into public.vehicles (company_id, vin, plate, brand, model, status, holder_contact_id, notes)
  values (_co, 'ZDMESSAIP18' || to_char(clock_timestamp(), 'HH24MISS'), '1-ESS-018', 'DUCATI', 'ESSAI P18 PANIGALE', 'vendu', _c, 'ESSAI A BLANC')
  returning id into _v;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, sale_price_ht, sale_price_ttc, vat_rate, main_supplier_id)
  values (_co, 'ESSAI-P18-POMPE', 'Pompe a eau essai P18', 'A', 12, 0, 30, 36.30, 21, _sup) returning id into _a;
  perform set_config('test.c', _c::text, true);
  perform set_config('test.v', _v::text, true);
  perform set_config('test.a', _a::text, true);
  perform set_config('test.sup', coalesce(_sup::text, ''), true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _c uuid := current_setting('test.c')::uuid;
  _v uuid := current_setting('test.v')::uuid;
  _a uuid := current_setting('test.a')::uuid;
  _sup text := current_setting('test.sup');
  _mo_art uuid; _rate numeric; _seq record; _exp bigint; _num text; _or uuid; _note text; _r record;
  _mo_line uuid; _fac uuid; _facnum text; _seqf record; _expf bigint; _before numeric; _after numeric;
begin
  select id into _mo_art from public.articles where company_id = _co and reference = 'MO' and mgmt_type = 'T' limit 1;
  _rate := public.maintenance_hourly_rate_ht(_co);
  insert into _t(check_name, result) values ('T3 taux MO garantie 83,00 HT ; T2 cession 05 « garantie fournisseur » non comptabilisee ; 05/06/07 presents',
    case when (select (extra ->> 'hourly_rate_ht')::numeric from public.reference_values where company_id = _co and table_key = 'workshop_warranty' and code = 'mo') = 83
          and (select (extra ->> 'accounted')::boolean from public.reference_values where company_id = _co and table_key = 'cession_type' and code = '05') = false
          and (select count(*) from public.reference_values where company_id = _co and table_key = 'cession_type' and code in ('05', '06', '07') and is_active) = 3
         then 'ok' else 'KO' end);
  perform public.record_stock_move(_a, 'entree', 2, 12, false, null, 'reception', 'ESSAI-P18-REC', null);

  -- ------------------------------------------------------------ 1. OR garantie (cession 05, en attente)
  select * into _seq from public.document_sequences where company_id = _co and doc_type = 'OR';
  _exp := case when _seq.reset_yearly and _seq.current_year is distinct from public._numbering_year() then 1 else _seq.next_value end;
  _num := public.next_document_number(_co, 'OR');
  select 'Demande de garantie pour le châssis ' || vin || ' immat. ' || plate into _note from public.vehicles where id = _v;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, operator, repair_type, work_description,
                                    status, warranty_status, warranty_cession_code, warranty_note, total_ht, total_vat, total_ttc)
  values (_co, _num, _c, _v, 18000, 'Chef atelier', 'garantie_ducati', 'Fuite pompe a eau', 'a_faire', 'en_attente', '05', _note, 0, 0, 0)
  returning id into _or;
  perform public.repair_order_write_lines(_or, jsonb_build_array(
    jsonb_build_object('kind', 'piece', 'article_id', _a, 'designation', 'Pompe a eau essai P18', 'quantity', 1, 'unit_price_ht', 30,
                       'vat_rate', 21, 'discount_pct', 0, 'is_warranty', true, 'line_ht', 0, 'line_ttc', 0),
    jsonb_build_object('kind', 'mo', 'article_id', _mo_art, 'designation', 'Main d''oeuvre garantie', 'quantity', 1, 'unit_price_ht', _rate,
                       'vat_rate', 21, 'discount_pct', 0, 'is_warranty', true, 'line_ht', 0, 'line_ttc', 0)));
  select * into _r from public.repair_orders where id = _or;
  insert into _t(check_name, result) values ('OR garantie : n° suivant de la serie OR, cession 05, « en attente », commentaire de demande',
    case when right(_num, _seq.padding) = lpad(_exp::text, _seq.padding, '0') and _r.warranty_cession_code = '05'
          and _r.warranty_status = 'en_attente' and _r.warranty_note like 'Demande de garantie pour le châssis ZDMESSAIP18%' then 'ok' else 'KO ' || row_to_json(_r)::text end);
  insert into _t(check_name, result) values ('lignes « G » : piece et MO cochees garantie, a 0 € pour le client (OR 0 €)',
    case when (select count(*) from public.repair_order_lines where or_id = _or and is_warranty and line_ht = 0) = 2 and _r.total_ttc = 0 then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('vue « O.R. garantie » (listWarrantyOrs) : l''OR y figure, en attente, type 05',
    case when exists (select 1 from public.repair_orders where company_id = _co and (warranty_status <> 'aucune' or warranty_cession_code is not null)
                       and status not in ('facture', 'annule') and id = _or and warranty_status = 'en_attente') then 'ok' else 'KO' end);

  -- ------------------------------------------------------------ 2. prise en charge acceptee, temps, facture
  update public.repair_orders set warranty_status = 'accepte' where id = _or;
  insert into _t(check_name, result) values ('prise en charge acceptee : trace events (ancien / nouveau statut)',
    case when exists (select 1 from public.events where entity_id = _or::text and old_data ->> 'warranty_status' = 'en_attente'
                       and new_data ->> 'warranty_status' = 'accepte') then 'ok' else 'KO' end);
  select id into _mo_line from public.repair_order_lines where or_id = _or and kind = 'mo';
  perform public.repair_order_time_control(_or, jsonb_build_array(jsonb_build_object('id', _mo_line, 'mechanic_code', 'ESSAI18',
    'mechanic_name', 'Livio', 'work_date', current_date, 'billed_hours', 0, 'worked_hours', 1, 'internal_hours', 0, 'warranty_hours', 1)));
  select * into _r from public.repair_order_lines where id = _mo_line;
  insert into _t(check_name, result) values ('controle du temps : MO couverte = 1 h garantie, 0 h facturee, 0 €',
    case when _r.quantity = 1 and _r.warranty_hours = 1 and coalesce(_r.billed_hours, 0) = 0 and _r.line_ht = 0 then 'ok' else 'KO ' || row_to_json(_r)::text end);

  -- transformToInvoice : ligne couverte -> prix client 0 (clientUnitPrice), quantite de l'OR (garantie).
  select * into _seqf from public.document_sequences where company_id = _co and doc_type = 'FAC';
  _expf := case when _seqf.reset_yearly and _seqf.current_year is distinct from public._numbering_year() then 1 else _seqf.next_value end;
  select real_qty into _before from public.article_stock(_a);
  insert into public.documents (company_id, number, status, source_document_id, doc_type, contact_id, vehicle_id, issue_date, due_date, notes,
                                total_ht, total_vat, total_ttc, price_mode, tax_exempt, global_discount_pct, global_discount_amount,
                                shipping_ht, shipping_taxed, shipping_vat_rate, forced_ttc, repair_order_id)
  values (_co, null, 'brouillon', null, 'FAC', _c, _v, current_date, null, 'OR ' || _num, 0, 0, 0, 'ttc', false, 0, 0, 0, true, 21, null, _or)
  returning id into _fac;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate,
                                     discount_pct, line_ht, line_ttc, sort_order)
  select _fac, l.article_id, l.designation, null, case when l.kind = 'mo' then 'main_oeuvre' else 'article' end, l.quantity, 0, l.vat_rate, 0, 0, 0,
         row_number() over (order by l.sort_order) - 1
    from public.repair_order_lines l where l.or_id = _or;
  _facnum := public.document_assign_number(_fac);
  perform public.record_stock_move(_a, 'sortie', -1, null, false, null, 'sale', _facnum, null);
  update public.repair_orders set status = 'facture', invoice_document_id = _fac where id = _or;
  select real_qty into _after from public.article_stock(_a);

  insert into _t(check_name, result) values ('Q33 facture client a 0 € (n° suivant FAC), lignes garanties a 0, OR « facture »',
    case when right(_facnum, _seqf.padding) = lpad(_expf::text, _seqf.padding, '0')
          and (select total_ttc = 0 and status = 'validee' from public.documents where id = _fac)
          and (select count(*) from public.document_lines where document_id = _fac and unit_price_ht = 0) = 2
          and (select status from public.repair_orders where id = _or) = 'facture' then 'ok' else 'KO ' || coalesce(_facnum, 'null') end);
  insert into _t(check_name, result) values ('B7 la piece garantie sort du stock par la facture a 0 € (2 -> 1, sortie, origine vente)',
    case when _before = 2 and _after = 1 and exists (select 1 from public.stock_moves where article_id = _a and move_type = 'sortie'
                                                     and qty_delta = -1 and origin = 'sale' and ref = _facnum) then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('Q33 cout fige a la facturation : piece au PAMP 12, PA 12, PV 30 ; MO 1 h x 83,00',
    case when (select row(warranty_cost_ht, warranty_pa_ht, warranty_sale_ht)::text from public.repair_order_lines where or_id = _or and kind = 'piece') = '(12.00,12.00,30.00)'
          and (select warranty_cost_ht from public.repair_order_lines where id = _mo_line) = 83
          and (select warranty_imputed_at from public.repair_orders where id = _or) is not null then 'ok'
         else 'KO ' || coalesce((select string_agg(row(kind, warranty_cost_ht, warranty_pa_ht, warranty_sale_ht)::text, ' ') from public.repair_order_lines where or_id = _or), '') end);
  insert into _t(check_name, result) values ('garantie fournisseur 05 : suivi « attente remboursement » de la piece (12,00, fournisseur de l''article)',
    case when (select count(*) from public.warranty_returns where repair_order_id = _or) = 1
          and exists (select 1 from public.warranty_returns where repair_order_id = _or and status = 'attente_remboursement' and amount_ht = 12
                       and (_sup = '' or supplier_id::text = _sup) and ticket_number = _num) then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('vue Garanties : 2 lignes, 1 h de MO, pieces 12,00, MO 83,00',
    case when (select row(count(*), sum(labour_hours), sum(parts_cost_ht), sum(labour_cost_ht))::text from public.warranty_lines_v where repair_order_id = _or)
              = '(2,1.000,12.00,83.00)' then 'ok'
         else 'KO ' || (select row(count(*), sum(labour_hours), sum(parts_cost_ht), sum(labour_cost_ht))::text from public.warranty_lines_v where repair_order_id = _or) end);
  select * into _r from public.workshop_productivity_detail(_co, current_date, current_date) where mechanic_key = 'ESSAI18';
  insert into _t(check_name, result) values ('B11 productivite : 1 h en heures garanties, 0 h facturee',
    case when _r.warranty_h = 1 and coalesce(_r.billed_h, 0) = 0 then 'ok' else 'KO ' || coalesce(row_to_json(_r)::text, 'aucune ligne') end);
end $s$;

reset role;
select n, check_name, result from _t order by n;
