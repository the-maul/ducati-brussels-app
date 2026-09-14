-- M10 — Archiver une demande.
--
-- Trois sorties possibles pour une carte, et trois seulement :
--   1. la tâche en cours reste à faire        → on ne touche à rien ;
--   2. la tâche est faite                     → on en ouvre aussitôt une autre ;
--   3. il n'y a plus rien à faire             → on ARCHIVE la carte.
-- Archiver n'est ni « gagné » ni « perdu » : la carte quitte simplement le
-- pipeline et les rappels, sans être supprimée. On peut la désarchiver.

alter table public.leads
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archived_reason text;

create index if not exists idx_leads_active
  on public.leads(company_id, stage) where archived_at is null;

comment on column public.leads.archived_at is
  'Carte sortie du pipeline : plus aucune tâche attendue. Null = carte active.';
