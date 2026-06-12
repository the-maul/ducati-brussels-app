-- =====================================================================
-- M12 — Clôture d'exercice ARCHIVANTE + éditions pré-clôture (G8 §2.7).
-- Avant la clôture : éditer débiteurs, acomptes en cours, effets/chèques à échéance
-- (supprimés/figés à la clôture). La clôture fige la période : plus aucun document
-- daté dans une période clôturée (trigger). Par société (multi-société).
-- =====================================================================

create table if not exists public.fiscal_closures (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  period_from date not null,
  period_to   date not null,
  label       text,
  snapshot_id uuid references public.stock_snapshots(id) on delete set null,  -- arrêté de stock archivé
  closed_by   uuid references auth.users(id) on delete set null,
  closed_at   timestamptz not null default now()
);
create index if not exists idx_fiscal_closures_company on public.fiscal_closures(company_id, period_to);

drop trigger if exists trg_fiscal_closures_audit on public.fiscal_closures;
create trigger trg_fiscal_closures_audit after insert or update or delete on public.fiscal_closures for each row execute function public.audit_row();
alter table public.fiscal_closures enable row level security;
drop policy if exists fiscal_closures_all on public.fiscal_closures;
create policy fiscal_closures_all on public.fiscal_closures for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- Éditions pré-clôture
-- ---------------------------------------------------------------------
-- Clients débiteurs (factures non soldées) à une date donnée.
create or replace function public.debtors_list(_company uuid, _as_of date)
returns table(contact_id uuid, contact_name text, invoices bigint, total_due numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, coalesce(c.company_name, trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))),
         count(*)::bigint, round(sum(d.total_ttc - d.paid_amount), 2)
  from public.documents d join public.contacts c on c.id = d.contact_id
  where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and d.doc_type = 'FAC' and d.status not in ('annulee','converti')
    and d.total_ttc - d.paid_amount > 0.005 and d.issue_date <= _as_of
  group by c.id, c.company_name, c.first_name, c.last_name
  having sum(d.total_ttc - d.paid_amount) > 0.005
  order by sum(d.total_ttc - d.paid_amount) desc;
$$;
grant execute on function public.debtors_list(uuid, date) to authenticated;

-- Acomptes en cours (réservations non transformées portant un règlement perçu).
create or replace function public.pending_deposits(_company uuid)
returns table(document_id uuid, number text, contact_name text, deposit numeric, issue_date date)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.number, coalesce(c.company_name, trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))),
         round(d.paid_amount, 2), d.issue_date
  from public.documents d left join public.contacts c on c.id = d.contact_id
  where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and d.doc_type = 'RES' and d.status not in ('annulee','converti') and d.paid_amount > 0.005
  order by d.issue_date;
$$;
grant execute on function public.pending_deposits(uuid) to authenticated;

-- Effets/chèques à échéance (règlements différés 'attendu').
create or replace function public.pending_effects(_company uuid, _to date)
returns table(payment_id uuid, document_number text, method text, amount numeric, due_date date)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, d.number, p.method, p.amount, p.due_date
  from public.document_payments p join public.documents d on d.id = p.document_id
  where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and p.status = 'attendu' and (p.due_date is null or p.due_date <= _to)
  order by p.due_date nulls first;
$$;
grant execute on function public.pending_effects(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- Clôture : fige la période + archive un arrêté de stock daté.
-- ---------------------------------------------------------------------
create or replace function public.close_fiscal_year(_company uuid, _from date, _to date, _label text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare _snap uuid; _id uuid;
begin
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  if exists (select 1 from public.fiscal_closures where company_id = _company and _from <= period_to and _to >= period_from) then
    raise exception 'Période déjà clôturée (chevauchement)';
  end if;
  -- Arrêté de stock archivé à la clôture (B4).
  insert into public.stock_snapshots (company_id, kind, label) values (_company, 'cloture', coalesce(_label, 'Clôture ' || _to)) returning id into _snap;
  insert into public.stock_snapshot_lines (snapshot_id, article_id, qty, pamp)
    select _snap, s.article_id, s.real_qty, s.pamp from public.article_stock_list(_company) s where s.real_qty <> 0;

  insert into public.fiscal_closures (company_id, period_from, period_to, label, snapshot_id, closed_by)
    values (_company, _from, _to, _label, _snap, auth.uid()) returning id into _id;
  return _id;
end $$;
grant execute on function public.close_fiscal_year(uuid, date, date, text) to authenticated;

-- Garde : interdit la création d'un document daté dans une période clôturée.
create or replace function public.guard_closed_period()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.fiscal_closures f where f.company_id = new.company_id and new.issue_date between f.period_from and f.period_to) then
    raise exception 'Période clôturée : impossible de créer un document daté du %', new.issue_date;
  end if;
  return new;
end $$;
drop trigger if exists trg_documents_closed_period on public.documents;
create trigger trg_documents_closed_period before insert on public.documents
  for each row execute function public.guard_closed_period();
