-- =====================================================================
-- M12 — RATTRAPAGE G8 « ENCAISSEMENTS » (18/11/2026), 4/5 : REMISES DE PRELEVEMENTS SEPA
-- Ref. G8 : Encaissements > Gestion des L.C.R., traites et prelevements (Nouvelle remise / Remises
-- en attente ou archivees ; Prelevements (SEPA) ; banque, BIC, IBAN, ICS ; echeances du ... au ... ;
-- client ; selection ligne / totale ; montant total). LCR au format CFON : sans objet en Belgique.
-- Reutilise l export existant (`src/modules/accounting/sepa.ts`, pain.008.001.02, mandats
-- `sepa_mandates` de 20260612180000). Comparaison section 2 : l export actuel part avec un ICS
-- FACTICE (`BE00ZZZ...`) quand la societe n en a pas, et enregistre l encaissement DES LA
-- GENERATION du fichier, avant que la banque n ait preleve.
--
-- NOUVEAU CIRCUIT
--   1. Candidats : echeances ATTENDUES en mode DOM (echeancier de 20261118170000) et factures
--      ouvertes non echelonnees, de clients ayant un mandat ACTIF, echeance dans la periode.
--   2. « Nouvelle remise » (`sepa_batch_create`) : refusee sans ICS / IBAN de la societe ; une facture
--      non echelonnee recoit une echeance DOM attendue (date de prelevement) ; chaque echeance entre
--      dans UNE seule remise vivante. La remise est EN ATTENTE ; le fichier pain.008 est construit
--      par l ecran et range sur la remise (`sepa_batch_set_xml`, re-telechargeable).
--   3. « Archiver » (`sepa_batch_archive`) = la banque a preleve : les echeances passent en PERCU
--      (encaissement a cette date), les mandats FRST passent en RCUR.
--   4. « Annuler la remise » (en attente seulement, motif) : les echeances creees par la remise sont
--      annulees, les autres redeviennent disponibles.
--   5. Impaye apres archivage (`sepa_item_unpaid`) : contre-passation motivee de l echeance
--      (meme mode, montant inverse, `reversal_of`, 20261103170000) ; la facture revient en du.
--
-- Idempotente. NON APPLIQUEE. Suppose le bloc du 03/11 (170000 : `reversal_of`) et 20261118170000.
-- =====================================================================

create table if not exists public.sepa_batches (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete restrict,
  reference       text not null,                   -- MsgId du fichier pain.008
  status          text not null default 'en_attente' check (status in ('en_attente', 'archivee', 'annulee')),
  collection_date date not null,
  total           numeric(14,2) not null default 0,
  tx_count        int not null default 0,
  creditor_name   text,
  creditor_id     text not null,                   -- ICS
  creditor_iban   text not null,
  creditor_bic    text,
  xml             text,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  archived_at     timestamptz,
  archived_by     uuid references auth.users(id) on delete set null,
  cancelled_at    timestamptz,
  cancelled_by    uuid references auth.users(id) on delete set null,
  cancel_reason   text,
  unique (company_id, reference)
);
create index if not exists idx_sepa_batches_company on public.sepa_batches(company_id, created_at desc);

