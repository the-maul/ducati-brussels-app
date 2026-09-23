-- =====================================================================
-- Mission 07 — carte 2, partie 4 : commander les pièces manquantes
--
-- Demande de Simon (23/09) : « et pouvoir commander depuis l'or ou la picking
-- list (en choisissant le type de commande). »
--
-- On NE RECRÉE PAS le circuit d'achat. On se branche dessus :
--   commande de pièces (part_orders, avec son order_kind urgente / standard /
--   excel / accident, ses règles de seuil et son cycle de vie)
--   → proposition de commande fournisseur (supplier_order_from_proposal)
--   → CMD + fichier DCS STANDARD / URGENTE (ACH001).
-- Le « en commande » d'une commande de pièces validée alimente déjà le
-- disponible du triple stock (B4) par article_on_order_for : rien à ajouter.
--
-- Ce lot ajoute seulement :
--   - le lien commande ↔ ordre de réparation (part_orders.repair_order_id) ;
--   - le calcul du manquant côté atelier (kit + pièces du technicien, ou lignes
--     d'une liste de préparation) : besoin − libre − en commande − déjà en brouillon ;
--   - une fonction de création qui reprend les quantités manquantes et laisse
--     CHOISIR LE TYPE DE COMMANDE.
--
-- Stock : AUCUN mouvement (une commande de pièces ne réserve pas, règle M04).
--
-- Additif : 1 colonne, 3 fonctions.
-- =====================================================================

alter table public.part_orders
  add column if not exists repair_order_id uuid references public.repair_orders(id) on delete set null;
create index if not exists part_orders_repair_order_idx
  on public.part_orders (repair_order_id) where repair_order_id is not null;

-- ---------------------------------------------------------------------
-- 1. Ce qui manque pour un OR (kit d'entretien + pièces du technicien)
--    Même arithmétique que _document_order_needs (mission 02, carte 3) :
--    manquant = besoin − libre − en commande pour ce client − déjà en brouillon.
--    Pièces seulement (types A et N) ; la main-d'œuvre et les lignes texte sont
--    exclues. Les consommables sans article restent hors commande (l'atelier
--    désigne l'article une fois dans les réglages des kits).
-- ---------------------------------------------------------------------
create or replace function public.repair_order_order_needs(_or uuid)
returns table(
  article_id uuid, reference text, designation text, mgmt_type text, origin text,
  qty_needed numeric, real_qty numeric, reserved_qty numeric, free_qty numeric,
  on_order_qty numeric, draft_qty numeric, missing_qty numeric,
  supplier_id uuid, supplier_name text, unit_price_ht numeric, vat_rate numeric, bin_location text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare r public.repair_orders%rowtype; svc record; kid uuid;
begin
  select * into r from public.repair_orders where id = _or;
  if not found or not public.is_member(r.company_id) then
    return;
  end if;
  select * into svc from public._repair_order_service(_or);
  if svc.model_year_id is not null and svc.service_code is not null then
    kid := public.maintenance_kit_for_model_year(r.company_id, svc.model_year_id, svc.service_code);
  end if;

  return query
  with wanted as (
    select i.article_id as aid, sum(i.quantity) as qty, 'kit'::text as src
      from public.maintenance_kit_items i
     where kid is not null and i.kit_id = kid and i.article_id is not null
     group by i.article_id
    union all
    select l.article_id, sum(l.quantity), 'atelier'
      from public.repair_order_lines l
     where l.or_id = _or and l.kind = 'piece' and l.article_id is not null and l.quantity > 0
     group by l.article_id
  ), lines as (
    select wanted.aid, sum(wanted.qty) as qty,
           (array_agg(wanted.src order by wanted.src))[1] as src
      from wanted group by wanted.aid
  ), drafts as (
    select pl.article_id, sum(pl.qty_client) as q
      from public.part_order_lines pl
      join public.part_orders o on o.id = pl.order_id
     where o.company_id = r.company_id
       and o.dispatch_status = 'brouillon'
       and pl.article_id in (select lines.aid from lines)
       and ((r.contact_id is not null and o.contact_id = r.contact_id) or o.repair_order_id = _or)
     group by pl.article_id
  ), calc as (
    select a.id as aid, a.reference as ref, a.designation as des, a.mgmt_type::text as mt, lines.src,
           lines.qty, st.real_qty as rq, st.reserved_qty as resq,
           st.real_qty - st.reserved_qty as free,
           public.article_on_order_for(a.id, r.contact_id, null) as oo,
           coalesce(drafts.q, 0) as dq,
           a.main_supplier_id as sid,
           coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as sname,
           coalesce(a.sale_price_ht, 0) as pu,
           coalesce(a.vat_rate, 21) as vat,
           a.bin_location as bin
      from lines
      join public.articles a on a.id = lines.aid
      left join drafts on drafts.article_id = a.id
      left join public.contacts c on c.id = a.main_supplier_id
      cross join lateral public.article_stock(a.id) st
     where a.mgmt_type::text in ('A', 'N')
  )
  select calc.aid, calc.ref, calc.des, calc.mt, calc.src,
         calc.qty, calc.rq, calc.resq, calc.free, calc.oo, calc.dq,
         greatest(calc.qty - greatest(calc.free, 0) - calc.oo - calc.dq, 0),
         calc.sid, calc.sname, calc.pu, calc.vat, calc.bin
    from calc
   order by calc.ref;
end $$;

revoke all on function public.repair_order_order_needs(uuid) from public, anon;
grant execute on function public.repair_order_order_needs(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Ce qui manque pour une liste de préparation (document OU OR)
-- ---------------------------------------------------------------------
create or replace function public.picking_order_needs(_picking uuid)
returns table(
  article_id uuid, reference text, designation text, mgmt_type text, origin text,
  qty_needed numeric, real_qty numeric, reserved_qty numeric, free_qty numeric,
  on_order_qty numeric, draft_qty numeric, missing_qty numeric,
  supplier_id uuid, supplier_name text, unit_price_ht numeric, vat_rate numeric, bin_location text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare p public.picking_lists%rowtype; ctc uuid;
begin
  select * into p from public.picking_lists where id = _picking;
  if not found or not public.is_member(p.company_id) then
    return;
  end if;
  if p.document_id is not null then
    select d.contact_id into ctc from public.documents d where d.id = p.document_id;
  elsif p.repair_order_id is not null then
    select r.contact_id into ctc from public.repair_orders r where r.id = p.repair_order_id;
  end if;

  return query
  with lines as (
    select i.article_id as aid,
           sum(greatest(i.qty_ordered - i.qty_picked, 0)) as qty,
           (array_agg(coalesce(i.origin, 'document') order by i.sort_order))[1] as src
      from public.picking_list_items i
     where i.picking_id = _picking and i.removed_at is null and i.article_id is not null
       and i.qty_ordered > 0
     group by i.article_id
  ), drafts as (
    select pl.article_id, sum(pl.qty_client) as q
      from public.part_order_lines pl
      join public.part_orders o on o.id = pl.order_id
     where o.company_id = p.company_id
       and o.dispatch_status = 'brouillon'
       and pl.article_id in (select lines.aid from lines)
       and ((ctc is not null and o.contact_id = ctc)
            or (p.document_id is not null and o.source_document_id = p.document_id)
            or (p.repair_order_id is not null and o.repair_order_id = p.repair_order_id))
     group by pl.article_id
  ), calc as (
    select a.id as aid, a.reference as ref, a.designation as des, a.mgmt_type::text as mt, lines.src,
           lines.qty, st.real_qty as rq, st.reserved_qty as resq,
           st.real_qty - st.reserved_qty as free,
           public.article_on_order_for(a.id, ctc, p.document_id) as oo,
           coalesce(drafts.q, 0) as dq,
           a.main_supplier_id as sid,
           coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as sname,
           coalesce(a.sale_price_ht, 0) as pu,
           coalesce(a.vat_rate, 21) as vat,
           a.bin_location as bin
      from lines
      join public.articles a on a.id = lines.aid
      left join drafts on drafts.article_id = a.id
      left join public.contacts c on c.id = a.main_supplier_id
      cross join lateral public.article_stock(a.id) st
     where a.mgmt_type::text in ('A', 'N')
  )
  select calc.aid, calc.ref, calc.des, calc.mt, calc.src,
         calc.qty, calc.rq, calc.resq, calc.free, calc.oo, calc.dq,
         greatest(calc.qty - greatest(calc.free, 0) - calc.oo - calc.dq, 0),
         calc.sid, calc.sname, calc.pu, calc.vat, calc.bin
    from calc
   order by calc.ref;
end $$;

revoke all on function public.picking_order_needs(uuid) from public, anon;
grant execute on function public.picking_order_needs(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Créer la commande de pièces depuis l'OR ou depuis la liste de préparation
--    _kind = le TYPE DE COMMANDE choisi par l'utilisateur (énum order_kind :
--    urgente / standard / excel / accident). Les règles de seuil et le
--    supplément s'appliquent à la validation, comme partout (part_order_validate).
--    La commande est créée en brouillon et reliée à l'OR.
-- ---------------------------------------------------------------------
create or replace function public.part_order_create_for_workshop(
  _or      uuid default null,
  _picking uuid default null,
  _kind    text default 'standard',
  _channel text default 'comptoir',
  _lines   jsonb default '[]'::jsonb,
  _notes   text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r    public.repair_orders%rowtype;
  p    public.picking_lists%rowtype;
  k    public.order_kind;
  oid  uuid;
  item jsonb;
  need record;
  qc   numeric;
  qs   numeric;
  sup  uuid;
  pu   numeric;
  n    int := 0;
  seen uuid[] := array[]::uuid[];
  aid  uuid;
  orid uuid;
begin
  if (_or is null) = (_picking is null) then
    raise exception 'Indiquez soit un ordre de réparation, soit une liste de préparation.' using errcode = 'P0001';
  end if;

  if _picking is not null then
    select * into p from public.picking_lists where id = _picking;
    if not found then raise exception 'Liste de préparation introuvable.' using errcode = 'P0002'; end if;
    if not public.is_member(p.company_id) then
      raise exception 'Accès refusé à la société %', p.company_id using errcode = '42501';
    end if;
    if p.status = 'annulee' then
      raise exception 'Liste annulée : rien à commander.' using errcode = 'P0001';
    end if;
    orid := p.repair_order_id;
  else
    orid := _or;
  end if;

  if orid is not null then
    select * into r from public.repair_orders where id = orid;
    if not found then raise exception 'Ordre de réparation introuvable.' using errcode = 'P0002'; end if;
    if not public.is_member(r.company_id) then
      raise exception 'Accès refusé à la société %', r.company_id using errcode = '42501';
    end if;
    if r.status = 'annule' then
      raise exception 'OR annulé : rien à commander.' using errcode = 'P0001';
    end if;
  end if;

  if _kind is null or not exists (select 1 from unnest(enum_range(null::public.order_kind)) e where e::text = _kind) then
    raise exception 'Type de commande inconnu : %', coalesce(_kind, '—') using errcode = 'P0001';
  end if;
  k := _kind::public.order_kind;
  if coalesce(_channel, 'comptoir') not in ('comptoir', 'mail') then
    raise exception 'Canal inconnu : %', _channel using errcode = 'P0001';
  end if;
  if _lines is null or jsonb_typeof(_lines) <> 'array' or jsonb_array_length(_lines) = 0 then
    raise exception 'Choisissez au moins une pièce à commander.' using errcode = 'P0001';
  end if;

  insert into public.part_orders (company_id, order_kind, dispatch_status, contact_id, vehicle_id,
                                  repair_order_id, channel, is_accident, notes)
  values (coalesce(r.company_id, p.company_id), k, 'brouillon', r.contact_id, r.vehicle_id,
          orid, coalesce(_channel, 'comptoir'), k = 'accident',
          nullif(btrim(coalesce(_notes, '')), ''))
  returning id into oid;

  for item in select * from jsonb_array_elements(_lines) loop
    aid := nullif(item ->> 'article_id', '')::uuid;
    if aid is null then
      raise exception 'Pièce sans article.' using errcode = 'P0001';
    end if;
    if aid = any(seen) then
      raise exception 'Une même pièce est choisie deux fois.' using errcode = 'P0001';
    end if;
    seen := seen || aid;

    if _picking is not null then
      select * into need from public.picking_order_needs(_picking) x where x.article_id = aid;
    else
      select * into need from public.repair_order_order_needs(_or) x where x.article_id = aid;
    end if;
    if not found then
      raise exception 'Cette pièce n''est pas une pièce à commander de cet entretien.' using errcode = 'P0001';
    end if;

    qc  := coalesce(nullif(item ->> 'qty_client', '')::numeric, need.missing_qty);
    qs  := coalesce(nullif(item ->> 'qty_shop', '')::numeric, 0);
    sup := case when item ? 'supplier_id' then nullif(item ->> 'supplier_id', '')::uuid else need.supplier_id end;
    pu  := coalesce(nullif(item ->> 'unit_price_ht', '')::numeric, need.unit_price_ht);
    if coalesce(qc, 0) + coalesce(qs, 0) <= 0 then
      continue;
    end if;
    perform public.part_order_line_save(oid, null, aid, need.designation, sup, qc, qs, pu, need.vat_rate);
    n := n + 1;
  end loop;

  if n = 0 then
    raise exception 'Indiquez une quantité client ou magasin pour au moins une pièce.' using errcode = 'P0001';
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values
    (coalesce(r.company_id, p.company_id), auth.uid(), 'part_order_from_workshop', 'part_orders', oid::text,
     'screen', null,
     jsonb_build_object('repair_order_id', orid, 'or_number', r.number, 'picking_id', _picking,
                        'order_kind', k, 'channel', coalesce(_channel, 'comptoir'), 'lines', n));
  if orid is not null then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (r.company_id, auth.uid(), 'part_order_from_workshop', 'repair_orders', orid::text, 'screen', null,
            jsonb_build_object('part_order_id', oid, 'order_kind', k, 'lines', n));
  end if;
  return oid;
end $$;

revoke all on function public.part_order_create_for_workshop(uuid, uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.part_order_create_for_workshop(uuid, uuid, text, text, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
