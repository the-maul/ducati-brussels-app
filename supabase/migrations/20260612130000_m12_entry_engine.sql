-- =====================================================================
-- M12 — Moteur de génération d'ÉCRITURES COMPTABLES équilibrées (P0.2).
-- G8 ne « tient pas les livres » mais GÉNÈRE de vraies écritures (ventilation par
-- compte vente selon catégorie×TVA, comptes auxiliaires clients, TVA collectée,
-- règlements sur trésorerie+journal) avant export. C'est ce qu'on construit ici.
--
-- Append-only (B7) : les écritures sont des pièces générées, jamais modifiées en
-- place. Idempotent : (company_id, source, source_id) unique -> re-générer ne
-- duplique pas. Le comptable affine les comptes via account_mappings (P0.2 commit 4).
-- =====================================================================

-- En-tête de pièce comptable
create table if not exists public.accounting_entries (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  journal_code text not null,                       -- VEN / ACH / FIN / OD
  entry_date   date not null,
  doc_type     text,                                -- FAC / TIK / AVO / RGT…
  doc_number   text,
  source       text not null,                       -- 'sales' | 'payment' | 'purchase'
  source_id    text not null,                       -- document_id ou payment id (texte)
  label        text,
  transferred_at timestamptz,                        -- horodatage d'export (transfert compta)
  created_at   timestamptz not null default now(),
  unique (company_id, source, source_id)
);
create index if not exists idx_acctentry_company on public.accounting_entries(company_id, entry_date);

-- Lignes de pièce (débit/crédit)
create table if not exists public.accounting_entry_lines (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null references public.accounting_entries(id) on delete cascade,
  line_no       int not null default 0,
  account_code  text not null,
  account_label text,
  auxiliary_code text,                              -- compte tiers (client/fournisseur) réel
  debit         numeric(14,2) not null default 0,
  credit        numeric(14,2) not null default 0,
  vat_rate      numeric(6,2),
  analytic_code text,
  label         text
);
create index if not exists idx_acctline_entry on public.accounting_entry_lines(entry_id);

drop trigger if exists trg_acctentry_audit on public.accounting_entries;
create trigger trg_acctentry_audit after insert or update or delete on public.accounting_entries for each row execute function public.audit_row();

alter table public.accounting_entries      enable row level security;
alter table public.accounting_entry_lines  enable row level security;
drop policy if exists acctentry_all on public.accounting_entries;
create policy acctentry_all on public.accounting_entries for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists acctline_all on public.accounting_entry_lines;
create policy acctline_all on public.accounting_entry_lines for all to authenticated
  using (exists (select 1 from public.accounting_entries e where e.id = entry_id and public.is_member(e.company_id)))
  with check (exists (select 1 from public.accounting_entries e where e.id = entry_id and public.is_member(e.company_id)));

-- Libellé d'un compte (depuis le plan comptable, sinon le code).
create or replace function public._account_label(_company uuid, _code text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select label from public.chart_of_accounts where company_id = _company and code = _code), _code);
$$;

-- ---------------------------------------------------------------------
-- Génère les écritures de VENTE d'une période (FAC/TIK/AVO non encore écriturés).
--   Débit  : compte client (auxiliaire réel) pour le TTC
--   Crédit : ventes ventilées par (compte selon catégorie) × taux de TVA (HT)
--   Crédit : TVA collectée par taux
-- Pour un AVO (avoir), sens inversé. Résidu (port/remise/arrondi) sur comptes par
-- défaut pour garantir l'équilibre exact débit=crédit.
-- ---------------------------------------------------------------------
create or replace function public.generate_sales_entries(_company uuid, _from date, _to date)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d record; b record; _entry uuid; _ln int; _rev boolean;
  _cust_acct text; _cust_aux text; _ttc numeric; _ht numeric; _vat numeric;
  _sum_ht numeric; _sum_vat numeric; _res_ht numeric; _res_vat numeric; _count int := 0;
