-- =====================================================================
-- M4 — Rattrapage G8 (18/11/2026) : fiche fournisseur et liste des documents fournisseurs.
--
-- G8 (02-articles.md « Fiche fournisseur », « Remise fin d'année » ; 04-fournisseurs-achats.md
-- « Liste des documents », « Historique commandes » ; parcours 27) :
--  1. remises de fin d'année (RFA) enregistrées : fournisseur × famille (rayon / sous-rayon /
--     catégorie), libellé, taux, montant, date ; table supplier_year_end_rebates (RLS, audit) ;
--  2. encours de commande d'un fournisseur (reste à recevoir de ses commandes validées) ;
--  3. chiffre d'affaires N, N-1, N-2 d'un fournisseur : achats (réceptions), retours
--     (rétrocessions), ventes HT et marge des articles dont il est le fournisseur principal ;
--  4. liste des documents fournisseurs avec filtres (période, fournisseur, type) ;
--  5. échéances fournisseurs (tous fournisseurs) ; 6. montants TVA par fournisseur (date de
--     réception ou de facture) ; 7. historique des envois de commandes avec n° de réception.
-- Les colonnes de conditions d'achat de la fiche sont dans 20261118200000.
-- Lecture seule sauf la table RFA. NON APPLIQUÉE (après 20261118200000).
-- =====================================================================

-- ------------------------------------------------ 1. Remises de fin d'année
create table if not exists public.supplier_year_end_rebates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  supplier_id  uuid not null references public.contacts(id) on delete cascade,
  family_code  text,                         -- '02' (rayon), '02-01' (sous-rayon), '02-01-99' (catégorie) ; vide = toutes
  label        text not null,
  rebate_pct   numeric(6,2),
  amount       numeric(14,2) not null default 0,
  rebate_date  date not null default current_date,
  note         text,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_rfa_company on public.supplier_year_end_rebates(company_id, rebate_date desc);
create index if not exists idx_rfa_supplier on public.supplier_year_end_rebates(supplier_id);
comment on table public.supplier_year_end_rebates is 'Remises de fin d''année (G8 Fichiers › Fournisseurs › Remise fin d''année) : fournisseur × famille, montant RFA.';

drop trigger if exists trg_rfa_updated on public.supplier_year_end_rebates;
create trigger trg_rfa_updated before update on public.supplier_year_end_rebates for each row execute function public.set_updated_at();
drop trigger if exists trg_rfa_audit on public.supplier_year_end_rebates;
create trigger trg_rfa_audit after insert or update or delete on public.supplier_year_end_rebates for each row execute function public.audit_row();

alter table public.supplier_year_end_rebates enable row level security;
drop policy if exists rfa_all on public.supplier_year_end_rebates;
create policy rfa_all on public.supplier_year_end_rebates for all to authenticated
  using (public.is_member(company_id))
  with check (public.is_member(company_id)
              and exists (select 1 from public.contacts c where c.id = supplier_id and c.company_id = supplier_year_end_rebates.company_id));

-- ------------------------------------------------ 2. Encours de commande d'un fournisseur
create or replace function public.supplier_open_orders(_supplier uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cid uuid; res jsonb;
begin
  select company_id into cid from public.contacts where id = _supplier;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'amount_ht', coalesce(round(sum(greatest(l.quantity - public._purchase_line_received(l.id), 0)
                                           * l.unit_price_ht * (1 - coalesce(l.discount_pct, 0) / 100)), 2), 0),
           'orders', count(distinct o.id),
           'lines', count(*) filter (where l.quantity - public._purchase_line_received(l.id) > 0))
    into res
    from public.purchase_orders o join public.purchase_lines l on l.order_id = o.id
   where o.supplier_id = _supplier and o.doc_type = 'CMD' and o.status in ('validee', 'partielle');
  return res;
end $$;
revoke all on function public.supplier_open_orders(uuid) from public, anon;
grant execute on function public.supplier_open_orders(uuid) to authenticated;

