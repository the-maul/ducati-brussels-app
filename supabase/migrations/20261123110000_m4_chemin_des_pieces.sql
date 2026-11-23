-- =====================================================================
-- M4 — C2 « CHEMIN DE CHAQUE PIECE COMMANDEE » (23/11/2026, PIE-01 a PIE-06)
-- Decision du client : tous les types de commande restent (standard, urgente, accident, Excel) et les
-- 3 documents aussi (commande de pieces client, panier Ducati, commande fournisseur + reception).
-- On ne fusionne rien : on rend visible, pour chaque ligne demandee, son chemin :
--   pour qui -> dans quel panier ou commande (type, n° DCS) -> recue (quantite, reliquat, date)
--   -> reservee / preparee -> client prevenu -> remise.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. part_receipt_allocations (append-only) : quelle reception a servi quelle ligne de panier ou de
--      classeur Excel. Une commande fournisseur (CMD) a deja ce lien (purchase_lines.source_line_id) ;
--      un panier ou un classeur Excel n'en avait aucun : la reception ne retrouvait plus le client
--      (PIE-05). Purement informatif : AUCUN mouvement de stock, aucun PAMP, aucun prix.
--   2. Fonction appelee apres validation d'une reception (trigger pose par 20261123111000) : repartit les quantites sur les paniers commandes et
--      classeurs commandes du meme fournisseur (urgente d'abord, puis la plus ancienne commande).
--      Une erreur ici ne bloque JAMAIS la reception.
--   3. part_path_rows : une ligne par piece demandee, avec ses commandes, receptions, preparation,
--      information du client et remise (lecture seule, droits de la societe).
--   4. receipt_customer_infos : retrouve aussi les clients servis par un panier ou un classeur Excel
--      deja envoye, et dit par quel document (via_kind / via_number).
--   5. part_path_mark_informed : « Client prevenu » depuis le chemin (meme trace que la reception).
--
-- Idempotente. NON APPLIQUEE (l'orchestrateur la passe). Plage C2 : 20261123110000 -> 119999.
-- =====================================================================
set local lock_timeout = '45s';

-- ---------------------------------------------------------------------
-- 1. Lien reception <-> ligne de panier / de classeur Excel
-- ---------------------------------------------------------------------
create table if not exists public.part_receipt_allocations (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references public.companies(id) on delete restrict,
  receipt_id      uuid not null references public.purchase_orders(id) on delete cascade,
  receipt_line_id uuid not null references public.purchase_lines(id) on delete cascade,
  article_id      uuid references public.articles(id) on delete set null,
  supply_kind     text not null check (supply_kind in ('basket', 'excel')),
  supply_line_id  uuid not null,
  qty             numeric not null check (qty > 0),
  created_at      timestamptz not null default now()
);
create index if not exists idx_part_receipt_alloc_supply on public.part_receipt_allocations (supply_kind, supply_line_id);
create index if not exists idx_part_receipt_alloc_receipt on public.part_receipt_allocations (receipt_id);
create index if not exists idx_part_receipt_alloc_company on public.part_receipt_allocations (company_id);

alter table public.part_receipt_allocations enable row level security;
drop policy if exists part_receipt_alloc_select on public.part_receipt_allocations;
create policy part_receipt_alloc_select on public.part_receipt_allocations for select to authenticated
  using (coalesce(company_id in (select public.rls_member_companies()), false));
-- Aucune ecriture depuis l'ecran : seul le trigger de reception ecrit (security definer).
revoke all on public.part_receipt_allocations from public, anon, authenticated;
grant select on public.part_receipt_allocations to authenticated;

-- Societe de test : historique, jamais copie (inventaire admin_test_company_inventory).
do $m$
declare d text;
begin
  if to_regprocedure('public._tc_skip()') is null then return; end if;
  d := pg_get_functiondef('public._tc_skip()'::regprocedure);
  if position('part_receipt_allocations' in d) = 0 then
    if position($x$('part_order_allocations',$x$ in d) = 0 then
      raise exception '_tc_skip : repere part_order_allocations introuvable';
    end if;
    d := replace(d, $x$('part_order_allocations',$x$,
      $x$('part_receipt_allocations', 'Historique : commandes de pieces (lien reception)'),
    ('part_order_allocations',$x$);
    execute d;
  end if;
end $m$;

-- ---------------------------------------------------------------------
-- 2. A la validation d'une reception : quelles lignes de panier / d'Excel elle sert
-- ---------------------------------------------------------------------
create or replace function public._part_receipt_allocate(_receipt uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  p      public.purchase_orders%rowtype;
  r      record;
  s      record;
  _dcs   boolean;
  _left  numeric;
  _done  numeric;
  _take  numeric;
  _n     integer := 0;
begin
  select * into p from public.purchase_orders where id = _receipt;
  if not found or p.doc_type <> 'REC' or p.status <> 'recue' then return 0; end if;
  if exists (select 1 from public.part_receipt_allocations x where x.receipt_id = p.id) then return 0; end if;
  select coalesce(c.supplier_is_dcs, false) into _dcs from public.contacts c where c.id = p.supplier_id;
  _dcs := coalesce(_dcs, false);
  perform pg_advisory_xact_lock(hashtext('part_receipt_alloc:' || p.company_id::text));

  -- Les lignes rappelees d'une CMD ont deja leur lien (source_line_id) : on ne les recompte pas.
  for r in
    select l.id, l.article_id, l.quantity, a.reference
      from public.purchase_lines l join public.articles a on a.id = l.article_id
     where l.order_id = p.id and l.quantity > 0 and l.source_line_id is null
     order by l.sort_order
  loop
    _left := r.quantity;
    for s in
      select t.* from (
        select 'basket'::text as k, bl.id as lid, bl.qty as q, (b.kind = 'urgente') as urgent, b.ordered_at as oa, bl.sort_order as so
          from public.supplier_basket_lines bl
          join public.supplier_baskets b on b.id = bl.basket_id
         where bl.company_id = p.company_id and bl.article_id = r.article_id and b.status = 'commande'
           and (b.supplier_id = p.supplier_id or (b.supplier_id is null and _dcs))
        union all
        select 'excel', xl.id, xl.qty, false, x.ordered_at, xl.sort_order
          from public.excel_order_lines xl
          join public.excel_orders x on x.id = xl.excel_order_id
         where _dcs and x.company_id = p.company_id and xl.reference = r.reference and xl.qty > 0
           and x.status in ('commandee', 'cloture', 'archive') and x.ordered_at is not null
      ) t
      order by t.urgent desc, t.oa nulls last, t.so, t.lid
    loop
      exit when _left <= 0;
      select coalesce(sum(a.qty), 0) into _done from public.part_receipt_allocations a
       where a.supply_kind = s.k and a.supply_line_id = s.lid;
      _take := least(_left, s.q - _done);
      continue when _take <= 0;
      insert into public.part_receipt_allocations (company_id, receipt_id, receipt_line_id, article_id, supply_kind, supply_line_id, qty)
      values (p.company_id, p.id, r.id, r.article_id, s.k, s.lid, _take);
      _left := _left - _take;
      _n := _n + 1;
    end loop;
  end loop;

  if _n > 0 then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (p.company_id, auth.uid(), 'part_receipt_allocated', 'purchase_orders', p.id::text, 'system', null,
            jsonb_build_object('number', p.number, 'bl', p.supplier_bl_no, 'allocations', _n));
  end if;
  return _n;
end $fn$;
revoke all on function public._part_receipt_allocate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Le chemin de chaque piece (lecture seule)
-- ---------------------------------------------------------------------
create or replace function public._part_path_rows(_company uuid, _scope text, _scope_id uuid, _open_only boolean, _limit integer)
returns table (
  demand_kind text, demand_id uuid, article_id uuid, reference text, designation text, bin_location text,
  qty_needed numeric, order_kind text, source_id uuid, source_number text, source_status text, excel_tab text,
  contact_id uuid, contact_name text, contact_phone text, repair_order_id uuid, or_number text,
  appointment_id uuid, appointment_at timestamptz, document_id uuid, document_number text,
  supplies jsonb, qty_reserved numeric, qty_prepared numeric, qty_delivered numeric,
  informed_at timestamptz, informed_channel text, notice_status text, notice_is_test boolean, demanded_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with pol as (
    select 'part_order'::text as dk, 'part'::text as src, l.id as did, l.article_id as aid,
           coalesce(nullif(btrim(a.reference), ''), l.reference) as ref,
           coalesce(nullif(btrim(a.designation), ''), l.designation) as des,
           nullif(btrim(coalesce(a.bin_location, '')), '') as bin,
           coalesce(l.qty_client, 0) + coalesce(l.qty_shop, 0) as need,
           o.order_kind::text as okind, o.id as sid, o.number as snum, o.dispatch_status::text as sst, null::text as xtab,
           o.contact_id as cid, o.repair_order_id as roid, null::uuid as apid, o.source_document_id as docid,
           coalesce(o.validated_at, o.created_at) as dat, l.sort_order as so
      from public.part_order_lines l
      join public.part_orders o on o.id = l.order_id
      left join public.articles a on a.id = l.article_id
     where o.company_id = _company
       and o.dispatch_status not in ('brouillon', 'annulee')
       and coalesce(l.qty_client, 0) + coalesce(l.qty_shop, 0) > 0
  ), res as (
    select 'reservation'::text, 'res'::text, s.id, s.article_id,
           coalesce(nullif(btrim(s.reference), ''), a.reference),
           coalesce(nullif(btrim(s.designation), ''), a.designation),
           nullif(btrim(coalesce(a.bin_location, '')), ''),
           s.qty_needed, coalesce(s.basket_kind, 'standard'), coalesce(s.repair_order_id, s.appointment_id), ro.number, s.status, null::text,
           s.contact_id, s.repair_order_id, s.appointment_id, null::uuid, s.created_at, 0
      from public.stock_reservations s
      join public.articles a on a.id = s.article_id
      left join public.repair_orders ro on ro.id = s.repair_order_id
     where s.company_id = _company and s.status <> 'liberee' and s.qty_needed > 0
       and (s.qty_to_order > 0 or s.qty_reserved < s.qty_needed
            or exists (select 1 from public.supplier_basket_lines bl where bl.origin_line_id = s.id)
            or (_scope in ('repair_order', 'appointment') and _scope_id in (s.repair_order_id, s.appointment_id)))
  ), stk_b as (
    select 'stock'::text, 'basket'::text, bl.id, bl.article_id, bl.reference, bl.designation,
           nullif(btrim(coalesce(a.bin_location, '')), ''), bl.qty, b.kind, b.id, coalesce(b.dcs_order_number, b.label), b.status, null::text,
           bl.contact_id, null::uuid, null::uuid, null::uuid, bl.created_at, bl.sort_order
      from public.supplier_basket_lines bl
      join public.supplier_baskets b on b.id = bl.basket_id
      left join public.articles a on a.id = bl.article_id
     where bl.company_id = _company and b.status <> 'annule' and bl.qty > 0
       and not (bl.origin_line_id is not null
                and (exists (select 1 from public.part_order_lines x where x.id = bl.origin_line_id)
                     or exists (select 1 from public.stock_reservations x where x.id = bl.origin_line_id)))
  ), stk_c as (
    select 'stock'::text, 'cmd'::text, pl.id, pl.article_id,
           coalesce(nullif(btrim(a.reference), ''), pl.supplier_ref), coalesce(nullif(btrim(a.designation), ''), pl.designation),
           coalesce(nullif(btrim(coalesce(pl.bin_location, '')), ''), nullif(btrim(coalesce(a.bin_location, '')), '')),
           pl.quantity, case po.dcs_kind when 'URGENTE' then 'urgente' else 'standard' end, po.id, po.number, po.status, null::text,
           pl.contact_id, null::uuid, null::uuid, null::uuid, coalesce(po.validated_at, po.created_at), pl.sort_order
      from public.purchase_lines pl
      join public.purchase_orders po on po.id = pl.order_id
      left join public.articles a on a.id = pl.article_id
     where po.company_id = _company and po.doc_type = 'CMD' and po.status in ('validee', 'partielle', 'recue', 'soldee')
       and pl.quantity > 0
       and not exists (select 1 from public.part_order_lines x where x.purchase_line_id = pl.id)
  ), stk_x as (
    select 'stock'::text, 'excel'::text, xl.id, art.id, xl.reference, xl.description,
           nullif(btrim(coalesce(art.bin_location, '')), ''), xl.qty, 'excel'::text, x.id, x.number, x.status, xl.tab,
           xl.contact_id, null::uuid, null::uuid, null::uuid, xl.created_at, xl.sort_order
      from public.excel_order_lines xl
      join public.excel_orders x on x.id = xl.excel_order_id
      left join lateral (select a.id, a.bin_location from public.articles a
                          where a.company_id = _company and a.reference = xl.reference limit 1) art on true
     where x.company_id = _company and xl.qty > 0 and xl.part_order_line_id is null
  ), d as (
    select * from pol union all select * from res union all select * from stk_b
    union all select * from stk_c union all select * from stk_x
  ), cmd_share as (
    -- Une ligne fournisseur peut servir plusieurs clients : la quantite recue va au plus ancien d'abord.
    select d.did, x.purchase_line_id as plid, d.need,
           coalesce(sum(d.need) over (partition by x.purchase_line_id order by d.dat, d.so, d.did
                                      rows between unbounded preceding and 1 preceding), 0) as before
      from d join public.part_order_lines x on x.id = d.did
     where d.src = 'part' and x.purchase_line_id is not null
    union all
    select d.did, d.did, d.need, 0::numeric from d where d.src = 'cmd'
  ), sup as (
    select c.did, po.id as doc_id,
           jsonb_build_object(
             'kind', 'cmd', 'doc_id', po.id, 'number', po.number,
             'type', lower(po.dcs_kind), 'dcs', po.intranet_no, 'status', po.status,
             'ordered_at', po.order_date, 'expected_at', po.expected_date,
             'qty', c.need,
             'received', least(c.need, greatest(public._purchase_line_received(pl.id) - c.before, 0)),
             'receipts', coalesce((
               select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'date', r.receipt_date,
                                                   'bl', r.supplier_bl_no, 'invoice', r.supplier_invoice_no)
                                order by r.receipt_date, r.number)
                 from public.purchase_orders r
                where r.doc_type = 'REC' and r.status = 'recue'
                  and exists (select 1 from public.purchase_lines rl where rl.order_id = r.id and rl.source_line_id = pl.id)), '[]'::jsonb)
           ) as j,
           coalesce((select array_agg(rl.order_id) from public.purchase_lines rl where rl.source_line_id = pl.id), '{}'::uuid[]) as rec_ids
      from cmd_share c
      join public.purchase_lines pl on pl.id = c.plid
      join public.purchase_orders po on po.id = pl.order_id
     where po.status <> 'annulee'
    union all
    select bk.did, b.id,
           jsonb_build_object(
             'kind', 'basket', 'doc_id', b.id, 'number', b.label,
             'type', b.kind, 'dcs', b.dcs_order_number, 'status', b.status,
             'ordered_at', b.ordered_at, 'expected_at', null,
             'qty', bk.qty,
             'received', case when b.status = 'recu' then bk.qty else least(bk.qty, coalesce(al.q, 0)) end,
             'received_at', b.received_at,
             'receipts', coalesce(al.receipts, '[]'::jsonb)
           ),
           coalesce(al.ids, '{}'::uuid[])
      from (select bl.id as lid, bl.basket_id, bl.qty, coalesce(bl.origin_line_id, bl.id) as did
              from public.supplier_basket_lines bl
             where bl.company_id = _company and bl.origin_line_id in (select d.did from d)
            union all
            select bl.id, bl.basket_id, bl.qty, bl.id
              from public.supplier_basket_lines bl join d on d.did = bl.id and d.src = 'basket') bk
      join public.supplier_baskets b on b.id = bk.basket_id
      left join lateral (
        select sum(a.qty) as q, array_agg(distinct a.receipt_id) as ids,
               jsonb_agg(distinct jsonb_build_object('id', r.id, 'number', r.number, 'date', r.receipt_date,
                                                     'bl', r.supplier_bl_no, 'invoice', r.supplier_invoice_no)) as receipts
          from public.part_receipt_allocations a
          join public.purchase_orders r on r.id = a.receipt_id
         where a.supply_kind = 'basket' and a.supply_line_id = bk.lid and r.status = 'recue') al on true
     where b.status <> 'annule'
    union all
    select xs.did, x.id,
           jsonb_build_object(
             'kind', 'excel', 'doc_id', x.id, 'number', x.number,
             'type', 'excel', 'dcs', x.dcs_number, 'status', x.status,
             'ordered_at', x.ordered_at, 'expected_at', null,
             'qty', xs.qty,
             'received', least(xs.qty, coalesce(al.q, 0)),
             'receipts', coalesce(al.receipts, '[]'::jsonb)
           ),
           coalesce(al.ids, '{}'::uuid[])
      from (select xl.id as lid, xl.excel_order_id, xl.qty, coalesce(xl.part_order_line_id, xl.id) as did
              from public.excel_order_lines xl
             where xl.qty > 0 and (xl.part_order_line_id in (select d.did from d)
                                   or xl.id in (select d.did from d where d.src = 'excel'))) xs
      join public.excel_orders x on x.id = xs.excel_order_id
      left join lateral (
        select sum(a.qty) as q, array_agg(distinct a.receipt_id) as ids,
               jsonb_agg(distinct jsonb_build_object('id', r.id, 'number', r.number, 'date', r.receipt_date,
                                                     'bl', r.supplier_bl_no, 'invoice', r.supplier_invoice_no)) as receipts
          from public.part_receipt_allocations a
          join public.purchase_orders r on r.id = a.receipt_id
         where a.supply_kind = 'excel' and a.supply_line_id = xs.lid and r.status = 'recue') al on true
     where x.company_id = _company
  ), sup_agg as (
    select s.did, jsonb_agg(s.j order by s.j ->> 'ordered_at' nulls last) as j,
           array_agg(s.doc_id) || coalesce((select array_agg(u) from sup s2, unnest(s2.rec_ids) u where s2.did = s.did), '{}'::uuid[]) as doc_ids,
           sum((s.j ->> 'received')::numeric) as received
      from sup s group by s.did
  ), f as (
    select d.*, coalesce(sp.j, '[]'::jsonb) as sj, coalesce(sp.doc_ids, '{}'::uuid[]) as doc_ids, coalesce(sp.received, 0) as rcv,
           ap.starts_at as ap_at, coalesce(d.apid, ap.id) as ap_id, ro.number as ro_no, ro.status::text as ro_st,
           doc.number as doc_no,
           coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as cname,
           coalesce(nullif(btrim(c.gsm), ''), nullif(btrim(c.mobile), ''), nullif(btrim(c.phone), '')) as cphone,
           -- Reservee : la reservation atelier, ou le document de reservation du client
           least(d.need, case
             when d.src = 'res' then (select s.qty_reserved from public.stock_reservations s where s.id = d.did)
             when d.src = 'part' and d.roid is not null then coalesce((
               select sum(s.qty_reserved) from public.stock_reservations s
                where s.repair_order_id = d.roid and s.article_id = d.aid and s.status = 'active'), 0)
             when d.src = 'part' and doc.doc_type::text = 'RES' then coalesce((
               select sum(dl.quantity) from public.document_lines dl where dl.document_id = doc.id and dl.article_id = d.aid), 0)
             else 0 end) as q_res,
           least(d.need, coalesce(pk.q, 0)) as q_prep,
           least(d.need, greatest(
             coalesce(pk.q_done, 0),
             case when d.src = 'res' then (select s.qty_consumed from public.stock_reservations s where s.id = d.did) else 0 end,
             case when d.roid is not null and ro.status::text = 'facture' then d.need else 0 end,
             case when d.src = 'part' and d.docid is not null and exists (
                    select 1 from public.document_sources ds join public.documents ch on ch.id = ds.document_id
                     where ds.source_document_id = d.docid and ch.doc_type::text in ('BL', 'FAC', 'TIK')
                       and ch.status::text not in ('brouillon', 'annulee')) then d.need else 0 end,
             case when d.src = 'part' then coalesce((
               select sum(al.qty) from public.part_order_allocations al join public.documents ch on ch.id = al.document_id
                where al.part_order_line_id = d.did and al.cancelled_at is null
                  and ch.doc_type::text in ('BL', 'FAC', 'TIK') and ch.status::text not in ('brouillon', 'annulee')), 0) else 0 end
           )) as q_deliv,
           inf.informed_at as inf_at, inf.channel as inf_ch, nt.status as nt_st, nt.is_test as nt_test, nt.sent_at as nt_sent
      from d
      left join sup_agg sp on sp.did = d.did
      left join public.contacts c on c.id = d.cid
      left join public.repair_orders ro on ro.id = d.roid
      left join public.documents doc on doc.id = d.docid
      left join lateral (
        select a.id, a.starts_at from public.workshop_appointments a
         where a.company_id = _company and a.status not in ('annule', 'demande')
           and (a.id = d.apid or (d.roid is not null and a.or_id = d.roid))
         order by a.starts_at desc limit 1) ap on true
      left join lateral (
        select sum(i.qty_picked) as q, sum(i.qty_picked) filter (where p.status = 'livre') as q_done
          from public.picking_list_items i
          join public.picking_lists p on p.id = i.picking_id
         where d.aid is not null and i.article_id = d.aid and i.removed_at is null and p.status <> 'annulee'
           and p.company_id = _company
           and ((d.docid is not null and p.document_id = d.docid)
                or (d.roid is not null and p.repair_order_id = d.roid)
                or (d.apid is not null and p.appointment_id = d.apid))) pk on true
      left join lateral (
        select n.informed_at, n.channel from public.purchase_customer_notices n
         where n.company_id = _company
           and ((d.src = 'part' and n.source_kind = 'part_order' and n.source_id = d.sid)
                or (d.roid is not null and n.source_kind = 'repair_order' and n.source_id = d.roid)
                or (d.docid is not null and n.source_kind = 'document' and n.source_id = d.docid))
           and (n.article_id is null or n.article_id = d.aid)
         order by n.informed_at desc limit 1) inf on true
      left join lateral (
        select x.status, x.is_test, x.sent_at from public.notifications x
         where d.src = 'part' and x.template = 'parts_received' and x.entity_type = 'part_orders' and x.entity_id = d.sid::text
         order by x.created_at desc limit 1) nt on true
  )
  select f.dk, f.did, f.aid, f.ref, f.des, f.bin, f.need, f.okind, f.sid, f.snum, f.sst, f.xtab,
         f.cid, f.cname, f.cphone, f.roid, f.ro_no, f.ap_id, f.ap_at, f.docid, f.doc_no,
         f.sj, f.q_res, f.q_prep, f.q_deliv,
         coalesce(f.inf_at, case when f.nt_st = 'sent' and not coalesce(f.nt_test, false) then f.nt_sent end),
         coalesce(f.inf_ch, case when f.nt_st = 'sent' and not coalesce(f.nt_test, false) then 'email' end),
         f.nt_st, f.nt_test, f.dat
    from f
   where (case coalesce(_scope, 'all')
            when 'all' then true
            when 'part_order' then f.src = 'part' and f.sid = _scope_id
            when 'repair_order' then f.roid = _scope_id
            when 'appointment' then f.ap_id = _scope_id
            when 'basket' then _scope_id = any(f.doc_ids)
            when 'purchase' then _scope_id = any(f.doc_ids)
            else false end)
     and (not coalesce(_open_only, true)
          or (f.dk = 'stock' and f.rcv < f.need)
          or (f.dk <> 'stock' and f.q_deliv < f.need))
   order by f.ap_at nulls last, f.dat desc, f.so, f.did
   limit greatest(least(coalesce(_limit, 500), 2000), 1);
$fn$;
revoke all on function public._part_path_rows(uuid, text, uuid, boolean, integer) from public, anon, authenticated;

drop function if exists public.part_path_rows(uuid, text, uuid, boolean, integer);
create function public.part_path_rows(_company uuid, _scope text default 'all', _scope_id uuid default null,
                                      _open_only boolean default true, _limit integer default 500)
returns table (
  demand_kind text, demand_id uuid, article_id uuid, reference text, designation text, bin_location text,
  qty_needed numeric, order_kind text, source_id uuid, source_number text, source_status text, excel_tab text,
  contact_id uuid, contact_name text, contact_phone text, repair_order_id uuid, or_number text,
  appointment_id uuid, appointment_at timestamptz, document_id uuid, document_number text,
  supplies jsonb, qty_reserved numeric, qty_prepared numeric, qty_delivered numeric,
  informed_at timestamptz, informed_channel text, notice_status text, notice_is_test boolean, demanded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if coalesce(_scope, 'all') not in ('all', 'part_order', 'repair_order', 'appointment', 'basket', 'purchase') then
    raise exception 'Vue inconnue.' using errcode = 'P0001';
  end if;
  return query select * from public._part_path_rows(_company, coalesce(_scope, 'all'), _scope_id, _open_only, _limit);
end $fn$;
revoke all on function public.part_path_rows(uuid, text, uuid, boolean, integer) from public, anon;
grant execute on function public.part_path_rows(uuid, text, uuid, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Infos commandes client : retrouver le client d'un panier / d'un classeur Excel (PIE-05)
-- ---------------------------------------------------------------------
drop function if exists public.receipt_customer_infos(uuid);
create function public.receipt_customer_infos(_receipt uuid)
returns table(receipt_line_id uuid, article_id uuid, reference text, designation text, qty_received numeric, bin_location text,
              source_kind text, source_id uuid, source_number text, source_type text, source_status text, source_date date,
              contact_id uuid, contact_name text, contact_phone text, qty_needed numeric, ordered_for boolean,
              informed_at timestamptz, informed_channel text, via_kind text, via_number text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare p public.purchase_orders%rowtype;
begin
  select * into p from public.purchase_orders where id = _receipt;
  if not found or not public.is_member(p.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  with rl as (
    select l.id, l.article_id, a.reference, coalesce(nullif(btrim(a.designation), ''), l.designation) as des,
           l.quantity, coalesce(l.bin_location, a.bin_location) as bin, l.source_line_id
      from public.purchase_lines l join public.articles a on a.id = l.article_id
     where l.order_id = p.id and l.quantity > 0
  ), alloc as (
    -- Lignes de commande de pieces que CETTE reception a servies par un panier ou un classeur Excel
    select a.receipt_line_id as rlid, coalesce(bl.origin_line_id, xl.part_order_line_id) as pol_id,
           a.supply_kind, coalesce(b.dcs_order_number, b.label, x.dcs_number, x.number) as num
      from public.part_receipt_allocations a
      left join public.supplier_basket_lines bl on a.supply_kind = 'basket' and bl.id = a.supply_line_id
      left join public.supplier_baskets b on b.id = bl.basket_id
      left join public.excel_order_lines xl on a.supply_kind = 'excel' and xl.id = a.supply_line_id
      left join public.excel_orders x on x.id = xl.excel_order_id
     where a.receipt_id = p.id
  ), src as (
    -- commandes de pièces
    select rl.id as rlid, 'part_order'::text as kind, o.id as sid, o.number as snum, o.order_kind::text as stype,
           o.dispatch_status::text as sst, coalesce(o.validated_at, o.created_at)::date as sdate, o.contact_id as cid,
           (pl.qty_client + pl.qty_shop) as qn,
           ((pl.purchase_line_id is not null and pl.purchase_line_id = rl.source_line_id) or al.pol_id is not null) as ofor,
           coalesce(al.supply_kind, case when pl.purchase_line_id is not null then 'cmd' end) as vk,
           coalesce(al.num, (select po.number from public.purchase_lines y join public.purchase_orders po on po.id = y.order_id
                              where y.id = pl.purchase_line_id)) as vn
      from rl
      join public.part_order_lines pl on pl.article_id = rl.article_id
      join public.part_orders o on o.id = pl.order_id
      left join lateral (select x.pol_id, x.supply_kind, x.num from alloc x where x.rlid = rl.id and x.pol_id = pl.id limit 1) al on true
     where o.company_id = p.company_id
       and o.dispatch_status::text <> 'annulee'
       and ((pl.purchase_line_id is not null and pl.purchase_line_id = rl.source_line_id)
            or al.pol_id is not null
            or (pl.purchase_line_id is null and o.dispatch_status::text in ('en_attente_paiement', 'payee', 'a_envoyer')))
    union all
    -- réservations / bons de commande en attente
    select rl.id, 'document', d.id, d.number, d.doc_type::text, d.status::text, d.issue_date, d.contact_id,
           sum(dl.quantity), false, null::text, null::text
      from rl
      join public.document_lines dl on dl.article_id = rl.article_id
      join public.documents d on d.id = dl.document_id
     where d.company_id = p.company_id and d.doc_type::text in ('RES', 'BC')
       and d.status::text not in ('brouillon', 'annulee', 'converti')
     group by rl.id, d.id, d.number, d.doc_type, d.status, d.issue_date, d.contact_id
    union all
    -- OR ouverts
    select rl.id, 'repair_order', ro.id, ro.number, 'OR', ro.status::text, ro.created_at::date, ro.contact_id,
           sum(rol.quantity), false, null::text, null::text
      from rl
      join public.repair_order_lines rol on rol.article_id = rl.article_id
      join public.repair_orders ro on ro.id = rol.or_id
     where ro.company_id = p.company_id and ro.status::text not in ('facture', 'annule')
     group by rl.id, ro.id, ro.number, ro.status, ro.created_at, ro.contact_id
  )
  select rl.id, rl.article_id, rl.reference, rl.des, rl.quantity, rl.bin,
         src.kind, src.sid, src.snum, src.stype, src.sst, src.sdate, src.cid,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
         coalesce(nullif(btrim(c.gsm), ''), nullif(btrim(c.mobile), ''), nullif(btrim(c.phone), '')),
         src.qn, src.ofor,
         n.informed_at, n.channel, src.vk, src.vn
    from rl
    join src on src.rlid = rl.id
    left join public.contacts c on c.id = src.cid
    left join lateral (
      select x.informed_at, x.channel from public.purchase_customer_notices x
       where x.source_kind = src.kind and x.source_id = src.sid
         and (x.article_id is null or x.article_id = rl.article_id)
       order by x.informed_at desc limit 1
    ) n on true
   order by rl.reference, src.ofor desc, src.sdate;
end $function$;
revoke all on function public.receipt_customer_infos(uuid) from public, anon;
grant execute on function public.receipt_customer_infos(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. « Client prevenu » depuis le chemin (panier marque recu sans reception : pas de n° de reception)
-- ---------------------------------------------------------------------
alter table public.purchase_customer_notices alter column receipt_id drop not null;

create or replace function public.part_path_mark_informed(_company uuid, _source_kind text, _source_id uuid, _article uuid,
                                                          _channel text, _receipt uuid default null, _note text default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _cid uuid; _num text; nid bigint;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if coalesce(_channel, '') not in ('telephone', 'sms', 'email', 'comptoir', 'autre') then
    raise exception 'Moyen inconnu.' using errcode = 'P0001';
  end if;
  if _source_kind = 'part_order' then
    select o.contact_id, o.number into _cid, _num from public.part_orders o where o.id = _source_id and o.company_id = _company;
  elsif _source_kind = 'repair_order' then
    select r.contact_id, r.number into _cid, _num from public.repair_orders r where r.id = _source_id and r.company_id = _company;
  elsif _source_kind = 'document' then
    select d.contact_id, d.number into _cid, _num from public.documents d where d.id = _source_id and d.company_id = _company;
  else
    raise exception 'Document client inconnu.' using errcode = 'P0001';
  end if;
  if _cid is null then
    raise exception 'Aucun client sur ce document.' using errcode = 'P0002';
  end if;
  if _receipt is not null and not exists (select 1 from public.purchase_orders p where p.id = _receipt and p.company_id = _company and p.doc_type = 'REC') then
    raise exception 'Réception introuvable.' using errcode = 'P0002';
  end if;
  insert into public.purchase_customer_notices (company_id, receipt_id, article_id, source_kind, source_id, contact_id, channel, note, informed_by)
  values (_company, _receipt, _article, _source_kind, _source_id, _cid, _channel, nullif(btrim(coalesce(_note, '')), ''), auth.uid())
  returning id into nid;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'customer_informed_arrival', 'contacts', _cid::text, 'screen', null,
          jsonb_build_object('source', _num, 'article_id', _article, 'source_kind', _source_kind, 'source_id', _source_id, 'channel', _channel));
  return nid;
end $fn$;
revoke all on function public.part_path_mark_informed(uuid, text, uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.part_path_mark_informed(uuid, text, uuid, uuid, text, uuid, text) to authenticated;

select public.rls_perf_rewrite_all();
