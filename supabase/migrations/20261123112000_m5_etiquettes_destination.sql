-- =====================================================================
-- M5 / M4 — C2 : ETIQUETTES DE DESTINATION « POUR QUI » (demande du client, 23/11/2026, PIE-04, STK-02, STK-06)
-- Une etiquette qui dit a qui est la piece : client, n° d'OR ou de commande, date du RDV, reference,
-- designation, casier. A imprimer a la reception et quand on rassemble la commande (preparation).
--
-- On reutilise le systeme d'etiquettes (B12) : memes formats, impression immediate par le poste OU
-- edition differee cumulee par poste dans `label_queue`.
--   - label_queue.destination (jsonb, facultatif) : les etiquettes « pour qui » de la file. Elles ne se
--     melangent jamais aux etiquettes de prix : label_queue_pending les ecarte, destination_labels_pending
--     les rend, cumulees par poste + article + destination.
--   - part_destination_labels(kind, id) : ce qu'il y a a etiqueter pour une reception, une liste de
--     preparation, un OR ou une commande de pieces (lien reutilisable par le dossier atelier).
-- Aucune regle de stock ni de prix. Idempotente. NON APPLIQUEE. Suppose 20261123110000.
-- =====================================================================
set local lock_timeout = '45s';

alter table public.label_queue add column if not exists destination jsonb;

-- La file « classique » reste exactement la meme (sans les etiquettes de destination).
create or replace function public.label_queue_pending(_company uuid)
returns table(workstation_id uuid, workstation_name text, article_id uuid, reference text, designation text,
              with_barcode boolean, with_price boolean, with_tarif boolean, qty bigint, lines bigint,
              first_at timestamptz, last_at timestamptz, operators text, ids bigint[])
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  if to_regclass('public.workstations') is not null then
    return query execute
      'select q.workstation_id, w.name::text, q.article_id, a.reference, a.designation, q.with_barcode, q.with_price, q.with_tarif,
              sum(q.qty)::bigint, count(*)::bigint, min(q.created_at), max(q.created_at),
              string_agg(distinct coalesce(p.full_name, p.email), '', ''), array_agg(q.id order by q.id)
         from public.label_queue q
         join public.articles a on a.id = q.article_id
         left join public.workstations w on w.id = q.workstation_id
         left join public.profiles p on p.id = q.operator_id
        where q.company_id = $1 and not q.printed and q.destination is null
        group by q.workstation_id, w.name, q.article_id, a.reference, a.designation, q.with_barcode, q.with_price, q.with_tarif
        order by w.name nulls first, a.reference' using _company;
  else
    return query
      select q.workstation_id, null::text, q.article_id, a.reference, a.designation, q.with_barcode, q.with_price, q.with_tarif,
             sum(q.qty)::bigint, count(*)::bigint, min(q.created_at), max(q.created_at),
             string_agg(distinct coalesce(p.full_name, p.email), ', '), array_agg(q.id order by q.id)
        from public.label_queue q
        join public.articles a on a.id = q.article_id
        left join public.profiles p on p.id = q.operator_id
       where q.company_id = _company and not q.printed and q.destination is null
       group by q.workstation_id, q.article_id, a.reference, a.designation, q.with_barcode, q.with_price, q.with_tarif
       order by a.reference;
  end if;
end $function$;