begin
  -- Garde d'accès pour un appel authentifié (comptable) ; le service role (cron/
  -- transfert serveur, auth.uid() null) est autorisé.
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;

  for d in
    select doc.id, doc.doc_type, doc.number, doc.issue_date, doc.contact_id,
           abs(doc.total_ht) ht, abs(doc.total_vat) vat, abs(doc.total_ttc) ttc
    from public.documents doc
    where doc.company_id = _company and doc.doc_type in ('FAC','TIK','AVO')
      and doc.status <> 'annulee' and doc.issue_date between _from and _to
      and not exists (select 1 from public.accounting_entries e
                      where e.company_id = _company and e.source = 'sales' and e.source_id = doc.id::text)
  loop
    if d.ttc = 0 then continue; end if;
    _rev := (d.doc_type = 'AVO');            -- avoir : sens inversé
    _cust_acct := coalesce(public.resolve_account(_company, 'customer_collective', '*'), '400000');
    -- compte tiers réel = compte auxiliaire du client, sinon collectif
    select coalesce(nullif(account_code, ''), _cust_acct) into _cust_aux
      from public.contacts where id = d.contact_id;
    _cust_aux := coalesce(_cust_aux, _cust_acct);

    insert into public.accounting_entries (company_id, journal_code, entry_date, doc_type, doc_number, source, source_id, label)
    values (_company, coalesce(public.resolve_journal(_company,'sales','*'),'VEN'), d.issue_date, d.doc_type, d.number, 'sales', d.id::text,
            'Vente ' || coalesce(d.number, d.id::text))
    returning id into _entry;
    _ln := 0;

    -- Ligne client (TTC)
    insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, auxiliary_code, debit, credit, label)
    values (_entry, _ln, _cust_acct, public._account_label(_company,_cust_acct), _cust_aux,
            case when _rev then 0 else d.ttc end, case when _rev then d.ttc else 0 end,
            'Client ' || coalesce(d.number,''));
    _ln := _ln + 1;

    _sum_ht := 0; _sum_vat := 0;
    -- Ventes ventilées par compte (catégorie) × taux + TVA collectée par taux
    for b in
      select coalesce(public.resolve_account(_company,'sales', a.category_id::text), '700000') as sales_acct,
             l.vat_rate as rate,
             round(sum(abs(l.line_ht)),2) as ht,
             round(sum(abs(l.line_ttc - l.line_ht)),2) as vat
      from public.document_lines l
      left join public.articles a on a.id = l.article_id
      where l.document_id = d.id
      group by 1, 2
    loop
      if b.ht <> 0 then
        insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, vat_rate, label)
        values (_entry, _ln, b.sales_acct, public._account_label(_company,b.sales_acct),
                case when _rev then b.ht else 0 end, case when _rev then 0 else b.ht end, b.rate, 'Vente HT');
        _ln := _ln + 1; _sum_ht := _sum_ht + b.ht;
      end if;
      if b.vat <> 0 then
        declare _vacct text := coalesce(public.resolve_account(_company,'vat_collected', b.rate::text), '451000');
        begin
          insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, vat_rate, label)
          values (_entry, _ln, _vacct, public._account_label(_company,_vacct),
                  case when _rev then b.vat else 0 end, case when _rev then 0 else b.vat end, b.rate, 'TVA collectée');
          _ln := _ln + 1; _sum_vat := _sum_vat + b.vat;
        end;
      end if;
    end loop;

    -- Résidu (port, remise globale, net TTC forcé) -> comptes par défaut, pour équilibre exact.
    _res_ht := round(d.ht - _sum_ht, 2);
    _res_vat := round(d.vat - _sum_vat, 2);
    if abs(_res_ht) >= 0.01 then
      declare _sa text := coalesce(public.resolve_account(_company,'sales','*'),'700000');
      begin
        insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, label)
        values (_entry, _ln, _sa, public._account_label(_company,_sa),
                case when (_rev) = (_res_ht >= 0) then abs(_res_ht) else 0 end,
                case when (_rev) = (_res_ht >= 0) then 0 else abs(_res_ht) end, 'Port / remise / arrondi');
        _ln := _ln + 1;
      end;
    end if;
    if abs(_res_vat) >= 0.01 then
      declare _va text := coalesce(public.resolve_account(_company,'vat_collected','*'),'451000');
      begin
        insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, label)
        values (_entry, _ln, _va, public._account_label(_company,_va),
                case when (_rev) = (_res_vat >= 0) then abs(_res_vat) else 0 end,
                case when (_rev) = (_res_vat >= 0) then 0 else abs(_res_vat) end, 'TVA — arrondi');
      end;
    end if;
    _count := _count + 1;
  end loop;
  return _count;
