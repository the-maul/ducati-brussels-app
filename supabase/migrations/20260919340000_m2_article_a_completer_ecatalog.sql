-- =====================================================================
-- Mission 05 — carte 4 « Ajouter un accessoire trouvé dans l'e-catalog Ducati ».
--
-- Pas d'API Ducati (décision 19/09) : le vendeur colle une référence ou un lien
-- e-catalog dans l'éditeur de document de vente.
--
--   1. Drapeau « à compléter » sur l'article (articles.to_complete + origine) :
--      un article créé depuis une vente (référence, désignation, prix de vente) attend
--      que le magasinier complète PA, fournisseur, famille. Filtre dans la liste.
--   2. Trace dans events (règle 4) : création d'un article « à compléter » et levée du
--      drapeau, écrites par un trigger (atomique avec l'écriture de l'article).
--   3. Recherche EXACTE d'une référence collée (référence, réf. fournisseur, code-barres ;
--      comparaison sans espaces / tirets / points, en majuscules), librairie comprise,
--      avec le stock et l'« en commande » (même calcul que part_order_article_search).
--
-- Additif uniquement : 2 colonnes, 1 index, 2 fonctions, 1 trigger. Aucune donnée écrite.
-- =====================================================================

-- 1. Drapeau « à compléter »
alter table public.articles
  add column if not exists to_complete boolean not null default false,
  add column if not exists to_complete_source text;

comment on column public.articles.to_complete is
  'Article créé au vol (ex. depuis une vente, référence e-catalog Ducati) : PA, fournisseur, famille à compléter par le magasin.';
comment on column public.articles.to_complete_source is
  'Origine de la création « à compléter » (ecatalog = collé depuis l''e-catalog Ducati dans une vente).';

create index if not exists idx_articles_to_complete
  on public.articles(company_id) where to_complete;

-- 2. Trace events
create or replace function public.trace_article_to_complete()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.to_complete then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (new.company_id, auth.uid(), 'article_to_complete', 'articles', new.id::text,
            coalesce(nullif(new.to_complete_source, ''), 'screen'), null,
            jsonb_build_object('reference', new.reference, 'designation', new.designation,
                               'sale_price_ht', new.sale_price_ht, 'sale_price_ttc', new.sale_price_ttc,
                               'mgmt_type', new.mgmt_type, 'is_library', new.is_library,
                               'catalog_url', new.catalog_url));
  elsif tg_op = 'UPDATE' and new.to_complete is distinct from old.to_complete then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (new.company_id, auth.uid(),
            case when new.to_complete then 'article_to_complete' else 'article_completed' end,
            'articles', new.id::text, 'screen',
            jsonb_build_object('to_complete', old.to_complete),
            jsonb_build_object('to_complete', new.to_complete, 'reference', new.reference,
                               'purchase_price', new.purchase_price, 'main_supplier_id', new.main_supplier_id,
                               'category_path', new.category_path));
  end if;
  return new;
end $$;

revoke all on function public.trace_article_to_complete() from public, anon, authenticated;

drop trigger if exists trg_articles_to_complete on public.articles;
create trigger trg_articles_to_complete after insert or update of to_complete on public.articles
  for each row execute function public.trace_article_to_complete();

-- 3. Recherche exacte d'une référence collée
create or replace function public.sale_article_exact_lookup(_company uuid, _ref text)
returns table (
  article_id uuid, reference text, designation text, supplier_ref text,
  sale_price_ht numeric, vat_rate numeric, mgmt_type text, is_library boolean,
  bin_location text, superseded_by_id uuid, equivalence_group uuid,
  brand text, catalog_url text, to_complete boolean, matched_on text,
  real_qty numeric, reserved_qty numeric, on_order_qty numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  raw text := upper(btrim(coalesce(_ref, '')));
  k   text := regexp_replace(upper(coalesce(_ref, '')), '[^A-Z0-9]', '', 'g');
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if char_length(k) < 3 then
    return;
  end if;

  return query
  with hits as (
    -- référence (index idx_articles_ref_compact)
    select a.id, 'reference'::text as m, 0 as rk
      from public.articles a
     where a.company_id = _company and a.is_active
       and regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') = k
    union all
    select a.id, 'supplier_ref', 1
      from public.articles a
     where a.company_id = _company and a.is_active
       and a.supplier_ref is not null
       and regexp_replace(upper(a.supplier_ref), '[^A-Z0-9]', '', 'g') = k
    union all
    select a.id, 'barcode', 2
      from public.article_barcodes b
      join public.articles a on a.id = b.article_id
     where a.company_id = _company and a.is_active
       and (upper(btrim(b.barcode)) = raw or upper(btrim(b.barcode)) = k)
  ), best as (
    select distinct on (h.id) h.id, h.m, h.rk from hits h order by h.id, h.rk
  )
  select a.id, a.reference, a.designation, a.supplier_ref,
         coalesce(a.sale_price_ht, 0), coalesce(a.vat_rate, 21), a.mgmt_type::text, a.is_library,
         a.bin_location, a.superseded_by_id, a.equivalence_group,
         a.brand, a.catalog_url, a.to_complete, b.m,
         st.real_qty, st.reserved_qty, oo.q
    from best b
    join public.articles a on a.id = b.id
    cross join lateral public.article_stock(a.id) st
    cross join lateral (select public._article_on_order_qty(a.id) as q) oo
   order by b.rk, a.reference
   limit 10;
end $$;

revoke all on function public.sale_article_exact_lookup(uuid, text) from public, anon;
grant execute on function public.sale_article_exact_lookup(uuid, text) to authenticated;

notify pgrst, 'reload schema';
