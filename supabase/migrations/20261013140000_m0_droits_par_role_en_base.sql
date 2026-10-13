-- M0 — Droits par rôle jusque dans la base (grille validée par le client).
--
-- Jusqu'ici, toute personne membre de la société pouvait écrire partout : la
-- restriction n'existait que dans l'interface. On la descend ici, pour que
-- l'API refuse aussi, et pas seulement les écrans.
--
-- Deux tables de référence, lisibles par un non-technicien :
--   * `page_permissions`  : la grille elle-même (page, rôle, niveau) ;
--   * `table_write_pages` : par quelles pages une table peut être écrite.
-- Une table remplie depuis plusieurs écrans (une fiche client se crée aussi
-- bien depuis Contacts que depuis la caisse) porte plusieurs lignes : pouvoir
-- écrire sur L'UNE de ces pages suffit. C'est volontairement large au départ ;
-- resserrer plus tard consiste à retirer une ligne, pas à réécrire une
-- politique.
--
-- La lecture n'est pas touchée : qui voit quoi reste `is_member(company_id)`.

create table if not exists public.page_permissions (
  page  text not null,
  role  text not null,
  level text not null check (level in ('read', 'write')),
  primary key (page, role)
);
comment on table public.page_permissions is
  'Grille des droits par role validee par le client (voir src/lib/auth/permissions.ts).';

create table if not exists public.table_write_pages (
  table_name text not null,
  page       text not null,
  primary key (table_name, page)
);
comment on table public.table_write_pages is
  'Pages depuis lesquelles une table peut legitimement etre ecrite.';

alter table public.page_permissions enable row level security;
alter table public.table_write_pages enable row level security;
drop policy if exists page_permissions_read on public.page_permissions;
create policy page_permissions_read on public.page_permissions for select to authenticated using (true);
drop policy if exists table_write_pages_read on public.table_write_pages;
create policy table_write_pages_read on public.table_write_pages for select to authenticated using (true);

