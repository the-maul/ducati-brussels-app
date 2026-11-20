-- =====================================================================
-- Parcours G8 n° 8 — Devis / proforma (lot-verif-parcours, 20/11/2026).
-- G8 : Ventes › Proforma → (documents en attente) → client → ligne → édition (titre Proforma / Devis /
--      Estimation) → PROFORMA 2000004 (compteur propre) ; aucun mouvement de stock. Rappel proforma :
--      « Réserver » (proforma → réservation), « Dupliquer ».
-- DMS : Ventes → Nouveau document type DEV (document-editor.tsx) → `createDocument` (write-api.ts) :
--       en-tête brouillon → lignes → `document_assign_number` ; `recordSaleStockMoves` ne fait rien pour
--       un DEV. Titre imprimé au choix : print-options.ts (front, hors SQL). « Réserver » = conversion
--       `convertDocument(DEV, 'RES')` (RES validée, réservé +1, devis « converti ») ; « Dupliquer » =
--       `duplicateDocument` (nouveau brouillon, sans numéro).
-- Société ItalTest, utilisateur simon@themaul.be (admin). Transaction annulée : rien ne reste en base.
-- Client et article (5 en stock à 0,80) créés par l'essai.
-- Contrôles :
--   1 n° = suivant de la série DEV (compteur propre) ; 2 devis validé 1,74, client ; 3 aucun mouvement de
--   stock (ni réel, ni réservé) ; 4 stock inchangé 5 / réservé 0 ; 5 devis dans les documents en attente ;
--   6 dupliquer : brouillon sans numéro, série DEV non consommée ; 7 « Réserver » : réservation n° RES suivant,
--   filiation vers le devis ; 8 réservé +1, réel inchangé ; 9 devis « converti », plus en attente ;
--   10 traces events.
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
  _cli uuid; _art uuid; _dev uuid; _dup uuid; _res uuid; _exp text; _expr text; _num text; _numr text; _d record; _st record; _n int;
