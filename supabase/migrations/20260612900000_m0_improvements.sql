-- =====================================================================
-- M0 — Tableau « Améliorations » : board de tâches partagé entre ADMINS
-- (client + intégrateur) pour échanger les demandes de modification
-- directement dans l'app de test.
-- Réservé aux admins de la société (is_admin). company_id + RLS + audit (B7).
-- 5 statuts : pending (en attente) / todo (à faire) / in_progress (en cours)
--            / to_validate (à valider) / done (fait).
-- Documents joints via la GED existante (entity_type = 'improvement').
-- =====================================================================

create table if not exists public.improvements (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  title       text not null,
  description text,
  status      text not null default 'pending'
              check (status in ('pending','todo','in_progress','to_validate','done')),
  position    integer not null default 0,        -- ordre dans la colonne de statut
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_improvements_company on public.improvements(company_id, status, position);

-- Points & sous-points (checklist structurée). parent_id null = point racine.
create table if not exists public.improvement_points (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  improvement_id uuid not null references public.improvements(id) on delete cascade,
  parent_id      uuid references public.improvement_points(id) on delete cascade,
  label          text not null,
  done           boolean not null default false,
  position       integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_improvement_points_imp on public.improvement_points(improvement_id, parent_id, position);

drop trigger if exists trg_improvements_updated on public.improvements;
create trigger trg_improvements_updated before update on public.improvements
  for each row execute function public.set_updated_at();

drop trigger if exists trg_improvements_audit on public.improvements;
create trigger trg_improvements_audit after insert or update or delete on public.improvements
  for each row execute function public.audit_row();

alter table public.improvements enable row level security;
alter table public.improvement_points enable row level security;

-- Accès réservé aux admins de la société.
drop policy if exists improvements_admin on public.improvements;
create policy improvements_admin on public.improvements for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

drop policy if exists improvement_points_admin on public.improvement_points;
create policy improvement_points_admin on public.improvement_points for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

notify pgrst, 'reload schema';
