-- =====================================================================
-- Parcours G8 n° 7 — Réservation client avec acompte (lot-verif-parcours, 20/11/2026).
-- G8 : Ventes › Réservation → client → ligne → Valider → « Saisie d'acompte » → édition
--      → RESERVATION 3000003 (compteur propre) ; la ligne passe en « Qté réservée » sur l'article
--      (stock dispo −1), AUCUN mouvement de stock réel. Hub : « Acompte direct » (acompte sans document).
-- DMS : Ventes → Nouveau document type RES (document-editor.tsx) → `createDocument` (write-api.ts) :
--       en-tête brouillon → lignes → `document_assign_number` → `record_stock_move` type « reservation »
--       (is_reservation = vrai : réservé +1, réel inchangé) ; acompte = règlement sur la réservation
--       (payment-panel.tsx → `addPayments` → `recompute_document_paid`) ; acompte direct
--       (direct-deposit-api.ts : `createDirectDeposit` = document ACD + règlement, puis `applyDirectDeposit`
--       = règlement reporté `transferred_from`, ACD « converti », filiation `document_sources`).
-- Société ItalTest, utilisateur simon@themaul.be (admin). Transaction annulée : rien ne reste en base.
-- Client et article (5 en stock à 0,80) créés par l'essai. Acomptes par carte (indépendants de la caisse).
-- Contrôles :
--   1 n° = suivant de la série RES (compteur propre) ; 2 réservation validée, 1,74 TTC ;
--   3 réel inchangé 5, réservé 1, disponible 4 ; 4 trace : une ligne « reservation » (is_reservation) réf.
--   RES, opérateur, aucun mouvement de stock réel ; 5 PAMP inchangé ; 6 acompte 0,50 : réglé 0,50, reste
--   1,24, réservation toujours ouverte ; 7 pas de facture d'acompte imposée (particulier, sans moto) ;
--   8 réservation dans les « documents en attente » du client avec son acompte ;
--   9 acompte direct ACD : n° de sa série, aucun montant facturé, aucun stock, 0,30 perçu ;
--   10 imputation sur la réservation : réglé 0,80, report hors caisse ; 11 ACD « converti », filiation ;
--   12 traces events.
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
  _cli uuid; _art uuid; _res uuid; _acd uuid; _exp text; _expa text; _num text; _numa text; _d record; _m record; _st record; _n int; _p record;
