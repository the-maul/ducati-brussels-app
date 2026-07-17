-- M2 (B12) — Formats d'étiquettes personnalisés (éditeur « Paramétrage des
-- étiquettes ») : dimensions, éléments positionnés, code-barres, image (logo).
create table if not exists public.label_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  config jsonb not null default '{}',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_label_templates_company on public.label_templates(company_id);

alter table public.label_templates enable row level security;
drop policy if exists "label_templates_select" on public.label_templates;
create policy "label_templates_select" on public.label_templates
  for select using (public.is_member(company_id));
drop policy if exists "label_templates_insert" on public.label_templates;
create policy "label_templates_insert" on public.label_templates
  for insert with check (public.is_member(company_id));
drop policy if exists "label_templates_update" on public.label_templates;
create policy "label_templates_update" on public.label_templates
  for update using (public.is_member(company_id));
drop policy if exists "label_templates_delete" on public.label_templates;
create policy "label_templates_delete" on public.label_templates
  for delete using (public.is_member(company_id));

notify pgrst, 'reload schema';
