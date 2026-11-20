-- =====================================================================
-- Parcours G8 n° 17 — Réservation → bon de livraison → facture par « Génération des factures par BL »
-- (lot-verif-parcours, 20/11/2026).
-- G8 : Ventes › Livraison B.L. → client → Documents en attente → Rappeler la réservation 3000003 →
--      « Choisissez votre document » Livraison → LIVRAISON 4000000 (compteur propre) ; Utilitaires factures ›
--      Génération des factures par B.L. client → Valider → FACTURE 22701460 (en-tête « LIVRAISON N°4000000
--      DU 18/11/2026 ») ; réservation libérée, stock réel −1 une seule fois (à la facture).
-- DMS : fiche de la réservation → bouton « BL » → `convertDocument(RES, 'BL')` (write-api.ts) : BL validé
--       (`createDocument` → `document_assign_number` → réservation +1 réf. BL), acompte reporté
--       (`addPayments` avec `transferred_from`), `liberateReservation(RES)` (−1 réservé), RES « converti » ;
--       Ventes → Facturation des BL (`_app.sales.bl-invoicing.tsx` → `invoiceDeliveryNotes`,
--       bl-invoicing-api.ts) : une facture par groupe (en-tête texte « LIVRAISON N° … DU … » + lignes du BL),
--       `createDocument` FAC (sortie −1), `transferReceivedPayments` (acompte), `liberateReservation(BL)`,
--       BL « converti », filiation `document_sources` (kind bl_grouping).
-- Société ItalTest, utilisateur simon@themaul.be (admin). Transaction annulée : rien ne reste en base.
-- Client et article (5 en stock à 0,80) créés par l'essai. Acompte de 0,50 par carte sur la réservation.
-- Contrôles :
--   1 réservation : réservé 1, réel 5 ; 2 BL n° = suivant de la série BL ; 3 BL : réservé toujours 1 (la
--   réservation passe de la RES au BL), réel 5 ; 4 réservation « convertie » ; 5 acompte reporté sur le BL
--   (hors caisse) ; 6 BL proposé à la facturation des BL ; 7 facture n° = suivant de la série (FAC ou VEN) ;
--   8 en-tête « LIVRAISON N° <BL> DU <date> » puis la ligne du BL, total 1,74 ; 9 acompte repris : réglé
--   0,50, dû 1,24 ; 10 stock réel −1 UNE SEULE FOIS (5 → 4), réservé 0 ; 11 historique : RES +1, BL +1,
--   libérations −1 / −1, une seule sortie (réf. facture) ; 12 BL « converti », filiation bl_grouping ;
--   13 PAMP inchangé ; 14 facture chez les débiteurs (1,24) ;
--   15-17 regroupement (G8 « Regroupement de B.L. ») : 2 BL du même client → UNE facture (2 en-têtes,
--   2 lignes, 3,48), 2 filiations, réel −2 et réservé 0.
-- Chaque ligne du résultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- Numéro que la base donnera au prochain document du type (même règle que _next_document_number_unchecked).
create or replace function pg_temp.b1_next_number(_co uuid, _type text) returns text language plpgsql as $f$
declare _key text := _type; s public.document_sequences%rowtype; n bigint;
        y int := extract(year from (now() at time zone 'Europe/Brussels'))::int;
begin
  if _type in ('FAC', 'TIK', 'AVO')
     and coalesce((select sales_mode from public.numbering_settings where company_id = _co), 'separate') = 'single' then
    _key := 'VEN';
  end if;
  select * into s from public.document_sequences where company_id = _co and doc_type = _key;
  if not found then return null; end if;
  n := case when s.reset_yearly and s.current_year is distinct from y then 1 else s.next_value end;
  return s.prefix || s.separator || case when s.reset_yearly then y::text || s.separator else '' end
      || case when length(n::text) >= s.padding then n::text else lpad(n::text, s.padding, '0') end || coalesce(s.suffix, '');
end $f$;
grant execute on function pg_temp.b1_next_number(uuid, text) to authenticated;

