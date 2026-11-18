-- =====================================================================
-- M12 — Fonctions comptables reservees a l'administrateur et au comptable (rattrapage G8, 18/11/2026).
-- Bloquant n° 4 de docs/g8-inventaire comparaison-ventes-caisse-compta.md ; carte F1 de la mission 13.
-- Grille des droits signee (M0-RBAC003, 13/10/2026) : Comptabilite = comptable en ecriture, aucun
-- autre role (l'administrateur a tout). Jusqu'ici les fonctions ne controlaient que l'appartenance a
-- la societe : un mecanicien ou un vendeur pouvait, par l'API, cloturer une periode, deplacer la date
-- de bascule, generer les ecritures ou marquer une facture payee par domiciliation.
--
-- Ce que pose cette migration :
--   1. `can_manage_accounting(societe)` : administrateur ou comptable de la societe. Sans utilisateur
--      connecte, seuls la cle de service et les taches internes (pg_cron, psql) passent ; un visiteur
--      anonyme ou un jeton sans utilisateur est refuse.
--   2. Chaque fonction comptable est ENVELOPPEE (sans recopier son corps, qui differe selon les
--      migrations appliquees) : la fonction d'origine est renommee `_<nom>_acct` (cle de service
--      uniquement) et une fonction du meme nom, meme signature, verifie le role puis l'appelle.
--      Refus = erreur 42501 « accounting_forbidden ». Fonctions couvertes (si elles existent en base) :
--        cloture         close_fiscal_year, pending_deposits, pending_effects
--        ecritures       generate_accounting_entries, generate_sales_entries, generate_payment_entries,
--                        generate_margin_period_entries, generate_auxiliary_accounts
--        date de bascule set_accounting_cutover
--        SEPA            sepa_collectable, record_sepa_collection, record_sepa_unpaid, et les remises SEPA du
--                        lot encaissements (sepa_collectable_installments, sepa_batch_create, sepa_batch_set_xml,
--                        sepa_batch_archive, sepa_batch_cancel, sepa_item_unpaid ; 20261118173000)
--        journaux        sales_journal, vat_register, vo_margin_register, vo_margin_summary,
--                        vo_margin_purchases, vo_margin_periods
--      Restent ouvertes : `debtors_list` (lue par la fiche client) et l'export UBL d'une facture (M6).
--   3. Tables comptables (RLS) : ecritures, lignes d'ecriture, plan comptable, correspondances de
--      comptes, mandats SEPA = admin / comptable seulement ; journal des exports (transfert) = admin /
--      comptable, sauf l'inscription d'un export UBL fait depuis une facture (tout membre) ; remises SEPA
--      (lecture) = admin / comptable ; clotures :
--      lecture par tout membre, ecriture admin / comptable.
--   4. `_install_accounting_guard(fonction, expression societe)` reste disponible : une migration
--      future qui REDEFINIT une fonction couverte (create or replace) remplace l'enveloppe et perd le
--      controle ; elle doit se terminer par
--        select public._install_accounting_guard('public.<nom>(<types>)'::regprocedure, '_company');
--      (test tests/compta-reservee.test.ts : il refuse une telle migration sans cet appel).
--
-- Idempotente (une fonction deja enveloppee est laissee telle quelle). NON APPLIQUEE. A appliquer
-- APRES 20261103160000 et 20261103180000 (qui redefinissent vat_register, sales_journal, etc.) ;
-- si elles sont appliquees plus tard, relancer ce fichier. Essai a blanc : supabase/tests/m12_compta_reservee.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Qui peut faire de la comptabilite
-- ---------------------------------------------------------------------
create or replace function public.can_manage_accounting(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when auth.uid() is null then
      -- Pas d'utilisateur : cle de service ou tache interne (aucun jeton) seulement.
      coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
               nullif(current_setting('request.jwt.claim.role', true), ''),
               'service_role') = 'service_role'
    else exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid() and ur.company_id = _company
         and ur.role::text in ('admin', 'comptable'))
  end;
