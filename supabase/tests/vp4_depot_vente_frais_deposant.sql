-- =====================================================================
-- VP4 (décision du client, 20/11/2026, comme G8) — Dépôt-vente : cession ouverte d'office à
-- l'entrée ; frais payés par le déposant (déduits du reversement), hors coût de revient concession.
-- Migrations : 20261120345000 (+ 20261120343000 compteur OR, 20261120344000 opérateur).
-- Société de test ItalTest, administrateur simon@themaul.be, transaction annulée (rt.py).
-- Contrôles :
--   1. entrée du dépôt (payload de l'écran) : UNE cession ouverte d'office, type 01, origine depot,
--      reliée au dépôt, client = déposant, opérateur = l'utilisateur, n° au compteur des OR ;
--   2. pièce ajoutée, cession encore ouverte : signalée (open_with_lines), rien à déduire ;
--   3. cession validée : sortie de stock « cession » ; coût de revient de la moto INCHANGÉ (moto du
--      déposant), aucune ligne vehicle_cost_changes ;
--   4. frais à charge du déposant : 2 x PAMP 0,75 = 1,50 HT → 1,82 TTC (TVA de la commission 21 %) ;
--   5. vente sans montant de réparations : 1,82 repris d'office ; reversement = 7 000 − 1 000 − 1,82
--      = 5 998,18 ; ligne « Réparations » sur la facture au déposant ; facture = 1 001,82 ;
--   6. la cession du dépôt est archivée à la vente ;
--   7. cession ouverte à la main sur une moto en dépôt : reliée au dépôt d'office ;
--   8. l'écran garde la main : réparations 0 envoyées → 0 déduit ;
--   9. réglage auto_cession_on_entry = non : pas de cession à l'entrée.
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08'; _a uuid;
begin
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'ESSAI-VP4-PIECE-' || to_char(clock_timestamp(), 'HH24MISSUS'), 'Piece essai VP4', 'A', 0.50, 0, 10, 12.10, 21) returning id into _a;
  perform set_config('test.a', _a::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _a uuid := current_setting('test.a')::uuid;
  _tag text := to_char(clock_timestamp(), 'HH24MISSUS');
  _dep uuid; _buy uuid; _c uuid; _c2 uuid; _c3 uuid; _ces uuid; _man uuid; _n int; _orseq0 bigint; _orpfx text;
  _costs jsonb; r jsonb; cs record; ce record; v0 record; v1 record;
begin
  insert into public.contacts (company_id, type, status, civility, first_name, last_name, zip, city, country)
  values (_co, 'particulier', 'client', 'M', 'Marc', 'DEPOSANT VP4', '1180', 'Uccle', 'BE') returning id into _dep;
  insert into public.contacts (company_id, type, status, civility, first_name, last_name, zip, city, country)
  values (_co, 'particulier', 'prospect', 'M', 'Luc', 'ACQUEREUR VP4', '1000', 'Bruxelles', 'BE') returning id into _buy;
  perform public.record_stock_move(_a, 'entree', 4, 1.00, false, null, 'reception', 'ESSAI-VP4-REC1', null);
  perform public.record_stock_move(_a, 'entree', 4, 0.50, false, null, 'reception', 'ESSAI-VP4-REC2', null);
  select next_value, prefix into _orseq0, _orpfx from public.document_sequences where company_id = _co and doc_type = 'OR';

  -- 1. Entrée du dépôt
  _c := public.consignment_create(_co, jsonb_build_object('depositor_id', _dep, 'depositor_kind', 'particulier',
          'vehicle', jsonb_build_object('vin', 'ZDMVP4A' || _tag, 'brand', 'Ducati', 'model', 'Monster 937'),
          'asked_price', 6000, 'agreed_price', 7000, 'min_price', 6500, 'commission_mode', 'ecart', 'deposit_fee', 0));
  select * into cs from public.consignments where id = _c;
  select count(*) into _n from public.internal_cessions where consignment_id = _c;
  select * into ce from public.internal_cessions where consignment_id = _c limit 1;
  _ces := ce.id;
  insert into _t(check_name, result) values
    ('entree du depot : une cession ouverte d''office (type 01, origine depot, reliee au depot, client = deposant)',
     case when _n = 1 and ce.status = 'ouvert' and ce.cession_type = '01' and ce.origin = 'depot'
               and ce.vehicle_id = cs.vehicle_id and ce.contact_id = _dep then 'ok' else 'KO n=' || _n || ' ' || coalesce(ce.origin, 'null') end),
    ('cession d''office : operateur = l''utilisateur connecte, n° au compteur des OR (' || coalesce(ce.number, 'null') || ')',
     case when ce.operator_id = auth.uid() and ce.operator_name is not null and ce.number like _orpfx || '%'
               and (select next_value from public.document_sequences where company_id = _co and doc_type = 'OR') = _orseq0 + 1
          then 'ok' else 'KO ' || coalesce(ce.operator_name, 'sans operateur') end);

  -- 2. Pièce ajoutée, cession ouverte
  perform public.add_internal_cession_line(_ces, 'piece', _a, null, 2, null, null, null, null);
  _costs := public.consignment_depot_costs(_c);
  insert into _t(check_name, result) values
    ('cession encore ouverte avec une ligne : signalee, rien a deduire tant qu''elle n''est pas validee',
     case when (_costs->>'open_with_lines')::int = 1 and (_costs->>'amount_ttc')::numeric = 0 then 'ok' else 'KO ' || _costs::text end);

  -- 3. Validation : hors coût de revient de la concession
  select cost_price, purchase_price into v0 from public.vehicles where id = cs.vehicle_id;
  perform public.validate_internal_cession(_ces, 0);
  select cost_price into v1 from public.vehicles where id = cs.vehicle_id;
  insert into _t(check_name, result) values
    ('cession validee : sortie de stock « cession » de la piece (2)',
     case when exists (select 1 from public.stock_moves m where m.article_id = _a and m.origin = 'cession' and m.qty_delta = -2) then 'ok' else 'KO' end),
    ('cout de revient de la moto du deposant inchange (' || coalesce(v0.cost_price::text, 'null') || '), aucune ligne vehicle_cost_changes',
     case when v1.cost_price is not distinct from v0.cost_price
               and not exists (select 1 from public.vehicle_cost_changes x where x.vehicle_id = cs.vehicle_id) then 'ok' else 'KO ' || coalesce(v1.cost_price::text, 'null') end);

  -- 4. Frais à charge du déposant
  _costs := public.consignment_depot_costs(_c);
  insert into _t(check_name, result) values
    ('frais a charge du deposant : 2 x PAMP 0,75 = 1,50 HT -> 1,82 TTC (base cout, TVA 21 %)',
     case when (_costs->>'basis') = 'cout' and (_costs->>'amount_ht')::numeric = 1.50 and (_costs->>'amount_ttc')::numeric = 1.82
               and (_costs->>'open_with_lines')::int = 0 then 'ok' else 'KO ' || _costs::text end);

  -- 7. Cession ouverte à la main sur la moto en dépôt : reliée au dépôt
  _man := public.open_internal_cession(_co, '01', cs.vehicle_id, null, null, 'Preparation', null);
  insert into _t(check_name, result) values
    ('cession ouverte a la main sur une moto en depot : reliee au depot d''office',
     case when (select consignment_id from public.internal_cessions where id = _man) = _c then 'ok' else 'KO' end);
  perform public.cancel_internal_cession(_man);

  -- 5. Vente sans montant de réparations
  r := public.consignment_sell(_c, jsonb_build_object('buyer_id', _buy, 'sale_price', 7000, 'fees', 0));
  select * into cs from public.consignments where id = _c;
  insert into _t(check_name, result) values
    ('vente : frais de la cession repris d''office (1,82) et deduits du reversement : 7 000 - 1 000 - 1,82 = 5 998,18',
     case when cs.sold_repairs = 1.82 and cs.sold_commission = 1000 and cs.sold_reversal = 5998.18 and (r->>'net')::numeric = 5998.18
          then 'ok' else 'KO repairs=' || cs.sold_repairs || ' net=' || cs.sold_reversal end),
    ('facture au deposant : commission + ligne « Reparations » 1,82 = 1 001,82 TTC',
     case when (select total_ttc from public.documents where id = cs.commission_document_id) = 1001.82
               and exists (select 1 from public.document_lines l where l.document_id = cs.commission_document_id
                            and l.designation ilike 'Reparations%' ) then 'ok' else 'KO' end),
    ('la cession du depot est archivee a la vente',
     case when (select status from public.internal_cessions where id = _ces) = 'archive' then 'ok' else 'KO' end);

  -- 8. L'écran garde la main
  _c2 := public.consignment_create(_co, jsonb_build_object('depositor_id', _dep, 'depositor_kind', 'particulier',
          'vehicle', jsonb_build_object('vin', 'ZDMVP4B' || _tag, 'brand', 'Ducati', 'model', 'Scrambler'),
          'asked_price', 6000, 'agreed_price', 7000, 'commission_mode', 'ecart', 'deposit_fee', 0));
  select id into _ces from public.internal_cessions where consignment_id = _c2;
  perform public.add_internal_cession_line(_ces, 'piece', _a, null, 1, null, null, null, null);
  perform public.validate_internal_cession(_ces, 0);
  r := public.consignment_sell(_c2, jsonb_build_object('buyer_id', _buy, 'sale_price', 7000, 'fees', 0, 'repairs', 0));
  insert into _t(check_name, result) values
    ('montant choisi a l''ecran (0) : rien de deduit',
     case when (select sold_repairs from public.consignments where id = _c2) = 0 and (r->>'net')::numeric = 6000 then 'ok' else 'KO' end);

  -- 9. Réglage : pas de cession à l'entrée
  insert into public.reference_values (company_id, table_key, code, label)
  values (_co, 'consignment_settings', 'auto_cession_on_entry', 'non')
  on conflict (company_id, table_key, code) do update set label = 'non';
  _c3 := public.consignment_create(_co, jsonb_build_object('depositor_id', _dep, 'depositor_kind', 'particulier',
          'vehicle', jsonb_build_object('vin', 'ZDMVP4C' || _tag, 'brand', 'Ducati', 'model', 'Panigale'),
          'asked_price', 6000, 'agreed_price', 7000, 'commission_mode', 'ecart', 'deposit_fee', 0));
  insert into _t(check_name, result) values
    ('reglage auto_cession_on_entry = non : pas de cession a l''entree',
     case when not exists (select 1 from public.internal_cessions where consignment_id = _c3) then 'ok' else 'KO' end);
end $s$;

select n, check_name, result from _t order by n;
