-- =====================================================================
-- M6 — RATTRAPAGE G8 « ENCAISSEMENTS » (18/11/2026), 5/5 : BONS D ACHAT CLIENT
-- Ref. G8 : Fichiers > Clients > Gestion Bons d achat (delai avant expiration en jours, montant
-- minimum du bon, statut ; colonnes N° bon, Code, Nom client, Montant TTC, Date debut, Date
-- d expiration, Statut, E-mail, Portable ; modele A4 / modele ticket ; Visualiser / Imprimer bon ;
-- Nouveau ; Supprimer). Inventaire 01-clients.md ; comparaison section 2, bloquant #18 (base FACTICE :
-- aucun bon, usage a confirmer). Le mode CHQC « Cheque cadeau » reste celui des cartes cadeaux Shopify.
--
-- CE QUE POSE CETTE MIGRATION
--   1. Sequence `BA` (Parametres > Numerotation) et mode de reglement BA « Bon d achat ».
--   2. `vouchers` : n°, client (facultatif), montant TTC, validite (du / au), statut actif / utilise /
--      annule (« expire » se deduit de la date), origine (vente, geste commercial, avoir, autre).
--   3. `document_payments.voucher_id` : un reglement BA designe son bon ; la base refuse un bon d une
--      autre societe, annule, utilise, expire ou pas encore valable, et un montant superieur au solde
--      du bon. Usage partiel permis (le solde reste sur le bon). Contre-passation d un reglement BA :
--      le solde revient sur le bon. Le statut suit le solde (utilise a 0, actif sinon).
--   4. `voucher_create` (validite par defaut et montant minimum : `receivable_settings`),
--      `voucher_cancel` (jamais utilise, motif), `vouchers_list` (solde, statut effectif).
--
-- Idempotente. NON APPLIQUEE. Suppose 20261118171000 (`receivable_settings`) posee.
-- =====================================================================

insert into public.document_sequences (company_id, doc_type, prefix, label)
select c.id, 'BA', 'BA', 'Bon d achat client (Encaissements > Bons d achat)'
  from public.companies c
on conflict (company_id, doc_type) do nothing;

insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select c.id, 'payment_method', 'BA', 'Bon d achat', 10, true, '{"visible_pos": true, "needs_voucher": true}'::jsonb
  from public.companies c
on conflict (company_id, table_key, code) do nothing;

create table if not exists public.vouchers (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete restrict,
  number             text not null,
  contact_id         uuid references public.contacts(id) on delete set null,
  amount             numeric(14,2) not null check (amount > 0),
  valid_from         date not null default current_date,
  valid_until        date not null,
  status             text not null default 'actif' check (status in ('actif', 'utilise', 'annule')),
  origin             text not null default 'geste' check (origin in ('vente', 'geste', 'avoir', 'autre')),
  source_document_id uuid references public.documents(id) on delete set null,
  note               text,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  cancelled_at       timestamptz,
  cancelled_by       uuid references auth.users(id) on delete set null,
  cancel_reason      text,
  unique (company_id, number),
  check (valid_until >= valid_from)
);
create index if not exists idx_vouchers_contact on public.vouchers(contact_id);
create index if not exists idx_vouchers_company on public.vouchers(company_id, created_at desc);

drop trigger if exists trg_vouchers_audit on public.vouchers;
create trigger trg_vouchers_audit after insert or update or delete on public.vouchers
  for each row execute function public.audit_row();

alter table public.vouchers enable row level security;
revoke all on public.vouchers from anon;
revoke insert, update, delete on public.vouchers from authenticated;
grant select on public.vouchers to authenticated;
drop policy if exists vouchers_select on public.vouchers;
create policy vouchers_select on public.vouchers for select to authenticated using (public.is_member(company_id));

alter table public.document_payments
  add column if not exists voucher_id uuid references public.vouchers(id) on delete restrict;
create index if not exists idx_docpay_voucher on public.document_payments(voucher_id) where voucher_id is not null;

