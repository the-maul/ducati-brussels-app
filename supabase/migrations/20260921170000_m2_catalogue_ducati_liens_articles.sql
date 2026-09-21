-- =====================================================================
-- Mission 06 — Catalogue Ducati relié aux articles du DMS (Pièces & Accessoires)
--
-- Le lien article ↔ pièce Ducati se fait par la RÉFÉRENCE NORMALISÉE
-- (ducati_catalog_norm_ref : majuscules, uniquement A-Z0-9), déjà indexée des deux côtés :
--   - articles : idx_articles_ref_compact (company_id, regexp_replace(upper(reference), …))
--   - catalogue : ducati_catalog_parts (PK reference_norm), idx_dc_lines_ref
-- Cette migration ajoute, sans rien modifier de l'existant (additif uniquement) :
--   1. un index « préfixe » sur les références du catalogue (recherche « commence par ») ;
--   2. la vue ducati_catalog_article_links (article ↔ pièce Ducati, droits de l'appelant) ;
--   3. ducati_catalog_find_parts : recherche d'une référence dans le catalogue + article DMS ;
--   4. ducati_catalog_part_usage : modèles-années et vues éclatées où une référence apparaît (paginé) ;
--   5. ducati_catalog_article_link_count : nombre d'articles de la société reliés au catalogue.
-- Lecture seule : aucune écriture d'article, de stock ni de prix. Pas d'events (aucune écriture).
-- statement_timeout 8 s (authenticated) : toutes les requêtes passent par un index et sont bornées.
-- =====================================================================

-- 1. Recherche « commence par » sur la référence Ducati normalisée
create index if not exists idx_dc_parts_ref_prefix
  on public.ducati_catalog_parts (reference_norm text_pattern_ops);

-- 2. Correspondance article du DMS ↔ pièce du catalogue Ducati.
--    security_invoker : la RLS des articles (société) et du catalogue (équipe) s'applique à l'appelant.
create or replace view public.ducati_catalog_article_links
with (security_invoker = true) as
select a.company_id,
       a.id           as article_id,
       a.reference    as article_reference,
       p.reference_norm,
       p.reference    as catalog_reference,
       p.description  as catalog_description
  from public.articles a
  join public.ducati_catalog_parts p
    on p.reference_norm = regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g');
comment on view public.ducati_catalog_article_links is
  'Articles du DMS reliés à une pièce du catalogue Ducati par la référence normalisée (majuscules, A-Z0-9). Lecture seule.';
revoke all on public.ducati_catalog_article_links from anon;
grant select on public.ducati_catalog_article_links to authenticated;

-- 3. Recherche d'une référence dans le catalogue (égale ou « commence par »), avec l'article
--    actif de la société qui porte la même référence normalisée (même priorité que
--    ducati_catalog_article_for : stocké avant librairie, puis le plus ancien).
create or replace function public.ducati_catalog_find_parts(_company uuid, _q text, _limit integer default 10)
returns table (
  reference text, reference_norm text, description text,
  catalog_price_ht numeric, replaced boolean, replaced_part text,
  article_id uuid, article_reference text, article_designation text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  k text := public.ducati_catalog_norm_ref(_q);
  n integer := least(greatest(coalesce(_limit, 10), 1), 50);
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if k is null or length(k) < 4 then return; end if;
  return query
  select p.reference, p.reference_norm, p.description,
         p.catalog_price_ht, p.replaced, p.replaced_part,
         a.id, a.reference, a.designation
    from (
      select * from public.ducati_catalog_parts p0
       where p0.reference_norm like k || '%'
       order by (p0.reference_norm = k) desc, p0.reference_norm
       limit n
    ) p
    left join lateral (
      select a2.id, a2.reference, a2.designation from public.articles a2
       where a2.company_id = _company and a2.is_active
         and regexp_replace(upper(a2.reference), '[^A-Z0-9]', '', 'g') = p.reference_norm
       order by a2.is_library, a2.created_at
       limit 1
    ) a on true
   order by (p.reference_norm = k) desc, p.reference_norm;
end $$;
revoke all on function public.ducati_catalog_find_parts(uuid, text, integer) from public, anon;
grant execute on function public.ducati_catalog_find_parts(uuid, text, integer) to authenticated;

-- 4. Où une référence apparaît : modèle-année × vue éclatée (repère, quantité), paginé.
--    Europe d'abord, millésimes récents d'abord. total_count = nombre total de lignes.
create or replace function public.ducati_catalog_part_usage(_reference text, _limit integer default 20, _offset integer default 0)
returns table (
  model_year_id text, year integer, model_year_code text,
  model_id text, model_description text, is_europe boolean, family_description text,
  drawing_id text, drawing_code text, drawing_description text, group_description text,
  "position" text, quantity numeric, total_count bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  k text := public.ducati_catalog_norm_ref(_reference);
  n integer := least(greatest(coalesce(_limit, 20), 1), 100);
  o integer := greatest(coalesce(_offset, 0), 0);
begin
  if not public.ducati_catalog_is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if k is null then return; end if;
  return query
  select my.id, my.year, my.code,
         m.id, m.description, m.is_europe, f.description,
         d.id, d.code, d.description, g.description,
         l.position, l.quantity,
         count(*) over ()
    from public.ducati_catalog_drawing_lines l
    join public.ducati_catalog_drawings d on d.id = l.drawing_id
    join public.ducati_catalog_model_year_drawings myd on myd.drawing_id = l.drawing_id
    join public.ducati_catalog_model_years my on my.id = myd.model_year_id
    join public.ducati_catalog_models m on m.id = my.model_id
    left join public.ducati_catalog_families f on f.id = m.family_id
    left join public.ducati_catalog_groups g on g.id = myd.group_id
   where l.reference_norm = k
   order by m.is_europe desc, my.year desc nulls last, m.description, d.code, l.line_no
   limit n offset o;
end $$;
revoke all on function public.ducati_catalog_part_usage(text, integer, integer) from public, anon;
grant execute on function public.ducati_catalog_part_usage(text, integer, integer) to authenticated;

-- 5. Nombre d'articles actifs de la société reliés à une pièce du catalogue (écran « État de l'import »).
create or replace function public.ducati_catalog_article_link_count(_company uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return jsonb_build_object(
    'articles', (select count(*) from public.articles a where a.company_id = _company and a.is_active),
    'linked', (select count(*) from public.articles a
                where a.company_id = _company and a.is_active
                  and exists (select 1 from public.ducati_catalog_parts p
                               where p.reference_norm = regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g')))
  );
end $$;
revoke all on function public.ducati_catalog_article_link_count(uuid) from public, anon;
grant execute on function public.ducati_catalog_article_link_count(uuid) to authenticated;
