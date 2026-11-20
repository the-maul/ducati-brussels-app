-- =====================================================================
-- Perf 2 (20/11/2026) -- Ecrans Stock & inventaire (/stock) et Depreciations (/stock/depreciation)
-- pagines en base, totaux calcules en base.
--
-- Mesure avant (prod, admin ITALBIKE, navigateur) : /stock chargeait les 4 808 articles « actifs »
-- en 5 appels successifs de article_stock_list (1 000 lignes chacun, ~200 ms chacun, chacun
-- re-additionnant TOUS les mouvements de stock de la base), puis dessinait 4 808 lignes
-- (307 000 caracteres a l'ecran) : 8,7 s. /stock/depreciation : meme lecture, 9,6 s.
--
-- Apres : `stock_screen_page` renvoie en un appel la page demandee (100 lignes par defaut), le
-- nombre total de lignes et la valeur totale du stock filtre, calcules en base sur le meme
-- ensemble et avec les memes regles que l'ecran :
--   * perimetre = article_stock_list(_stock => 'actif') : articles avec au moins un mouvement ou
--     un stock mini ; memes colonnes, memes calculs (reel, reserve, disponible, PAMP, valeur) ;
--   * filtres de l'ecran, identiques au filtre JavaScript d'avant : texte (reference, designation,
--     casier, sans tenir compte des majuscules), stock <> 0, sous le mini, fournisseur, rayon
--     (code « RR- » en tete ou libelle contenu), « a commander » (sous le mini ou disponible < 0),
--     « dormant » des depreciations (disponible > 0) ; liste d'articles (`article_ids`, disponibilite
--     des lignes d'un document de vente, qui lisait avant tout le stock pour quelques lignes) ;
--   * tri par reference (comme article_stock_list), puis id pour une pagination stable.
-- L'export reste COMPLET : l'ecran lit toutes les pages (1 000 par appel) au moment d'exporter.
-- Perimetre lu sans parcourir tous les articles : ceux qui ont un mouvement + ceux qui ont un
-- stock mini (`stock_min > 0` = `coalesce(stock_min, 0) > 0`), index partiel ci-dessous.
-- Droits : SECURITY DEFINER + garde is_member(_company), comme article_stock_list. Rien n'est
-- ecrit ; aucune regle de stock touchee (le stock reste la somme des mouvements, B4 / B7).
-- Essai : supabase/tests/perf2_stock_ecran_equivalence.sql.
-- =====================================================================

create or replace function public.stock_screen_page(
  _company uuid,
  _filters jsonb default '{}'::jsonb,
  _limit integer default 100,
  _offset integer default 0)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with p as (
    select
      nullif(btrim(coalesce(_filters->>'q', '')), '')            as q,
      coalesce((_filters->>'only_stocked')::boolean, false)       as only_stocked,
      coalesce((_filters->>'below_min')::boolean, false)          as below_min,
      coalesce((_filters->>'reorder')::boolean, false)            as reorder,
      coalesce((_filters->>'dormant')::boolean, false)            as dormant,
      nullif(_filters->>'supplier_id', '')::uuid                  as supplier_id,
      nullif(_filters->>'rayon_code', '')                         as rayon_code,
      nullif(_filters->>'rayon_label', '')                        as rayon_label,
      case when jsonb_typeof(_filters->'article_ids') = 'array'
           then array(select jsonb_array_elements_text(_filters->'article_ids'))::uuid[] end as article_ids
  ),
  s as (
    select m.article_id,
           sum(case when not m.is_reservation then m.qty_delta else 0 end) as real_qty,
           sum(case when m.is_reservation then m.qty_delta else 0 end) as reserved_qty
      from public.stock_moves m, p
     -- Liste d'articles donnee : seulement leurs mouvements (index par article).
     where p.article_ids is null or m.article_id = any(p.article_ids)
     group by m.article_id
  ),
  base as (
    select a.id as article_id, a.reference, a.designation, a.mgmt_type::text as mgmt_type,
           a.category_path, a.bin_location, a.main_supplier_id as supplier_id,
           coalesce(s.real_qty, 0) as real_qty, coalesce(s.reserved_qty, 0) as reserved_qty,
           coalesce(s.real_qty, 0) - coalesce(s.reserved_qty, 0) as available_qty,
           a.pamp, round(coalesce(s.real_qty, 0) * a.pamp, 2) as stock_value, a.stock_min
      from (select s.article_id as id from s
            union
            select a1.id from public.articles a1, p
             where a1.company_id = _company and a1.stock_min > 0
               and (p.article_ids is null or a1.id = any(p.article_ids))) ids
      -- Lecture par cle (lateral) : evite de parcourir les ~94 000 articles de la societe.
      cross join lateral (select * from public.articles ax where ax.id = ids.id and ax.company_id = _company) a
      left join s on s.article_id = a.id
     where (select public.is_member(_company))
  ),
  f as (
    select b.* from base b, p
     where (not p.only_stocked or abs(b.real_qty) >= 0.0001)
       and (not p.below_min or (b.stock_min > 0 and b.available_qty < b.stock_min))
       and (p.supplier_id is null or b.supplier_id = p.supplier_id)
       and (p.rayon_code is null or (b.category_path is not null and (
             left(lower(b.category_path), length(p.rayon_code) + 1) = lower(p.rayon_code) || '-'
             or (p.rayon_label is not null and position(lower(p.rayon_label) in lower(b.category_path)) > 0))))
       and (not p.dormant or b.available_qty > 0)
       and (p.q is null or position(lower(p.q) in lower(coalesce(b.reference, '') || ' ' || coalesce(b.designation, '') || ' ' || coalesce(b.bin_location, ''))) > 0)
       and (not p.reorder or (b.stock_min > 0 and b.available_qty < b.stock_min) or b.available_qty < 0)
       and (p.article_ids is null or b.article_id = any(p.article_ids))
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'value', coalesce((select sum(stock_value) from f), 0),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.reference, x.article_id)
        from (select * from f order by f.reference, f.article_id
              limit greatest(coalesce(_limit, 100), 0) offset greatest(coalesce(_offset, 0), 0)) x), '[]'::jsonb));
$$;

-- Articles a stock mini (perimetre « actif » sans relire les 94 000 articles).
create index if not exists idx_articles_company_stock_min on public.articles (company_id) where stock_min > 0;

revoke all on function public.stock_screen_page(uuid, jsonb, integer, integer) from public, anon;
grant execute on function public.stock_screen_page(uuid, jsonb, integer, integer) to authenticated, service_role;

comment on function public.stock_screen_page(uuid, jsonb, integer, integer) is
  'Ecran Stock / Depreciations : une page (tri reference), nombre total et valeur totale du stock filtre, calcules en base (perf 2, 20/11/2026).';