-- La grille, telle qu'elle est codée côté application.
delete from public.page_permissions;
insert into public.page_permissions (page, role, level) values
  ('/dashboard', 'vendeur', 'write'),
  ('/dashboard', 'magasinier', 'write'),
  ('/dashboard', 'mecanicien', 'write'),
  ('/dashboard', 'chef_atelier', 'write'),
  ('/dashboard', 'comptable', 'write'),
  ('/dashboard', 'marketing', 'write'),
  ('/vehicles', 'vendeur', 'write'),
  ('/vehicles', 'magasinier', 'read'),
  ('/vehicles', 'mecanicien', 'read'),
  ('/vehicles', 'chef_atelier', 'read'),
  ('/vehicles', 'comptable', 'read'),
  ('/vehicles', 'marketing', 'read'),
  ('/tradein', 'vendeur', 'write'),
  ('/tradein', 'chef_atelier', 'read'),
  ('/tradein', 'comptable', 'read'),
  ('/workshop', 'mecanicien', 'write'),
  ('/workshop', 'chef_atelier', 'write'),
  ('/workshop', 'vendeur', 'read'),
  ('/workshop', 'magasinier', 'read'),
  ('/workshop', 'comptable', 'read'),
  ('/parts/links', 'magasinier', 'write'),
  ('/parts/links', 'mecanicien', 'read'),
  ('/parts/links', 'chef_atelier', 'read'),
  ('/parts', 'magasinier', 'write'),
  ('/parts', 'chef_atelier', 'write'),
  ('/parts', 'comptable', 'write'),
  ('/parts', 'vendeur', 'read'),
  ('/parts', 'mecanicien', 'read'),
  ('/parts', 'marketing', 'read'),
  ('/purchases', 'magasinier', 'write'),
  ('/purchases', 'mecanicien', 'write'),
  ('/purchases', 'chef_atelier', 'write'),
  ('/purchases', 'comptable', 'read'),
  ('/orders', 'vendeur', 'write'),
  ('/orders', 'magasinier', 'write'),
  ('/orders', 'mecanicien', 'write'),
  ('/orders', 'chef_atelier', 'write'),
  ('/orders', 'comptable', 'read'),
  ('/stock', 'magasinier', 'write'),
  ('/stock', 'mecanicien', 'write'),
  ('/stock', 'chef_atelier', 'write'),
  ('/stock', 'vendeur', 'read'),
  ('/stock', 'comptable', 'read'),
  ('/stock', 'marketing', 'read'),
  ('/sales/balances', 'vendeur', 'write'),
  ('/sales/balances', 'magasinier', 'write'),
  ('/sales/balances', 'mecanicien', 'write'),
  ('/sales/balances', 'chef_atelier', 'write'),
  ('/sales/balances', 'comptable', 'write'),
  ('/sales/web-orders', 'vendeur', 'write'),
  ('/sales/web-orders', 'magasinier', 'write'),
  ('/sales/web-orders', 'comptable', 'read'),
  ('/sales/web-orders', 'marketing', 'read'),
  ('/sales', 'vendeur', 'write'),
  ('/sales', 'mecanicien', 'write'),
  ('/sales', 'chef_atelier', 'write'),
  ('/sales', 'magasinier', 'read'),
  ('/sales', 'comptable', 'read'),
  ('/picking', 'vendeur', 'write'),
  ('/picking', 'magasinier', 'write'),
  ('/picking', 'mecanicien', 'write'),
  ('/picking', 'chef_atelier', 'write'),
  ('/clients', 'vendeur', 'write'),
  ('/clients', 'chef_atelier', 'write'),
  ('/clients', 'marketing', 'write'),
  ('/clients', 'magasinier', 'read'),
  ('/clients', 'mecanicien', 'read'),
  ('/clients', 'comptable', 'read'),
  ('/crm', 'vendeur', 'write'),
  ('/crm', 'marketing', 'write'),
  ('/pos', 'vendeur', 'write'),
  ('/pos', 'magasinier', 'write'),
  ('/pos', 'mecanicien', 'write'),
  ('/pos', 'chef_atelier', 'write'),
  ('/pos', 'comptable', 'write'),
  ('/reports', 'comptable', 'write'),
  ('/reports', 'vendeur', 'read'),
  ('/reports', 'magasinier', 'read'),
  ('/reports', 'chef_atelier', 'read'),
  ('/reports', 'marketing', 'read'),
  ('/accounting', 'comptable', 'write');

-- Quelle page autorise l'écriture de quelle table.
delete from public.table_write_pages;
insert into public.table_write_pages (table_name, page) values
  ('account_mappings', '/accounting'),
  ('accounting_entries', '/accounting'),
  ('accounting_exports', '/accounting'),
  ('articles', '/parts'),
  ('articles', '/purchases'),
  ('articles', '/stock'),
  ('articles', '/sales'),
  ('articles', '/orders'),
  ('cash_movements', '/pos'),
  ('cash_sessions', '/pos'),
  ('chart_of_accounts', '/accounting'),
  ('communications', '/clients'),
  ('communications', '/crm'),
  ('contacts', '/clients'),
  ('contacts', '/sales'),
  ('contacts', '/pos'),
  ('contacts', '/crm'),
  ('contacts', '/workshop'),
  ('contacts', '/tradein'),
  ('contacts', '/purchases'),
  ('documents', '/sales'),
  ('documents', '/pos'),
  ('documents', '/purchases'),
  ('documents', '/tradein'),
  ('documents', '/accounting'),
  ('fiscal_closures', '/accounting'),
  ('inventory_sessions', '/stock'),
  ('label_queue', '/parts'),
  ('label_templates', '/parts'),
  ('lead_tasks', '/crm'),
  ('leads', '/crm'),
  ('oro', '/tradein'),
  ('oro', '/workshop'),
  ('part_orders', '/orders'),
  ('part_orders', '/workshop'),
  ('picking_lists', '/picking'),
  ('picking_lists', '/workshop'),
  ('price_changes', '/parts'),
  ('price_changes', '/stock'),
  ('price_changes', '/sales'),
  ('purchase_orders', '/purchases'),
  ('repair_orders', '/workshop'),
  ('stock_depreciations', '/stock'),
  ('stock_moves', '/stock'),
  ('stock_moves', '/sales'),
  ('stock_moves', '/pos'),
  ('stock_moves', '/purchases'),
  ('stock_moves', '/orders'),
  ('stock_moves', '/workshop'),
  ('stock_moves', '/picking'),
  ('vehicles', '/vehicles'),
  ('vehicles', '/sales'),
  ('vehicles', '/workshop'),
  ('vehicles', '/tradein'),
  ('vehicles', '/purchases'),
  ('workshop_appointments', '/workshop'),
  ('workshop_operations', '/workshop'),
  ('workshop_tasks', '/workshop'),
  ('workshop_time_entries', '/workshop');

