-- =====================================================================
-- M8 — Planning atelier : rendez-vous (RDV). Date/heure, mécanicien, véhicule,
-- client, travaux, statut+couleur, véhicule de prêt, lien vers l'OR créé.
-- company_id + RLS + audit. (SMS/mail de rappel = M9/M10 ; ici le flag est posé.)
-- =====================================================================

create table if not exists public.workshop_appointments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  contact_id    uuid references public.contacts(id) on delete set null,
  vehicle_id    uuid references public.vehicles(id) on delete set null,
  or_id         uuid references public.repair_orders(id) on delete set null,
  mechanic_name text,
  workshop      text,                                 -- atelier
  starts_at     timestamptz not null,
  planned_minutes int not null default 60,
  work_description text,
  reception_notes  text,
  loaner_vehicle text,                                -- véhicule de prêt / courtoisie
  status        text not null default 'prevu',        -- prevu | arrive | en_cours | termine | annule
  notify_sms    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_appt_company on public.workshop_appointments(company_id, starts_at);

drop trigger if exists trg_appt_updated on public.workshop_appointments;
create trigger trg_appt_updated before update on public.workshop_appointments for each row execute function public.set_updated_at();
drop trigger if exists trg_appt_audit on public.workshop_appointments;
create trigger trg_appt_audit after insert or update or delete on public.workshop_appointments for each row execute function public.audit_row();

alter table public.workshop_appointments enable row level security;
drop policy if exists appt_all on public.workshop_appointments;
create policy appt_all on public.workshop_appointments for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
