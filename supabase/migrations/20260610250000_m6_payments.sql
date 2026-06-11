-- =====================================================================
-- M6 (POS) — Règlements enrichis : multi-modes, à échéance, rendu de monnaie.
-- Réf. G8 Facturation p.39-40 (règlement, rendu monnaie), p.67-69 (multi-modes,
-- partiel, à échéance), p.90 (ajout/suppression d'un règlement).
--   status   : 'recu' (perçu → réduit le dû) | 'attendu' (chèque/LCR différé, le client
--              reste débiteur jusqu'au perçu, p.69)
--   due_date : date d'échéance d'un règlement différé
--   given_amount : montant remis par le client (espèces) pour calculer le rendu de monnaie
-- =====================================================================

alter table public.document_payments
  add column if not exists status       text  not null default 'recu',  -- 'recu' | 'attendu'
  add column if not exists due_date     date,
  add column if not exists given_amount numeric(14,2),
  add column if not exists note         text;

-- Audit (B7) : tracer ajout/suppression/modif des règlements.
drop trigger if exists trg_docpay_audit on public.document_payments;
create trigger trg_docpay_audit after insert or update or delete on public.document_payments
  for each row execute function public.audit_row();

-- Recalcule le montant réglé (somme des règlements PERÇUS) + le statut payée/validée.
-- Centralise la règle pour les ajouts/suppressions/passages perçu (jamais d'UPDATE
-- silencieux côté client : on relit la vérité depuis les règlements).
create or replace function public.recompute_document_paid(_document uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _paid numeric; _ttc numeric; _company uuid; _status text;
begin
  select company_id, total_ttc, status into _company, _ttc, _status from public.documents where id = _document;
  if _company is null then raise exception 'Document introuvable'; end if;
  if not public.is_member(_company) then raise exception 'Accès refusé'; end if;

  select coalesce(sum(amount), 0) into _paid
    from public.document_payments where document_id = _document and status = 'recu';

  update public.documents
    set paid_amount = _paid,
        status = case
          when status = 'annulee' then status
          when _paid + 0.005 >= _ttc and _ttc > 0 then 'payee'
          when status = 'payee' and _paid + 0.005 < _ttc then 'validee'  -- repasse en validée si un règlement perçu est retiré
          else status
        end
    where id = _document;
end $$;
grant execute on function public.recompute_document_paid(uuid) to authenticated;
