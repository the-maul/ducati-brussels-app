-- =====================================================================
-- VEN008 (18/11/2026) — essai a blanc de la migration 20261118270000_m7_depot_vente_complet.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118270000_m7_depot_vente_complet.sql \
--      supabase/tests/m7_depot_vente_complet.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- (a placer apres les migrations du bloc 20261103… si elles sont jouees dans la meme transaction :
--  registre des vehicules, caisse legale, facture legale, et le lot caisse 20261118150000.)
-- Joue le role d un administrateur (claims JWT simulees) dans ITALBIKE STORE :
--   - entree : nouvelle moto (VIN d essai), prix demande 6 000, PV 7 000, minimum 6 500, frais 150 ;
--     n° DEP auto, moto « depot-vente », article D, stock 1 SANS valeur (valeur du stock inchangee) ;
--     une entree valorisee d un article D est refusee ;
--   - vente a 7 000 avec 242 de reparations : facture acheteur 7 000 sans TVA (particulier),
--     facture au deposant 1 392 TTC (commission 1 000 + frais 150 + reparations 242, TVA 21 %),
--     reglee par retenue (DEP), net 5 608 ; moto vendue, acheteur proprietaire, stock 0 ;
--     second reglement refuse ;
--   - versement par virement : mouvement de caisse « sortie » 5 608 ; second versement refuse ;
--   - ecritures prevues : compte d entree depot (classe 4) equilibre (7 000 au credit, 1 392 + 5 608 au debit) ;
--   - retour client d un second depot avec 50 de frais : statut « restitue », moto de client, stock 0, facture 50.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _dep uuid; _buy uuid; _c uuid; _c2 uuid; r jsonb; r2 jsonb; cs record; cs2 record; v record; d record; _err text;
  _val_before numeric; _val_after numeric; _real numeric; _cred numeric; _deb numeric;
