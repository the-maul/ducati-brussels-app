-- =====================================================================
-- M13 — Rapports : CA mensuel (12 mois), top articles vendus, productivité atelier.
-- Lecture seule, RLS via security definer.
-- =====================================================================

-- CA mensuel des 12 derniers mois (factures + tickets, hors annulées).
create or replace function public.monthly_revenue(_company uuid)
returns table(month text, revenue_ttc numeric, invoices int)
language sql stable security definer set search_path = public, pg_temp as $$
  select to_char(date_trunc('month', d.issue_date), 'YYYY-MM') as month,
         round(sum(d.total_ttc), 2), count(*)::int
  from public.documents d
  where d.company_id = _company and public.is_member(_company)
    and d.doc_type in ('FAC', 'TIK') and d.status <> 'annulee'
    and d.issue_date >= (date_trunc('month', current_date) - interval '11 months')
  group by 1 order by 1;
$$;
grant execute on function public.monthly_revenue(uuid) to authenticated;

-- Top articles vendus sur une période (quantité + CA HT).
create or replace function public.top_articles(_company uuid, _from date, _to date, _limit int default 15)
returns table(article_id uuid, reference text, designation text, qty numeric, revenue_ht numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.article_id, a.reference, a.designation, round(sum(l.quantity), 2), round(sum(l.line_ht), 2)
  from public.document_lines l
  join public.documents d on d.id = l.document_id
  left join public.articles a on a.id = l.article_id
  where d.company_id = _company and public.is_member(_company)
    and d.doc_type in ('FAC', 'TIK') and d.status <> 'annulee'
    and d.issue_date >= _from and d.issue_date <= _to
    and l.article_id is not null
  group by l.article_id, a.reference, a.designation
  order by sum(l.line_ht) desc
  limit _limit;
$$;
grant execute on function public.top_articles(uuid, date, date, int) to authenticated;

-- Productivité atelier : minutes de présence et de travail par mécanicien sur une période.
create or replace function public.workshop_productivity(_company uuid, _from timestamptz, _to timestamptz)
returns table(mechanic text, presence_min numeric, work_min numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(mechanic_name, '—') as mechanic,
         round(coalesce(sum(minutes) filter (where kind = 'presence'), 0), 1),
         round(coalesce(sum(minutes) filter (where kind = 'travail'), 0), 1)
  from public.workshop_time_entries
  where company_id = _company and public.is_member(_company)
    and started_at >= _from and started_at < _to and minutes is not null
  group by 1 order by 1;
$$;
grant execute on function public.workshop_productivity(uuid, timestamptz, timestamptz) to authenticated;