begin
  insert into public.contacts (company_id, civility, type, last_name, first_name) values (_co, 'Monsieur', 'particulier', 'ESSAI B1', 'Devis') returning id into _cli;
  insert into public.articles (company_id, reference, designation, mgmt_type, sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'ESSAIB1-08-' || substr(md5(random()::text), 1, 6), 'ESSAI B1 manchon caoutchouc', 'A', 1.44, 1.74, 21) returning id into _art;
  perform public.record_stock_move(_art, 'entree', 5, 0.80, false, null, 'reception', 'ESSAI-B1', 'stock de depart de l essai');

  -- ------------------------------------------------ devis / proforma (createDocument DEV, validé)
  _exp := pg_temp.b1_next_number(_co, 'DEV');
  insert into public.documents (company_id, number, status, source_document_id, doc_type, contact_id, vehicle_id, issue_date, due_date, notes,
                                total_ht, total_vat, total_ttc, price_mode, tax_exempt, global_discount_pct, global_discount_amount,
                                shipping_ht, shipping_taxed, shipping_vat_rate, forced_ttc)
  values (_co, null, 'brouillon', null, 'DEV', _cli, null, _today, null, null, 1.44, 0.30, 1.74, 'ttc', false, 0, 0, 0, true, 21, null)
  returning id into _dev;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  select _dev, _art, a.designation, a.reference, 'article', 1, 1.44, 21, 0, 1.44, 1.74, 0 from public.articles a where a.id = _art;
  _num := public.document_assign_number(_dev);
  -- recordSaleStockMoves('DEV') : aucun mouvement.

  select * into _d from public.documents where id = _dev;
  select * into _st from public.article_stock(_art);
  insert into _t(check_name, result) values
    ('1 numero = suivant de la serie DEV (' || coalesce(_exp, '?') || ')', case when _num = _exp then 'ok' else 'KO ' || coalesce(_num, 'null') end),
    ('2 devis valide 1,74 TTC, client', case when _d.status = 'validee' and _d.total_ttc = 1.74 and _d.contact_id = _cli then 'ok' else 'KO ' || _d.status end),
    ('3 aucun mouvement de stock (ni reel, ni reserve)', case when not exists (select 1 from public.stock_moves where article_id = _art and origin = 'sale') then 'ok' else 'KO' end),
    ('4 stock inchange : reel 5, reserve 0', case when _st.real_qty = 5 and _st.reserved_qty = 0 then 'ok' else 'KO ' || _st.real_qty || '/' || _st.reserved_qty end),
    ('5 devis dans les documents en attente du client',
      case when exists (select 1 from public.documents where contact_id = _cli and id = _dev and status not in ('brouillon', 'annulee', 'converti', 'avoir_emis')) then 'ok' else 'KO' end);

  -- ------------------------------------------------ Dupliquer (duplicateDocument : brouillon sans numéro)
  _exp := pg_temp.b1_next_number(_co, 'DEV');
  insert into public.documents (company_id, number, status, doc_type, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  select company_id, null, 'brouillon', doc_type, contact_id, _today, total_ht, total_vat, total_ttc, price_mode from public.documents where id = _dev
  returning id into _dup;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  select _dup, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order from public.document_lines where document_id = _dev;
  insert into _t(check_name, result) values ('6 dupliquer : brouillon sans numero, serie DEV non consommee',
    case when (select number is null and status = 'brouillon' from public.documents where id = _dup) and pg_temp.b1_next_number(_co, 'DEV') = _exp then 'ok' else 'KO' end);

  -- ------------------------------------------------ « Réserver » : convertDocument(DEV, 'RES')
  _expr := pg_temp.b1_next_number(_co, 'RES');
  insert into public.documents (company_id, number, status, source_document_id, doc_type, contact_id, vehicle_id, issue_date, due_date, notes,
                                total_ht, total_vat, total_ttc, price_mode, tax_exempt, global_discount_pct, global_discount_amount,
                                shipping_ht, shipping_taxed, shipping_vat_rate, forced_ttc)
  select company_id, null, 'brouillon', _dev, 'RES', contact_id, vehicle_id, _today, due_date, notes, total_ht, total_vat, total_ttc, price_mode, tax_exempt,
         global_discount_pct, global_discount_amount, shipping_ht, shipping_taxed, shipping_vat_rate, forced_ttc
    from public.documents where id = _dev
  returning id into _res;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  select _res, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order from public.document_lines where document_id = _dev;
  _numr := public.document_assign_number(_res);
  perform public.record_stock_move(_art, 'reservation', 1, null, true, null, 'sale', _numr, null);
  -- liberateReservation(DEV) : sans effet (un devis ne réserve rien) ; source « converti ».
  update public.documents set status = 'converti' where id = _dev;

  select * into _st from public.article_stock(_art);
  insert into _t(check_name, result) values
    ('7 Reserver : reservation ' || coalesce(_numr, '?') || ' (suivant RES), filiation vers le devis',
      case when _numr = _expr and (select source_document_id from public.documents where id = _res) = _dev then 'ok' else 'KO ' || coalesce(_numr, 'null') end),
    ('8 reserve +1, reel inchange 5', case when _st.real_qty = 5 and _st.reserved_qty = 1 then 'ok' else 'KO ' || _st.real_qty || '/' || _st.reserved_qty end),
    ('9 devis converti, plus dans les documents en attente',
      case when (select status from public.documents where id = _dev) = 'converti' then 'ok' else 'KO' end);

  select count(*) into _n from public.events where entity_type = 'documents' and entity_id = _dev::text and actor_id = _uid;
  insert into _t(check_name, result) values ('10 traces events du devis (creation, validation, conversion)', case when _n >= 3 then 'ok' else 'KO ' || _n end);
end $s$;

select n, check_name, result from _t order by n;
