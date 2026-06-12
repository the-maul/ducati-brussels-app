-- =====================================================================
-- M13 — Statistiques avancées (parité G8 §3.8) : classement par dimension avec
-- CA + MARGE (sur PAMP, B5), comparaison N-1, indicateurs (panier moyen, marge %),
-- taux de transformation (devis/réservation/BL → facture). Lecture seule.
-- =====================================================================

-- Ventes classées par dimension (brand|category|article|client|month) avec marge.
create or replace function public.report_sales_by(_company uuid, _from date, _to date, _dim text)
returns table(label text, qty numeric, ca_ht numeric, margin numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    case _dim
      when 'brand'    then coalesce(a.brand, '(sans marque)')
      when 'category' then coalesce(a.category_path, '(sans rayon)')
      when 'article'  then coalesce(a.reference || ' ' || a.designation, l.designation)
      when 'client'   then coalesce(c.company_name, nullif(trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')),''), 'Comptoir')
      when 'month'    then to_char(d.issue_date, 'YYYY-MM')
      else 'Total' end as label,
    round(sum(abs(l.quantity)), 2) as qty,
    round(sum(l.line_ht), 2) as ca_ht,
    round(sum(l.line_ht - coalesce(a.pamp, 0) * abs(l.quantity)), 2) as margin
  from public.document_lines l
  join public.documents d on d.id = l.document_id
  left join public.articles a on a.id = l.article_id
  left join public.contacts c on c.id = d.contact_id
  where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and d.doc_type in ('FAC','TIK') and d.status <> 'annulee'
    and d.issue_date between _from and _to
  group by 1
  order by ca_ht desc;
$$;
grant execute on function public.report_sales_by(uuid, date, date, text) to authenticated;

-- Comparaison N / N-1 (même période, année précédente) : CA + marge.
create or replace function public.report_period_compare(_company uuid, _from date, _to date)
returns table(period text, ca_ht numeric, margin numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with base as (
    select d.issue_date, l.line_ht, l.quantity, a.pamp
    from public.document_lines l
    join public.documents d on d.id = l.document_id
    left join public.articles a on a.id = l.article_id
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.doc_type in ('FAC','TIK') and d.status <> 'annulee'
  )
  select 'N', round(coalesce(sum(line_ht),0),2), round(coalesce(sum(line_ht - coalesce(pamp,0)*abs(quantity)),0),2)
    from base where issue_date between _from and _to
  union all
  select 'N-1', round(coalesce(sum(line_ht),0),2), round(coalesce(sum(line_ht - coalesce(pamp,0)*abs(quantity)),0),2)
    from base where issue_date between (_from - interval '1 year')::date and (_to - interval '1 year')::date;
$$;
grant execute on function public.report_period_compare(uuid, date, date) to authenticated;

-- Indicateurs : nb factures, CA HT, panier moyen TTC, marge, marge %.
create or replace function public.report_indicators(_company uuid, _from date, _to date)
returns table(invoices bigint, ca_ht numeric, avg_basket numeric, margin numeric, margin_pct numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with inv as (
    select d.id, d.total_ht, d.total_ttc,
      (select coalesce(sum(l.line_ht - coalesce(a.pamp,0)*abs(l.quantity)),0)
       from public.document_lines l left join public.articles a on a.id=l.article_id where l.document_id=d.id) as marg
    from public.documents d
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.doc_type in ('FAC','TIK') and d.status <> 'annulee'
      and d.issue_date between _from and _to
  )
  select count(*)::bigint,
         round(coalesce(sum(total_ht),0),2),
         round(coalesce(avg(total_ttc),0),2),
         round(coalesce(sum(marg),0),2),
         case when coalesce(sum(total_ht),0) > 0 then round(100*sum(marg)/sum(total_ht),1) else 0 end
  from inv;
$$;
grant execute on function public.report_indicators(uuid, date, date) to authenticated;

-- Taux de transformation : documents créés vs transformés (converti) par type.
create or replace function public.report_transformation(_company uuid, _from date, _to date)
returns table(doc_type text, created bigint, converted bigint, rate numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.doc_type, count(*)::bigint,
         count(*) filter (where d.status = 'converti')::bigint,
         case when count(*) > 0 then round(100.0 * count(*) filter (where d.status='converti') / count(*), 1) else 0 end
  from public.documents d
  where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and d.doc_type in ('DEV','RES','BL') and d.issue_date between _from and _to
  group by d.doc_type
  order by d.doc_type;
$$;
grant execute on function public.report_transformation(uuid, date, date) to authenticated;