create table if not exists public.sepa_batch_items (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references public.sepa_batches(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete restrict,
  payment_id      uuid not null references public.document_payments(id) on delete restrict,
  document_id     uuid not null references public.documents(id) on delete restrict,
  contact_id      uuid references public.contacts(id) on delete set null,
  mandate_id      uuid references public.sepa_mandates(id) on delete set null,
  mandate_ref     text not null,
  iban            text not null,
  bic             text,
  signature_date  date not null,
  seq_type        text not null default 'RCUR',
  debtor_name     text,
  document_number text,
  amount          numeric(14,2) not null check (amount > 0),
  end_to_end_id   text not null,
  created_payment boolean not null default false,   -- echeance creee par la remise (facture non echelonnee)
  status          text not null default 'en_attente' check (status in ('en_attente', 'encaisse', 'impaye', 'annule')),
  unpaid_reason   text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_sepa_items_batch on public.sepa_batch_items(batch_id);
create unique index if not exists sepa_items_live_payment_uq on public.sepa_batch_items(payment_id)
  where status in ('en_attente', 'encaisse');

drop trigger if exists trg_sepa_batches_audit on public.sepa_batches;
create trigger trg_sepa_batches_audit after insert or update or delete on public.sepa_batches
  for each row execute function public.audit_row();
drop trigger if exists trg_sepa_items_audit on public.sepa_batch_items;
create trigger trg_sepa_items_audit after insert or update or delete on public.sepa_batch_items
  for each row execute function public.audit_row();

alter table public.sepa_batches enable row level security;
alter table public.sepa_batch_items enable row level security;
revoke all on public.sepa_batches, public.sepa_batch_items from anon;
revoke insert, update, delete on public.sepa_batches, public.sepa_batch_items from authenticated;
grant select on public.sepa_batches, public.sepa_batch_items to authenticated;
drop policy if exists sepa_batches_select on public.sepa_batches;
create policy sepa_batches_select on public.sepa_batches for select to authenticated using (public.is_member(company_id));
drop policy if exists sepa_items_select on public.sepa_batch_items;
create policy sepa_items_select on public.sepa_batch_items for select to authenticated using (public.is_member(company_id));

-- Mandat actif le plus recent d un client.
create or replace function public._active_mandate(_contact uuid)
returns public.sepa_mandates language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.sepa_mandates where contact_id = _contact and status = 'active' order by signature_date desc, created_at desc limit 1;
$$;
revoke all on function public._active_mandate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Candidats a une remise.
-- ---------------------------------------------------------------------
create or replace function public.sepa_collectable_installments(
  _company uuid, _due_from date default null, _due_to date default null, _contact uuid default null
) returns table(
  kind text, payment_id uuid, document_id uuid, number text, due_date date, contact_id uuid, contact_name text,
  amount numeric, mandate_ref text, iban text, bic text, seq_type text, installment_no int
)
language sql stable security definer set search_path = public, pg_temp as $$
  with ok as (select auth.uid() is null or public.is_member(_company) as allowed)
  -- a) echeances DOM attendues, hors remise vivante
  select 'installment'::text, p.id, d.id, d.number, p.due_date, c.id,
         coalesce(nullif(btrim(c.company_name), ''), btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))),
         p.amount, m.mandate_ref, m.iban, m.bic, m.seq_type, p.installment_no
    from public.document_payments p
    join public.documents d on d.id = p.document_id
    join public.contacts c on c.id = d.contact_id
    cross join lateral (select * from public._active_mandate(c.id)) m
   where (select allowed from ok) and d.company_id = _company and m.id is not null
     and p.status = 'attendu' and p.method = 'DOM' and p.amount > 0
     and d.status not in ('brouillon', 'annulee', 'converti')
     and (_due_from is null or p.due_date >= _due_from)
     and (_due_to is null or p.due_date <= _due_to)
     and (_contact is null or c.id = _contact)
     and not exists (select 1 from public.sepa_batch_items i where i.payment_id = p.id and i.status in ('en_attente', 'encaisse'))
  union all
  -- b) factures ouvertes non echelonnees (reste du - echeances deja prevues)
  select 'invoice'::text, null::uuid, d.id, d.number, coalesce(d.due_date, d.issue_date), c.id,
         coalesce(nullif(btrim(c.company_name), ''), btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))),
         round(d.total_ttc - d.paid_amount - coalesce((select sum(p.amount) from public.document_payments p where p.document_id = d.id and p.status = 'attendu'), 0), 2),
         m.mandate_ref, m.iban, m.bic, m.seq_type, null::int
    from public.documents d
    join public.contacts c on c.id = d.contact_id
    cross join lateral (select * from public._active_mandate(c.id)) m
   where (select allowed from ok) and d.company_id = _company and m.id is not null
     and d.doc_type in ('FAC', 'FAA') and d.status not in ('brouillon', 'annulee', 'converti', 'avoir_emis')
     and (_due_from is null or coalesce(d.due_date, d.issue_date) >= _due_from)
     and (_due_to is null or coalesce(d.due_date, d.issue_date) <= _due_to)
     and (_contact is null or c.id = _contact)
     and d.total_ttc - d.paid_amount - coalesce((select sum(p.amount) from public.document_payments p where p.document_id = d.id and p.status = 'attendu'), 0) > 0.005
   order by 5 nulls first, 4;
