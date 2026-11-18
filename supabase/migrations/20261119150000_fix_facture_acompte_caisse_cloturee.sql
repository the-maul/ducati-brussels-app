-- =====================================================================
-- M6 PDV010 — Facture d'acompte d'un acompte encaisse un jour deja cloture (18/11/2026).
--
-- Defaut : `deposit_invoice_create` (facture d'acompte FAA a la demande, ou pour solder le rappel
-- cloche « a facturer avant le 15 ») recopie le reglement d'acompte sur la FAA, A LA DATE DE
-- L'ENCAISSEMENT (mention legale, AR 1 art. 5 §1 5°), marque `transferred_from` (pas un nouvel
-- encaissement : hors Z, hors journaux de caisse, hors remise en banque, hors export compta).
-- Depuis la premiere cloture de caisse reelle (18/11), `document_payments_guard` refuse ce report
-- (« Reglement date du … dans une caisse cloturee ») : un acompte percu hier ou le mois dernier ne
-- peut plus recevoir sa facture d'acompte, et le rappel cloche ne se resout jamais.
--
-- Correction : a l'INSERTION, un report (`transferred_from`) qui reprend EXACTEMENT la date d'un
-- reglement percu existant, sans en depasser le montant, n'est pas un reglement antidate : la
-- journee cloturee n'en est pas modifiee (le report n'entre dans aucun total de caisse). Tout le
-- reste du garde-fou est inchange : un nouveau reglement date dans une caisse cloturee est
-- toujours refuse, un reglement percu d'une caisse cloturee ne se modifie ni ne se supprime.
-- Idempotente (create or replace) ; le declencheur trg_document_payments_guard est inchange.
-- =====================================================================
create or replace function public.document_payments_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _src record;
begin
  -- Les fonctions serveur (Shopify, Stripe : auth.uid() null) datent les reglements de la commande.
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'recu' then
    select company_id into _company from public.documents where id = old.document_id;
    if public._cash_period_closed(_company, old.paid_at) then
      raise exception 'Reglement du % dans une caisse cloturee : il ne se modifie ni ne se supprime plus (passez un reglement inverse).', old.paid_at using errcode = '23514';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'recu' then
    select company_id into _company from public.documents where id = new.document_id;
    -- Report d'un acompte deja encaisse (facture d'acompte, conversion) : meme date que l'original,
    -- montant au plus egal, original percu dans la meme societe. Hors caisse : la journee close
    -- n'est pas touchee.
    if tg_op = 'INSERT' and new.transferred_from is not null then
      select p.paid_at, p.amount, p.status, d.company_id into _src
        from public.document_payments p join public.documents d on d.id = p.document_id
       where p.id = new.transferred_from;
      if found and _src.status = 'recu' and _src.company_id = _company
         and new.paid_at = _src.paid_at and round(new.amount, 2) <= round(_src.amount, 2) then
        return new;
      end if;
    end if;
    if public._cash_period_closed(_company, new.paid_at) then
      raise exception 'Reglement date du % dans une caisse cloturee : datez-le d aujourd hui.', new.paid_at using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.document_payments_guard() from public, anon, authenticated;