$$;
revoke all on function public.can_manage_accounting(uuid) from public, anon;
grant execute on function public.can_manage_accounting(uuid) to authenticated, service_role;
comment on function public.can_manage_accounting(uuid) is
  'M12 : administrateur ou comptable de la societe (grille signee M0-RBAC003). Sans utilisateur : cle de service ou tache interne uniquement.';

create or replace function public._assert_accounting_role(_company uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.can_manage_accounting(_company) then
    raise exception 'accounting_forbidden: reserve a l administrateur et au comptable'
      using errcode = '42501';
  end if;
end $$;
revoke all on function public._assert_accounting_role(uuid) from public, anon;
grant execute on function public._assert_accounting_role(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Enveloppe : renomme la fonction d'origine et pose une fonction de controle a sa place
-- ---------------------------------------------------------------------
create or replace function public._install_accounting_guard(_fn regprocedure, _company_expr text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _name text; _args text; _iargs text; _ret text; _retset boolean; _names text[]; _nargs int; _src text;
  _inner text; _call text; _body text;
begin
  select p.proname, pg_get_function_arguments(p.oid), pg_get_function_identity_arguments(p.oid),
         pg_get_function_result(p.oid), p.proretset, p.proargnames, p.pronargs, p.prosrc
    into _name, _args, _iargs, _ret, _retset, _names, _nargs, _src
    from pg_proc p where p.oid = _fn;
  if _name is null then return 'absente'; end if;
  if _src like '%accounting_guard_wrapper%' then return 'deja protegee'; end if;
  if _nargs > 0 and (_names is null or array_length(_names, 1) < _nargs) then
    raise exception 'accounting guard: % a des arguments sans nom', _fn;
  end if;

  _inner := '_' || _name || '_acct';
  -- La fonction a ete redefinie apres une premiere protection : l'ancienne copie interne est perimee.
  execute format('drop function if exists public.%I(%s)', _inner, _iargs);
  execute format('alter function public.%I(%s) rename to %I', _name, _iargs, _inner);
  execute format('revoke all on function public.%I(%s) from public, anon, authenticated', _inner, _iargs);
  execute format('grant execute on function public.%I(%s) to service_role', _inner, _iargs);

  _call := format('public.%I(%s)', _inner,
                  coalesce((select string_agg(quote_ident(n), ', ' order by i)
                              from unnest(_names[1:_nargs]) with ordinality as u(n, i)), ''));
  _body := '-- accounting_guard_wrapper (M12, 20261118182000) : role admin / comptable obligatoire' || chr(10)
        || format('select public._assert_accounting_role(%s);', _company_expr) || chr(10)
        || case when _ret = 'void' then format('select %s;', _call)
                when _retset then format('select * from %s;', _call)
                else format('select %s;', _call) end;
  execute format('create function public.%I(%s) returns %s language sql volatile security definer set search_path = public, pg_temp as %L',
                 _name, _args, _ret, _body);
  execute format('revoke all on function public.%I(%s) from public, anon', _name, _iargs);
  execute format('grant execute on function public.%I(%s) to authenticated, service_role', _name, _iargs);
  execute format('comment on function public.%I(%s) is %L', _name, _iargs,
                 'M12 : reserve a l administrateur et au comptable (enveloppe de public.' || _inner || ').');
  return 'protegee';
end $$;
revoke all on function public._install_accounting_guard(regprocedure, text) from public, anon, authenticated;

do $g$
declare
  r record;
  _p regprocedure;
  _doc text := '(select d.company_id from public.documents d where d.id = _document)';
  _batch text := '(select b.company_id from public.sepa_batches b where b.id = _batch)';
begin
  for r in
    select * from (values
      ('public.close_fiscal_year(uuid, date, date, text)', '_company'),
      ('public.pending_deposits(uuid)', '_company'),
      ('public.pending_effects(uuid, date)', '_company'),
      ('public.generate_accounting_entries(uuid, date, date)', '_company'),
      ('public.generate_sales_entries(uuid, date, date)', '_company'),
      ('public.generate_payment_entries(uuid, date, date)', '_company'),
      ('public.generate_margin_period_entries(uuid, date, date)', '_company'),
      ('public.generate_auxiliary_accounts(uuid)', '_company'),
      ('public.set_accounting_cutover(uuid, date)', '_company'),
      ('public.sepa_collectable(uuid, date)', '_company'),
      ('public.record_sepa_collection(uuid, numeric)', _doc),
      ('public.record_sepa_unpaid(uuid, numeric)', _doc),
      -- remises SEPA du lot encaissements (20261118173000), si posees
      ('public.sepa_collectable_installments(uuid, date, date, uuid)', '_company'),
      ('public.sepa_batch_create(uuid, date, uuid[], uuid[])', '_company'),
      ('public.sepa_batch_set_xml(uuid, text)', _batch),
      ('public.sepa_batch_archive(uuid)', _batch),
      ('public.sepa_batch_cancel(uuid, text)', _batch),
      ('public.sepa_item_unpaid(uuid, text)', '(select i.company_id from public.sepa_batch_items i where i.id = _item)'),
      ('public.sales_journal(uuid, date, date)', '_company'),
      ('public.vat_register(uuid, date, date)', '_company'),
      ('public.vo_margin_register(uuid, date, date)', '_company'),
      ('public.vo_margin_summary(uuid, date, date)', '_company'),
      ('public.vo_margin_purchases(uuid, date, date)', '_company'),
      ('public.vo_margin_periods(uuid, date, date, text)', '_company')
    ) as t(sig, company_expr)
  loop
    _p := to_regprocedure(r.sig);
    if _p is null then
      raise notice 'compta reservee : % absente (migration non appliquee ?), ignoree', r.sig;
    else
      raise notice 'compta reservee : % -> %', r.sig, public._install_accounting_guard(_p, r.company_expr);
    end if;
  end loop;
end $g$;

-- Vue de declaration TVA marge (20261103160000) : uniquement les societes ou l'on est admin / comptable
-- (sinon l'appel protege de vo_margin_periods refuserait toute la vue).
do $v$
begin
  if to_regclass('public.v_vo_margin_declaration') is not null then
    execute $view$
      create or replace view public.v_vo_margin_declaration with (security_invoker = true) as
        select c.id as company_id, p.period_key, p.period_start, p.period_end,
               p.count_sales, p.count_purchases, p.sales, p.purchases, p.carried_in, p.margin,
               p.base_ht, p.vat_due, p.carried_out,
               public._vat_margin_setting(c.id, 'grid_sales', '00') as grid_sales,
               public._vat_margin_setting(c.id, 'grid_base', '03') as grid_base,
               public._vat_margin_setting(c.id, 'grid_vat', '54') as grid_vat
        from (select co.id from public.companies co
               where public.is_member(co.id) and public.can_manage_accounting(co.id)) c
        cross join lateral public.vo_margin_periods(c.id, date '1900-01-01', current_date, null) p
    $view$;
  end if;
end $v$;

-- ---------------------------------------------------------------------
-- 3. Tables comptables : lecture et ecriture reservees (RLS)
-- ---------------------------------------------------------------------
do $r$
begin
  -- Ecritures comptables
  if to_regclass('public.accounting_entries') is not null then
    drop policy if exists acctentry_all on public.accounting_entries;
    create policy acctentry_all on public.accounting_entries for all to authenticated
      using (public.can_manage_accounting(company_id)) with check (public.can_manage_accounting(company_id));
  end if;
  if to_regclass('public.accounting_entry_lines') is not null then
    drop policy if exists acctline_all on public.accounting_entry_lines;
    create policy acctline_all on public.accounting_entry_lines for all to authenticated
      using (exists (select 1 from public.accounting_entries e where e.id = entry_id and public.can_manage_accounting(e.company_id)))
      with check (exists (select 1 from public.accounting_entries e where e.id = entry_id and public.can_manage_accounting(e.company_id)));
  end if;
  -- Plan comptable et correspondances de comptes
  if to_regclass('public.chart_of_accounts') is not null then
    drop policy if exists coa_all on public.chart_of_accounts;
    create policy coa_all on public.chart_of_accounts for all to authenticated
      using (public.can_manage_accounting(company_id)) with check (public.can_manage_accounting(company_id));
  end if;
  if to_regclass('public.account_mappings') is not null then
    drop policy if exists acctmap_all on public.account_mappings;
    create policy acctmap_all on public.account_mappings for all to authenticated
      using (public.can_manage_accounting(company_id)) with check (public.can_manage_accounting(company_id));
  end if;
  -- Mandats SEPA (IBAN des clients)
  if to_regclass('public.sepa_mandates') is not null then
    drop policy if exists sepa_mandates_all on public.sepa_mandates;
    create policy sepa_mandates_all on public.sepa_mandates for all to authenticated
      using (public.can_manage_accounting(company_id)) with check (public.can_manage_accounting(company_id));
  end if;
  -- Remises SEPA (lot encaissements 20261118173000) : lecture reservee comme les mandats.
  if to_regclass('public.sepa_batches') is not null then
    drop policy if exists sepa_batches_select on public.sepa_batches;
    create policy sepa_batches_select on public.sepa_batches for select to authenticated
      using (public.can_manage_accounting(company_id));
  end if;
  if to_regclass('public.sepa_batch_items') is not null then
    drop policy if exists sepa_items_select on public.sepa_batch_items;
    create policy sepa_items_select on public.sepa_batch_items for select to authenticated
      using (public.can_manage_accounting(company_id));
  end if;
  -- Journal des exports (transfert comptable) : l'export UBL d'une facture reste ouvert aux membres.
  if to_regclass('public.accounting_exports') is not null then
    drop policy if exists acctexports_all on public.accounting_exports;
    drop policy if exists acctexports_read on public.accounting_exports;
    drop policy if exists acctexports_insert on public.accounting_exports;
    drop policy if exists acctexports_update on public.accounting_exports;
    drop policy if exists acctexports_delete on public.accounting_exports;
    create policy acctexports_read on public.accounting_exports for select to authenticated
      using (public.can_manage_accounting(company_id));
    create policy acctexports_insert on public.accounting_exports for insert to authenticated
      with check (public.can_manage_accounting(company_id) or (kind = 'ubl' and public.is_member(company_id)));
    create policy acctexports_update on public.accounting_exports for update to authenticated
      using (public.can_manage_accounting(company_id)) with check (public.can_manage_accounting(company_id));
    create policy acctexports_delete on public.accounting_exports for delete to authenticated
      using (public.can_manage_accounting(company_id));
  end if;
  -- Clotures : tout membre voit qu'une periode est close ; seul admin / comptable cloture.
  if to_regclass('public.fiscal_closures') is not null then
    drop policy if exists fiscal_closures_all on public.fiscal_closures;
    drop policy if exists fiscal_closures_read on public.fiscal_closures;
    drop policy if exists fiscal_closures_write on public.fiscal_closures;
    drop policy if exists fiscal_closures_update on public.fiscal_closures;
    drop policy if exists fiscal_closures_delete on public.fiscal_closures;
    create policy fiscal_closures_read on public.fiscal_closures for select to authenticated
      using (public.is_member(company_id));
    create policy fiscal_closures_write on public.fiscal_closures for insert to authenticated
      with check (public.can_manage_accounting(company_id));
    create policy fiscal_closures_update on public.fiscal_closures for update to authenticated
      using (public.can_manage_accounting(company_id)) with check (public.can_manage_accounting(company_id));
    create policy fiscal_closures_delete on public.fiscal_closures for delete to authenticated
      using (public.can_manage_accounting(company_id));
  end if;
end $r$;

-- Grille en base (20261013140000, si appliquee) : les mandats SEPA s'ecrivent depuis la Comptabilite.
do $w$
begin
  if to_regclass('public.table_write_pages') is not null then
    insert into public.table_write_pages (table_name, page) values ('sepa_mandates', '/accounting')
    on conflict do nothing;
  end if;
end $w$;
