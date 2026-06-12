-- =====================================================================
-- M12 — FIX registre TVA : inclure les factures MIGRÉES (en-tête seul, sans lignes).
-- Pour ces factures, on ventile la TVA depuis l'en-tête (taux effectif = TVA/HT).
-- Les factures détaillées restent ventilées depuis leurs lignes.
-- =====================================================================
create or replace function public.vat_register(_company uuid, _from date, _to date)
returns table(vat_rate numeric, base_ht numeric, vat numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with detailed as (   -- factures avec lignes : ventilation par taux de ligne
    select l.vat_rate as rate, sum(l.line_ht) as base, sum(l.line_ttc - l.line_ht) as vat
    from public.document_lines l
    join public.documents d on d.id = l.document_id
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.doc_type in ('FAC','TIK','AVO') and d.status <> 'annulee'
      and d.issue_date between _from and _to
    group by l.vat_rate
  ),
  header_only as (     -- factures migrées (sans lignes) : taux effectif depuis l'en-tête
    select case when abs(d.total_ht) > 0 then round(d.total_vat / d.total_ht * 100) else 0 end as rate,
           sum(d.total_ht) as base, sum(d.total_vat) as vat
    from public.documents d
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.doc_type in ('FAC','TIK','AVO') and d.status <> 'annulee'
      and d.issue_date between _from and _to
      and not exists (select 1 from public.document_lines l where l.document_id = d.id)
    group by 1
  )
  select rate, round(sum(base), 2), round(sum(vat), 2)
  from (select * from detailed union all select * from header_only) u
  group by rate
  order by rate;
$$;
grant execute on function public.vat_register(uuid, date, date) to authenticated;

-- Bonus : sales_journal lisible aussi côté service role (cron/transfert serveur).
create or replace function public.sales_journal(_company uuid, _from date, _to date)
returns table(document_id uuid, number text, issue_date date, contact_id uuid,
  total_ht numeric, total_vat numeric, total_ttc numeric, paid_amount numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.number, d.issue_date, d.contact_id, d.total_ht, d.total_vat, d.total_ttc, d.paid_amount
  from public.documents d
  where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and d.doc_type in ('FAC','TIK','AVO') and d.status <> 'annulee'
    and d.issue_date >= _from and d.issue_date <= _to
  order by d.issue_date, d.number;
$$;
grant execute on function public.sales_journal(uuid, date, date) to authenticated;
