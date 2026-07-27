-- M5 — Dépréciation de stock : décote (%) appliquée à la valeur PAMP d'un article
-- pour réduire la charge comptable du vieux stock (rotation lente), SANS toucher
-- aux quantités (le stock réel/physique ne bouge pas). Écriture de valeur, pas un
-- mouvement de stock (donc pas d'entrée dans stock_moves) : provision append-only,
-- annulable (is_active=false) mais jamais mise à jour/supprimée silencieusement (B7).

create table if not exists public.stock_depreciations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  article_id uuid not null references public.articles(id) on delete cascade,
  rate numeric not null check (rate > 0 and rate <= 100),   -- % de décote appliqué
  reason text,                                              -- motif (vieux stock, obsolescence…)
  base_value numeric,                                       -- stock_value de l'article au moment T
  depreciated_value numeric not null,                       -- montant de la décote = base_value * rate/100
  is_active boolean not null default true,                  -- false = dépréciation annulée (on ne supprime pas)
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index if not exists idx_stock_depreciations_company_article on public.stock_depreciations(company_id, article_id);

alter table public.stock_depreciations enable row level security;
drop policy if exists "stock_depreciations_select" on public.stock_depreciations;
create policy "stock_depreciations_select" on public.stock_depreciations
  for select using (public.is_member(company_id));
drop policy if exists "stock_depreciations_insert" on public.stock_depreciations;
create policy "stock_depreciations_insert" on public.stock_depreciations
  for insert with check (public.is_member(company_id));
drop policy if exists "stock_depreciations_update" on public.stock_depreciations;
create policy "stock_depreciations_update" on public.stock_depreciations
  for update using (public.is_member(company_id));

notify pgrst, 'reload schema';