-- Le droit d'écrire une table : administrateur, ou un rôle qui peut écrire sur
-- l'une des pages d'où cette table se remplit.
create or replace function public.can_write_table(_company uuid, _table text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select public.is_admin(_company)
      or exists (
        select 1
          from public.table_write_pages tp
          join public.page_permissions pp on pp.page = tp.page and pp.level = 'write'
          join public.user_roles ur
            on ur.role::text = pp.role and ur.company_id = _company and ur.user_id = auth.uid()
         where tp.table_name = _table
      );
$fn$;

grant execute on function public.can_write_table(uuid, text) to authenticated, service_role;

-- Les politiques d'écriture passent de « membre de la société » à « rôle autorisé ».

-- account_mappings — écrite depuis : /accounting
drop policy if exists acctmap_all on public.account_mappings;
create policy acctmap_all on public.account_mappings for all to authenticated
  using (public.can_write_table(company_id, 'account_mappings')) with check (public.can_write_table(company_id, 'account_mappings'));

-- accounting_entries — écrite depuis : /accounting
drop policy if exists acctentry_all on public.accounting_entries;
create policy acctentry_all on public.accounting_entries for all to authenticated
  using (public.can_write_table(company_id, 'accounting_entries')) with check (public.can_write_table(company_id, 'accounting_entries'));

-- accounting_exports — écrite depuis : /accounting
drop policy if exists acctexports_all on public.accounting_exports;
create policy acctexports_all on public.accounting_exports for all to authenticated
  using (public.can_write_table(company_id, 'accounting_exports')) with check (public.can_write_table(company_id, 'accounting_exports'));

-- articles — écrite depuis : /parts, /purchases, /stock, /sales, /orders
drop policy if exists articles_insert on public.articles;
drop policy if exists articles_update on public.articles;
create policy articles_insert on public.articles for insert to authenticated
  with check (public.can_write_table(company_id, 'articles'));
create policy articles_update on public.articles for update to authenticated
  using (public.can_write_table(company_id, 'articles')) with check (public.can_write_table(company_id, 'articles'));

-- cash_movements — écrite depuis : /pos
drop policy if exists cash_movements_all on public.cash_movements;
create policy cash_movements_all on public.cash_movements for all to authenticated
  using (public.can_write_table(company_id, 'cash_movements')) with check (public.can_write_table(company_id, 'cash_movements'));

-- cash_sessions — écrite depuis : /pos
drop policy if exists cash_sessions_all on public.cash_sessions;
create policy cash_sessions_all on public.cash_sessions for all to authenticated
  using (public.can_write_table(company_id, 'cash_sessions')) with check (public.can_write_table(company_id, 'cash_sessions'));

-- chart_of_accounts — écrite depuis : /accounting
drop policy if exists coa_all on public.chart_of_accounts;
create policy coa_all on public.chart_of_accounts for all to authenticated
  using (public.can_write_table(company_id, 'chart_of_accounts')) with check (public.can_write_table(company_id, 'chart_of_accounts'));

-- communications — écrite depuis : /clients, /crm
drop policy if exists comms_all on public.communications;
create policy comms_all on public.communications for all to authenticated
  using (public.can_write_table(company_id, 'communications')) with check (public.can_write_table(company_id, 'communications'));

-- contacts — écrite depuis : /clients, /sales, /pos, /crm, /workshop, /tradein, /purchases
drop policy if exists contacts_insert on public.contacts;
drop policy if exists contacts_update on public.contacts;
create policy contacts_insert on public.contacts for insert to authenticated
  with check (public.can_write_table(company_id, 'contacts'));
create policy contacts_update on public.contacts for update to authenticated
  using (public.can_write_table(company_id, 'contacts')) with check (public.can_write_table(company_id, 'contacts'));

-- documents — écrite depuis : /sales, /pos, /purchases, /tradein, /accounting
drop policy if exists documents_write on public.documents;
create policy documents_write on public.documents for all to authenticated
  using (public.can_write_table(company_id, 'documents')) with check (public.can_write_table(company_id, 'documents'));

-- fiscal_closures — écrite depuis : /accounting
drop policy if exists fiscal_closures_all on public.fiscal_closures;
create policy fiscal_closures_all on public.fiscal_closures for all to authenticated
  using (public.can_write_table(company_id, 'fiscal_closures')) with check (public.can_write_table(company_id, 'fiscal_closures'));

-- inventory_sessions — écrite depuis : /stock
drop policy if exists invsessions_all on public.inventory_sessions;
create policy invsessions_all on public.inventory_sessions for all to authenticated
  using (public.can_write_table(company_id, 'inventory_sessions')) with check (public.can_write_table(company_id, 'inventory_sessions'));

-- label_queue — écrite depuis : /parts
drop policy if exists label_queue_all on public.label_queue;
create policy label_queue_all on public.label_queue for all to authenticated
  using (public.can_write_table(company_id, 'label_queue')) with check (public.can_write_table(company_id, 'label_queue'));

-- label_templates — écrite depuis : /parts
drop policy if exists label_templates_insert on public.label_templates;
drop policy if exists label_templates_update on public.label_templates;
drop policy if exists label_templates_delete on public.label_templates;
create policy label_templates_insert on public.label_templates for insert to authenticated
  with check (public.can_write_table(company_id, 'label_templates'));
create policy label_templates_update on public.label_templates for update to authenticated
  using (public.can_write_table(company_id, 'label_templates')) with check (public.can_write_table(company_id, 'label_templates'));
create policy label_templates_delete on public.label_templates for delete to authenticated
  using (public.can_write_table(company_id, 'label_templates'));

-- lead_tasks — écrite depuis : /crm
drop policy if exists lead_tasks_all on public.lead_tasks;
create policy lead_tasks_all on public.lead_tasks for all to authenticated
  using (public.can_write_table(company_id, 'lead_tasks')) with check (public.can_write_table(company_id, 'lead_tasks'));

-- leads — écrite depuis : /crm
drop policy if exists leads_all on public.leads;
create policy leads_all on public.leads for all to authenticated
  using (public.can_write_table(company_id, 'leads')) with check (public.can_write_table(company_id, 'leads'));

-- oro — écrite depuis : /tradein, /workshop
drop policy if exists oro_all on public.oro;
create policy oro_all on public.oro for all to authenticated
  using (public.can_write_table(company_id, 'oro')) with check (public.can_write_table(company_id, 'oro'));

-- part_orders — écrite depuis : /orders, /workshop
drop policy if exists part_orders_all on public.part_orders;
create policy part_orders_all on public.part_orders for all to authenticated
  using (public.can_write_table(company_id, 'part_orders')) with check (public.can_write_table(company_id, 'part_orders'));

-- picking_lists — écrite depuis : /picking, /workshop
drop policy if exists picking_lists_insert on public.picking_lists;
drop policy if exists picking_lists_update on public.picking_lists;
drop policy if exists picking_lists_delete on public.picking_lists;
create policy picking_lists_insert on public.picking_lists for insert to authenticated
  with check (public.can_write_table(company_id, 'picking_lists'));
create policy picking_lists_update on public.picking_lists for update to authenticated
  using (public.can_write_table(company_id, 'picking_lists')) with check (public.can_write_table(company_id, 'picking_lists'));
create policy picking_lists_delete on public.picking_lists for delete to authenticated
  using (public.can_write_table(company_id, 'picking_lists'));

-- price_changes — écrite depuis : /parts, /stock, /sales
drop policy if exists pricechanges_insert on public.price_changes;
create policy pricechanges_insert on public.price_changes for insert to authenticated
  with check (public.can_write_table(company_id, 'price_changes'));

-- purchase_orders — écrite depuis : /purchases
drop policy if exists porders_all on public.purchase_orders;
create policy porders_all on public.purchase_orders for all to authenticated
  using (public.can_write_table(company_id, 'purchase_orders')) with check (public.can_write_table(company_id, 'purchase_orders'));

-- repair_orders — écrite depuis : /workshop
drop policy if exists ro_all on public.repair_orders;
create policy ro_all on public.repair_orders for all to authenticated
  using (public.can_write_table(company_id, 'repair_orders')) with check (public.can_write_table(company_id, 'repair_orders'));

-- stock_depreciations — écrite depuis : /stock
drop policy if exists stock_depreciations_insert on public.stock_depreciations;
drop policy if exists stock_depreciations_update on public.stock_depreciations;
create policy stock_depreciations_insert on public.stock_depreciations for insert to authenticated
  with check (public.can_write_table(company_id, 'stock_depreciations'));
create policy stock_depreciations_update on public.stock_depreciations for update to authenticated
  using (public.can_write_table(company_id, 'stock_depreciations')) with check (public.can_write_table(company_id, 'stock_depreciations'));

-- stock_moves — écrite depuis : /stock, /sales, /pos, /purchases, /orders, /workshop, /picking
drop policy if exists stockmoves_insert on public.stock_moves;
create policy stockmoves_insert on public.stock_moves for insert to authenticated
  with check (public.can_write_table(company_id, 'stock_moves'));

-- vehicles — écrite depuis : /vehicles, /sales, /workshop, /tradein, /purchases
drop policy if exists vehicles_insert on public.vehicles;
drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (public.can_write_table(company_id, 'vehicles'));
create policy vehicles_update on public.vehicles for update to authenticated
  using (public.can_write_table(company_id, 'vehicles')) with check (public.can_write_table(company_id, 'vehicles'));

-- workshop_appointments — écrite depuis : /workshop
drop policy if exists appt_all on public.workshop_appointments;
create policy appt_all on public.workshop_appointments for all to authenticated
  using (public.can_write_table(company_id, 'workshop_appointments')) with check (public.can_write_table(company_id, 'workshop_appointments'));

-- workshop_operations — écrite depuis : /workshop
drop policy if exists wops_all on public.workshop_operations;
create policy wops_all on public.workshop_operations for all to authenticated
  using (public.can_write_table(company_id, 'workshop_operations')) with check (public.can_write_table(company_id, 'workshop_operations'));

-- workshop_tasks — écrite depuis : /workshop
drop policy if exists wtasks_all on public.workshop_tasks;
create policy wtasks_all on public.workshop_tasks for all to authenticated
  using (public.can_write_table(company_id, 'workshop_tasks')) with check (public.can_write_table(company_id, 'workshop_tasks'));

-- workshop_time_entries — écrite depuis : /workshop
drop policy if exists wte_all on public.workshop_time_entries;
create policy wte_all on public.workshop_time_entries for all to authenticated
  using (public.can_write_table(company_id, 'workshop_time_entries')) with check (public.can_write_table(company_id, 'workshop_time_entries'));
