-- M2 — Une référence épuisée peut avoir PLUSIEURS remplaçants, selon la moto.
--
-- Constaté avec le client le 30/10/2026. `14622167AA` (ARBRE MOTEUR COMP.) est
-- remplacée par `14622162CA` d'après G8 et par `6992A401AA` d'après le tarif
-- Ducati. Les deux existent, les deux sont commandables, et les vues éclatées
-- montrent pourquoi : elles ne vont pas sur les mêmes motos.
--
--   14622162CA  →  194 motos  (950, 950 S, 950 S SW…)
--   6992A401AA  →  160 motos  (950, 950 BRASIL, 950 S SW…)
--
-- Et pour `77140677CF` (VIS TCEIF M6X20), aucun recoupement du tout :
--   77140677CH  →  48 motos  (Formula 73, Full Throttle)
--   77140677CA  →  97 motos  (Desert X, Monster Plus)
--
-- Un pointeur unique `superseded_by_id` est donc faux par nature dans ce cas :
-- il force un choix que seule la moto du client permet de trancher. On garde ce
-- pointeur comme valeur par défaut, et on lui ajoute la liste des autres
-- remplaçants possibles, avec leur source.

create table if not exists public.article_replacement_options (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  article_id      uuid not null references public.articles(id) on delete cascade,
  candidate_id    uuid not null references public.articles(id) on delete cascade,
  -- D'où vient cette proposition : 'g8' (reprise), 'tarif_ducati', 'manuel'.
  source          text not null default 'tarif_ducati',
  created_at      timestamptz not null default now(),
  constraint article_replacement_options_source_ck check (source in ('g8', 'tarif_ducati', 'manuel')),
  constraint article_replacement_options_pas_soi_meme check (article_id <> candidate_id),
  unique (company_id, article_id, candidate_id)
);

create index if not exists idx_replacement_options_article
  on public.article_replacement_options (company_id, article_id);

alter table public.article_replacement_options enable row level security;

drop policy if exists "replacement_options_lecture" on public.article_replacement_options;
create policy "replacement_options_lecture" on public.article_replacement_options
  for select using (public.is_member(company_id));

drop policy if exists "replacement_options_ecriture" on public.article_replacement_options;
create policy "replacement_options_ecriture" on public.article_replacement_options
  for all using (public.is_admin(company_id)) with check (public.is_admin(company_id));

comment on table public.article_replacement_options is
  'Remplacants possibles d''une reference epuisee, quand il y en a plusieurs selon la moto. Le choix par defaut reste articles.superseded_by_id.';

-- Les remplaçants possibles d'un article, avec le nombre de motos concernées et,
-- si l'on connaît la moto du client, un drapeau qui dit si la pièce lui va.
create or replace function public.article_replacement_options_list(
  _company uuid, _article uuid, _model_year_id text default null)
returns table (
  candidate_id uuid, reference text, designation text, sale_price_ttc numeric,
  source text, is_default boolean, motos integer, va_sur_cette_moto boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
  with defaut as (
    select superseded_by_id as id from public.articles
     where id = _article and company_id = _company
  ),
  tous as (
    select o.candidate_id as id, o.source from public.article_replacement_options o
     where o.company_id = _company and o.article_id = _article
    union
    select d.id, 'g8' from defaut d where d.id is not null
  )
  select a.id, a.reference, a.designation, a.sale_price_ttc, t.source,
         a.id = (select id from defaut) as is_default,
         (select count(distinct myd.model_year_id)::int
            from public.ducati_catalog_drawing_lines l
            join public.ducati_catalog_model_year_drawings myd on myd.drawing_id = l.drawing_id
           where l.reference_norm = public.ducati_catalog_norm_ref(a.reference)) as motos,
         case when _model_year_id is null then null else exists (
           select 1 from public.ducati_catalog_drawing_lines l
             join public.ducati_catalog_model_year_drawings myd on myd.drawing_id = l.drawing_id
            where l.reference_norm = public.ducati_catalog_norm_ref(a.reference)
              and myd.model_year_id = _model_year_id) end as va_sur_cette_moto
    from tous t
    join public.articles a on a.id = t.id and a.company_id = _company
   where public.is_member(_company)
   order by 8 desc nulls last, 7 desc;
$$;

revoke all on function public.article_replacement_options_list(uuid, uuid, text) from public, anon;
grant execute on function public.article_replacement_options_list(uuid, uuid, text) to authenticated;

comment on function public.article_replacement_options_list(uuid, uuid, text) is
  'Remplacants possibles d''une reference, tries : celui qui va sur la moto donnee d''abord, puis le choix par defaut.';