-- Solde d un bon : montant - reglements percus qui le designent (contre-passations comprises).
create or replace function public._voucher_remaining(_voucher uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select round(v.amount - coalesce((select sum(p.amount) from public.document_payments p
                                     where p.voucher_id = v.id and p.status = 'recu'), 0), 2)
    from public.vouchers v where v.id = _voucher;
$$;
revoke all on function public._voucher_remaining(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Controle d un reglement par bon d achat.
-- ---------------------------------------------------------------------
create or replace function public.document_payments_voucher_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _v record; _company uuid; _orig record; _rem numeric;
begin
  -- Contre-passation (colonne `reversal_of` de 20261103170000, lue sans en dependre) : meme bon.
  if new.voucher_id is null and (to_jsonb(new)->>'reversal_of') is not null then
    select voucher_id into new.voucher_id from public.document_payments where id = (to_jsonb(new)->>'reversal_of')::uuid;
  end if;
  if new.method <> 'BA' and new.voucher_id is null then return new; end if;
  if new.method = 'BA' and new.voucher_id is null then
    raise exception 'Reglement par bon d achat : choisissez le bon utilise.' using errcode = '23514';
  end if;
  if new.method <> 'BA' then
    raise exception 'Un bon d achat se regle avec le mode BA (Bon d achat).' using errcode = '23514';
  end if;
  if new.status <> 'recu' then
    raise exception 'Un bon d achat s utilise comptant (pas a echeance).' using errcode = '23514';
  end if;
  select company_id into _company from public.documents where id = new.document_id;
  select * into _v from public.vouchers where id = new.voucher_id for update;
  if _v.id is null or _v.company_id <> _company then
    raise exception 'Bon d achat introuvable pour cette societe.' using errcode = '23514';
  end if;
  if new.amount > 0 then
    if _v.status = 'annule' then raise exception 'Le bon % est annule.', _v.number using errcode = '23514'; end if;
    if current_date < _v.valid_from then raise exception 'Le bon % n est valable qu a partir du %.', _v.number, _v.valid_from using errcode = '23514'; end if;
    if current_date > _v.valid_until then raise exception 'Le bon % a expire le %.', _v.number, _v.valid_until using errcode = '23514'; end if;
    _rem := public._voucher_remaining(_v.id);
    if new.amount > _rem + 0.005 then
      raise exception 'Le bon % n a plus que % EUR de solde.', _v.number, _rem using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.document_payments_voucher_guard() from public, anon, authenticated;
drop trigger if exists trg_document_payments_voucher on public.document_payments;
create trigger trg_document_payments_voucher before insert on public.document_payments
  for each row execute function public.document_payments_voucher_guard();

-- Statut du bon apres un reglement (utilise a solde nul, actif sinon ; annule ne bouge pas).
create or replace function public.document_payments_voucher_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _rem numeric;
begin
  if new.voucher_id is null then return new; end if;
  _rem := public._voucher_remaining(new.voucher_id);
  update public.vouchers
     set status = case when _rem <= 0.005 then 'utilise' else 'actif' end
   where id = new.voucher_id and status <> 'annule'
     and status is distinct from (case when _rem <= 0.005 then 'utilise' else 'actif' end);
  return new;
end $$;
revoke all on function public.document_payments_voucher_status() from public, anon, authenticated;
drop trigger if exists trg_document_payments_voucher_status on public.document_payments;
create trigger trg_document_payments_voucher_status after insert on public.document_payments
  for each row execute function public.document_payments_voucher_status();

-- ---------------------------------------------------------------------
-- Creer / annuler / lister.
-- ---------------------------------------------------------------------
create or replace function public.voucher_create(
  _company uuid, _amount numeric, _contact uuid default null, _valid_from date default null,
  _valid_until date default null, _origin text default 'geste', _note text default null,
  _source_document uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare _days int := 365; _min numeric := 0; _id uuid; _from date; _until date; _num text;
begin
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Acces refuse' using errcode = '42501'; end if;
  select coalesce(voucher_validity_days, 365), coalesce(voucher_min_amount, 0) into _days, _min
    from public.receivable_settings where company_id = _company;
  _days := coalesce(_days, 365); _min := coalesce(_min, 0);
  _amount := round(coalesce(_amount, 0), 2);
  if _amount <= 0 then raise exception 'Le montant du bon doit etre positif.' using errcode = '23514'; end if;
  if _amount < _min then raise exception 'Montant minimum d un bon d achat : % EUR.', _min using errcode = '23514'; end if;
  if _contact is not null and not exists (select 1 from public.contacts where id = _contact and company_id = _company) then
    raise exception 'Client introuvable pour cette societe.' using errcode = '23514';
  end if;
  if coalesce(_origin, 'geste') not in ('vente', 'geste', 'avoir', 'autre') then raise exception 'Origine inconnue : %', _origin using errcode = '23514'; end if;
  _from := coalesce(_valid_from, current_date);
  _until := coalesce(_valid_until, _from + _days);
  if _until < _from then raise exception 'La date d expiration precede la date de debut.' using errcode = '23514'; end if;
  _num := public.next_document_number(_company, 'BA');
  insert into public.vouchers (company_id, number, contact_id, amount, valid_from, valid_until, origin, note, source_document_id, created_by)
  values (_company, _num, _contact, _amount, _from, _until, coalesce(_origin, 'geste'), nullif(btrim(_note), ''), _source_document, auth.uid())
  returning id into _id;
  return _id;
end $$;
revoke all on function public.voucher_create(uuid, numeric, uuid, date, date, text, text, uuid) from public, anon;
grant execute on function public.voucher_create(uuid, numeric, uuid, date, date, text, text, uuid) to authenticated;

create or replace function public.voucher_cancel(_voucher uuid, _reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _v record;
begin
  if coalesce(btrim(_reason), '') = '' then raise exception 'Le motif est obligatoire.' using errcode = '23514'; end if;
  select * into _v from public.vouchers where id = _voucher for update;
  if _v.id is null then raise exception 'Bon introuvable' using errcode = '23514'; end if;
  if auth.uid() is not null and not public.is_member(_v.company_id) then raise exception 'Acces refuse' using errcode = '42501'; end if;
  if _v.status = 'annule' then return; end if;
  if exists (select 1 from public.document_payments where voucher_id = _voucher and status = 'recu') then
    raise exception 'Le bon % a deja servi : il ne s annule plus (contre-passez le reglement d abord).', _v.number using errcode = '23514';
  end if;
  update public.vouchers set status = 'annule', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(_reason) where id = _voucher;
end $$;
revoke all on function public.voucher_cancel(uuid, text) from public, anon;
grant execute on function public.voucher_cancel(uuid, text) to authenticated;

-- _status : null = tous ; 'actif' | 'utilise' | 'annule' | 'expire' (statut effectif).
create or replace function public.vouchers_list(_company uuid, _status text default null, _contact uuid default null)
returns table(
  id uuid, number text, contact_id uuid, contact_code text, contact_name text, email text, mobile text,
  amount numeric, remaining numeric, valid_from date, valid_until date, status text, effective_status text,
  origin text, note text, created_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  select * from (
    select v.id, v.number, v.contact_id, c.code::text as contact_code,
           coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')) as contact_name,
           coalesce(nullif(btrim(c.email), ''), nullif(btrim(c.email_pro), '')) as email,
           coalesce(nullif(btrim(c.mobile), ''), nullif(btrim(c.gsm), '')) as mobile,
           v.amount, public._voucher_remaining(v.id) as remaining, v.valid_from, v.valid_until, v.status,
           case when v.status = 'actif' and v.valid_until < current_date then 'expire' else v.status end as eff,
           v.origin, v.note, v.created_at
      from public.vouchers v left join public.contacts c on c.id = v.contact_id
     where v.company_id = _company and (auth.uid() is null or public.is_member(_company))
       and (_contact is null or v.contact_id = _contact)
  ) x
   where _status is null or x.eff = _status
   order by x.created_at desc;
$$;
revoke all on function public.vouchers_list(uuid, text, uuid) from public, anon;
grant execute on function public.vouchers_list(uuid, text, uuid) to authenticated;
