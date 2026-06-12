-- =====================================================================
-- M1/M2 — Moteur de TARIFS CLIENTS (parité G8 §3.5) : par client / famille / article,
-- un tarif = remise % OU coefficient ((PAHT×coef)+TVA=PVTTC) OU remise QUANTITATIVE
-- à paliers. Résolution par spécificité (article+client > catégorie+client > client > …).
-- =====================================================================

create table if not exists public.customer_price_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  contact_id  uuid references public.contacts(id) on delete cascade,
  category_id uuid references public.article_categories(id) on delete cascade,
  article_id  uuid references public.articles(id) on delete cascade,
  kind        text not null default 'discount_pct',  -- discount_pct | coefficient | quantity_tiers
  value       numeric(12,4) not null default 0,       -- % (discount) ou coef
  tiers       jsonb,                                   -- [{"min_qty":1,"discount_pct":0}, …] (quantity_tiers)
  label       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_cpr_company on public.customer_price_rules(company_id);
create index if not exists idx_cpr_contact on public.customer_price_rules(contact_id);

drop trigger if exists trg_cpr_audit on public.customer_price_rules;
create trigger trg_cpr_audit after insert or update or delete on public.customer_price_rules for each row execute function public.audit_row();
alter table public.customer_price_rules enable row level security;
drop policy if exists cpr_all on public.customer_price_rules;
create policy cpr_all on public.customer_price_rules for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- Résout le prix d'un article pour un client à une quantité donnée.
-- Choisit la règle ACTIVE la plus spécifique (score : client 2 + article 2 + catégorie 1).
-- ---------------------------------------------------------------------
create or replace function public.resolve_customer_price(_company uuid, _contact uuid, _article uuid, _qty numeric default 1)
returns table(unit_price_ht numeric, unit_price_ttc numeric, rule_kind text, discount_pct numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a record; r record; _pct numeric; _ht numeric; _ttc numeric; _cat uuid; _tier jsonb; _best numeric;
begin
  select sale_price_ht, sale_price_ttc, purchase_price, vat_rate, category_id
    into a from public.articles where id = _article and company_id = _company;
  if a is null then return; end if;
  _cat := a.category_id;

  select * into r from public.customer_price_rules cpr
  where cpr.company_id = _company and cpr.is_active
    and (cpr.contact_id is null or cpr.contact_id = _contact)
    and (cpr.article_id is null or cpr.article_id = _article)
    and (cpr.category_id is null or cpr.category_id = _cat)
  order by ((case when cpr.contact_id is not null then 2 else 0 end)
          + (case when cpr.article_id is not null then 2 else 0 end)
          + (case when cpr.category_id is not null then 1 else 0 end)) desc,
          cpr.created_at desc
  limit 1;

  if r is null then
    return query select round(coalesce(a.sale_price_ht,0),2), round(coalesce(a.sale_price_ttc,0),2), 'base'::text, 0::numeric;
    return;
  end if;

  if r.kind = 'coefficient' then
    _ht := round(coalesce(a.purchase_price,0) * r.value, 2);
    _ttc := round(_ht * (1 + coalesce(a.vat_rate,21)/100.0), 2);
    return query select _ht, _ttc, 'coefficient'::text, 0::numeric;
  elsif r.kind = 'quantity_tiers' then
    _pct := 0; _best := -1;
    for _tier in select * from jsonb_array_elements(coalesce(r.tiers, '[]'::jsonb)) loop
      if (_tier->>'min_qty')::numeric <= _qty and (_tier->>'min_qty')::numeric > _best then
        _best := (_tier->>'min_qty')::numeric; _pct := (_tier->>'discount_pct')::numeric;
      end if;
    end loop;
    _ht := round(coalesce(a.sale_price_ht,0) * (1 - _pct/100.0), 2);
    _ttc := round(_ht * (1 + coalesce(a.vat_rate,21)/100.0), 2);
    return query select _ht, _ttc, 'quantity_tiers'::text, _pct;
  else -- discount_pct
    _pct := r.value;
    _ht := round(coalesce(a.sale_price_ht,0) * (1 - _pct/100.0), 2);
    _ttc := round(_ht * (1 + coalesce(a.vat_rate,21)/100.0), 2);
    return query select _ht, _ttc, 'discount_pct'::text, _pct;
  end if;
end $$;
grant execute on function public.resolve_customer_price(uuid, uuid, uuid, numeric) to authenticated, service_role;
