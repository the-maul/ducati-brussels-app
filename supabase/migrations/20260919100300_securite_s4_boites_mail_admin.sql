-- LOT SÉCURITÉ S4 — Boîtes Outlook écoutées (company_mailboxes) : écriture réservée aux
-- administrateurs de la société.
-- Réf. docs/bible/securite-lot-S.md §S4 et docs/bible/modules/M10-crm.md (alerte 🔴).
--
-- Avant : politique unique company_mailboxes_all (ALL, is_member) : tout salarié pouvait,
-- par l'API, ajouter l'adresse d'un collègue du même tenant Microsoft 365. La relève
-- (permission applicative Mail.Read) lisait alors sa boîte dans le CRM, et graph-send-email
-- acceptait d'envoyer en son nom.
--
-- Après : lecture pour les membres (le CRM liste les boîtes d'expédition,
-- src/modules/crm/api.ts listCompanyMailboxes) ; ajout, modification, suppression pour les
-- administrateurs seulement. La relève et les curseurs passent par la clé de service
-- (RLS non appliquée) : non concernés.
--
-- Aucun écran du DMS n'écrit aujourd'hui dans cette table (vérifié le 19/09) : pas de casse
-- attendue côté interface.
--
-- NON APPLIQUÉE.

drop policy if exists company_mailboxes_all on public.company_mailboxes;

create policy company_mailboxes_select on public.company_mailboxes
  for select to authenticated
  using (public.is_member(company_id));

create policy company_mailboxes_insert on public.company_mailboxes
  for insert to authenticated
  with check (public.is_admin(company_id));

create policy company_mailboxes_update on public.company_mailboxes
  for update to authenticated
  using (public.is_admin(company_id))
  with check (public.is_admin(company_id));

create policy company_mailboxes_delete on public.company_mailboxes
  for delete to authenticated
  using (public.is_admin(company_id));
