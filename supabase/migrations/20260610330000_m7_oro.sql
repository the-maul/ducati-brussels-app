-- =====================================================================
-- M7 — Reprise / Occasion + ORO (Ordre de Remise en État). Flux B3 :
-- reprise → article occasion (O/P) + fiche véhicule + ouverture ORO ; les pièces
-- et la main d'œuvre de l'ORO s'imputent au **coût de revient** du véhicule (PAS en
-- charge atelier). Rentabilité réelle par VIN = PV − (reprise + remise en état + frais).
-- company_id + RLS + audit (B7). Numérotation ORO-/OCC- (M0).
-- =====================================================================

create table if not exists public.oro (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  number      text,
  vehicle_id  uuid references public.vehicles(id) on delete set null,
  status      text not null default 'ouvert',     -- ouvert | cloture
  notes       text,
  total_cost  numeric(14,2) not null default 0,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists idx_oro_company on public.oro(company_id, status);
create index if not exists idx_oro_vehicle on public.oro(vehicle_id);

create table if not exists public.oro_lines (
  id          uuid primary key default gen_random_uuid(),
  oro_id      uuid not null references public.oro(id) on delete cascade,
  kind        text not null default 'piece',       -- piece | mo | frais
  article_id  uuid references public.articles(id) on delete set null,
  designation text not null,
  quantity    numeric(14,3) not null default 1,
  unit_cost   numeric(14,3) not null default 0,
  line_cost   numeric(14,2) not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_orolines_oro on public.oro_lines(oro_id);

drop trigger if exists trg_oro_audit on public.oro;
create trigger trg_oro_audit after insert or update or delete on public.oro for each row execute function public.audit_row();
drop trigger if exists trg_orolines_audit on public.oro_lines;
create trigger trg_orolines_audit after insert or update or delete on public.oro_lines for each row execute function public.audit_row();

alter table public.oro       enable row level security;
alter table public.oro_lines enable row level security;
drop policy if exists oro_all on public.oro;
create policy oro_all on public.oro for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists orolines_all on public.oro_lines;
create policy orolines_all on public.oro_lines for all to authenticated
  using (exists (select 1 from public.oro o where o.id = oro_id and public.is_member(o.company_id)))
  with check (exists (select 1 from public.oro o where o.id = oro_id and public.is_member(o.company_id)));

-- ---------------------------------------------------------------------
-- Recalcule le total ORO + le coût de revient du véhicule (B3) :
--   coût de revient = prix de reprise (purchase_price) + Σ ORO du véhicule.
-- ---------------------------------------------------------------------
create or replace function public.recompute_oro_and_vehicle(_oro uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _vehicle uuid; _veh_total numeric; _base numeric;
begin
  select company_id, vehicle_id into _company, _vehicle from public.oro where id = _oro;
  if _company is null or not public.is_member(_company) then raise exception 'Accès refusé'; end if;

  update public.oro set total_cost = coalesce((select sum(line_cost) from public.oro_lines where oro_id = _oro), 0) where id = _oro;

  if _vehicle is not null then
    select coalesce(purchase_price, 0) into _base from public.vehicles where id = _vehicle;
    select coalesce(sum(total_cost), 0) into _veh_total from public.oro where vehicle_id = _vehicle;
    update public.vehicles set cost_price = _base + _veh_total where id = _vehicle;
  end if;
end $$;
grant execute on function public.recompute_oro_and_vehicle(uuid) to authenticated;