-- Code-barres principal d'un article (table article_barcodes)
create or replace function public._article_primary_barcode(_article uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.barcode from public.article_barcodes b where b.article_id = _article
   order by b.is_primary desc nulls last, b.barcode limit 1;
$$;
revoke all on function public._article_primary_barcode(uuid) from public, anon, authenticated;

-- Ce qu'il y a a etiqueter
create or replace function public.part_destination_labels(_kind text, _id uuid)
returns table(article_id uuid, reference text, designation text, bin_location text, barcode text, qty numeric,
              customer_name text, doc_number text, appointment_at timestamptz, source_kind text, source_id uuid, is_direct boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare _co uuid; _doc uuid; _ro uuid; _ap uuid; _cid uuid; _num text; _at timestamptz;
begin
  if _kind = 'receipt' then
    select p.company_id into _co from public.purchase_orders p where p.id = _id and p.doc_type = 'REC';
  elsif _kind = 'picking' then
    select p.company_id, p.document_id, p.repair_order_id, p.appointment_id into _co, _doc, _ro, _ap
      from public.picking_lists p where p.id = _id;
  elsif _kind = 'repair_order' then
    select r.company_id, r.id into _co, _ro from public.repair_orders r where r.id = _id;
  elsif _kind = 'part_order' then
    select o.company_id into _co from public.part_orders o where o.id = _id;
  else
    raise exception 'Origine d''étiquette inconnue.' using errcode = 'P0001';
  end if;
  if _co is null or not public.is_member(_co) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  if _kind = 'receipt' then
    return query
    select i.article_id, i.reference, i.designation, i.bin_location, public._article_primary_barcode(a.id),
           least(i.qty_received, greatest(i.qty_needed, 0)),
           i.contact_name, i.source_number,
           case when i.source_kind = 'repair_order' then (
             select max(w.starts_at) from public.workshop_appointments w
              where w.or_id = i.source_id and w.status not in ('annule', 'demande')) end,
           i.source_kind, i.source_id, i.ordered_for
      from public.receipt_customer_infos(_id) i
      join public.articles a on a.id = i.article_id
     where i.contact_id is not null and i.qty_needed > 0;
    return;
  end if;

  if _kind = 'part_order' then
    return query
    select l.article_id, coalesce(a.reference, l.reference), coalesce(nullif(btrim(a.designation), ''), l.designation),
           nullif(btrim(coalesce(a.bin_location, '')), ''), public._article_primary_barcode(a.id),
           coalesce(l.qty_client, 0) + coalesce(l.qty_shop, 0),
           coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
           o.number,
           (select max(w.starts_at) from public.workshop_appointments w
             where o.repair_order_id is not null and w.or_id = o.repair_order_id and w.status not in ('annule', 'demande')),
           'part_order'::text, o.id, true
      from public.part_order_lines l
      join public.part_orders o on o.id = l.order_id
      join public.articles a on a.id = l.article_id
      left join public.contacts c on c.id = o.contact_id
     where o.id = _id and coalesce(l.qty_client, 0) + coalesce(l.qty_shop, 0) > 0
     order by l.sort_order;
    return;
  end if;

  -- Liste de preparation ou OR : le client et le n° viennent du dossier
  if _ro is not null then
    select r.contact_id, r.number into _cid, _num from public.repair_orders r where r.id = _ro;
    select max(w.starts_at) into _at from public.workshop_appointments w
     where w.or_id = _ro and w.status not in ('annule', 'demande');
  end if;
  if _doc is not null and _num is null then
    select d.contact_id, d.number into _cid, _num from public.documents d where d.id = _doc;
  end if;
  if _ap is not null then
    select coalesce(_cid, w.contact_id), coalesce(_at, w.starts_at) into _cid, _at
      from public.workshop_appointments w where w.id = _ap;
  end if;

  if _kind = 'picking' then
    return query
    select i.article_id, coalesce(i.reference, a.reference), coalesce(nullif(btrim(i.designation), ''), a.designation),
           nullif(btrim(coalesce(a.bin_location, '')), ''), public._article_primary_barcode(a.id), i.qty_ordered,
           (select coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''))
              from public.contacts c where c.id = _cid),
           _num, _at,
           case when _ro is not null then 'repair_order' when _doc is not null then 'document' else 'appointment' end,
           coalesce(_ro, _doc, _ap), true
      from public.picking_list_items i
      join public.articles a on a.id = i.article_id
     where i.picking_id = _id and i.removed_at is null and i.qty_ordered > 0
     order by i.sort_order, i.created_at;
    return;
  end if;

  -- OR : ses lignes d'article + ses reservations (kit pas encore passe en ligne)
  return query
  with x as (
    select l.article_id as aid, sum(l.quantity) as q from public.repair_order_lines l
     where l.or_id = _ro and l.article_id is not null group by l.article_id
    union all
    select s.article_id, sum(s.qty_needed) from public.stock_reservations s
     where s.repair_order_id = _ro and s.status = 'active' group by s.article_id
  ), y as (select x.aid, max(x.q) as q from x group by x.aid)
  select a.id, a.reference, a.designation, nullif(btrim(coalesce(a.bin_location, '')), ''), public._article_primary_barcode(a.id), y.q,
         (select coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''))
            from public.contacts c where c.id = _cid),
         _num, _at, 'repair_order'::text, _ro, true
    from y
    join public.articles a on a.id = y.aid
   where y.q > 0 and a.mgmt_type::text not in ('T', 'F')
   order by a.reference;
