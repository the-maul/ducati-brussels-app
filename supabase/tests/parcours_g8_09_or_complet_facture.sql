-- =====================================================================
-- Parcours G8 n° 9 (docs/g8-inventaire/parcours.md) : OR complet -> facture, joue dans ItalTest.
-- G8 : Atelier > Creation d'un O.R. > client > historique moto > km (obligatoire) > travaux + 30 points
--      V/R > lignes MO > acompte > OR 5000012 ; Rappel O.R. > temps mecanicien (1,5 h facturee, 2 h
--      passee) > « Choisissez votre document » Facture > controle du temps > reglement carte 115,20 €.
-- DMS (meme ordre que l'ecran, src/modules/workshop/write-api.ts et sales/write-api.ts) :
--   /workshop/new : createRepairOrder = next_document_number('OR') + insert repair_orders (en-tete,
--     totaux calcules par l'ecran, 30 points, promis le) + repair_order_write_lines ;
--   fiche OR, panneau Acompte (Q45) : repair_order_deposit_document -> BC ; addPayments (carte MAE) +
--     recompute_document_paid ; FAA automatique (moto sur l'OR, trg_deposit_invoice_auto) ;
--   pointeuse : workshop_work_start / workshop_work_stop (code mecano) ;
--   « Transformer en facture » : repair_order_time_control (controle du temps) puis transformToInvoice :
--     insert documents FAC brouillon (repair_order_id) + document_lines + document_assign_number +
--     record_stock_move('sortie', origine 'sale') par piece + update repair_orders « facture » ;
--   facture : reglement carte (addPayments MAE du reste du).
-- Donnees d'essai creees dans la transaction (client, moto, piece d'essai recue 3 x 8,00 €). La caisse
-- deja ouverte d'ItalTest est reprise ; sinon une caisse d'essai est ouverte (transaction annulee).
-- Taux atelier DMS = 109,74 HT (decision Q48), pas 63,47 comme la base de formation G8 : la facture
-- vaut donc 223,38 € (piece 20 HT + 1,5 h x 109,74) et non 115,20 €.
-- Controles : Q48 taux ; Q42 km obligatoire ; constat ATE-017 (OR sans client accepte) ; numero OR = suivant de la serie TESTOR ; OR « a faire »,
-- km, 30 points, promis le, totaux ; registre (entree) ; acompte BC + reglement carte en caisse + FAA ;
-- pointage -> OR « en cours » + trace ; temps pointe 2 h ; controle du temps (quantite MO = 1,5 h) ;
-- facture : numero suivant TESTFAC, totaux, lignes ; OR « facture » + lien ; une seule facture par OR ;
-- B7 stock -1 (mouvement sortie, origine, n°, operateur), MO sans mouvement ; acompte reporte, BC
-- converti ; reglement carte -> facture payee ; B8 historique moto (OR, facture, registre sortie) ;
-- B11 productivite (pointe 2 h / facture 1,5 h) ; OR facture fige ; traces events.
-- Lancement : TESTS_DIR=... python rt.py parcours_g8_09_or_complet_facture.sql (transaction annulee).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. donnees d'essai (proprietaire)
do $s$
declare _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08'; _c uuid; _v uuid; _a uuid;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country, notes)
  values (_co, 'particulier', 'TEST', 'PARCOURS 09 OR', 'BE', 'Client essai parcours 9') returning id into _c;
  insert into public.vehicles (company_id, vin, brand, model, status, holder_contact_id, notes)
  values (_co, 'ZDMESSAIP09' || to_char(clock_timestamp(), 'HH24MISS'), 'DUCATI', 'ESSAI P09 MULTISTRADA', 'vendu', _c, 'ESSAI A BLANC')
  returning id into _v;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'ESSAI-P09-FILTRE', 'Filtre a huile essai P09', 'A', 8, 0, 20, 24.20, 21) returning id into _a;
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
  _mo_art uuid; _rate numeric; _seq record; _exp bigint; _num text; _or uuid; _r record; _err text;
  _sess uuid; _bc uuid; _pay record; _mo_line uuid; _fac uuid; _facnum text; _seqf record; _expf bigint;
  _ht numeric; _vat numeric; _ttc numeric; _before numeric; _after numeric; _st jsonb; _due numeric;
begin
  select id into _mo_art from public.articles where company_id = _co and reference = 'MO' and mgmt_type = 'T' limit 1;
  _rate := public.maintenance_hourly_rate_ht(_co);
  insert into _t(check_name, result) values ('Q48 taux horaire atelier lu = 109,74 HT (MO sans prix propre = taux atelier)',
    case when _rate = 109.74 and _mo_art is not null then 'ok' else 'KO ' || coalesce(_rate::text, 'null') end);

  -- Piece recue en stock (reception d'essai : 3 x 8,00).
  perform public.record_stock_move(_a, 'entree', 3, 8, false, null, 'reception', 'ESSAI-P09-REC', null);

  -- ------------------------------------------------------------ 1. creation de l'OR (km obligatoire Q42)
  begin
    insert into public.repair_orders (company_id, number, contact_id, vehicle_id, status) values (_co, 'ESSAI-P09-SANS-KM', _c, _v, 'a_faire');
    insert into _t(check_name, result) values ('Q42 OR avec moto sans kilometrage : refuse', 'KO accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('Q42 OR avec moto sans kilometrage : refuse', case when _err like 'Kilometrage obligatoire%' then 'ok' else 'KO ' || _err end);
  end;

  -- Constat (checklist ATE-017) : G8 exige operateur, client et n° de serie ; la base DMS n'exige que le km
  -- quand une moto est choisie (Q42). A trancher, ne fait pas echouer l'essai.
  begin
    insert into public.repair_orders (company_id, number, status) values (_co, 'ESSAI-P09-SANS-CLIENT', 'a_faire');
    insert into _t(check_name, result) values ('constat ATE-017 : un OR sans client, sans moto ni operateur est accepte (G8 : obligatoires, a trancher)', 'ok');
  exception when others then
    insert into _t(check_name, result) values ('constat ATE-017 : OR sans client refuse par la base', 'ok');
  end;

  select * into _seq from public.document_sequences where company_id = _co and doc_type = 'OR';
  _exp := case when _seq.reset_yearly and _seq.current_year is distinct from public._numbering_year() then 1 else _seq.next_value end;
  _num := public.next_document_number(_co, 'OR');
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, operator, repair_type, work_description,
                                    reception_notes, status, warranty_status, total_ht, total_vat, total_ttc, promised_at, check_points, notes)
  values (_co, _num, _c, _v, 60000, 'Chef atelier', null, 'Entretien annuel test', 'Rayure reservoir', 'a_faire', 'aucune',
          129.74, 27.25, 156.99, now() + interval '2 days', '{"huile_moteur":"V","liquide_frein":"R"}', 'Info interne non imprimee')
  returning id into _or;
  perform public.repair_order_write_lines(_or, jsonb_build_array(
    jsonb_build_object('kind', 'piece', 'article_id', _a, 'designation', 'Filtre a huile essai P09', 'quantity', 1, 'unit_price_ht', 20,
                       'vat_rate', 21, 'discount_pct', 0, 'is_warranty', false, 'line_ht', 20, 'line_ttc', 24.2),
    jsonb_build_object('kind', 'mo', 'article_id', _mo_art, 'designation', 'Main d''oeuvre atelier', 'quantity', 1, 'unit_price_ht', _rate,
                       'vat_rate', 21, 'discount_pct', 0, 'is_warranty', false, 'line_ht', 109.74, 'line_ttc', 132.79)));
  select * into _r from public.repair_orders where id = _or;
  insert into _t(check_name, result) values ('OR : numero = suivant de la serie OR (' || _num || ')',
    case when _num like _seq.prefix || '%' and right(_num, _seq.padding) = lpad(_exp::text, _seq.padding, '0')
          and (select next_value from public.document_sequences where id = _seq.id) = _exp + 1 then 'ok' else 'KO ' || _num end);
  insert into _t(check_name, result) values ('OR : « a faire », km 60 000, 30 points V/R, promis le, notes internes',
    case when _r.status = 'a_faire' and _r.mileage = 60000 and _r.check_points ->> 'liquide_frein' = 'R' and _r.promised_at is not null
          and _r.notes is not null and _r.warranty_status = 'aucune' then 'ok' else 'KO ' || row_to_json(_r)::text end);
  insert into _t(check_name, result) values ('OR : 2 lignes (piece + MO 1 h x 109,74), totaux 129,74 HT / 156,99 TTC',
    case when (select count(*) from public.repair_order_lines where or_id = _or) = 2 and _r.total_ttc = 156.99
          and (select sum(line_ht) from public.repair_order_lines where or_id = _or) = 129.74 then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('registre des vehicules : entree code 1 a l''ouverture de l''OR',
    case when exists (select 1 from public.vehicle_register where source = 'or' and source_id = _or and vehicle_id = _v and nature_code = '1' and left_at is null)
         then 'ok' else 'KO' end);

  -- ------------------------------------------------------------ 2. acompte sur l'OR (Q45), reglement carte en caisse
  select id into _sess from public.cash_sessions where company_id = _co and status = 'open' order by opened_at desc limit 1;
  if _sess is null then
    insert into public.cash_sessions (company_id, opening_float, opened_by, note)
    values (_co, 0, auth.uid(), 'ESSAI A BLANC parcours 9 (transaction annulee)') returning id into _sess;
  end if;
  _bc := public.repair_order_deposit_document(_or);
  insert into public.document_payments (document_id, method, amount, status, due_date, given_amount, note, from_financing)
  values (_bc, 'MAE', 50, 'recu', null, null, null, false) returning * into _pay;
  perform public.recompute_document_paid(_bc);
  insert into _t(check_name, result) values ('acompte : BC valide au n° de l''OR, 50 € carte dans la caisse ouverte',
    case when (select doc_type = 'BC' and status = 'validee' and number = _num and repair_order_id = _or and paid_amount = 50 from public.documents where id = _bc)
          and _pay.cash_session_id = _sess then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('acompte : facture d''acompte FAA creee automatiquement (moto sur l''OR)',
    case when exists (select 1 from public.documents where company_id = _co and doc_type = 'FAA' and deposit_payment_id = _pay.id and status <> 'brouillon')
           or exists (select 1 from public.document_payments where id = _pay.id and deposit_invoice_id is not null)
         then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('acompte : colonne « Acompte » de la liste des OR = 50',
    case when (select amount from public.repair_order_deposits(array[_or])) = 50 then 'ok' else 'KO' end);

  -- ------------------------------------------------------------ 3. pointage du mecanicien
  _st := public.workshop_work_start(_or, null, false, 'ESSAI09', 'John', 'screen');
  insert into _t(check_name, result) values ('pointage « Demarrer » : OR « en cours » + trace repair_order_work_started',
    case when _st ->> 'status' = 'started' and (select status from public.repair_orders where id = _or) = 'en_cours'
          and exists (select 1 from public.events where entity_id = _or::text and action = 'repair_order_work_started') then 'ok' else 'KO ' || _st::text end);
  perform public.workshop_work_stop(_or, null, 'ESSAI09', 'stop', 'screen');
  -- Le meme mecanicien avait travaille 2 h plus tot dans la journee (pointage clos par « Terminer »).
  insert into public.workshop_time_entries (company_id, mechanic_code, mechanic_name, or_id, kind, started_at)
  values (_co, 'ESSAI09', 'John', _or, 'travail', now() - interval '2 hours');
  perform public.workshop_work_stop(_or, null, 'ESSAI09', 'stop', 'screen');
  insert into _t(check_name, result) values ('temps pointe sur l''OR = 2 h (mecanicien ESSAI09)',
    case when (select pointed_h from public.repair_order_time_summary(_or) where mechanic_code = 'ESSAI09') = 2 then 'ok'
         else 'KO ' || coalesce((select string_agg(row_to_json(x)::text, ' ') from public.repair_order_time_summary(_or) x), 'vide') end);

  -- ------------------------------------------------------------ 4. controle du temps atelier puis facture
  select id into _mo_line from public.repair_order_lines where or_id = _or and kind = 'mo';
  perform public.repair_order_time_control(_or, jsonb_build_array(jsonb_build_object('id', _mo_line, 'mechanic_code', 'ESSAI09',
    'mechanic_name', 'John', 'work_date', current_date, 'billed_hours', 1.5, 'worked_hours', 2, 'internal_hours', 0, 'warranty_hours', 0)));
  select * into _r from public.repair_order_lines where id = _mo_line;
  insert into _t(check_name, result) values ('controle du temps : MO quantite = 1,5 h facturee, 2 h passee, 164,61 HT',
    case when _r.quantity = 1.5 and _r.billed_hours = 1.5 and _r.worked_hours = 2 and _r.line_ht = 164.61 then 'ok' else 'KO ' || row_to_json(_r)::text end);

  -- transformToInvoice (write-api.ts) : lignes de l'OR -> lignes de facture, totaux de computeTotals.
  select round(sum(q * p), 2), round(sum(q * p * vr / 100), 2) into _ht, _vat
    from (select case when kind = 'mo' then coalesce(billed_hours, quantity) else quantity end q, unit_price_ht p, vat_rate vr
            from public.repair_order_lines where or_id = _or) x;
  _ttc := _ht + _vat;
  select * into _seqf from public.document_sequences where company_id = _co and doc_type = 'FAC';
  _expf := case when _seqf.reset_yearly and _seqf.current_year is distinct from public._numbering_year() then 1 else _seqf.next_value end;
  select real_qty into _before from public.article_stock(_a);
  insert into public.documents (company_id, number, status, source_document_id, doc_type, contact_id, vehicle_id, issue_date, due_date, notes,
                                total_ht, total_vat, total_ttc, price_mode, tax_exempt, global_discount_pct, global_discount_amount,
                                shipping_ht, shipping_taxed, shipping_vat_rate, forced_ttc, repair_order_id)
  select _co, null, 'brouillon', null, 'FAC', o.contact_id, o.vehicle_id, current_date, null, 'OR ' || o.number,
         _ht, _vat, _ttc, o.price_mode, false, 0, 0, 0, true, 21, null, _or
    from public.repair_orders o where o.id = _or
  returning id into _fac;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate,
                                     discount_pct, line_ht, line_ttc, sort_order)
  select _fac, l.article_id, l.designation, null, case when l.kind = 'mo' then 'main_oeuvre' else 'article' end,
         case when l.kind = 'mo' then coalesce(l.billed_hours, l.quantity) else l.quantity end, l.unit_price_ht, l.vat_rate, l.discount_pct,
         round(case when l.kind = 'mo' then coalesce(l.billed_hours, l.quantity) else l.quantity end * l.unit_price_ht, 2),
         round(case when l.kind = 'mo' then coalesce(l.billed_hours, l.quantity) else l.quantity end * l.unit_price_ht * (1 + l.vat_rate / 100), 2),
         row_number() over (order by l.sort_order) - 1
    from public.repair_order_lines l where l.or_id = _or;
  _facnum := public.document_assign_number(_fac);
  perform public.record_stock_move(_a, 'sortie', -1, null, false, null, 'sale', _facnum, null);
  update public.repair_orders set status = 'facture', invoice_document_id = _fac where id = _or;
  select real_qty into _after from public.article_stock(_a);

  insert into _t(check_name, result) values ('facture : numero = suivant de la serie FAC (' || coalesce(_facnum, 'null') || ')',
    case when _facnum like _seqf.prefix || '%' and right(_facnum, _seqf.padding) = lpad(_expf::text, _seqf.padding, '0') then 'ok' else 'KO ' || coalesce(_facnum, 'null') end);
  insert into _t(check_name, result) values ('facture : 184,61 HT / 38,77 TVA / 223,38 TTC, MO en ligne main-d''oeuvre 1,5 h',
    case when (select total_ht = 184.61 and total_vat = 38.77 and total_ttc = 223.38 and repair_order_id = _or and status in ('validee', 'payee')
                 from public.documents where id = _fac)
          and exists (select 1 from public.document_lines where document_id = _fac and line_type = 'main_oeuvre' and quantity = 1.5 and line_ht = 164.61)
         then 'ok' else 'KO ' || (select row(total_ht, total_vat, total_ttc, status)::text from public.documents where id = _fac) end);
  insert into _t(check_name, result) values ('OR « facture » et relie a sa facture (passe par la base a la validation)',
    case when (select status = 'facture' and invoice_document_id = _fac from public.repair_orders where id = _or) then 'ok' else 'KO' end);
  begin
    insert into public.documents (company_id, doc_type, status, contact_id, issue_date, repair_order_id) values (_co, 'FAC', 'brouillon', _c, current_date, _or);
    insert into _t(check_name, result) values ('une seule facture par OR : 2e facture refusee', 'KO acceptee');
  exception when others then
    insert into _t(check_name, result) values ('une seule facture par OR : 2e facture refusee', 'ok');
  end;
  insert into _t(check_name, result) values ('B7 stock : piece 3 -> 2, mouvement « sortie » -1 origine vente, n° de facture, operateur',
    case when _before = 3 and _after = 2
          and exists (select 1 from public.stock_moves where article_id = _a and move_type = 'sortie' and qty_delta = -1 and origin = 'sale'
                       and ref = _facnum and operator_id = auth.uid() and not is_reservation)
         then 'ok' else 'KO ' || coalesce(_before::text, '?') || ' -> ' || coalesce(_after::text, '?') end);
  insert into _t(check_name, result) values ('B7 : la main-d''oeuvre ne bouge pas le stock',
    case when not exists (select 1 from public.stock_moves where article_id = _mo_art and ref = _facnum) then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('acompte reporte sur la facture (50, lien FAA) et BC « converti »',
    case when exists (select 1 from public.document_payments where document_id = _fac and transferred_from = _pay.id and amount = 50)
          and (select status from public.documents where id = _bc) = 'converti'
          and exists (select 1 from public.events where action = 'repair_order_deposit_transferred' and entity_id = _fac::text) then 'ok' else 'KO' end);

  -- ------------------------------------------------------------ 5. reglement carte du reste du
  select total_ttc - paid_amount into _due from public.documents where id = _fac;
  insert into public.document_payments (document_id, method, amount, status, due_date, given_amount, note, from_financing)
  values (_fac, 'MAE', _due, 'recu', null, null, null, false);
  perform public.recompute_document_paid(_fac);
  insert into _t(check_name, result) values ('reglement carte 173,38 : facture « payee » (223,38 regles)',
    case when _due = 173.38 and (select status = 'payee' and paid_amount = 223.38 from public.documents where id = _fac) then 'ok' else 'KO ' || coalesce(_due::text, 'null') end);

  -- ------------------------------------------------------------ 6. historique moto (B8), productivite (B11), OR fige
  insert into _t(check_name, result) values ('B8 historique moto : OR (km 60 000, facture) et facture rattaches a la moto, registre sorti avec la facture',
    case when exists (select 1 from public.repair_orders where vehicle_id = _v and id = _or and mileage = 60000 and status = 'facture')
          and exists (select 1 from public.documents where vehicle_id = _v and id = _fac)
          and exists (select 1 from public.vehicle_register where source = 'or' and source_id = _or and left_at is not null and invoice_document_id = _fac)
         then 'ok' else 'KO' end);
  select * into _r from public.workshop_productivity_detail(_co, current_date, current_date) where mechanic_key = 'ESSAI09';
  insert into _t(check_name, result) values ('B11 productivite : temps passe pointe 2 h, temps facture 1,5 h',
    case when _r.pointed_h = 2 and _r.billed_h = 1.5 and _r.to_bill_h = 0 then 'ok' else 'KO ' || coalesce(row_to_json(_r)::text, 'aucune ligne') end);
  begin
    perform public.repair_order_write_lines(_or, '[]'::jsonb);
    insert into _t(check_name, result) values ('OR facture : lignes figees', 'KO modifiees');
  exception when others then
    insert into _t(check_name, result) values ('OR facture : lignes figees', 'ok');
  end;
end $s$;

reset role;
select n, check_name, result from _t order by n;
