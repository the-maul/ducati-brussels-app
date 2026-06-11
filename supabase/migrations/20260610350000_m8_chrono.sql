-- =====================================================================
-- M8 — Chronos atelier / pointeuse (productivité B11, les 3 étages G8) :
--   étage 1 présence (arrivée/départ du mécanicien)
--   étage 2 temps de travail (pointage sur un OR/cession)
--   étage 3 temps facturé (MO des lignes OR) → rapprochement passé/facturé
-- Append-only de fait : chaque pointage = une ligne horodatée. company_id + RLS + audit.
-- =====================================================================

create table if not exists public.workshop_time_entries (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  mechanic_id   uuid references auth.users(id) on delete set null,
  mechanic_name text,
  or_id         uuid references public.repair_orders(id) on delete set null,
  kind          text not null default 'travail',     -- presence | travail
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  minutes       numeric(10,2),                        -- calculé à la clôture du pointage
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_wte_company on public.workshop_time_entries(company_id, started_at desc);
create index if not exists idx_wte_or on public.workshop_time_entries(or_id);
create index if not exists idx_wte_open on public.workshop_time_entries(mechanic_id, kind) where ended_at is null;

drop trigger if exists trg_wte_audit on public.workshop_time_entries;
create trigger trg_wte_audit after insert or update or delete on public.workshop_time_entries for each row execute function public.audit_row();

alter table public.workshop_time_entries enable row level security;
drop policy if exists wte_all on public.workshop_time_entries;
create policy wte_all on public.workshop_time_entries for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Temps de travail total (minutes) passé par OR (somme des pointages clôturés).
create or replace function public.or_worked_minutes(_or uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(minutes), 0) from public.workshop_time_entries
  where or_id = _or and kind = 'travail' and minutes is not null;
$$;
grant execute on function public.or_worked_minutes(uuid) to authenticated;
