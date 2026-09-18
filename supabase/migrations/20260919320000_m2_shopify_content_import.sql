-- =====================================================================
-- Mission 03 — carte « Reprendre une fois les photos et textes de Shopify dans le DMS »
-- Décision W-4 : après cette reprise, le DMS fait foi pour les photos et les textes.
--
-- Pour chaque produit Shopify RELIÉ à un article (shopify_links auto_exact / valide) :
--   - titre web et description web (HTML simple nettoyé) copiés dans la fiche article
--     SEULEMENT s'ils sont vides : un texte déjà saisi dans le DMS n'est jamais écrasé, le texte
--     Shopify est alors noté à côté (shopify_content_imports.shopify_title / shopify_description) ;
--   - toutes les images du produit copiées dans le Storage du DMS (bucket privé « ged », GED de
--     l'article, dossier « Photos »), dans l'ordre, image principale en premier, avec texte
--     alternatif. Clé d'idempotence = id d'image Shopify (attachments.external_id) : relancer ne
--     duplique rien ;
--   - chaque reprise tracée dans events (action shopify_content_import, origine « reprise_shopify »).
-- Écrit UNIQUEMENT par la fonction serveur shopify-import-content (clé de service).
-- Additif uniquement : 2 colonnes sur articles, 3 colonnes + 1 index sur attachments, 1 table,
-- 2 fonctions internes.
-- =====================================================================

-- 1. Textes web de l'article (le DMS fait foi après la reprise)
alter table public.articles add column if not exists web_title text;
alter table public.articles add column if not exists web_description text;   -- HTML simple et sûr
comment on column public.articles.web_title is 'Titre affiché sur le site (repris une fois de Shopify, puis tenu dans le DMS).';
comment on column public.articles.web_description is 'Description du site, HTML simple nettoyé (p, br, listes, gras, italique, titres, liens).';

-- 2. Photos : texte alternatif, rang d'affichage, id d'origine (idempotence de la reprise)
alter table public.attachments add column if not exists alt_text text;
alter table public.attachments add column if not exists sort_order integer;
alter table public.attachments add column if not exists external_id text;   -- ex. gid://shopify/MediaImage/123
create unique index if not exists uq_attachments_external
  on public.attachments (company_id, entity_type, entity_id, external_id)
  where external_id is not null;

-- 3. Journal de reprise par produit Shopify ↔ article
create table if not exists public.shopify_content_imports (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  shopify_product_id   text not null,
  article_id           uuid not null references public.articles(id) on delete cascade,
  status               text not null check (status in ('fait', 'erreur')),
  images_found         integer not null default 0,     -- images du produit sur Shopify
  images_added         integer not null default 0,     -- ajoutées lors de la dernière reprise
  images_total         integer not null default 0,     -- images Shopify présentes dans la fiche
  title_applied        boolean not null default false,
  description_applied  boolean not null default false,
  dms_text_kept        boolean not null default false,  -- texte DMS gardé, Shopify noté à côté
  shopify_title        text,
  shopify_description  text,                           -- HTML nettoyé, gardé pour mémoire
  error                text,
  imported_by          uuid references auth.users(id) on delete set null,
  imported_at          timestamptz not null default now(),
  first_imported_at    timestamptz not null default now(),
  unique (company_id, shopify_product_id, article_id)
);
create index if not exists idx_shopify_content_imports_article on public.shopify_content_imports (company_id, article_id);

alter table public.shopify_content_imports enable row level security;
revoke all on public.shopify_content_imports from anon;
drop policy if exists shopify_content_imports_select on public.shopify_content_imports;
create policy shopify_content_imports_select on public.shopify_content_imports for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));