end $$;
grant execute on function public.generate_sales_entries(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Génère les écritures de RÈGLEMENT (encaissements perçus) d'une période :
--   Débit trésorerie (compte selon mode) / Crédit client. Remboursement = inverse.
-- ---------------------------------------------------------------------
create or replace function public.generate_payment_entries(_company uuid, _from date, _to date)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; _entry uuid; _treas text; _journ text; _cust_acct text; _aux text; _amt numeric; _count int := 0;
begin
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  _cust_acct := coalesce(public.resolve_account(_company,'customer_collective','*'),'400000');

  for p in
    select pay.id, pay.method, pay.amount, pay.paid_at::date as pdate, doc.number, doc.contact_id
    from public.document_payments pay
    join public.documents doc on doc.id = pay.document_id
    where doc.company_id = _company and pay.status = 'recu'
      and doc.doc_type in ('FAC','TIK','AVO') and pay.amount <> 0
      and pay.paid_at::date between _from and _to
      and not exists (select 1 from public.accounting_entries e
                      where e.company_id = _company and e.source = 'payment' and e.source_id = pay.id::text)
  loop
    _treas := coalesce(public.resolve_account(_company,'payment', p.method), public.resolve_account(_company,'payment','*'), '550000');
    _journ := coalesce(public.resolve_journal(_company,'payment', p.method), public.resolve_journal(_company,'payment','*'), 'FIN');
    select coalesce(nullif(account_code,''), _cust_acct) into _aux from public.contacts where id = p.contact_id;
    _aux := coalesce(_aux, _cust_acct);
    _amt := abs(p.amount);

    insert into public.accounting_entries (company_id, journal_code, entry_date, doc_type, doc_number, source, source_id, label)
    values (_company, _journ, p.pdate, 'RGT', p.number, 'payment', p.id::text, 'Règlement ' || coalesce(p.number,''))
    returning id into _entry;

    -- p.amount > 0 : encaissement (débit trésorerie / crédit client) ; < 0 : remboursement (inverse)
    insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, label)
    values (_entry, 0, _treas, public._account_label(_company,_treas),
            case when p.amount > 0 then _amt else 0 end, case when p.amount > 0 then 0 else _amt end, 'Trésorerie ' || p.method);
    insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, auxiliary_code, debit, credit, label)
    values (_entry, 1, _cust_acct, public._account_label(_company,_cust_acct), _aux,
            case when p.amount > 0 then 0 else _amt end, case when p.amount > 0 then _amt else 0 end, 'Client ' || coalesce(p.number,''));
    _count := _count + 1;
  end loop;
  return _count;
end $$;
grant execute on function public.generate_payment_entries(uuid, date, date) to authenticated;

-- Wrapper : génère ventes + règlements, renvoie le total de pièces créées.
create or replace function public.generate_accounting_entries(_company uuid, _from date, _to date)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public.generate_sales_entries(_company, _from, _to) + public.generate_payment_entries(_company, _from, _to);
end $$;
grant execute on function public.generate_accounting_entries(uuid, date, date) to authenticated;
