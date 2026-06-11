-- =====================================================================
-- M11 — Constructeur de site (e-shop) : le site est un document de BLOCS éditables
-- (hero, bannière, texte, produits, contact) + thème. `content` = brouillon édité
-- dans l'app ; `published_content` = version en ligne (servie au public). Publier =
-- copier content → published_content. Le storefront public rend `published_content`.
-- =====================================================================

alter table public.shop_settings
  add column if not exists content           jsonb not null default '{}'::jsonb,   -- brouillon (blocs + thème)
  add column if not exists published_content jsonb;                                 -- version publiée

-- Contenu publié d'une boutique (par slug ou domaine), accès anonyme.
create or replace function public.shop_public_site(_slug text)
returns table(company_id uuid, name text, theme_color text, content jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select company_id, name, theme_color, coalesce(published_content, '{}'::jsonb)
  from public.shop_settings
  where published = true and (slug = _slug or custom_domain = _slug);
$$;
grant execute on function public.shop_public_site(text) to anon, authenticated;
