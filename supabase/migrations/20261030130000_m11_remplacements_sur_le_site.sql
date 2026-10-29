-- =====================================================================
-- Mission 03 / M11 — Une reference remplacee bascule sur la nouvelle, sur le site (decision client
-- 29-30/10/2026, voir docs/bible/missions/mission-03-shopify.md).
--
-- Quand A (reliee a un produit du site) est remplacee par B (articles.superseded_by_id, fin de chaine
-- = article_final_replacement) :
--   - B est publiee (ou remise en ligne / mise a jour), A est retiree (brouillon, jamais supprimee),
--     une redirection Shopify /products/<A> -> /products/<B> est creee ;
--   - si la fiche de B n'a ni photo ni texte web, le DMS reprend d'abord ceux du produit de A ;
--   - la fiche produit de B porte « Remplace aussi la reference 14622167AA » (toute la chaine).
-- Les appels a Shopify sont faits par la fonction serveur shopify-publish (action « switch »). Ici :
--   1. shopify_redirects : journal des redirections posees (qui, quand, de quoi vers quoi, id Shopify) ;
--   2. le journal des envois accepte le genre « redirection » ;
--   3. _shopify_publish_context : + handle du produit relie, + anciennes references de la chaine ;
--   4. _shopify_switch_context / _shopify_switch_prepare / _shopify_switch_record (cle de service) ;
--   5. shopify_article_site_status : + « remplacee par » et « anciennes references encore reliees » ;
--   6. shopify_replaced_linked_products : la liste pour l'action groupee de l'ecran Produits Shopify.
-- Additif uniquement. Rien n'est ecrit sur Shopify par cette migration.
-- =====================================================================

-- 1. Journal des redirections
create table if not exists public.shopify_redirects (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  article_from         uuid not null references public.articles(id) on delete cascade,
  article_to           uuid not null references public.articles(id) on delete cascade,
  shopify_redirect_id  text,
  path_from            text not null,
  path_to              text not null,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint shopify_redirects_pas_soi_meme check (article_from <> article_to),
  unique (company_id, article_from, article_to)
);
create index if not exists idx_shopify_redirects_to on public.shopify_redirects (company_id, article_to);
alter table public.shopify_redirects enable row level security;
revoke all on public.shopify_redirects from anon;
drop policy if exists shopify_redirects_select on public.shopify_redirects;
create policy shopify_redirects_select on public.shopify_redirects for select to authenticated
  using (public.is_member(company_id));
drop policy if exists shopify_redirects_write on public.shopify_redirects;
create policy shopify_redirects_write on public.shopify_redirects for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));
comment on table public.shopify_redirects is
  'Redirections posees sur le site quand une reference remplacee bascule sur la nouvelle : /products/<ancienne> -> /products/<nouvelle>.';

-- 2. Le journal des envois accepte « redirection »
alter table public.shopify_sync_log drop constraint if exists shopify_sync_log_kind_check;
alter table public.shopify_sync_log add constraint shopify_sync_log_kind_check
  check (kind in ('stock_prix', 'publication', 'retrait', 'mise_a_jour', 'redirection'));

-- Anciennes references qui menent a un article (toute la chaine, 20 sauts au plus, boucles coupees).
create or replace function public._article_old_references(_company uuid, _article uuid)
returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive pred as (
    select a.id, a.reference, 1 as depth, array[_article, a.id] as path
      from public.articles a
     where a.company_id = _company and a.superseded_by_id = _article
    union all
    select a.id, a.reference, p.depth + 1, p.path || a.id
      from public.articles a
      join pred p on a.superseded_by_id = p.id
     where a.company_id = _company and p.depth < 20 and not (a.id = any (p.path))
  )
  select coalesce(array_agg(reference order by depth, reference), '{}')
    from (select distinct on (id) id, reference, depth from pred order by id, depth) x;
$$;
revoke all on function public._article_old_references(uuid, uuid) from public, anon;
grant execute on function public._article_old_references(uuid, uuid) to authenticated, service_role;

