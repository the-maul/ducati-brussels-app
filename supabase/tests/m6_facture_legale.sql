-- =====================================================================
-- Lot « facture legale » (03/11/2026) — essai a blanc de la migration 20261103180000.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) ; la TVA marge
-- (20261103160000) passe avant, comme a l application :
--   (echo "begin;"; cat supabase/migrations/20261103160000_m6_tva_marge_a_la_vente.sql --    supabase/migrations/20261103180000_m6_facture_legale.sql; \
--    cat supabase/tests/m6_facture_legale.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Joue le role d un administrateur (claims JWT simulees) dans ITALBIKE STORE et verifie :
--   - acompte percu d un client assujetti → facture d acompte FAA automatique, payee, TVA juste ;
--   - particulier sans moto → pas d automatisme, facture d acompte sur demande ;
--   - facture finale : acompte reporte lie a la FAA, journal (PrepaidAmount), registre TVA et
--     ecritures equilibrees, TVA de l acompte non comptee deux fois ;
--   - avoir partiel : la facture reste au journal ; avoir total : statut `avoir_emis`, toujours au
--     journal, fige par recompute_document_paid ; correction des factures `annulee` par un avoir ;
--   - rappel cloche « a facturer avant le 15 » quand l automatisme n a pas joue, puis resolu ;
--   - brouillons exclus du journal, du registre TVA et des ecritures (seuls les documents valides comptent).
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- Clients de test (role postgres : pas de declencheur utilisateur)
do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _b2b uuid; _b2c uuid;
begin
  insert into public.contacts (company_id, type, company_name, vat_number, country)
  values (_co, 'professionnel', 'TEST FACTURE LEGALE SRL', 'BE0123456749', 'BE') returning id into _b2b;
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values (_co, 'particulier', 'TEST', 'PARTICULIER', 'BE') returning id into _b2c;
  perform set_config('test.co', _co::text, true);
  perform set_config('test.b2b', _b2b::text, true);
  perform set_config('test.b2c', _b2c::text, true);
end $s$;

-- Registre TVA et journal du jour AVANT (les vraies pieces du jour ne faussent pas les ecarts)
create temp table _before on commit drop as
  select coalesce(sum(base_ht), 0) as base, coalesce(sum(vat), 0) as vat
    from public.vat_register('3d9f0f13-a691-4d07-ad58-34590df86e33', current_date, current_date);
grant all on _before to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := current_setting('test.co')::uuid;
  _b2b uuid := current_setting('test.b2b')::uuid;
  _b2c uuid := current_setting('test.b2c')::uuid;
  _res uuid; _pay uuid; _faa record; _fac uuid; _avo uuid; _avo2 uuid; _dev uuid; _pay2 uuid; _faa2 uuid;
  _j record; _n int; _deb numeric; _cre numeric; _v record; _before record;
  _old uuid; _oldavo uuid; _draft uuid;
begin
  -- ---------------------------------------------- brouillon : ne compte nulle part
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAC', 'brouillon', _b2b, current_date, 999, 209.79, 1208.79, 'ht') returning id into _draft;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_draft, 'TEST brouillon', 1, 999, 21, 999, 1208.79, 0, 'article');
  perform set_config('test.draft', _draft::text, true);

  -- ---------------------------------------------- RES client assujetti, acompte 500 € TTC
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'RES', 'brouillon', _b2b, current_date, 1000, 210, 1210, 'ht') returning id into _res;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_res, 'TEST accessoire', 2, 500, 21, 1000, 1210, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'RES') where id = _res;
  insert into public.document_payments (document_id, method, amount, status, note)
  values (_res, 'VIR', 500, 'recu', 'Acompte') returning id into _pay;

  select * into _faa from public.documents where deposit_payment_id = _pay and doc_type = 'FAA';
  insert into _t(check_name, result) values
    ('FAA automatique (client avec n° TVA)', case when _faa.id is not null then 'ok' else 'FAIL' end),
    ('FAA numero FAA-AAAA-NNNNN', case when _faa.number ~ ('^FAA-' || to_char(current_date, 'YYYY') || '-\d{5}$') then 'ok' else 'FAIL ' || coalesce(_faa.number, 'null') end),
    ('FAA TTC 500 / HT 413,22 / TVA 86,78', case when _faa.total_ttc = 500 and _faa.total_ht = 413.22 and _faa.total_vat = 86.78 then 'ok' else 'FAIL ' || _faa.total_ht || '/' || _faa.total_vat end),
    ('FAA payee par l acompte', case when _faa.status = 'payee' then 'ok' else 'FAIL ' || _faa.status end),
    ('FAA filiation RES', case when _faa.source_document_id = _res then 'ok' else 'FAIL' end),
    ('FAA tracee dans events', case when exists (select 1 from public.events e where e.entity_id = _faa.id::text and e.action = 'deposit_invoice') then 'ok' else 'FAIL' end),
    ('deposit_invoice_create idempotent', case when public.deposit_invoice_create(_pay) = _faa.id then 'ok' else 'FAIL' end);

  -- ---------------------------------------------- facture finale (conversion) avec acompte reporte
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode, source_document_id)
  values (_co, 'FAC', 'brouillon', _b2b, current_date, 1000, 210, 1210, 'ht', _res) returning id into _fac;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_fac, 'TEST accessoire', 2, 500, 21, 1000, 1210, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'FAC') where id = _fac;
  insert into public.document_payments (document_id, method, amount, status, note, deposit_invoice_id)
  values (_fac, 'VIR', 500, 'recu', 'Acompte reporte', _faa.id);
  update public.documents set status = 'converti' where id = _res;
  insert into _t(check_name, result) values
    ('acompte reporte : pas de 2e FAA', case when (select count(*) from public.documents where doc_type = 'FAA' and source_document_id in (_res, _fac)) = 1 then 'ok' else 'FAIL' end);

  select * into _j from public.sales_journal(_co, current_date, current_date) j where j.document_id = _fac;
  insert into _t(check_name, result) values
    ('journal : facture finale avec acompte deduit', case when _j.prepaid_ttc = 500 and _j.prepaid_vat = 86.78 then 'ok' else 'FAIL ' || coalesce(_j.prepaid_ttc::text, 'absente') end),
    ('journal : FAA presente', case when exists (select 1 from public.sales_journal(_co, current_date, current_date) j where j.document_id = _faa.id and j.doc_type = 'FAA') then 'ok' else 'FAIL' end);

  select * into _before from _before;
  select coalesce(sum(base_ht), 0) as base, coalesce(sum(vat), 0) as vat into _v from public.vat_register(_co, current_date, current_date);
  insert into _t(check_name, result) values
    ('registre TVA : 1000 HT / 210 TVA, acompte pas compte deux fois, brouillon exclu',
     case when round(_v.base - _before.base, 2) = 1000 and round(_v.vat - _before.vat, 2) = 210 then 'ok' else 'FAIL ' || round(_v.base - _before.base, 2) || '/' || round(_v.vat - _before.vat, 2) end);

  perform public.generate_sales_entries(_co, current_date, current_date);
  perform public.generate_payment_entries(_co, current_date, current_date);
  insert into _t(check_name, result) values
    ('brouillon absent du journal des ventes', case when not exists (select 1 from public.sales_journal(_co, current_date, current_date) j where j.document_id = _draft) then 'ok' else 'FAIL' end),
    ('brouillon sans ecriture comptable', case when not exists (select 1 from public.accounting_entries e where e.source_id = _draft::text) then 'ok' else 'FAIL' end);
  select sum(l.debit), sum(l.credit) into _deb, _cre from public.accounting_entries e join public.accounting_entry_lines l on l.entry_id = e.id
   where e.source = 'sales' and e.source_id in (_fac::text, _faa.id::text);
  insert into _t(check_name, result) values
    ('ecritures FAA + facture finale equilibrees', case when _deb = _cre and _deb > 0 then 'ok' else 'FAIL ' || _deb || '/' || _cre end),
    ('ecriture FAA : compte 46 credite de 413,22', case when exists (select 1 from public.accounting_entries e join public.accounting_entry_lines l on l.entry_id = e.id
       where e.source_id = _faa.id::text and l.account_code = '460000' and l.credit = 413.22) then 'ok' else 'FAIL' end),
    ('facture finale : 46 contre-passe (debit 413,22)', case when exists (select 1 from public.accounting_entries e join public.accounting_entry_lines l on l.entry_id = e.id
       where e.source_id = _fac::text and l.account_code = '460000' and l.debit = 413.22) then 'ok' else 'FAIL' end),
    ('acompte reporte : pas d ecriture de tresorerie en double', case when not exists (select 1 from public.document_payments p join public.accounting_entries e on e.source = 'payment' and e.source_id = p.id::text
       where p.document_id = _fac) then 'ok' else 'FAIL' end);

  -- ---------------------------------------------- avoir partiel puis total : la facture reste au journal
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode, source_document_id)
  values (_co, 'AVO', 'brouillon', _b2b, current_date, -500, -105, -605, 'ht', _fac) returning id into _avo;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_avo, 'TEST accessoire', -1, 500, 21, -500, -605, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'AVO') where id = _avo;
  insert into public.document_payments (document_id, method, amount, status, note) values (_fac, 'AVO', 605, 'recu', 'Regle par avoir');
  insert into public.document_payments (document_id, method, amount, status, note) values (_avo, 'AVO', -605, 'recu', 'Solde la facture');
  insert into _t(check_name, result) values
    ('avoir partiel : AVO- numerote', case when (select number from public.documents where id = _avo) ~ '^AVO-\d{4}-\d{5}$' then 'ok' else 'FAIL' end),
    ('avoir partiel : facture toujours au journal', case when exists (select 1 from public.sales_journal(_co, current_date, current_date) j where j.document_id = _fac) then 'ok' else 'FAIL' end),
    ('avoir partiel : avoir au journal', case when exists (select 1 from public.sales_journal(_co, current_date, current_date) j where j.document_id = _avo) then 'ok' else 'FAIL' end),
    ('reglement par avoir : pas en tresorerie', case when public.generate_payment_entries(_co, current_date, current_date) >= 0
       and not exists (select 1 from public.document_payments p join public.accounting_entries e on e.source = 'payment' and e.source_id = p.id::text
       where p.document_id in (_fac, _avo) and p.method = 'AVO') then 'ok' else 'FAIL' end);
  select coalesce(sum(base_ht), 0) as base, coalesce(sum(vat), 0) as vat into _v from public.vat_register(_co, current_date, current_date);
  insert into _t(check_name, result) values
    ('registre TVA apres avoir partiel : 500 HT / 105 TVA', case when round(_v.base - _before.base, 2) = 500 and round(_v.vat - _before.vat, 2) = 105 then 'ok' else 'FAIL ' || round(_v.base - _before.base, 2) || '/' || round(_v.vat - _before.vat, 2) end);

  update public.documents set status = 'avoir_emis' where id = _fac;   -- avoir total (generateCreditNote)
  perform public.recompute_document_paid(_fac);
  insert into _t(check_name, result) values
    ('avoir total : statut avoir_emis fige', case when (select status from public.documents where id = _fac) = 'avoir_emis' then 'ok' else 'FAIL' end),
    ('avoir total : facture toujours au journal', case when exists (select 1 from public.sales_journal(_co, current_date, current_date) j where j.document_id = _fac and j.status = 'avoir_emis') then 'ok' else 'FAIL' end);

  -- ---------------------------------------------- correction des donnees : facture annulee par un avoir
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAC', 'brouillon', _b2b, current_date, 100, 21, 121, 'ht') returning id into _old;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_old, 'TEST ancienne', 1, 100, 21, 100, 121, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'FAC') where id = _old;
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode, source_document_id)
  values (_co, 'AVO', 'brouillon', _b2b, current_date, -100, -21, -121, 'ht', _old) returning id into _oldavo;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_oldavo, 'TEST ancienne', -1, 100, 21, -100, -121, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'AVO') where id = _oldavo;
  update public.documents set status = 'annulee' where id = _old;   -- ancien comportement (generateCreditNote, remboursement Shopify)
  insert into _t(check_name, result) values
    ('garde-fou : annuler une facture compensee par un avoir → avoir_emis', case when (select status from public.documents where id = _old) = 'avoir_emis' then 'ok' else 'FAIL' end);
  perform set_config('test.old', _old::text, true);

  -- ---------------------------------------------- particulier sans moto : sur demande seulement
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'DEV', 'brouillon', _b2c, current_date, 100, 21, 121, 'ttc') returning id into _dev;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_dev, 'TEST casque', 1, 100, 21, 100, 121, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'DEV') where id = _dev;
  insert into public.document_payments (document_id, method, amount, status, note) values (_dev, 'VIR', 50, 'recu', 'Acompte') returning id into _pay2;
  insert into _t(check_name, result) values
    ('particulier sans moto : pas de FAA automatique', case when public._deposit_invoice_for_payment(_pay2) is null then 'ok' else 'FAIL' end);
  _faa2 := public.deposit_invoice_create(_pay2);
  insert into _t(check_name, result) values
    ('particulier : FAA sur demande', case when (select doc_type from public.documents where id = _faa2) = 'FAA' then 'ok' else 'FAIL' end),
    ('numerotation FAA continue', case when (select count(distinct number) from public.documents where id in (_faa.id, _faa2)) = 2 then 'ok' else 'FAIL' end);
  perform set_config('test.res', _res::text, true);
