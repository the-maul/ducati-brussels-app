-- =====================================================================
-- Mission 02 — carte 3 « Créer une commande de pièces depuis un devis ou une facture »
-- (parité G8 « Mise en proposition de commande », spécification §2.2 et §4.1).
--
-- Depuis un document de vente (devis / proforma, bon de commande, réservation, BL,
-- facture), on commande les pièces MANQUANTES pour le client du document :
--   - besoin      = Σ quantités des lignes « article » du document pour cet article
--                   (pièces : types de gestion A et N ; motos, non stockés, texte et
--                   main-d'œuvre exclus) ;
--   - libre       = réel − réservé, en rendant au document ce qu'il a lui-même
--                   réservé (RES / BL) ou déjà sorti (FAC) : mouvements de stock
--                   dont la référence est le n° du document ;
--   - en commande = le calcul unique article_on_order_for(article, client, document)
--                   (mission 05, carte 7 : jamais la commande d'un autre client) ;
--   - déjà lancé  = quantité client des commandes de pièces encore en BROUILLON de
--                   ce client ou liées à ce document (ou au document dont il est issu) ;
--   - manquant    = max(besoin − max(libre, 0) − en commande − déjà lancé, 0).
-- La commande créée est en brouillon, liée au client, au véhicule du document et au
-- document (part_orders.source_document_id), avec ses pièces (quantité client = manquant
-- par défaut, quantité magasin 0, fournisseur principal de l'article, prix HTVA net
-- du document). Les pièces passent par part_order_line_save (contrôles + trace events).
-- Création tracée dans events (sur le document ET sur la commande).
--
-- Additif : 5 fonctions nouvelles. Aucune table, aucune colonne, aucun mouvement de stock.
-- =====================================================================

-- 1. Chaîne d'un document : lui-même et les documents dont il est issu (DEV → BC → RES…)
create or replace function public._document_chain(_document uuid)
returns table (document_id uuid, depth int)
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive ch(id, depth) as (
    select d.id, 0 from public.documents d where d.id = _document
    union all
    select d.source_document_id, ch.depth + 1
      from ch join public.documents d on d.id = ch.id
     where d.source_document_id is not null and ch.depth < 10
  )
  select id, depth from ch;
$$;

revoke all on function public._document_chain(uuid) from public, anon, authenticated;

-- 2. Pièces manquantes d'un document (usage interne : écran, alerte après acompte, rappel)
create or replace function public._document_order_needs(_document uuid)
returns table (
  article_id uuid, reference text, designation text, mgmt_type text, line_ids uuid[],
  qty_needed numeric, real_qty numeric, reserved_qty numeric, free_qty numeric,
  on_order_qty numeric, draft_qty numeric, missing_qty numeric,
  supplier_id uuid, supplier_name text, unit_price_ht numeric, vat_rate numeric, bin_location text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d public.documents%rowtype;
begin
  select * into d from public.documents where id = _document;
  if not found then
    return;
  end if;
  return query
  with lines as (
    select l.article_id,
           array_agg(l.id order by l.sort_order) as line_ids,
           sum(l.quantity) as qty,
           sum(l.line_ht) as ht,
           max(l.vat_rate) as vat,
           (array_agg(l.designation order by l.sort_order))[1] as des
      from public.document_lines l
     where l.document_id = d.id
       and coalesce(l.line_type, 'article') = 'article'
       and l.article_id is not null
       and l.quantity > 0
     group by l.article_id
  ), own as (
    -- Ce que le document a lui-même réservé (RES / BL) ou sorti (FAC / TIK) : rendu au calcul.
    select m.article_id,
           coalesce(sum(m.qty_delta) filter (where m.is_reservation), 0) as own_reserved,
           coalesce(sum(m.qty_delta) filter (where not m.is_reservation), 0) as own_real
      from public.stock_moves m
     where d.number is not null and m.ref = d.number and m.company_id = d.company_id
       and m.article_id in (select lines.article_id from lines)
     group by m.article_id
  ), chain as (
    select c.document_id from public._document_chain(d.id) c
  ), drafts as (
    select pl.article_id, sum(pl.qty_client) as q
      from public.part_order_lines pl
      join public.part_orders o on o.id = pl.order_id
     where o.company_id = d.company_id
       and o.dispatch_status = 'brouillon'
       and pl.article_id in (select lines.article_id from lines)
       and ((d.contact_id is not null and o.contact_id = d.contact_id)
            or o.source_document_id in (select chain.document_id from chain))
     group by pl.article_id
  ), calc as (
    select a.id as aid, a.reference as ref, coalesce(nullif(btrim(a.designation), ''), lines.des) as des,
           a.mgmt_type::text as mt, lines.line_ids as lids, lines.qty,
           st.real_qty as rq, st.reserved_qty as resq,
           (st.real_qty - coalesce(own.own_real, 0)) - (st.reserved_qty - coalesce(own.own_reserved, 0)) as free,
           public.article_on_order_for(a.id, d.contact_id, d.id) as oo,
           coalesce(drafts.q, 0) as dq,
           a.main_supplier_id as sid,
           coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as sname,
           case when lines.qty > 0 then round(lines.ht / lines.qty, 3) else 0 end as pu,
           coalesce(lines.vat, a.vat_rate, 21) as vat,
           a.bin_location as bin
      from lines
      join public.articles a on a.id = lines.article_id
      left join own on own.article_id = a.id
      left join drafts on drafts.article_id = a.id
      left join public.contacts c on c.id = a.main_supplier_id
      cross join lateral public.article_stock(a.id) st
     where a.mgmt_type::text in ('A', 'N')
  )
  select calc.aid, calc.ref, calc.des, calc.mt, calc.lids,
         calc.qty, calc.rq, calc.resq, calc.free, calc.oo, calc.dq,
         greatest(calc.qty - greatest(calc.free, 0) - calc.oo - calc.dq, 0),
         calc.sid, calc.sname, calc.pu, calc.vat, calc.bin
    from calc
   order by calc.ref;
end $$;

revoke all on function public._document_order_needs(uuid) from public, anon, authenticated;

-- 3. Même calcul, appelable par l'écran (membre de la société du document)
create or replace function public.document_order_needs(_document uuid)
returns table (
  article_id uuid, reference text, designation text, mgmt_type text, line_ids uuid[],
  qty_needed numeric, real_qty numeric, reserved_qty numeric, free_qty numeric,
  on_order_qty numeric, draft_qty numeric, missing_qty numeric,
  supplier_id uuid, supplier_name text, unit_price_ht numeric, vat_rate numeric, bin_location text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cid uuid;
begin
  select dd.company_id into cid from public.documents dd where dd.id = _document;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query select * from public._document_order_needs(_document);
end $$;

revoke all on function public.document_order_needs(uuid) from public, anon;
grant execute on function public.document_order_needs(uuid) to authenticated;

-- 4. Créer la commande de pièces depuis le document
--    _lines : [{ "article_id": uuid, "qty_client": n, "qty_shop": n, "supplier_id": uuid|null,
--               "unit_price_ht": n|null }]
create or replace function public.part_order_create_from_document(
  _document uuid,
  _kind text,
  _channel text default 'comptoir',
  _lines jsonb default '[]'::jsonb,
  _notes text default null
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d      public.documents%rowtype;
  k      public.order_kind;
  oid    uuid;
  item   jsonb;
  need   record;
  qc     numeric;
  qs     numeric;
  sup    uuid;
  pu     numeric;
  n      int := 0;
  seen   uuid[] := array[]::uuid[];
  aid    uuid;
begin
  select * into d from public.documents where id = _document;
  if not found then
    raise exception 'Document introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(d.company_id) then
    raise exception 'Accès refusé à la société %', d.company_id using errcode = '42501';
  end if;
  if d.doc_type not in ('DEV', 'BC', 'RES', 'BL', 'FAC') then
    raise exception 'On ne commande des pièces que depuis un devis / proforma, un bon de commande, une réservation, un BL ou une facture.'
      using errcode = 'P0001';
  end if;
  if d.status in ('brouillon', 'annulee', 'converti') then
    raise exception 'Document brouillon, annulé ou converti : commandez depuis le document en cours.' using errcode = 'P0001';
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
                                  source_document_id, channel, is_accident, notes)
  values (d.company_id, k, 'brouillon', d.contact_id, d.vehicle_id, d.id, coalesce(_channel, 'comptoir'),
          k = 'accident', nullif(btrim(coalesce(_notes, '')), ''))
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
    select * into need from public._document_order_needs(d.id) x where x.article_id = aid;
    if not found then
      raise exception 'Cette pièce n''est pas une pièce à commander de ce document.' using errcode = 'P0001';
    end if;
    qc  := coalesce(nullif(item ->> 'qty_client', '')::numeric, need.missing_qty);
    qs  := coalesce(nullif(item ->> 'qty_shop', '')::numeric, 0);
    sup := case when item ? 'supplier_id' then nullif(item ->> 'supplier_id', '')::uuid else need.supplier_id end;
    pu  := coalesce(nullif(item ->> 'unit_price_ht', '')::numeric, need.unit_price_ht);
    if coalesce(qc, 0) + coalesce(qs, 0) <= 0 then
      continue;  -- pièce décochée ou quantités à zéro : rien à commander
    end if;
    perform public.part_order_line_save(oid, null, aid, need.designation, sup, qc, qs, pu, need.vat_rate);
    n := n + 1;
  end loop;

  if n = 0 then
    raise exception 'Indiquez une quantité client ou magasin pour au moins une pièce.' using errcode = 'P0001';
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values
    (d.company_id, auth.uid(), 'part_order_from_document', 'documents', d.id::text, 'screen', null,
     jsonb_build_object('part_order_id', oid, 'order_kind', k, 'channel', coalesce(_channel, 'comptoir'),
                        'document_number', d.number, 'doc_type', d.doc_type, 'lines', n)),
    (d.company_id, auth.uid(), 'part_order_from_document', 'part_orders', oid::text, 'screen', null,
     jsonb_build_object('source_document_id', d.id, 'document_number', d.number, 'doc_type', d.doc_type,
                        'contact_id', d.contact_id, 'vehicle_id', d.vehicle_id, 'order_kind', k, 'lines', n));
  return oid;
end $$;

revoke all on function public.part_order_create_from_document(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.part_order_create_from_document(uuid, text, text, jsonb, text) to authenticated;

-- 5. Commandes de pièces liées à un document (ou au document dont il est issu)
create or replace function public.document_part_orders(_document uuid)
returns table (
  id uuid, number text, order_kind text, dispatch_status text, channel text,
  total_ht numeric, total_ttc numeric, created_at timestamptz,
  source_document_id uuid, source_doc_type text, source_number text, line_count int
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cid uuid;
begin
  select dd.company_id into cid from public.documents dd where dd.id = _document;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select o.id, o.number, o.order_kind::text, o.dispatch_status::text, o.channel,
         o.total_ht, o.total_ttc, o.created_at,
         o.source_document_id, sd.doc_type, sd.number,
         (select count(*)::int from public.part_order_lines pl where pl.order_id = o.id)
    from public.part_orders o
    join public.documents sd on sd.id = o.source_document_id
   where o.company_id = cid
     and o.source_document_id in (select c.document_id from public._document_chain(_document) c)
   order by o.created_at desc;
end $$;

revoke all on function public.document_part_orders(uuid) from public, anon;
grant execute on function public.document_part_orders(uuid) to authenticated;

comment on column public.part_orders.source_document_id is
  'Document de vente d''origine (devis / proforma, BC, RES, BL, FAC) : rempli par '
  'part_order_create_from_document (mission 02, carte 3).';

notify pgrst, 'reload schema';
