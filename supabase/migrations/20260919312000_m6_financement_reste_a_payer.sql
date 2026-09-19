-- =====================================================================
-- Mission 05 — carte 9 « Voir les paiements et le solde restant dû »
--
-- Domenico (vidéo G8, 7:59) : « important d'avoir en grand le solde restant dû »,
-- « encours financier » en haut à droite de la fiche client.
--
-- Ce lot ajoute le FINANCEMENT en cours sur un document de vente :
--   - organisme (table de référence existante reference_values, table_key
--     'financing_org', Paramètres → Tables), montant financé, statut
--     demandé / accepté / refusé ;
--   - sur un règlement : from_financing = versé par l'organisme (pour savoir ce
--     qui reste à recevoir de l'organisme et ce qui reste à payer par le client) ;
--   - document_set_financing : seule écriture, contrôlée ; trace dans events par
--     le trigger d'audit existant des documents (trg_documents_audit).
--
-- Reste à payer par le client = TTC − réglé − (financement accepté encore à
-- recevoir de l'organisme). Calcul fait à l'écran (src/modules/sales/balance.ts).
-- Le statut « payée » du document ne change pas de règle (recompute_document_paid).
--
-- Additif : 4 colonnes, 2 contraintes, 1 fonction. Aucune donnée écrite.
-- =====================================================================

alter table public.documents
  add column if not exists financing_org_id uuid references public.reference_values(id) on delete set null,
  add column if not exists financing_amount numeric not null default 0,
  add column if not exists financing_status text;

do $$ begin
  alter table public.documents
    add constraint documents_financing_status_chk
    check (financing_status is null or financing_status in ('demande', 'accepte', 'refuse'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.documents
    add constraint documents_financing_amount_chk check (financing_amount >= 0);
exception when duplicate_object then null; end $$;

alter table public.document_payments
  add column if not exists from_financing boolean not null default false;

-- Poser, modifier ou retirer le financement d'un document
create or replace function public.document_set_financing(
  _document uuid, _org uuid, _amount numeric, _status text
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d   public.documents%rowtype;
  amt numeric := coalesce(_amount, 0);
begin
  select * into d from public.documents where id = _document for update;
  if not found then
    raise exception 'Document introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(d.company_id) then
    raise exception 'Accès refusé à la société %', d.company_id using errcode = '42501';
  end if;
  if d.status = 'annulee' then
    raise exception 'Document annulé : le financement ne se modifie plus.' using errcode = 'P0001';
  end if;

  -- Retrait complet
  if _org is null and amt = 0 and _status is null then
    update public.documents
       set financing_org_id = null, financing_amount = 0, financing_status = null
     where id = _document
       and (financing_org_id, financing_amount, financing_status) is distinct from (null::uuid, 0::numeric, null::text);
    return;
  end if;

  if _org is null then
    raise exception 'Choisissez l''organisme de financement.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.reference_values r
                  where r.id = _org and r.company_id = d.company_id and r.table_key = 'financing_org') then
    raise exception 'Organisme de financement introuvable dans cette société.' using errcode = 'P0002';
  end if;
  if _status is null or _status not in ('demande', 'accepte', 'refuse') then
    raise exception 'Statut du financement : demandé, accepté ou refusé.' using errcode = 'P0001';
  end if;
  if amt <= 0 then
    raise exception 'Indiquez le montant financé.' using errcode = 'P0001';
  end if;
  if amt > d.total_ttc + 0.005 then
    raise exception 'Le montant financé (%) dépasse le total TTC du document (%).', amt, d.total_ttc using errcode = 'P0001';
  end if;

  update public.documents
     set financing_org_id = _org, financing_amount = round(amt, 2), financing_status = _status
   where id = _document
     and (financing_org_id, financing_amount, financing_status) is distinct from (_org, round(amt, 2), _status);
end $$;

revoke all on function public.document_set_financing(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.document_set_financing(uuid, uuid, numeric, text) to authenticated;

notify pgrst, 'reload schema';