-- createDocument validé (RES / BL / FAC) d'une ligne article, avec le mouvement de recordSaleStockMoves.
create or replace function pg_temp.b1_doc(_co uuid, _type text, _cli uuid, _art uuid, _source uuid) returns uuid language plpgsql as $f$
declare _doc uuid; _num text;
begin
  insert into public.documents (company_id, number, status, source_document_id, doc_type, contact_id, vehicle_id, issue_date, due_date, notes,
                                total_ht, total_vat, total_ttc, price_mode, tax_exempt, global_discount_pct, global_discount_amount,
                                shipping_ht, shipping_taxed, shipping_vat_rate, forced_ttc)
  values (_co, null, 'brouillon', _source, _type, _cli, null, (now() at time zone 'Europe/Brussels')::date, null, null,
          1.44, 0.30, 1.74, 'ttc', false, 0, 0, 0, true, 21, null)
  returning id into _doc;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  select _doc, _art, a.designation, a.reference, 'article', 1, 1.44, 21, 0, 1.44, 1.74, 0 from public.articles a where a.id = _art;
  _num := public.document_assign_number(_doc);
  if _type in ('RES', 'BL') then perform public.record_stock_move(_art, 'reservation', 1, null, true, null, 'sale', _num, null);
  elsif _type in ('FAC', 'TIK') then perform public.record_stock_move(_art, 'sortie', -1, null, false, null, 'sale', _num, null);
  end if;
  return _doc;
end $f$;
grant execute on function pg_temp.b1_doc(uuid, text, uuid, uuid, uuid) to authenticated;

-- liberateReservation (write-api.ts) : un mouvement de libération par ligne article d'une RES / d'un BL.
create or replace function pg_temp.b1_liberate(_doc uuid) returns void language plpgsql as $f$
declare l record; d record;
begin
  select * into d from public.documents where id = _doc;
  if d.doc_type not in ('RES', 'BL') then return; end if;
  for l in select * from public.document_lines where document_id = _doc and line_type = 'article' and article_id is not null and quantity > 0 loop
    perform public.record_stock_move(l.article_id, 'liberation', -abs(l.quantity), null, true, null, 'sale', d.number, 'Libération réservation');
  end loop;
end $f$;
grant execute on function pg_temp.b1_liberate(uuid) to authenticated;

-- Report des règlements perçus (convertDocument / transferReceivedPayments).
create or replace function pg_temp.b1_transfer(_src uuid, _dst uuid) returns void language plpgsql as $f$
declare p record; d record;
begin
  select * into d from public.documents where id = _src;
  for p in select * from public.document_payments where document_id = _src and status = 'recu' and amount <> 0 order by paid_at loop
    insert into public.document_payments (document_id, method, amount, status, note, from_financing, transferred_from)
    values (_dst, p.method, p.amount, 'recu', trim('Acompte reporté ' || d.doc_type || ' ' || coalesce(d.number, '')), p.from_financing, p.id);
  end loop;
  perform public.recompute_document_paid(_dst);
end $f$;
grant execute on function pg_temp.b1_transfer(uuid, uuid) to authenticated;

