-- =====================================================================
-- M6 PDV010 (18/11/2026) — essai a blanc de 20261119150000_fix_facture_acompte_caisse_cloturee.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119150000_fix_facture_acompte_caisse_cloturee.sql \
--      supabase/tests/m6_facture_acompte_caisse_cloturee.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Joue le role d un administrateur (claims JWT simulees) dans ITALBIKE STORE, dans SA caisse :
-- la caisse reelle eventuellement ouverte est cloturee (transaction annulee), puis l essai ouvre la
-- sienne dans une fenetre qui ne chevauche aucune caisse reelle cloturee, y encaisse un acompte et
-- la cloture. Ensuite :
--   - la facture d acompte de cet acompte se cree (reglement reporte a la date de l encaissement) ;
--   - le garde-fou reste entier : nouveau reglement date dans la caisse close, report a une autre
--     date, modification du reglement d origine → refuses.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- Client de test (role postgres : pas de declencheur utilisateur)
do $s$
declare _b2c uuid;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'particulier', 'TEST', 'ACOMPTE CAISSE CLOSE', 'BE') returning id into _b2c;
  perform set_config('test.b2c', _b2c::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _b2c uuid := current_setting('test.b2c')::uuid;
  _u interval; _s uuid; _res uuid; _pay record; _faa uuid; _fp record; _err text;
begin
  -- ------------------------------------------------ caisse de l essai, puis cloturee
  update public.cash_sessions set counted_cash = coalesce(expected_cash, 0), variance_reason = 'ESSAI A BLANC (transaction annulee)',
         status = 'closed', closed_at = greatest(opened_at, now() - interval '4 hours')
   where company_id = _co and status = 'open';
  _u := (now() - greatest(now() - interval '3 hours',
                          coalesce((select max(closed_at) from public.cash_sessions
                                     where company_id = _co and status = 'closed'), '-infinity')
                          + interval '1 millisecond')) / 180;
  if _u <= interval '0' then
    raise exception 'ESSAI : une caisse reelle est cloturee a l instant meme, relancez l essai.';
  end if;
  insert into public.cash_sessions (company_id, opened_by, opening_float, status, opened_at, note)
  values (_co, auth.uid(), 0, 'open', now() - 180 * _u, 'ESSAI A BLANC (transaction annulee)') returning id into _s;

  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'RES', 'brouillon', _b2c, current_date, 100, 21, 121, 'ttc') returning id into _res;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_res, 'TEST casque', 1, 100, 21, 100, 121, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'RES') where id = _res;
  insert into public.document_payments (document_id, method, amount, status, note, paid_at)
  values (_res, 'VIR', 50, 'recu', 'TEST acompte', now() - 120 * _u) returning * into _pay;

  update public.cash_sessions set counted_cash = 0, variance_reason = 'ESSAI A BLANC (transaction annulee)',
         status = 'closed', closed_at = now() - 60 * _u where id = _s;
  insert into _t(check_name, result) values
    ('acompte encaisse dans la caisse de l essai, cloturee depuis',
     case when _pay.cash_session_id = _s and exists (select 1 from public.cash_sessions where id = _s and status = 'closed'
                and _pay.paid_at between opened_at and closed_at) then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ facture d acompte : se cree, a la date de l encaissement
  begin
    _faa := public.deposit_invoice_create(_pay.id);
    select * into _fp from public.document_payments where document_id = _faa;
    insert into _t(check_name, result) values
      ('FAA de l acompte d une journee cloturee : creee', case when (select doc_type from public.documents where id = _faa) = 'FAA' then 'ok' else 'FAIL' end),
      ('FAA : reglement reporte, date de l encaissement, hors caisse',
       case when _fp.transferred_from = _pay.id and _fp.paid_at = _pay.paid_at and _fp.amount = 50 and _fp.cash_session_id is null then 'ok' else 'FAIL' end),
      ('FAA payee', case when (select status from public.documents where id = _faa) = 'payee' then 'ok' else 'FAIL' end);
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('FAA de l acompte d une journee cloturee : creee', 'FAIL ' || _err);
  end;

  -- ------------------------------------------------ le garde-fou reste entier
  begin
    insert into public.document_payments (document_id, method, amount, status, note, paid_at)
    values (_res, 'VIR', 10, 'recu', 'TEST antidate', now() - 110 * _u);
    insert into _t(check_name, result) values ('nouveau reglement date dans la caisse close : refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('nouveau reglement date dans la caisse close : refuse', case when _err like '%caisse cloturee%' then 'ok' else 'FAIL ' || _err end);
  end;
  begin
    insert into public.document_payments (document_id, method, amount, status, note, paid_at, transferred_from)
    values (_res, 'VIR', 50, 'recu', 'TEST report antidate', now() - 110 * _u, _pay.id);
    insert into _t(check_name, result) values ('report a une autre date que l encaissement : refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('report a une autre date que l encaissement : refuse', case when _err like '%caisse cloturee%' then 'ok' else 'FAIL ' || _err end);
  end;
  begin
    insert into public.document_payments (document_id, method, amount, status, note, paid_at, transferred_from)
    values (_res, 'VIR', 60, 'recu', 'TEST report gonfle', _pay.paid_at, _pay.id);
    insert into _t(check_name, result) values ('report d un montant superieur a l acompte : refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('report d un montant superieur a l acompte : refuse', case when _err like '%caisse cloturee%' then 'ok' else 'FAIL ' || _err end);
  end;
  begin
    update public.document_payments set note = 'TEST modif' where id = _pay.id;
    insert into _t(check_name, result) values ('reglement d une caisse close non modifiable', 'FAIL accepte');
  exception when others then
    insert into _t(check_name, result) values ('reglement d une caisse close non modifiable', 'ok');
  end;
end $s$;

reset role;
select n, check_name, result from _t order by n;
