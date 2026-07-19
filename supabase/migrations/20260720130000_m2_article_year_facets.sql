-- M2 — Année article (Du/Au) + facettes de recherche multicritères.
-- 1. Plage d'années du modèle (ex. pièce compatible 2020 → 2023).
alter table public.articles add column if not exists year_from smallint;
alter table public.articles add column if not exists year_to   smallint;

-- 2. Valeurs distinctes pour les menus déroulants de la recherche multicritères
--    (marques, tailles, couleurs, années) — sans rapatrier tout le référentiel.
create or replace function public.article_facets(_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'brands', (
      select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
      from (select distinct trim(brand) as v from public.articles
            where company_id = _company and coalesce(trim(brand), '') <> '') b
    ),
    'sizes', (
      select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
      from (select distinct trim(size) as v from public.articles
            where company_id = _company and coalesce(trim(size), '') <> '') s
    ),
    'colors', (
      select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
      from (select distinct trim(color) as v from public.articles
            where company_id = _company and coalesce(trim(color), '') <> '') c
    ),
    'years', (
      -- Toutes les années COUVERTES par les plages (2018→2024 propose 2018..2024,
      -- plage ouverte 2020→null propose 2020..année courante + 1). Garde-fou +80 ans.
      select coalesce(jsonb_agg(v order by v desc), '[]'::jsonb)
      from (
        select distinct t.y as v
        from public.articles a
        cross join lateral (
          select least(a.year_from, a.year_to) as lo,
                 greatest(a.year_from, a.year_to,
                          case when a.year_to is null then extract(year from now())::int + 1 end) as hi
        ) b
        cross join lateral generate_series(b.lo, least(b.hi, b.lo + 80)) as t(y)
        where a.company_id = _company
          and (a.year_from is not null or a.year_to is not null)
      ) y
    )
  );
$$;
grant execute on function public.article_facets(uuid) to authenticated, service_role;
