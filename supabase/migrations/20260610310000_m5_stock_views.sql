-- =====================================================================
-- M5 — Vues stock : agrégation du triple stock (réel / réservé / disponible) +
-- valeur (réel × PAMP) pour tous les articles d'une société. Lecture seule
-- (somme de stock_moves, B4/B7). Sert à l'écran Stock et aux éditions d'inventaire.
-- =====================================================================

create or replace function public.article_stock_list(_company uuid)
returns table(
  article_id uuid, reference text, designation text, mgmt_type text,
  category_path text, bin_location text, supplier_id uuid,
  real_qty numeric, reserved_qty numeric, available_qty numeric,
  pamp numeric, stock_value numeric, stock_min numeric
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    a.id, a.reference, a.designation, a.mgmt_type::text,
    a.category_path, a.bin_location, a.main_supplier_id,
    coalesce(s.real_qty, 0), coalesce(s.reserved_qty, 0),
    coalesce(s.real_qty, 0) - coalesce(s.reserved_qty, 0),
    a.pamp, round(coalesce(s.real_qty, 0) * a.pamp, 2), a.stock_min
  from public.articles a
  left join lateral (
    select
      sum(case when not m.is_reservation then m.qty_delta else 0 end) as real_qty,
      sum(case when m.is_reservation then m.qty_delta else 0 end) as reserved_qty
    from public.stock_moves m where m.article_id = a.id
  ) s on true
  where a.company_id = _company and public.is_member(_company)
  order by a.reference;
$$;
grant execute on function public.article_stock_list(uuid) to authenticated;

-- Historique des mouvements d'un article (déjà append-only ; simple lecture ordonnée).
create or replace function public.article_stock_history(_article uuid)
returns setof public.stock_moves
language sql stable security definer set search_path = public, pg_temp as $$
  select m.* from public.stock_moves m
  join public.articles a on a.id = m.article_id
  where m.article_id = _article and public.is_member(a.company_id)
  order by m.occurred_at desc;
$$;
grant execute on function public.article_stock_history(uuid) to authenticated;