-- ------------------------------------------------ 3. Chiffre d'affaires N, N-1, N-2
-- Ventes et marge : lignes FAC / TIK / AVO validées des articles dont ce fournisseur est le fournisseur
-- principal. Marge = HT − quantité × PAMP actuel de l'article (approximation : le coût de chaque sortie
-- n'est pas figé dans stock_moves).
create or replace function public.supplier_turnover(_supplier uuid)
returns table (fiscal_year int, purchases_ht numeric, returns_ht numeric, receipts int, sales_ht numeric, margin_ht numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cid uuid; y int := extract(year from (now() at time zone 'Europe/Brussels'))::int;
begin
  select company_id into cid from public.contacts where id = _supplier;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  with yrs as (select g::int as yy from generate_series(y - 2, y) g),
  pur as (
    select extract(year from coalesce(o.receipt_date, o.order_date, o.created_at::date))::int as yy,
           sum(case when o.doc_type = 'REC' then o.total_ht else 0 end) as p_ht,
           sum(case when o.doc_type = 'RTF' then o.total_ht else 0 end) as r_ht,
           count(*) filter (where o.doc_type = 'REC') as n
      from public.purchase_orders o
     where o.supplier_id = _supplier and o.company_id = cid
       and ((o.doc_type = 'REC' and o.status = 'recue') or (o.doc_type = 'RTF' and o.status = 'validee'))
     group by 1
  ),
  sal as (
    select extract(year from d.issue_date)::int as yy,
           sum(dl.line_ht) as s_ht,
           sum(dl.line_ht - dl.quantity * coalesce(nullif(a.pamp, 0), a.purchase_price, 0)) as m_ht
      from public.document_lines dl
      join public.documents d on d.id = dl.document_id
      join public.articles a on a.id = dl.article_id
     where d.company_id = cid and a.main_supplier_id = _supplier
       and d.doc_type::text in ('FAC', 'TIK', 'AVO')
       and d.status::text not in ('brouillon', 'annulee')
       and d.issue_date >= make_date(y - 2, 1, 1)
     group by 1
  )
  select yrs.yy, coalesce(pur.p_ht, 0), coalesce(pur.r_ht, 0), coalesce(pur.n, 0)::int,
         round(coalesce(sal.s_ht, 0), 2), round(coalesce(sal.m_ht, 0), 2)
    from yrs left join pur on pur.yy = yrs.yy left join sal on sal.yy = yrs.yy
   order by yrs.yy desc;
end $$;
revoke all on function public.supplier_turnover(uuid) from public, anon;
grant execute on function public.supplier_turnover(uuid) to authenticated;

-- ------------------------------------------------ 4. Liste des documents fournisseurs
create or replace function public.purchase_documents(
  _company uuid, _doc_type text default null, _from date default null, _to date default null, _supplier uuid default null,
  _limit int default 500
)
returns table (
  id uuid, doc_type text, number text, status text, order_type text, doc_date date, supplier_id uuid, supplier_name text,
  operator_name text, supplier_invoice_no text, invoice_date date, supplier_bl_no text, bl_date date,
  total_ht numeric, total_vat numeric, total_ttc numeric, shipping_ht numeric, shipping_ttc numeric,
  dcs_kind text, validated_at timestamptz, last_sent_at timestamptz, receipts text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select o.id, o.doc_type, o.number, o.status, o.order_type,
         coalesce(case when o.doc_type = 'REC' then o.receipt_date end, o.order_date, o.receipt_date, o.created_at::date),
         o.supplier_id,
         coalesce(nullif(btrim(s.company_name), ''), nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), '')),
         pr.full_name, o.supplier_invoice_no, o.invoice_date, o.supplier_bl_no, o.bl_date,
         o.total_ht, o.total_vat, o.total_ttc, o.shipping_ht,
         round(o.shipping_ht * (1 + case when o.vat_regime = 'with_vat' and o.shipping_taxed then coalesce(o.shipping_vat_rate, 21) else 0 end / 100), 2),
         o.dcs_kind, o.validated_at,
         (select max(se.sent_at) from public.purchase_order_sends se where se.order_id = o.id),
         case when o.doc_type = 'CMD' then
           (select string_agg(distinct r.number, ', ')
              from public.purchase_lines rl join public.purchase_orders r on r.id = rl.order_id
              join public.purchase_lines cl on cl.id = rl.source_line_id
             where cl.order_id = o.id and r.doc_type = 'REC' and r.status = 'recue')
         end
    from public.purchase_orders o
    left join public.contacts s on s.id = o.supplier_id
    left join public.profiles pr on pr.id = coalesce(o.operator_id, o.validated_by)
   where o.company_id = _company
     and (_doc_type is null or o.doc_type = upper(_doc_type))
     and (_supplier is null or o.supplier_id = _supplier)
     and (_from is null or coalesce(case when o.doc_type = 'REC' then o.receipt_date end, o.order_date, o.receipt_date, o.created_at::date) >= _from)
     and (_to is null or coalesce(case when o.doc_type = 'REC' then o.receipt_date end, o.order_date, o.receipt_date, o.created_at::date) <= _to)
   order by o.created_at desc
   limit greatest(coalesce(_limit, 500), 1);