end $s$;

reset role;

-- Correction des donnees (bloc 3 de la migration, rejoue) : idempotente et tracee
do $do$
declare r record;
begin
  for r in
    select d.id, d.company_id, a.number as credit_number from public.documents d
      join lateral (select a.number from public.documents a where a.source_document_id = d.id and a.doc_type = 'AVO'
                     and a.status not in ('brouillon', 'annulee') order by a.created_at desc limit 1) a on true
     where d.doc_type in ('FAC', 'TIK') and d.status = 'annulee'
  loop
    update public.documents set status = 'avoir_emis' where id = r.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (r.company_id, null, 'credit_note_fix', 'documents', r.id::text, 'system',
            jsonb_build_object('status', 'annulee'), jsonb_build_object('status', 'avoir_emis', 'credit_note', r.credit_number));
  end loop;
end $do$;
insert into _t(check_name, result) values
  ('correction : facture annulee par avoir → avoir_emis', case when (select status from public.documents where id = current_setting('test.old')::uuid) = 'avoir_emis' then 'ok' else 'FAIL' end),
  ('correction tracee (events credit_note_fix)', case when exists (select 1 from public.events where entity_id = current_setting('test.old') and action = 'credit_note_fix') then 'ok' else 'FAIL' end);

-- Rappel cloche : acompte du mois dernier sans facture d acompte (automatisme non joue :
-- reglement ecrit par une fonction serveur, sans utilisateur)
select set_config('request.jwt.claims', '', true);
do $s$
declare _co uuid := current_setting('test.co')::uuid; _b2b uuid := current_setting('test.b2b')::uuid; _bc uuid; _p uuid; _ok boolean;
begin
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode, number)
  values (_co, 'BC', 'brouillon', _b2b, current_date, 100, 21, 121, 'ht', null) returning id into _bc;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_bc, 'TEST piece', 1, 100, 21, 100, 121, 0, 'article');
  update public.documents set status = 'validee', number = 'BC-TEST-' || left(_bc::text, 8) where id = _bc;
  insert into public.document_payments (document_id, method, amount, status, note, paid_at)
  values (_bc, 'VIR', 60, 'recu', 'Acompte', date_trunc('month', now()) - interval '3 days') returning id into _p;
  _ok := public._sales_deposit_invoice_alert(_p);
  insert into _t(check_name, result) values
    ('cloche : rappel deposit_invoice_due cree', case when _ok and exists (select 1 from public.team_notifications where kind = 'deposit_invoice_due' and dedupe_key = _p::text) then 'ok' else 'FAIL' end),
    ('cloche : echeance le 15 du mois suivant', case when (select (payload->>'deadline')::date from public.team_notifications where dedupe_key = _p::text and kind = 'deposit_invoice_due')
       = (date_trunc('month', (date_trunc('month', now()) - interval '3 days')) + interval '1 month 14 days')::date then 'ok' else 'FAIL' end),
    ('cloche : regle de visibilite deposit_invoice_due', case when (select prosrc from pg_proc where proname = 'can_see_team_notification') ~ 'deposit_invoice_due' then 'ok' else 'FAIL' end),
    ('cloche : alertes existantes conservees (web_order, maintenance_due)', case when (select prosrc from pg_proc where proname = 'can_see_team_notification') ~ 'web_order'
       and (select prosrc from pg_proc where proname = 'can_see_team_notification') ~ 'maintenance_due'
       and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'team_notifications_kind_check') ~ 'maintenance_due' then 'ok' else 'FAIL' end);
  perform set_config('test.p', _p::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
select public.deposit_invoice_create(current_setting('test.p')::uuid);
reset role;
select public._sales_resolve_deposit_invoice_alerts();
insert into _t(check_name, result) values
  ('cloche : rappel resolu une fois la FAA emise', case when (select resolved_at from public.team_notifications where kind = 'deposit_invoice_due' and dedupe_key = current_setting('test.p')) is not null then 'ok' else 'FAIL' end),
  ('registre de la marge : vente compensee par un avoir conservee', case when (select prosrc from pg_proc where proname = 'vo_margin_register') ~ 'avoir_emis' then 'ok' else 'FAIL' end),
  ('registre TVA : documents en marge toujours exclus (lot ef3f953)', case when (select prosrc from pg_proc where proname = 'vat_register') ~ 'vat_scheme <> ''marge''' then 'ok' else 'FAIL' end),
  ('anon n execute pas deposit_invoice_create', case when has_function_privilege('anon', 'public.deposit_invoice_create(uuid)', 'execute') then 'FAIL' else 'ok' end);

select n, check_name, result from _t order by n;
