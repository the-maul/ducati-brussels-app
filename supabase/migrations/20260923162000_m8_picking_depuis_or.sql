-- =====================================================================
-- Mission 07 — carte 2, partie 3 : la picking list d'un entretien
--
-- Demande de Simon (23/09) : « on doit pouvoir aussi créer une picking list a
-- partir de ce qui a été prévu comme entretien ».
--
-- La liste de préparation existe déjà (mission 02, carte 11) mais elle ne sait
-- partir que d'un document de vente. On NE LA DOUBLE PAS : on lui ouvre une
-- deuxième origine, l'ordre de réparation. Mêmes tables, mêmes statuts, même
-- écran tablette, même impression.
--
-- Contenu d'une liste ouverte depuis un OR :
--   1. les pièces du kit d'entretien correspondant à l'échéance du parcours
--      (workshop_journeys.service_label → échéance du manuel → kit M-20) ;
--   2. les pièces ajoutées par le technicien, c'est-à-dire les lignes « pièce »
--      de l'OR (le bouton « Reporter sur l'OR » du parcours y écrit déjà les
--      pièces à remplacer relevées en atelier).
-- Chaque ligne porte son stock disponible, son casier et ce qui manque.
--
-- Stock : AUCUN mouvement, comme la liste d'un document.
--
-- Additif : 2 colonnes sur picking_lists, 3 sur picking_list_items, 1 contrainte
-- élargie, 1 fonction interne, 2 nouvelles fonctions, 2 fonctions redéfinies
-- (même signature).
-- =====================================================================

alter table public.picking_lists
  add column if not exists repair_order_id uuid references public.repair_orders(id) on delete set null;
alter table public.picking_lists
  add column if not exists service_label text;

create unique index if not exists picking_lists_repair_order_uniq
  on public.picking_lists (repair_order_id) where repair_order_id is not null;

alter table public.picking_list_items
  add column if not exists origin text;
alter table public.picking_list_items
  add column if not exists kit_item_id uuid references public.maintenance_kit_items(id) on delete set null;
alter table public.picking_list_items
  add column if not exists unit text;

