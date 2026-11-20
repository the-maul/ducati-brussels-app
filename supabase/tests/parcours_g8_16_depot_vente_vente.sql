-- =====================================================================
-- Parcours G8 n° 16 (lot-verif-parcours, 20/11/2026) — Dépôt-vente : vente.
-- G8 joué (parcours.md n° 16, 03-vehicules.md « Vente d'un dépôt-vente ») : Vente d'un dépôt vente
--   → Vendre → client acquéreur → opérateur → Valider → « Règlement dépôt vente » : mouvement de
--   caisse 02 « Encaissement dépôt V », virement, 7 000 € → le dépôt sort de la liste, la cession
--   de la moto est archivée.
-- Décision Q30 (a-trancher.md) : « parcours complet » dans le DMS = vente en une transaction
--   (consignment_sell, migration 20261118270000) : facture à l'acquéreur, facture au déposant
--   (commission + frais + réparations, TVA 21 %, réglée par retenue), décompte, puis versement au
--   déposant (consignment_pay_depositor). Le chemin G8 littéral (sans facture acquéreur,
--   encaissement 02) reste possible par le réglage « buyer_invoice = non » / la case de l'écran.
-- Chemin DMS rejoué comme l'écran : Véhicules › Dépôt-vente › Vendre (consignment-sale-dialog.tsx →
--   sellConsignment = RPC consignment_sell), règlement de la facture acquéreur (document_payments +
--   recompute_document_paid, comme le règlement par retenue), Verser au déposant (payDepositor).
-- Société de test ItalTest, administrateur simon@themaul.be, transaction annulée (rt.py).
-- Contrôles — A. parcours complet (Q30), dépôt 6 000 / 7 000 :
--   1. refus : sans acquéreur ; acquéreur = déposant ; sous le prix minimum sans accord ;
--   2. dépôt « vendu », acquéreur, prix 7 000, reversement 6 000, date de livraison prévue ;
--   3. facture acquéreur 7 000 TTC, TVA 0 (déposant particulier), mention « vente pour compte » ;
--   4. facture au déposant : commission 1 000 TTC (826,45 HT + 173,55 TVA 21 %), réglée par
--      retenue (DEP), « payée » ; numéros FAC qui se suivent ;
--   5. moto vendue, acquéreur propriétaire courant, déposant plus propriétaire ;
--   6. stock de l'article D à 0 par une sortie −1 tracée (origine vente, n° de facture, opérateur) ;
--      valeur du stock de la société inchangée ;
--   7. cession ouverte sur la moto archivée automatiquement à la vente (motif « vente ») ;
--   8. registre des véhicules : sortie à la date de vente avec la facture ;
--   9. le dépôt sort de la liste « en dépôt » ; second règlement refusé ;
--  10. encaissement de la facture acquéreur par virement 7 000 : facture « payée » ;
--  11. versement au déposant : mouvement de caisse 03 « décaissement dépôt » 6 000 par virement ;
--      second versement refusé ;
--  12. écritures prévues : compte d'entrée dépôt équilibré (7 000 crédit / 1 000 + 6 000 débit) ;
--  13. trace events consignment_sell.
-- B. chemin G8 littéral (sans facture acquéreur) :
--  14. mouvement de caisse 02 « encaissement dépôt-vente » 7 000 par virement, sans facture ;
--  15. moto vendue, acquéreur propriétaire, stock 0, dépôt « vendu ».
-- Chaque ligne du résultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _tag text := to_char(clock_timestamp(), 'HH24MISSUS');
  _dep uuid; _buy uuid; _c uuid; _c2 uuid; _ces uuid; _val0 numeric; _real numeric; _err text; _cred numeric; _deb numeric;
  r jsonb; cs record; v record; fs record; fc record; m record; reg record; mv record; ce record;
