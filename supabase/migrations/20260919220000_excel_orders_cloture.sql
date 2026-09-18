-- =====================================================================
-- COMMANDE EXCEL DUCATI — alerte à 2 000 €, clôture et archivage (mission 02).
-- Spécification : docs/process-commandes-pieces.md §1.6 et §4 point 9.
--
-- Additif uniquement :
--   * excel_orders : date et auteur de clôture, pièce GED archivée, totaux figés par onglet ;
--     un seul classeur ouvert (en_cours / telecharge) par société.
--   * excel_order_lines : lien vers la ligne du catalogue et vers la commande client
--     (part_orders / part_order_lines) pour router les pièces à la réception.
--   * Numérotation : type de document « CEX » (préfixe modifiable dans Paramètres → Numérotation).
--   * Fonctions : classeur ouvert (créé vide au besoin), totaux par onglet (seuil lu dans
--     reference_values / order_threshold / excel), attribution du numéro, clôture + archivage.
-- Toutes les fonctions : security invoker (RLS appliquée) + contrôle is_member,
-- exécution réservée à authenticated.
-- =====================================================================

-- 1. En-tête : colonnes de clôture / archivage ------------------------------------
alter table public.excel_orders add column if not exists closed_at timestamptz;
alter table public.excel_orders add column if not exists closed_by uuid references auth.users(id) on delete set null;
alter table public.excel_orders add column if not exists archive_attachment_id uuid references public.attachments(id) on delete set null;
alter table public.excel_orders add column if not exists tab_totals jsonb;   -- {"demo":{"value":..,"final":..,"reached":..}, ...}
alter table public.excel_orders add column if not exists download_count int not null default 0;

do $$ begin
  alter table public.excel_orders add constraint excel_orders_status_chk
    check (status in ('en_cours', 'telecharge', 'cloture', 'archive'));
exception when duplicate_object then null; end $$;

-- Un seul classeur ouvert par société : la commande suivante repart d'un modèle vide.
create unique index if not exists uq_excel_orders_open
  on public.excel_orders(company_id) where status in ('en_cours', 'telecharge');
create unique index if not exists uq_excel_orders_number
  on public.excel_orders(company_id, number) where number is not null;

-- 2. Lignes : traçabilité pièce ↔ commande Excel ↔ client de la précommande -------
alter table public.excel_order_lines add column if not exists catalog_id uuid references public.excel_catalog(id) on delete set null;
alter table public.excel_order_lines add column if not exists part_order_id uuid references public.part_orders(id) on delete set null;
alter table public.excel_order_lines add column if not exists part_order_line_id uuid references public.part_order_lines(id) on delete set null;

do $$ begin
  alter table public.excel_order_lines add constraint excel_order_lines_tab_chk
    check (tab in ('demo', 'courtoisie', 'showroom'));
exception when duplicate_object then null; end $$;

create index if not exists idx_excel_order_lines_ref      on public.excel_order_lines(reference);
create index if not exists idx_excel_order_lines_contact  on public.excel_order_lines(contact_id);
create index if not exists idx_excel_order_lines_partord  on public.excel_order_lines(part_order_id);

-- 3. Numérotation « CEX » (paramétrable : préfixe, remise à zéro annuelle, longueur) ----
insert into public.document_sequences (company_id, doc_type, prefix, label)
select c.id, 'CEX', 'CEX', 'Commande Excel Ducati' from public.companies c
on conflict (company_id, doc_type) do nothing;

-- 4. Seuil par onglet (reference_values / order_threshold / excel, défaut 2 000 €) -----
create or replace function public.excel_order_threshold(_company uuid)
returns numeric
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    (select (rv.extra->>'min_ht_per_tab')::numeric from public.reference_values rv
      where rv.company_id = _company and rv.table_key = 'order_threshold' and rv.code = 'excel'
        and public.is_member(_company)
      limit 1),
    2000)
$$;

-- 5. Classeur ouvert de la société (créé vide s'il n'y en a pas) -----------------------
create or replace function public.excel_order_current(_company uuid, _dealer_code text default null, _dealer_name text default null)
returns public.excel_orders
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare r public.excel_orders;
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company;
  end if;
  select * into r from public.excel_orders
    where company_id = _company and status in ('en_cours', 'telecharge')
    order by created_at limit 1;
  if found then return r; end if;
  insert into public.excel_orders (company_id, status, dealer_code, dealer_name)
    values (_company, 'en_cours', _dealer_code, _dealer_name)
    on conflict do nothing
    returning * into r;
  if r.id is null then  -- créé en parallèle par un autre poste
    select * into r from public.excel_orders
      where company_id = _company and status in ('en_cours', 'telecharge') limit 1;
  end if;
  return r;
end $$;

