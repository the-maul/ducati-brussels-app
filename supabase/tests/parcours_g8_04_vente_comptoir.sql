-- =====================================================================
-- Parcours G8 n° 4 — Vente comptoir Express (lot-verif-parcours, 20/11/2026).
-- G8 : Ventes › Express → opérateur → réf. 000017847 (1,74 €) → Valider → Espèces → Valider sans éditer
--      → EXPRESS 22701456, 1,74 € en espèces, stock −1 (Historique mouvements : « Facture n°… »).
-- DMS : Caisse `/pos` (pos-sale.tsx) → `createDocument` TIK (write-api.ts) : en-tête brouillon sans
--       numéro → lignes → `document_invoice_required` → `document_assign_number` → `record_stock_move`
--       (sortie, origine sale, réf. = n° du ticket) ; règlement (payment-panel.tsx) : `applyCashRounding`
--       (arrondi légal 5 cents) → `addPayments` → `recompute_document_paid`.
-- Société ItalTest, utilisateur simon@themaul.be (admin). Transaction annulée : rien ne reste en base.
-- Caisse : reprise si une caisse est déjà ouverte dans ItalTest, sinon ouverte dans l'essai.
-- Article et stock de départ créés par l'essai (5 pièces à 0,80 € → PAMP 0,80).
-- Numéro contrôlé « suivant de celui d'avant » dans la série qui s'applique (série TIK, ou compteur
-- unique VEN si ItalTest est réglée en mode G8) ; le mode G8 est joué de bout en bout dans l'essai 06.
-- Contrôles :
--   1 caisse ouverte (reprise ou ouverte) ; 2 facture non imposée (1,74 € sans véhicule) ;
--   3 n° du ticket = suivant de la série ; 4 série avancée d'un cran ; 5 totaux HT/TVA/TTC 1,44/0,30/1,74 ;
--   6 ticket rattaché à la session ; 7 espèces 1,75 + arrondi −0,01 rattachés à la session ;
--   8 ticket payé, réglé 1,74, dû 0 ; 9 stock réel 5 → 4, réservé 0 ; 10 mouvement (sortie −1, origine,
--   réf., opérateur, ancien 5 / nouveau 4) ; 11 PAMP inchangé 0,80 ; 12 coût de la ligne = PAMP (marge B5) ;
--   13 opérateur du ticket = utilisateur ; 14 traces events (création + validation) ; 15 tiroir +1,75 ;
--   16 ticket au journal des ventes ; 17 vente d'un article à stock 0 autorisée (stock −1, G8).
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

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _uid uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _today date := (now() at time zone 'Europe/Brussels')::date;
  _sess uuid; _reused boolean := true; _art uuid; _art0 uuid; _doc uuid; _doc0 uuid;
  _exp text; _num text; _why text; _d record; _m record; _st record; _before numeric; _drawer0 numeric; _x numeric; _n int;
