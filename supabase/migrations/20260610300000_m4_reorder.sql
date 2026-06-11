-- =====================================================================
-- M4 — Proposition de commande (réapprovisionnement) : articles dont le stock
-- disponible est sous le stock mini. Quantité suggérée = stock max (ou mini) − dispo.
-- G8 Réception « Proposition commande » [R1]. Lecture seule (RLS via security definer).
-- =====================================================================

create or replace function public.reorder_proposals(_company uuid)
returns table(
  article_id uuid, reference text, designation text, supplier_id uuid,
  real_qty numeric, available_qty numeric, stock_min numeric, stock_max numeric,
  pack_qty numeric, suggested_qty numeric
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    a.id, a.reference, a.designation, a.main_supplier_id,
    coalesce(s.real_qty, 0), coalesce(s.avail, 0), a.stock_min, a.stock_max,
    a.pack_qty,
    greatest(coalesce(nullif(a.stock_max, 0), a.stock_min) - coalesce(s.avail, 0), 0) as suggested_qty
  from public.articles a
  left join lateral (
    select
      sum(case when not m.is_reservation then m.qty_delta else 0 end) as real_qty,
      sum(case when not m.is_reservation then m.qty_delta else 0 end)
        - sum(case when m.is_reservation then m.qty_delta else 0 end) as avail
    from public.stock_moves m where m.article_id = a.id
  ) s on true
  where a.company_id = _company
    and public.is_member(_company)
    and a.stock_min > 0
    and coalesce(s.avail, 0) < a.stock_min
  order by a.reference;
$$;
grant execute on function public.reorder_proposals(uuid) to authenticated;
