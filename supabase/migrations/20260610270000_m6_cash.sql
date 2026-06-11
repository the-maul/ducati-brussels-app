-- =====================================================================
-- M6 (POS) — Caisse : sessions (fond de caisse), mouvements de fond de caisse,
-- clôture Z (journal des encaissements par mode + acomptes + entrées/sorties + TVA).
-- Réf. G8 Facturation p.128-131 (fond de caisse, mouvements), p.164-179 (journal Z,
-- ventilations, calcul monnaie). company_id + RLS, audit (B7).
-- =====================================================================

-- Session de caisse : ouverture (fond) → clôture (comptage tiroir).
create table if not exists public.cash_sessions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  status        text not null default 'open',          -- 'open' | 'closed'
  opened_by     uuid references auth.users(id) on delete set null,
  opened_at     timestamptz not null default now(),
  opening_float numeric(14,2) not null default 0,        -- fond de caisse d'ouverture
  closed_at     timestamptz,
  counted_cash  numeric(14,2),                           -- comptage physique des espèces à la clôture
  denominations jsonb not null default '{}'::jsonb,      -- calcul monnaie : {valeur: quantité}
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_cash_sessions_company on public.cash_sessions(company_id, status);

-- Mouvements de fond de caisse (entrées/sorties non liées à une vente).
create table if not exists public.cash_movements (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  session_id  uuid references public.cash_sessions(id) on delete set null,
  kind        text not null,                             -- 'in' (entrée) | 'out' (sortie)
  method      text not null default 'ESP',
  amount      numeric(14,2) not null,                    -- toujours positif ; le sens vient de kind
  reason      text,
  operator_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_cash_movements_company on public.cash_movements(company_id, occurred_at desc);

drop trigger if exists trg_cash_sessions_updated on public.cash_sessions;
create trigger trg_cash_sessions_updated before update on public.cash_sessions for each row execute function public.set_updated_at();
drop trigger if exists trg_cash_sessions_audit on public.cash_sessions;
create trigger trg_cash_sessions_audit after insert or update or delete on public.cash_sessions for each row execute function public.audit_row();
drop trigger if exists trg_cash_movements_audit on public.cash_movements;
create trigger trg_cash_movements_audit after insert or update or delete on public.cash_movements for each row execute function public.audit_row();

alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
drop policy if exists cash_sessions_all on public.cash_sessions;
create policy cash_sessions_all on public.cash_sessions for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists cash_movements_all on public.cash_movements;
create policy cash_movements_all on public.cash_movements for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- Journal Z : récap des encaissements d'une période (G8 p.170).
--   reglements par mode (ventes FAC/TIK vs acomptes RES vs avoirs AVO),
--   entrées/sorties de fond de caisse, ventilation TVA, espèces théoriques.
-- Retourne un JSON agrégé (lecture seule, sécurisé par RLS via security definer).
-- ---------------------------------------------------------------------
create or replace function public.cash_z_report(_company uuid, _from timestamptz, _to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _result jsonb;
begin
  if not public.is_member(_company) then raise exception 'Accès refusé'; end if;

  select jsonb_build_object(
    -- Règlements perçus par mode, ventilés par nature de document
    'payments_by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'sales', sales, 'deposits', deposits, 'refunds', refunds, 'total', total) order by method)
      from (
        select p.method,
          sum(case when d.doc_type in ('FAC','TIK') then p.amount else 0 end) as sales,
          sum(case when d.doc_type = 'RES' then p.amount else 0 end) as deposits,
          sum(case when d.doc_type = 'AVO' then p.amount else 0 end) as refunds,
          sum(p.amount) as total
        from public.document_payments p
        join public.documents d on d.id = p.document_id
        where d.company_id = _company and p.status = 'recu' and p.paid_at >= _from and p.paid_at < _to
        group by p.method
      ) m
    ), '[]'::jsonb),
    -- Ventilation TVA des ventes (lignes des FAC/TIK validées sur la période)
    'vat_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('vat_rate', vat_rate, 'base_ht', base_ht, 'vat', vat) order by vat_rate)
      from (
        select l.vat_rate,
          round(sum(l.line_ht), 2) as base_ht,
          round(sum(l.line_ttc - l.line_ht), 2) as vat
        from public.document_lines l
        join public.documents d on d.id = l.document_id
        where d.company_id = _company and d.doc_type in ('FAC','TIK')
          and d.status <> 'annulee' and d.issue_date >= _from::date and d.issue_date < _to::date
        group by l.vat_rate
      ) v
    ), '[]'::jsonb),
    -- Mouvements de fond de caisse
    'cash_in',  coalesce((select sum(amount) from public.cash_movements where company_id = _company and kind = 'in'  and occurred_at >= _from and occurred_at < _to), 0),
    'cash_out', coalesce((select sum(amount) from public.cash_movements where company_id = _company and kind = 'out' and occurred_at >= _from and occurred_at < _to), 0)
  ) into _result;

  return _result;
end $$;
grant execute on function public.cash_z_report(uuid, timestamptz, timestamptz) to authenticated;