-- 4. Produits à reprendre (clé de service uniquement)
--    _product null : produits reliés pas encore repris, en erreur ou incomplets (une image n'a pas
--                    pu être copiée), sauf ceux déjà tentés depuis _before (début de la relance) ;
--    _product donné : ce produit, même déjà repris (relance : n'ajoute que le manquant).
create or replace function public._shopify_content_targets(_company uuid, _product text, _before timestamptz, _limit int)
returns table (
  shopify_product_id text, article_id uuid, article_reference text, article_designation text,
  web_title text, web_description text, imported_media_ids text[], existing_photo_count int
)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.shopify_product_id, a.id, a.reference, a.designation, a.web_title, a.web_description,
         coalesce((select array_agg(x.external_id order by x.external_id) from public.attachments x
                    where x.company_id = _company and x.entity_type = 'article' and x.entity_id = a.id
                      and x.external_id is not null), '{}'),
         (select count(*)::int from public.attachments x
           where x.company_id = _company and x.entity_type = 'article' and x.entity_id = a.id
             and coalesce(x.content_type, '') like 'image/%' and (x.folder is null or x.folder = 'Photos'))
    from (
      select distinct p.shopify_product_id, l.article_id
        from public.shopify_links l
        join public.shopify_products p on p.company_id = l.company_id and p.shopify_variant_id = l.shopify_variant_id
       where l.company_id = _company and l.status in ('auto_exact', 'valide') and l.article_id is not null
         and p.removed_at is null
         and (_product is null or p.shopify_product_id = _product)
    ) t
    join public.articles a on a.id = t.article_id and a.company_id = _company
   where _product is not null
      or not exists (select 1 from public.shopify_content_imports i
                      where i.company_id = _company and i.shopify_product_id = t.shopify_product_id
                        and i.article_id = t.article_id
                        and ((i.status = 'fait' and i.images_total >= i.images_found)
                             or i.imported_at >= coalesce(_before, now())))
   order by t.shopify_product_id, a.id
   limit greatest(coalesce(_limit, 20), 1)
$$;
revoke all on function public._shopify_content_targets(uuid, text, timestamptz, int) from public, anon, authenticated;
grant execute on function public._shopify_content_targets(uuid, text, timestamptz, int) to service_role;

-- 5. Applique la reprise d'UN produit sur UN article. Règle « ne jamais écraser » appliquée ici
--    (même si l'appelant se trompe) : textes écrits seulement s'ils sont vides ; images ajoutées
--    seulement si leur id Shopify n'est pas déjà présent. _images = [{media_id, storage_path,
--    file_name, content_type, size_bytes, alt_text, position}] (fichiers déjà déposés dans « ged »).
create or replace function public._shopify_apply_content(
  _company uuid, _article uuid, _product text, _title text, _description text,
  _images jsonb, _images_found int, _actor uuid, _error text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a            public.articles%rowtype;
  t_applied    boolean := false;
  d_applied    boolean := false;
  kept         boolean := false;
  n_added      int := 0;
  n_total      int := 0;
  txt_old      text;
begin
  select * into a from public.articles where id = _article and company_id = _company for update;
  if not found then
    raise exception 'Article introuvable dans cette société.' using errcode = 'P0002';
  end if;

  if _error is not null then
    insert into public.shopify_content_imports (company_id, shopify_product_id, article_id, status, images_found, error, imported_by, imported_at)
    values (_company, _product, _article, 'erreur', coalesce(_images_found, 0), left(_error, 500), _actor, now())
    on conflict (company_id, shopify_product_id, article_id) do update
      set status = case when shopify_content_imports.status = 'fait' then 'fait' else 'erreur' end,
          error = excluded.error, imported_at = now(), imported_by = excluded.imported_by;
    return jsonb_build_object('status', 'erreur');
  end if;

  -- Textes : jamais par-dessus un texte déjà saisi
  if nullif(btrim(coalesce(_title, '')), '') is not null then
    if nullif(btrim(coalesce(a.web_title, '')), '') is null then
      update public.articles set web_title = btrim(_title) where id = _article;
      t_applied := true;
    elsif btrim(a.web_title) <> btrim(_title) then
      kept := true;
    end if;
  end if;
  txt_old := btrim(regexp_replace(regexp_replace(coalesce(a.web_description, ''), '<[^>]*>', '', 'g'), '&nbsp;|\s+', ' ', 'g'));
  if nullif(btrim(coalesce(_description, '')), '') is not null then
    if txt_old = '' then
      update public.articles set web_description = _description where id = _article;
      d_applied := true;
    elsif btrim(a.web_description) <> btrim(_description) then
      kept := true;
    end if;
  end if;

  -- Images : clé = id d'image Shopify, jamais de doublon
  with ins as (
    insert into public.attachments (company_id, entity_type, entity_id, file_name, storage_path, content_type,
                                    size_bytes, note, folder, uploaded_by, alt_text, sort_order, external_id)
    select _company, 'article', _article, x.file_name, x.storage_path, x.content_type, x.size_bytes,
           'Reprise Shopify', 'Photos', _actor, nullif(btrim(x.alt_text), ''), x.position, x.media_id
      from jsonb_to_recordset(coalesce(_images, '[]'::jsonb))
           as x(media_id text, storage_path text, file_name text, content_type text, size_bytes bigint, alt_text text, position int)
     where x.media_id is not null and x.storage_path like _company::text || '/article/' || _article::text || '/%'
    on conflict (company_id, entity_type, entity_id, external_id) where external_id is not null do nothing
    returning 1
  )
  select count(*) into n_added from ins;

  select count(*) into n_total from public.attachments
   where company_id = _company and entity_type = 'article' and entity_id = _article and external_id like 'gid://shopify/%';

  insert into public.shopify_content_imports (company_id, shopify_product_id, article_id, status, images_found, images_added,
         images_total, title_applied, description_applied, dms_text_kept, shopify_title, shopify_description,
         error, imported_by, imported_at)
  values (_company, _product, _article, 'fait', coalesce(_images_found, 0), n_added, n_total, t_applied, d_applied, kept,
          nullif(btrim(coalesce(_title, '')), ''), nullif(btrim(coalesce(_description, '')), ''), null, _actor, now())
  on conflict (company_id, shopify_product_id, article_id) do update
    set status = 'fait', images_found = excluded.images_found, images_added = excluded.images_added,
        images_total = excluded.images_total,
        title_applied = shopify_content_imports.title_applied or excluded.title_applied,
        description_applied = shopify_content_imports.description_applied or excluded.description_applied,
        dms_text_kept = excluded.dms_text_kept,
        shopify_title = excluded.shopify_title, shopify_description = excluded.shopify_description,
        error = null, imported_by = excluded.imported_by, imported_at = now();

  -- Trace (seulement si quelque chose a changé ou si le texte DMS a été gardé)
  if t_applied or d_applied or kept or n_added > 0 then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, _actor, 'shopify_content_import', 'articles', _article::text, 'reprise_shopify',
            jsonb_build_object('web_title', a.web_title, 'web_description_set', txt_old <> ''),
            jsonb_build_object('source', 'reprise Shopify', 'shopify_product_id', _product,
                               'title_applied', t_applied, 'description_applied', d_applied,
                               'dms_text_kept', kept, 'images_added', n_added, 'images_total', n_total));
  end if;

  return jsonb_build_object('status', 'fait', 'title_applied', t_applied, 'description_applied', d_applied,
                            'dms_text_kept', kept, 'images_added', n_added, 'images_total', n_total);
end $$;
revoke all on function public._shopify_apply_content(uuid, uuid, text, text, text, jsonb, int, uuid, text) from public, anon, authenticated;
grant execute on function public._shopify_apply_content(uuid, uuid, text, text, text, jsonb, int, uuid, text) to service_role;
