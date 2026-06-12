-- =====================================================================
-- M7 — DÉPÔT-VENTE (type D, glossaire CLAUDE.md) : véhicule confié par un client,
-- n'entre PAS en valorisation de stock (reste sa propriété). À la vente : reversement
-- au déposant + COMMISSION facturée. Tracé pour stats et marge.
-- =====================================================================

create table if not exists public.consignments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete restrict,
  depositor_id    uuid references public.contacts(id) on delete set null,   -- déposant (propriétaire)
  article_id      uuid references public.articles(id) on delete set null,   -- article type D
  vehicle_id      uuid references public.vehicles(id) on delete set null,
  number          text,
  agreed_price    numeric(14,2) not null default 0,    -- prix de vente convenu (TTC)
  commission_pct  numeric(6,2) not null default 0,     -- commission en % du prix de vente
  commission_amount numeric(14,2),                      -- OU commission fixe
  status          text not null default 'en_depot',    -- en_depot | vendu | restitue
  sale_document_id uuid references public.documents(id) on delete set null,
  sold_commission numeric(14,2),                        -- commission encaissée à la vente
  sold_reversal   numeric(14,2),                        -- reversement au déposant
  sold_at         timestamptz,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_consignments_company on public.consignments(company_id, status);

drop trigger if exists trg_consignments_audit on public.consignments;
create trigger trg_consignments_audit after insert or update or delete on public.consignments for each row execute function public.audit_row();
alter table public.consignments enable row level security;
drop policy if exists consignments_all on public.consignments;
create policy consignments_all on public.consignments for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Règlement d'un dépôt-vente : commission (% ou fixe) + reversement au déposant.
create or replace function public.settle_consignment(_consignment uuid, _sale_price_ttc numeric, _sale_document uuid default null)
returns table(commission numeric, reversal numeric)
language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _pct numeric; _fix numeric; _comm numeric; _rev numeric;
begin
  select company_id, commission_pct, commission_amount into _company, _pct, _fix from public.consignments where id = _consignment;
  if _company is null then raise exception 'Dépôt-vente introuvable'; end if;
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;

  _comm := coalesce(_fix, round(_sale_price_ttc * coalesce(_pct,0) / 100.0, 2));
  _rev  := round(_sale_price_ttc - _comm, 2);
  update public.consignments
    set status = 'vendu', sale_document_id = _sale_document, sold_commission = _comm, sold_reversal = _rev, sold_at = now()
    where id = _consignment;
  return query select _comm, _rev;
end $$;
grant execute on function public.settle_consignment(uuid, numeric, uuid) to authenticated, service_role;

-- Valeur de stock EXCLUANT le dépôt-vente (type D) : il n'appartient pas à la société.
create or replace function public.stock_value_owned(_company uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select round(coalesce(sum(s.real_qty * a.pamp), 0), 2)
  from public.article_stock_list(_company) s
  join public.articles a on a.id = s.article_id
  where a.mgmt_type <> 'D';
$$;
grant execute on function public.stock_value_owned(uuid) to authenticated;
