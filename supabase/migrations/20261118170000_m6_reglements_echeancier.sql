-- =====================================================================
-- M6 — RATTRAPAGE G8 « ENCAISSEMENTS » (18/11/2026), 1/5 : REGLEMENTS ET ECHEANCIER
-- Ref. G8 : Facturation > pied de facture (grille Encaissements : n° de cheque, etablissement payeur,
-- « Calculer sur 12 echeances automatique »), Encaissements > Gestion des encaissements (Annuler
-- echeances, Encaissements a echeances), Encaissements > Cheques a echeance (liste par client et
-- periode, « liste etablie a la date du », Modifier cet encaissement, Encaissement immediat).
-- Inventaire : docs/g8-inventaire/06-ventes-caisse.md ; comparaison section 2, bloquant #12.
--
-- SUPPOSE APPLIQUE le bloc factures / reglements du 03/11 (20261103150000 -> 20261103260000) :
-- le garde `document_payments_cash_guard` (170000) laisse modifier un reglement ATTENDU (echeance,
-- banque, n° de cheque) mais jamais son montant, son mode ou son document ; « attendu -> recu »
-- (encaissement immediat) pose la date du jour et la caisse ouverte ; « attendu -> annule » est permis.
--
-- CE QUE POSE CETTE MIGRATION
--   1. Modes de reglement manquants : CHQ « Cheque » (G8 : n° de cheque + etablissement payeur) et
--      DOM « Domiciliation SEPA » (deja ecrit par `record_sepa_collection`, jamais declare).
--   2. `document_payments` : `cheque_number`, `bank_name` (etablissement payeur), `schedule_id`,
--      `installment_no`, `cancelled_at`, `cancelled_by`, `cancel_reason` (annulation tracee).
--   3. `payment_schedules` : un echeancier « en N fois » (12 par defaut chez G8) = N reglements
--      ATTENDUS dates (mois apres mois), le client reste debiteur jusqu a chaque encaissement.
--      Repartition : montant / N arrondi au cent INFERIEUR, le reliquat (quelques cents) sur la
--      PREMIERE echeance. Meme regle en TypeScript (`src/modules/receivables/schedule.ts`, teste).
--   4. `payment_schedule_create` (membre) : cree l echeancier, refuse un total superieur au reste
--      du document (deja percu et echeances en cours deduits) ; n° de cheque numerique incremente.
--   5. `payment_deferred_update` (membre) : « Modifier cet encaissement » (echeance, banque, n°).
--   6. `payment_installments_cancel` (membre) : « Annuler echeances », motif obligatoire, statut
--      `annule` + qui / quand / pourquoi, trace `events` (rien n est efface).
--   7. `deferred_payments_list` (membre) : liste des cheques / echeances a venir par client et
--      periode, « etablie a la date du » (echu = echeance anterieure a cette date).
--
-- Idempotente. NON APPLIQUEE (Simon applique en bloc). Essai a blanc : supabase/tests/m6_encaissements_g8.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Modes de reglement CHQ et DOM (par societe, sans ecraser un libelle deja regle).
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select c.id, 'payment_method', m.code, m.label, m.sort_order, true, m.extra
  from public.companies c
 cross join (values
   ('CHQ', 'Cheque', 9, '{"visible_pos": true, "needs_cheque": true}'::jsonb),
   ('DOM', 'Domiciliation SEPA', 92, '{"visible_pos": false}'::jsonb)
 ) as m(code, label, sort_order, extra)
