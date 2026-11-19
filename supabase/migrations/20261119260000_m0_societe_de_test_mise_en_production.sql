-- =====================================================================
-- M0 COM005 — SOCIETE DE TEST « ItalTest » : correctif du 19/11/2026 (lot-italtest-fix)
--
-- Le lot « Mise en production » (20261119220000) a ajoute trois tables portant company_id :
--   automation_settings  (boite d envoi et adresse de test des mails automatiques),
--   automation_switches  (interrupteurs arrete / test / actif des automatismes),
--   integration_status   (presence des secrets du serveur).
-- Elles ne sont PAS copiees dans une societe de test (admin_test_company_inventory les classe) et
-- les deux premieres recoivent le garde-fou « societe de test » (declencheur ENABLE ALWAYS) :
--   automation_switches → mode « arrete » force ; automation_settings → boite et adresse de test videes.
-- (automation_companies_off() exclut deja les societes de test : double securite.)
-- Idempotent ; suppose 20261119160000 appliquee.
-- =====================================================================

create or replace function public._tc_skip()
returns table(tbl text, reason text)
language sql immutable as $$
  values
    ('accident_file_photos', 'Historique : dossiers accident'),
    ('accident_files', 'Historique : dossiers accident'),
    ('accounting_entries', 'Historique : ecritures comptables'),
    ('accounting_exports', 'Historique : exports comptables'),
    ('accounting_transfer_items', 'Historique : transferts comptables'),
    ('accounting_transfers', 'Historique : transferts comptables'),
    ('app_client_waitlist', 'Inscriptions reelles a l application client'),
    ('automation_settings', 'Mise en production : boite d envoi et adresse de test reelles (jamais en societe de test)'),
    ('automation_switches', 'Mise en production : interrupteurs (une societe de test reste toujours a l arret)'),
    ('attachments', 'GED : fichiers du stockage partage (une suppression en test toucherait le fichier reel)'),
    ('cash_deposit_comments', 'Historique : remises en banque'),
    ('cash_deposit_lines', 'Historique : remises en banque'),
    ('cash_deposits', 'Historique : remises en banque'),
    ('cash_movements', 'Historique : mouvements de caisse'),
    ('cash_sessions', 'Historique : caisses (la societe de test demarre caisse fermee)'),
    ('communications', 'Historique : echanges (mails, appels)'),
    ('company_mailboxes', 'Boites Outlook reelles : interdites en societe de test'),
    ('consignments', 'Historique : contrats de depot-vente'),
    ('contact_accounts', 'Comptes reels de l espace client (aucun client ne doit voir la societe de test)'),
    ('contact_invitations', 'Historique : invitations envoyees'),
    ('contact_merge_candidates', 'Calcule : doublons a revoir'),
    ('counter_displays', 'Materiel reel (afficheurs)'),
    ('customer_display_devices', 'Materiel reel (ecrans client)'),
    ('customer_price_rules_history', 'Historique'),
    ('ducati_catalog_import_batches', 'Journal d import du catalogue'),
    ('deferred_interventions', 'Historique : travaux differes d OR passes'),
    ('document_signatures', 'Historique : signatures'),
    ('document_sources', 'Historique : filiation des documents'),
    ('documents', 'Historique : factures, tickets, devis, commandes...'),
    ('dunning_letters', 'Historique : relances d impayes'),
    ('events', 'Historique : journal d audit'),
    ('excel_orders', 'Historique : commandes Excel'),
    ('fiscal_closures', 'Historique : clotures'),
    ('followups', 'Historique : relances d entretien'),
    ('gdpr_purge_items', 'Historique : purges RGPD'),
    ('gdpr_purge_runs', 'Historique : purges RGPD'),
    ('integration_status', 'Mise en production : presence des secrets du serveur (releve technique)'),
    ('improvement_points', 'Suivi interne agence'),
    ('improvements', 'Suivi interne agence'),
    ('internal_cession_lines', 'Historique : cessions internes'),
    ('internal_cessions', 'Historique : cessions internes'),
    ('inventory_imports', 'Historique : imports d inventaire'),
    ('inventory_sessions', 'Historique : inventaires'),
    ('inventory_step_log', 'Historique : inventaires'),
    ('label_queue', 'File d impression d etiquettes en cours'),
    ('lead_tasks', 'Historique CRM'),
    ('leads', 'Historique CRM'),
    ('marketing_campaign_recipients', 'Historique : campagnes'),
    ('minimax_night_list', 'Propositions de reassort de la nuit (recalculees chaque nuit)'),
    ('marketing_campaigns', 'Historique : campagnes'),
    ('notifications', 'File d envoi (jamais copiee)'),
    ('oro', 'Historique : remises en etat'),
    ('part_order_allocations', 'Historique : commandes de pieces'),
    ('part_order_status_history', 'Historique : commandes de pieces'),
    ('part_orders', 'Historique : commandes de pieces'),
    ('payment_schedules', 'Historique : echeanciers'),
    ('picking_list_items', 'Historique : listes de preparation'),
    ('picking_lists', 'Historique : listes de preparation'),
    ('portal_doc_no_back', 'Espace client reel'),
    ('portal_uploads', 'Espace client reel (fichiers deposes)'),
    ('price_changes', 'Historique des prix (les prix courants sont sur l article)'),
    ('purchase_customer_notices', 'Historique : achats'),
    ('purchase_order_sends', 'Historique : envois de commandes'),
    ('purchase_orders', 'Historique : commandes / receptions fournisseur'),
    ('purchase_schedules', 'Historique : echeanciers fournisseur'),
    ('repair_orders', 'Historique : OR'),
    ('sepa_batch_items', 'Historique : remises SEPA'),
    ('sepa_batches', 'Historique : remises SEPA'),
    ('sepa_mandates', 'Mandats bancaires reels des clients'),
    ('shop_settings', 'Vitrine publique (adresse unique)'),
    ('shopify_content_imports', 'Boutique Shopify reelle'),
    ('shopify_links', 'Boutique Shopify reelle'),
    ('shopify_moto_annonces', 'Boutique Shopify reelle'),
    ('shopify_order_lines', 'Boutique Shopify reelle'),
    ('shopify_order_refunds', 'Boutique Shopify reelle'),
    ('shopify_order_reservations', 'Boutique Shopify reelle'),
    ('shopify_order_settings', 'Boutique Shopify reelle (import coupe en societe de test)'),
    ('shopify_orders', 'Boutique Shopify reelle'),
    ('shopify_products', 'Boutique Shopify reelle'),
    ('shopify_published_media', 'Boutique Shopify reelle'),
    ('shopify_redirects', 'Boutique Shopify reelle'),
    ('shopify_sync_log', 'Boutique Shopify reelle'),
    ('shopify_sync_queue', 'Boutique Shopify reelle'),
    ('shopify_sync_settings', 'Boutique Shopify reelle (synchronisation coupee en societe de test)'),
    ('shopify_sync_trial', 'Boutique Shopify reelle'),
    ('shopify_vehicle_links', 'Boutique Shopify reelle'),
    ('signup_settings', 'Reglage global unique (inscription publique)'),
    ('stock_depreciations', 'Historique : depreciations'),
    ('stock_moves', 'Remplace par un mouvement d ouverture par article'),
    ('stock_reservations', 'Historique : reservations'),
    ('stock_snapshot_adjustments', 'Historique : arretes'),
    ('stock_snapshots', 'Historique : arretes / copies de stock'),
    ('stripe_events', 'Paiements reels'),
    ('stripe_settings', 'Paiement en ligne reel : interdit en societe de test'),
    ('supplier_basket_lines', 'Historique : paniers de commande'),
    ('supplier_baskets', 'Historique : paniers de commande'),
    ('supplier_tariffs', 'Journal des imports de tarifs (fichiers du stockage)'),
    ('team_notifications', 'Historique : alertes'),
    ('tradein_offers', 'Historique : offres de reprise'),
    ('user_roles', 'Droits : seuls les administrateurs de la source recoivent « admin »'),
    ('vehicle_brand_submissions', 'Historique'),
    ('vehicle_cost_changes', 'Historique des couts'),
    ('vouchers', 'Historique : bons d achat'),
    ('warranty_returns', 'Historique : retours garantie'),
    ('web_orders', 'Historique : commandes web'),
    ('workshop_appointments', 'Historique : rendez-vous'),
    ('workshop_journeys', 'Historique : parcours d entretien'),
    ('workshop_loans', 'Historique : prets de moto'),
    ('workshop_parts_prompts', 'Historique'),
    ('workshop_tasks', 'Historique'),
    ('workshop_time_entries', 'Historique : pointages'),
    ('workstation_devices', 'Materiel reel (terminal de paiement, imprimantes)'),
    ('workstations', 'Postes reels')