end $$;
revoke all on function public.purchase_documents(uuid, text, date, date, uuid, int) from public, anon;
grant execute on function public.purchase_documents(uuid, text, date, date, uuid, int) to authenticated;

-- ------------------------------------------------ 5. Échéances fournisseurs (tous fournisseurs)
-- Une ligne par échéance saisie ; une réception sans échéancier apparaît une fois, échéance vide (à saisir).
create or replace function public.purchase_due_schedules(_company uuid, _from date default null, _to date default null, _supplier uuid default null)
returns table (
  order_id uuid, number text, doc_type text, receipt_date date, due_date date, amount numeric,
  supplier_id uuid, supplier_name text, supplier_code text, accounting_account text,
  supplier_invoice_no text, invoice_date date, chassis text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  with docs as (
    select o.* from public.purchase_orders o
     where o.company_id = _company and o.doc_type = 'REC' and o.status = 'recue'
       and (_supplier is null or o.supplier_id = _supplier)
  ), rows_ as (
    select d.id as oid, ps.due_date as dd, ps.amount as am
      from docs d join public.purchase_schedules ps on ps.order_id = d.id
    union all
    select d.id, null::date, d.total_ttc
      from docs d where not exists (select 1 from public.purchase_schedules ps where ps.order_id = d.id)
  )
  select d.id, d.number, d.doc_type, d.receipt_date, r.dd, r.am,
         d.supplier_id,
         coalesce(nullif(btrim(s.company_name), ''), nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), '')),
         s.code, coalesce(s.accounting_account, s.account_code),
         d.supplier_invoice_no, d.invoice_date,
         (select string_agg(pl.chassis->>'vin', ', ') from public.purchase_lines pl where pl.order_id = d.id and pl.chassis is not null)
    from rows_ r
    join docs d on d.id = r.oid
    left join public.contacts s on s.id = d.supplier_id
   where (_from is null or coalesce(r.dd, d.invoice_date, d.receipt_date) >= _from)
     and (_to is null or coalesce(r.dd, d.invoice_date, d.receipt_date) <= _to)
   order by coalesce(r.dd, d.invoice_date, d.receipt_date) nulls first, d.number;
end $$;
revoke all on function public.purchase_due_schedules(uuid, date, date, uuid) from public, anon;
grant execute on function public.purchase_due_schedules(uuid, date, date, uuid) to authenticated;

