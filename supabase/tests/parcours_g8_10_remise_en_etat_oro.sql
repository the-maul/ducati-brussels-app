-- =====================================================================
-- Parcours G8 n° 10 (docs/g8-inventaire/parcours.md) : remise en etat d'une occasion (ORO), ItalTest.
-- G8 : Atelier > Cessions internes/O.R.O > Creation > type 01 CESSION VO > operateur > n° de serie
--      OCC1000000 (reprise 5 000 €) > travaux « Remise en etat » > ligne piece au PAMP (0,75 au lieu
--      du PV 1,74) + MO_ATELIER 1 h interne > fenetre CESSION VO : prix de revient 5 000 -> 5 028,95,
--      marge PR -28,95 au PV 5 000 > Valider sans editer (cession 5000013).
-- DMS (src/modules/tradein/cessions/api.ts, ecran « Cessions internes ») :
--   openCession = open_internal_cession(_company, '01', moto, operateur, travaux, valorisation par defaut) ;
--   AddLineForm = add_internal_cession_line(piece, article, qte) puis (mo, article MO, heures internes,
--     heures passees, mecanicien, cout = cout horaire interne du reglage quand l'article MO n'a pas de cout) ;
--   CessionCostDialog = internal_cession_cost_context ; Valider = validate_internal_cession(_options 0).
-- Donnees d'essai creees dans la transaction : piece recue 4 x 1,00 puis 4 x 0,50 (PAMP 0,75, dernier
-- PA 0,50, PV 1,74 TTC comme G8), moto d'occasion en stock VO a 5 000 € (= la reprise du parcours 3).
-- REGLAGE : le cout horaire interne de la MO (Parametres > Tables > Reglages des cessions,
-- `internal_hourly_rate`) vaut 0 dans ItalTest ET dans ITALBIKE STORE, et l'article MO n'a ni PA ni
-- PAMP : sans reglage, 1 h interne ne coute rien (controle 2). L'essai pose 28,20 €/h (valeur qui donne
-- les 5 028,95 de G8 : 28,95 - 0,75), comme l'utilisateur le ferait dans Parametres (a confirmer : a-trancher).
-- Controles : reglages (PAMP par defaut, 01 comptabilisee) ; constat MO a 0 sans reglage ; constat ATE-089 ; ouverture
-- (n° serie TESTORO suivant, type, statut, moto) ; lignes au PAMP + MO interne = 28,95, TVA 0 ; fenetre
-- prix de revient ; validation : prix de revient 5 000 -> 5 028,95 (B3), historique append-only + event,
-- stock -1 par mouvement « cession » (B7), MO sans mouvement ; pas en charge atelier (ni OR, ni facture,
-- ni vente au journal) ; cession figee ; liste detaillee des cessions ; « autres cessions » d'une 2e cession.
-- Lancement : TESTS_DIR=... python rt.py parcours_g8_10_remise_en_etat_oro.sql (transaction annulee).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. donnees d'essai (proprietaire)
do $s$
declare _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08'; _a uuid; _v uuid;
begin
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'ESSAI-P10-PIECE', 'Piece essai remise en etat P10', 'A', 0.50, 0, 1.44, 1.74, 21) returning id into _a;
  insert into public.vehicles (company_id, vin, brand, model, status, purchase_price, cost_price, display_price, notes)
  values (_co, 'ZDMESSAIP10' || to_char(clock_timestamp(), 'HH24MISS'), 'DUCATI', 'ESSAI P10 MONSTER OCC', 'stock_vo', 5000, 5000, 5000, 'ESSAI A BLANC')
  returning id into _v;
  perform set_config('test.a', _a::text, true);
  perform set_config('test.v', _v::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _a uuid := current_setting('test.a')::uuid;
  _v uuid := current_setting('test.v')::uuid;
  _mo uuid; _seq record; _exp bigint; _ces uuid; _c record; _probe uuid; _l uuid; _ctx jsonb; _val jsonb;
  _before numeric; _after numeric; _err text; _rate_before text;
begin
  select id into _mo from public.articles where company_id = _co and reference = 'MO' and mgmt_type = 'T' limit 1;
  insert into _t(check_name, result) values ('reglages : valorisation PAMP par defaut (Q28), type 01 « Cession VO » comptabilise',
    case when (select label from public.reference_values where company_id = _co and table_key = 'cession_settings' and code = 'cost_basis') = 'pamp'
          and (select (extra ->> 'accounted')::boolean from public.reference_values where company_id = _co and table_key = 'cession_type' and code = '01')
         then 'ok' else 'KO' end);

  -- Deux receptions : 4 a 1,00 puis 4 a 0,50 -> PAMP 0,75 (B5), dernier PA 0,50.
  perform public.record_stock_move(_a, 'entree', 4, 1.00, false, null, 'reception', 'ESSAI-P10-REC1', null);
  perform public.record_stock_move(_a, 'entree', 4, 0.50, false, null, 'reception', 'ESSAI-P10-REC2', null);

  -- Constat du reglage reel : 1 h interne sur l'article MO = 0 € (cout horaire interne 0, MO sans PAMP).
  select label into _rate_before from public.reference_values where company_id = _co and table_key = 'cession_settings' and code = 'internal_hourly_rate';
  _probe := public.open_internal_cession(_co, '07', null, null, 'Sonde', 'Sonde cout MO');
  perform public.add_internal_cession_line(_probe, 'mo', _mo, null, 1, 1, null, null, null);
  insert into _t(check_name, result) values ('constat : avec le reglage actuel (' || _rate_before || ' €/h), 1 h interne MO = 0 € (a parametrer)',
    case when (select sum(line_cost) from public.internal_cession_lines where cession_id = _probe) = 0 then 'ok' else 'KO' end);
  perform public.cancel_internal_cession(_probe);
  -- Parametres > Tables > Reglages des cessions : cout horaire interne 28,20 € HT.
  update public.reference_values set label = '28.20' where company_id = _co and table_key = 'cession_settings' and code = 'internal_hourly_rate';

  -- ATE-089 (VP8, decide le 20/11 : comme G8) : type, operateur et n° de serie obligatoires ;
  -- une cession VO sans moto est refusee.
  begin
    _probe := public.open_internal_cession(_co, '01', null);
    insert into _t(check_name, result) values ('ATE-089 (VP8) : cession VO sans moto refusee (comme G8)', 'KO acceptee');
    perform public.cancel_internal_cession(_probe);
  exception when others then
    insert into _t(check_name, result) values ('ATE-089 (VP8) : cession VO sans moto refusee (comme G8)', case when sqlerrm like 'Cession : compléter%' then 'ok' else 'KO ' || sqlerrm end);
  end;

  -- ------------------------------------------------------------ 1. ouverture de la cession VO sur la moto
  select * into _seq from public.document_sequences where company_id = _co and doc_type = 'OR';  -- VP7 (20/11, comme G8) : meme compteur que les OR
  _exp := case when _seq.reset_yearly and _seq.current_year is distinct from public._numbering_year() then 1 else _seq.next_value end;
  _ces := public.open_internal_cession(_co, '01', _v, auth.uid(), 'Chef atelier', 'Remise en etat', null);
  select * into _c from public.internal_cessions where id = _ces;
  insert into _t(check_name, result) values ('ouverture : n° ' || coalesce(_c.number, 'null') || ' = suivant de la serie OR (VP7), Cession VO, PAMP, ouverte, moto',
    case when _c.number like _seq.prefix || '%' and right(_c.number, _seq.padding) = lpad(_exp::text, _seq.padding, '0')
          and _c.cession_type = '01' and _c.type_label = 'Cession VO' and _c.accounted and _c.cost_basis = 'pamp'
          and _c.status = 'ouvert' and _c.vehicle_id = _v and _c.work_description = 'Remise en etat' then 'ok' else 'KO ' || row_to_json(_c)::text end);

  -- ------------------------------------------------------------ 2. lignes : piece au PAMP + 1 h interne
  perform public.add_internal_cession_line(_ces, 'piece', _a, null, 1, null, null, null, null);
  _l := public.add_internal_cession_line(_ces, 'mo', _mo, 'Remise en etat', 1, 1, auth.uid(), 'Jeremy', null);
  insert into _t(check_name, result) values ('lignes : piece 0,75 (PAMP, pas le PV 1,74) + MO 1 h interne 28,20 = 28,95, TVA 0',
    case when (select unit_cost from public.internal_cession_lines where cession_id = _ces and kind = 'piece') = 0.75
          and (select unit_cost from public.internal_cession_lines where id = _l) = 28.20
          and (select sum(line_cost) from public.internal_cession_lines where cession_id = _ces) = 28.95
          and (select bool_and(vat_rate = 0) from public.internal_cession_lines where cession_id = _ces) then 'ok'
         else 'KO ' || coalesce((select sum(line_cost)::text from public.internal_cession_lines where cession_id = _ces), 'null') end);

  -- ------------------------------------------------------------ 3. fenetre prix de revient puis validation
  _ctx := public.internal_cession_cost_context(_ces);
  insert into _t(check_name, result) values ('fenetre CESSION VO : ancien prix de revient 5 000, cession actuelle 28,95, autres cessions 0',
    case when (_ctx ->> 'purchase_price')::numeric = 5000 and (_ctx ->> 'current_cost')::numeric = 28.95
          and (_ctx ->> 'other_cessions')::numeric = 0 and (_ctx ->> 'accounted')::boolean then 'ok' else 'KO ' || _ctx::text end);
  select real_qty into _before from public.article_stock(_a);
  _val := public.validate_internal_cession(_ces, 0);
  select real_qty into _after from public.article_stock(_a);
  insert into _t(check_name, result) values ('B3 validation : prix de revient de la moto 5 000 -> 5 028,95 (marge PR -28,95 au PV 5 000)',
    case when (select cost_price from public.vehicles where id = _v) = 5028.95 and (_val ->> 'cost_before')::numeric = 5000
          and (_val ->> 'cost_after')::numeric = 5028.95 and 5000 - (_val ->> 'cost_after')::numeric = -28.95 then 'ok' else 'KO ' || _val::text end);
  insert into _t(check_name, result) values ('B3 historique append-only du cout de revient (+28,95, source cession) + event cession_validee',
    case when exists (select 1 from public.vehicle_cost_changes where vehicle_id = _v and source = 'cession' and old_cost = 5000 and new_cost = 5028.95 and delta = 28.95)
          and exists (select 1 from public.events where action = 'cession_validee' and entity_id = _ces::text) then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('B7 stock : piece 8 -> 7 par un mouvement « cession » au n° de la cession, operateur ; MO sans mouvement',
    case when _before = 8 and _after = 7
          and exists (select 1 from public.stock_moves where article_id = _a and move_type = 'cession' and qty_delta = -1 and origin = 'cession'
                       and ref = _c.number and operator_id = auth.uid())
          and not exists (select 1 from public.stock_moves where article_id = _mo and ref = _c.number) then 'ok' else 'KO ' || _before || ' -> ' || _after end);
  insert into _t(check_name, result) values ('pas en charge atelier : ni OR, ni facture, rien au journal des ventes',
    case when not exists (select 1 from public.repair_orders where vehicle_id = _v)
          and not exists (select 1 from public.documents where vehicle_id = _v)
          and not exists (select 1 from public.stock_moves where article_id = _a and origin = 'sale') then 'ok' else 'KO' end);
  begin
    perform public.add_internal_cession_line(_ces, 'frais', null, 'Ajout tardif', 1, null, null, null, 10);
    insert into _t(check_name, result) values ('cession validee figee : plus de ligne', 'KO acceptee');
  exception when others then
    insert into _t(check_name, result) values ('cession validee figee : plus de ligne', 'ok');
  end;
  insert into _t(check_name, result) values ('liste detaillee des cessions : piece au PAMP 0,75, moto (VIN) et n° de cession',
    case when exists (select 1 from public.internal_cession_report(_co, current_date, current_date) r
                       where r.reference = 'ESSAI-P10-PIECE' and r.amount_pamp = 0.75 and r.number = _c.number
                         and r.vin = (select vin from public.vehicles where id = _v)) then 'ok' else 'KO' end);
  _probe := public.open_internal_cession(_co, '01', _v);
  insert into _t(check_name, result) values ('cession comptee dans la fenetre d''une 2e cession VO de la moto (autres cessions = 28,95)',
    case when (public.internal_cession_cost_context(_probe) ->> 'other_cessions')::numeric = 28.95 then 'ok' else 'KO' end);
end $s$;

reset role;
select n, check_name, result from _t order by n;