begin
  -- ------------------------------------------------ caisse ouverte (reprise ou ouverture, cash-api.openSession)
  select id into _sess from public.cash_sessions where company_id = _co and status = 'open' order by opened_at desc limit 1;
  if _sess is null then
    _reused := false;
    insert into public.cash_sessions (company_id, opening_float, opened_by, note)
    values (_co, 100, auth.uid(), 'ESSAI parcours G8 04 (transaction annulee)') returning id into _sess;
  end if;
  insert into _t(check_name, result) values ('1 caisse ouverte (' || case when _reused then 'reprise' else 'ouverte par l essai' end || ')',
    case when (select status from public.cash_sessions where id = _sess) = 'open' then 'ok' else 'KO' end);
  _drawer0 := public.cash_drawer_balance(_co);

  -- ------------------------------------------------ article de l'essai : 5 en stock à 0,80 (PAMP 0,80)
  insert into public.articles (company_id, reference, designation, mgmt_type, sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'ESSAIB1-04-' || substr(md5(random()::text), 1, 6), 'ESSAI B1 manchon caoutchouc', 'A', 1.44, 1.74, 21)
  returning id into _art;
  perform public.record_stock_move(_art, 'entree', 5, 0.80, false, null, 'reception', 'ESSAI-B1', 'stock de depart de l essai');

  -- ------------------------------------------------ ticket : en-tête brouillon sans numéro, puis lignes
  _exp := pg_temp.b1_next_number(_co, 'TIK');
  insert into public.documents (company_id, number, status, source_document_id, doc_type, contact_id, vehicle_id, issue_date, due_date, notes,
                                total_ht, total_vat, total_ttc, price_mode, tax_exempt, global_discount_pct, global_discount_amount,
                                shipping_ht, shipping_taxed, shipping_vat_rate, forced_ttc)
  values (_co, null, 'brouillon', null, 'TIK', null, null, _today, null, null, 1.44, 0.30, 1.74, 'ttc', false, 0, 0, 0, true, 21, null)
  returning id into _doc;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  select _doc, _art, a.designation, a.reference, 'article', 1, 1.44, 21, 0, 1.44, 1.74, 0 from public.articles a where a.id = _art;

  _why := public.document_invoice_required(_doc);
  insert into _t(check_name, result) values ('2 facture non imposee (ticket 1,74 sans vehicule)', case when _why is null then 'ok' else 'KO ' || _why end);

  _num := public.document_assign_number(_doc);
  select * into _st from public.article_stock(_art);
  _before := _st.real_qty;
  perform public.record_stock_move(_art, 'sortie', -1, null, false, null, 'sale', _num, null);

  insert into _t(check_name, result) values
    ('3 numero du ticket = suivant de la serie (' || coalesce(_exp, '?') || ')', case when _num = _exp then 'ok' else 'KO ' || coalesce(_num, 'null') end),
    ('4 serie avancee d un cran', case when pg_temp.b1_next_number(_co, 'TIK') <> _exp and _num is not null then 'ok' else 'KO' end);

  -- ------------------------------------------------ règlement espèces 1,74 (arrondi légal à 1,75)
  insert into public.document_payments (document_id, method, amount, status, due_date, given_amount, note, from_financing)
  values (_doc, 'ESP', 1.75, 'recu', null, 2.00, null, false),
         (_doc, 'ARR', -0.01, 'recu', null, null, 'Arrondi especes (5 cents)', false);
  perform public.recompute_document_paid(_doc);

  select * into _d from public.documents where id = _doc;
  insert into _t(check_name, result) values
    ('5 totaux HT 1,44 / TVA 0,30 / TTC 1,74', case when _d.total_ht = 1.44 and _d.total_vat = 0.30 and _d.total_ttc = 1.74 then 'ok' else 'KO ' || _d.total_ht || '/' || _d.total_vat || '/' || _d.total_ttc end),
    ('6 ticket rattache a la session de caisse', case when _d.cash_session_id = _sess then 'ok' else 'KO ' || coalesce(_d.cash_session_id::text, 'null') end),
    ('7 especes 1,75 + arrondi -0,01 dans la session',
      case when (select count(*) from public.document_payments where document_id = _doc and cash_session_id = _sess
                   and ((method = 'ESP' and amount = 1.75) or (method = 'ARR' and amount = -0.01))) = 2 then 'ok' else 'KO' end),
    ('8 ticket paye, regle 1,74, du 0', case when _d.status = 'payee' and _d.paid_amount = 1.74 and _d.total_ttc - _d.paid_amount = 0 then 'ok' else 'KO ' || _d.status || ' ' || _d.paid_amount end);

  -- ------------------------------------------------ stock, mouvement, PAMP (B4, B5, B7)
  select * into _st from public.article_stock(_art);
  select * into _m from public.stock_moves where article_id = _art and ref = _num;
  insert into _t(check_name, result) values
    ('9 stock reel 5 -> 4, reserve 0', case when _before = 5 and _st.real_qty = 4 and _st.reserved_qty = 0 then 'ok' else 'KO ' || _before || '->' || _st.real_qty || ' res ' || _st.reserved_qty end),
    ('10 mouvement : sortie -1, origine sale, ref ticket, operateur, ancien 5 / nouveau 4',
      case when _m.move_type = 'sortie' and _m.qty_delta = -1 and not _m.is_reservation and _m.origin = 'sale' and _m.operator_id = _uid
             and (select coalesce(sum(qty_delta), 0) from public.stock_moves where article_id = _art and not is_reservation and id < _m.id) = 5
             and (select coalesce(sum(qty_delta), 0) from public.stock_moves where article_id = _art and not is_reservation and id <= _m.id) = 4
           then 'ok' else 'KO ' || coalesce(_m.move_type::text, 'aucun mouvement') end),
    ('11 PAMP inchange (0,80) apres la vente', case when (select pamp from public.articles where id = _art) = 0.80 then 'ok' else 'KO ' || (select pamp from public.articles where id = _art) end),
    ('12 cout de la ligne = PAMP (marge sur PAMP, B5)', case when (select unit_cost from public.document_lines where document_id = _doc) = 0.80 then 'ok' else 'KO' end),
    ('13 operateur du ticket = utilisateur connecte', case when _d.operator_user_id = _uid then 'ok' else 'KO' end);

  select count(*) into _n from public.events
   where entity_type = 'documents' and entity_id = _doc::text and actor_id = _uid
     and (action = 'insert' or (action = 'update' and new_data->>'status' = 'validee' and new_data->>'number' = _num));
  insert into _t(check_name, result) values ('14 traces events : creation + validation numerotee', case when _n >= 2 then 'ok' else 'KO ' || _n end);

  _x := public.cash_drawer_balance(_co) - _drawer0;
  insert into _t(check_name, result) values ('15 tiroir-caisse : +1,75 en especes', case when _x = 1.75 then 'ok' else 'KO ' || _x end);

  insert into _t(check_name, result) values ('16 ticket au journal des ventes du jour',
    case when exists (select 1 from public.sales_journal(_co, _today, _today) j where j.document_id = _doc and j.total_ttc = 1.74) then 'ok' else 'KO' end);

  -- ------------------------------------------------ G8 : vente d'un article à stock 0 autorisée (stock −1)
  insert into public.articles (company_id, reference, designation, mgmt_type, sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'ESSAIB1-04Z-' || substr(md5(random()::text), 1, 6), 'ESSAI B1 article sans stock', 'A', 1.44, 1.74, 21)
  returning id into _art0;
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, null, 'brouillon', 'TIK', _today, 1.44, 0.30, 1.74, 'ttc') returning id into _doc0;
  insert into public.document_lines (document_id, article_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_doc0, _art0, 'ESSAI B1 article sans stock', 'article', 1, 1.44, 21, 0, 1.44, 1.74, 0);
  _num := public.document_assign_number(_doc0);
  perform public.record_stock_move(_art0, 'sortie', -1, null, false, null, 'sale', _num, null);
  select * into _st from public.article_stock(_art0);
  insert into _t(check_name, result) values ('17 vente a stock 0 autorisee : stock -1', case when _num is not null and _st.real_qty = -1 then 'ok' else 'KO ' || _st.real_qty end);
end $s$;

select n, check_name, result from _t order by n;
