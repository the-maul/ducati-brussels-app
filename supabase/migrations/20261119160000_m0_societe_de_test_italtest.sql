-- =====================================================================
-- M0 COM005 — SOCIETE DE TEST « ItalTest » (19/11/2026, lot-italtest)
--
-- Demande du client : « creer une societe de test, ItalTest, qui reproduit tout ce qu il y a deja
-- sur ITALBIKE STORE, pour faire des tests avec de vraies donnees » et rejouer les 27 parcours G8
-- sans toucher a la vraie societe.
--
-- Ce que pose ce fichier (idempotent, rejouable) :
--   1. test_companies : le MARQUAGE « societe de test » (une ligne par societe de test, ecrite
--      uniquement par les fonctions ci-dessous ; immuable ; refuse sur une societe qui contient deja
--      des donnees). is_test_company(_company) le lit.
--   2. GARDE-FOUS D ENVOI cote base (declencheurs ENABLE ALWAYS, actifs meme en mode replica) :
--        notifications (mails / SMS de dispatch-notifications, rappels RDV, relances factures)
--          → une notification d une societe de test est enregistree « skipped », jamais « pending » ;
--        followup_settings (relances d entretien) → mode « arrete » force ;
--        receivable_settings (relances d impayes) → mode « arrete » force ;
--        sms_settings (SMS Brevo, lot SMS) → mode « arrete » force ;
--        shopify_sync_settings → « arrete » ; shopify_order_settings → import coupe ;
--        accounting_transfer_settings → transfert automatique « off », pas d envoi par e-mail ;
--        stripe_settings, company_mailboxes → refus (pas de paiement en ligne, pas de boite Outlook).
--      Les fonctions Edge refont le controle (supabase/functions/_shared/test-company.ts).
--   3. La COPIE : admin_clone_company_for_test(source, nom) cree (ou rafraichit) la societe de test
--      et y copie le referentiel de la source avec de NOUVEAUX identifiants et des liens recables
--      (table de correspondance test_company_id_map) :
--        parametres (reference_values, numerotations remises a 1 avec le prefixe « TEST »,
--        comptes, tarifs et regles client), articles / categories / fournisseurs, contacts
--        (e-mails et telephones NEUTRALISES), vehicules, plans et kits d entretien, et le stock
--        sous forme d UN mouvement d ouverture par article (append-only, B7).
--      Aucun historique transactionnel (factures, tickets, reglements, caisses, exports compta,
--      events...) : la societe demarre propre, sans caisse ouverte.
--      La liste table par table (copiee ou non, et pourquoi) : admin_test_company_inventory().
--   4. Rafraichir = tout supprimer DANS LA SOCIETE DE TEST puis recopier. Garde-fou absolu :
--      _tc_run refuse toute suppression dans une societe absente de test_companies, et refuse de
--      purger tant qu une donnee d une autre societe pointe vers une ligne de la societe de test.
--
-- ORDRE DES APPELS
--   SQL (API de gestion : la passerelle coupe la reponse vers 100 s, d ou un budget de 85 s) :
--     select public.admin_clone_company_for_test('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ItalTest');
--     (premiere copie mesuree a ~37 s : un seul appel suffit.) Si le resultat dit
--     status = « en_cours » (budget atteint, p. ex. rafraichissement avec purge), rappeler :
--     select public.admin_test_company_step('<id ItalTest>', 85000);   -- jusqu a status = « pret »
--   Ecran (Parametres → Societes, administrateur) : admin_test_company_start puis
--     admin_test_company_step(<id>, 4000) en boucle (chaque appel < 8 s, limite de PostgREST).
--   Les deux chemins partagent la meme machine a etapes (controle → purge → societe → map → copie
--   → stock → fin), relancable apres une interruption : elle reprend ou elle s etait arretee.
--
-- Le mode « replica » (session_replication_role) n est pose QUE dans _tc_run (SET LOCAL au debut,
-- remis a « origin » avant chaque sortie) : il coupe les declencheurs metier pendant la copie (audit,
-- file Shopify, registre, alertes...) et pendant la purge de la societe de test.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Marquage « societe de test »
-- ---------------------------------------------------------------------
create table if not exists public.test_companies (
  company_id        uuid primary key references public.companies(id) on delete cascade,
  source_company_id uuid not null references public.companies(id) on delete restrict,
  status            text not null default 'a_copier' check (status in ('a_copier', 'en_cours', 'pret', 'erreur')),
  phase             text,
  step_ord          integer not null default 0,
  step_cursor       uuid,
  progress          jsonb not null default '{}'::jsonb,
  last_error        text,
  started_at        timestamptz,
  finished_at       timestamptz,
  refreshed_by      uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint test_companies_not_self check (company_id <> source_company_id)
);
comment on table public.test_companies is
  'COM005 / lot ItalTest : societes de TEST (copie du referentiel d une vraie societe). Aucun envoi sortant n en part (declencheurs + fonctions Edge). Ecrite uniquement par admin_test_company_start / _tc_run.';

alter table public.test_companies enable row level security;
revoke all on public.test_companies from anon, authenticated;
grant select on public.test_companies to authenticated;
drop policy if exists test_companies_select on public.test_companies;
create policy test_companies_select on public.test_companies for select to authenticated
  using (public.is_member(company_id) or public.is_admin(source_company_id));

-- Le marquage est immuable, ne peut pas viser une societe deja remplie, ne peut pas etre retire
-- (sauf suppression de la societe elle-meme).
create or replace function public._test_companies_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.company_id = new.source_company_id then
      raise exception 'Societe de test : la source et la cible doivent etre differentes.' using errcode = '42501';
    end if;
    if exists (select 1 from public.test_companies where company_id = new.source_company_id) then
      raise exception 'Societe de test : la source ne peut pas etre elle-meme une societe de test.' using errcode = '42501';
    end if;
    if exists (select 1 from public.documents where company_id = new.company_id)
       or exists (select 1 from public.articles where company_id = new.company_id)
       or exists (select 1 from public.contacts where company_id = new.company_id)
       or exists (select 1 from public.stock_moves where company_id = new.company_id) then
      raise exception 'Societe de test : une societe qui contient deja des donnees ne peut pas etre marquee « test ».' using errcode = '42501';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.company_id <> old.company_id or new.source_company_id <> old.source_company_id then
      raise exception 'Societe de test : le marquage est immuable.' using errcode = '42501';
    end if;
    return new;
  else
    -- Suppression directe refusee : seule la suppression de la societe (cascade) retire la marque.
    if exists (select 1 from public.companies where id = old.company_id) then
      raise exception 'Societe de test : le marquage ne peut pas etre retire.' using errcode = '42501';
    end if;
    return old;
  end if;