-- invoiceDeliveryNotes (bl-invoicing-api.ts) pour un groupe de BL : renvoie l'id de la facture.
create or replace function pg_temp.b1_invoice_bls(_co uuid, _bls uuid[]) returns uuid language plpgsql as $f$
declare _inv uuid; _num text; b record; l record; _i int := 0; _ht numeric; _vat numeric; _first record;
begin
  select * into _first from public.documents where id = _bls[1];
  -- Totaux calculés avant l'écriture (computeTotals) : TVA = somme des TVA des lignes, TTC = HT + TVA.
  select round(sum(line_ht), 2), round(sum(line_ht * vat_rate / 100), 2) into _ht, _vat from public.document_lines where document_id = any (_bls);
  insert into public.documents (company_id, number, status, source_document_id, doc_type, contact_id, vehicle_id, issue_date, due_date, notes,
                                total_ht, total_vat, total_ttc, price_mode, tax_exempt, global_discount_pct, global_discount_amount,
                                shipping_ht, shipping_taxed, shipping_vat_rate, forced_ttc)
  values (_co, null, 'brouillon', case when array_length(_bls, 1) = 1 then _first.id end, 'FAC', _first.contact_id,
          case when array_length(_bls, 1) = 1 then _first.vehicle_id end, (now() at time zone 'Europe/Brussels')::date, _first.due_date,
          case when array_length(_bls, 1) = 1 then _first.notes end, _ht, _vat, _ht + _vat, 'ttc', _first.tax_exempt, 0, 0, 0, true, 21, null)
  returning id into _inv;
  for b in select * from public.documents where id = any (_bls) order by issue_date, number loop
    insert into public.document_lines (document_id, article_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
    values (_inv, null, 'LIVRAISON N° ' || b.number || ' DU ' || to_char(b.issue_date, 'DD/MM/YYYY'), 'texte', 0, 0, 0, 0, 0, 0, _i);
    _i := _i + 1;
    for l in select * from public.document_lines where document_id = b.id order by sort_order loop
      insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
      values (_inv, l.article_id, l.designation, l.reference, l.line_type, l.quantity, l.unit_price_ht, l.vat_rate, l.discount_pct, l.line_ht, l.line_ttc, _i);
      _i := _i + 1;
    end loop;
  end loop;
  _num := public.document_assign_number(_inv);
  for l in select * from public.document_lines where document_id = _inv and line_type = 'article' and article_id is not null and quantity > 0 loop
    perform public.record_stock_move(l.article_id, 'sortie', -l.quantity, null, false, null, 'sale', _num, null);
  end loop;
  for b in select * from public.documents where id = any (_bls) loop
    perform pg_temp.b1_transfer(b.id, _inv);
    perform pg_temp.b1_liberate(b.id);
    update public.documents set status = 'converti' where id = b.id;
  end loop;
  insert into public.document_sources (company_id, document_id, source_document_id, kind)
  select _co, _inv, x, 'bl_grouping' from unnest(_bls) x;
  return _inv;
end $f$;
grant execute on function pg_temp.b1_invoice_bls(uuid, uuid[]) to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _uid uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _today date := (now() at time zone 'Europe/Brussels')::date;
  _cli uuid; _art uuid; _art2 uuid; _res uuid; _bl uuid; _inv uuid; _bl1 uuid; _bl2 uuid; _inv2 uuid;
  _expbl text; _expfac text; _d record; _b record; _st record; _lines text; _moves text; _n int;
begin
  insert into public.contacts (company_id, civility, type, last_name, first_name) values (_co, 'Monsieur', 'particulier', 'ESSAI B1', 'Livraison') returning id into _cli;
  insert into public.articles (company_id, reference, designation, mgmt_type, sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'ESSAIB1-17-' || substr(md5(random()::text), 1, 6), 'ESSAI B1 manchon caoutchouc', 'A', 1.44, 1.74, 21) returning id into _art;
  perform public.record_stock_move(_art, 'entree', 5, 0.80, false, null, 'reception', 'ESSAI-B1', 'stock de depart de l essai');

  -- ------------------------------------------------ réservation + acompte 0,50 (parcours 7)
  _res := pg_temp.b1_doc(_co, 'RES', _cli, _art, null);
  insert into public.document_payments (document_id, method, amount, status, from_financing) values (_res, 'MAE', 0.50, 'recu', false);
  perform public.recompute_document_paid(_res);
  select * into _st from public.article_stock(_art);
  insert into _t(check_name, result) values ('1 reservation : reserve 1, reel 5', case when _st.reserved_qty = 1 and _st.real_qty = 5 then 'ok' else 'KO ' || _st.real_qty || '/' || _st.reserved_qty end);

  -- ------------------------------------------------ convertDocument(RES, 'BL')
  _expbl := pg_temp.b1_next_number(_co, 'BL');
  _bl := pg_temp.b1_doc(_co, 'BL', _cli, _art, _res);
  perform pg_temp.b1_transfer(_res, _bl);
  perform pg_temp.b1_liberate(_res);
  update public.documents set status = 'converti' where id = _res;

  select * into _b from public.documents where id = _bl;
  select * into _st from public.article_stock(_art);
  insert into _t(check_name, result) values
    ('2 BL ' || coalesce(_b.number, '?') || ' = suivant de la serie BL', case when _b.number = _expbl and _b.source_document_id = _res then 'ok' else 'KO ' || coalesce(_b.number, 'null') end),
    ('3 BL : reserve toujours 1 (passe de la RES au BL), reel 5', case when _st.reserved_qty = 1 and _st.real_qty = 5 then 'ok' else 'KO ' || _st.real_qty || '/' || _st.reserved_qty end),
    ('4 reservation convertie', case when (select status from public.documents where id = _res) = 'converti' then 'ok' else 'KO' end),
    ('5 acompte 0,50 reporte sur le BL, hors caisse',
      case when _b.paid_amount = 0.50 and exists (select 1 from public.document_payments where document_id = _bl and transferred_from is not null and cash_session_id is null) then 'ok' else 'KO ' || _b.paid_amount end),
    ('6 BL propose a la facturation des BL (valide, non facture, client)',
      case when exists (select 1 from public.documents where company_id = _co and doc_type = 'BL' and status in ('validee', 'payee') and contact_id = _cli and id = _bl) then 'ok' else 'KO ' || _b.status end);

  -- ------------------------------------------------ Facturation des BL (une facture par BL)
  _expfac := pg_temp.b1_next_number(_co, 'FAC');
  _inv := pg_temp.b1_invoice_bls(_co, array[_bl]);
  select * into _d from public.documents where id = _inv;
  select string_agg(line_type || ':' || designation, ' | ' order by sort_order) into _lines from public.document_lines where document_id = _inv;
  select * into _st from public.article_stock(_art);
  select string_agg(move_type || ' ' || qty_delta::int || ' ' || coalesce(ref, ''), ', ' order by id) into _moves
    from public.stock_moves where article_id = _art and origin = 'sale';
  insert into _t(check_name, result) values
    ('7 facture ' || coalesce(_d.number, '?') || ' = suivant de la serie (' || coalesce(_expfac, '?') || ')', case when _d.number = _expfac and _d.status in ('validee', 'payee') then 'ok' else 'KO ' || coalesce(_d.number, 'null') end),
    ('8 en-tete LIVRAISON N <BL> DU <date> puis la ligne, total 1,74',
      case when _lines = 'texte:LIVRAISON N° ' || _b.number || ' DU ' || to_char(_b.issue_date, 'DD/MM/YYYY') || ' | article:ESSAI B1 manchon caoutchouc'
             and _d.total_ttc = 1.74 and _d.total_ht = 1.44 then 'ok' else 'KO ' || coalesce(_lines, '') end),
    ('9 acompte repris sur la facture : regle 0,50, du 1,24', case when _d.paid_amount = 0.50 and _d.total_ttc - _d.paid_amount = 1.24 and _d.status = 'validee' then 'ok' else 'KO ' || _d.paid_amount end),
    ('10 stock reel -1 UNE SEULE FOIS (5 -> 4), reserve 0', case when _st.real_qty = 4 and _st.reserved_qty = 0 then 'ok' else 'KO ' || _st.real_qty || '/' || _st.reserved_qty end),
    ('11 historique : RES +1, BL +1, liberations, une seule sortie (ref facture)',
      case when (select count(*) from public.stock_moves where article_id = _art and origin = 'sale' and not is_reservation) = 1
             and (select ref from public.stock_moves where article_id = _art and origin = 'sale' and not is_reservation) = _d.number
             and (select count(*) from public.stock_moves where article_id = _art and move_type = 'reservation') = 2
             and (select count(*) from public.stock_moves where article_id = _art and move_type = 'liberation') = 2
           then 'ok' else 'KO ' || coalesce(_moves, '') end),
    ('12 BL converti, filiation facture <- BL (bl_grouping)',
      case when (select status from public.documents where id = _bl) = 'converti' and _d.source_document_id = _bl
             and exists (select 1 from public.document_sources where document_id = _inv and source_document_id = _bl and kind = 'bl_grouping') then 'ok' else 'KO' end),
    ('13 PAMP inchange (0,80)', case when (select pamp from public.articles where id = _art) = 0.80 then 'ok' else 'KO' end),
    ('14 facture chez les debiteurs, du 1,24',
      case when exists (select 1 from public.debtors_detailed(_co, null, null, _today + 60, _cli) x where x.document_id = _inv and x.amount_due = 1.24) then 'ok' else 'KO' end);

  -- ------------------------------------------------ Regroupement : 2 BL du même client → une facture
  insert into public.articles (company_id, reference, designation, mgmt_type, sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'ESSAIB1-17B-' || substr(md5(random()::text), 1, 6), 'ESSAI B1 manchon caoutchouc', 'A', 1.44, 1.74, 21) returning id into _art2;
  perform public.record_stock_move(_art2, 'entree', 5, 0.80, false, null, 'reception', 'ESSAI-B1', 'stock de depart de l essai');
  _bl1 := pg_temp.b1_doc(_co, 'BL', _cli, _art2, null);
  _bl2 := pg_temp.b1_doc(_co, 'BL', _cli, _art2, null);
  _inv2 := pg_temp.b1_invoice_bls(_co, array[_bl1, _bl2]);
  select * into _d from public.documents where id = _inv2;
  select * into _st from public.article_stock(_art2);
  insert into _t(check_name, result) values
    ('15 regroupement : 2 BL -> une facture ' || coalesce(_d.number, '?') || ' (2 en-tetes, 2 lignes, 3,48)',
      case when _d.total_ttc = 3.48 and (select count(*) from public.document_lines where document_id = _inv2 and line_type = 'texte' and designation like 'LIVRAISON N° %') = 2
             and (select count(*) from public.document_lines where document_id = _inv2 and line_type = 'article') = 2 then 'ok' else 'KO ' || _d.total_ttc end),
    ('16 regroupement : 2 filiations, BL convertis',
      case when (select count(*) from public.document_sources where document_id = _inv2 and kind = 'bl_grouping') = 2
             and (select count(*) from public.documents where id in (_bl1, _bl2) and status = 'converti') = 2 then 'ok' else 'KO' end),
    ('17 regroupement : reel -2, reserve 0', case when _st.real_qty = 3 and _st.reserved_qty = 0 then 'ok' else 'KO ' || _st.real_qty || '/' || _st.reserved_qty end);
end $s$;

select n, check_name, result from _t order by n;
