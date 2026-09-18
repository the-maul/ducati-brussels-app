-- =====================================================================
-- DÉCISION D2 (client, 14/09/2026) — tri du fichier G8 :
--   une fiche avec AU MOINS UNE FACTURE devient `status = 'client'` ;
--   les autres restent `prospect` ; les fournisseurs sont exclus.
-- Migration de DONNÉES. Seul `contacts.status` change. Retour arrière :
-- supabase/rollbacks/20260919160000_d2_contacts_client_status_ROLLBACK.sql
--
-- Définition de « facture » retenue (vérifiée en lecture seule le 18/09) :
--   documents.doc_type = 'FAC' (facture), hors brouillon et annulée,
--   même société que la fiche. Cela couvre les factures reprises de G8
--   (imported_from = 'G8') ET celles créées dans le DMS.
--   Exclus : AVO (avoir — aucune fiche n'a un avoir sans facture), TIK (ticket
--   de caisse : 1 seul, sans client), devis. `documents` ne contient que FAC,
--   AVO et TIK au 18/09.
--   Les factures à 0 € comptent (garanties, gestes commerciaux G8) : ce sont des
--   factures émises.
-- Chiffres au 18/09 : 8 110 fiches, toutes `prospect` ; 4 165 fiches facturées
--   (4 164 par des factures G8 + 1 fiche de démonstration « SIMON MOREAU »,
--   code 9206, facturée uniquement dans le DMS : FAC-DEMO-001/002) ; aucune n'est
--   fournisseur ni archivée. Le chiffre de D2 (4 165 au 14/09) est confirmé.
--
-- Seules les fiches encore `prospect` sont touchées (on ne rétrograde jamais un
-- `client_piece` / `client_atelier` posé à la main).
--
-- Audit (règle 4, B7) : le déclencheur `trg_contacts_audit` (audit_row) écrit une
-- ligne `events` par fiche modifiée (ancienne et nouvelle fiche complètes,
-- ~2,4 ko chacune : ~20 Mo pour 4 165 fiches, sur une table de 373 Mo). Coût
-- jugé acceptable : l'audit ligne à ligne est conservé. Une ligne de SYNTHÈSE
-- `d2_client_status` est ajoutée en plus (décision, définition, chiffres).
-- =====================================================================

-- ------------------------------------------------ 1. Archive (avant toute écriture)
-- Schéma non exposé par l'API (PostgREST n'expose que public et graphql_public).
create schema if not exists archive_d2_20260918;
revoke all on schema archive_d2_20260918 from public, anon, authenticated;

create table if not exists archive_d2_20260918.contacts_status (
  contact_id  uuid primary key,
  company_id  uuid not null,
  old_status  public.contact_status not null,
  new_status  public.contact_status not null,
  archived_at timestamptz not null default now()
);
comment on table archive_d2_20260918.contacts_status is
  'Décision D2 (14/09) : statut des fiches AVANT leur passage en client (appliqué le 18/09). '
  'Sert au retour arrière (supabase/rollbacks/20260919160000_d2_contacts_client_status_ROLLBACK.sql).';
revoke all on table archive_d2_20260918.contacts_status from public, anon, authenticated;

insert into archive_d2_20260918.contacts_status (contact_id, company_id, old_status, new_status)
select c.id, c.company_id, c.status, 'client'::public.contact_status
  from public.contacts c
 where c.status = 'prospect'
   and c.type <> 'fournisseur'
   and exists (
     select 1 from public.documents d
      where d.contact_id = c.id
        and d.company_id = c.company_id
        and d.doc_type = 'FAC'
        and d.status not in ('brouillon', 'annulee')
   )
on conflict (contact_id) do nothing;

-- ------------------------------------------------ 2. Passage en client
update public.contacts c
   set status = 'client'::public.contact_status
  from archive_d2_20260918.contacts_status a
 where a.contact_id = c.id
   and c.status = 'prospect';

-- ------------------------------------------------ 3. Trace de synthèse
insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
select a.company_id, null, 'd2_client_status', 'contacts', null, 'import',
       jsonb_build_object('status', 'prospect', 'contacts', count(*)),
       jsonb_build_object(
         'status', 'client',
         'contacts', count(*),
         'decision', 'D2 du 14/09/2026 : au moins une facture -> client, sinon prospect, fournisseurs exclus',
         'definition', 'documents.doc_type = FAC, statut hors brouillon/annulee, meme societe',
         'archive', 'archive_d2_20260918.contacts_status',
         'rollback', 'supabase/rollbacks/20260919160000_d2_contacts_client_status_ROLLBACK.sql',
         'migration', '20260919160000_d2_contacts_client_status'
       )
  from archive_d2_20260918.contacts_status a
 group by a.company_id;