-- 3. Contexte de publication : + handle, + anciennes references (meme signature qu'en 20260921111000)
create or replace function public._shopify_publish_context(_company uuid, _article uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a public.articles%rowtype;
  r jsonb;
begin
  select * into a from public.articles where id = _article and company_id = _company;
  if not found then return null; end if;
  select jsonb_build_object(
    'article_id', a.id, 'reference', a.reference, 'designation', a.designation,
    'web_title', a.web_title, 'web_description', a.web_description,
    'publishable', a.publishable, 'is_active', a.is_active, 'mgmt_type', a.mgmt_type::text,
    'sale_price_ttc', a.sale_price_ttc, 'sale_price_ht', a.sale_price_ht, 'vat_rate', a.vat_rate,
    'round_up', coalesce((select round_sale_prices_up from public.companies where id = _company), true),
    'real_qty', coalesce((select sum(qty_delta) from public.stock_moves where article_id = a.id and not is_reservation), 0),
    'reserved_qty', coalesce((select sum(qty_delta) from public.stock_moves where article_id = a.id and is_reservation), 0),
    'mode', public._shopify_sync_mode(_company),
    'in_trial', exists (select 1 from public.shopify_sync_trial t where t.company_id = _company and t.article_id = a.id),
    'superseded_by_id', a.superseded_by_id,
    'old_references', to_jsonb(public._article_old_references(_company, a.id)),
    'link', (select jsonb_build_object('variant_id', l.shopify_variant_id, 'product_id', p.shopify_product_id,
                                       'product_status', p.status, 'handle', p.handle, 'link_status', l.status)
               from public.shopify_links l
               left join public.shopify_products p on p.company_id = l.company_id and p.shopify_variant_id = l.shopify_variant_id
              where l.company_id = _company and l.article_id = a.id and l.status in ('auto_exact', 'valide')
              order by l.decided_at desc limit 1),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'attachment_id', x.id, 'storage_path', x.storage_path, 'content_type', x.content_type,
               'alt_text', x.alt_text, 'external_id', x.external_id,
               'pushed_to', (select coalesce(jsonb_agg(m.shopify_product_id), '[]'::jsonb)
                               from public.shopify_published_media m
                              where m.company_id = _company and m.attachment_id = x.id))
             order by coalesce(x.sort_order, -1), x.created_at)
        from public.attachments x
       where x.company_id = _company and x.entity_type = 'article' and x.entity_id = a.id
         and coalesce(x.content_type, '') like 'image/%'
         and (x.folder is null or x.folder = 'Photos')), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public._shopify_publish_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public._shopify_publish_context(uuid, uuid) to service_role;

