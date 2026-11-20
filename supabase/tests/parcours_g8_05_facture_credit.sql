-- =====================================================================
-- Parcours G8 n° 5 — Facture client à crédit (lot-verif-parcours, 20/11/2026).
-- G8 : Ventes › Facture → client 6003 + opérateur → ligne (1,74 €) → pied de facture sans encaissement
--      → « Règlement incomplet : poursuivre ? » → Valider → FACTURE 22701457, due 1,74 €, stock −1.
-- DMS : Ventes → Nouveau document (document-editor.tsx) → `createDocument` FAC (write-api.ts) : en-tête
--       brouillon sans numéro → lignes → `document_assign_number` (numéro + validation dans la même
--       transaction) → `record_stock_move` (sortie). Aucun règlement : la facture reste due.
--       Puis un règlement partiel (payment-panel.tsx → `addPayments` → `recompute_document_paid`).
-- Société ItalTest, utilisateur simon@themaul.be (admin). Transaction annulée : rien ne reste en base.
-- Client et article (5 en stock à 0,80) créés par l'essai. Numéros contrôlés « suivant de celui d'avant »
-- dans la série qui s'applique (FAC, ou VEN si ItalTest est en compteur unique ; voir aussi l'essai 06).
-- Contrôles :
--   1 validation refusée sans client, aucun numéro consommé ; 2 refusée sans ligne, aucun numéro consommé ;
--   3 n° = suivant de la série ; 4 facture validée, totaux 1,44 / 0,30 / 1,74 ; 5 règlement incomplet :
--   réglé 0, dû 1,74 ; 6 pas de caisse (facture à crédit) ; 7 stock 5 → 4 ; 8 mouvement (sortie −1, réf.
--   facture, opérateur, ancien / nouveau stock) ; 9 PAMP inchangé ; 10 facture dans les débiteurs (dû 1,74) ;
--   11 facture au journal des ventes ; 12 traces events ; 13 règlement partiel 1,00 carte : dû 0,74,
--   facture toujours « validée » (pas payée) ; 14 solde 0,74 virement : facture « payée ».
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
  _cli uuid; _art uuid; _doc uuid; _bad uuid; _exp text; _num text; _err text; _d record; _m record; _st record; _n int;
