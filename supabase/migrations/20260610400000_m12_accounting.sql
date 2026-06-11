-- =====================================================================
-- M12 — Comptabilité & exports. Données vendeur pour l'UBL/Peppol (via Falco) +
-- comptes par défaut pour l'export Winbooks. On NE fige PAS d'hypothèses comptables :
-- tout est paramétrable et auditable (le comptable corrige après coup, CLAUDE.md §5).
-- =====================================================================

alter table public.companies
  add column if not exists iban                     text,
  add column if not exists peppol_id                text,                       -- ex. '9925:BE0123456789' (scheme:participant)
  add column if not exists sales_account_default     text not null default '700000',  -- compte de vente par défaut
  add column if not exists customer_account_default  text not null default '400000',  -- compte client collectif par défaut
  add column if not exists vat_account_default        text not null default '451000';  -- compte TVA due par défaut

-- Journal des exports comptables générés (traçabilité B7).
create table if not exists public.accounting_exports (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  kind        text not null,                         -- 'ubl' | 'winbooks'
  reference   text,                                  -- n° facture ou période
  period_from date,
  period_to   date,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_acctexports_company on public.accounting_exports(company_id, created_at desc);

drop trigger if exists trg_acctexports_audit on public.accounting_exports;
create trigger trg_acctexports_audit after insert or update or delete on public.accounting_exports for each row execute function public.audit_row();

alter table public.accounting_exports enable row level security;
drop policy if exists acctexports_all on public.accounting_exports;
create policy acctexports_all on public.accounting_exports for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Journal des ventes d'une période : factures + ventilation TVA (base/taux/montant) par taux.
create or replace function public.sales_journal(_company uuid, _from date, _to date)
returns table(
  document_id uuid, number text, issue_date date, contact_id uuid,
  total_ht numeric, total_vat numeric, total_ttc numeric, paid_amount numeric
)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.number, d.issue_date, d.contact_id, d.total_ht, d.total_vat, d.total_ttc, d.paid_amount
  from public.documents d
  where d.company_id = _company and public.is_member(_company)
    and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status <> 'annulee'
    and d.issue_date >= _from and d.issue_date <= _to
  order by d.issue_date, d.number;
$$;
grant execute on function public.sales_journal(uuid, date, date) to authenticated;

-- Ventilation TVA d'une période (base HT + TVA par taux), pour le registre TVA.
create or replace function public.vat_register(_company uuid, _from date, _to date)
returns table(vat_rate numeric, base_ht numeric, vat numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.vat_rate, round(sum(l.line_ht), 2), round(sum(l.line_ttc - l.line_ht), 2)
  from public.document_lines l
  join public.documents d on d.id = l.document_id
  where d.company_id = _company and public.is_member(_company)
    and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status <> 'annulee'
    and d.issue_date >= _from and d.issue_date <= _to
  group by l.vat_rate
  order by l.vat_rate;
$$;
grant execute on function public.vat_register(uuid, date, date) to authenticated;
