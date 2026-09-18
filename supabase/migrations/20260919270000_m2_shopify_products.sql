-- =====================================================================
-- Mission 03 — carte « Voir les produits Shopify et les rapprocher des articles du stock »
--
-- shopify_products : instantané des variantes Shopify, écrit UNIQUEMENT par la fonction serveur
--                    shopify-sync-products (clé de service). Upsert par (société, id de variante).
--                    removed_at = variante absente de la dernière lecture complète.
-- shopify_links    : décision de liaison variante ↔ article, une ligne par variante décidée :
--                    auto_exact  relié d'office (correspondance exacte et unique, décision W-6)
--                    valide      relié par une personne
--                    ignore      écarté par une personne (pas d'article à relier)
--                    a_valider   délié par une personne : ne sera plus relié d'office
--                    Pas de ligne = à valider (aucune correspondance exacte et unique).
-- Rien n'est jamais écrit dans Shopify. Chaque décision est tracée dans events.
-- Lecture : administrateurs et vendeurs. Décisions : administrateurs.
-- Additif uniquement : 2 tables, 2 index sur articles, des fonctions.
-- =====================================================================

-- 1. Instantané des variantes Shopify
create table if not exists public.shopify_products (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  shopify_product_id   text not null,
  shopify_variant_id   text not null,
  product_title        text,
  variant_title        text,
  handle               text,
  status               text,
  sku                  text,
  barcode              text,
  price                numeric(12,2),
  inventory_quantity   integer,
  image_url            text,
  vendor               text,
  product_type         text,
  shopify_updated_at   timestamptz,
  first_seen_at        timestamptz not null default now(),
  synced_at            timestamptz not null default now(),
  removed_at           timestamptz,
  unique (company_id, shopify_variant_id)
);
create index if not exists idx_shopify_products_sku on public.shopify_products (company_id, upper(btrim(sku)));
create index if not exists idx_shopify_products_product on public.shopify_products (company_id, shopify_product_id);

-- 2. Décisions de liaison
create table if not exists public.shopify_links (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  shopify_variant_id text not null,
  article_id         uuid references public.articles(id) on delete set null,
  status             text not null check (status in ('auto_exact', 'valide', 'ignore', 'a_valider')),
  match_via          text check (match_via in ('sku', 'barcode')),
  decided_by         uuid references auth.users(id) on delete set null,
  decided_at         timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (company_id, shopify_variant_id)
);
create index if not exists idx_shopify_links_article on public.shopify_links (company_id, article_id);

-- 3. Recherche exacte / compacte sur la référence article (81 000 articles)
create index if not exists idx_articles_ref_upper on public.articles (company_id, upper(btrim(reference)));
create index if not exists idx_articles_ref_compact
  on public.articles (company_id, regexp_replace(upper(reference), '[^A-Z0-9]', '', 'g'));

-- 4. RLS : lecture administrateurs + vendeurs ; aucune écriture directe (fonctions ci-dessous)
alter table public.shopify_products enable row level security;
alter table public.shopify_links enable row level security;
revoke all on public.shopify_products from anon;
revoke all on public.shopify_links from anon;

drop policy if exists shopify_products_select on public.shopify_products;
create policy shopify_products_select on public.shopify_products for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));
drop policy if exists shopify_links_select on public.shopify_links;
create policy shopify_links_select on public.shopify_links for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));

