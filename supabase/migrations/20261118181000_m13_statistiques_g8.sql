-- =====================================================================
-- M13 — Module statistiques facon G8 (rattrapage G8, 18/11/2026).
-- Source G8 : docs/g8-inventaire 08-compta-stats.md (Statistiques, 9 onglets, Indicateurs),
-- 06-ventes-caisse.md (Stats quotidiennes), 02-articles.md (Statistiques article).
-- Comparaison : comparaison-ventes-caisse-compta.md §6 et bloquant n° 19.
--
-- S'appuie sur le socle de 20261118180000_m13_chiffres_justes.sql (`stats_fact`, `_stats_facts`,
-- `_stats_keep`, `_stats_dim`, `_stats_can_read`) : memes regles partout (avoirs deduits, brouillons
-- exclus, tickets comptes, cout fige).
--
-- Fonctions (toutes renvoient du JSON : une seule valeur, donc jamais tronquee a 1 000 lignes par
-- l API ; acces = membre avec un role qui voit la page Rapports, sauf la fiche article = tout membre) :
--   stats_query(societe, source, du, au, filtres, niveaux, compare)
--       source = sales (ventes, meilleures ventes, remises, stats quotidiennes) | purchases (achats)
--       | cessions (cessions internes) ; jusqu'a 5 niveaux de classement (4 niveaux + article,
--       comme G8) parmi : supplier, brand, rayon, sousrayon, categorie, client, operator, article,
--       month, day, year, doctype, cession ; compare = exercice N-1 sur la meme periode.
--       Dernier niveau article : stock reel, disponible et en commande de l'article.
--   stats_monthly(societe, annee, filtres)     tableau de bord mois par mois (N et N-1)
--   stats_indicators(societe, du, au)          crees / en cours / transformes par type de document
--   stats_open_documents(societe)              documents en cours (devis, BC, reservations, BL, OR, commandes)
--   article_stats(article)                     statistiques d'un article par annee et par mois
--
-- Idempotente. NON APPLIQUEE. A appliquer APRES 20261118180000. Essai a blanc :
-- supabase/tests/m13_statistiques_g8.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Requete generique : classement multi-niveaux, filtres, exercices compares
-- ---------------------------------------------------------------------
create or replace function public.stats_query(
  _company uuid, _source text, _from date, _to date,
  _filters jsonb default '{}'::jsonb, _levels text[] default array['brand']::text[], _compare boolean default false
)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  _lv text[] := '{}'::text[];
  _x text;
  _n int;
  _last text;
  _rows jsonb;
  _f jsonb := coalesce(_filters, '{}'::jsonb);
