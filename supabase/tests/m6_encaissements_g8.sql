-- =====================================================================
-- Rattrapage G8 « Encaissements » (18/11/2026) — essai a blanc des migrations 20261118170000 ->
-- 20261118174000. A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste) ;
-- le bloc du 03/11 (150000 -> 260000) doit etre applique avant (ou joint en tete du fichier) :
--   (echo "begin;"; cat supabase/migrations/20261118170000_m6_reglements_echeancier.sql \
--      supabase/migrations/20261118171000_m6_relances_impayes.sql \
--      supabase/migrations/20261118172000_m12_debiteurs_crediteurs.sql \
--      supabase/migrations/20261118173000_m12_remises_sepa.sql \
--      supabase/migrations/20261118174000_m6_bons_d_achat.sql \
--      supabase/tests/m6_encaissements_g8.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Joue le role d un administrateur (claims JWT simulees) dans ITALBIKE STORE. Verifie :
--   - echeancier 12 fois (montants, dates, reliquat, n° de cheque), refus au-dela du reste a payer ;
--   - modifier une echeance, annuler des echeances (motif obligatoire, trace), encaissement immediat ;
--   - liste des echeances ; modeles de relance precharges ; factures a relancer et derniere relance ;
--   - historique des relances append-only ; mode des relances : « actif » impossible ;
--   - clients debiteurs detailles (brouillon exclu), crediteurs (avoir) ;
--   - remise SEPA : refus sans ICS, creation en attente, une echeance dans une seule remise,
--     archivage = encaissement, impaye = contre-passation ;
--   - bons d achat : usage partiel, solde, refus au-dela du solde, utilise a 0, annulation refusee.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- Clients de test et creancier SEPA (role postgres : pas de declencheur utilisateur, pas de RLS)
do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _c uuid; _c2 uuid;
begin
  update public.companies set sepa_creditor_id = null where id = _co;
  insert into public.contacts (company_id, type, first_name, last_name, email, country, accounting_account)
  values (_co, 'particulier', 'TEST', 'ENCAISSEMENTS', 'client.reel@example.invalid', 'BE', '400999') returning id into _c;
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values (_co, 'particulier', 'TEST', 'PRELEVEMENT', 'BE') returning id into _c2;
  perform set_config('test.co', _co::text, true);
  perform set_config('test.c', _c::text, true);
  perform set_config('test.c2', _c2::text, true);
  -- Remise SEPA sans ICS : refusee (avant toute ligne) ; puis creancier d essai pour la suite.
  begin
    perform public.sepa_batch_create(_co, current_date + 3, '{}', '{}');
    perform set_config('test.ics', 'accepte', true);
  exception when others then
    perform set_config('test.ics', sqlerrm, true);
  end;
  update public.companies set sepa_creditor_id = 'BE12ZZZ0123456789', iban = coalesce(nullif(iban, ''), 'BE68539007547034') where id = _co;
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := current_setting('test.co')::uuid;
  _c uuid := current_setting('test.c')::uuid;
  _c2 uuid := current_setting('test.c2')::uuid;
  _fac uuid; _draft uuid; _avo uuid; _fac2 uuid; _fac3 uuid; _sid uuid; _sid2 uuid; _p2 uuid; _p3 uuid; _p4 uuid;
  _bid uuid; _item uuid; _v uuid; _v2 uuid; _x record; _n int; _ok boolean; _msg text;
begin
  -- ------------------------------------------------ facture 1 000 EUR, echue depuis 10 jours
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, due_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAC', 'brouillon', _c, current_date - 40, current_date - 10, 826.45, 173.55, 1000, 'ht') returning id into _fac;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_fac, 'TEST encaissements', 1, 826.45, 21, 826.45, 1000, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'FAC') where id = _fac;

  -- brouillon du meme client : jamais relance, jamais debiteur
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, due_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAC', 'brouillon', _c, current_date - 40, current_date - 10, 100, 21, 121, 'ht') returning id into _draft;

  -- ------------------------------------------------ echeancier 12 fois par cheque
  _sid := public.payment_schedule_create(_fac, 1000, 12, current_date + 5, 'CHQ', 1, 'BNP Paribas Fortis', '0001234');
  insert into _t(check_name, result) values
    ('echeancier : 12 echeances attendues', case when (select count(*) from public.document_payments where schedule_id = _sid and status = 'attendu') = 12 then 'ok' else 'FAIL' end),
    ('echeancier : somme exacte 1 000', case when (select sum(amount) from public.document_payments where schedule_id = _sid) = 1000 then 'ok' else 'FAIL' end),
    ('echeancier : 1re = 83,37 (reliquat)', case when (select amount from public.document_payments where schedule_id = _sid and installment_no = 1) = 83.37 then 'ok' else 'FAIL' end),
    ('echeancier : 12e = 83,33 a M+11', case when exists (select 1 from public.document_payments where schedule_id = _sid and installment_no = 12 and amount = 83.33 and due_date = (current_date + 5 + interval '11 months')::date) then 'ok' else 'FAIL' end),
    ('echeancier : cheque 0001245 sur la 12e', case when (select cheque_number from public.document_payments where schedule_id = _sid and installment_no = 12) = '0001245' then 'ok' else 'FAIL' end),
    ('echeancier : facture toujours due (attendu ne paie pas)', case when (select paid_amount from public.documents where id = _fac) = 0 then 'ok' else 'FAIL' end),
    ('echeancier : trace events', case when exists (select 1 from public.events where action = 'payment_schedule_created' and entity_id = _fac::text) then 'ok' else 'FAIL' end);

  _ok := false;
  begin perform public.payment_schedule_create(_fac, 1, 1, current_date, 'CHQ'); exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('echeancier : refuse au-dela du reste a payer', case when _ok then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ modifier / annuler / encaisser
  select id into _p2 from public.document_payments where schedule_id = _sid and installment_no = 2;
  perform public.payment_deferred_update(_p2, current_date + 60, 'ING', '9999');
  insert into _t(check_name, result) values
    ('modifier : echeance, banque, n° changes', case when exists (select 1 from public.document_payments where id = _p2 and due_date = current_date + 60 and bank_name = 'ING' and cheque_number = '9999' and amount = 83.33) then 'ok' else 'FAIL' end);

  _ok := false;
  begin perform public.payment_installments_cancel(array[_p2], ' '); exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('annuler : motif obligatoire', case when _ok then 'ok' else 'FAIL' end);

  select id into _p3 from public.document_payments where schedule_id = _sid and installment_no = 3;
  _n := public.payment_installments_cancel(array[_p2, _p3], 'TEST le client paie autrement');
  insert into _t(check_name, result) values
    ('annuler : 2 echeances annulees, motif garde', case when _n = 2 and (select count(*) from public.document_payments where id in (_p2, _p3) and status = 'annule' and cancel_reason = 'TEST le client paie autrement' and cancelled_by is not null) = 2 then 'ok' else 'FAIL' end),
    ('annuler : trace events', case when (select count(*) from public.events where action = 'payment_installment_cancelled' and entity_id in (_p2::text, _p3::text)) = 2 then 'ok' else 'FAIL' end),
    ('liste : 10 echeances attendues du client', case when (select count(*) from public.deferred_payments_list(_co, null, null, _c, current_date, false)) = 10 then 'ok' else 'FAIL' end),
    ('liste : historique avec les annulees', case when (select count(*) from public.deferred_payments_list(_co, null, null, _c, current_date, true) where status = 'annule') = 2 then 'ok' else 'FAIL' end);

  update public.document_payments set status = 'recu' where schedule_id = _sid and installment_no = 1;
  perform public.recompute_document_paid(_fac);
  insert into _t(check_name, result) values
    ('encaissement immediat : 83,37 percus', case when (select paid_amount from public.documents where id = _fac) = 83.37 then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ relances
  insert into _t(check_name, result) values
    ('modeles 01-04 precharges', case when (select count(*) from public.dunning_templates where company_id = _co and code in ('01', '02', '03', '04')) = 4 then 'ok' else 'FAIL' end);
  select * into _x from public.dunning_candidates(_co, current_date, 'debit', _c, 0, null) where document_id = _fac;
  insert into _t(check_name, result) values
    ('a relancer : facture echue, du 916,63', case when _x.amount_due = 916.63 then 'ok' else 'FAIL ' || coalesce(_x.amount_due::text, 'absente') end),
    ('a relancer : modele propose 01', case when _x.next_code = '01' then 'ok' else 'FAIL ' || coalesce(_x.next_code, 'null') end),
    ('a relancer : brouillon exclu', case when not exists (select 1 from public.dunning_candidates(_co, current_date, 'debit', _c, 0, null) where document_id = _draft) then 'ok' else 'FAIL' end);

  insert into public.dunning_letters (company_id, batch_id, contact_id, document_id, template_code, template_label, level, media, sent_to, is_test, amount_due)
  values (_co, gen_random_uuid(), _c, _fac, '01', 'Releve de factures', 0, 'mail', 'test@example.invalid', true, 916.63);
  select * into _x from public.dunning_candidates(_co, current_date, 'debit', _c, 0, null) where document_id = _fac;
  insert into _t(check_name, result) values
    ('derniere relance : 01 par mail (test)', case when _x.last_code = '01' and _x.last_media = 'mail' and _x.last_is_test then 'ok' else 'FAIL' end),
    ('relance suivante : 02', case when _x.next_code = '02' then 'ok' else 'FAIL ' || coalesce(_x.next_code, 'null') end),
    ('filtre « jamais relancees » : exclue', case when not exists (select 1 from public.dunning_candidates(_co, current_date, 'debit', _c, 0, '') where document_id = _fac) then 'ok' else 'FAIL' end);

  _ok := false;
  begin update public.dunning_letters set media = 'pdf' where document_id = _fac; exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('historique des relances : append-only', case when _ok or not exists (select 1 from public.dunning_letters where document_id = _fac and media = 'pdf') then 'ok' else 'FAIL' end);

  _ok := false;
  begin perform public.receivable_settings_set(_co, '{"dunning_mode": "actif"}'::jsonb); exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('mode des relances : envoi reel impossible', case when _ok then 'ok' else 'FAIL' end);
  perform public.receivable_settings_set(_co, '{"dunning_mode": "test", "dunning_test_recipient": "Test@Example.invalid"}'::jsonb);
  insert into _t(check_name, result) values
    ('mode test : adresse de test effective', case when (select effective_test_recipient from public.receivable_settings_get(_co)) = 'test@example.invalid' then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ debiteurs / crediteurs
  select * into _x from public.debtors_detailed(_co, null, null, current_date, _c, 'debit', false) where document_id = _fac;
  insert into _t(check_name, result) values
    ('debiteurs : facture, solde 916,63, compte 400999, derniere relance 01', case when _x.amount_due = 916.63 and _x.accounting_account = '400999' and _x.last_code = '01' then 'ok' else 'FAIL' end),
    ('debiteurs : brouillon exclu', case when not exists (select 1 from public.debtors_detailed(_co, null, null, current_date, _c, 'debit', false) where document_id = _draft) then 'ok' else 'FAIL' end),
    ('debiteurs : avec encaissements a echeance', case when exists (select 1 from public.debtors_detailed(_co, null, null, current_date, _c, 'debit', true) where document_id = _fac) then 'ok' else 'FAIL' end),
    ('debiteurs a la date d hier : rien de percu (916,63 -> 1 000)', case when (select amount_due from public.debtors_detailed(_co, null, null, current_date - 1, _c, 'debit', false) where document_id = _fac) = 1000 then 'ok' else 'FAIL' end);

  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'AVO', 'brouillon', _c, current_date, -41.32, -8.68, -50, 'ht') returning id into _avo;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_avo, 'TEST avoir', -1, 41.32, 21, -41.32, -50, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'AVO') where id = _avo;
  insert into _t(check_name, result) values
    ('crediteurs : avoir non rembourse -50', case when (select amount_due from public.debtors_detailed(_co, null, null, current_date, _c, 'credit', false) where document_id = _avo) = -50 then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ remise SEPA
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, due_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAC', 'brouillon', _c2, current_date, current_date + 3, 82.64, 17.36, 100, 'ht') returning id into _fac2;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_fac2, 'TEST prelevement', 1, 82.64, 21, 82.64, 100, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'FAC') where id = _fac2;
  insert into public.sepa_mandates (company_id, contact_id, mandate_ref, iban, signature_date, seq_type)
  values (_co, _c2, 'TEST-RUM-ENC-1', 'BE62510007547061', current_date - 30, 'FRST');
  _sid2 := public.payment_schedule_create(_fac2, 60, 2, current_date + 3, 'DOM');
  select id into _p4 from public.document_payments where schedule_id = _sid2 and installment_no = 1;

  insert into _t(check_name, result) values
    ('SEPA : echeances DOM et reste de facture candidats', case when (select count(*) from public.sepa_collectable_installments(_co, null, current_date + 60, _c2)) = 3 then 'ok' else 'FAIL ' || (select count(*) from public.sepa_collectable_installments(_co, null, current_date + 60, _c2))::text end);

  _msg := current_setting('test.ics');
  insert into _t(check_name, result) values ('SEPA : refus sans ICS', case when _msg ilike '%ICS%' then 'ok' else 'FAIL ' || _msg end);

  _bid := public.sepa_batch_create(_co, current_date + 3, array[_p4], array[_fac2]);
  insert into _t(check_name, result) values
    ('SEPA : remise en attente, 2 lignes, 70 EUR', case when exists (select 1 from public.sepa_batches where id = _bid and status = 'en_attente' and tx_count = 2 and total = 70) then 'ok' else 'FAIL' end),
    ('SEPA : la facture recoit une echeance DOM du reste (40)', case when exists (select 1 from public.document_payments where document_id = _fac2 and method = 'DOM' and status = 'attendu' and amount = 40 and schedule_id is null) then 'ok' else 'FAIL' end),
    ('SEPA : rien d encaisse avant la banque', case when (select paid_amount from public.documents where id = _fac2) = 0 then 'ok' else 'FAIL' end);

  _ok := false;
  begin perform public.sepa_batch_create(_co, current_date + 3, array[_p4], '{}'); exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('SEPA : une echeance dans une seule remise', case when _ok then 'ok' else 'FAIL' end);

  perform public.sepa_batch_archive(_bid);
  insert into _t(check_name, result) values
    ('SEPA : archivee = encaissement 70', case when (select paid_amount from public.documents where id = _fac2) = 70 then 'ok' else 'FAIL' end),
    ('SEPA : mandat FRST -> RCUR', case when (select seq_type from public.sepa_mandates where mandate_ref = 'TEST-RUM-ENC-1') = 'RCUR' then 'ok' else 'FAIL' end);

  select id into _item from public.sepa_batch_items where batch_id = _bid and payment_id = _p4;
  perform public.sepa_item_unpaid(_item, 'TEST rejet bancaire');
  insert into _t(check_name, result) values
    ('SEPA : impaye = contre-passation, facture du 30 + 30', case when (select paid_amount from public.documents where id = _fac2) = 40
       and exists (select 1 from public.document_payments where reversal_of = _p4 and amount = -30) then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ bons d achat
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAC', 'brouillon', _c, current_date, 82.64, 17.36, 100, 'ht') returning id into _fac3;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_fac3, 'TEST bon d achat', 1, 82.64, 21, 82.64, 100, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'FAC') where id = _fac3;
  _v := public.voucher_create(_co, 50, _c, null, null, 'geste', 'TEST');
  insert into public.document_payments (document_id, method, amount, status, voucher_id) values (_fac3, 'BA', 30, 'recu', _v);
  insert into _t(check_name, result) values
    ('bon : numero BA, solde 20 apres 30', case when (select number from public.vouchers where id = _v) like 'BA%' and (select remaining from public.vouchers_list(_co, null, _c) where id = _v) = 20 then 'ok' else 'FAIL' end),
    ('bon : reste actif', case when (select status from public.vouchers where id = _v) = 'actif' then 'ok' else 'FAIL' end);
  _ok := false;
  begin insert into public.document_payments (document_id, method, amount, status, voucher_id) values (_fac3, 'BA', 30, 'recu', _v); exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('bon : refus au-dela du solde', case when _ok then 'ok' else 'FAIL' end);
  _ok := false;
  begin insert into public.document_payments (document_id, method, amount, status) values (_fac3, 'BA', 5, 'recu'); exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('bon : mode BA sans bon refuse', case when _ok then 'ok' else 'FAIL' end);
  insert into public.document_payments (document_id, method, amount, status, voucher_id) values (_fac3, 'BA', 20, 'recu', _v);
  insert into _t(check_name, result) values
    ('bon : utilise a solde nul', case when (select status from public.vouchers where id = _v) = 'utilise' then 'ok' else 'FAIL' end);
  _ok := false;
  begin perform public.voucher_cancel(_v, 'TEST'); exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('bon : annulation refusee apres usage', case when _ok then 'ok' else 'FAIL' end);
  _v2 := public.voucher_create(_co, 10, null, current_date - 10, current_date - 1, 'autre', null);
  _ok := false;
  begin insert into public.document_payments (document_id, method, amount, status, voucher_id) values (_fac3, 'BA', 5, 'recu', _v2); exception when others then _ok := true; end;
  insert into _t(check_name, result) values
    ('bon : expire refuse', case when _ok then 'ok' else 'FAIL' end),
    ('bon : statut effectif expire', case when (select effective_status from public.vouchers_list(_co, 'expire', null) where id = _v2) = 'expire' then 'ok' else 'FAIL' end);
end $s$;

select n, check_name, result from _t order by n;