$$;
revoke all on function public.sepa_collectable_installments(uuid, date, date, uuid) from public, anon;
grant execute on function public.sepa_collectable_installments(uuid, date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Nouvelle remise (en attente).
-- ---------------------------------------------------------------------
create or replace function public.sepa_batch_create(
  _company uuid, _collection_date date, _payments uuid[] default '{}', _documents uuid[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare _co record; _bid uuid; _ref text; _p record; _d record; _m public.sepa_mandates; _open numeric; _pid uuid; _created uuid[] := '{}'; _n int := 0; _tot numeric := 0;
begin
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Acces refuse' using errcode = '42501'; end if;
  select id, name, legal_name, iban, bic, sepa_creditor_id into _co from public.companies where id = _company;
  if coalesce(btrim(_co.sepa_creditor_id), '') = '' then
    raise exception 'Identifiant creancier SEPA (ICS) de la societe manquant : renseignez-le avant de creer une remise.' using errcode = '23514';
  end if;
  if coalesce(btrim(_co.iban), '') = '' then
    raise exception 'IBAN de la societe manquant : renseignez-le avant de creer une remise.' using errcode = '23514';
  end if;
  if _collection_date is null or _collection_date < current_date then
    raise exception 'La date de prelevement doit etre aujourd hui ou plus tard.' using errcode = '23514';
  end if;
  if coalesce(array_length(_payments, 1), 0) + coalesce(array_length(_documents, 1), 0) = 0 then
    raise exception 'Aucune ligne selectionnee.' using errcode = '23514';
  end if;

  _ref := 'SDD-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' || left(replace(_company::text, '-', ''), 6);
  insert into public.sepa_batches (company_id, reference, collection_date, creditor_name, creditor_id, creditor_iban, creditor_bic, created_by)
  values (_company, _ref, _collection_date, coalesce(nullif(btrim(_co.legal_name), ''), _co.name), btrim(_co.sepa_creditor_id),
          replace(_co.iban, ' ', ''), nullif(btrim(_co.bic), ''), auth.uid())
  returning id into _bid;

  -- Factures non echelonnees : une echeance DOM attendue a la date de prelevement.
  for _d in select * from public.documents where id = any(coalesce(_documents, '{}')) loop
    if _d.company_id <> _company then raise exception 'Document d une autre societe.' using errcode = '42501'; end if;
    if _d.doc_type not in ('FAC', 'FAA') or _d.status in ('brouillon', 'annulee', 'converti', 'avoir_emis') then
      raise exception 'Le document % ne se preleve pas (type %, statut %).', coalesce(_d.number, '-'), _d.doc_type, _d.status using errcode = '23514';
    end if;
    _open := round(_d.total_ttc - _d.paid_amount - coalesce((select sum(amount) from public.document_payments where document_id = _d.id and status = 'attendu'), 0), 2);
    if _open <= 0.005 then raise exception 'Le document % n a plus de reste a prelever.', coalesce(_d.number, '-') using errcode = '23514'; end if;
    insert into public.document_payments (document_id, method, amount, status, due_date, note)
    values (_d.id, 'DOM', _open, 'attendu', _collection_date, 'Prelevement SEPA ' || _ref)
    returning id into _pid;
    _payments := coalesce(_payments, '{}') || _pid;
    _created := _created || _pid;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
    values (_company, auth.uid(), 'sepa_installment_created', 'documents', _d.id::text, 'screen', jsonb_build_object('payment_id', _pid, 'amount', _open, 'batch', _ref));
  end loop;

  for _p in
    select p.*, d.company_id as co, d.contact_id, d.number as doc_number,
           coalesce(nullif(btrim(c.company_name), ''), btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))) as debtor
      from public.document_payments p join public.documents d on d.id = p.document_id
      left join public.contacts c on c.id = d.contact_id
     where p.id = any(_payments)
  loop
    if _p.co <> _company then raise exception 'Reglement d une autre societe.' using errcode = '42501'; end if;
    if _p.status <> 'attendu' or _p.method <> 'DOM' or _p.amount <= 0 then
      raise exception 'L echeance du % (% EUR) n est pas une domiciliation en attente.', coalesce(_p.due_date::text, '-'), _p.amount using errcode = '23514';
    end if;
    if exists (select 1 from public.sepa_batch_items i where i.payment_id = _p.id and i.status in ('en_attente', 'encaisse')) then
      raise exception 'L echeance de % est deja dans une remise.', coalesce(_p.doc_number, '-') using errcode = '23514';
    end if;
    _m := public._active_mandate(_p.contact_id);
    if _m.id is null then raise exception 'Le client de % n a pas de mandat SEPA actif.', coalesce(_p.doc_number, '-') using errcode = '23514'; end if;
    _n := _n + 1; _tot := _tot + _p.amount;
    insert into public.sepa_batch_items (batch_id, company_id, payment_id, document_id, contact_id, mandate_id, mandate_ref, iban, bic,
                                         signature_date, seq_type, debtor_name, document_number, amount, end_to_end_id, created_payment)
    values (_bid, _company, _p.id, _p.document_id, _p.contact_id, _m.id, _m.mandate_ref, replace(_m.iban, ' ', ''), nullif(btrim(_m.bic), ''),
            _m.signature_date, coalesce(nullif(_m.seq_type, ''), 'RCUR'), _p.debtor, _p.doc_number, _p.amount,
            left(coalesce(_p.doc_number, 'DOC') || '-' || coalesce(_p.installment_no::text, '1') || '-' || left(replace(_p.id::text, '-', ''), 8), 35),
            _p.id = any(_created));
  end loop;
  update public.sepa_batches set total = round(_tot, 2), tx_count = _n where id = _bid;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, auth.uid(), 'sepa_batch_created', 'sepa_batches', _bid::text, 'screen',
          jsonb_build_object('reference', _ref, 'collection_date', _collection_date, 'count', _n, 'total', round(_tot, 2)));
  return _bid;
