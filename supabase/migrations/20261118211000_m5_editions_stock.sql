-- =====================================================================
-- M5 — Rattrapage G8 (18/11/2026) : ÉDITION DU STOCK MULTI-CRITÈRES.
-- Les 8 onglets G8 (Stock réel · Stock arrêté · Copie de stock · Stock non
-- réajusté · Écart de stock · Stock à une date · Dépréciation de stock · Liste
-- des invendus) + Articles en rupture, en UNE fonction de lecture filtrée et
-- paginée en base (PostgREST coupe à 1 000 lignes : boucler par pages).
-- Lecture seule : aucun mouvement, aucune écriture (B4 / B7).
-- Dépend de 20261118210000_m5_inventaire_guide.sql (_snapshot_effective,
-- _is_stocked_type). Idempotente. NON APPLIQUÉE.
--
-- _view : reel | arrete | copie | non_reajuste | ecart | date | depreciation | invendus | rupture
-- _f (jsonb, tout facultatif) :
--   category     début du code famille « RR », « RR-SS », « RR-SS-CC » (rayon › sous-rayon › catégorie)
--   supplier_id  fournisseur principal ; brand : marque (exacte, sans casse)
--   bin          début du code casier (localisation 1 ou 2) ; search : référence / désignation / réf. fournisseur
--   types        tableau des types de gestion (défaut A, V, O, P, D)
--   zero / neg / demo / depot : 'inclus' | 'exclus' | 'uniquement'
--                (défaut : stocks nuls exclus, le reste inclus)
--   from / to    période « inclure les achats et ventes du … au … » (colonnes qty_in / qty_out)
--   snapshot_id  arrêté ou copie consulté (vues arrete, copie, non_reajuste, ecart)
--   at           date-heure du « stock à une date » (vue date)
--   since        date de référence des invendus (défaut : il y a 12 mois)
-- Valeurs : quantité × PAMP. Vue date : PAMP de la dernière photo (copie ou arrêté)
-- prise avant la date, sinon PAMP actuel (l'historique du PAMP n'est pas conservé ailleurs).
-- =====================================================================

create or replace function public.stock_edition(_company uuid, _view text, _f jsonb default '{}'::jsonb,
                                                _limit int default 1000, _offset int default 0)