begin
  if not public._stats_can_read(_company) then
    raise exception 'stats_forbidden' using errcode = '42501';
  end if;
  if _source is null or _source not in ('sales', 'purchases', 'cessions') then
    raise exception 'stats_bad_source: %', _source using errcode = '22023';
  end if;
  if _from is null or _to is null or _to < _from then
    raise exception 'stats_bad_period' using errcode = '22023';
  end if;
  foreach _x in array coalesce(_levels, '{}'::text[]) loop
    if _x in ('supplier', 'brand', 'rayon', 'sousrayon', 'categorie', 'client', 'operator', 'article',
              'month', 'day', 'year', 'doctype', 'cession')
       and not (_x = any(_lv)) and coalesce(array_length(_lv, 1), 0) < 5 then
      _lv := _lv || _x;
    end if;
  end loop;
  _n := coalesce(array_length(_lv, 1), 0);
  _last := case when _n > 0 then _lv[_n] end;

  with facts as (
    select f, false as prev
      from public._stats_facts(_company, _source, _from, _to) f
     where public._stats_keep(f, _f)
    union all
    select f, true
      from public._stats_facts(_company, _source, (_from - interval '1 year')::date, (_to - interval '1 year')::date) f
     where _compare and public._stats_keep(f, _f)
  ),
  keyed as (
    select d1.key as k1, d1.label as l1, d2.key as k2, d2.label as l2, d3.key as k3, d3.label as l3,
           d4.key as k4, d4.label as l4, d5.key as k5, d5.label as l5,
           x.prev, (x.f).document_id as document_id, (x.f).doc_type as doc_type,
           (x.f).qty as qty, (x.f).gross_ht as gross_ht, (x.f).ca_ht as ca_ht, (x.f).cost as cost
      from facts x
      cross join lateral public._stats_dim(_lv[1], x.f) d1
      cross join lateral public._stats_dim(_lv[2], x.f) d2
      cross join lateral public._stats_dim(_lv[3], x.f) d3
      cross join lateral public._stats_dim(_lv[4], x.f) d4
      cross join lateral public._stats_dim(_lv[5], x.f) d5
  ),
  grouped as (
    select k1, max(l1) as l1, k2, max(l2) as l2, k3, max(l3) as l3, k4, max(l4) as l4, k5, max(l5) as l5,
           coalesce(sum(qty) filter (where not prev), 0) as qty,
           coalesce(sum(gross_ht) filter (where not prev), 0) as gross_ht,
           coalesce(sum(ca_ht) filter (where not prev), 0) as ca_ht,
           coalesce(sum(cost) filter (where not prev), 0) as cost,
           count(distinct document_id) filter (where not prev and doc_type in ('FAC', 'TIK', 'REC', 'CES')) as docs,
           count(distinct document_id) filter (where not prev and doc_type = 'AVO') as credit_notes,
           coalesce(sum(qty) filter (where prev), 0) as qty_n1,
           coalesce(sum(ca_ht) filter (where prev), 0) as ca_ht_n1,
           coalesce(sum(cost) filter (where prev), 0) as cost_n1,
           bool_or(not prev) as in_n
      from keyed
     group by k1, k2, k3, k4, k5
  ),
  lastkey as (
    select g.*,
           case when _last = 'article'
                 and (array[g.k1, g.k2, g.k3, g.k4, g.k5])[greatest(_n, 1)] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then ((array[g.k1, g.k2, g.k3, g.k4, g.k5])[greatest(_n, 1)])::uuid end as kart
      from grouped g
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'keys',   to_jsonb((array[g.k1, g.k2, g.k3, g.k4, g.k5])[1:_n]),
           'labels', to_jsonb((array[g.l1, g.l2, g.l3, g.l4, g.l5])[1:_n]),
           'qty', round(g.qty, 3), 'gross_ht', round(g.gross_ht, 2), 'ca_ht', round(g.ca_ht, 2),
           'cost', round(g.cost, 2), 'docs', g.docs, 'credit_notes', g.credit_notes,
           'qty_n1', round(g.qty_n1, 3), 'ca_ht_n1', round(g.ca_ht_n1, 2), 'cost_n1', round(g.cost_n1, 2),
           'stock', st.real_qty, 'available', st.real_qty - coalesce(st.reserved_qty, 0), 'on_order', st.on_order
         ) order by g.ca_ht desc, g.cost desc), '[]'::jsonb)
    into _rows
    from lastkey g
    left join lateral (
      select coalesce(sum(m.qty_delta) filter (where not m.is_reservation), 0) as real_qty,
             coalesce(sum(m.qty_delta) filter (where m.is_reservation), 0) as reserved_qty,
             public._article_on_order_qty(g.kart) as on_order
        from public.stock_moves m
       where g.kart is not null and m.article_id = g.kart
    ) st on g.kart is not null;

  return jsonb_build_object('source', _source, 'from', _from, 'to', _to, 'compare', coalesce(_compare, false),
                            'levels', to_jsonb(_lv), 'rows', _rows);
end $$;
revoke all on function public.stats_query(uuid, text, date, date, jsonb, text[], boolean) from public, anon;
grant execute on function public.stats_query(uuid, text, date, date, jsonb, text[], boolean) to authenticated;
comment on function public.stats_query(uuid, text, date, date, jsonb, text[], boolean) is
  'M13 G8 : statistiques classees sur 5 niveaux au plus (ventes, achats, cessions), filtres de selection, exercice N-1.';

