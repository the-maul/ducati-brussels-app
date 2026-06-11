-- =====================================================================
-- M6 (fondation) — DOCUMENTS de vente (en-tête + lignes + règlements)
-- Débloque : encours client (M1), onglets Documents/Échéances (M1), stats article (M2).
-- Numérotation via document_sequences (M0). Statuts + audit (B7). Le POS complet = Epic 5.
-- =====================================================================

create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  doc_type    text not null default 'FAC',         -- FAC/DEV/TIK/BL/CMD…
  number      text,
  contact_id  uuid references public.contacts(id) on delete set null,
  vehicle_id  uuid references public.vehicles(id) on delete set null,
  status      text not null default 'brouillon',    -- brouillon/validee/payee/annulee
  issue_date  date not null default current_date,
  due_date    date,
  total_ht    numeric(14,2) not null default 0,
  total_vat   numeric(14,2) not null default 0,
  total_ttc   numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_documents_company on public.documents(company_id);
create index if not exists idx_documents_contact on public.documents(contact_id);

create table if not exists public.document_lines (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  article_id   uuid references public.articles(id) on delete set null,
  designation  text not null,
  quantity     numeric(14,3) not null default 1,
  unit_price_ht numeric(14,3) not null default 0,
  vat_rate     numeric(6,2) not null default 21,
  discount_pct numeric(6,2) not null default 0,
  line_ht      numeric(14,2) not null default 0,
  line_ttc     numeric(14,2) not null default 0,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_doclines_document on public.document_lines(document_id);
create index if not exists idx_doclines_article on public.document_lines(article_id);

create table if not exists public.document_payments (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  method      text not null default 'ESP',
  amount      numeric(14,2) not null,
  paid_at     timestamptz not null default now()
);
create index if not exists idx_docpay_document on public.document_payments(document_id);

-- updated_at + audit
drop trigger if exists trg_documents_updated on public.documents;
create trigger trg_documents_updated before update on public.documents for each row execute function public.set_updated_at();
drop trigger if exists trg_documents_audit on public.documents;
create trigger trg_documents_audit after insert or update or delete on public.documents for each row execute function public.audit_row();

-- RLS
alter table public.documents enable row level security;
alter table public.document_lines enable row level security;
alter table public.document_payments enable row level security;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated using (public.is_member(company_id));
drop policy if exists documents_write on public.documents;
create policy documents_write on public.documents for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

drop policy if exists doclines_all on public.document_lines;
create policy doclines_all on public.document_lines for all to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and public.is_member(d.company_id)))
  with check (exists (select 1 from public.documents d where d.id = document_id and public.is_member(d.company_id)));

drop policy if exists docpay_all on public.document_payments;
create policy docpay_all on public.document_payments for all to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and public.is_member(d.company_id)))
  with check (exists (select 1 from public.documents d where d.id = document_id and public.is_member(d.company_id)));

-- ---------------------------------------------------------------------
-- Encours client : autorisé (credit_limit) / actuel (factures non soldées) / disponible
-- ---------------------------------------------------------------------
create or replace function public.contact_encours(_contact uuid)
returns table(authorized numeric, current_due numeric, available numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    coalesce((select credit_limit from public.contacts where id = _contact), 0) as authorized,
    coalesce((select sum(total_ttc - paid_amount) from public.documents
              where contact_id = _contact and doc_type = 'FAC' and status <> 'annulee'
              and total_ttc - paid_amount > 0), 0) as current_due,
    coalesce((select credit_limit from public.contacts where id = _contact), 0)
      - coalesce((select sum(total_ttc - paid_amount) from public.documents
                  where contact_id = _contact and doc_type = 'FAC' and status <> 'annulee'
                  and total_ttc - paid_amount > 0), 0) as available;
$$;
grant execute on function public.contact_encours(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Seed : 2 factures par société (1ʳᵉ fiche client) pour démos encours/échéances/stats
-- ---------------------------------------------------------------------
do $$
declare _c record; _contact uuid; _doc uuid; _art uuid;
begin
  for _c in select id from public.companies loop
    select id into _contact from public.contacts where company_id = _c.id order by created_at limit 1;
    select id into _art from public.articles where company_id = _c.id order by created_at limit 1;
    if _contact is null then continue; end if;

    -- Facture soldée
    insert into public.documents (company_id, doc_type, number, contact_id, status, issue_date, due_date, total_ht, total_vat, total_ttc, paid_amount)
    values (_c.id, 'FAC', 'FAC-DEMO-001', _contact, 'payee', current_date - 40, current_date - 10, 100, 21, 121, 121)
    returning id into _doc;
    insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order)
    values (_doc, _art, 'Prestation démo', 1, 100, 21, 100, 121, 0);
    insert into public.document_payments (document_id, method, amount) values (_doc, 'ESP', 121);

    -- Facture en cours (échéance dépassée → encours)
    insert into public.documents (company_id, doc_type, number, contact_id, status, issue_date, due_date, total_ht, total_vat, total_ttc, paid_amount)
    values (_c.id, 'FAC', 'FAC-DEMO-002', _contact, 'validee', current_date - 20, current_date - 5, 500, 105, 605, 105)
    returning id into _doc;
    insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order)
    values (_doc, _art, 'Pièces démo', 5, 100, 21, 500, 605, 0);
    insert into public.document_payments (document_id, method, amount) values (_doc, 'ESP', 105);
  end loop;
end $$;