returns table(
  article_id uuid, reference text, designation text, mgmt_type text, category_path text, brand text,
  supplier_id uuid, supplier_name text, supplier_ref text, bin_location text, bin_location2 text,
  barcode text, serial_no text,
  real_qty numeric, reserved_qty numeric, on_order_qty numeric, available_qty numeric, stock_min numeric,
  pamp numeric, stock_value numeric,
  ref_qty numeric, ref_pamp numeric, ref_value numeric, gap_qty numeric, gap_value numeric,
  depreciated_value numeric, last_in timestamptz, last_out timestamptz, last_sale timestamptz,
  qty_in numeric, qty_out numeric, is_demo boolean, is_depot boolean, counted boolean,
  total_count bigint, total_value numeric
)
language sql stable security definer set search_path = public, pg_temp as $$
  with p as (
    select coalesce(_view, 'reel') as v,
           nullif(btrim(coalesce(_f->>'category', '')), '') as cat,
           nullif(_f->>'supplier_id', '')::uuid as sup,
           nullif(btrim(coalesce(_f->>'brand', '')), '') as brand,
           nullif(btrim(coalesce(_f->>'bin', '')), '') as bin,
           nullif(btrim(coalesce(_f->>'search', '')), '') as s,
           coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(_f->'types') = 'array' then _f->'types' else '[]'::jsonb end) x),
                    array['A', 'V', 'O', 'P', 'D']) as types,
           coalesce(nullif(_f->>'zero', ''), 'exclus') as zero,
           coalesce(nullif(_f->>'neg', ''), 'inclus') as neg,
           coalesce(nullif(_f->>'demo', ''), 'inclus') as demo,
           coalesce(nullif(_f->>'depot', ''), 'inclus') as depot,
           nullif(_f->>'from', '')::date as dfrom,
           nullif(_f->>'to', '')::date as dto,
           nullif(_f->>'snapshot_id', '')::uuid as snap,
           coalesce(nullif(_f->>'at', '')::timestamptz, now()) as at,
           coalesce(nullif(_f->>'since', '')::date, (now() - interval '12 months')::date) as since
  ),
  mv as (
    select m.article_id,
           coalesce(sum(m.qty_delta) filter (where not m.is_reservation), 0) as real_q,
           coalesce(sum(m.qty_delta) filter (where m.is_reservation), 0) as res_q,
           coalesce(sum(m.qty_delta) filter (where not m.is_reservation and m.occurred_at <= p.at), 0) as at_q,
           max(m.occurred_at) filter (where not m.is_reservation and m.qty_delta > 0) as last_in,
           max(m.occurred_at) filter (where not m.is_reservation and m.qty_delta < 0) as last_out,
           max(m.occurred_at) filter (where not m.is_reservation and m.move_type = 'sortie') as last_sale,
           coalesce(sum(m.qty_delta) filter (where not m.is_reservation and m.qty_delta > 0
                     and m.move_type in ('entree', 'correction') and p.dfrom is not null
                     and (m.occurred_at at time zone 'Europe/Brussels')::date between p.dfrom and coalesce(p.dto, p.dfrom)), 0) as q_in,
           coalesce(-sum(m.qty_delta) filter (where not m.is_reservation and m.qty_delta < 0
                     and m.move_type = 'sortie' and p.dfrom is not null
                     and (m.occurred_at at time zone 'Europe/Brussels')::date between p.dfrom and coalesce(p.dto, p.dfrom)), 0) as q_out
      from public.stock_moves m cross join p
     where m.company_id = _company
     group by m.article_id
  ),
  snap_eff as (
    select e.* from p cross join lateral public._snapshot_effective(p.snap) e
     where p.v in ('arrete', 'non_reajuste', 'ecart') and p.snap is not null
  ),
  snap_copy as (
    select l.article_id, sum(l.qty) as qty, max(l.pamp) as pamp
      from p join public.stock_snapshot_lines l on l.snapshot_id = p.snap
     where p.v = 'copie'
     group by l.article_id
  ),
  -- Photo la plus récente prise avant la date demandée (PAMP de la vue « date »).
  date_snap as (
    select s.id from p join public.stock_snapshots s on s.company_id = _company and s.created_at <= p.at and s.status = 'actif'
     where p.v = 'date'
     order by s.created_at desc limit 1
  ),
  date_pamp as (
    select l.article_id, max(l.pamp) as pamp from public.stock_snapshot_lines l join date_snap d on d.id = l.snapshot_id group by l.article_id
  ),
  veh as (
    select coalesce(ve.article_id, a2.id) as article_id,
           bool_or(ve.status::text = 'demo') as demo,
           bool_or(ve.status::text in ('depot_vente', 'depot_agent')) as depot,
           max(ve.vin) as vin
      from public.vehicles ve
      left join public.articles a2 on a2.vehicle_id = ve.id
     where ve.company_id = _company
     group by coalesce(ve.article_id, a2.id)
  ),
  dep as (
    select d.article_id, sum(d.depreciated_value) as v from public.stock_depreciations d
     where d.company_id = _company and d.is_active group by d.article_id
  ),
  sess as (
    select s.magasin_ouvert from p join public.stock_snapshots sn on sn.id = p.snap
      join public.inventory_sessions s on s.id = sn.session_id
  ),
  ecm as (
    select case when exists (select 1 from sess where not magasin_ouvert) then 'reel'
                when exists (select 1 from sess) then 'arrete'
                when exists (select 1 from p join public.stock_snapshot_adjustments ad on ad.snapshot_id = p.snap
                              where ad.mode in ('annule_remplace', 'cumul', 'casier')) then 'arrete'
                else 'reel' end as m
  ),
  base as (
    select a.id, a.reference, a.designation, a.mgmt_type::text as mt, a.category_path, a.brand, a.main_supplier_id,
           a.supplier_ref, a.bin_location, a.bin_location2, a.stock_min, a.pamp as cur_pamp,
           coalesce(mv.real_q, 0) as real_q, coalesce(mv.res_q, 0) as res_q,
           mv.last_in, mv.last_out, mv.last_sale, coalesce(mv.q_in, 0) as q_in, coalesce(mv.q_out, 0) as q_out,
           coalesce(veh.demo, false) as demo, (a.mgmt_type::text = 'D' or coalesce(veh.depot, false)) as depot, veh.vin,
           coalesce(dep.v, 0) as dep_v,
           -- quantité / PAMP de référence selon l'onglet
           case p.v
             when 'arrete'       then coalesce(se.adjusted_qty, 0)
             when 'non_reajuste' then coalesce(se.adjusted_qty, 0)
             when 'ecart'        then coalesce(se.initial_qty, 0)
             when 'copie'        then coalesce(sc.qty, 0)
             when 'date'         then coalesce(mv.at_q, 0)
             else coalesce(mv.real_q, 0)
           end as ref_q,
           case p.v
             when 'arrete' then coalesce(se.pamp, a.pamp) when 'non_reajuste' then coalesce(se.pamp, a.pamp)
             when 'ecart' then coalesce(se.pamp, a.pamp) when 'copie' then coalesce(sc.pamp, a.pamp)
             when 'date' then coalesce(dp.pamp, a.pamp) else a.pamp
           end as ref_p,
           -- quantité comptée (écart) : arrêté réajusté (magasin ouvert, ou arrêté réajusté hors
           -- méthode) ; stock réel (magasin fermé : le comptage a réajusté le réel)
           case when p.v = 'ecart' then
             case when (select m from ecm) = 'arrete' then coalesce(se.adjusted_qty, 0) else coalesce(mv.real_q, 0) end
           end as cnt_q,
           coalesce(se.counted, false) as counted,
           (mv.article_id is not null) as has_moves,
           (se.article_id is not null or sc.article_id is not null) as in_snap
      from public.articles a
      cross join p
      left join mv on mv.article_id = a.id
      left join snap_eff se on se.article_id = a.id
      left join snap_copy sc on sc.article_id = a.id
      left join date_pamp dp on dp.article_id = a.id
      left join veh on veh.article_id = a.id
      left join dep on dep.article_id = a.id
     where a.company_id = _company and public.is_member(_company)
       and a.mgmt_type::text = any(p.types)
       and (p.cat is null or a.category_path ilike p.cat || '%')
       and (p.sup is null or a.main_supplier_id = p.sup)
       and (p.brand is null or lower(a.brand) = lower(p.brand))
       and (p.bin is null or a.bin_location ilike p.bin || '%' or a.bin_location2 ilike p.bin || '%')
       and (p.s is null or a.reference ilike '%' || p.s || '%' or a.designation ilike '%' || p.s || '%'
            or a.supplier_ref ilike '%' || p.s || '%')
       -- périmètre de l'onglet
       and case p.v
             when 'arrete' then p.snap is not null and (se.article_id is not null or p.zero <> 'exclus')
             when 'non_reajuste' then p.snap is not null and se.article_id is not null and not coalesce(se.counted, false)
             when 'ecart' then p.snap is not null and (se.article_id is not null or mv.article_id is not null)
             when 'copie' then p.snap is not null and (sc.article_id is not null or p.zero <> 'exclus')
             when 'rupture' then (mv.article_id is not null or coalesce(a.stock_min, 0) > 0)
             else mv.article_id is not null or p.zero <> 'exclus'
           end
  ),
  f as (
    select b.*,
           case when (select v from p) = 'ecart' then b.cnt_q - b.ref_q else null end as gap
      from base b cross join p
     where case p.zero when 'exclus' then b.ref_q <> 0 or p.v in ('ecart', 'rupture') when 'uniquement' then b.ref_q = 0 else true end
       and case p.neg when 'exclus' then b.ref_q >= 0 when 'uniquement' then b.ref_q < 0 else true end
       and case p.demo when 'exclus' then not b.demo when 'uniquement' then b.demo else true end
       and case p.depot when 'exclus' then not b.depot when 'uniquement' then b.depot else true end
       and case p.v
             when 'ecart' then b.cnt_q <> b.ref_q
             when 'invendus' then b.real_q > 0 and (b.last_sale is null or (b.last_sale at time zone 'Europe/Brussels')::date < p.since)
             when 'rupture' then b.real_q - b.res_q <= 0
             when 'depreciation' then b.real_q <> 0
             else true
           end
  ),
  pg as (
    select f.*, count(*) over () as n,
           sum(round(case when (select v from p) = 'ecart' then f.gap else f.ref_q end * f.ref_p, 2)) over () as tv
      from f
     order by f.reference
     limit least(greatest(coalesce(_limit, 1000), 1), 1000)
    offset greatest(coalesce(_offset, 0), 0)
  )
  select pg.id, pg.reference, pg.designation, pg.mt, pg.category_path, pg.brand,
         pg.main_supplier_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
         pg.supplier_ref, pg.bin_location, pg.bin_location2,
         (select bc.barcode from public.article_barcodes bc where bc.article_id = pg.id order by bc.is_primary desc, bc.created_at limit 1),
         pg.vin,
         pg.real_q, pg.res_q, oo.q, pg.real_q - pg.res_q, pg.stock_min,
         pg.cur_pamp, round(pg.real_q * pg.cur_pamp, 2),
         pg.ref_q, pg.ref_p, round(pg.ref_q * pg.ref_p, 2),
         pg.gap, case when pg.gap is not null then round(pg.gap * pg.ref_p, 2) end,
         pg.dep_v, pg.last_in, pg.last_out, pg.last_sale, pg.q_in, pg.q_out, pg.demo, pg.depot, pg.counted,
         pg.n, pg.tv
    from pg
    left join public.contacts c on c.id = pg.main_supplier_id
    cross join lateral (select coalesce(public._article_on_order_qty(pg.id), 0) as q) oo
   order by pg.reference;
$$;
revoke all on function public.stock_edition(uuid, text, jsonb, int, int) from public, anon;
grant execute on function public.stock_edition(uuid, text, jsonb, int, int) to authenticated;

comment on function public.stock_edition(uuid, text, jsonb, int, int) is
  'M5 — Édition du stock multi-critères (8 onglets G8 + rupture). Lecture seule, filtrée et paginée en base '
  '(pages de 1000 : plafond PostgREST). total_count / total_value = totaux de TOUTE la sélection.';

-- Valeur des marques présentes (liste déroulante du filtre Marque).
create or replace function public.stock_brands(_company uuid)
returns table(brand text, n bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.brand, count(*) from public.articles a
   where a.company_id = _company and public.is_member(_company) and nullif(btrim(coalesce(a.brand, '')), '') is not null
     and public._is_stocked_type(a.mgmt_type::text)
   group by a.brand order by a.brand;
$$;
grant execute on function public.stock_brands(uuid) to authenticated;