-- 5. Vue d'ensemble pour l'écran « Produits Shopify »
create or replace function public.shopify_products_overview(_company uuid)
returns table (
  shopify_variant_id text, shopify_product_id text, product_title text, variant_title text,
  handle text, product_status text, sku text, barcode text, price numeric, inventory_quantity integer,
  image_url text, vendor text, product_type text, synced_at timestamptz,
  link_status text, match_via text, article_id uuid, article_reference text, article_designation text,
  decided_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_admin(_company) or public.has_role(_company, 'vendeur')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select p.shopify_variant_id, p.shopify_product_id, p.product_title, p.variant_title,
         p.handle, p.status, p.sku, p.barcode, p.price, p.inventory_quantity,
         p.image_url, p.vendor, p.product_type, p.synced_at,
         case when l.status is null then 'a_valider'
              when l.status in ('auto_exact', 'valide') and a.id is null then 'a_valider'
              else l.status end,
         l.match_via, a.id, a.reference, a.designation, l.decided_at
    from public.shopify_products p
    left join public.shopify_links l
      on l.company_id = p.company_id and l.shopify_variant_id = p.shopify_variant_id
    left join public.articles a on a.id = l.article_id and l.status in ('auto_exact', 'valide')
   where p.company_id = _company and p.removed_at is null
   order by p.product_title, p.variant_title;
end $$;
revoke all on function public.shopify_products_overview(uuid) from public, anon;
grant execute on function public.shopify_products_overview(uuid) to authenticated;

-- 6. Suggestions pour une variante à valider (jamais liées d'office)
--    reference_proche     même référence sans tirets, points, espaces
--    reference_remplacee  le SKU est une ancienne référence remplacée par cet article
--    ref_fournisseur      le SKU est la référence fournisseur de l'article
--    libelle_proche       mots du titre Shopify retrouvés dans le libellé
create or replace function public.shopify_link_suggestions(_company uuid, _variant text)
returns table (article_id uuid, reference text, designation text, reason text, score int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p       public.shopify_products%rowtype;
  k       text;
  kc      text;
  words   text[];
  nwords  int;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  select * into p from public.shopify_products x where x.company_id = _company and x.shopify_variant_id = _variant;
  if not found then return; end if;

  k  := nullif(upper(btrim(coalesce(p.sku, ''))), '');
  kc := nullif(regexp_replace(upper(coalesce(p.sku, '')), '[^A-Z0-9]', '', 'g'), '');
  select coalesce(array_agg(distinct w), '{}') into words
    from regexp_split_to_table(lower(public.unaccent(coalesce(p.product_title, '') || ' ' || coalesce(p.variant_title, ''))), '[^a-z0-9]+') w
   where length(w) >= 4 and w not in ('default', 'title', 'ducati', 'pour', 'avec');
  nwords := coalesce(array_length(words, 1), 0);

  return query
  with s as (
    select a.id, a.reference, a.designation, 'reference_proche'::text as reason, 100 as score
      from public.articles a
     where kc is not null and length(kc) >= 3 and a.company_id = _company and a.is_active
       and regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') = kc
    union all
    select n.id, n.reference, n.designation, 'reference_remplacee', 90
      from public.articles o join public.articles n on n.id = o.superseded_by_id
     where k is not null and o.company_id = _company and upper(btrim(o.reference)) = k and n.is_active
    union all
    select a.id, a.reference, a.designation, 'ref_fournisseur', 80
      from public.articles a
     where k is not null and a.company_id = _company and a.is_active and upper(btrim(a.supplier_ref)) = k
    union all
    (select x.id, x.reference, x.designation, 'libelle_proche', least(x.hits * 10, 70)
       from (
         select a.id, a.reference, a.designation,
                (select count(*) from unnest(words) w where x2.d like '%' || w || '%')::int as hits
           from public.articles a
           cross join lateral (select lower(public.unaccent(coalesce(a.designation, ''))) as d) x2
          where nwords > 0 and a.company_id = _company and a.is_active
            and x2.d like any (array(select '%' || w || '%' from unnest(words) w))
       ) x
      where x.hits >= least(2, nwords)
      order by x.hits desc, x.reference
      limit 10)
  )
  select d.id, d.reference, d.designation, d.reason, d.score
    from (select distinct on (s.id) s.id, s.reference, s.designation, s.reason, s.score
            from s order by s.id, s.score desc) d
   order by d.score desc, d.reference
   limit 20;
end $$;
revoke all on function public.shopify_link_suggestions(uuid, text) from public, anon;
grant execute on function public.shopify_link_suggestions(uuid, text) to authenticated;

-- 7. Décisions manuelles (administrateurs), tracées dans events
create or replace function public.shopify_link_variant(_company uuid, _variant text, _article uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_l  public.shopify_links%rowtype;
  other  text;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.shopify_products where company_id = _company and shopify_variant_id = _variant) then
    raise exception 'Produit Shopify introuvable.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.articles where id = _article and company_id = _company) then
    raise exception 'Article introuvable dans cette société.' using errcode = 'P0002';
  end if;
  select coalesce(p.product_title, l.shopify_variant_id) into other
    from public.shopify_links l
    left join public.shopify_products p on p.company_id = l.company_id and p.shopify_variant_id = l.shopify_variant_id
   where l.company_id = _company and l.article_id = _article and l.shopify_variant_id <> _variant
     and l.status in ('auto_exact', 'valide')
   limit 1;
  if other is not null then
    raise exception 'Cet article est déjà relié au produit Shopify « % ». Déliez-le d''abord.', other using errcode = '23505';
  end if;

  select * into old_l from public.shopify_links where company_id = _company and shopify_variant_id = _variant;
  insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
  values (_company, _variant, _article, 'valide', null, auth.uid(), now())
  on conflict (company_id, shopify_variant_id) do update
    set article_id = excluded.article_id, status = 'valide', match_via = null,
        decided_by = excluded.decided_by, decided_at = now();

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'shopify_link', 'shopify_links', _variant, 'screen',
          case when old_l.id is null then null else jsonb_build_object('status', old_l.status, 'article_id', old_l.article_id) end,
          jsonb_build_object('status', 'valide', 'article_id', _article));
end $$;
revoke all on function public.shopify_link_variant(uuid, text, uuid) from public, anon;
grant execute on function public.shopify_link_variant(uuid, text, uuid) to authenticated;

-- _decision : 'a_valider' (délier / ne plus ignorer) ou 'ignore'
create or replace function public.shopify_set_variant_decision(_company uuid, _variant text, _decision text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_l public.shopify_links%rowtype;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if _decision not in ('a_valider', 'ignore') then
    raise exception 'Décision inconnue : %', _decision using errcode = '22023';
  end if;
  if not exists (select 1 from public.shopify_products where company_id = _company and shopify_variant_id = _variant) then
    raise exception 'Produit Shopify introuvable.' using errcode = 'P0002';
  end if;

  select * into old_l from public.shopify_links where company_id = _company and shopify_variant_id = _variant;
  insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
  values (_company, _variant, null, _decision, null, auth.uid(), now())
  on conflict (company_id, shopify_variant_id) do update
    set article_id = null, status = excluded.status, match_via = null,
        decided_by = excluded.decided_by, decided_at = now();

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(),
          case when _decision = 'ignore' then 'shopify_ignore' else 'shopify_unlink' end,
          'shopify_links', _variant, 'screen',
          case when old_l.id is null then null else jsonb_build_object('status', old_l.status, 'article_id', old_l.article_id) end,
          jsonb_build_object('status', _decision));
end $$;
revoke all on function public.shopify_set_variant_decision(uuid, text, text) from public, anon;
grant execute on function public.shopify_set_variant_decision(uuid, text, text) to authenticated;

-- 8. Fonctions internes de la fonction serveur (clé de service uniquement)

-- Variantes sans décision humaine + articles EXACTEMENT correspondants (SKU = référence, code-barres = code-barres)
create or replace function public._shopify_auto_candidates(_company uuid)
returns table (variant_id text, sku text, barcode text, candidates jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.shopify_variant_id, p.sku, p.barcode,
         coalesce((
           select jsonb_agg(c) from (
             select a.id as article_id, a.reference as article_reference, null::text as article_barcode, 'sku' as via,
                    exists (select 1 from public.shopify_links t where t.company_id = _company and t.article_id = a.id
                             and t.status = 'valide' and t.shopify_variant_id <> p.shopify_variant_id) as taken
               from public.articles a
              where nullif(btrim(p.sku), '') is not null and a.company_id = _company and a.is_active
                and upper(btrim(a.reference)) = upper(btrim(p.sku))
             union all
             select a.id, a.reference, b.barcode, 'barcode',
                    exists (select 1 from public.shopify_links t where t.company_id = _company and t.article_id = a.id
                             and t.status = 'valide' and t.shopify_variant_id <> p.shopify_variant_id)
               from public.article_barcodes b join public.articles a on a.id = b.article_id
              where nullif(btrim(p.barcode), '') is not null and a.company_id = _company and a.is_active
                and b.barcode = btrim(p.barcode)
           ) c
         ), '[]'::jsonb)
    from public.shopify_products p
   where p.company_id = _company and p.removed_at is null
     and not exists (select 1 from public.shopify_links l where l.company_id = _company
                      and l.shopify_variant_id = p.shopify_variant_id and l.status <> 'auto_exact')
$$;
revoke all on function public._shopify_auto_candidates(uuid) from public, anon, authenticated;
grant execute on function public._shopify_auto_candidates(uuid) to service_role;

-- Applique la liste COMPLÈTE des liaisons automatiques voulues, marque les variantes disparues,
-- trace chaque changement et la lecture. _links = [{variant_id, article_id, via}].
create or replace function public._shopify_apply_auto_links(_company uuid, _links jsonb, _actor uuid, _run_started_at timestamptz, _stats jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n_removed int;
  n_new     int;
  n_dropped int;
begin
  -- Variantes absentes de la lecture complète : marquées retirées (jamais supprimées)
  update public.shopify_products set removed_at = now()
   where company_id = _company and removed_at is null and synced_at < _run_started_at;
  get diagnostics n_removed = row_count;

  drop table if exists pg_temp._want;
  create temp table _want on commit drop as
  select x.variant_id, x.article_id, x.via
    from jsonb_to_recordset(coalesce(_links, '[]'::jsonb)) as x(variant_id text, article_id uuid, via text)
    join public.shopify_products p on p.company_id = _company and p.shopify_variant_id = x.variant_id and p.removed_at is null
    join public.articles a on a.id = x.article_id and a.company_id = _company;

  -- Liaisons automatiques qui ne tiennent plus (SKU changé, variante retirée…)
  with d as (
    delete from public.shopify_links l
     where l.company_id = _company and l.status = 'auto_exact'
       and not exists (select 1 from _want w where w.variant_id = l.shopify_variant_id and w.article_id = l.article_id)
    returning l.shopify_variant_id, l.article_id, l.match_via
  ), ev as (
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    select _company, _actor, 'shopify_auto_unlink', 'shopify_links', d.shopify_variant_id, 'api',
           jsonb_build_object('status', 'auto_exact', 'article_id', d.article_id, 'via', d.match_via), null
      from d
    returning 1
  )
  select count(*) into n_dropped from ev;

  -- Nouvelles liaisons automatiques (jamais par-dessus une décision humaine)
  with i as (
    insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
    select _company, w.variant_id, w.article_id, 'auto_exact', w.via, null, now() from _want w
    on conflict (company_id, shopify_variant_id) do nothing
    returning shopify_variant_id, article_id, match_via
  ), ev as (
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    select _company, _actor, 'shopify_auto_link', 'shopify_links', i.shopify_variant_id, 'api', null,
           jsonb_build_object('status', 'auto_exact', 'article_id', i.article_id, 'via', i.match_via)
      from i
    returning 1
  )
  select count(*) into n_new from ev;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, _actor, 'shopify_sync', 'shopify_products', _company::text, 'api', null,
          coalesce(_stats, '{}'::jsonb) || jsonb_build_object('auto_linked_new', n_new, 'auto_unlinked', n_dropped, 'removed', n_removed));

  return jsonb_build_object('auto_linked_new', n_new, 'auto_unlinked', n_dropped, 'removed', n_removed);
end $$;
revoke all on function public._shopify_apply_auto_links(uuid, jsonb, uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public._shopify_apply_auto_links(uuid, jsonb, uuid, timestamptz, jsonb) to service_role;