begin
  insert into public.contacts (company_id, type, last_name, first_name) values (_co, 'particulier', 'ESSAI B1', 'Reservation') returning id into _cli;
  insert into public.articles (company_id, reference, designation, mgmt_type, sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'ESSAIB1-07-' || substr(md5(random()::text), 1, 6), 'ESSAI B1 manchon caoutchouc', 'A', 1.44, 1.74, 21) returning id into _art;
  perform public.record_stock_move(_art, 'entree', 5, 0.80, false, null, 'reception', 'ESSAI-B1', 'stock de depart de l essai');

  -- ------------------------------------------------ réservation (createDocument RES, validée)
  _exp := pg_temp.b1_next_number(_co, 'RES');
  insert into public.documents (company_id, number, status, source_document_id, doc_type, contact_id, vehicle_id, issue_date, due_date, notes,
                                total_ht, total_vat, total_ttc, price_mode, tax_exempt, global_discount_pct, global_discount_amount,
                                shipping_ht, shipping_taxed, shipping_vat_rate, forced_ttc)
  values (_co, null, 'brouillon', null, 'RES', _cli, null, _today, null, null, 1.44, 0.30, 1.74, 'ttc', false, 0, 0, 0, true, 21, null)
  returning id into _res;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  select _res, _art, a.designation, a.reference, 'article', 1, 1.44, 21, 0, 1.44, 1.74, 0 from public.articles a where a.id = _art;
  _num := public.document_assign_number(_res);
  perform public.record_stock_move(_art, 'reservation', 1, null, true, null, 'sale', _num, null);

  select * into _d from public.documents where id = _res;
  select * into _st from public.article_stock(_art);
  select * into _m from public.stock_moves where article_id = _art and ref = _num;
  insert into _t(check_name, result) values
    ('1 numero = suivant de la serie RES (' || coalesce(_exp, '?') || ')', case when _num = _exp then 'ok' else 'KO ' || coalesce(_num, 'null') end),
    ('2 reservation validee, 1,74 TTC', case when _d.status = 'validee' and _d.total_ttc = 1.74 and _d.contact_id = _cli then 'ok' else 'KO ' || _d.status end),
    ('3 reel 5 inchange, reserve 1, disponible 4', case when _st.real_qty = 5 and _st.reserved_qty = 1 and _st.available_qty = 4 then 'ok' else 'KO ' || _st.real_qty || '/' || _st.reserved_qty || '/' || _st.available_qty end),
    ('4 trace : ligne reservation (is_reservation) ref RES, operateur ; aucun mouvement reel',
      case when _m.move_type = 'reservation' and _m.is_reservation and _m.qty_delta = 1 and _m.operator_id = _uid and _m.origin = 'sale'
             and not exists (select 1 from public.stock_moves where article_id = _art and not is_reservation and origin = 'sale')
           then 'ok' else 'KO ' || coalesce(_m.move_type::text, 'aucune trace') end),
    ('5 PAMP inchange (0,80)', case when (select pamp from public.articles where id = _art) = 0.80 then 'ok' else 'KO' end);

  -- ------------------------------------------------ saisie d'acompte 0,50 (carte) sur la réservation
  insert into public.document_payments (document_id, method, amount, status, note, from_financing) values (_res, 'MAE', 0.50, 'recu', null, false);
  perform public.recompute_document_paid(_res);
  select * into _d from public.documents where id = _res;
  insert into _t(check_name, result) values
    ('6 acompte 0,50 : regle 0,50, reste 1,24, reservation ouverte', case when _d.paid_amount = 0.50 and _d.total_ttc - _d.paid_amount = 1.24 and _d.status = 'validee' then 'ok' else 'KO ' || _d.status || ' ' || _d.paid_amount end),
    ('7 pas de facture d acompte imposee (particulier sans moto)',
      case when not public._deposit_invoice_required(_res)
             and not exists (select 1 from public.documents where source_document_id = _res and doc_type = 'FAA') then 'ok' else 'KO' end),
    ('8 reservation dans les documents en attente du client, avec son acompte',
      case when exists (select 1 from public.documents where contact_id = _cli and id = _res
                          and doc_type in ('DEV', 'BC', 'RES', 'BL', 'ACD', 'FAC', 'TIK')
                          and status not in ('brouillon', 'annulee', 'converti', 'avoir_emis') and paid_amount = 0.50) then 'ok' else 'KO' end);

  -- ------------------------------------------------ acompte direct (createDirectDeposit) puis imputation (applyDirectDeposit)
  _expa := pg_temp.b1_next_number(_co, 'ACD');
  insert into public.documents (company_id, number, status, doc_type, contact_id, issue_date, notes, total_ht, total_vat, total_ttc, price_mode)
  values (_co, null, 'brouillon', 'ACD', _cli, _today, 'ESSAI', 0, 0, 0, 'ttc') returning id into _acd;
  insert into public.document_lines (document_id, article_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_acd, null, 'Acompte direct — ESSAI', 'texte', 0, 0, 0, 0, 0, 0, 0);
  _numa := public.document_assign_number(_acd);
  insert into public.document_payments (document_id, method, amount, status, note, from_financing) values (_acd, 'MAE', 0.30, 'recu', 'Acompte direct ESSAI', false);
  perform public.recompute_document_paid(_acd);
  select * into _d from public.documents where id = _acd;
  insert into _t(check_name, result) values ('9 acompte direct ' || coalesce(_numa, '?') || ' : serie ACD, 0 facture, aucun stock, 0,30 percu',
    case when _numa = _expa and _d.total_ttc = 0 and _d.paid_amount = 0.30 and _d.status = 'validee'
           and not exists (select 1 from public.stock_moves where ref = _numa) then 'ok' else 'KO ' || coalesce(_numa, 'null') || ' ' || _d.status end);

  select * into _p from public.document_payments where document_id = _acd and status = 'recu';
  insert into public.document_payments (document_id, method, amount, status, note, from_financing, transferred_from)
  values (_res, _p.method, _p.amount, 'recu', trim('Acompte reporté ACD ' || _numa), false, _p.id);
  perform public.recompute_document_paid(_res);
  update public.documents set status = 'converti' where id = _acd;
  insert into public.document_sources (company_id, document_id, source_document_id, kind) values (_co, _res, _acd, 'direct_deposit');

  select * into _d from public.documents where id = _res;
  insert into _t(check_name, result) values
    ('10 imputation : reservation reglee 0,80, report hors caisse',
      case when _d.paid_amount = 0.80 and (select cash_session_id from public.document_payments where document_id = _res and transferred_from = _p.id) is null then 'ok' else 'KO ' || _d.paid_amount end),
    ('11 acompte direct converti, filiation vers la reservation',
      case when (select status from public.documents where id = _acd) = 'converti'
             and exists (select 1 from public.document_sources where document_id = _res and source_document_id = _acd) then 'ok' else 'KO' end);

  select count(*) into _n from public.events where entity_type = 'documents' and entity_id = _res::text and actor_id = _uid;
  insert into _t(check_name, result) values ('12 traces events de la reservation (creation, validation, reglements)', case when _n >= 3 then 'ok' else 'KO ' || _n end);
end $s$;

select n, check_name, result from _t order by n;