begin
  insert into public.contacts (company_id, civility, first_name, last_name) values (_co, 'Monsieur', 'Essai', 'DEPOSANT DEPOT') returning id into _dep;
  insert into public.contacts (company_id, civility, first_name, last_name) values (_co, 'Monsieur', 'Essai', 'ACHETEUR DEPOT') returning id into _buy;
  _val_before := public.stock_value_owned(_co);

  -- ------------------------------------------------ calcul du decompte (meme regle que consignment-rules.ts)
  select * into d from public.consignment_amounts(7000, 6000, 'ecart', 0, null, 150, 242, 21);
  insert into _t(check_name, result) values
    ('decompte : commission ecart 1 000 (HT 826,45 / TVA 173,55)', case when d.commission_ttc = 1000 and d.commission_ht = 826.45 and d.commission_vat = 173.55 then 'ok' else 'FAIL ' || row_to_json(d)::text end),
    ('decompte : facture au deposant 1 392, net 5 608', case when d.invoice_ttc = 1392 and d.net = 5608 then 'ok' else 'FAIL ' || row_to_json(d)::text end),
    ('decompte : pourcentage 10 % de 7 000 = 700', case when (select commission_ttc from public.consignment_amounts(7000, 0, 'pourcentage', 10, null, 0, 0, 21)) = 700 then 'ok' else 'FAIL' end),
    ('decompte : vendu sous le prix demande, commission 0', case when (select commission_ttc from public.consignment_amounts(5500, 6000, 'ecart', 0, null, 0, 0, 21)) = 0 then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ entree
  _c := public.consignment_create(_co, jsonb_build_object(
    'depositor_id', _dep, 'depositor_kind', 'particulier',
    'vehicle', jsonb_build_object('vin', 'ZDMTESTDEPOT00001', 'brand', 'Ducati', 'model', 'Monster', 'model_year', '2021', 'plate', '1-TST-001', 'mileage', '12000'),
    'asked_price', 6000, 'agreed_price', 7000, 'min_price', 6500, 'commission_mode', 'ecart', 'deposit_fee', 150,
    'checklist', jsonb_build_object('coc', true, 'main_key', true)));
  select * into cs from public.consignments where id = _c;
  select * into v from public.vehicles where id = cs.vehicle_id;
  select coalesce(s.real_qty, 0) into _real from public.article_stock(cs.article_id) s;
  _val_after := public.stock_value_owned(_co);
  insert into _t(check_name, result) values
    ('entree : n° DEP automatique', case when cs.number like 'DEP%' then 'ok' else 'FAIL ' || coalesce(cs.number, 'null') end),
    ('entree : moto au statut depot-vente, prix affiche 7 000', case when v.status::text = 'depot_vente' and v.display_price = 7000 then 'ok' else 'FAIL ' || v.status::text end),
    ('entree : article de type D relie', case when (select mgmt_type::text from public.articles where id = cs.article_id) = 'D' and v.article_id = cs.article_id then 'ok' else 'FAIL' end),
    ('entree : stock reel 1', case when _real = 1 then 'ok' else 'FAIL ' || _real end),
    ('entree : aucun mouvement valorise (stock non valorise)', case when not exists (select 1 from public.stock_moves where article_id = cs.article_id and coalesce(unit_cost, 0) <> 0) then 'ok' else 'FAIL' end),
    ('entree : PAMP de l article D = 0', case when coalesce((select pamp from public.articles where id = cs.article_id), 0) = 0 then 'ok' else 'FAIL' end),
    ('entree : valeur du stock de la societe inchangee', case when _val_after = _val_before then 'ok' else 'FAIL ' || _val_before || ' -> ' || _val_after end),
    ('entree : deposant proprietaire courant', case when exists (select 1 from public.vehicle_owners where vehicle_id = v.id and contact_id = _dep and is_current) then 'ok' else 'FAIL' end),
    ('entree : check-list conservee', case when (cs.checklist->>'coc')::boolean then 'ok' else 'FAIL' end),
    ('entree : trace events', case when exists (select 1 from public.events where entity_type = 'consignments' and entity_id = _c::text and action = 'consignment_create') then 'ok' else 'FAIL' end);

  begin
    perform public.record_stock_move(cs.article_id, 'entree'::public.stock_move_type, 1, 100, false, null, 'screen', null, 'essai');
    insert into _t(check_name, result) values ('garde-fou : entree valorisee d un article D refusee', 'FAIL acceptee');
  exception when others then
    insert into _t(check_name, result) values ('garde-fou : entree valorisee d un article D refusee', case when sqlerrm like '%valorisation%' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
  begin
    perform public.consignment_create(_co, jsonb_build_object('depositor_id', _dep, 'vehicle_id', v.id, 'agreed_price', 7000));
    insert into _t(check_name, result) values ('entree : une moto deja en depot est refusee', 'FAIL acceptee');
  exception when others then
    insert into _t(check_name, result) values ('entree : une moto deja en depot est refusee', 'ok');
  end;

  -- ------------------------------------------------ vente sous le minimum : refusee sans accord
  begin
    perform public.consignment_sell(_c, jsonb_build_object('buyer_id', _buy, 'sale_price', 6000));
    insert into _t(check_name, result) values ('vente : sous le prix minimum sans accord refusee', 'FAIL acceptee');
  exception when others then
    insert into _t(check_name, result) values ('vente : sous le prix minimum sans accord refusee', case when sqlerrm like '%minimum%' then 'ok' else 'FAIL ' || sqlerrm end);
  end;

  -- ------------------------------------------------ vente
  r := public.consignment_sell(_c, jsonb_build_object('buyer_id', _buy, 'sale_price', 7000, 'fees', 150, 'repairs', 242,
         'buyer_invoice', true, 'commission_invoice', true, 'credit_note', false, 'expected_delivery_date', current_date + 7));
  select * into cs from public.consignments where id = _c;
  select * into v from public.vehicles where id = cs.vehicle_id;
  select coalesce(s.real_qty, 0) into _real from public.article_stock(cs.article_id) s;
  insert into _t(check_name, result) values
    ('vente : statut vendu, net 5 608', case when cs.status = 'vendu' and cs.sold_reversal = 5608 then 'ok' else 'FAIL ' || cs.status || ' ' || cs.sold_reversal end),
    ('vente : facture acheteur FAC 7 000, TVA 0 (deposant particulier)',
      case when (select doc_type = 'FAC' and status in ('validee', 'payee') and total_ttc = 7000 and total_vat = 0 and contact_id = _buy and number is not null
                   from public.documents where id = cs.sale_document_id) then 'ok' else 'FAIL ' || r::text end),
    ('vente : mention de la vente pour compte sur la facture', case when (select notes from public.documents where id = cs.sale_document_id) like '%' || cs.number || '%' then 'ok' else 'FAIL' end),
    ('vente : facture au deposant 1 392 TTC, TVA 241,58',
      case when (select total_ttc = 1392 and total_vat = 241.58 and contact_id = _dep from public.documents where id = cs.commission_document_id) then 'ok'
           else 'FAIL ' || (select total_ttc || ' / ' || total_vat from public.documents where id = cs.commission_document_id) end),
    ('vente : facture au deposant, 3 lignes a 21 %', case when (select count(*) from public.document_lines where document_id = cs.commission_document_id and vat_rate = 21) = 3 then 'ok' else 'FAIL' end),
    ('vente : facture au deposant reglee par retenue (DEP)', case when exists (select 1 from public.document_payments where document_id = cs.commission_document_id and method = 'DEP' and amount = 1392 and status = 'recu')
                                                               and (select status from public.documents where id = cs.commission_document_id) = 'payee' then 'ok' else 'FAIL' end),
    ('vente : moto vendue, stock 0', case when v.status::text = 'vendu' and _real = 0 then 'ok' else 'FAIL ' || v.status::text || ' ' || _real end),
    ('vente : acheteur proprietaire courant', case when exists (select 1 from public.vehicle_owners where vehicle_id = v.id and contact_id = _buy and is_current)
                                                 and not exists (select 1 from public.vehicle_owners where vehicle_id = v.id and contact_id = _dep and is_current) then 'ok' else 'FAIL' end),
    ('vente : valeur du stock toujours inchangee', case when public.stock_value_owned(_co) = _val_before then 'ok' else 'FAIL' end);

  begin
    perform public.consignment_sell(_c, jsonb_build_object('buyer_id', _buy, 'sale_price', 7000));
    insert into _t(check_name, result) values ('vente : second reglement refuse', 'FAIL accepte');
  exception when others then
    insert into _t(check_name, result) values ('vente : second reglement refuse', 'ok');
  end;

  -- ------------------------------------------------ versement au deposant
  perform public.consignment_pay_depositor(_c, 'VIR', 'Essai virement');
  select * into cs from public.consignments where id = _c;
  insert into _t(check_name, result) values
    ('versement : mouvement de caisse sortie 5 608 par virement',
      case when (select kind = 'out' and amount = 5608 and method = 'VIR' from public.cash_movements where id = cs.payout_cash_movement_id) then 'ok' else 'FAIL' end),
    ('versement : trace sur la fiche', case when cs.payout_at is not null and cs.payout_amount = 5608 and cs.payout_method = 'VIR' then 'ok' else 'FAIL' end);
  begin
    perform public.consignment_pay_depositor(_c, 'VIR', null);
    insert into _t(check_name, result) values ('versement : second versement refuse', 'FAIL accepte');
  exception when others then
    insert into _t(check_name, result) values ('versement : second versement refuse', 'ok');
  end;

  -- ------------------------------------------------ ecritures prevues : compte d entree depot equilibre
  select coalesce(sum(credit), 0), coalesce(sum(debit), 0) into _cred, _deb
    from public.consignment_accounting_entries e where e.consignment_id = _c and e.account_code = public._consignment_account(_co, 'deposit');
  insert into _t(check_name, result) values
    ('compta : compte d entree depot credite 7 000 (vente) / debite 1 392 + 5 608', case when _cred = 7000 and _deb = 7000 then 'ok' else 'FAIL credit ' || _cred || ' debit ' || _deb end),
    ('compta : commission HT au compte de commissions', case when exists (select 1 from public.consignment_accounting_entries e where e.consignment_id = _c and e.step = 'commission' and e.credit = 826.45) then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ retour client d un second depot
  _c2 := public.consignment_create(_co, jsonb_build_object(
    'depositor_id', _dep, 'depositor_kind', 'professionnel',
    'vehicle', jsonb_build_object('vin', 'ZDMTESTDEPOT00002', 'brand', 'Ducati', 'model', 'Scrambler'),
    'asked_price', 5000, 'agreed_price', 5600));
  r2 := public.consignment_return(_c2, 'Le deposant reprend sa moto', 50);
  select * into cs2 from public.consignments where id = _c2;
  select * into v from public.vehicles where id = cs2.vehicle_id;
  select coalesce(s.real_qty, 0) into _real from public.article_stock(cs2.article_id) s;
  insert into _t(check_name, result) values
    ('retour : statut restitue, motif et frais traces', case when cs2.status = 'restitue' and cs2.return_reason is not null and cs2.return_fee = 50 then 'ok' else 'FAIL' end),
    ('retour : moto de client (vendu sans article), deposant proprietaire',
      case when v.status::text = 'vendu' and v.article_id is null and exists (select 1 from public.vehicle_owners where vehicle_id = v.id and contact_id = _dep and is_current) then 'ok' else 'FAIL ' || v.status::text end),
    ('retour : stock de l article D a 0', case when _real = 0 then 'ok' else 'FAIL ' || _real end),
    ('retour : facture des frais 50 TTC au deposant', case when (select total_ttc = 50 and contact_id = _dep from public.documents where id = cs2.return_document_id) then 'ok' else 'FAIL' end);
  begin
    perform public.consignment_sell(_c2, jsonb_build_object('buyer_id', _buy, 'sale_price', 5600));
    insert into _t(check_name, result) values ('retour : un depot rendu ne se vend plus', 'FAIL accepte');
  exception when others then
    insert into _t(check_name, result) values ('retour : un depot rendu ne se vend plus', 'ok');
  end;
end $s$;

select n, check_name, result from _t order by n;
