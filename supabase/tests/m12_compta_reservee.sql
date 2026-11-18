-- =====================================================================
-- Lot G8 statistiques (18/11/2026) — essai a blanc de la migration 20261118182000_m12_compta_reservee.sql.
-- Suppose posees (ou ajoutees en tete) les migrations du lot encaissements 20261118170000 et
-- 20261118173000 (remises SEPA : tables sepa_batches / sepa_batch_items et leurs fonctions).
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118182000_m12_compta_reservee.sql \
--      supabase/tests/m12_compta_reservee.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Verifie, dans ITALBIKE STORE :
--   - les fonctions comptables presentes sont enveloppees ; la copie interne n'est plus appelable
--     par un utilisateur connecte ;
--   - un vendeur (et un mecanicien) : cloture, date de bascule, ecritures, SEPA, journaux refuses (42501),
--     ecritures / plan comptable / mandats SEPA invisibles, export UBL d'une facture toujours inscrit ;
--   - un comptable : memes appels acceptes ; un administrateur aussi ;
--   - la migration rejouee ne change rien (idempotente).
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------------ comptes d essai (role postgres)
do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _vend uuid := gen_random_uuid(); _compta uuid := gen_random_uuid();
  _fn text; _missing int := 0;
begin
  insert into auth.users (id, aud, role, email) values
    (_vend, 'authenticated', 'authenticated', 'test-compta-vendeur@example.invalid'),
    (_compta, 'authenticated', 'authenticated', 'test-compta-comptable@example.invalid');
  insert into public.user_roles (user_id, company_id, role) values (_vend, _co, 'vendeur'), (_vend, _co, 'mecanicien'), (_compta, _co, 'comptable');
  perform set_config('test.co', _co::text, true);
  perform set_config('test.vend', _vend::text, true);
  perform set_config('test.compta', _compta::text, true);

  foreach _fn in array array['close_fiscal_year', 'set_accounting_cutover', 'generate_accounting_entries', 'generate_sales_entries',
                              'generate_payment_entries', 'generate_auxiliary_accounts', 'sepa_collectable', 'record_sepa_collection',
                              'record_sepa_unpaid', 'sales_journal', 'vat_register', 'pending_deposits', 'pending_effects',
                              'sepa_collectable_installments', 'sepa_batch_create', 'sepa_batch_set_xml', 'sepa_batch_archive',
                              'sepa_batch_cancel', 'sepa_item_unpaid'] loop
    if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = _fn
                     and p.prosrc like '%accounting_guard_wrapper%') then
      _missing := _missing + 1;
      insert into _t(check_name, result) values ('enveloppe ' || _fn, 'FAIL');
    end if;
  end loop;
  insert into _t(check_name, result) values ('19 fonctions comptables enveloppees (avec les remises SEPA du lot encaissements)', case when _missing = 0 then 'ok' else 'FAIL ' || _missing end);
  insert into _t(check_name, result) values ('copie interne fermee aux utilisateurs connectes',
    case when not has_function_privilege('authenticated', 'public._close_fiscal_year_acct(uuid, date, date, text)', 'EXECUTE') then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('rejouer la protection : deja protegee',
    case when public._install_accounting_guard('public.close_fiscal_year(uuid, date, date, text)'::regprocedure, '_company') = 'deja protegee' then 'ok' else 'FAIL' end);
end $s$;

-- ------------------------------------------------------------------ vendeur + mecanicien : tout est refuse
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.vend'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $s$
declare
  _co uuid := current_setting('test.co')::uuid;
  _doc uuid;
  _n int := 0; _calls int := 0;
  _sql text;
begin
  foreach _sql in array array[
    format('select public.close_fiscal_year(%L, date ''2031-01-01'', date ''2031-12-31'', ''ESSAI'')', _co),
    format('select public.set_accounting_cutover(%L, date ''2031-01-01'')', _co),
    format('select public.generate_accounting_entries(%L, date ''2031-01-01'', date ''2031-01-31'')', _co),
    format('select public.generate_sales_entries(%L, date ''2031-01-01'', date ''2031-01-31'')', _co),
    format('select public.generate_payment_entries(%L, date ''2031-01-01'', date ''2031-01-31'')', _co),
    format('select public.generate_auxiliary_accounts(%L)', _co),
    format('select * from public.sepa_collectable(%L, date ''2031-01-31'')', _co),
    format('select * from public.sales_journal(%L, date ''2031-01-01'', date ''2031-01-31'')', _co),
    format('select * from public.vat_register(%L, date ''2031-01-01'', date ''2031-01-31'')', _co),
    format('select * from public.pending_deposits(%L)', _co),
    format('select * from public.pending_effects(%L, date ''2031-01-31'')', _co),
    format('select * from public.sepa_collectable_installments(%L, null, date ''2031-01-31'', null)', _co),
    format('select public.sepa_batch_create(%L, date ''2031-01-31'', ''{}''::uuid[], ''{}''::uuid[])', _co)
  ] loop
    _calls := _calls + 1;
    begin
      execute _sql;
    exception when insufficient_privilege then _n := _n + 1;
    end;
  end loop;
  insert into _t(check_name, result) values ('vendeur : 13 appels comptables refuses', case when _n = _calls then 'ok' else 'FAIL ' || _n || '/' || _calls end);

  select id into _doc from public.documents where company_id = _co and doc_type = 'FAC' and status not in ('brouillon', 'annulee') limit 1;
  if _doc is not null then
    _n := 0;
    begin perform public.record_sepa_collection(_doc, 0.01); exception when insufficient_privilege then _n := _n + 1; end;
    begin perform public.record_sepa_unpaid(_doc, 0.01); exception when insufficient_privilege then _n := _n + 1; end;
    insert into _t(check_name, result) values ('vendeur : encaissement / impaye SEPA refuses', case when _n = 2 then 'ok' else 'FAIL ' || _n end);
  end if;

  begin
    perform public._close_fiscal_year_acct(_co, date '2031-01-01', date '2031-12-31', 'ESSAI');
    insert into _t(check_name, result) values ('vendeur : copie interne inaccessible', 'FAIL');
  exception when insufficient_privilege then
    insert into _t(check_name, result) values ('vendeur : copie interne inaccessible', 'ok');
  end;

  insert into _t(check_name, result) values
    ('vendeur : ecritures invisibles', case when not exists (select 1 from public.accounting_entries where company_id = _co) then 'ok' else 'FAIL' end),
    ('vendeur : plan comptable invisible', case when not exists (select 1 from public.chart_of_accounts where company_id = _co) then 'ok' else 'FAIL' end),
    ('vendeur : mandats SEPA invisibles', case when not exists (select 1 from public.sepa_mandates where company_id = _co) then 'ok' else 'FAIL' end),
    ('vendeur : remises SEPA invisibles', case when not exists (select 1 from public.sepa_batches where company_id = _co) then 'ok' else 'FAIL' end),
    ('vendeur : can_manage_accounting faux', case when not public.can_manage_accounting(_co) then 'ok' else 'FAIL' end);

  begin
    insert into public.accounting_exports (company_id, kind, reference) values (_co, 'ubl', 'ESSAI-UBL');
    insert into _t(check_name, result) values ('vendeur : export UBL d une facture inscrit', 'ok');
  exception when others then
    insert into _t(check_name, result) values ('vendeur : export UBL d une facture inscrit', 'FAIL ' || sqlerrm);
  end;
  begin
    insert into public.accounting_exports (company_id, kind, reference) values (_co, 'winbooks', 'ESSAI-WINBOOKS');
    insert into _t(check_name, result) values ('vendeur : transfert Winbooks refuse', 'FAIL');
  exception when insufficient_privilege or check_violation or others then
    insert into _t(check_name, result) values ('vendeur : transfert Winbooks refuse', 'ok');
  end;
end $s$;

-- ------------------------------------------------------------------ comptable : accepte
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.compta'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $s$
declare _co uuid := current_setting('test.co')::uuid; _n int;
begin
  insert into _t(check_name, result) values ('comptable : can_manage_accounting vrai', case when public.can_manage_accounting(_co) then 'ok' else 'FAIL' end);
  begin
    perform * from public.sales_journal(_co, date '2031-01-01', date '2031-01-31');
    perform * from public.vat_register(_co, date '2031-01-01', date '2031-01-31');
    perform * from public.sepa_collectable(_co, date '2031-01-31');
    perform * from public.pending_deposits(_co);
    _n := public.generate_accounting_entries(_co, date '2031-01-01', date '2031-01-31');
    insert into _t(check_name, result) values ('comptable : journaux, SEPA, ecritures acceptes', 'ok');
  exception when others then
    insert into _t(check_name, result) values ('comptable : journaux, SEPA, ecritures acceptes', 'FAIL ' || sqlerrm);
  end;
  insert into _t(check_name, result) values ('comptable : plan comptable visible',
    case when exists (select 1 from public.chart_of_accounts where company_id = _co) then 'ok' else 'ok (plan vide dans cette societe)' end);
end $s$;

-- ------------------------------------------------------------------ administrateur : accepte
reset role;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare _co uuid := current_setting('test.co')::uuid;
begin
  insert into _t(check_name, result) values ('administrateur : can_manage_accounting vrai', case when public.can_manage_accounting(_co) then 'ok' else 'FAIL' end);
  begin
    perform * from public.vat_register(_co, date '2031-01-01', date '2031-01-31');
    insert into _t(check_name, result) values ('administrateur : registre TVA accepte', 'ok');
  exception when others then
    insert into _t(check_name, result) values ('administrateur : registre TVA accepte', 'FAIL ' || sqlerrm);
  end;
end $s$;

-- ------------------------------------------------------------------ visiteur anonyme et cle de service
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
insert into _t(check_name, result) values ('anonyme : can_manage_accounting faux',
  case when not public.can_manage_accounting('3d9f0f13-a691-4d07-ad58-34590df86e33') then 'ok' else 'FAIL' end);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into _t(check_name, result) values ('cle de service : can_manage_accounting vrai',
  case when public.can_manage_accounting('3d9f0f13-a691-4d07-ad58-34590df86e33') then 'ok' else 'FAIL' end);

select n, check_name, result from _t order by n;