do $$ begin
  alter table public.picking_list_items
    add constraint picking_list_items_origin_chk
    check (origin is null or origin in ('document', 'kit', 'atelier', 'manuel'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 1. Quelle échéance d'entretien pour cet OR ?
--    Le parcours technicien (workshop_journeys) porte le modèle-année et le
--    libellé de l'échéance ; on retrouve le code d'échéance du manuel.
-- ---------------------------------------------------------------------
create or replace function public._repair_order_service(_or uuid)
returns table(model_year_id text, service_code text, service_label text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select j.model_year_id,
         coalesce(
           (select s.code from public.wsm_services s
              join public.wsm_manual_catalog_links l on l.manual_id = s.manual_id
             where l.model_year_id = j.model_year_id and l.status = 'lie'
               and (lower(s.name) = lower(j.service_label) or lower(s.code) = lower(j.service_label))
             order by s.sort limit 1),
           (select s.code from public.wsm_services s
              join public.wsm_manual_catalog_links l on l.manual_id = s.manual_id
             where l.model_year_id = j.model_year_id and l.status = 'lie'
               and lower(j.service_label) like '%' || lower(s.name) || '%'
             order by length(s.name) desc limit 1)),
         j.service_label
    from public.workshop_journeys j
   where j.or_id = _or and j.model_year_id is not null;
$$;

revoke all on function public._repair_order_service(uuid) from public, anon;
grant execute on function public._repair_order_service(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Ouvrir (ou compléter) la liste de préparation d'un OR
-- ---------------------------------------------------------------------
create or replace function public.picking_open_for_repair_order(_or uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r     public.repair_orders%rowtype;
  svc   record;
  kid   uuid;
  pid   uuid;
  pst   text;
  n_kit int := 0;
  n_or  int := 0;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then
    raise exception 'Ordre de réparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(r.company_id) then
    raise exception 'Accès refusé à la société %', r.company_id using errcode = '42501';
  end if;
  if r.status = 'annule' then
    raise exception 'OR annulé : rien à préparer.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('picking_or:' || _or::text));

  select * into svc from public._repair_order_service(_or);
  if svc.model_year_id is not null and svc.service_code is not null then
    kid := public.maintenance_kit_for_model_year(r.company_id, svc.model_year_id, svc.service_code);
  end if;

  select id, status into pid, pst from public.picking_lists where repair_order_id = _or;
  if pid is null then
    insert into public.picking_lists (company_id, repair_order_id, service_label, created_by)
    values (r.company_id, _or, svc.service_label, auth.uid())
    returning id into pid;
    pst := 'en_cours';
  end if;
  if pst in ('annulee', 'livre') then
    return pid;
  end if;

  -- a) les pièces du kit d'entretien
  if kid is not null then
    insert into public.picking_list_items
      (company_id, picking_id, article_id, designation, reference, qty_ordered, qty_picked, status,
       origin, kit_item_id, unit, sort_order)
    select r.company_id, pid, i.article_id,
           i.designation || case when i.kind = 'consommable' and i.unit is not null
                                 then ' (' || trim(to_char(i.quantity, 'FM9999990.999')) || ' ' || i.unit || ')'
                                 else '' end,
           coalesce(i.reference, a.reference), i.quantity, 0, 'a_preparer',
           'kit', i.id, i.unit, i.sort_order
      from public.maintenance_kit_items i
      left join public.articles a on a.id = i.article_id
     where i.kit_id = kid
       and not exists (select 1 from public.picking_list_items x
                        where x.picking_id = pid and x.kit_item_id = i.id);
    get diagnostics n_kit = row_count;
  end if;

  -- b) les pièces ajoutées par le technicien : lignes « pièce » de l'OR
  insert into public.picking_list_items
    (company_id, picking_id, article_id, designation, reference, qty_ordered, qty_picked, status,
     origin, sort_order)
  select r.company_id, pid, l.article_id, l.designation, a.reference, l.quantity, 0, 'a_preparer',
         'atelier', 1000 + l.sort_order
    from public.repair_order_lines l
    left join public.articles a on a.id = l.article_id
   where l.or_id = _or
     and l.kind = 'piece'
     and l.quantity > 0
     and not exists (
       select 1 from public.picking_list_items x
        where x.picking_id = pid
          and ((l.article_id is not null and x.article_id is not distinct from l.article_id)
               or (l.article_id is null and x.designation is not distinct from l.designation)));
  get diagnostics n_or = row_count;

  perform public._picking_refresh_status(pid);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'picking_open_for_repair_order', 'picking_lists', pid::text, 'screen', null,
          jsonb_build_object('or_id', _or, 'or_number', r.number, 'kit_id', kid,
                             'service_code', svc.service_code, 'service_label', svc.service_label,
                             'lines_kit', n_kit, 'lines_workshop', n_or));
  return pid;
end $$;

revoke all on function public.picking_open_for_repair_order(uuid) from public, anon;
grant execute on function public.picking_open_for_repair_order(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. picking_detail : même signature, le client vient du document OU de l'OR
-- ---------------------------------------------------------------------
create or replace function public.picking_detail(_picking uuid)
returns table(
  id uuid, picking_id uuid, article_id uuid, document_line_id uuid, reference text, designation text,
  qty_ordered numeric, qty_picked numeric, status text, prep_step text,
  prep_step_at timestamptz, prep_step_by_name text, sort_order integer, mgmt_type text,
  bins text[], real_qty numeric, reserved_qty numeric, on_order_qty numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare cid uuid; doc uuid; ro uuid; ctc uuid;
begin
  select l.company_id, l.document_id, l.repair_order_id into cid, doc, ro
    from public.picking_lists l where l.id = _picking;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if doc is not null then
    select d.contact_id into ctc from public.documents d where d.id = doc;
  elsif ro is not null then
    select r.contact_id into ctc from public.repair_orders r where r.id = ro;
  end if;
  return query
  select i.id, i.picking_id, i.article_id, i.document_line_id,
         coalesce(i.reference, a.reference), i.designation, i.qty_ordered, i.qty_picked, i.status,
         i.prep_step, i.prep_step_at,
         coalesce(nullif(btrim(pr.full_name), ''), pr.email),
         i.sort_order,
         a.mgmt_type::text,
         case when a.id is null then array[]::text[] else array(
           select distinct x.b from (
             select nullif(btrim(a.bin_location), '') as b
             union all select nullif(btrim(a.bin_location2), '')
             union all select nullif(btrim(ab.bin_location), '') from public.article_bins ab where ab.article_id = a.id
           ) x where x.b is not null order by x.b) end,
         st.real_qty, st.reserved_qty, oo.q
    from public.picking_list_items i
    left join public.articles a on a.id = i.article_id
    left join public.profiles pr on pr.id = i.prep_step_by
    left join lateral public.article_stock(i.article_id) st on a.id is not null
    left join lateral (select public.article_on_order_for(i.article_id, ctc, doc) as q) oo on a.id is not null
   where i.picking_id = _picking
   order by i.sort_order, i.created_at;
end $$;

revoke all on function public.picking_detail(uuid) from public, anon;
grant execute on function public.picking_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. picking_overview : la liste peut désormais venir d'un OR
--    (mêmes colonnes ; document_id reste null, doc_number porte le n° d'OR
--    préfixé « OR » pour que la page des listes reste lisible telle quelle)
-- ---------------------------------------------------------------------
create or replace function public.picking_overview(_company uuid, _picking uuid default null)
returns table(
  id uuid, company_id uuid, document_id uuid, doc_type text, doc_number text, doc_status text,
  doc_issue_date date, contact_id uuid, client_name text, vehicle_label text, seller_name text,
  seller_user_id uuid, location text, status text, note text, created_at timestamptz,
  created_by_name text, cancelled_at timestamptz, cancelled_by_name text, cancel_reason text,
  completed_at timestamptz, completed_by_name text, lines_total integer, lines_ordered integer,
  lines_prepared integer, lines_mounted integer, lines_removed integer, doc_changed boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select pl.id, pl.company_id, pl.document_id,
         coalesce(d.doc_type, case when pl.repair_order_id is not null then 'OR' end),
         coalesce(d.number, r.number),
         coalesce(d.status, r.status),
         coalesce(d.issue_date, r.created_at::date),
         coalesce(d.contact_id, r.contact_id),
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
         coalesce(
           nullif(btrim(concat_ws(' ', v.brand, v.model, case when v.vin is not null then '· ' || v.vin end)), ''),
           (select i.designation from public.picking_list_items i
              join public.articles a on a.id = i.article_id
             where i.picking_id = pl.id and i.removed_at is null and a.mgmt_type::text in ('V', 'O', 'P', 'D')
             order by i.sort_order limit 1)),
         coalesce(nullif(btrim(sp.full_name), ''), nullif(btrim(d.operator), ''),
                  nullif(btrim(r.operator), ''), sp.email),
         d.operator_user_id,
         pl.location, pl.status, pl.note, pl.created_at,
         coalesce(nullif(btrim(cp.full_name), ''), cp.email),
         pl.cancelled_at, coalesce(nullif(btrim(xp.full_name), ''), xp.email), pl.cancel_reason,
         pl.completed_at, coalesce(nullif(btrim(fp.full_name), ''), fp.email),
         coalesce(s.total, 0), coalesce(s.ordered, 0), coalesce(s.prepared, 0), coalesce(s.mounted, 0),
         coalesce(s.removed, 0),
         (pl.document_id is not null and (
            exists (select 1 from public.document_lines l
                     where l.document_id = pl.document_id
                       and coalesce(l.line_type, 'article') = 'article' and l.quantity > 0
                       and not exists (select 1 from public.picking_list_items i
                                        where i.picking_id = pl.id and i.document_line_id = l.id))
            or exists (select 1 from public.picking_list_items i
                        where i.picking_id = pl.id and i.removed_at is null
                          and not exists (select 1 from public.document_lines l
                                           where l.id = i.document_line_id and l.document_id = pl.document_id
                                             and l.quantity = i.qty_ordered))))
    from public.picking_lists pl
    left join public.documents d on d.id = pl.document_id
    left join public.repair_orders r on r.id = pl.repair_order_id
    left join public.contacts c on c.id = coalesce(d.contact_id, r.contact_id)
    left join public.vehicles v on v.id = coalesce(d.vehicle_id, r.vehicle_id)
    left join public.profiles sp on sp.id = d.operator_user_id
    left join public.profiles cp on cp.id = pl.created_by
    left join public.profiles xp on xp.id = pl.cancelled_by
    left join public.profiles fp on fp.id = pl.completed_by
    left join lateral (
      select count(*) filter (where i.removed_at is null)::int as total,
             count(*) filter (where i.removed_at is null and i.prep_step = 'commande')::int as ordered,
             count(*) filter (where i.removed_at is null and i.prep_step in ('prepare', 'monte'))::int as prepared,
             count(*) filter (where i.removed_at is null and i.prep_step = 'monte')::int as mounted,
             count(*) filter (where i.removed_at is not null)::int as removed
        from public.picking_list_items i where i.picking_id = pl.id) s on true
   where pl.company_id = _company
     and (_picking is null or pl.id = _picking)
   order by pl.created_at desc;
end $$;

revoke all on function public.picking_overview(uuid, uuid) from public, anon;
grant execute on function public.picking_overview(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
