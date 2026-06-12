-- =====================================================================
-- M12 — Plan comptable (PCMN belge) + mapping de comptes PARAMÉTRABLE + comptes
-- auxiliaires clients/fournisseurs. Base du moteur d'écritures (P0.2).
-- Principe CLAUDE.md §5 : rien de figé en dur — taux, comptes, journaux sont en
-- table, auditable ; le comptable corrige par réglage, pas par réécriture.
--
-- PCMN = Plan Comptable Minimum Normalisé (AR 12/09/1983) :
--   400 clients · 440 fournisseurs · 451 TVA à payer (collectée) ·
--   411 TVA à récupérer (déductible) · 70 ventes · 60 achats · 550 banque · 570 caisse.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Plan comptable par société.
-- ---------------------------------------------------------------------
create table if not exists public.chart_of_accounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  code        text not null,                 -- ex. '700000'
  label       text not null,
  kind        text not null default 'general', -- 'general' | 'customer' | 'supplier' | 'vat' | 'treasury' | 'analytic'
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (company_id, code)
);
create index if not exists idx_coa_company on public.chart_of_accounts(company_id);

-- ---------------------------------------------------------------------
-- 2) Mapping générique : (dimension, clé) -> compte + journal. La clé est un
--    category_id, un taux de TVA, un code mode de règlement, ou '*' (défaut).
--    dimension : sales | purchase | vat_collected | vat_deductible | vat_intracom
--              | vat_margin | payment | customer_collective | supplier_collective
-- ---------------------------------------------------------------------
create table if not exists public.account_mappings (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  dimension    text not null,
  match_key    text not null default '*',
  account_code text not null,
  journal_code text,
  updated_at   timestamptz not null default now(),
  unique (company_id, dimension, match_key)
);
create index if not exists idx_acctmap_company on public.account_mappings(company_id, dimension);

drop trigger if exists trg_acctmap_updated on public.account_mappings;
create trigger trg_acctmap_updated before update on public.account_mappings for each row execute function public.set_updated_at();
drop trigger if exists trg_acctmap_audit on public.account_mappings;
create trigger trg_acctmap_audit after insert or update or delete on public.account_mappings for each row execute function public.audit_row();
drop trigger if exists trg_coa_audit on public.chart_of_accounts;
create trigger trg_coa_audit after insert or update or delete on public.chart_of_accounts for each row execute function public.audit_row();

alter table public.chart_of_accounts enable row level security;
alter table public.account_mappings  enable row level security;
drop policy if exists coa_all on public.chart_of_accounts;
create policy coa_all on public.chart_of_accounts for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists acctmap_all on public.account_mappings;
create policy acctmap_all on public.account_mappings for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- 3) Compte auxiliaire sur la fiche contact (client/fournisseur). Reportable
--    sur la fiche (G8 : « le compte client peut être reporté dans la fiche »).
-- ---------------------------------------------------------------------
alter table public.contacts add column if not exists account_code text;

