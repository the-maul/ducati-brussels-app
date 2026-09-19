-- =====================================================================
-- Mission 05 — carte 7 « Ne pas attribuer le stock commandé pour un autre client »
--
-- Défaut G8 montré en vidéo (4:49) : les valises apparaissent « en commande »
-- pour Moreau alors qu'elles ont été commandées pour un autre client. Domenico :
-- « ça ne devrait pas suivre l'attribution, sauf si c'était commandé pour le stock ».
--
-- Règle : pour un document d'un client, « en commande » =
--   1. les commandes fournisseur CMD validées sans réception reçue (commandes
--      pour le stock : une CMD ne porte aucun client) ;
--   2. + la quantité MAGASIN des commandes de pièces (validées, non annulées)
--      qui n'a pas été associée à un client ;
--   3. + la quantité CLIENT des commandes de pièces de CE client (commande liée
--      à son contact ou à ce document) ;
--   4. + la quantité magasin explicitement associée à ce client (« Associer une
--      commande en cours à ce client », tracé).
--   La quantité client d'une commande d'un AUTRE client n'est jamais comptée.
--
-- Un seul calcul : article_on_order_for(article, contact, document).
-- _article_on_order_qty(article) (recherche d'article, commandes de pièces)
-- devient ce même calcul sans client : seulement ce qui est commandé pour le
-- stock (1 + 2), jamais la commande d'un client.
--
-- Additif : 1 table (RLS, company_id), 6 fonctions, 1 fonction redéfinie
-- (_article_on_order_qty, même signature), picking_detail redéfinie (même
-- signature) pour compter « en commande » pour le client du document.
-- Aucun mouvement de stock.
-- =====================================================================

-- 1. Associations explicites : quantité magasin d'une commande de pièces réservée à un client
create table if not exists public.part_order_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  part_order_line_id uuid not null references public.part_order_lines(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  document_id uuid references public.documents(id) on delete set null,
  qty numeric not null check (qty > 0),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null
);
create index if not exists idx_poa_line on public.part_order_allocations(part_order_line_id) where cancelled_at is null;
create index if not exists idx_poa_contact on public.part_order_allocations(contact_id) where cancelled_at is null;
create index if not exists idx_poa_document on public.part_order_allocations(document_id) where cancelled_at is null;

alter table public.part_order_allocations enable row level security;
drop policy if exists "part_order_allocations_select" on public.part_order_allocations;
create policy "part_order_allocations_select" on public.part_order_allocations
  for select using (public.is_member(company_id));
-- Aucune écriture directe : seulement part_order_allocate / part_order_allocation_cancel (tracées).
revoke insert, update, delete on public.part_order_allocations from anon, authenticated;

-- 2. Le calcul unique « en commande », paramétré par client (usage interne)
create or replace function public.article_on_order_for(_article uuid, _contact uuid default null, _document uuid default null)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  with po as (
    select l.qty_client, l.qty_shop, o.contact_id, o.source_document_id,
           coalesce((select sum(a.qty) from public.part_order_allocations a
                      where a.part_order_line_id = l.id and a.cancelled_at is null), 0) as alloc_all,
           coalesce((select sum(a.qty) from public.part_order_allocations a
                      where a.part_order_line_id = l.id and a.cancelled_at is null
                        and ((_contact is not null and a.contact_id = _contact)
                             or (_document is not null and a.document_id = _document))), 0) as alloc_mine
      from public.part_order_lines l
      join public.part_orders o on o.id = l.order_id
     where l.article_id = _article
       and o.dispatch_status not in ('brouillon', 'annulee')
  )
  select
    -- 1. commandes fournisseur pour le stock
    coalesce((
      select sum(l.quantity)
        from public.purchase_lines l
        join public.purchase_orders o on o.id = l.order_id
       where l.article_id = _article
         and o.doc_type = 'CMD'
         and o.status = 'validee'
         and not exists (
           select 1 from public.purchase_orders r
            where r.source_order_id = o.id and r.doc_type = 'REC' and r.status = 'recue')), 0)
    -- 2. quantité magasin non associée à un client
    + coalesce((select sum(greatest(po.qty_shop - po.alloc_all, 0)) from po), 0)
    -- 3. quantité client des commandes de CE client (contact ou document)
    + coalesce((select sum(po.qty_client) from po
                 where (_contact is not null and po.contact_id = _contact)
                    or (_document is not null and po.source_document_id = _document)), 0)
    -- 4. quantité magasin associée à ce client
    + coalesce((select sum(least(po.alloc_mine, po.qty_shop)) from po), 0);
$$;

revoke all on function public.article_on_order_for(uuid, uuid, uuid) from public, anon, authenticated;

-- 3. L'ancien calcul (sans client) = le même calcul, stock seulement
create or replace function public._article_on_order_qty(_article uuid)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select public.article_on_order_for(_article, null, null);
$$;

revoke all on function public._article_on_order_qty(uuid) from public, anon, authenticated;

-- 4. Stock de chaque ligne d'un document, « en commande » pour le client du document
create or replace function public.document_lines_stock(_document uuid)
returns table (
  line_id uuid, article_id uuid, mgmt_type text, quantity numeric,
  real_qty numeric, reserved_qty numeric, on_order_qty numeric, on_order_stock_qty numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d public.documents%rowtype;
begin
  select * into d from public.documents where id = _document;
  if not found or not public.is_member(d.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select l.id, l.article_id, a.mgmt_type::text, l.quantity,
         st.real_qty, st.reserved_qty,
         public.article_on_order_for(l.article_id, d.contact_id, d.id),
         public.article_on_order_for(l.article_id, null, null)
    from public.document_lines l
    join public.articles a on a.id = l.article_id
    cross join lateral public.article_stock(l.article_id) st
   where l.document_id = _document
     and coalesce(l.line_type, 'article') = 'article';
end $$;

revoke all on function public.document_lines_stock(uuid) from public, anon;
grant execute on function public.document_lines_stock(uuid) to authenticated;

-- 5. Commandes de pièces en cours pour un article (écran « Associer une commande »)
create or replace function public.part_order_open_lines(_article uuid, _document uuid)
returns table (
  line_id uuid, order_id uuid, order_number text, dispatch_status text, order_kind text,
  order_contact_id uuid, order_contact_name text, source_document_id uuid,
  qty_client numeric, qty_shop numeric, allocated_qty numeric, allocated_here numeric,
  validated_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d public.documents%rowtype; cid uuid;
begin
  select a.company_id into cid from public.articles a where a.id = _article;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select * into d from public.documents where id = _document and company_id = cid;
  return query
  select l.id, o.id, o.number, o.dispatch_status::text, o.order_kind::text,
         o.contact_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
         o.source_document_id,
         l.qty_client, l.qty_shop,
         coalesce((select sum(x.qty) from public.part_order_allocations x
                    where x.part_order_line_id = l.id and x.cancelled_at is null), 0),
         coalesce((select sum(x.qty) from public.part_order_allocations x
                    where x.part_order_line_id = l.id and x.cancelled_at is null
                      and ((d.contact_id is not null and x.contact_id = d.contact_id)
                           or (d.id is not null and x.document_id = d.id))), 0),
         o.validated_at
    from public.part_order_lines l
    join public.part_orders o on o.id = l.order_id
    left join public.contacts c on c.id = o.contact_id
   where l.article_id = _article
     and o.company_id = cid
     and o.dispatch_status not in ('brouillon', 'annulee')
   order by o.validated_at nulls last, o.number;
end $$;

revoke all on function public.part_order_open_lines(uuid, uuid) from public, anon;
grant execute on function public.part_order_open_lines(uuid, uuid) to authenticated;

-- 6. Associer une quantité magasin d'une commande en cours au client d'un document
create or replace function public.part_order_allocate(_line uuid, _document uuid, _qty numeric, _note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l    public.part_order_lines%rowtype;
  o    public.part_orders%rowtype;
  d    public.documents%rowtype;
  used numeric;
  nid  uuid;
begin
  select * into l from public.part_order_lines where id = _line for update;
  if not found then
    raise exception 'Pièce de commande introuvable.' using errcode = 'P0002';
  end if;
  select * into o from public.part_orders where id = l.order_id;
  if not public.is_member(o.company_id) then
    raise exception 'Accès refusé à la société %', o.company_id using errcode = '42501';
  end if;
  if o.dispatch_status in ('brouillon', 'annulee') then
    raise exception 'Seule une commande validée et non annulée peut être associée.' using errcode = 'P0001';
  end if;
  select * into d from public.documents where id = _document and company_id = o.company_id;
  if not found then
    raise exception 'Document introuvable dans cette société.' using errcode = 'P0002';
  end if;
  if d.contact_id is null then
    raise exception 'Le document n''a pas de client : rien à associer.' using errcode = 'P0001';
  end if;
  if coalesce(_qty, 0) <= 0 then
    raise exception 'Indiquez une quantité positive.' using errcode = 'P0001';
  end if;
  select coalesce(sum(qty), 0) into used
    from public.part_order_allocations where part_order_line_id = l.id and cancelled_at is null;
  if _qty > l.qty_shop - used then
    raise exception 'Quantité trop grande : % pour le stock encore libre sur cette commande.', greatest(l.qty_shop - used, 0)
      using errcode = 'P0001';
  end if;

  insert into public.part_order_allocations (company_id, part_order_line_id, contact_id, document_id, qty, note, created_by)
  values (o.company_id, l.id, d.contact_id, d.id, _qty, nullif(btrim(coalesce(_note, '')), ''), auth.uid())
  returning id into nid;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (o.company_id, auth.uid(), 'part_order_allocate', 'documents', d.id::text, 'screen', null,
          jsonb_build_object('allocation_id', nid, 'part_order_id', o.id, 'part_order_number', o.number,
                             'part_order_line_id', l.id, 'article_id', l.article_id, 'reference', l.reference,
                             'contact_id', d.contact_id, 'qty', _qty));
  return nid;
end $$;

revoke all on function public.part_order_allocate(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.part_order_allocate(uuid, uuid, numeric, text) to authenticated;

-- 7. Retirer une association (jamais supprimée : annulée, tracée)
create or replace function public.part_order_allocation_cancel(_allocation uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.part_order_allocations%rowtype;
begin
  select * into a from public.part_order_allocations where id = _allocation for update;
  if not found then
    raise exception 'Association introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(a.company_id) then
    raise exception 'Accès refusé à la société %', a.company_id using errcode = '42501';
  end if;
  if a.cancelled_at is not null then
    return;
  end if;
  update public.part_order_allocations set cancelled_at = now(), cancelled_by = auth.uid() where id = _allocation;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (a.company_id, auth.uid(), 'part_order_allocation_cancel', 'documents', coalesce(a.document_id::text, a.id::text),
          'screen', to_jsonb(a), jsonb_build_object('allocation_id', a.id, 'cancelled', true));
end $$;

revoke all on function public.part_order_allocation_cancel(uuid) from public, anon;
grant execute on function public.part_order_allocation_cancel(uuid) to authenticated;

-- 8. Associations actives d'un document (affichage)
create or replace function public.document_allocations(_document uuid)
returns table (
  id uuid, part_order_line_id uuid, part_order_id uuid, part_order_number text,
  article_id uuid, reference text, qty numeric, created_at timestamptz, created_by_name text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cid uuid;
begin
  select dd.company_id into cid from public.documents dd where dd.id = _document;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select a.id, a.part_order_line_id, o.id, o.number, l.article_id, l.reference, a.qty, a.created_at,
         coalesce(nullif(btrim(p.full_name), ''), p.email)
    from public.part_order_allocations a
    join public.part_order_lines l on l.id = a.part_order_line_id
    join public.part_orders o on o.id = l.order_id
    left join public.profiles p on p.id = a.created_by
   where a.document_id = _document and a.cancelled_at is null
   order by a.created_at;
end $$;

revoke all on function public.document_allocations(uuid) from public, anon;
grant execute on function public.document_allocations(uuid) to authenticated;

-- 9. Liste de préparation (carte 6) : « en commande » pour le client du document
create or replace function public.picking_detail(_picking uuid)
returns table (
  id uuid, picking_id uuid, article_id uuid, document_line_id uuid,
  reference text, designation text, qty_ordered numeric, qty_picked numeric, status text,
  prep_step text, prep_step_at timestamptz, prep_step_by_name text, sort_order int,
  mgmt_type text, bins text[],
  real_qty numeric, reserved_qty numeric, on_order_qty numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cid uuid; doc uuid; ctc uuid;
begin
  select l.company_id, l.document_id into cid, doc from public.picking_lists l where l.id = _picking;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select d.contact_id into ctc from public.documents d where d.id = doc;
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

notify pgrst, 'reload schema';