-- ------------------------------------------------ 6. Montants TVA par fournisseur
-- Réceptions reçues, par taux : base HT nette (remise globale appliquée au prorata), TVA (nulle hors régime
-- « avec TVA »), TTC ; le port est compté à son taux. _basis = 'receipt' (date de réception) ou 'invoice'.
create or replace function public.purchase_vat_by_supplier(_company uuid, _from date default null, _to date default null, _basis text default 'receipt')
returns table (supplier_id uuid, supplier_name text, vat_number text, vat_rate numeric, base_ht numeric, vat numeric, ttc numeric, receipts int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  with docs as (
    select o.*, case when coalesce(_basis, 'receipt') = 'invoice' then coalesce(o.invoice_date, o.receipt_date) else o.receipt_date end as dref
      from public.purchase_orders o
     where o.company_id = _company and o.doc_type = 'REC' and o.status = 'recue'
  ), parts as (
    select d.id, d.supplier_id as sid, case when d.vat_regime = 'with_vat' then l.vat_rate else 0 end as rate,
           round(l.quantity * l.unit_price_ht * (1 - coalesce(l.discount_pct, 0) / 100), 3) * (1 - coalesce(d.global_discount_pct, 0) / 100) as base
      from docs d join public.purchase_lines l on l.order_id = d.id
     where (_from is null or d.dref >= _from) and (_to is null or d.dref <= _to)
    union all
    select d.id, d.supplier_id, case when d.vat_regime = 'with_vat' and d.shipping_taxed then coalesce(d.shipping_vat_rate, 21) else 0 end,
           d.shipping_ht
      from docs d
     where coalesce(d.shipping_ht, 0) <> 0 and (_from is null or d.dref >= _from) and (_to is null or d.dref <= _to)
  )
  select p.sid,
         coalesce(nullif(btrim(s.company_name), ''), nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), '')),
         s.vat_number, p.rate,
         round(sum(p.base), 2), round(sum(p.base * p.rate / 100), 2), round(sum(p.base) + sum(p.base * p.rate / 100), 2),
         count(distinct p.id)::int
    from parts p left join public.contacts s on s.id = p.sid
   group by p.sid, s.company_name, s.first_name, s.last_name, s.vat_number, p.rate
   order by 2 nulls last, p.rate;
end $$;
revoke all on function public.purchase_vat_by_supplier(uuid, date, date, text) from public, anon;
grant execute on function public.purchase_vat_by_supplier(uuid, date, date, text) to authenticated;

-- ------------------------------------------------ 7. Historique des commandes (envois)
create or replace function public.purchase_order_history(_company uuid, _from date default null, _to date default null, _supplier uuid default null)
returns table (
  order_id uuid, number text, order_type text, status text, sent_at timestamptz, channel text, note text, sent_by_name text,
  supplier_id uuid, supplier_code text, supplier_name text, receipts text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select o.id, o.number, o.order_type, o.status, se.sent_at, se.channel, se.note, pr.full_name,
         o.supplier_id, s.code,
         coalesce(nullif(btrim(s.company_name), ''), nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), '')),
         (select string_agg(distinct r.number, ', ')
            from public.purchase_lines rl join public.purchase_orders r on r.id = rl.order_id
            join public.purchase_lines cl on cl.id = rl.source_line_id
           where cl.order_id = o.id and r.doc_type = 'REC' and r.status = 'recue')
    from public.purchase_order_sends se
    join public.purchase_orders o on o.id = se.order_id
    left join public.contacts s on s.id = o.supplier_id
    left join public.profiles pr on pr.id = se.sent_by
   where se.company_id = _company
     and (_supplier is null or o.supplier_id = _supplier)
     and (_from is null or (se.sent_at at time zone 'Europe/Brussels')::date >= _from)
     and (_to is null or (se.sent_at at time zone 'Europe/Brussels')::date <= _to)
   order by se.sent_at desc;
end $$;
revoke all on function public.purchase_order_history(uuid, date, date, uuid) from public, anon;
grant execute on function public.purchase_order_history(uuid, date, date, uuid) to authenticated;