end $$;
revoke all on function public.sepa_batch_create(uuid, date, uuid[], uuid[]) from public, anon;
grant execute on function public.sepa_batch_create(uuid, date, uuid[], uuid[]) to authenticated;

-- Fichier pain.008 construit par l ecran, range sur la remise (tant qu elle est en attente).
create or replace function public.sepa_batch_set_xml(_batch uuid, _xml text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _b record;
begin
  select * into _b from public.sepa_batches where id = _batch;
  if _b.id is null then raise exception 'Remise introuvable' using errcode = '23514'; end if;
  if auth.uid() is not null and not public.is_member(_b.company_id) then raise exception 'Acces refuse' using errcode = '42501'; end if;
  if _b.status <> 'en_attente' then raise exception 'Remise %, son fichier ne change plus.', _b.status using errcode = '23514'; end if;
  if coalesce(_xml, '') !~ 'pain\.008' then raise exception 'Fichier pain.008 attendu.' using errcode = '23514'; end if;
  update public.sepa_batches set xml = _xml where id = _batch;
end $$;
revoke all on function public.sepa_batch_set_xml(uuid, text) from public, anon;
grant execute on function public.sepa_batch_set_xml(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Archiver = preleve par la banque : encaissement des echeances.
-- ---------------------------------------------------------------------
create or replace function public.sepa_batch_archive(_batch uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _b record; _i record;
begin
  select * into _b from public.sepa_batches where id = _batch for update;
  if _b.id is null then raise exception 'Remise introuvable' using errcode = '23514'; end if;
  if auth.uid() is not null and not public.is_member(_b.company_id) then raise exception 'Acces refuse' using errcode = '42501'; end if;
  if _b.status <> 'en_attente' then raise exception 'Seule une remise en attente s archive (statut %).', _b.status using errcode = '23514'; end if;
  for _i in select * from public.sepa_batch_items where batch_id = _batch and status = 'en_attente' loop
    update public.document_payments set status = 'recu', note = coalesce(note, '') || case when coalesce(note, '') = '' then '' else ' · ' end || 'Remise ' || _b.reference
     where id = _i.payment_id and status = 'attendu';
    update public.sepa_batch_items set status = 'encaisse' where id = _i.id;
    perform public._recompute_paid_unchecked(_i.document_id);
    update public.sepa_mandates set seq_type = 'RCUR' where id = _i.mandate_id and seq_type = 'FRST';
  end loop;
  update public.sepa_batches set status = 'archivee', archived_at = now(), archived_by = auth.uid() where id = _batch;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_b.company_id, auth.uid(), 'sepa_batch_archived', 'sepa_batches', _batch::text, 'screen', jsonb_build_object('reference', _b.reference, 'total', _b.total));
end $$;
revoke all on function public.sepa_batch_archive(uuid) from public, anon;
grant execute on function public.sepa_batch_archive(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Annuler une remise en attente.
-- ---------------------------------------------------------------------
create or replace function public.sepa_batch_cancel(_batch uuid, _reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _b record; _i record;
begin
  if coalesce(btrim(_reason), '') = '' then raise exception 'Le motif est obligatoire.' using errcode = '23514'; end if;
  select * into _b from public.sepa_batches where id = _batch for update;
  if _b.id is null then raise exception 'Remise introuvable' using errcode = '23514'; end if;
  if auth.uid() is not null and not public.is_member(_b.company_id) then raise exception 'Acces refuse' using errcode = '42501'; end if;
  if _b.status <> 'en_attente' then raise exception 'Seule une remise en attente s annule (statut %).', _b.status using errcode = '23514'; end if;
  for _i in select * from public.sepa_batch_items where batch_id = _batch and status = 'en_attente' loop
    update public.sepa_batch_items set status = 'annule' where id = _i.id;
    if _i.created_payment then
      update public.document_payments set status = 'annule', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(_reason)
       where id = _i.payment_id and status = 'attendu';
    end if;
  end loop;
  update public.sepa_batches set status = 'annulee', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(_reason) where id = _batch;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_b.company_id, auth.uid(), 'sepa_batch_cancelled', 'sepa_batches', _batch::text, 'screen', jsonb_build_object('reference', _b.reference, 'reason', btrim(_reason)));
end $$;
revoke all on function public.sepa_batch_cancel(uuid, text) from public, anon;
grant execute on function public.sepa_batch_cancel(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Impaye (rejet bancaire) d une ligne encaissee : contre-passation motivee.
-- ---------------------------------------------------------------------
create or replace function public.sepa_item_unpaid(_item uuid, _reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _i record; _pay record;
begin
  if coalesce(btrim(_reason), '') = '' then raise exception 'Le motif est obligatoire.' using errcode = '23514'; end if;
  select * into _i from public.sepa_batch_items where id = _item for update;
  if _i.id is null then raise exception 'Ligne introuvable' using errcode = '23514'; end if;
  if auth.uid() is not null and not public.is_member(_i.company_id) then raise exception 'Acces refuse' using errcode = '42501'; end if;
  if _i.status <> 'encaisse' then raise exception 'Seule une ligne encaissee passe en impaye (statut %).', _i.status using errcode = '23514'; end if;
  select * into _pay from public.document_payments where id = _i.payment_id;
  insert into public.document_payments (document_id, method, amount, status, note, reversal_of)
  values (_pay.document_id, _pay.method, -_pay.amount, 'recu', 'Impaye domiciliation SEPA : ' || btrim(_reason), _pay.id);
  update public.sepa_batch_items set status = 'impaye', unpaid_reason = btrim(_reason) where id = _item;
  perform public._recompute_paid_unchecked(_pay.document_id);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_i.company_id, auth.uid(), 'sepa_item_unpaid', 'documents', _pay.document_id::text, 'screen',
          jsonb_build_object('item', _item, 'amount', _pay.amount, 'reason', btrim(_reason)));
end $$;
revoke all on function public.sepa_item_unpaid(uuid, text) from public, anon;
grant execute on function public.sepa_item_unpaid(uuid, text) to authenticated;
