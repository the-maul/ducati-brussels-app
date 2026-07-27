-- M6 — Picking list digitale (Ventes & Facturation, item 11 du cahier des charges client).
-- 1) picking_lists : une préparation de commande, rattachée (ou non) à un document de vente,
--    avec une localisation (Buanderie / G.ET.C / P.ET.C / ET@ / saisie libre).
-- 2) picking_list_items : lignes à préparer — copiées depuis document_lines à la création
--    (qty_ordered) et complétées à la réception/préparation (qty_picked) + attribution manuelle.

create table if not exists public.picking_lists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  location text,
  status text not null default 'en_cours' check (status in ('en_cours', 'pret', 'livre')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index if not exists idx_picking_lists_company on public.picking_lists(company_id);

alter table public.picking_lists enable row level security;
drop policy if exists "picking_lists_select" on public.picking_lists;
create policy "picking_lists_select" on public.picking_lists
  for select using (public.is_member(company_id));
drop policy if exists "picking_lists_insert" on public.picking_lists;
create policy "picking_lists_insert" on public.picking_lists
  for insert with check (public.is_member(company_id));
drop policy if exists "picking_lists_update" on public.picking_lists;
create policy "picking_lists_update" on public.picking_lists
  for update using (public.is_member(company_id));
drop policy if exists "picking_lists_delete" on public.picking_lists;
create policy "picking_lists_delete" on public.picking_lists
  for delete using (public.is_member(company_id));

create table if not exists public.picking_list_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  picking_id uuid not null references public.picking_lists(id) on delete cascade,
  article_id uuid references public.articles(id) on delete set null,
  designation text,
  reference text,
  qty_ordered numeric not null default 0,
  qty_picked numeric not null default 0,
  status text not null default 'a_preparer' check (status in ('a_preparer', 'partiel', 'pret', 'a_recevoir')),
  created_at timestamptz not null default now()
);
create index if not exists idx_picking_list_items_company on public.picking_list_items(company_id);
create index if not exists idx_picking_list_items_picking on public.picking_list_items(picking_id);

alter table public.picking_list_items enable row level security;
drop policy if exists "picking_list_items_select" on public.picking_list_items;
create policy "picking_list_items_select" on public.picking_list_items
  for select using (public.is_member(company_id));
drop policy if exists "picking_list_items_insert" on public.picking_list_items;
create policy "picking_list_items_insert" on public.picking_list_items
  for insert with check (public.is_member(company_id));
drop policy if exists "picking_list_items_update" on public.picking_list_items;
create policy "picking_list_items_update" on public.picking_list_items
  for update using (public.is_member(company_id));
drop policy if exists "picking_list_items_delete" on public.picking_list_items;
create policy "picking_list_items_delete" on public.picking_list_items
  for delete using (public.is_member(company_id));

-- Recharge du cache de schéma PostgREST
notify pgrst, 'reload schema';
