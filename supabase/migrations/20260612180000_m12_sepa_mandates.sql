-- =====================================================================
-- M12 — Effets de commerce : DOMICILIATION SEPA (pain.008), équivalent belge
-- moderne des LCR/traites G8. Mandat de prélèvement par client, échéancier sur les
-- factures, génération du fichier banque (SEPA Direct Debit), gestion des impayés
-- (remise en dû). Append-only sur les règlements (B7) : un impayé = règlement négatif.
-- =====================================================================

-- Données créancier SEPA sur la société (ICS = Identifiant Créancier SEPA).
alter table public.companies
  add column if not exists sepa_creditor_id text,
  add column if not exists bic              text;

create table if not exists public.sepa_mandates (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  contact_id     uuid not null references public.contacts(id) on delete cascade,
  mandate_ref    text not null,                       -- RUM (Référence Unique de Mandat)
  iban           text not null,
  bic            text,
  signature_date date not null default current_date,
  scheme         text not null default 'CORE',        -- CORE | B2B
  seq_type       text not null default 'RCUR',        -- FRST | RCUR | OOFF | FNAL
  status         text not null default 'active',      -- active | revoked
  created_at     timestamptz not null default now(),
  unique (company_id, mandate_ref)
);
create index if not exists idx_sepa_mandates_contact on public.sepa_mandates(contact_id);

drop trigger if exists trg_sepa_mandates_audit on public.sepa_mandates;
create trigger trg_sepa_mandates_audit after insert or update or delete on public.sepa_mandates for each row execute function public.audit_row();
alter table public.sepa_mandates enable row level security;
drop policy if exists sepa_mandates_all on public.sepa_mandates;
create policy sepa_mandates_all on public.sepa_mandates for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- Factures encaissables par domiciliation : FAC non soldées dont le client a un
-- mandat actif, échéance <= _due_to. Base de la remise SEPA (pain.008).
-- ---------------------------------------------------------------------
create or replace function public.sepa_collectable(_company uuid, _due_to date)
returns table(
  document_id uuid, number text, due_date date, contact_id uuid, contact_name text,
  amount_due numeric, mandate_ref text, iban text, bic text, signature_date date, seq_type text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.number, d.due_date, c.id,
         coalesce(c.company_name, trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,''))),
         round(d.total_ttc - d.paid_amount, 2),
         m.mandate_ref, m.iban, m.bic, m.signature_date, m.seq_type
  from public.documents d
  join public.contacts c on c.id = d.contact_id
  join public.sepa_mandates m on m.contact_id = c.id and m.status = 'active'
  where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and d.doc_type = 'FAC' and d.status not in ('annulee','converti')
    and d.total_ttc - d.paid_amount > 0.005
    and (d.due_date is null or d.due_date <= _due_to)
  order by d.due_date nulls first, d.number;
$$;
grant execute on function public.sepa_collectable(uuid, date) to authenticated;

-- Enregistre l'encaissement par domiciliation d'une facture (règlement perçu 'DOM').
create or replace function public.record_sepa_collection(_document uuid, _amount numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid;
begin
  select company_id into _company from public.documents where id = _document;
  if _company is null then raise exception 'Document introuvable'; end if;
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  insert into public.document_payments (document_id, method, amount, status, note)
    values (_document, 'DOM', round(_amount,2), 'recu', 'Domiciliation SEPA');
  perform public._recompute_paid_unchecked(_document);
end $$;
grant execute on function public.record_sepa_collection(uuid, numeric) to authenticated, service_role;

-- Impayé (rejet bancaire) : contre-passation = règlement NÉGATIF (B7), la facture
-- revient en dû. Distinct de l'annulation directe (cohérent G8 §3.6 de l'audit).
create or replace function public.record_sepa_unpaid(_document uuid, _amount numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid;
begin
  select company_id into _company from public.documents where id = _document;
  if _company is null then raise exception 'Document introuvable'; end if;
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  insert into public.document_payments (document_id, method, amount, status, note)
    values (_document, 'DOM', -abs(round(_amount,2)), 'recu', 'Impayé domiciliation SEPA (remise en dû)');
  perform public._recompute_paid_unchecked(_document);
end $$;
grant execute on function public.record_sepa_unpaid(uuid, numeric) to authenticated, service_role;

-- Recalcul du réglé sans contrôle is_member (pour les contextes service role / cron).
create or replace function public._recompute_paid_unchecked(_document uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _paid numeric; _ttc numeric; _status text;
begin
  select total_ttc, status into _ttc, _status from public.documents where id = _document;
  select coalesce(sum(amount),0) into _paid from public.document_payments where document_id = _document and status = 'recu';
  update public.documents
    set paid_amount = _paid,
        status = case when status = 'annulee' then status
                      when _paid + 0.005 >= _ttc and _ttc > 0 then 'payee'
                      when status = 'payee' and _paid + 0.005 < _ttc then 'validee'
                      else status end
    where id = _document;
end $$;