end $$;
drop trigger if exists trg_test_companies_guard on public.test_companies;
create trigger trg_test_companies_guard before insert or update or delete on public.test_companies
  for each row execute function public._test_companies_guard();
alter table public.test_companies enable always trigger trg_test_companies_guard;

create or replace function public.is_test_company(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select _company is not null and exists (select 1 from public.test_companies where company_id = _company);
$$;
comment on function public.is_test_company(uuid) is
  'Vrai si la societe est une societe de TEST (lot ItalTest) : aucun envoi sortant (mail, SMS, Shopify, Stripe, transfert comptable).';

-- ---------------------------------------------------------------------
-- 2. Garde-fous d envoi (cote base)
-- ---------------------------------------------------------------------
create or replace function public._test_company_block_notification()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'pending' and public.is_test_company(new.company_id) then
    new.status := 'skipped';
    new.error := 'societe_de_test : aucun envoi';
  end if;
  return new;
end $$;
drop trigger if exists trg_notifications_test_company on public.notifications;
create trigger trg_notifications_test_company before insert or update on public.notifications
  for each row execute function public._test_company_block_notification();
alter table public.notifications enable always trigger trg_notifications_test_company;

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
  foreach _t in array array['followup_settings', 'receivable_settings', 'sms_settings', 'shopify_sync_settings', 'shopify_order_settings',
                            'accounting_transfer_settings', 'stripe_settings', 'company_mailboxes'] loop
    if to_regclass('public.' || _t) is not null then
      execute format('drop trigger if exists trg_%1$s_test_company on public.%1$I', _t);
      execute format('create trigger trg_%1$s_test_company before insert or update on public.%1$I
                        for each row execute function public._test_company_force_off()', _t);
      execute format('alter table public.%1$I enable always trigger trg_%1$s_test_company', _t);
    end if;
  end loop;
end $do$;

-- ---------------------------------------------------------------------
-- 3. Table de correspondance ancien id → nouvel id (par societe de test)
-- ---------------------------------------------------------------------
create table if not exists public.test_company_id_map (
  target_company_id uuid not null references public.companies(id) on delete cascade,
  old_id            uuid not null,
  new_id            uuid not null,
  tbl               text not null,
  primary key (target_company_id, old_id)
);
create index if not exists idx_test_company_id_map_new on public.test_company_id_map(target_company_id, new_id);
alter table public.test_company_id_map enable row level security;
revoke all on public.test_company_id_map from anon, authenticated;
comment on table public.test_company_id_map is
  'Lot ItalTest : correspondance id source → id copie, par societe de test (recablage des liens, controles).';

create or replace function public._tc_map(_target uuid, _old uuid)
returns uuid language sql stable set search_path = public, pg_temp as $$
  select m.new_id from public.test_company_id_map m where m.target_company_id = _target and m.old_id = _old;
$$;

-- ---------------------------------------------------------------------
-- 4. Ce qui est copie (ordre logique ; le mode replica rend l ordre des cles sans importance)
--    parent_col / parent_tbl : tables SANS company_id, rattachees a la source par ce lien.
--    extra : filtre supplementaire sur la ligne source (alias s).
-- ---------------------------------------------------------------------
create or replace function public._tc_spec()
returns table(ord int, tbl text, parent_col text, parent_tbl text, batch int, extra text, reason text)
language sql immutable as $$
  values
    (10,  'reference_values',              null, null, 5000, null, 'Parametres : tables de reference'),
    (11,  'document_sequences',            null, null, 5000, null, 'Numerotations : remises a 1, prefixe TEST'),
    (12,  'numbering_settings',            null, null, 5000, null, 'Parametres de numerotation'),
    (13,  'chart_of_accounts',             null, null, 5000, null, 'Plan comptable'),
    (14,  'account_mappings',              null, null, 5000, null, 'Comptes comptables (correspondances)'),
    (15,  'accounting_account_rules',      null, null, 5000, null, 'Comptes comptables (regles G8)'),
    (16,  'accounting_transfer_settings',  null, null, 5000, null, 'Parametres du transfert comptable (automatique coupe)'),
    (17,  'article_import_settings',       null, null, 5000, null, 'Parametres d import des tarifs'),
    (18,  'followup_templates',            null, null, 5000, null, 'Modeles de relance'),
    (19,  'followup_settings',             null, null, 5000, null, 'Relances d entretien : forcees a « arrete »'),
    (20,  'receivable_settings',           null, null, 5000, null, 'Relances d impayes : forcees a « arrete »'),
    (97,  'sms_settings',                  null, null, 5000, null, 'SMS (Brevo) : modeles et reglages, envoi force a « arrete » (lot SMS, si present)'),
    (21,  'dunning_templates',             null, null, 5000, null, 'Modeles de lettres de relance'),
    (22,  'label_templates',               null, null, 5000, null, 'Modeles d etiquettes'),
    (23,  'document_comment_templates',    null, null, 5000, null, 'Modeles de commentaires'),
    (24,  'poster_templates',              null, null, 5000, null, 'Modeles d affichettes'),
    (25,  'company_device_settings',       null, null, 5000, null, 'Reglages ticket / tiroir (sans appareil)'),
    (26,  'workshop_planning_settings',    null, null, 5000, null, 'Parametres du planning atelier'),
    (27,  'workshop_operations',           null, null, 5000, null, 'Operations atelier'),
    (28,  'workshop_mechanics',            null, null, 5000, null, 'Compagnons du planning'),
    (29,  'workshop_mechanic_hours',       null, null, 5000, null, 'Horaires des compagnons'),
    (30,  'workshop_calendar_blocks',      null, null, 5000, null, 'Fermetures / absences du planning'),
    (31,  'article_categories',            null, null, 5000, null, 'Categories (familles) d articles'),
    (32,  'price_lists',                   null, null, 5000, null, 'Tarifs clients'),
    (33,  'ppc_price_rules',               null, null, 5000, null, 'Regles de prix public conseille'),
    (34,  'supplier_discount_classes',     null, null, 5000, null, 'Classes de remise fournisseur'),
    (35,  'supplier_tariff_formats',       null, null, 5000, null, 'Formats de tarifs fournisseur'),
    (36,  'tradein_partners',              null, null, 5000, null, 'Marchands de reprise (coordonnees neutralisees)'),
    (37,  'insurance_parties',             null, null, 5000, null, 'Assureurs / experts (coordonnees neutralisees)'),
    (38,  'excel_catalog',                 null, null, 5000, null, 'Catalogue de commande Excel'),
    (40,  'contacts',                      null, null, 1000, null, 'Clients et fournisseurs (e-mails et telephones neutralises)'),
    (41,  'contact_subcontacts',           'contact_id', 'contacts', 5000, null, 'Interlocuteurs (neutralises)'),
    (42,  'delivery_addresses',            'contact_id', 'contacts', 5000, null, 'Adresses de livraison'),
    (43,  'contact_links',                 null, null, 5000, null, 'Fiches liees'),
    (44,  'contact_group_members',         null, null, 5000, null, 'Groupes de clients'),
    (45,  'contact_group_sales',           null, null, 5000, null, 'Groupements de vente'),
    (46,  'contact_consents',              null, null, 5000, null, 'Consentements RGPD'),
    (47,  'client_price_rules',            null, null, 5000, null, 'Regles de prix par client'),
    (48,  'accounting_third_accounts',     null, null, 5000, null, 'Comptes tiers'),
    (49,  'price_rounding_rules',          null, null, 5000, null, 'Regles d arrondi des prix'),
    (50,  'articles',                      null, null, 1000, null, 'Articles'),
    (51,  'article_barcodes',              'article_id', 'articles', 5000, null, 'Codes-barres'),
    (52,  'article_bins',                  'article_id', 'articles', 5000, null, 'Casiers'),
    (53,  'article_kit_items',             'kit_id', 'articles', 5000, null, 'Composition des kits / forfaits'),
    (54,  'article_suppliers',             'article_id', 'articles', 5000, null, 'Fournisseurs par article'),
    (55,  'article_links',                 null, null, 1000, 's.target_kind is distinct from ''shopify_variant''', 'Rapprochements catalogue / G8 (sans les liens Shopify)'),
    (56,  'article_equivalences',          null, null, 5000, null, 'Equivalences'),
    (57,  'article_replacement_options',   null, null, 5000, null, 'Remplacements'),
    (58,  'article_applicabilities',       null, null, 5000, null, 'Applicabilites'),
    (59,  'customer_price_rules',          null, null, 5000, null, 'Regles de prix client'),
    (60,  'price_list_rules',              null, null, 5000, null, 'Lignes des tarifs clients'),
    (61,  'supplier_year_end_rebates',     null, null, 5000, null, 'Remises de fin d annee'),
    (62,  'vehicle_option_models',         null, null, 5000, null, 'Modeles d options vehicule'),
    (63,  'vehicle_options',               null, null, 5000, null, 'Options vehicule'),
    (70,  'vehicles',                      null, null, 1000, null, 'Vehicules'),
    (71,  'vehicle_owners',                'vehicle_id', 'vehicles', 3000, null, 'Historique des proprietaires'),
    (72,  'vehicle_bulletins',             null, null, 5000, null, 'Bulletins / rappels'),
    (73,  'vehicle_maintenance_due',       null, null, 3000, null, 'Echeances d entretien'),
    (74,  'vehicle_maintenance',           null, null, 5000, null, 'Entretiens connus du vehicule'),
    (75,  'vehicle_service_history',       null, null, 5000, null, 'Historique de service du vehicule'),
    (76,  'dcs_maintenance_imports',       null, null, 5000, null, 'Echeances DCS importees'),
    (77,  'contact_declared_vehicles',     null, null, 5000, null, 'Motos declarees par les clients'),
    (78,  'workshop_loaner_vehicles',      null, null, 5000, null, 'Motos de pret'),
    (79,  'vehicle_bonuses',               null, null, 5000, null, 'Primes vehicule'),
    (80,  'vehicle_register',              null, null, 5000, 's.left_at is null and not s.is_void and s.rectified_by_id is null', 'Registre : lignes ouvertes (vehicules encore en stock)'),
    (90,  'maintenance_kits',              null, null, 5000, null, 'Kits d entretien'),
    (91,  'maintenance_kit_items',         null, null, 1000, null, 'Lignes des kits'),
    (92,  'maintenance_kit_versions',      null, null, 1000, null, 'Versions des kits (articles recables)'),
    (93,  'maintenance_kit_model_years',   'kit_id', 'maintenance_kits', 2000, null, 'Kits par modele-annee'),
    (94,  'maintenance_fluid_articles',    null, null, 5000, null, 'Articles des fluides'),
    (95,  'maintenance_engine_profiles',   null, null, 5000, null, 'Profils moteur des forfaits (lot forfaits G8, si present)'),
    (96,  'maintenance_kit_default_lines', null, null, 5000, null, 'Lignes par defaut des kits (lot forfaits G8, si present)')
$$;

-- Tables NON copiees, avec la raison (inventaire). Toute table portant company_id absente des deux
-- listes ressort « a classer » dans admin_test_company_inventory() (elle est purgee, jamais copiee).
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

-- Les tables « societe » (portent company_id).
create or replace function public._tc_company_tables()
returns setof text language sql stable set search_path = public, pg_temp as $$
  select c.relname::text from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped);
$$;

-- Une table copiee a besoin d une correspondance d id si une table copiee pointe vers elle.
create or replace function public._tc_needs_map(_tbl text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1
      from pg_constraint k
      join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[1]
     where k.contype = 'f' and array_length(k.conkey, 1) = 1
       and k.confrelid = to_regclass('public.' || quote_ident(_tbl))
       and af.attname = 'id'
       and k.conrelid in (select to_regclass('public.' || quote_ident(x.tbl)) from public._tc_spec() x));
$$;

-- Expressions particulieres (neutralisation, remise a zero, coupure des envois). Alias source : s ;
-- $1 = societe de test, $2 = source.
create or replace function public._tc_override(_tbl text, _col text)
returns text language sql immutable as $$
  select case
    -- numerotations : prefixe TEST, compteur au depart
    when _tbl = 'document_sequences' and _col = 'prefix' then $e$'TEST' || coalesce(s.prefix, '')$e$
    when _tbl = 'document_sequences' and _col = 'next_value' then '1'
    when _tbl = 'document_sequences' and _col = 'last_issued_at' then 'null'
    -- envois coupes
    when _tbl = 'followup_settings' and _col = 'mode' then $e$'arrete'$e$
    when _tbl = 'followup_settings' and _col = 'test_recipient' then 'null'
    when _tbl = 'sms_settings' and _col = 'mode' then $e$'arrete'$e$
    when _tbl = 'sms_settings' and _col = 'test_recipient' then 'null'
    when _tbl = 'receivable_settings' and _col = 'dunning_mode' then $e$'arrete'$e$
    when _tbl = 'receivable_settings' and _col = 'dunning_test_recipient' then 'null'
    when _tbl = 'accounting_transfer_settings' and _col = 'params' then
      $e$jsonb_set(coalesce(s.params, '{}'::jsonb), '{auto}', '{"frequency": "off", "sendEmail": false, "email": ""}'::jsonb)$e$
    -- contacts : e-mails et telephones neutralises, aucun envoi possible
    when _tbl = 'contacts' and _col = 'email' then
      $e$case when nullif(btrim(s.email), '') is null then null else 'test+' || public._tc_map($1, s.id)::text || '@invalid.local' end$e$
    when _tbl = 'contacts' and _col = 'email_pro' then
      $e$case when nullif(btrim(s.email_pro), '') is null then null else 'test+' || public._tc_map($1, s.id)::text || '.pro@invalid.local' end$e$
    when _tbl = 'contacts' and _col = 'my_ducati_email' then
      $e$case when nullif(btrim(s.my_ducati_email), '') is null then null else 'test+' || public._tc_map($1, s.id)::text || '.myducati@invalid.local' end$e$
    when _tbl = 'contacts' and _col in ('phone', 'mobile', 'gsm', 'phone_pro', 'mobile_pro', 'fax', 'my_ducati_phone') then
      format($e$case when nullif(btrim(s.%1$I), '') is null then null else '+00' || lpad((abs(hashtext($1::text || s.id::text || %2$L)) %% 1000000000)::text, 9, '0') end$e$, _col, _col)
    when _tbl = 'contacts' and _col = 'my_ducati_data' then 'null'
    when _tbl = 'contacts' and _col in ('license_scan_path', 'national_id_scan_path') then 'null'
    when _tbl = 'contacts' and _col = 'marketing_opt_out' then 'true'
    when _tbl = 'contact_subcontacts' and _col = 'email' then
      $e$case when nullif(btrim(s.email), '') is null then null else 'test+' || md5($1::text || s.id::text) || '@invalid.local' end$e$
    when _tbl in ('contact_subcontacts', 'tradein_partners', 'insurance_parties') and _col in ('phone', 'phone2', 'fax') then
      format($e$case when nullif(btrim(s.%1$I), '') is null then null else '+00' || lpad((abs(hashtext($1::text || s.id::text || %2$L)) %% 1000000000)::text, 9, '0') end$e$, _col, _col)
    when _tbl in ('tradein_partners', 'insurance_parties') and _col = 'email' then
      $e$case when nullif(btrim(s.email), '') is null then null else 'test+' || md5($1::text || s.id::text) || '@invalid.local' end$e$
    when _tbl = 'tradein_partners' and _col = 'extra_contacts' then
      $e$case when s.extra_contacts is null then null else '[]'::jsonb end$e$
    -- articles : groupe d equivalence propre a la societe de test
    when _tbl = 'articles' and _col = 'equivalence_group' then
      $e$case when s.equivalence_group is null then null
              else coalesce(public._tc_map($1, s.equivalence_group), md5($1::text || s.equivalence_group::text)::uuid) end$e$
    -- registre : la source (reprise, reception...) n est pas copiee, sauf si c est une ligne copiee
    when _tbl = 'vehicle_register' and _col = 'source_id' then 'public._tc_map($1, s.source_id)'
    -- versions de kits : les articles cites dans le JSON pointent vers les articles copies
    when _tbl = 'maintenance_kit_versions' and _col = 'items' then 'public._tc_remap_items($1, s.items)'
  end;
$$;

create or replace function public._tc_remap_items(_target uuid, _items jsonb)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select case
    when _items is null or jsonb_typeof(_items) <> 'array' then _items
    else coalesce((
      select jsonb_agg(
               case when jsonb_typeof(e) = 'object' and e ? 'article_id' and jsonb_typeof(e -> 'article_id') = 'string'
                    then jsonb_set(e, '{article_id}', coalesce(to_jsonb(public._tc_map(_target, (e ->> 'article_id')::uuid)), 'null'::jsonb))
                    else e end
               order by o)
        from jsonb_array_elements(_items) with ordinality as t(e, o)), '[]'::jsonb)
  end;
$$;

-- Requete de copie d une table (INSERT ... SELECT, ids nouveaux, liens recables).
-- Parametres a l execution : $1 cible, $2 source, $3 curseur (uuid), $4 taille du lot.
-- Renvoie (dernier id source traite, lignes lues, lignes inserees).
create or replace function public._tc_copy_sql(_tbl text, _parent_col text, _parent_tbl text, _extra text)
returns text language plpgsql stable set search_path = public, pg_temp as $$
declare
  _rel regclass := to_regclass('public.' || quote_ident(_tbl));
  _cols text[] := '{}'; _exprs text[] := '{}'; _where text[] := '{}';
  _filter text; _e text; r record;
  _has_company boolean; _has_id boolean; _map boolean;
begin
  if _rel is null then return null; end if;
  _has_company := exists (select 1 from pg_attribute where attrelid = _rel and attname = 'company_id' and not attisdropped);
  _has_id := exists (select 1 from pg_attribute where attrelid = _rel and attname = 'id' and atttypid = 'uuid'::regtype and not attisdropped);
  _map := public._tc_needs_map(_tbl);

  for r in
    select a.attname::text as col, a.attnotnull as nn,
           k.confrelid::regclass::text as reft, af.attname::text as refcol
      from pg_attribute a
      left join lateral (
        select c.confrelid, c.confkey from pg_constraint c
         where c.conrelid = _rel and c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.conkey[1] = a.attnum
         limit 1) k on true
      left join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[1]
     where a.attrelid = _rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity <> 'a'
     order by a.attnum
  loop
    _e := public._tc_override(_tbl, r.col);
    if _e is null then
      if r.col = 'id' and _has_id then
        _e := case when _map then 'public._tc_map($1, s.id)' else 'gen_random_uuid()' end;
      elsif r.col = 'company_id' then
        _e := '$1';
      elsif r.reft is not null then
        if r.reft in ('companies', 'public.companies') then
          _e := format('case when s.%1$I = $2 then $1 else s.%1$I end', r.col);
        elsif r.refcol = 'id' and exists (select 1 from public._tc_spec() x where to_regclass('public.' || quote_ident(x.tbl)) = to_regclass(r.reft)) then
          _e := format('public._tc_map($1, s.%I)', r.col);
          if r.nn then _where := _where || format('public._tc_map($1, s.%I) is not null', r.col); end if;
        elsif exists (select 1 from pg_attribute a2 where a2.attrelid = to_regclass(r.reft) and a2.attname = 'company_id' and not a2.attisdropped) then
          -- lien vers une table de la societe qui n est PAS copiee (historique) : coupe
          _e := 'null';
          if r.nn then _where := _where || 'false'; end if;
        else
          _e := format('s.%I', r.col);   -- table commune (catalogue Ducati, comptes utilisateurs...)
        end if;
      else
        _e := format('s.%I', r.col);
      end if;
    end if;
    _cols := _cols || quote_ident(r.col);
    _exprs := _exprs || _e;
  end loop;

  if _has_company then
    _filter := 's.company_id = $2';
  else
    _filter := format('exists (select 1 from public.%I p where p.id = s.%I and p.company_id = $2)', _parent_tbl, _parent_col);
  end if;
  if _extra is not null then _filter := _filter || ' and (' || _extra || ')'; end if;

  if _has_id then
    return format($q$with src as (select * from public.%1$I s where %2$s and ($3::uuid is null or s.id > $3::uuid) order by s.id limit $4),
                       ins as (insert into public.%1$I (%3$s) select %4$s from src s %5$s returning 1)
                  select (select s.id from src s order by s.id desc limit 1), (select count(*) from src)::int, (select count(*) from ins)::int$q$,
                  _tbl, _filter, array_to_string(_cols, ', '), array_to_string(_exprs, ', '),
                  case when cardinality(_where) > 0 then 'where ' || array_to_string(_where, ' and ') else '' end);
  else
    return format($q$with src as (select * from public.%1$I s where %2$s),
                       ins as (insert into public.%1$I (%3$s) select %4$s from src s %5$s returning 1)
                  select null::uuid, (select count(*) from src)::int, (select count(*) from ins)::int$q$,
                  _tbl, _filter, array_to_string(_cols, ', '), array_to_string(_exprs, ', '),
                  case when cardinality(_where) > 0 then 'where ' || array_to_string(_where, ' and ') else '' end);
  end if;
end $$;

-- Requete de pre-correspondance (memes parametres).
create or replace function public._tc_map_sql(_tbl text, _parent_col text, _parent_tbl text, _extra text)
returns text language plpgsql stable set search_path = public, pg_temp as $$
declare _filter text; _rel regclass := to_regclass('public.' || quote_ident(_tbl));
begin
  if _rel is null then return null; end if;
  if exists (select 1 from pg_attribute where attrelid = _rel and attname = 'company_id' and not attisdropped) then
    _filter := 's.company_id = $2';
  else
    _filter := format('exists (select 1 from public.%I p where p.id = s.%I and p.company_id = $2)', _parent_tbl, _parent_col);
  end if;
  if _extra is not null then _filter := _filter || ' and (' || _extra || ')'; end if;
  return format($q$with src as (select s.id from public.%1$I s where %2$s and ($3::uuid is null or s.id > $3::uuid) order by s.id limit $4),
                     ins as (insert into public.test_company_id_map (target_company_id, old_id, new_id, tbl)
                             select $1, s.id, gen_random_uuid(), %3$L from src s on conflict do nothing returning 1)
                select (select s.id from src s order by s.id desc limit 1), (select count(*) from src)::int, (select count(*) from ins)::int$q$,
                _tbl, _filter, _tbl);
end $$;

-- Controles « liens croises » avant purge : une ligne d une AUTRE societe qui pointe vers une ligne
-- de la societe de test bloque la purge (on ne casse jamais une donnee reelle).
create or replace function public._tc_cross_checks()
returns setof text language plpgsql stable set search_path = public, pg_temp as $$
declare r record; r2 record;
begin
  for r in
    select k.conrelid::regclass::text as t, a.attname::text as col, k.confrelid::regclass::text as p, af.attname::text as pcol,
           exists (select 1 from pg_attribute x where x.attrelid = k.conrelid and x.attname = 'company_id' and not x.attisdropped) as t_company,
           k.conrelid as trel
      from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[1]
     where k.contype = 'f' and array_length(k.conkey, 1) = 1
       and k.connamespace = 'public'::regnamespace
       and (select relnamespace from pg_class where oid = k.confrelid) = 'public'::regnamespace
       and exists (select 1 from pg_attribute x where x.attrelid = k.confrelid and x.attname = 'company_id' and not x.attisdropped)
       and k.conrelid not in ('public.test_company_id_map'::regclass, 'public.test_companies'::regclass)
     order by 1, 2
  loop
    if r.t_company then
      return next format('select exists (select 1 from %s a join %s b on b.%I = a.%I where b.company_id = $1 and a.company_id is distinct from $1)',
                         r.t, r.p, r.pcol, r.col);
    else
      -- table sans company_id : une ligne rattachee a la societe de test ET a une autre societe
      for r2 in
        select a.attname::text as col, k.confrelid::regclass::text as p, af.attname::text as pcol
          from pg_constraint k
          join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
          join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[1]
         where k.conrelid = r.trel and k.contype = 'f' and array_length(k.conkey, 1) = 1
           and exists (select 1 from pg_attribute x where x.attrelid = k.confrelid and x.attname = 'company_id' and not x.attisdropped)
           and a.attname <> r.col
      loop
        return next format('select exists (select 1 from %s a join %s b on b.%I = a.%I join %s c on c.%I = a.%I where b.company_id = $1 and c.company_id is distinct from $1)',
                           r.t, r.p, r.pcol, r.col, r2.p, r2.pcol, r2.col);
      end loop;
    end if;
  end loop;
end $$;

-- Purge de la societe de test : d abord les tables sans company_id rattachees a une ligne de la
-- societe, puis toutes les tables portant company_id (sauf les droits), puis la correspondance.
-- $1 = societe de test, $2 = taille du lot.
create or replace function public._tc_purge_statements()
returns setof text language plpgsql stable set search_path = public, pg_temp as $$
declare r record;
begin
  for r in
    select k.conrelid::regclass::text as t, a.attname::text as col, k.confrelid::regclass::text as p, af.attname::text as pcol
      from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[1]
     where k.contype = 'f' and array_length(k.conkey, 1) = 1
       and k.connamespace = 'public'::regnamespace
       and (select relnamespace from pg_class where oid = k.confrelid) = 'public'::regnamespace
       and not exists (select 1 from pg_attribute x where x.attrelid = k.conrelid and x.attname = 'company_id' and not x.attisdropped)
       and exists (select 1 from pg_attribute x where x.attrelid = k.confrelid and x.attname = 'company_id' and not x.attisdropped)
       and k.conrelid not in ('public.profiles'::regclass, 'public.companies'::regclass)
     order by 1, 2
  loop
    return next format('delete from %1$s where ctid = any (array(select c.ctid from %1$s c where c.%2$I in (select b.%3$I from %4$s b where b.company_id = $1) limit $2))',
                       r.t, r.col, r.pcol, r.p);
  end loop;
  for r in
    select t from public._tc_company_tables() t
     where t not in ('user_roles', 'test_companies', 'test_company_id_map') order by 1
  loop
    return next format('delete from public.%1$I where ctid = any (array(select ctid from public.%1$I where company_id = $1 limit $2))', r.t);
  end loop;
  return next 'delete from public.test_company_id_map where ctid = any (array(select ctid from public.test_company_id_map where target_company_id = $1 limit $2))';
end $$;

-- ---------------------------------------------------------------------
-- 5. La machine a etapes (mode replica, garde-fou « societe de test »)
-- ---------------------------------------------------------------------
create or replace function public._tc_run(_target uuid, _deadline timestamptz)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  st public.test_companies%rowtype;
  _phase text; _ord int; _cursor uuid; _progress jsonb;
  _sql text; _last uuid; _read int; _ins int; _n int; _flag boolean;
  _checks text[]; _purge text[]; r record; _err text;
  _spec_ords int[];
  _it_start timestamptz; _last_dur interval := interval '0'; _iters int := 0;
begin
  select * into st from public.test_companies where company_id = _target for update;
  if not found then
    raise exception 'Garde-fou : la societe % n est pas marquee « test », rien n est supprime ni copie.', _target using errcode = '42501';
  end if;
  if st.source_company_id = _target then
    raise exception 'Garde-fou : source et cible identiques.' using errcode = '42501';
  end if;
  if st.status = 'pret' then
    return jsonb_build_object('company_id', _target, 'status', st.status, 'phase', st.phase, 'progress', st.progress, 'done', true);
  end if;

  _phase := coalesce(st.phase, 'controle'); _ord := st.step_ord; _cursor := st.step_cursor; _progress := st.progress;
  -- Mode replica : declencheurs metier coupes pendant la purge et la copie de la SEULE societe de
  -- test (les garde-fous ENABLE ALWAYS restent actifs). Retour a « origin » avant chaque sortie.
  set local session_replication_role = replica;
  if not (_progress ? 'copied') then _progress := _progress || '{"copied": {}}'::jsonb; end if;

  begin
    <<machine>>
    loop
      -- budget : on ne lance pas un lot qui, au rythme du precedent, depasserait l echeance
      -- (le premier lot de l appel part toujours) ; l ecran reste ainsi sous la limite de 8 s.
      exit machine when _iters > 0 and clock_timestamp() + _last_dur * 1.5 > _deadline;
      _iters := _iters + 1;
      _it_start := clock_timestamp();

      if _phase = 'controle' then
        if _checks is null then select coalesce(array_agg(x), '{}') into _checks from public._tc_cross_checks() x; end if;
        if _ord >= coalesce(cardinality(_checks), 0) then
          _phase := 'purge'; _ord := 0; _cursor := null;
        else
          execute _checks[_ord + 1] into _flag using _target;
          if _flag then
            raise exception 'Garde-fou : une donnee d une autre societe pointe vers la societe de test (%). Purge refusee.', _checks[_ord + 1]
              using errcode = '42501';
          end if;
          _ord := _ord + 1;
        end if;

      elsif _phase = 'purge' then
        -- revalidation a chaque lot : jamais de suppression hors societe de test
        if not exists (select 1 from public.test_companies where company_id = _target) then
          raise exception 'Garde-fou : societe non marquee « test ».' using errcode = '42501';
        end if;
        if _purge is null then select array_agg(x) into _purge from public._tc_purge_statements() x; end if;
        if _ord >= cardinality(_purge) then
          _phase := 'societe'; _ord := 0; _cursor := null;
        else
          execute _purge[_ord + 1] using _target, 5000;
          get diagnostics _n = row_count;
          _progress := jsonb_set(_progress, '{purged}', to_jsonb(coalesce((_progress ->> 'purged')::bigint, 0) + _n));
          if _n < 5000 then _ord := _ord + 1; end if;
        end if;

      elsif _phase = 'societe' then
        -- fiche societe : reprise de la source, sauf identite, boites mail, Peppol, comptable, SEPA
        select string_agg(format('%1$I = s.%1$I', a.attname), ', ') into _sql
          from pg_attribute a
         where a.attrelid = 'public.companies'::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
           and a.attname not in ('id', 'code', 'name', 'legal_name', 'created_at', 'updated_at', 'is_active',
                                 'inbound_mailbox', 'inbound_last_check', 'sent_last_check', 'accountant_email',
                                 'peppol_id', 'sepa_creditor_id');
        execute format('update public.companies t set %s, updated_at = now(), is_active = true,
                          legal_name = t.name || '' (societe de test)'', inbound_mailbox = null, inbound_last_check = null,
                          sent_last_check = null, accountant_email = null, peppol_id = null, sepa_creditor_id = null
                        from public.companies s where s.id = $2 and t.id = $1', _sql)
          using _target, st.source_company_id;
        select array_agg(x.ord order by x.ord) into _spec_ords from public._tc_spec() x
         where to_regclass('public.' || quote_ident(x.tbl)) is not null and public._tc_needs_map(x.tbl);
        _phase := 'map'; _ord := coalesce(_spec_ords[1], 0); _cursor := null;

      elsif _phase = 'map' then
        select x.* into r from public._tc_spec() x
         where x.ord >= _ord and to_regclass('public.' || quote_ident(x.tbl)) is not null and public._tc_needs_map(x.tbl)
         order by x.ord limit 1;
        if not found then
          -- statistiques fraiches : les recherches dans la correspondance passent par l index
          analyze public.test_company_id_map;
          _phase := 'copie'; _ord := 0; _cursor := null;
        else
          if r.ord <> _ord then _ord := r.ord; _cursor := null; end if;
          _sql := public._tc_map_sql(r.tbl, r.parent_col, r.parent_tbl, r.extra);
          execute _sql into _last, _read, _ins using _target, st.source_company_id, _cursor, greatest(r.batch, 1000) * 5;
          if _read < greatest(r.batch, 1000) * 5 then _ord := r.ord + 1; _cursor := null; else _cursor := _last; end if;
        end if;

      elsif _phase = 'copie' then
        select x.* into r from public._tc_spec() x
         where x.ord >= _ord and to_regclass('public.' || quote_ident(x.tbl)) is not null
         order by x.ord limit 1;
        if not found then
          _phase := 'stock'; _ord := 0; _cursor := null;
        else
          if r.ord <> _ord then _ord := r.ord; _cursor := null; end if;
          _sql := public._tc_copy_sql(r.tbl, r.parent_col, r.parent_tbl, r.extra);
          execute _sql into _last, _read, _ins using _target, st.source_company_id, _cursor, r.batch;
          _progress := jsonb_set(_progress, array['copied', r.tbl],
                                 to_jsonb(coalesce((_progress #>> array['copied', r.tbl])::bigint, 0) + _ins), true);
          if _last is null or _read < r.batch then _ord := r.ord + 1; _cursor := null; else _cursor := _last; end if;
        end if;

      elsif _phase = 'stock' then
        -- un mouvement d ouverture par article dont le stock reel source est non nul (B7 append-only)
        with a as (
          select s.id from public.articles s
           where s.company_id = st.source_company_id and (_cursor is null or s.id > _cursor)
           order by s.id limit 5000),
        q as (
          select m.article_id, sum(m.qty_delta) as qty
            from public.stock_moves m join a on a.id = m.article_id
           where m.company_id = st.source_company_id and not m.is_reservation
           group by m.article_id having sum(m.qty_delta) <> 0),
        ins as (
          insert into public.stock_moves (company_id, article_id, move_type, qty_delta, is_reservation, unit_cost,
                                          bin_location, origin, ref, note, operator_id, occurred_at)
          select _target, public._tc_map(_target, q.article_id), 'inventaire', q.qty, false,
                 case when ar.mgmt_type::text = 'D' then null else ar.pamp end,
                 ar.bin_location, 'ouverture_societe_test', 'OUVERTURE-TEST',
                 'Stock d ouverture de la societe de test (copie du stock reel de la source)', st.refreshed_by, now()
            from q join public.articles ar on ar.id = q.article_id
           where public._tc_map(_target, q.article_id) is not null
          returning 1)
        select (select a.id from a order by a.id desc limit 1), (select count(*) from a)::int, (select count(*) from ins)::int
          into _last, _read, _ins;
        _progress := jsonb_set(_progress, '{copied,stock_moves}',
                               to_jsonb(coalesce((_progress #>> '{copied,stock_moves}')::bigint, 0) + _ins), true);
        if _read < 5000 then
          analyze public.articles; analyze public.contacts; analyze public.vehicles; analyze public.stock_moves;
          _phase := 'fin'; _ord := 0; _cursor := null;
        else _cursor := _last; end if;

      elsif _phase = 'fin' then
        _progress := _progress || jsonb_build_object('finished_at', now());
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_target, st.refreshed_by, 'test_company_refreshed', 'companies', _target::text, 'system', null,
                jsonb_build_object('source', st.source_company_id) || _progress);
        update public.test_companies
           set status = 'pret', phase = 'fin', step_ord = 0, step_cursor = null, progress = _progress,
               finished_at = now(), last_error = null
         where company_id = _target;
        set local session_replication_role = origin;
        return jsonb_build_object('company_id', _target, 'status', 'pret', 'phase', 'fin', 'progress', _progress, 'done', true);
      else
        raise exception 'Societe de test : etape inconnue %', _phase;
      end if;
      _last_dur := clock_timestamp() - _it_start;
      -- lot le plus long (suivi de la limite de 8 s de l ecran)
      if extract(epoch from _last_dur) * 1000 > coalesce((_progress ->> 'max_batch_ms')::numeric, 0) then
        _progress := _progress || jsonb_build_object('max_batch_ms', round(extract(epoch from _last_dur) * 1000),
                                                     'max_batch_at', _phase || ':' || _ord);
      end if;
    end loop;

    update public.test_companies
       set status = 'en_cours', phase = _phase, step_ord = _ord, step_cursor = _cursor, progress = _progress
     where company_id = _target;
    set local session_replication_role = origin;
    return jsonb_build_object('company_id', _target, 'status', 'en_cours', 'phase', _phase, 'step', _ord, 'progress', _progress, 'done', false);
  exception when others then
    get stacked diagnostics _err = message_text;
    update public.test_companies set status = 'erreur', last_error = left(_err, 2000) where company_id = _target;
    set local session_replication_role = origin;
    return jsonb_build_object('company_id', _target, 'status', 'erreur', 'phase', _phase, 'error', _err, 'done', false);
  end;
end $$;

-- ---------------------------------------------------------------------
-- 6. Fonctions appelables (administrateurs)
-- ---------------------------------------------------------------------
-- Cree la societe de test si besoin (sinon la retrouve), donne le role admin aux administrateurs de
-- la source, et (re)lance la machine a etapes depuis le debut. Rapide (< 1 s).
create or replace function public.admin_test_company_start(_source uuid, _target_name text default 'ItalTest')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare _target uuid; _name text := btrim(coalesce(_target_name, '')); _code text;
begin
  if auth.uid() is not null and not public.is_admin(_source) then
    raise exception 'Reserve aux administrateurs de la societe source.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.companies where id = _source) then
    raise exception 'Societe source inconnue.' using errcode = 'P0002';
  end if;
  if public.is_test_company(_source) then
    raise exception 'La source est elle-meme une societe de test.' using errcode = '42501';
  end if;
  if _name = '' then raise exception 'Nom de la societe de test manquant.' using errcode = '22023'; end if;

  select t.company_id into _target
    from public.test_companies t join public.companies c on c.id = t.company_id
   where t.source_company_id = _source and lower(c.name) = lower(_name)
   limit 1;

  if _target is null then
    if exists (select 1 from public.companies where lower(name) = lower(_name)) then
      raise exception 'Une societe « % » existe deja et n est pas une societe de test : refus.', _name using errcode = '42501';
    end if;
    _code := upper(regexp_replace(_name, '[^A-Za-z0-9]', '', 'g'));
    if _code = '' then _code := 'TEST'; end if;
    if exists (select 1 from public.companies where code = _code) then
      raise exception 'Le code societe % est deja pris.', _code using errcode = '23505';
    end if;
    insert into public.companies (code, name, legal_name, is_active)
    values (_code, _name, _name || ' (societe de test)', true)
    returning id into _target;
    insert into public.test_companies (company_id, source_company_id) values (_target, _source);
  end if;

  -- administrateurs de la source (+ l appelant) : admin dans la societe de test, aucun compte cree
  insert into public.user_roles (user_id, company_id, role)
  select distinct r.user_id, _target, 'admin'::public.app_role
    from public.user_roles r where r.company_id = _source and r.role = 'admin'
  on conflict do nothing;
  if auth.uid() is not null then
    insert into public.user_roles (user_id, company_id, role) values (auth.uid(), _target, 'admin') on conflict do nothing;
  end if;

  update public.test_companies
     set status = 'en_cours', phase = 'controle', step_ord = 0, step_cursor = null,
         progress = jsonb_build_object('started_at', now(), 'purged', 0, 'copied', '{}'::jsonb), last_error = null,
         started_at = now(), finished_at = null, refreshed_by = auth.uid()
   where company_id = _target;
  return _target;
end $$;

-- Fait avancer la copie pendant _budget_ms (4 s depuis l ecran, 85 s depuis l API SQL).
create or replace function public.admin_test_company_step(_target uuid, _budget_ms integer default 4000)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_admin(_target) then
    raise exception 'Reserve aux administrateurs.' using errcode = '42501';
  end if;
  return public._tc_run(_target, clock_timestamp() + make_interval(secs => greatest(coalesce(_budget_ms, 4000), 500) / 1000.0));
end $$;

-- Tout d un coup (API SQL) : cree ou rafraichit la societe de test et copie le referentiel.
create or replace function public.admin_clone_company_for_test(_source uuid, _target_name text default 'ItalTest', _budget_ms integer default 85000)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _target uuid;
begin
  _target := public.admin_test_company_start(_source, _target_name);
  return public._tc_run(_target, clock_timestamp() + make_interval(secs => greatest(coalesce(_budget_ms, 85000), 500) / 1000.0));
end $$;

-- Inventaire : chaque table portant company_id (et chaque table rattachee), copiee ou non, pourquoi.
create or replace function public.admin_test_company_inventory()
returns table(tbl text, decision text, reason text)
language sql stable security definer set search_path = public, pg_temp as $$
  with t as (
    select x as tbl from public._tc_company_tables() x
    union
    select s.tbl from public._tc_spec() s where to_regclass('public.' || quote_ident(s.tbl)) is not null
  )
  select t.tbl,
         case when s.tbl is not null then 'copiee' when k.tbl is not null then 'non copiee'
              when t.tbl in ('test_companies', 'test_company_id_map') then 'technique' else 'a classer' end,
         coalesce(s.reason, k.reason,
                  case when t.tbl in ('test_companies', 'test_company_id_map') then 'Marquage et correspondance de la copie'
                       else 'Table nouvelle : purgee dans la societe de test, jamais copiee (a classer)' end)
    from t
    left join public._tc_spec() s on s.tbl = t.tbl
    left join public._tc_skip() k on k.tbl = t.tbl
   order by 2, 1;
$$;

-- ---------------------------------------------------------------------
-- 7. Droits d execution
-- ---------------------------------------------------------------------
revoke all on function public._test_companies_guard() from public, anon, authenticated;
revoke all on function public._test_company_block_notification() from public, anon, authenticated;
revoke all on function public._test_company_force_off() from public, anon, authenticated;
revoke all on function public._tc_map(uuid, uuid) from public, anon, authenticated;
revoke all on function public._tc_spec() from public, anon, authenticated;
revoke all on function public._tc_skip() from public, anon, authenticated;
revoke all on function public._tc_company_tables() from public, anon, authenticated;
revoke all on function public._tc_needs_map(text) from public, anon, authenticated;
revoke all on function public._tc_override(text, text) from public, anon, authenticated;
revoke all on function public._tc_remap_items(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._tc_copy_sql(text, text, text, text) from public, anon, authenticated;
revoke all on function public._tc_map_sql(text, text, text, text) from public, anon, authenticated;
revoke all on function public._tc_cross_checks() from public, anon, authenticated;
revoke all on function public._tc_purge_statements() from public, anon, authenticated;
revoke all on function public._tc_run(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.is_test_company(uuid) from public, anon;
grant execute on function public.is_test_company(uuid) to authenticated, service_role;
revoke all on function public.admin_test_company_start(uuid, text) from public, anon;
revoke all on function public.admin_test_company_step(uuid, integer) from public, anon;
revoke all on function public.admin_clone_company_for_test(uuid, text, integer) from public, anon;
revoke all on function public.admin_test_company_inventory() from public, anon;
grant execute on function public.admin_test_company_start(uuid, text) to authenticated, service_role;
grant execute on function public.admin_test_company_step(uuid, integer) to authenticated, service_role;
grant execute on function public.admin_clone_company_for_test(uuid, text, integer) to authenticated, service_role;
grant execute on function public.admin_test_company_inventory() to authenticated, service_role;
grant select on public.test_companies to service_role;