-- 6. Totaux par onglet : valeur = prix dealer × qté, final = valeur × (1 − extra) -------
create or replace function public.excel_order_tab_totals(_company uuid)
returns table (excel_order_id uuid, tab text, line_count int, total_value numeric, total_final numeric, threshold numeric, reached boolean)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with o as (
    select id from public.excel_orders
    where company_id = _company and status in ('en_cours', 'telecharge') and public.is_member(_company)
    order by created_at limit 1
  ), th as (select public.excel_order_threshold(_company) as v),
  t(tab) as (values ('demo'), ('courtoisie'), ('showroom'))
  select o.id, t.tab,
         count(l.id)::int,
         round(coalesce(sum(l.price_dealer * l.qty), 0), 2),
         round(coalesce(sum(l.price_dealer * l.qty * (1 - l.extra_discount)), 0), 2),
         th.v,
         coalesce(sum(l.price_dealer * l.qty), 0) >= th.v
  from o cross join t cross join th
  left join public.excel_order_lines l on l.excel_order_id = o.id and l.tab = t.tab
  group by o.id, t.tab, th.v
$$;

-- 7. Numéro interne au 1er téléchargement (idempotent) ---------------------------------
create or replace function public.excel_order_assign_number(_order uuid)
returns text
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare r public.excel_orders;
begin
  select * into r from public.excel_orders where id = _order for update;
  if not found or not public.is_member(r.company_id) then
    raise exception 'Commande Excel introuvable';
  end if;
  if r.status not in ('en_cours', 'telecharge') then
    raise exception 'Commande Excel déjà clôturée';
  end if;
  if r.number is null then
    r.number := public.next_document_number(r.company_id, 'CEX');
  end if;
  update public.excel_orders
     set number = r.number,
         status = 'telecharge',
         downloaded_at = coalesce(downloaded_at, now()),
         download_count = download_count + 1
   where id = _order;
  return r.number;
end $$;

-- 8. Clôture puis archivage (le .xlsx est déjà déposé en GED par l'écran) --------------
create or replace function public.excel_order_close(_order uuid, _attachment uuid, _archive_path text)
returns public.excel_orders
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare r public.excel_orders; totals jsonb; th numeric;
begin
  select * into r from public.excel_orders where id = _order for update;
  if not found or not public.is_member(r.company_id) then
    raise exception 'Commande Excel introuvable';
  end if;
  if r.status not in ('en_cours', 'telecharge') then
    raise exception 'Commande Excel déjà clôturée';
  end if;
  if r.number is null then
    raise exception 'Numéro de commande manquant : télécharger le classeur avant la clôture';
  end if;
  if not exists (select 1 from public.excel_order_lines where excel_order_id = _order and qty > 0) then
    raise exception 'Commande Excel vide';
  end if;
  if _attachment is not null and not exists (
    select 1 from public.attachments a where a.id = _attachment and a.company_id = r.company_id
      and a.entity_type = 'excel_order' and a.entity_id = _order) then
    raise exception 'Pièce d''archive invalide';
  end if;

  th := public.excel_order_threshold(r.company_id);
  select jsonb_object_agg(s.tab, jsonb_build_object(
           'lines', s.n, 'value', s.v, 'final', s.f, 'reached', s.v >= th))
    into totals
  from (
    select t.tab, count(l.id) as n,
           round(coalesce(sum(l.price_dealer * l.qty), 0), 2) as v,
           round(coalesce(sum(l.price_dealer * l.qty * (1 - l.extra_discount)), 0), 2) as f
    from (values ('demo'), ('courtoisie'), ('showroom')) t(tab)
    left join public.excel_order_lines l on l.excel_order_id = _order and l.tab = t.tab
    group by t.tab
  ) s;
  totals := totals || jsonb_build_object('threshold', th);

  -- deux étapes visibles dans l'audit : clôturée, puis archivée
  update public.excel_orders
     set status = 'cloture', closed_at = now(), closed_by = auth.uid(), tab_totals = totals
   where id = _order;
  update public.excel_orders
     set status = 'archive', archived_at = now(),
         archive_attachment_id = _attachment, archive_path = _archive_path
   where id = _order
  returning * into r;
  return r;
end $$;

-- 9. Droits d'exécution ---------------------------------------------------------------
revoke all on function public.excel_order_threshold(uuid) from public, anon;
revoke all on function public.excel_order_current(uuid, text, text) from public, anon;
revoke all on function public.excel_order_tab_totals(uuid) from public, anon;
revoke all on function public.excel_order_assign_number(uuid) from public, anon;
revoke all on function public.excel_order_close(uuid, uuid, text) from public, anon;
grant execute on function public.excel_order_threshold(uuid) to authenticated;
grant execute on function public.excel_order_current(uuid, text, text) to authenticated;
grant execute on function public.excel_order_tab_totals(uuid) to authenticated;
grant execute on function public.excel_order_assign_number(uuid) to authenticated;
grant execute on function public.excel_order_close(uuid, uuid, text) to authenticated;