-- ---------------------------------------------------------------------
-- 4) Résolveur de compte : exact (dimension,clé) -> défaut (dimension,'*') -> null.
-- ---------------------------------------------------------------------
create or replace function public.resolve_account(_company uuid, _dimension text, _key text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select account_code from public.account_mappings
  where company_id = _company and dimension = _dimension and match_key = coalesce(_key, '*')
  union all
  select account_code from public.account_mappings
  where company_id = _company and dimension = _dimension and match_key = '*'
  limit 1;
$$;
grant execute on function public.resolve_account(uuid, text, text) to authenticated, service_role;

create or replace function public.resolve_journal(_company uuid, _dimension text, _key text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select journal_code from public.account_mappings
  where company_id = _company and dimension = _dimension and match_key = coalesce(_key, '*') and journal_code is not null
  union all
  select journal_code from public.account_mappings
  where company_id = _company and dimension = _dimension and match_key = '*' and journal_code is not null
  limit 1;
$$;
grant execute on function public.resolve_journal(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5) Création automatique des comptes auxiliaires clients/fournisseurs (G8
--    « Création automatique ») : attribue un code séquentiel aux contacts qui
--    n'en ont pas (clients sous 400, fournisseurs sous 440). Idempotent.
-- ---------------------------------------------------------------------
create or replace function public.generate_auxiliary_accounts(_company uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare _c record; _seq_cust int; _seq_supp int; _count int := 0; _code text;
begin
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  -- Reprend la séquence après le plus grand code déjà attribué dans chaque plage.
  select coalesce(max((account_code)::bigint), 400000) into _seq_cust
    from public.contacts where company_id = _company and account_code ~ '^4000[0-9]{2}$';
  select coalesce(max((account_code)::bigint), 440000) into _seq_supp
    from public.contacts where company_id = _company and account_code ~ '^4400[0-9]{2}$';
  for _c in
    select id, type from public.contacts
    where company_id = _company and (account_code is null or account_code = '')
    order by created_at
  loop
    if _c.type = 'fournisseur' then
      _seq_supp := _seq_supp + 1; _code := _seq_supp::text;
    else
      _seq_cust := _seq_cust + 1; _code := _seq_cust::text;
    end if;
    update public.contacts set account_code = _code where id = _c.id;
    _count := _count + 1;
  end loop;
  return _count;
end $$;
grant execute on function public.generate_auxiliary_accounts(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) SEED : PCMN minimal + mappings par défaut, pour chaque société. Idempotent.
-- ---------------------------------------------------------------------
do $$
declare _co record;
begin
  for _co in select id from public.companies loop
    -- Plan comptable minimal belge
    insert into public.chart_of_accounts (company_id, code, label, kind) values
      (_co.id, '400000', 'Clients', 'customer'),
      (_co.id, '440000', 'Fournisseurs', 'supplier'),
      (_co.id, '411000', 'TVA à récupérer (déductible)', 'vat'),
      (_co.id, '451000', 'TVA à payer (collectée)', 'vat'),
      (_co.id, '451054', 'TVA intracommunautaire due', 'vat'),
      (_co.id, '451090', 'TVA sur marge — occasions (VO)', 'vat'),
      (_co.id, '700000', 'Ventes de marchandises', 'general'),
      (_co.id, '700100', 'Ventes — prestations atelier', 'general'),
      (_co.id, '604000', 'Achats de marchandises', 'general'),
      (_co.id, '550000', 'Établissements de crédit — comptes courants', 'treasury'),
      (_co.id, '570000', 'Caisse', 'treasury'),
      (_co.id, '580000', 'Virements internes / attente', 'treasury'),
      (_co.id, '890000', 'Cessions internes (analytique)', 'analytic')
    on conflict (company_id, code) do nothing;

    -- Mappings par défaut (le comptable affine ensuite par catégorie/taux)
    insert into public.account_mappings (company_id, dimension, match_key, account_code, journal_code) values
      (_co.id, 'sales',               '*', '700000', 'VEN'),
      (_co.id, 'purchase',            '*', '604000', 'ACH'),
      (_co.id, 'vat_collected',       '*', '451000', null),
      (_co.id, 'vat_deductible',      '*', '411000', null),
      (_co.id, 'vat_intracom',        '*', '451054', null),
      (_co.id, 'vat_margin',          '*', '451090', null),
      (_co.id, 'customer_collective', '*', '400000', null),
      (_co.id, 'supplier_collective', '*', '440000', null),
      (_co.id, 'payment',             '*', '550000', 'FIN'),
      (_co.id, 'payment',           'ESP', '570000', 'FIN'),
      (_co.id, 'payment',           'CHQ', '550000', 'FIN'),
      (_co.id, 'payment',           'VIR', '550000', 'FIN'),
      (_co.id, 'payment',            'CB', '550000', 'FIN')
    on conflict (company_id, dimension, match_key) do nothing;
  end loop;
end $$;
