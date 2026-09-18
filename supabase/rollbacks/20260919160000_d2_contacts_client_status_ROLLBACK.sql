-- ============================================================================================
-- ROLLBACK — ne pas appliquer sauf décision de revenir sur D2.
-- ============================================================================================
-- Retour arrière de la migration 20260919160000_d2_contacts_client_status.sql (décision D2,
-- appliquée le 18/09/2026 : 4 165 fiches facturées passées de `prospect` à `client`).
--
-- Ce fichier est VOLONTAIREMENT hors de supabase/migrations/ : `supabase db push` ne doit
-- jamais l'appliquer. À exécuter à la main dans l'éditeur SQL, en une fois.
--
-- Principe : on remet le statut archivé, MAIS seulement sur les fiches qui sont encore
-- `client` (le statut posé par D2). Une fiche dont le statut a été changé à la main depuis
-- (ex. `client_atelier`) n'est pas touchée. Chaque remise est tracée dans `events` par le
-- déclencheur d'audit, plus une ligne de synthèse. L'archive est conservée.
-- ============================================================================================

begin;

-- 1. Aperçu : combien de fiches seront remises dans leur ancien statut.
select count(*) as fiches_a_remettre
  from public.contacts c
  join archive_d2_20260918.contacts_status a on a.contact_id = c.id
 where c.status = a.new_status;

-- 2. Remise du statut d'avant D2.
update public.contacts c
   set status = a.old_status
  from archive_d2_20260918.contacts_status a
 where a.contact_id = c.id
   and c.status = a.new_status;

-- 3. Trace de synthèse.
insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
select a.company_id, auth.uid(), 'd2_client_status_rollback', 'contacts', null, 'import',
       jsonb_build_object('status', 'client'),
       jsonb_build_object('status', 'prospect', 'archive', 'archive_d2_20260918.contacts_status',
                          'contacts', count(*))
  from archive_d2_20260918.contacts_status a
 group by a.company_id;

-- 4. Contrôle : ne doit plus rester aucune fiche `client` issue de D2.
select c.status, count(*)
  from public.contacts c
  join archive_d2_20260918.contacts_status a on a.contact_id = c.id
 group by c.status;

commit;