end $fn$;
revoke all on function public.part_destination_labels(text, uuid) from public, anon;
grant execute on function public.part_destination_labels(text, uuid) to authenticated;

-- Edition differee : mettre des etiquettes « pour qui » en attente sur le poste
create or replace function public.destination_labels_enqueue(_company uuid, _items jsonb, _workstation uuid default null,
                                                             _source text default 'destination', _source_ref text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _it jsonb; _art uuid; _q int; _n int := 0;
begin
  if not public.can_write_table(_company, 'label_queue') then raise exception 'Accès refusé'; end if;
  if jsonb_typeof(_items) <> 'array' then raise exception 'Liste d''articles attendue'; end if;
  for _it in select * from jsonb_array_elements(_items) loop
    _art := nullif(_it ->> 'article_id', '')::uuid;
    if _art is null or not exists (select 1 from public.articles a where a.id = _art and a.company_id = _company) then
      raise exception 'Article inconnu pour cette société';
    end if;
    _q := ceil(coalesce(nullif(_it ->> 'qty', '')::numeric, 1))::int;
    if _q > 0 then
      insert into public.label_queue (company_id, article_id, qty, with_barcode, with_price, with_tarif,
                                      operator_id, workstation_id, source, source_ref, destination)
      values (_company, _art, _q, true, false, false, auth.uid(), _workstation, coalesce(_source, 'destination'), _source_ref,
              jsonb_strip_nulls(jsonb_build_object(
                'customer_name', nullif(btrim(coalesce(_it ->> 'customer_name', '')), ''),
                'doc_number', nullif(btrim(coalesce(_it ->> 'doc_number', '')), ''),
                'appointment_at', nullif(_it ->> 'appointment_at', ''),
                'bin_location', nullif(btrim(coalesce(_it ->> 'bin_location', '')), ''))));
      _n := _n + 1;
    end if;
  end loop;
  return _n;
end $fn$;
revoke all on function public.destination_labels_enqueue(uuid, jsonb, uuid, text, text) from public, anon;
grant execute on function public.destination_labels_enqueue(uuid, jsonb, uuid, text, text) to authenticated;

-- Etiquettes « pour qui » en attente, cumulees par poste + article + destination
create or replace function public.destination_labels_pending(_company uuid)
returns table(workstation_id uuid, workstation_name text, article_id uuid, reference text, designation text, barcode text,
              destination jsonb, qty bigint, ids bigint[])
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  if to_regclass('public.workstations') is not null then
    return query execute
      'select q.workstation_id, w.name::text, q.article_id, a.reference, a.designation, public._article_primary_barcode(q.article_id), q.destination,
              sum(q.qty)::bigint, array_agg(q.id order by q.id)
         from public.label_queue q
         join public.articles a on a.id = q.article_id
         left join public.workstations w on w.id = q.workstation_id
        where q.company_id = $1 and not q.printed and q.destination is not null
        group by q.workstation_id, w.name, q.article_id, a.reference, a.designation, q.destination
        order by w.name nulls first, a.reference' using _company;
  else
    return query
      select q.workstation_id, null::text, q.article_id, a.reference, a.designation, public._article_primary_barcode(q.article_id), q.destination,
             sum(q.qty)::bigint, array_agg(q.id order by q.id)
        from public.label_queue q
        join public.articles a on a.id = q.article_id
       where q.company_id = _company and not q.printed and q.destination is not null
       group by q.workstation_id, q.article_id, a.reference, a.designation, q.destination
       order by a.reference;
  end if;
end $fn$;
revoke all on function public.destination_labels_pending(uuid) from public, anon;
grant execute on function public.destination_labels_pending(uuid) to authenticated;