on conflict (company_id, table_key, code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Echeancier (avant les colonnes qui le referencent).
-- ---------------------------------------------------------------------
create table if not exists public.payment_schedules (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete restrict,
  document_id         uuid not null references public.documents(id) on delete cascade,
  method              text not null,
  installments        int  not null check (installments between 1 and 60),
  interval_months     int  not null default 1 check (interval_months between 1 and 12),
  first_due_date      date not null,
  total               numeric(14,2) not null check (total > 0),
  bank_name           text,
  first_cheque_number text,
  status              text not null default 'actif' check (status in ('actif', 'annule')),
  created_by          uuid references auth.users(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now()
);
create index if not exists idx_payment_schedules_document on public.payment_schedules(document_id);
create index if not exists idx_payment_schedules_company on public.payment_schedules(company_id, created_at desc);
comment on table public.payment_schedules is
  'G8 « Calculer sur 12 echeances automatique » : echeancier en N fois d un document (N reglements attendus dates).';

drop trigger if exists trg_payment_schedules_audit on public.payment_schedules;
create trigger trg_payment_schedules_audit after insert or update or delete on public.payment_schedules
  for each row execute function public.audit_row();

alter table public.payment_schedules enable row level security;
revoke all on public.payment_schedules from anon;
revoke insert, update, delete on public.payment_schedules from authenticated;
grant select on public.payment_schedules to authenticated;
drop policy if exists payment_schedules_select on public.payment_schedules;
create policy payment_schedules_select on public.payment_schedules for select to authenticated
  using (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- 3. Colonnes des reglements.
-- ---------------------------------------------------------------------
alter table public.document_payments
  add column if not exists cheque_number  text,
  add column if not exists bank_name      text,
  add column if not exists schedule_id    uuid references public.payment_schedules(id) on delete set null,
  add column if not exists installment_no int,
  add column if not exists cancelled_at   timestamptz,
  add column if not exists cancelled_by   uuid references auth.users(id) on delete set null,
  add column if not exists cancel_reason  text;
create index if not exists idx_docpay_schedule on public.document_payments(schedule_id) where schedule_id is not null;
create index if not exists idx_docpay_deferred on public.document_payments(due_date) where status = 'attendu';
comment on column public.document_payments.cheque_number is 'G8 : n° de cheque (ou de traite).';
comment on column public.document_payments.bank_name is 'G8 : etablissement payeur (banque du client).';

-- ---------------------------------------------------------------------
-- 4. Regles pures de l echeancier (memes regles que src/modules/receivables/schedule.ts).
-- ---------------------------------------------------------------------
-- Montant de l echeance n (1..N) : total / N arrondi au cent inferieur ; reliquat sur la 1re.
create or replace function public._installment_amount(_total numeric, _count int, _n int)
returns numeric language sql immutable as $$
  select case
    when _n = 1 then round(_total - (_count - 1) * (floor(_total * 100 / _count) / 100), 2)
    else floor(_total * 100 / _count) / 100
  end;
$$;

-- Echeance n : premiere echeance + (n - 1) x intervalle, calcule depuis la PREMIERE date (pas de
-- glissement de fin de mois : 31/01 -> 28/02 -> 31/03).
create or replace function public._installment_due(_first date, _interval_months int, _n int)
returns date language sql immutable as $$
  select (_first + make_interval(months => (_n - 1) * _interval_months))::date;
$$;

-- N° de cheque de l echeance n : numerique -> incremente (zeros de tete gardes) ; sinon 1re seulement.
create or replace function public._installment_cheque(_first text, _n int)
returns text language sql immutable as $$
  select case
    when _first is null or btrim(_first) = '' then null
    when btrim(_first) ~ '^[0-9]{1,18}$' then lpad((btrim(_first)::numeric + _n - 1)::text, length(btrim(_first)), '0')
    when _n = 1 then btrim(_first)
    else null
  end;
$$;

-- ---------------------------------------------------------------------
-- 5. Creer un echeancier.
-- ---------------------------------------------------------------------
create or replace function public.payment_schedule_create(
  _document uuid, _total numeric, _count int, _first_due date, _method text,
  _interval_months int default 1, _bank text default null, _first_cheque text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare _d record; _open numeric; _pending numeric; _sid uuid; _i int;
begin
  select id, company_id, doc_type, status, number, total_ttc, paid_amount into _d from public.documents where id = _document;
  if _d.id is null then raise exception 'Document introuvable' using errcode = '23514'; end if;
  if auth.uid() is not null and not public.is_member(_d.company_id) then raise exception 'Acces refuse' using errcode = '42501'; end if;
  if _d.status in ('brouillon', 'annulee', 'converti', 'avoir_emis') then
    raise exception 'Echeancier impossible : le document % n est pas ouvert (statut %).', coalesce(_d.number, '-'), _d.status using errcode = '23514';
  end if;
  if _d.doc_type not in ('FAC', 'TIK', 'FAA', 'BC', 'RES', 'BL') then
    raise exception 'Echeancier impossible sur un document de type %.', _d.doc_type using errcode = '23514';
  end if;
  if _count is null or _count < 1 or _count > 60 then raise exception 'Nombre d echeances : entre 1 et 60.' using errcode = '23514'; end if;
  if coalesce(_interval_months, 0) < 1 or _interval_months > 12 then raise exception 'Intervalle : entre 1 et 12 mois.' using errcode = '23514'; end if;
  if _first_due is null then raise exception 'La date de la premiere echeance est obligatoire.' using errcode = '23514'; end if;
  if coalesce(btrim(_method), '') = '' then raise exception 'Le mode de reglement est obligatoire.' using errcode = '23514'; end if;
  _total := round(coalesce(_total, 0), 2);
  if _total <= 0 then raise exception 'Le montant a echelonner doit etre positif.' using errcode = '23514'; end if;
  if _total < _count * 0.01 then raise exception 'Montant trop faible pour % echeances.', _count using errcode = '23514'; end if;

  select coalesce(sum(amount), 0) into _pending from public.document_payments where document_id = _document and status = 'attendu';
  _open := round(_d.total_ttc - _d.paid_amount - _pending, 2);
  if _total > _open + 0.005 then
    raise exception 'Le montant a echelonner (% EUR) depasse le reste a payer du document (% EUR, echeances deja prevues deduites).', _total, _open using errcode = '23514';
  end if;

  insert into public.payment_schedules (company_id, document_id, method, installments, interval_months, first_due_date, total, bank_name, first_cheque_number, created_by)
  values (_d.company_id, _document, btrim(_method), _count, _interval_months, _first_due, _total, nullif(btrim(_bank), ''), nullif(btrim(_first_cheque), ''), auth.uid())
  returning id into _sid;

  for _i in 1.._count loop
    insert into public.document_payments (document_id, method, amount, status, due_date, note, cheque_number, bank_name, schedule_id, installment_no)
    values (_document, btrim(_method), public._installment_amount(_total, _count, _i), 'attendu',
            public._installment_due(_first_due, _interval_months, _i),
            format('Echeance %s/%s', _i, _count),
            public._installment_cheque(_first_cheque, _i), nullif(btrim(_bank), ''), _sid, _i);
  end loop;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_d.company_id, auth.uid(), 'payment_schedule_created', 'documents', _document::text, 'screen',
          jsonb_build_object('schedule_id', _sid, 'number', _d.number, 'total', _total, 'installments', _count,
                             'first_due_date', _first_due, 'interval_months', _interval_months, 'method', _method));
  return _sid;
end $$;
revoke all on function public.payment_schedule_create(uuid, numeric, int, date, text, int, text, text) from public, anon;
grant execute on function public.payment_schedule_create(uuid, numeric, int, date, text, int, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. « Modifier cet encaissement » : echeance, banque, n° de cheque d un reglement ATTENDU.
--    Le montant, le mode et le document ne changent pas (annuler puis ressaisir).
-- ---------------------------------------------------------------------
create or replace function public.payment_deferred_update(_payment uuid, _due_date date, _bank text, _cheque text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare _p record; _company uuid;
begin
  select p.*, d.company_id as co into _p from public.document_payments p join public.documents d on d.id = p.document_id where p.id = _payment;
  if _p.id is null then raise exception 'Reglement introuvable' using errcode = '23514'; end if;
  _company := _p.co;
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Acces refuse' using errcode = '42501'; end if;
  if _p.status <> 'attendu' then
    raise exception 'Seul un reglement a echeance (attendu) se modifie ; un reglement percu s annule par contre-passation.' using errcode = '23514';
  end if;
  update public.document_payments
     set due_date = _due_date, bank_name = nullif(btrim(_bank), ''), cheque_number = nullif(btrim(_cheque), '')
   where id = _payment;
end $$;
revoke all on function public.payment_deferred_update(uuid, date, text, text) from public, anon;
grant execute on function public.payment_deferred_update(uuid, date, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. « Annuler echeances » : motif obligatoire, statut annule trace, rien n est efface.
-- ---------------------------------------------------------------------
create or replace function public.payment_installments_cancel(_payments uuid[], _reason text)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare _p record; _n int := 0; _docs uuid[] := '{}'; _sched uuid[] := '{}'; _x uuid;
begin
  if coalesce(btrim(_reason), '') = '' then raise exception 'Le motif d annulation est obligatoire.' using errcode = '23514'; end if;
  if _payments is null or array_length(_payments, 1) is null then return 0; end if;
  for _p in
    select p.id, p.document_id, p.status, p.amount, p.method, p.due_date, p.schedule_id, d.company_id, d.number
      from public.document_payments p join public.documents d on d.id = p.document_id
     where p.id = any(_payments)
  loop
    if auth.uid() is not null and not public.is_member(_p.company_id) then raise exception 'Acces refuse' using errcode = '42501'; end if;
    if _p.status <> 'attendu' then
      raise exception 'Le reglement du % (% EUR) n est pas une echeance en attente : il ne s annule pas ici.', coalesce(_p.due_date::text, '-'), _p.amount using errcode = '23514';
    end if;
    update public.document_payments
       set status = 'annule', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(_reason)
     where id = _p.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_p.company_id, auth.uid(), 'payment_installment_cancelled', 'document_payments', _p.id::text, 'screen',
            jsonb_build_object('status', 'attendu'),
            jsonb_build_object('status', 'annule', 'reason', btrim(_reason), 'document', _p.number, 'amount', _p.amount,
                               'method', _p.method, 'due_date', _p.due_date));
    _n := _n + 1;
    if not (_p.document_id = any(_docs)) then _docs := _docs || _p.document_id; end if;
    if _p.schedule_id is not null and not (_p.schedule_id = any(_sched)) then _sched := _sched || _p.schedule_id; end if;
  end loop;
  -- Echeancier dont plus aucune echeance n est attendue ni percue : annule.
  foreach _x in array _sched loop
    update public.payment_schedules s set status = 'annule'
     where s.id = _x and s.status = 'actif'
       and not exists (select 1 from public.document_payments p where p.schedule_id = _x and p.status in ('attendu', 'recu'));
  end loop;
  foreach _x in array _docs loop
    perform public._recompute_paid_unchecked(_x);
  end loop;
  return _n;
end $$;
revoke all on function public.payment_installments_cancel(uuid[], text) from public, anon;
grant execute on function public.payment_installments_cancel(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Liste des cheques / echeances a venir (G8 « Liste des cheques a echeance »).
--    _as_of : « liste etablie a la date du » ; echu = echeance < _as_of.
--    _with_done : inclut aussi les echeances deja encaissees ou annulees (historique).
-- ---------------------------------------------------------------------
create or replace function public.deferred_payments_list(
  _company uuid, _due_from date default null, _due_to date default null, _contact uuid default null,
  _as_of date default current_date, _with_done boolean default false
) returns table(
  payment_id uuid, document_id uuid, doc_type text, number text, issue_date date,
  contact_id uuid, contact_code text, contact_name text,
  method text, method_label text, due_date date, amount numeric, bank_name text, cheque_number text,
  status text, is_overdue boolean, schedule_id uuid, installment_no int, installments int,
  paid_at timestamptz, cancel_reason text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, d.id, d.doc_type, d.number, d.issue_date,
         c.id, c.code::text,
         coalesce(nullif(btrim(c.company_name), ''), btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))),
         p.method,
         coalesce((select rv.label from public.reference_values rv
                    where rv.company_id = d.company_id and rv.table_key = 'payment_method' and rv.code = p.method limit 1), p.method),
         p.due_date, p.amount, p.bank_name, p.cheque_number, p.status,
         (p.status = 'attendu' and p.due_date is not null and p.due_date < coalesce(_as_of, current_date)),
         p.schedule_id, p.installment_no, s.installments,
         case when p.status = 'recu' then p.paid_at end, p.cancel_reason
    from public.document_payments p
    join public.documents d on d.id = p.document_id
    left join public.contacts c on c.id = d.contact_id
    left join public.payment_schedules s on s.id = p.schedule_id
   where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
     and (p.status = 'attendu' or (_with_done and p.due_date is not null and p.status in ('recu', 'annule')))
     and (_due_from is null or p.due_date >= _due_from)
     and (_due_to is null or p.due_date <= _due_to)
     and (_contact is null or d.contact_id = _contact)
   order by p.due_date nulls first, d.number, p.installment_no;
$$;
revoke all on function public.deferred_payments_list(uuid, date, date, uuid, date, boolean) from public, anon;
grant execute on function public.deferred_payments_list(uuid, date, date, uuid, date, boolean) to authenticated;
