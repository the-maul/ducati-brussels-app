-- M2 — Applicabilités articles (compatibilité modèle/année) : import CSV fournisseur
-- (ex. applicabilitiesList_<reference>.csv). Une ligne = un modèle/année compatible
-- pour une référence donnée (gamme, année, modèle, quantité).

create table if not exists public.article_applicabilities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  article_id uuid references public.articles(id) on delete cascade,
  reference text not null,               -- réf. article (rattachement même si article_id encore null)
  gamme text,
  model_year int,
  model text,
  quantity numeric default 1,
  created_at timestamptz not null default now()
);
create index if not exists idx_article_applic_company_ref on public.article_applicabilities(company_id, reference);
create index if not exists idx_article_applic_article on public.article_applicabilities(article_id);
create index if not exists idx_article_applic_company_model on public.article_applicabilities(company_id, model);

alter table public.article_applicabilities enable row level security;
drop policy if exists "article_applicabilities_select" on public.article_applicabilities;
create policy "article_applicabilities_select" on public.article_applicabilities
  for select using (public.is_member(company_id));
drop policy if exists "article_applicabilities_insert" on public.article_applicabilities;
create policy "article_applicabilities_insert" on public.article_applicabilities
  for insert with check (public.is_member(company_id));
drop policy if exists "article_applicabilities_update" on public.article_applicabilities;
create policy "article_applicabilities_update" on public.article_applicabilities
  for update using (public.is_member(company_id));
drop policy if exists "article_applicabilities_delete" on public.article_applicabilities;
create policy "article_applicabilities_delete" on public.article_applicabilities
  for delete using (public.is_member(company_id));

-- Recharge du cache de schéma PostgREST
notify pgrst, 'reload schema';
