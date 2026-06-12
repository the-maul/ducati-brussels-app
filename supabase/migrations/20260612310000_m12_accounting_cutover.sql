-- =====================================================================
-- M12 — DATE DE BASCULE COMPTABLE (reprise / go-live). Comme un vrai logiciel
-- comptable : l'historique migré reste en CONSULTATION partout (liste, fiche client,
-- encours, stats), mais seules les pièces datées >= bascule génèrent la TVA à
-- déclarer, les écritures et l'export Winbooks (le reste a déjà été déclaré en G8).
-- Par défaut : 1er janvier de l'exercice en cours. Configurable par société.
-- =====================================================================
alter table public.companies
  add column if not exists accounting_start_date date not null default date_trunc('year', current_date)::date;

-- Helper : date de bascule d'une société.
create or replace function public._accounting_cutover(_company uuid)
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(accounting_start_date, date_trunc('year', current_date)::date) from public.companies where id = _company;
$$;

-- La génération d'écritures démarre à la bascule (clamp du _from).
create or replace function public.generate_accounting_entries(_company uuid, _from date, _to date)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare _start date := public._accounting_cutover(_company);
begin
  _from := greatest(_from, _start);
  return public.generate_sales_entries(_company, _from, _to) + public.generate_payment_entries(_company, _from, _to);
end $$;
grant execute on function public.generate_accounting_entries(uuid, date, date) to authenticated;

-- Registre TVA pour DÉCLARATION : à partir de la bascule (historique exclu = déjà déclaré).
-- Conserve la ventilation par lignes + l'inclusion des en-têtes migrés (post-bascule).
create or replace function public.vat_register(_company uuid, _from date, _to date)
returns table(vat_rate numeric, base_ht numeric, vat numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with cutoff as (select greatest(_from, public._accounting_cutover(_company)) as f),
  detailed as (
    select l.vat_rate as rate, sum(l.line_ht) as base, sum(l.line_ttc - l.line_ht) as vat
    from public.document_lines l
    join public.documents d on d.id = l.document_id, cutoff
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.doc_type in ('FAC','TIK','AVO') and d.status <> 'annulee'
      and d.issue_date between cutoff.f and _to
    group by l.vat_rate
  ),
  header_only as (
    select case when abs(d.total_ht) > 0 then round(d.total_vat / d.total_ht * 100) else 0 end as rate,
           sum(d.total_ht) as base, sum(d.total_vat) as vat
    from public.documents d, cutoff
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.doc_type in ('FAC','TIK','AVO') and d.status <> 'annulee'
      and d.issue_date between cutoff.f and _to
      and not exists (select 1 from public.document_lines l where l.document_id = d.id)
    group by 1
  )
  select rate, round(sum(base), 2), round(sum(vat), 2)
  from (select * from detailed union all select * from header_only) u
  group by rate order by rate;
$$;
grant execute on function public.vat_register(uuid, date, date) to authenticated;

-- Setter (admin) : règle la date de bascule comptable.
create or replace function public.set_accounting_cutover(_company uuid, _date date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  update public.companies set accounting_start_date = _date where id = _company;
end $$;
grant execute on function public.set_accounting_cutover(uuid, date) to authenticated;
