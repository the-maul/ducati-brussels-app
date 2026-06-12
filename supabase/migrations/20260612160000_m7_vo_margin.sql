-- =====================================================================
-- M7/M12 — TVA SUR MARGE (B2, art. 58 §4 CTVA) + registre VO.
-- Occasions rachetées à des PARTICULIERS (type O) : à la revente, la TVA porte
-- UNIQUEMENT sur la marge (PV − PA), pas sur le prix total. Registre de comparaison
-- chronologique obligatoire + base de l'attestation TVA marge (TRAXIO).
--   marge       = max(PV TTC − PA, 0)
--   TVA marge   = round(marge × 21 / 121, 2)   (TVA incluse dans la marge)
--   base imposable = marge − TVA marge
-- Type P (occasion pro) = TVA 21 % standard (hors registre marge).
-- =====================================================================

-- Registre VO : une ligne par occasion type O vendue sur la période (chronologique).
create or replace function public.vo_margin_register(_company uuid, _from date, _to date)
returns table(
  sale_date date, doc_number text, document_id uuid, vehicle_id uuid, vin text,
  designation text, purchase_price numeric, sale_ttc numeric,
  margin numeric, vat_margin numeric, base_ht numeric
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    d.issue_date, d.number, d.id, v.id, v.vin,
    l.designation,
    coalesce(a.purchase_price, 0) as purchase_price,
    abs(l.line_ttc) as sale_ttc,
    greatest(abs(l.line_ttc) - coalesce(a.purchase_price, 0), 0) as margin,
    round(greatest(abs(l.line_ttc) - coalesce(a.purchase_price, 0), 0) * 21 / 121.0, 2) as vat_margin,
    round(greatest(abs(l.line_ttc) - coalesce(a.purchase_price, 0), 0) / 1.21, 2) as base_ht
  from public.document_lines l
  join public.documents d on d.id = l.document_id
  join public.articles a on a.id = l.article_id and a.mgmt_type = 'O'
  left join public.vehicles v on v.article_id = a.id
  where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and d.doc_type in ('FAC', 'TIK') and d.status <> 'annulee'
    and d.issue_date between _from and _to
  order by d.issue_date, d.number;
$$;
grant execute on function public.vo_margin_register(uuid, date, date) to authenticated;

-- Résumé pour la déclaration TVA : total marge, TVA marge, base imposable sur la période.
create or replace function public.vo_margin_summary(_company uuid, _from date, _to date)
returns table(count_vo bigint, total_sale numeric, total_margin numeric, total_vat_margin numeric, total_base numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::bigint,
         coalesce(sum(sale_ttc), 0), coalesce(sum(margin), 0),
         coalesce(sum(vat_margin), 0), coalesce(sum(base_ht), 0)
  from public.vo_margin_register(_company, _from, _to);
$$;
grant execute on function public.vo_margin_summary(uuid, date, date) to authenticated;