begin
  -- ------------------------------------------------ client et article de l'essai
  insert into public.contacts (company_id, civility, type, last_name, first_name)
  values (_co, 'Monsieur', 'particulier', 'ESSAI B1', 'Facture credit') returning id into _cli;
  insert into public.articles (company_id, reference, designation, mgmt_type, sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'ESSAIB1-05-' || substr(md5(random()::text), 1, 6), 'ESSAI B1 manchon caoutchouc', 'A', 1.44, 1.74, 21)
  returning id into _art;
  perform public.record_stock_move(_art, 'entree', 5, 0.80, false, null, 'reception', 'ESSAI-B1', 'stock de depart de l essai');

  _exp := pg_temp.b1_next_number(_co, 'FAC');

  -- ------------------------------------------------ refus : sans client, puis sans ligne (aucun numéro consommé)
  begin
    insert into public.documents (company_id, number, status, doc_type, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
    values (_co, null, 'brouillon', 'FAC', null, _today, 1.44, 0.30, 1.74, 'ttc') returning id into _bad;
    insert into public.document_lines (document_id, article_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
    values (_bad, _art, 'ESSAI', 'article', 1, 1.44, 21, 0, 1.44, 1.74, 0);
    perform public.document_assign_number(_bad);
    _err := null;
  exception when others then _err := sqlerrm;
  end;
  insert into _t(check_name, result) values ('1 validation refusee sans client, aucun numero consomme',
    case when _err ilike '%client%' and pg_temp.b1_next_number(_co, 'FAC') = _exp then 'ok' else 'KO ' || coalesce(_err, 'acceptee') end);
  begin
    insert into public.documents (company_id, number, status, doc_type, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
    values (_co, null, 'brouillon', 'FAC', _cli, _today, 0, 0, 0, 'ttc') returning id into _bad;
    perform public.document_assign_number(_bad);
    _err := null;
  exception when others then _err := sqlerrm;
  end;
  insert into _t(check_name, result) values ('2 validation refusee sans ligne, aucun numero consomme',
    case when _err ilike '%ligne%' and pg_temp.b1_next_number(_co, 'FAC') = _exp then 'ok' else 'KO ' || coalesce(_err, 'acceptee') end);

  -- ------------------------------------------------ la facture (createDocument FAC, status validee)
  insert into public.documents (company_id, number, status, source_document_id, doc_type, contact_id, vehicle_id, issue_date, due_date, notes,
                                total_ht, total_vat, total_ttc, price_mode, tax_exempt, global_discount_pct, global_discount_amount,
                                shipping_ht, shipping_taxed, shipping_vat_rate, forced_ttc, condition_reglement)
  values (_co, null, 'brouillon', null, 'FAC', _cli, null, _today, _today + 30, null, 1.44, 0.30, 1.74, 'ttc', false, 0, 0, 0, true, 21, null, null)
  returning id into _doc;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  select _doc, _art, a.designation, a.reference, 'article', 1, 1.44, 21, 0, 1.44, 1.74, 0 from public.articles a where a.id = _art;
  _num := public.document_assign_number(_doc);
  perform public.record_stock_move(_art, 'sortie', -1, null, false, null, 'sale', _num, null);

  select * into _d from public.documents where id = _doc;
  insert into _t(check_name, result) values
    ('3 numero de la facture = suivant de la serie (' || coalesce(_exp, '?') || ')', case when _num = _exp then 'ok' else 'KO ' || coalesce(_num, 'null') end),
    ('4 facture validee, totaux 1,44 / 0,30 / 1,74', case when _d.status = 'validee' and _d.total_ht = 1.44 and _d.total_vat = 0.30 and _d.total_ttc = 1.74 then 'ok' else 'KO ' || _d.status end),
    ('5 reglement incomplet : regle 0, du 1,74', case when _d.paid_amount = 0 and _d.total_ttc - _d.paid_amount = 1.74 then 'ok' else 'KO ' || _d.paid_amount end),
    ('6 facture a credit hors caisse (aucune session)', case when _d.cash_session_id is null then 'ok' else 'KO' end);

  select * into _st from public.article_stock(_art);
  select * into _m from public.stock_moves where article_id = _art and ref = _num;
  insert into _t(check_name, result) values
    ('7 stock reel 5 -> 4', case when _st.real_qty = 4 and _st.reserved_qty = 0 then 'ok' else 'KO ' || _st.real_qty end),
    ('8 mouvement : sortie -1, ref facture, operateur, ancien 5 / nouveau 4',
      case when _m.move_type = 'sortie' and _m.qty_delta = -1 and _m.origin = 'sale' and _m.operator_id = _uid
             and (select sum(qty_delta) from public.stock_moves where article_id = _art and not is_reservation and id < _m.id) = 5
           then 'ok' else 'KO ' || coalesce(_m.move_type::text, 'aucun mouvement') end),
    ('9 PAMP inchange (0,80)', case when (select pamp from public.articles where id = _art) = 0.80 then 'ok' else 'KO' end),
    ('10 facture dans les clients debiteurs, du 1,74',
      case when exists (select 1 from public.debtors_detailed(_co, null, null, _today + 60, _cli) x where x.document_id = _doc and x.amount_due = 1.74) then 'ok' else 'KO' end),
    ('11 facture au journal des ventes', case when exists (select 1 from public.sales_journal(_co, _today, _today) j where j.document_id = _doc) then 'ok' else 'KO' end);

  select count(*) into _n from public.events
   where entity_type = 'documents' and entity_id = _doc::text and actor_id = _uid
     and (action = 'insert' or (action = 'update' and new_data->>'number' = _num));
  insert into _t(check_name, result) values ('12 traces events : creation + validation', case when _n >= 2 then 'ok' else 'KO ' || _n end);

  -- ------------------------------------------------ règlement partiel puis solde (payment-panel → addPayments)
  insert into public.document_payments (document_id, method, amount, status, note, from_financing) values (_doc, 'MAE', 1.00, 'recu', null, false);
  perform public.recompute_document_paid(_doc);
  select * into _d from public.documents where id = _doc;
  insert into _t(check_name, result) values ('13 reglement partiel 1,00 carte : du 0,74, facture toujours validee',
    case when _d.paid_amount = 1.00 and _d.status = 'validee' then 'ok' else 'KO ' || _d.status || ' ' || _d.paid_amount end);
  insert into public.document_payments (document_id, method, amount, status, note, from_financing) values (_doc, 'VIR', 0.74, 'recu', null, false);
  perform public.recompute_document_paid(_doc);
  select * into _d from public.documents where id = _doc;
  insert into _t(check_name, result) values ('14 solde 0,74 virement : facture payee',
    case when _d.paid_amount = 1.74 and _d.status = 'payee' then 'ok' else 'KO ' || _d.status || ' ' || _d.paid_amount end);
end $s$;

select n, check_name, result from _t order by n;