-- ---------------------------------------------------------------------
-- 2. Tableau de bord mois par mois (G8 : quantites entrees / sorties, quantites comparees,
--    chiffre d'affaires, montant achat ; janvier -> decembre + total + stock)
-- ---------------------------------------------------------------------
create or replace function public.stats_monthly(_company uuid, _year int, _filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  _f jsonb := coalesce(_filters, '{}'::jsonb) - 'cession_type';
  -- achats et mouvements : seuls les criteres d'article s'appliquent (pas de client, d'operateur, de type de document)
  _fa jsonb := coalesce(_filters, '{}'::jsonb) - 'contact_id' - 'operator' - 'doc_type' - 'kind' - 'cession_type';
  _from date;
  _to date;
  _months jsonb;
  _stock record;
begin
  if not public._stats_can_read(_company) then
    raise exception 'stats_forbidden' using errcode = '42501';
  end if;
  if _year is null or _year < 1990 or _year > 2200 then raise exception 'stats_bad_period' using errcode = '22023'; end if;
  _from := make_date(_year - 1, 1, 1);
  _to := make_date(_year, 12, 31);

  with s as (
    select extract(year from f.issue_date)::int as y, extract(month from f.issue_date)::int as m,
           sum(f.ca_ht) as ca, sum(f.cost) as cost,
           sum(f.qty) filter (where f.line_kind in ('article', 'labour', 'other')) as q,
           count(distinct f.document_id) filter (where f.doc_type in ('FAC', 'TIK')) as docs
      from public._stats_facts(_company, 'sales', _from, _to) f
     where public._stats_keep(f, _f)
     group by 1, 2
  ),
  p as (
    select extract(year from f.issue_date)::int as y, extract(month from f.issue_date)::int as m,
           sum(f.ca_ht) as amount, sum(f.qty) as q
      from public._stats_facts(_company, 'purchases', _from, _to) f
     where public._stats_keep(f, _fa)
     group by 1, 2
  ),
  mv as (
    select extract(year from f.issue_date)::int as y, extract(month from f.issue_date)::int as m,
           sum(f.qty) filter (where f.line_kind = 'entree' and f.qty > 0) as q_in,
           -sum(f.qty) filter (where f.line_kind in ('sortie', 'cession')) as q_out
      from public._stats_facts(_company, 'moves', _from, _to) f
     where public._stats_keep(f, _fa)
     group by 1, 2
  )
  select jsonb_agg(jsonb_build_object(
           'month', g.m,
           'ca_ht', round(coalesce(sn.ca, 0), 2), 'ca_ht_n1', round(coalesce(s1.ca, 0), 2),
           'cost', round(coalesce(sn.cost, 0), 2), 'cost_n1', round(coalesce(s1.cost, 0), 2),
           'qty_sold', round(coalesce(sn.q, 0), 3), 'qty_sold_n1', round(coalesce(s1.q, 0), 3),
           'docs', coalesce(sn.docs, 0), 'docs_n1', coalesce(s1.docs, 0),
           'purchases_ht', round(coalesce(pn.amount, 0), 2), 'purchases_ht_n1', round(coalesce(p1.amount, 0), 2),
           'qty_bought', round(coalesce(pn.q, 0), 3),
           'qty_in', round(coalesce(mn.q_in, 0), 3), 'qty_in_n1', round(coalesce(m1.q_in, 0), 3),
           'qty_out', round(coalesce(mn.q_out, 0), 3), 'qty_out_n1', round(coalesce(m1.q_out, 0), 3)
         ) order by g.m)
    into _months
    from generate_series(1, 12) as g(m)
    left join s sn on sn.y = _year and sn.m = g.m
    left join s s1 on s1.y = _year - 1 and s1.m = g.m
    left join p pn on pn.y = _year and pn.m = g.m
    left join p p1 on p1.y = _year - 1 and p1.m = g.m
    left join mv mn on mn.y = _year and mn.m = g.m
    left join mv m1 on m1.y = _year - 1 and m1.m = g.m;

  -- Stock d'aujourd'hui des articles de la selection (somme des mouvements, B4 ; valeur au PAMP).
  select coalesce(sum(t.q), 0) as qty, coalesce(round(sum(t.q * coalesce(a.pamp, 0)), 2), 0) as value
    into _stock
    from (select m.article_id, sum(m.qty_delta) as q
            from public.stock_moves m
           where m.company_id = _company and not m.is_reservation
           group by m.article_id) t
    join public.articles a on a.id = t.article_id
    left join lateral (
      select sp.id as supplier_id
        from public.contacts sp
       where coalesce(_fa->>'supplier_id', '') <> ''
         and sp.id = coalesce(a.main_supplier_id,
               (select x.supplier_id from public.article_suppliers x where x.article_id = a.id order by x.created_at limit 1))
    ) sup on true
   where t.q <> 0
     and public._stats_keep(row('moves', null, null, null, null, null, null, a.id, a.reference, a.designation, a.brand,
                                a.category_path, sup.supplier_id, null, a.mgmt_type::text, a.bin_location, 'stock',
                                null, null, t.q, 0, 0, 0)::public.stats_fact,
                            _fa);

  return jsonb_build_object('year', _year, 'months', coalesce(_months, '[]'::jsonb),
                            'stock_qty', _stock.qty, 'stock_value', _stock.value);
end $$;
revoke all on function public.stats_monthly(uuid, int, jsonb) from public, anon;
grant execute on function public.stats_monthly(uuid, int, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Indicateurs par type de document (G8 : crees — nombre, montant HT, panier moyen, articles par
--    document — ; en cours ; transformation vers facture, livraison, reservation...)
-- ---------------------------------------------------------------------
create or replace function public.stats_indicators(_company uuid, _from date, _to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _res jsonb;
begin
  if not public._stats_can_read(_company) then
    raise exception 'stats_forbidden' using errcode = '42501';
  end if;
  if _from is null or _to is null or _to < _from then raise exception 'stats_bad_period' using errcode = '22023'; end if;

  with docs as (
    select d.id, d.doc_type, d.status, d.total_ht, d.total_ttc, d.paid_amount,
           (select coalesce(sum(l.quantity), 0) from public.document_lines l
             where l.document_id = d.id and l.article_id is not null) as items
      from public.documents d
     where d.company_id = _company and d.issue_date between _from and _to
       and d.doc_type in ('FAC', 'TIK', 'AVO', 'FAA', 'DEV', 'BC', 'RES', 'BL')
       and d.status <> 'brouillon'
  ),
  tgt as (
    select s.doc_type as src, t.doc_type as tgt, count(distinct s.id) as n
      from docs s
      join public.documents t on t.source_document_id = s.id
     where s.status = 'converti' and t.doc_type not in ('AVO', 'FAA') and t.status <> 'annulee'
     group by 1, 2
  ),
  doc_ind as (
    select d.doc_type,
           count(*) as created,
           sum(d.total_ht) as created_ht,
           sum(d.items) as items,
           count(*) filter (where case
                when d.doc_type in ('DEV', 'BC', 'RES', 'BL') then d.status not in ('annulee', 'converti')
                when d.doc_type in ('FAC', 'TIK', 'FAA') then d.status not in ('annulee', 'avoir_emis') and d.total_ttc - d.paid_amount > 0.005
                else false end) as open_n,
           coalesce(sum(d.total_ht) filter (where case
                when d.doc_type in ('DEV', 'BC', 'RES', 'BL') then d.status not in ('annulee', 'converti')
                when d.doc_type in ('FAC', 'TIK', 'FAA') then d.status not in ('annulee', 'avoir_emis') and d.total_ttc - d.paid_amount > 0.005
                else false end), 0) as open_ht,
           count(*) filter (where d.status = 'converti') as transformed
      from docs d
     group by d.doc_type
  ),
  ors as (
    select o.id, o.status, o.total_ht,
           (select coalesce(sum(l.quantity), 0) from public.repair_order_lines l where l.or_id = o.id and l.article_id is not null) as items
      from public.repair_orders o
     where o.company_id = _company
       and (o.created_at at time zone 'Europe/Brussels')::date between _from and _to
  ),
  or_ind as (
    select 'OR'::text as doc_type, count(*) as created, coalesce(sum(total_ht), 0) as created_ht, coalesce(sum(items), 0) as items,
           count(*) filter (where status not in ('facture', 'annule')) as open_n,
           coalesce(sum(total_ht) filter (where status not in ('facture', 'annule')), 0) as open_ht,
           count(*) filter (where status = 'facture') as transformed
      from ors having count(*) > 0
  ),
  pur as (
    select po.id, po.doc_type, po.status, po.total_ht,
           (select coalesce(sum(pl.quantity), 0) from public.purchase_lines pl where pl.order_id = po.id and pl.article_id is not null) as items,
           exists (select 1 from public.purchase_orders r where r.source_order_id = po.id and r.doc_type = 'REC'
                     and r.status not in ('brouillon', 'annulee')) as received
      from public.purchase_orders po
     where po.company_id = _company and po.status <> 'brouillon' and po.doc_type in ('CMD', 'REC')
       and coalesce(case when po.doc_type = 'REC' then po.receipt_date else po.order_date end, po.created_at::date) between _from and _to
  ),
  pur_ind as (
    select doc_type, count(*) as created, coalesce(sum(total_ht), 0) as created_ht, coalesce(sum(items), 0) as items,
           count(*) filter (where doc_type = 'CMD' and status not in ('annulee', 'recue') and not received) as open_n,
           coalesce(sum(total_ht) filter (where doc_type = 'CMD' and status not in ('annulee', 'recue') and not received), 0) as open_ht,
           count(*) filter (where doc_type = 'CMD' and received) as transformed
      from pur group by doc_type
  ),
  ces_ind as (
    select 'CES'::text as doc_type, count(*) as created, 0::numeric as created_ht,
           coalesce(sum(-m.qty_delta), 0) as items, 0::bigint as open_n, 0::numeric as open_ht, 0::bigint as transformed,
           coalesce(sum(-m.qty_delta * coalesce(m.unit_cost, a.pamp, 0)), 0) as value
      from public.stock_moves m
      join public.articles a on a.id = m.article_id
     where m.company_id = _company and m.move_type = 'cession' and not m.is_reservation
       and m.occurred_at >= (_from::timestamp at time zone 'Europe/Brussels')
       and m.occurred_at <  ((_to + 1)::timestamp at time zone 'Europe/Brussels')
    having count(*) > 0
  ),
  allind as (
    select doc_type, created, created_ht, items, open_n, open_ht, transformed, null::numeric as value from doc_ind
    union all select doc_type, created, created_ht, items, open_n, open_ht, transformed, null from or_ind
    union all select doc_type, created, created_ht, items, open_n, open_ht, transformed, null from pur_ind
    union all select doc_type, created, created_ht, items, open_n, open_ht, transformed, value from ces_ind
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'doc_type', a.doc_type,
           'created', a.created,
           'created_ht', round(coalesce(a.created_ht, 0), 2),
           'avg_basket', case when a.created > 0 then round(coalesce(a.created_ht, 0) / a.created, 2) else 0 end,
           'items_per_doc', case when a.created > 0 then round(coalesce(a.items, 0) / a.created, 2) else 0 end,
           'open', a.open_n, 'open_ht', round(coalesce(a.open_ht, 0), 2),
           'transformed', a.transformed,
           'rate', case when a.created > 0 then round(100.0 * a.transformed / a.created, 1) else 0 end,
           'value', round(a.value, 2),
           'targets', coalesce((select jsonb_object_agg(t.tgt, t.n) from tgt t where t.src = a.doc_type),
                               case when a.doc_type = 'OR' and a.transformed > 0 then jsonb_build_object('FAC', a.transformed)
                                    when a.doc_type = 'CMD' and a.transformed > 0 then jsonb_build_object('REC', a.transformed)
                                    else '{}'::jsonb end)
         ) order by array_position(array['DEV', 'BC', 'RES', 'BL', 'FAC', 'TIK', 'AVO', 'FAA', 'OR', 'CMD', 'REC', 'CES'], a.doc_type)),
         '[]'::jsonb)
    into _res
    from allind a;
  return _res;
end $$;
revoke all on function public.stats_indicators(uuid, date, date) from public, anon;
grant execute on function public.stats_indicators(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Documents en cours (G8 : par type, quantite, CA HT, marge)
-- ---------------------------------------------------------------------
create or replace function public.stats_open_documents(_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _res jsonb;
begin
  if not public._stats_can_read(_company) then
    raise exception 'stats_forbidden' using errcode = '42501';
  end if;

  with d as (
    select d.doc_type, d.id, d.total_ht,
           coalesce(c.items, 0) as items, coalesce(c.cost, 0) as cost
      from public.documents d
      left join lateral (
        select sum(l.quantity) filter (where l.article_id is not null) as items,
               sum(case when l.article_id is null or a.mgmt_type = 'F' then 0
                        else coalesce(l.unit_cost, a.pamp, 0) * l.quantity end) as cost
          from public.document_lines l left join public.articles a on a.id = l.article_id
         where l.document_id = d.id
      ) c on true
     where d.company_id = _company and d.doc_type in ('DEV', 'BC', 'RES', 'BL')
       and d.status not in ('brouillon', 'annulee', 'converti')
  ),
  o as (
    select 'OR'::text as doc_type, o.id, o.total_ht, coalesce(c.items, 0) as items, coalesce(c.cost, 0) as cost
      from public.repair_orders o
      left join lateral (
        select sum(l.quantity) filter (where l.article_id is not null) as items,
               sum(case when l.article_id is null then 0 else coalesce(a.pamp, 0) * l.quantity end) as cost
          from public.repair_order_lines l left join public.articles a on a.id = l.article_id
         where l.or_id = o.id
      ) c on true
     where o.company_id = _company and o.status not in ('facture', 'annule')
  ),
  p as (
    select 'CMD'::text as doc_type, po.id, po.total_ht,
           (select coalesce(sum(pl.quantity), 0) from public.purchase_lines pl where pl.order_id = po.id and pl.article_id is not null) as items,
           po.total_ht as cost
      from public.purchase_orders po
     where po.company_id = _company and po.doc_type = 'CMD' and po.status not in ('brouillon', 'annulee', 'recue')
       and not exists (select 1 from public.purchase_orders r where r.source_order_id = po.id and r.doc_type = 'REC'
                         and r.status not in ('brouillon', 'annulee'))
  ),
  allx as (
    select doc_type, id, total_ht, items, cost from d
    union all select doc_type, id, total_ht, items, cost from o
    union all select doc_type, id, total_ht, items, cost from p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'doc_type', x.doc_type, 'count', x.n, 'items', round(x.items, 3),
           'ca_ht', round(x.ht, 2),
           'margin', case when x.doc_type = 'CMD' then null else round(x.ht - x.cost, 2) end
         ) order by array_position(array['DEV', 'BC', 'RES', 'BL', 'OR', 'CMD'], x.doc_type)), '[]'::jsonb)
    into _res
    from (select doc_type, count(*) as n, sum(items) as items, sum(total_ht) as ht, sum(cost) as cost
            from allx group by doc_type) x;
  return _res;
end $$;
revoke all on function public.stats_open_documents(uuid) from public, anon;
grant execute on function public.stats_open_documents(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Statistiques d'un article (G8 fiche article : cumulees, annuelles, N-1, N-2 ; par mois :
--    quantite, CA HT, marge HT, quantites achetees ; « exclure cession »)
-- ---------------------------------------------------------------------
create or replace function public.article_stats(_article uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _company uuid; _pamp numeric; _res jsonb;
begin
  select a.company_id, a.pamp into _company, _pamp from public.articles a where a.id = _article;
  if _company is null or not public.is_member(_company) then
    raise exception 'stats_forbidden' using errcode = '42501';
  end if;

  with s as (
    select extract(year from d.issue_date)::int as y, extract(month from d.issue_date)::int as m,
           sum(l.quantity) as q,
           sum(l.line_ht * case when coalesce(t.lh, 0) <> 0 then (d.total_ht - coalesce(d.shipping_ht, 0)) / t.lh else 1 end) as ca,
           sum(coalesce(l.unit_cost, _pamp, 0) * l.quantity) as cost
      from public.document_lines l
      join public.documents d on d.id = l.document_id
      left join lateral (select sum(x.line_ht) as lh from public.document_lines x where x.document_id = d.id) t on true
     where l.article_id = _article and d.company_id = _company
       and public._stats_is_sale(d.id, d.doc_type, d.status)
     group by 1, 2
  ),
  p as (
    select extract(year from coalesce(po.receipt_date, po.created_at::date))::int as y,
           extract(month from coalesce(po.receipt_date, po.created_at::date))::int as m,
           sum(pl.quantity) as q, sum(pl.line_ht * (1 - coalesce(po.global_discount_pct, 0) / 100)) as amount
      from public.purchase_lines pl
      join public.purchase_orders po on po.id = pl.order_id
     where pl.article_id = _article and po.company_id = _company and po.doc_type = 'REC'
       and po.status not in ('brouillon', 'annulee')
     group by 1, 2
  ),
  c as (
    select extract(year from (m.occurred_at at time zone 'Europe/Brussels'))::int as y,
           extract(month from (m.occurred_at at time zone 'Europe/Brussels'))::int as m,
           sum(-m.qty_delta) as q, sum(-m.qty_delta * coalesce(m.unit_cost, _pamp, 0)) as value
      from public.stock_moves m
     where m.article_id = _article and m.company_id = _company and m.move_type = 'cession' and not m.is_reservation
     group by 1, 2
  ),
  k as (select y, m from s union select y, m from p union select y, m from c)
  select coalesce(jsonb_agg(jsonb_build_object(
           'year', k.y, 'month', k.m,
           'qty_sold', round(coalesce(s.q, 0), 3), 'ca_ht', round(coalesce(s.ca, 0), 2), 'cost', round(coalesce(s.cost, 0), 2),
           'qty_bought', round(coalesce(p.q, 0), 3), 'amount_bought', round(coalesce(p.amount, 0), 2),
           'qty_ceded', round(coalesce(c.q, 0), 3), 'value_ceded', round(coalesce(c.value, 0), 2)
         ) order by k.y, k.m), '[]'::jsonb)
    into _res
    from k
    left join s on s.y = k.y and s.m = k.m
    left join p on p.y = k.y and p.m = k.m
    left join c on c.y = k.y and c.m = k.m;
  return _res;
end $$;
revoke all on function public.article_stats(uuid) from public, anon;
grant execute on function public.article_stats(uuid) to authenticated;