-- 4a. Contexte d'une bascule : l'ancienne reference, la fin de chaine, la redirection deja posee
create or replace function public._shopify_switch_context(_company uuid, _article uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  final_id uuid;
  old_ctx  jsonb;
begin
  old_ctx := public._shopify_publish_context(_company, _article);
  if old_ctx is null then return null; end if;
  final_id := public.article_final_replacement(_article);
  return jsonb_build_object(
    'mode', public._shopify_sync_mode(_company),
    'old', old_ctx,
    'next', case when final_id = _article then old_ctx else public._shopify_publish_context(_company, final_id) end,
    'redirect', (select jsonb_build_object('id', r.id, 'shopify_redirect_id', r.shopify_redirect_id,
                                           'path_from', r.path_from, 'path_to', r.path_to, 'created_at', r.created_at)
                   from public.shopify_redirects r
                  where r.company_id = _company and r.article_from = _article and r.article_to = final_id
                    and r.shopify_redirect_id is not null)
  );
end $$;
revoke all on function public._shopify_switch_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public._shopify_switch_context(uuid, uuid) to service_role;

-- 4b. Avant de publier la nouvelle reference : elle herite de « Publiable » (trace dans events)
create or replace function public._shopify_switch_prepare(_company uuid, _from uuid, _to uuid, _actor uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.articles set publishable = true
   where id = _to and company_id = _company and coalesce(publishable, false) = false;
  if found then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, _actor, 'shopify_bascule_publiable', 'articles', _to::text, 'screen',
            jsonb_build_object('publishable', false),
            jsonb_build_object('publishable', true, 'herite_de', _from));
  end if;
end $$;
revoke all on function public._shopify_switch_prepare(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public._shopify_switch_prepare(uuid, uuid, uuid, uuid) to service_role;

-- 4c. Resultat d'une redirection (journal des redirections + journal des envois + events)
--     et resume de la bascule (_kind = 'bascule' : events seulement).
create or replace function public._shopify_switch_record(
  _company uuid, _from uuid, _to uuid, _kind text, _ok boolean,
  _redirect_id text, _path_from text, _path_to text, _actor uuid, _detail text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if _kind not in ('redirection', 'bascule') then
    raise exception 'Genre inconnu : %', _kind using errcode = '22023';
  end if;
  if not exists (select 1 from public.articles where id = _from and company_id = _company)
     or not exists (select 1 from public.articles where id = _to and company_id = _company) then
    raise exception 'Article introuvable dans cette societe.' using errcode = 'P0002';
  end if;

  if _kind = 'redirection' then
    if _ok then
      insert into public.shopify_redirects (company_id, article_from, article_to, shopify_redirect_id, path_from, path_to, created_by)
      values (_company, _from, _to, _redirect_id, coalesce(_path_from, ''), coalesce(_path_to, ''), _actor)
      on conflict (company_id, article_from, article_to) do update
        set shopify_redirect_id = coalesce(excluded.shopify_redirect_id, shopify_redirects.shopify_redirect_id),
            path_from = excluded.path_from, path_to = excluded.path_to, updated_at = now();
    end if;
    insert into public.shopify_sync_log (company_id, article_id, kind, status, detail, actor_id)
    values (_company, _from, 'redirection', case when _ok then 'ok' else 'erreur' end,
            left(coalesce(_path_from, '') || ' -> ' || coalesce(_path_to, '') || coalesce(' : ' || _detail, ''), 1000), _actor);
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, _actor, 'shopify_redirection', 'articles', _from::text, 'screen', null,
            jsonb_build_object('ok', _ok, 'to', _to, 'shopify_redirect_id', _redirect_id,
                               'path_from', _path_from, 'path_to', _path_to, 'detail', left(_detail, 300)));
  else
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, _actor, 'shopify_bascule', 'articles', _from::text, 'screen', null,
            jsonb_build_object('ok', _ok, 'to', _to, 'detail', left(_detail, 1000)));
  end if;
end $$;
revoke all on function public._shopify_switch_record(uuid, uuid, uuid, text, boolean, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public._shopify_switch_record(uuid, uuid, uuid, text, boolean, text, text, text, uuid, text)
  to service_role;

-- 5. Etat « site » d'un article pour sa fiche : + remplacee par, + anciennes references encore reliees
create or replace function public.shopify_article_site_status(_company uuid, _article uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r        jsonb;
  final_id uuid;
begin
  if not (public.is_admin(_company) or public.has_role(_company, 'vendeur')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if not exists (select 1 from public.articles where id = _article and company_id = _company) then
    return null;
  end if;
  final_id := public.article_final_replacement(_article);
  select jsonb_build_object(
    'mode', public._shopify_sync_mode(_company),
    'in_trial', exists (select 1 from public.shopify_sync_trial t where t.company_id = _company and t.article_id = _article),
    'link', (select jsonb_build_object('variant_id', l.shopify_variant_id, 'product_id', p.shopify_product_id,
                                       'product_status', p.status, 'handle', p.handle, 'price', p.price,
                                       'inventory_quantity', p.inventory_quantity, 'link_status', l.status)
               from public.shopify_links l
               left join public.shopify_products p on p.company_id = l.company_id and p.shopify_variant_id = l.shopify_variant_id
              where l.company_id = _company and l.article_id = _article and l.status in ('auto_exact', 'valide')
              order by l.decided_at desc limit 1),
    'queued', exists (select 1 from public.shopify_sync_queue q where q.company_id = _company and q.article_id = _article),
    'replaced_by', case when final_id = _article then null else (
        select jsonb_build_object('article_id', f.id, 'reference', f.reference, 'designation', f.designation,
                 'redirect_done', exists (select 1 from public.shopify_redirects x
                                           where x.company_id = _company and x.article_from = _article
                                             and x.article_to = f.id and x.shopify_redirect_id is not null))
          from public.articles f where f.id = final_id) end,
    'old_linked', coalesce((
        select jsonb_agg(jsonb_build_object('article_id', o.id, 'reference', o.reference, 'product_status', p.status,
                 'redirect_done', exists (select 1 from public.shopify_redirects x
                                           where x.company_id = _company and x.article_from = o.id
                                             and x.article_to = _article and x.shopify_redirect_id is not null))
                         order by o.reference)
          from public.articles o
          join public.shopify_links l on l.company_id = _company and l.article_id = o.id and l.status in ('auto_exact', 'valide')
          left join public.shopify_products p on p.company_id = l.company_id and p.shopify_variant_id = l.shopify_variant_id
         where o.company_id = _company and o.id <> _article
           and o.reference = any (public._article_old_references(_company, _article))), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
              select kind, status, price_sent, qty_sent, detail, created_at
                from public.shopify_sync_log
               where company_id = _company and article_id = _article
               order by created_at desc limit 5) x), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.shopify_article_site_status(uuid, uuid) from public, anon;
grant execute on function public.shopify_article_site_status(uuid, uuid) to authenticated;

-- 6. Produits du site relies a une reference remplacee (ecran Produits Shopify, action groupee)
create or replace function public.shopify_replaced_linked_products(_company uuid)
returns table (
  article_id uuid, reference text, designation text,
  shopify_product_id text, product_status text, product_title text, handle text,
  next_article_id uuid, next_reference text, next_designation text, next_product_status text, next_linked boolean,
  redirect_done boolean, old_in_trial boolean, next_in_trial boolean, done boolean
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_admin(_company) or public.has_role(_company, 'vendeur')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  with old as (
    select a.id, a.reference, a.designation, p.shopify_product_id, p.status, p.product_title, p.handle,
           public.article_final_replacement(a.id) as final_id
      from public.shopify_links l
      join public.articles a on a.id = l.article_id and a.company_id = _company and a.superseded_by_id is not null
      left join public.shopify_products p on p.company_id = l.company_id and p.shopify_variant_id = l.shopify_variant_id
     where l.company_id = _company and l.status in ('auto_exact', 'valide')
  )
  select o.id, o.reference, o.designation, o.shopify_product_id, o.status, o.product_title, o.handle,
         f.id, f.reference, f.designation, np.status, (nl.id is not null),
         (rd.id is not null),
         exists (select 1 from public.shopify_sync_trial t where t.company_id = _company and t.article_id = o.id),
         exists (select 1 from public.shopify_sync_trial t where t.company_id = _company and t.article_id = f.id),
         (coalesce(o.status, '') <> 'ACTIVE' and rd.id is not null and np.status = 'ACTIVE')
    from old o
    join public.articles f on f.id = o.final_id and f.id <> o.id
    left join public.shopify_links nl on nl.company_id = _company and nl.article_id = f.id and nl.status in ('auto_exact', 'valide')
    left join public.shopify_products np on np.company_id = _company and np.shopify_variant_id = nl.shopify_variant_id
    left join public.shopify_redirects rd on rd.company_id = _company and rd.article_from = o.id and rd.article_to = f.id
                                         and rd.shopify_redirect_id is not null
   order by (coalesce(o.status, '') <> 'ACTIVE' and rd.id is not null and np.status = 'ACTIVE'), o.reference;
end $$;
revoke all on function public.shopify_replaced_linked_products(uuid) from public, anon;
grant execute on function public.shopify_replaced_linked_products(uuid) to authenticated;
comment on function public.shopify_replaced_linked_products(uuid) is
  'Produits du site relies a une reference remplacee, avec la fin de chaine et l''etat de la bascule (ecran Produits Shopify).';
