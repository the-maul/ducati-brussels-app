-- =====================================================================
-- M10 — CRM : leads / pipeline commercial + journal des communications
-- (histo e-mail / SMS / appels — comble les onglets M1 dépendants de M10).
-- company_id + RLS + audit (B7).
-- =====================================================================

create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  contact_id    uuid references public.contacts(id) on delete set null,
  name          text not null,
  email         text,
  phone         text,
  vehicle_interest text,                              -- modèle / véhicule recherché (matching)
  source        text,                                 -- web, salon, recommandation…
  stage         text not null default 'nouveau',      -- nouveau | contacte | qualifie | proposition | gagne | perdu
  estimated_value numeric(14,2),
  assigned_to   uuid references auth.users(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_leads_company on public.leads(company_id, stage);
create index if not exists idx_leads_contact on public.leads(contact_id);

create table if not exists public.communications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  contact_id  uuid references public.contacts(id) on delete cascade,
  lead_id     uuid references public.leads(id) on delete set null,
  channel     text not null default 'note',           -- email | sms | call | note
  direction   text not null default 'out',            -- in | out
  subject     text,
  body        text,
  occurred_at timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_comms_contact on public.communications(contact_id, occurred_at desc);
create index if not exists idx_comms_company on public.communications(company_id);

drop trigger if exists trg_leads_updated on public.leads;
create trigger trg_leads_updated before update on public.leads for each row execute function public.set_updated_at();
drop trigger if exists trg_leads_audit on public.leads;
create trigger trg_leads_audit after insert or update or delete on public.leads for each row execute function public.audit_row();
drop trigger if exists trg_comms_audit on public.communications;
create trigger trg_comms_audit after insert or update or delete on public.communications for each row execute function public.audit_row();

alter table public.leads          enable row level security;
alter table public.communications enable row level security;
drop policy if exists leads_all on public.leads;
create policy leads_all on public.leads for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists comms_all on public.communications;
create policy comms_all on public.communications for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