begin
  insert into public.contacts (company_id, type, status, civility, first_name, last_name, zip, city, country)
  values (_co, 'particulier', 'client', 'M', 'Marc', 'DEPOSANT P16', '1180', 'Uccle', 'BE') returning id into _dep;
  insert into public.contacts (company_id, type, status, civility, first_name, last_name, zip, city, country)
  values (_co, 'particulier', 'prospect', 'M', 'Luc', 'ACQUEREUR P16', '1000', 'Bruxelles', 'BE') returning id into _buy;

  -- Depot (parcours 15) : prix demande 6 000, PV 7 000, minimum 6 500
  _c := public.consignment_create(_co, jsonb_build_object('depositor_id', _dep, 'depositor_kind', 'particulier',
          'vehicle', jsonb_build_object('vin', 'ZDMP16A' || _tag, 'brand', 'Ducati', 'model', 'Monster 937'),
          'asked_price', 6000, 'agreed_price', 7000, 'min_price', 6500, 'commission_mode', 'ecart', 'deposit_fee', 0));
  select * into cs from public.consignments where id = _c;
  -- Cession ouverte sur la moto pendant le depot (preparation) : doit etre archivee a la vente (G8)
  _ces := public.open_internal_cession(_co, '01', cs.vehicle_id, null, null, 'Preparation a la vente', null);
  _val0 := public.stock_value_owned(_co);

  -- ------------------------------------------------ A1. refus
  begin
    perform public.consignment_sell(_c, jsonb_build_object('sale_price', 7000));
    insert into _t(check_name, result) values ('refus : vente sans acquereur', 'KO acceptee');
  exception when others then insert into _t(check_name, result) values ('refus : vente sans acquereur', 'ok'); end;
  begin
    perform public.consignment_sell(_c, jsonb_build_object('buyer_id', _dep, 'sale_price', 7000));
    insert into _t(check_name, result) values ('refus : acquereur = deposant', 'KO acceptee');
  exception when others then insert into _t(check_name, result) values ('refus : acquereur = deposant', 'ok'); end;
  begin
    perform public.consignment_sell(_c, jsonb_build_object('buyer_id', _buy, 'sale_price', 6200));
    insert into _t(check_name, result) values ('refus : sous le prix minimum sans accord du deposant', 'KO acceptee');
  exception when others then
    insert into _t(check_name, result) values ('refus : sous le prix minimum sans accord du deposant', case when sqlerrm like '%minimum%' then 'ok' else 'KO ' || sqlerrm end);
  end;

  -- ------------------------------------------------ A2. vente (payload de l'ecran, reglages par defaut)
  r := public.consignment_sell(_c, jsonb_build_object('buyer_id', _buy, 'sale_price', 7000, 'fees', 0, 'repairs', 0,
         'expected_delivery_date', (current_date + 3)::text, 'force_below_min', false,
         'buyer_invoice', true, 'commission_invoice', true, 'credit_note', false, 'receipt_method', null));
  select * into cs from public.consignments where id = _c;
  select * into v from public.vehicles where id = cs.vehicle_id;
  select * into fs from public.documents where id = cs.sale_document_id;
  select * into fc from public.documents where id = cs.commission_document_id;
  insert into _t(check_name, result) values
    ('depot vendu : acquereur, 7 000, reversement 6 000, livraison prevue J+3',
     case when cs.status = 'vendu' and cs.buyer_id = _buy and cs.sold_price = 7000 and cs.sold_reversal = 6000
               and cs.expected_delivery_date = current_date + 3 then 'ok' else 'KO ' || cs.status || ' ' || coalesce(cs.sold_reversal::text, '?') end),
    ('facture acquereur ' || coalesce(fs.number, '?') || ' : 7 000 TTC, TVA 0 (deposant particulier), mention vente pour compte',
     case when fs.doc_type = 'FAC' and fs.status in ('validee', 'payee') and fs.total_ttc = 7000 and fs.total_vat = 0
               and fs.contact_id = _buy and fs.notes like '%' || cs.number || '%' then 'ok' else 'KO ' || coalesce(fs.total_ttc::text, 'aucune') end),
    ('facture deposant ' || coalesce(fc.number, '?') || ' : commission 1 000 TTC (826,45 + 173,55), retenue DEP, payee',
     case when fc.total_ttc = 1000 and fc.total_ht = 826.45 and fc.total_vat = 173.55 and fc.contact_id = _dep and fc.status = 'payee'
               and exists (select 1 from public.document_payments p where p.document_id = fc.id and p.method = 'DEP' and p.amount = 1000)
          then 'ok' else 'KO ' || coalesce(fc.total_ttc::text, 'aucune') || ' ' || coalesce(fc.status, '') end),
    ('numeros FAC qui se suivent (' || coalesce(fs.number, '?') || ' puis ' || coalesce(fc.number, '?') || ')',
     case when substring(fc.number from '([0-9]+)$')::bigint = substring(fs.number from '([0-9]+)$')::bigint + 1
               and regexp_replace(fc.number, '[0-9]+$', '') = regexp_replace(fs.number, '[0-9]+$', '') then 'ok' else 'KO' end),
    ('moto vendue, acquereur proprietaire courant, deposant plus proprietaire',
     case when v.status::text = 'vendu'
               and exists (select 1 from public.vehicle_owners where vehicle_id = v.id and contact_id = _buy and is_current)
               and not exists (select 1 from public.vehicle_owners where vehicle_id = v.id and contact_id = _dep and is_current) then 'ok' else 'KO ' || v.status::text end);

  select coalesce(s.real_qty, 0) into _real from public.article_stock(cs.article_id) s;
  select * into m from public.stock_moves where article_id = cs.article_id order by occurred_at desc, id desc limit 1;
  insert into _t(check_name, result) values
    ('stock article D 0 : sortie -1 origine vente, n° facture, operateur ; valeur du stock inchangee',
     case when _real = 0 and m.qty_delta = -1 and m.origin = 'sale' and m.ref = fs.number and m.operator_id = auth.uid()
               and public.stock_value_owned(_co) = _val0 then 'ok' else 'KO ' || _real || ' ' || coalesce(m.origin, '?') end);

  select * into ce from public.internal_cessions where id = _ces;
  insert into _t(check_name, result) values
    ('cession de la moto archivee automatiquement a la vente', case when ce.status = 'archive' and ce.archive_reason = 'vente' then 'ok' else 'KO ' || ce.status end);

  select * into reg from public.vehicle_register where vehicle_id = v.id and source = 'depot' order by created_at desc limit 1;
  insert into _t(check_name, result) values
    ('registre : sortie a la date de vente avec la facture',
     case when reg.left_at = current_date and (reg.invoice_document_id = fs.id or reg.invoice_ref = fs.number) then 'ok'
          else 'KO ' || coalesce(reg.left_at::text, 'pas de sortie') end),
    ('le depot sort de la liste « en depot »', case when not exists (select 1 from public.consignments where id = _c and status = 'en_depot') then 'ok' else 'KO' end);
  begin
    perform public.consignment_sell(_c, jsonb_build_object('buyer_id', _buy, 'sale_price', 7000));
    insert into _t(check_name, result) values ('second reglement refuse', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('second reglement refuse', 'ok'); end;

  -- ------------------------------------------------ A10. encaissement de la facture acquereur (virement)
  insert into public.document_payments (document_id, method, amount, status, note)
  values (fs.id, 'VIR', 7000, 'recu', 'Essai parcours 16 : virement de l acquereur');
  perform public.recompute_document_paid(fs.id);
  insert into _t(check_name, result) values
    ('encaissement acquereur : virement 7 000, facture payee',
     case when (select status = 'payee' and paid_amount = 7000 from public.documents where id = fs.id) then 'ok'
          else 'KO ' || (select status || ' ' || paid_amount from public.documents where id = fs.id) end);

  -- ------------------------------------------------ A11. versement au deposant
  perform public.consignment_pay_depositor(_c, 'VIR', 'Essai virement P16');
  select * into cs from public.consignments where id = _c;
  select * into mv from public.cash_movements where id = cs.payout_cash_movement_id;
  insert into _t(check_name, result) values
    ('versement : mouvement de caisse 03 decaissement depot, 6 000, virement',
     case when mv.kind = 'out' and mv.amount = 6000 and mv.method = 'VIR' and mv.type_code = '03' and cs.payout_amount = 6000 then 'ok'
          else 'KO ' || coalesce(mv.kind, 'aucun') || ' ' || coalesce(mv.type_code, '-') end);
  begin
    perform public.consignment_pay_depositor(_c, 'VIR', null);
    insert into _t(check_name, result) values ('second versement refuse', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('second versement refuse', 'ok'); end;

  select coalesce(sum(credit), 0), coalesce(sum(debit), 0) into _cred, _deb
    from public.consignment_accounting_entries e where e.consignment_id = _c and e.account_code = public._consignment_account(_co, 'deposit');
  insert into _t(check_name, result) values
    ('ecritures : compte d entree depot credite 7 000 / debite 1 000 + 6 000', case when _cred = 7000 and _deb = 7000 then 'ok' else 'KO credit ' || _cred || ' debit ' || _deb end),
    ('trace events consignment_sell', case when exists (select 1 from public.events where entity_type = 'consignments' and entity_id = _c::text and action = 'consignment_sell') then 'ok' else 'KO' end);

  -- ------------------------------------------------ B. chemin G8 litteral : encaissement 02, sans facture
  _c2 := public.consignment_create(_co, jsonb_build_object('depositor_id', _dep, 'depositor_kind', 'particulier',
           'vehicle', jsonb_build_object('vin', 'ZDMP16B' || _tag, 'brand', 'Ducati', 'model', 'Scrambler Icon'),
           'asked_price', 6000, 'agreed_price', 7000, 'min_price', 0));
  r := public.consignment_sell(_c2, jsonb_build_object('buyer_id', _buy, 'sale_price', 7000, 'fees', 0, 'repairs', 0,
         'buyer_invoice', false, 'commission_invoice', false, 'credit_note', false, 'receipt_method', 'VIR'));
  select * into cs from public.consignments where id = _c2;
  select * into mv from public.cash_movements where id = cs.receipt_cash_movement_id;
  select * into v from public.vehicles where id = cs.vehicle_id;
  select coalesce(s.real_qty, 0) into _real from public.article_stock(cs.article_id) s;
  insert into _t(check_name, result) values
    ('G8 : mouvement de caisse 02 encaissement depot-vente 7 000 par virement, sans facture',
     case when mv.kind = 'in' and mv.amount = 7000 and mv.method = 'VIR' and mv.type_code = '02' and mv.reason like '%' || cs.number || '%'
               and cs.sale_document_id is null then 'ok' else 'KO ' || coalesce(mv.kind, 'aucun') end),
    ('G8 : moto vendue, acquereur proprietaire, stock 0, depot vendu',
     case when v.status::text = 'vendu' and _real = 0 and cs.status = 'vendu'
               and exists (select 1 from public.vehicle_owners where vehicle_id = v.id and contact_id = _buy and is_current) then 'ok' else 'KO ' || v.status::text end);
end $s$;

select n, check_name, result from _t order by n;
