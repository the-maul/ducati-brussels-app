-- =====================================================================
-- Decision atelier Q45 (18/11/2026) — essai a blanc de 20261119191000_m8_acompte_or.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119191000_m8_acompte_or.sql \
--      supabase/tests/m8_acompte_or.sql; echo "rollback;") > t.sql
-- Joue un administrateur d'ITALBIKE STORE, dans SA caisse (la caisse reelle eventuellement ouverte
-- est cloturee dans la transaction annulee). Scenario, de l'acompte a la facture finale :
--   OR avec moto → document d'acompte (BC numerote du n° de l'OR, un seul par OR) → acompte 100 EUR
--   encaisse dans la caisse → facture d'acompte FAA automatique (moto) → un 2e acompte contre-passe
--   → acompte net 100 → la caisse est CLOTUREE → facture finale de l'OR validee : l'acompte y est
--   reporte (meme date, hors caisse, lien FAA), la facture est reglee de 100, le BC « converti »,
--   le journal des ventes deduit la FAA, le contre-passe n'est pas reporte, trace events.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare _c uuid; _v uuid;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'particulier', 'TEST', 'ACOMPTE OR', 'BE') returning id into _c;
  insert into public.vehicles (company_id, brand, model, status, notes)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'DUCATI', 'ESSAI ACOMPTE OR', 'vendu', 'ESSAI A BLANC') returning id into _v;
  perform set_config('test.c', _c::text, true);
  perform set_config('test.v', _v::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _c uuid := current_setting('test.c')::uuid;
  _v uuid := current_setting('test.v')::uuid;
  _u interval; _s uuid; _or uuid; _num text; _bc uuid; _bc2 uuid; _pay record; _pay2 record; _faa uuid; _fac uuid;
  _fp record; _dep numeric; _err text; _pre numeric;
begin
  -- ------------------------------------------------ caisse de l'essai (meme methode que m6_facture_acompte_caisse_cloturee)
  update public.cash_sessions set counted_cash = coalesce(expected_cash, 0), variance_reason = 'ESSAI A BLANC (transaction annulee)',
         status = 'closed', closed_at = greatest(opened_at, now() - interval '4 hours')
   where company_id = _co and status = 'open';
  _u := (now() - greatest(now() - interval '3 hours',
                          coalesce((select max(closed_at) from public.cash_sessions where company_id = _co and status = 'closed'), '-infinity')
                          + interval '1 millisecond')) / 180;
  if _u <= interval '0' then raise exception 'ESSAI : une caisse reelle est cloturee a l instant meme, relancez l essai.'; end if;
  insert into public.cash_sessions (company_id, opened_by, opening_float, status, opened_at, note)
  values (_co, auth.uid(), 0, 'open', now() - 180 * _u, 'ESSAI A BLANC (transaction annulee)') returning id into _s;

  -- ------------------------------------------------ OR et document d'acompte
  _num := 'OR-ESSAI-ACO-' || to_char(clock_timestamp(), 'HH24MISSUS');
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status, total_ht, total_vat, total_ttc)
  values (_co, _num, _c, _v, 9000, 'a_faire', 247.93, 52.07, 300) returning id into _or;
  _bc := public.repair_order_deposit_document(_or);
  _bc2 := public.repair_order_deposit_document(_or);
  insert into _t(check_name, result) values ('document d''acompte : BC valide, numero de l''OR, un seul par OR',
    case when _bc = _bc2 and (select doc_type = 'BC' and status = 'validee' and number = _num and repair_order_id = _or and contact_id = _c
                                from public.documents where id = _bc) then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ acompte encaisse, FAA automatique (moto sur l'OR)
  insert into public.document_payments (document_id, method, amount, status, note, paid_at)
  values (_bc, 'VIR', 100, 'recu', 'TEST acompte OR', now() - 120 * _u) returning * into _pay;
  _faa := public._deposit_invoice_for_payment(_pay.id);
  insert into _t(check_name, result) values ('acompte dans la caisse de l''essai', case when _pay.cash_session_id = _s then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('facture d''acompte FAA legale creee automatiquement, libelle avec le n° de l''OR',
    case when _faa is not null and (select doc_type from public.documents where id = _faa) = 'FAA'
          and exists (select 1 from public.document_lines where document_id = _faa and designation like '%' || _num || '%') then 'ok' else 'FAIL' end);

  -- 2e acompte puis contre-passation (erreur de saisie) : ne compte pas.
  insert into public.document_payments (document_id, method, amount, status, note, paid_at)
  values (_bc, 'VIR', 20, 'recu', 'TEST erreur', now() - 110 * _u) returning * into _pay2;
  insert into public.document_payments (document_id, method, amount, status, note, paid_at, reversal_of)
  values (_bc, 'VIR', -20, 'recu', 'TEST contre-passation', now() - 100 * _u, _pay2.id);
  select amount into _dep from public.repair_order_deposits(array[_or]);
  insert into _t(check_name, result) values ('acompte net de l''OR (colonne de la liste) = 100', case when _dep = 100 then 'ok' else 'FAIL ' || coalesce(_dep::text, 'null') end);

  -- ------------------------------------------------ la caisse de l'acompte est cloturee
  update public.cash_sessions set counted_cash = 0, variance_reason = 'ESSAI A BLANC (transaction annulee)',
         status = 'closed', closed_at = now() - 60 * _u where id = _s;

  -- ------------------------------------------------ facture finale de l'OR (meme ordre que l'application)
  begin
    insert into public.documents (company_id, doc_type, status, contact_id, vehicle_id, issue_date, total_ht, total_vat, total_ttc, price_mode, repair_order_id)
    values (_co, 'FAC', 'brouillon', _c, _v, current_date, 247.93, 52.07, 300, 'ttc', _or) returning id into _fac;
    insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
    values (_fac, 'TEST main d''oeuvre', 1, 247.93, 21, 247.93, 300, 0, 'main_oeuvre');
    update public.documents set status = 'validee', number = public.next_document_number(_co, 'FAC') where id = _fac;
    select * into _fp from public.document_payments where document_id = _fac;
    insert into _t(check_name, result) values ('facture finale : acompte reporte (meme date, hors caisse, lien FAA)',
      case when _fp.transferred_from = _pay.id and _fp.amount = 100 and _fp.paid_at = _pay.paid_at
            and _fp.cash_session_id is null and _fp.deposit_invoice_id = _faa then 'ok' else 'FAIL' end);
    insert into _t(check_name, result) values ('facture finale : un seul report (le contre-passe n''est pas reporte)',
      case when (select count(*) from public.document_payments where document_id = _fac) = 1 then 'ok' else 'FAIL' end);
    insert into _t(check_name, result) values ('facture finale reglee de 100, reste 200',
      case when (select paid_amount = 100 and status = 'validee' from public.documents where id = _fac) then 'ok' else 'FAIL' end);
    insert into _t(check_name, result) values ('document d''acompte « converti », OR facture',
      case when (select status from public.documents where id = _bc) = 'converti'
            and (select status from public.repair_orders where id = _or) = 'facture' then 'ok' else 'FAIL' end);
    select prepaid_ttc into _pre from public.sales_journal(_co, current_date, current_date) where document_id = _fac;
    insert into _t(check_name, result) values ('journal des ventes : la FAA est deduite de la facture finale (100)',
      case when _pre = 100 then 'ok' else 'FAIL ' || coalesce(_pre::text, 'null') end);
    insert into _t(check_name, result) values ('trace events repair_order_deposit_transferred',
      case when exists (select 1 from public.events where action = 'repair_order_deposit_transferred' and entity_id = _fac::text) then 'ok' else 'FAIL' end);
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('facture finale de l''OR avec acompte', 'FAIL ' || _err);
  end;

end $s$;

reset role;
select n, check_name, result from _t order by n;
