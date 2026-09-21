-- =====================================================================
-- Mission 03 — carte « Publier ou retirer un article du site depuis sa fiche dans le DMS » (W-8).
--
-- Depuis la fiche article (case « Publiable » cochée), un administrateur peut :
--   publier       → crée le produit Shopify (titre et description web, photos du DMS, prix TTC,
--                    stock, SKU = référence) et le relie (shopify_links « valide ») ;
--   retirer       → met le produit en BROUILLON sur Shopify (jamais supprimé) ;
--   remettre      → repasse un produit retiré en ligne ;
--   mettre à jour → repousse titre, description et photos manquantes.
-- Les appels à Shopify sont faits par la fonction serveur shopify-publish ; ici : le contexte lu par la
-- fonction, l'enregistrement du résultat (instantané, liaison, journal, events) et l'état pour la fiche.
-- Soumis au même MODE ESSAI que la synchronisation (20260921110000) : « arrêtée » → rien n'est écrit ;
-- « essai » → seulement les articles de la liste d'essai ; « tous » → tout article publiable.
-- Additif uniquement : 1 table, des fonctions.
-- =====================================================================

-- Photos du DMS envoyées sur un produit Shopify (pour ne pas les renvoyer à chaque mise à jour)
create table if not exists public.shopify_published_media (
  company_id          uuid not null references public.companies(id) on delete cascade,
  attachment_id       uuid not null references public.attachments(id) on delete cascade,
  shopify_product_id  text not null,
  article_id          uuid references public.articles(id) on delete set null,
  pushed_at           timestamptz not null default now(),
  primary key (company_id, attachment_id, shopify_product_id)
);
alter table public.shopify_published_media enable row level security;
revoke all on public.shopify_published_media from anon;
revoke insert, update, delete on public.shopify_published_media from authenticated;
drop policy if exists shopify_published_media_select on public.shopify_published_media;
create policy shopify_published_media_select on public.shopify_published_media for select to authenticated
  using (public.is_admin(company_id));

-- Contexte complet d'un article pour la fonction serveur (clé de service)
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
    'link', (select jsonb_build_object('variant_id', l.shopify_variant_id, 'product_id', p.shopify_product_id,
                                       'product_status', p.status, 'link_status', l.status)
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

-- Enregistre le résultat d'une action (clé de service) : instantané, liaison, photos, journal, events.
-- _action : 'publication' | 'retrait' | 'remise_en_ligne' | 'mise_a_jour'
create or replace function public._shopify_publish_record(
  _company uuid, _article uuid, _action text, _ok boolean,
  _product text, _variant text, _product_status text, _title text, _handle text,
  _price numeric, _qty integer, _sku text, _media uuid[], _actor uuid, _detail text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kind text := case _action when 'retrait' then 'retrait' when 'publication' then 'publication'
                            when 'remise_en_ligne' then 'publication' else 'mise_a_jour' end;
  old_l public.shopify_links%rowtype;
begin
  if _action not in ('publication', 'retrait', 'remise_en_ligne', 'mise_a_jour') then
    raise exception 'Action inconnue : %', _action using errcode = '22023';
  end if;
  if not exists (select 1 from public.articles where id = _article and company_id = _company) then
    raise exception 'Article introuvable dans cette société.' using errcode = 'P0002';
  end if;

  if _ok then
    if _variant is not null and _product is not null then
      insert into public.shopify_products (company_id, shopify_product_id, shopify_variant_id, product_title, variant_title,
                                           handle, status, sku, price, inventory_quantity, synced_at)
      values (_company, _product, _variant, _title, 'Default Title', _handle, _product_status, _sku, _price, _qty, now())
      on conflict (company_id, shopify_variant_id) do update
        set product_title = coalesce(excluded.product_title, shopify_products.product_title),
            handle = coalesce(excluded.handle, shopify_products.handle),
            status = coalesce(excluded.status, shopify_products.status),
            price = coalesce(excluded.price, shopify_products.price),
            inventory_quantity = coalesce(excluded.inventory_quantity, shopify_products.inventory_quantity),
            removed_at = null;
    elsif _product is not null and _product_status is not null then
      update public.shopify_products set status = _product_status
       where company_id = _company and shopify_product_id = _product;
    end if;

    if _action = 'publication' and _variant is not null then
      select * into old_l from public.shopify_links where company_id = _company and shopify_variant_id = _variant;
      insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
      values (_company, _variant, _article, 'valide', 'sku', _actor, now())
      on conflict (company_id, shopify_variant_id) do update
        set article_id = excluded.article_id, status = 'valide', match_via = 'sku',
            decided_by = excluded.decided_by, decided_at = now();
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, _actor, 'shopify_link', 'shopify_links', _variant, 'screen',
              case when old_l.id is null then null else jsonb_build_object('status', old_l.status, 'article_id', old_l.article_id) end,
              jsonb_build_object('status', 'valide', 'article_id', _article, 'via', 'publication'));
    end if;

    if _product is not null and coalesce(array_length(_media, 1), 0) > 0 then
      insert into public.shopify_published_media (company_id, attachment_id, shopify_product_id, article_id)
      select _company, x.id, _product, _article
        from public.attachments x
       where x.id = any(_media) and x.company_id = _company and x.entity_type = 'article' and x.entity_id = _article
      on conflict do nothing;
    end if;
  end if;

  insert into public.shopify_sync_log (company_id, article_id, shopify_product_id, shopify_variant_id, kind, status,
                                       price_sent, qty_sent, detail, actor_id)
  values (_company, _article, _product, _variant, kind, case when _ok then 'ok' else 'erreur' end,
          _price, _qty, left(_detail, 1000), _actor);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, _actor, 'shopify_' || _action, 'articles', _article::text, 'screen', null,
          jsonb_build_object('ok', _ok, 'product_id', _product, 'variant_id', _variant, 'status', _product_status,
                             'price', _price, 'qty', _qty, 'photos', coalesce(array_length(_media, 1), 0),
                             'detail', left(_detail, 300)));
end $$;
revoke all on function public._shopify_publish_record(uuid, uuid, text, boolean, text, text, text, text, text, numeric, integer, text, uuid[], uuid, text)
  from public, anon, authenticated;
grant execute on function public._shopify_publish_record(uuid, uuid, text, boolean, text, text, text, text, text, numeric, integer, text, uuid[], uuid, text)
  to service_role;

-- État « site » d'un article pour sa fiche (administrateurs et vendeurs)
create or replace function public.shopify_article_site_status(_company uuid, _article uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not (public.is_admin(_company) or public.has_role(_company, 'vendeur')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if not exists (select 1 from public.articles where id = _article and company_id = _company) then
    return null;
  end if;
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
