-- =====================================================================
-- M13 — FIX rapports : prise en compte des factures MIGRÉES (en-tête seul, sans
-- lignes). La marge vient de document_lines si présentes, sinon de documents.marge
-- (importée de G8). Les dimensions mois/client/opérateur se calculent sur les EN-TÊTES
-- (donc incluent les factures migrées) ; marque/rayon/article restent par lignes.
-- =====================================================================

-- Marge d'un document : somme des marges de lignes (PAMP) si lignes, sinon marge G8 importée.
create or replace function public._doc_margin(_doc uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select sum(l.line_ht - coalesce(a.pamp,0)*abs(l.quantity))
       from public.document_lines l left join public.articles a on a.id = l.article_id
      where l.document_id = _doc and exists (select 1 from public.document_lines x where x.document_id = _doc)),
    (select marge from public.documents where id = _doc),
    0);
$$;

-- Indicateurs : marge = ligne si dispo, sinon marge d'en-tête importée.
create or replace function public.report_indicators(_company uuid, _from date, _to date)
returns table(invoices bigint, ca_ht numeric, avg_basket numeric, margin numeric, margin_pct numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with inv as (
    select d.id, d.total_ht, d.total_ttc, public._doc_margin(d.id) as marg
    from public.documents d
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.doc_type in ('FAC','TIK') and d.status <> 'annulee'
      and d.issue_date between _from and _to
  )
  select count(*)::bigint, round(coalesce(sum(total_ht),0),2), round(coalesce(avg(total_ttc),0),2),
         round(coalesce(sum(marg),0),2),
         case when coalesce(sum(total_ht),0) > 0 then round(100*sum(marg)/sum(total_ht),1) else 0 end
  from inv;
$$;

-- Ventes par dimension : mois/client/opérateur depuis les EN-TÊTES (inclut migrées),
-- marque/rayon/article depuis les LIGNES (factures détaillées uniquement).
create or replace function public.report_sales_by(_company uuid, _from date, _to date, _dim text)
returns table(label text, qty numeric, ca_ht numeric, margin numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if _dim in ('brand','category','article') then
    return query
      select case _dim
               when 'brand' then coalesce(a.brand,'(sans marque)')
               when 'category' then coalesce(a.category_path,'(sans rayon)')
               else coalesce(a.reference||' '||a.designation, l.designation) end,
             round(sum(abs(l.quantity)),2), round(sum(l.line_ht),2),
             round(sum(l.line_ht - coalesce(a.pamp,0)*abs(l.quantity)),2)
      from public.document_lines l
      join public.documents d on d.id = l.document_id
      left join public.articles a on a.id = l.article_id
      where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
        and d.doc_type in ('FAC','TIK') and d.status <> 'annulee' and d.issue_date between _from and _to
      group by 1 order by 3 desc;
  else
    return query
      select case _dim
               when 'client' then coalesce(c.company_name, nullif(trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')),''), d.code_client_legacy, 'Comptoir')
               when 'operator' then coalesce(d.operator,'(n/a)')
               else to_char(d.issue_date,'YYYY-MM') end,
             count(*)::numeric, round(sum(d.total_ht),2), round(sum(public._doc_margin(d.id)),2)
      from public.documents d
      left join public.contacts c on c.id = d.contact_id
      where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
        and d.doc_type in ('FAC','TIK') and d.status <> 'annulee' and d.issue_date between _from and _to
      group by 1 order by 3 desc;
  end if;
end $$;
grant execute on function public.report_sales_by(uuid, date, date, text) to authenticated;
grant execute on function public.report_indicators(uuid, date, date) to authenticated;
