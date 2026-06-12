-- =====================================================================
-- M9/M0 — CGV (conditions générales de vente) imprimables au verso des documents
-- + signatures électroniques (capacité) sur un document.
-- =====================================================================

-- Texte CGV + pied de page configurables par société (imprimés sur les documents).
alter table public.companies
  add column if not exists cgv_text    text,
  add column if not exists invoice_footer text;

-- Signatures électroniques attachées à un document (acceptation devis, réception OR…).
create table if not exists public.document_signatures (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  document_id   uuid references public.documents(id) on delete cascade,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  signer_name   text,
  signature_data text,                 -- data URL (image PNG du tracé) ou hash
  signed_at     timestamptz not null default now(),
  signed_ip     text
);
create index if not exists idx_docsign_company on public.document_signatures(company_id);
create index if not exists idx_docsign_document on public.document_signatures(document_id);

drop trigger if exists trg_docsign_audit on public.document_signatures;
create trigger trg_docsign_audit after insert or update or delete on public.document_signatures for each row execute function public.audit_row();
alter table public.document_signatures enable row level security;
drop policy if exists docsign_all on public.document_signatures;
create policy docsign_all on public.document_signatures for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