$$;

create or replace function public._test_company_force_off()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_test_company(new.company_id) then return new; end if;
  case tg_table_name
    when 'followup_settings' then
      new.mode := 'arrete'; new.test_recipient := null;
    when 'receivable_settings' then
      new.dunning_mode := 'arrete'; new.dunning_test_recipient := null;
    when 'shopify_sync_settings' then
      new.mode := 'arrete';
    when 'sms_settings' then
      new.mode := 'arrete'; new.test_recipient := null;
    when 'shopify_order_settings' then
      new.import_enabled := false;
    when 'accounting_transfer_settings' then
      new.params := jsonb_set(coalesce(new.params, '{}'::jsonb), '{auto}',
                              '{"frequency": "off", "sendEmail": false, "email": ""}'::jsonb);
    when 'automation_switches' then
      new.mode := 'arrete';
    when 'automation_settings' then
      new.sender_mailbox := null; new.mail_test_recipient := null;
    when 'stripe_settings' then
      raise exception 'Societe de test : le paiement en ligne (Stripe) est coupe.' using errcode = '42501';
    when 'company_mailboxes' then
      raise exception 'Societe de test : pas de boite Outlook (aucun envoi ni releve de mail).' using errcode = '42501';
    else
      null;
  end case;
  return new;
end $$;

do $do$
declare _t text;
begin
  foreach _t in array array['automation_switches', 'automation_settings'] loop
    if to_regclass('public.' || _t) is not null then
      execute format('drop trigger if exists trg_%1$s_test_company on public.%1$I', _t);
      execute format('create trigger trg_%1$s_test_company before insert or update on public.%1$I
                        for each row execute function public._test_company_force_off()', _t);
      execute format('alter table public.%1$I enable always trigger trg_%1$s_test_company', _t);
    end if;
  end loop;
end $do$;

revoke all on function public._tc_skip() from public, anon, authenticated;
revoke all on function public._test_company_force_off() from public, anon, authenticated;
