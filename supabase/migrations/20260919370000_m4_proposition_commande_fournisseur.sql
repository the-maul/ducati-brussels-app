-- =====================================================================
-- Mission 02 — carte 4 « Regrouper les commandes par fournisseur et les envoyer »
-- (parité G8 « Rappel proposition de commande », process-commandes-pieces.md §2.3).
--
-- 1. Proposition de commande : toutes les pièces des commandes de pièces VALIDÉES
--    (en attente de paiement, payées, à envoyer), pas encore passées chez un
--    fournisseur, avec le fournisseur, son minimum de commande et son franco
--    (colonnes existantes contacts.supplier_order_min / supplier_franco_min).
-- 2. « Valider → commande fournisseur » : crée la commande fournisseur M04 (CMD-,
--    séquence par société) et ses lignes, relie chaque pièce de commande client à
--    sa ligne fournisseur (part_order_lines.purchase_line_id), fait passer les
--    commandes de pièces entièrement commandées à « envoyée » (par
--    part_order_transition, seul chemin d'état), trace dans events. Fournisseur
--    DCS (Ducati, case sur la fiche fournisseur) : une CMD STANDARD et une CMD
--    URGENTE distinctes (2 fichiers DCS). Les commandes Excel gardent leur circuit
--    (classeur Ducati) : refusées ici.
-- 3. « En commande » sans double comptage : une pièce de commande client reliée à
--    une ligne de CMD compte UNE fois, par la commande de pièces (règle client /
--    magasin de la mission 05 carte 7) ; la ligne de CMD ne compte que ce qu'elle
--    commande EN PLUS pour le stock. Quand la CMD est reçue (REC liée reçue), plus
--    rien ne compte « en commande » (la pièce est dans le stock réel).
-- 4. Réception : purchase_order_destinations(CMD ou REC liée) = à qui est destinée
--    chaque ligne (client, commande de pièces, document d'origine).
--
-- Additif : 3 colonnes, 1 contrainte, 1 index, 1 trigger de garde, 6 fonctions
-- nouvelles, article_on_order_for redéfinie (même signature, même règle client).
-- Aucun mouvement de stock.
-- =====================================================================

-- ------------------------------------------------ 1. Colonnes
alter table public.contacts add column if not exists supplier_is_dcs boolean not null default false;
comment on column public.contacts.supplier_is_dcs is
  'Fournisseur commandé par le DCS Ducati (fichiers STANDARD / URGENTE séparés) — mission 02 carte 4.';

alter table public.part_order_lines add column if not exists purchase_line_id uuid
  references public.purchase_lines(id) on delete set null;
comment on column public.part_order_lines.purchase_line_id is
  'Ligne de commande fournisseur (CMD) qui commande cette pièce ; posé par supplier_order_from_proposal uniquement.';
create index if not exists idx_part_order_lines_purchase_line
  on public.part_order_lines(purchase_line_id) where purchase_line_id is not null;

alter table public.purchase_orders add column if not exists dcs_kind text;
comment on column public.purchase_orders.dcs_kind is
  'Fichier DCS de cette commande (STANDARD / URGENTE) quand le fournisseur passe par le DCS Ducati.';
do $$ begin
  alter table public.purchase_orders add constraint purchase_orders_dcs_kind_chk
    check (dcs_kind is null or dcs_kind in ('STANDARD', 'URGENTE'));
exception when duplicate_object then null; end $$;

-- ------------------------------------------------ 2. Garde du lien pièce ↔ ligne fournisseur
create or replace function public.part_order_lines_supplier_link_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.purchase_line_id is not null
       and coalesce(current_setting('app.supplier_order_rpc', true), '') <> 'on' then
      raise exception 'Le lien avec la commande fournisseur se pose par « Valider → commande fournisseur ».'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.purchase_line_id is not distinct from old.purchase_line_id then
    return new;
  end if;
  if coalesce(current_setting('app.supplier_order_rpc', true), '') = 'on' then
    return new;
  end if;
  -- Ligne de commande fournisseur supprimée (ON DELETE SET NULL) : la pièce revient dans la proposition.
  if new.purchase_line_id is null
     and not exists (select 1 from public.purchase_lines pl where pl.id = old.purchase_line_id) then
    return new;
  end if;
  raise exception 'Le lien avec la commande fournisseur se pose par « Valider → commande fournisseur ».'
    using errcode = '42501';
end $$;

revoke all on function public.part_order_lines_supplier_link_guard() from public, anon, authenticated;

drop trigger if exists trg_part_order_lines_supplier_link_guard on public.part_order_lines;
create trigger trg_part_order_lines_supplier_link_guard before insert or update on public.part_order_lines
  for each row execute function public.part_order_lines_supplier_link_guard();

-- ------------------------------------------------ 3. « En commande » : une seule source compte
-- Règle client inchangée (mission 05 carte 7). Deux changements :
--   a. une ligne de CMD ne compte que sa quantité NON reprise par des pièces de commandes
--      de pièces reliées (non annulées) : ces pièces comptent déjà par la commande de pièces ;
--   b. une pièce de commande de pièces dont la CMD est reçue (REC liée reçue) ne compte plus.
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
       and not exists (
         select 1
           from public.purchase_lines pl
           join public.purchase_orders c on c.id = pl.order_id
           join public.purchase_orders r on r.source_order_id = c.id
          where pl.id = l.purchase_line_id
            and r.doc_type = 'REC' and r.status = 'recue')
  )
  select
    -- 1. commandes fournisseur pour le stock (hors pièces déjà comptées par une commande de pièces)
    coalesce((
      select sum(greatest(pl.quantity - coalesce((
               select sum(x.qty_client + x.qty_shop)
                 from public.part_order_lines x
                 join public.part_orders xo on xo.id = x.order_id
                where x.purchase_line_id = pl.id
                  and xo.dispatch_status not in ('brouillon', 'annulee')), 0), 0))
        from public.purchase_lines pl
        join public.purchase_orders o on o.id = pl.order_id
       where pl.article_id = _article
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

-- ------------------------------------------------ 4. Proposition de commande (lecture)
create or replace function public.supplier_order_proposal(_company uuid)
returns table (
  line_id uuid, order_id uuid, order_number text, order_kind text, dispatch_status text, paid boolean,
  validated_at timestamptz, contact_id uuid, contact_name text,
  source_document_id uuid, source_document_number text, source_document_type text,
  article_id uuid, reference text, supplier_ref text, designation text,
  supplier_id uuid, supplier_name text, supplier_email text,
  supplier_order_min numeric, supplier_franco_min numeric, supplier_is_dcs boolean,
  qty_client numeric, qty_shop numeric, purchase_price numeric, sale_price_ht numeric, vat_rate numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select l.id, o.id, o.number, o.order_kind::text, o.dispatch_status::text, o.paid,
         o.validated_at, o.contact_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
         o.source_document_id, d.number, d.doc_type::text,
         l.article_id, coalesce(nullif(btrim(a.reference), ''), l.reference),
         nullif(btrim(a.supplier_ref), ''), coalesce(nullif(btrim(l.designation), ''), a.designation),
         s.id,
         coalesce(nullif(btrim(s.company_name), ''), nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), '')),
         nullif(btrim(s.email), ''),
         s.supplier_order_min, s.supplier_franco_min, coalesce(s.supplier_is_dcs, false),
         l.qty_client, l.qty_shop,
         -- Prix d'achat : PA de la fiche article, sinon PAMP ; inconnu = null (signalé à l'écran)
         case when coalesce(a.purchase_price, 0) > 0 then a.purchase_price
              when coalesce(a.pamp, 0) > 0 then a.pamp
              else null end,
         l.unit_price_ht, l.vat_rate
    from public.part_order_lines l
    join public.part_orders o on o.id = l.order_id
    left join public.articles a on a.id = l.article_id
    left join public.contacts c on c.id = o.contact_id
    left join public.contacts s on s.id = l.supplier_id and s.company_id = o.company_id
    left join public.documents d on d.id = o.source_document_id
   where o.company_id = _company
     and o.dispatch_status in ('en_attente_paiement', 'payee', 'a_envoyer')
     and l.purchase_line_id is null
     and coalesce(l.qty_client, 0) + coalesce(l.qty_shop, 0) > 0
   order by s.company_name nulls last, o.validated_at nulls last, o.number, l.sort_order;
end $$;

revoke all on function public.supplier_order_proposal(uuid) from public, anon;
grant execute on function public.supplier_order_proposal(uuid) to authenticated;

-- ------------------------------------------------ 5. Choisir le fournisseur d'une pièce de la proposition
create or replace function public.supplier_proposal_set_supplier(_line uuid, _supplier uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.part_order_lines%rowtype; o public.part_orders%rowtype;
begin
  select * into l from public.part_order_lines where id = _line for update;
  if not found then
    raise exception 'Pièce introuvable.' using errcode = 'P0002';
  end if;
  select * into o from public.part_orders where id = l.order_id;
  if not public.is_member(o.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if l.purchase_line_id is not null then
    raise exception 'Pièce déjà commandée chez un fournisseur.' using errcode = 'P0001';
  end if;
  if _supplier is not null and not exists (
       select 1 from public.contacts s where s.id = _supplier and s.company_id = o.company_id and s.type = 'fournisseur') then
    raise exception 'Fournisseur introuvable dans cette société.' using errcode = 'P0002';
  end if;
  if l.supplier_id is not distinct from _supplier then
    return;
  end if;
  update public.part_order_lines set supplier_id = _supplier where id = l.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (o.company_id, auth.uid(), 'part_order_line_supplier', 'part_orders', o.id::text, 'screen',
          jsonb_build_object('line_id', l.id, 'supplier_id', l.supplier_id),
          jsonb_build_object('line_id', l.id, 'supplier_id', _supplier, 'reference', l.reference));
end $$;

revoke all on function public.supplier_proposal_set_supplier(uuid, uuid) from public, anon;
grant execute on function public.supplier_proposal_set_supplier(uuid, uuid) to authenticated;

-- ------------------------------------------------ 6. Valider → commande fournisseur
create or replace function public.supplier_order_from_proposal(
  _company uuid, _supplier uuid, _line_ids uuid[], _note text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        public.contacts%rowtype;
  n_asked  int;
  n_found  int;
  bad      text;
  grp      record;
  g        record;
  cmd_id   uuid;
  cmd_no   text;
  pl_id    uuid;
  k        int;
  created  jsonb := '[]'::jsonb;
  sent     jsonb := '[]'::jsonb;
  kept     jsonb := '[]'::jsonb;
  po       record;
  lines_j  jsonb;
  today    date := (now() at time zone 'Europe/Brussels')::date;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select * into s from public.contacts where id = _supplier and company_id = _company and type = 'fournisseur';
  if not found then
    raise exception 'Fournisseur introuvable dans cette société.' using errcode = 'P0002';
  end if;
  select count(distinct x) into n_asked from unnest(coalesce(_line_ids, '{}'::uuid[])) x;
  if n_asked = 0 then
    raise exception 'Cochez au moins une pièce.' using errcode = 'P0001';
  end if;

  -- Verrou des pièces + contrôles
  perform 1 from public.part_order_lines l where l.id = any(_line_ids) for update;
  select count(*),
         string_agg(distinct case
           when o.company_id <> _company then 'autre société'
           when o.dispatch_status not in ('en_attente_paiement', 'payee', 'a_envoyer')
             then coalesce(o.number, '?') || ' n''est pas une commande validée en cours'
           when l.purchase_line_id is not null then coalesce(l.reference, l.designation) || ' déjà commandée'
           when o.order_kind = 'excel' then coalesce(o.number, '?') || ' passe par le classeur Excel Ducati'
           when l.supplier_id is distinct from _supplier then coalesce(l.reference, l.designation) || ' n''a pas ce fournisseur'
           when coalesce(l.qty_client, 0) + coalesce(l.qty_shop, 0) <= 0 then coalesce(l.reference, l.designation) || ' sans quantité'
         end, ' ; ')
    into n_found, bad
    from public.part_order_lines l
    join public.part_orders o on o.id = l.order_id
   where l.id = any(_line_ids);
  if n_found <> n_asked then
    raise exception 'Pièce introuvable.' using errcode = 'P0002';
  end if;
  if bad is not null then
    raise exception 'Commande fournisseur refusée : %.', bad using errcode = 'P0001';
  end if;

  perform set_config('app.supplier_order_rpc', 'on', true);

  -- Une CMD par fichier DCS (Ducati) ; une seule CMD sinon.
  for grp in
    select case when s.supplier_is_dcs then (case when o.order_kind = 'urgente' then 'URGENTE' else 'STANDARD' end) end as dcs
      from public.part_order_lines l join public.part_orders o on o.id = l.order_id
     where l.id = any(_line_ids)
     group by 1
     order by 1 nulls first
  loop
    cmd_no := public._next_document_number_unchecked(_company, 'CMD');
    insert into public.purchase_orders (company_id, doc_type, number, supplier_id, status, order_date,
                                        vat_regime, dcs_kind, notes)
    values (_company, 'CMD', cmd_no, _supplier, 'validee', today, 'with_vat', grp.dcs,
            coalesce(nullif(btrim(coalesce(_note, '')), ''), 'Proposition de commande (commandes de pièces)'))
    returning id into cmd_id;

    lines_j := '[]'::jsonb;
    k := 0;
    -- Une ligne fournisseur par article (plusieurs clients peuvent partager la ligne)
    for g in
      select coalesce(l.article_id::text, l.id::text) as gkey,
             (array_agg(l.article_id))[1] as article_id,
             (array_agg(coalesce(nullif(btrim(a.reference), ''), l.reference)))[1] as ref,
             (array_agg(coalesce(nullif(btrim(a.designation), ''), l.designation)))[1] as des,
             (array_agg(coalesce(nullif(btrim(a.supplier_ref), ''), nullif(btrim(a.reference), ''), l.reference)))[1] as sref,
             (array_agg(case when coalesce(a.purchase_price, 0) > 0 then a.purchase_price
                             when coalesce(a.pamp, 0) > 0 then a.pamp else 0 end))[1] as pa,
             (array_agg(coalesce(a.vat_rate, l.vat_rate, 21)))[1] as vat,
             sum(l.qty_client + l.qty_shop) as qty,
             array_agg(l.id order by o.validated_at, l.sort_order) as ids,
             min(coalesce(nullif(btrim(a.reference), ''), l.reference, l.designation)) as sortkey
        from public.part_order_lines l
        join public.part_orders o on o.id = l.order_id
        left join public.articles a on a.id = l.article_id
       where l.id = any(_line_ids)
         and (case when s.supplier_is_dcs then (case when o.order_kind = 'urgente' then 'URGENTE' else 'STANDARD' end) end)
             is not distinct from grp.dcs
       group by 1
       order by sortkey
    loop
      insert into public.purchase_lines (order_id, article_id, designation, supplier_ref, quantity,
                                         unit_price_ht, discount_pct, vat_rate, line_ht, sort_order)
      values (cmd_id, g.article_id,
              btrim(concat_ws(' ', g.ref, g.des)), g.sref, g.qty,
              g.pa, 0, g.vat, round(g.qty * g.pa, 2), k)
      returning id into pl_id;
      update public.part_order_lines set purchase_line_id = pl_id where id = any(g.ids);
      lines_j := lines_j || jsonb_build_object('purchase_line_id', pl_id, 'reference', g.ref, 'qty', g.qty,
                                               'unit_price_ht', g.pa, 'part_order_line_ids', to_jsonb(g.ids));
      k := k + 1;
    end loop;

    update public.purchase_orders o set
      total_ht  = t.ht, total_vat = t.vat, total_ttc = t.ht + t.vat
    from (select coalesce(sum(line_ht), 0) as ht,
                 round(coalesce(sum(line_ht * vat_rate / 100), 0), 2) as vat
            from public.purchase_lines where order_id = cmd_id) t
    where o.id = cmd_id;

    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'supplier_order_from_proposal', 'purchase_orders', cmd_id::text, 'screen', null,
            jsonb_build_object('number', cmd_no, 'supplier_id', _supplier, 'dcs_kind', grp.dcs, 'lines', lines_j,
                               'note', nullif(btrim(coalesce(_note, '')), '')));

    created := created || jsonb_build_object('id', cmd_id, 'number', cmd_no, 'dcs_kind', grp.dcs,
                                             'lines', jsonb_array_length(lines_j));
  end loop;

  perform set_config('app.supplier_order_rpc', 'off', true);

  -- Commandes de pièces touchées : trace, puis « envoyée » quand toutes leurs pièces sont commandées.
  for po in
    select o.id, o.number, o.dispatch_status,
           array_agg(l.id) as ids,
           array_to_string(array_agg(distinct pc.number), ', ') as cmds
      from public.part_order_lines l
      join public.part_orders o on o.id = l.order_id
      join public.purchase_lines y on y.id = l.purchase_line_id
      join public.purchase_orders pc on pc.id = y.order_id
     where l.id = any(_line_ids)
     group by o.id, o.number, o.dispatch_status
  loop
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'part_order_supplier_order', 'part_orders', po.id::text, 'screen', null,
            jsonb_build_object('supplier_id', _supplier, 'purchase_orders', po.cmds, 'line_ids', to_jsonb(po.ids)));

    if exists (select 1 from public.part_order_lines x
                where x.order_id = po.id and x.purchase_line_id is null
                  and coalesce(x.qty_client, 0) + coalesce(x.qty_shop, 0) > 0) then
      kept := kept || jsonb_build_object('id', po.id, 'number', po.number, 'status', po.dispatch_status, 'reason', 'partial');
    elsif po.dispatch_status = 'en_attente_paiement' then
      kept := kept || jsonb_build_object('id', po.id, 'number', po.number, 'status', po.dispatch_status, 'reason', 'unpaid');
    else
      begin
        if po.dispatch_status = 'payee' then
          perform public.part_order_transition(po.id, 'a_envoyer', null,
            'Commandée chez le fournisseur (' || coalesce(po.cmds, '') || ')');
        end if;
        perform public.part_order_transition(po.id, 'envoyee', null,
          'Commandée chez le fournisseur (' || coalesce(po.cmds, '') || ')');
        sent := sent || jsonb_build_object('id', po.id, 'number', po.number);
      exception when others then
        kept := kept || jsonb_build_object('id', po.id, 'number', po.number, 'status', po.dispatch_status,
                                           'reason', 'rules', 'message', sqlerrm);
      end;
    end if;
  end loop;

  return jsonb_build_object('orders', created, 'part_orders_sent', sent, 'part_orders_kept', kept);
end $$;

revoke all on function public.supplier_order_from_proposal(uuid, uuid, uuid[], text) from public, anon;
grant execute on function public.supplier_order_from_proposal(uuid, uuid, uuid[], text) to authenticated;

-- ------------------------------------------------ 7. Trace d'un mail fournisseur envoyé (demande de prix / commande)
create or replace function public.supplier_proposal_log_mail(
  _company uuid, _supplier uuid, _kind text, _to text, _from text, _subject text, _line_ids uuid[], _attachment text
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contacts s where s.id = _supplier and s.company_id = _company and s.type = 'fournisseur') then
    raise exception 'Fournisseur introuvable dans cette société.' using errcode = 'P0002';
  end if;
  if _kind not in ('price_request', 'order') then
    raise exception 'Type de mail inconnu.' using errcode = 'P0001';
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'supplier_mail_sent', 'contacts', _supplier::text, 'screen', null,
          jsonb_build_object('kind', _kind, 'to', _to, 'from', _from, 'subject', _subject,
                             'line_ids', to_jsonb(coalesce(_line_ids, '{}'::uuid[])), 'attachment', _attachment));
end $$;

revoke all on function public.supplier_proposal_log_mail(uuid, uuid, text, text, text, text, uuid[], text) from public, anon;
grant execute on function public.supplier_proposal_log_mail(uuid, uuid, text, text, text, text, uuid[], text) to authenticated;

-- ------------------------------------------------ 8. À qui est destinée chaque ligne (réception)
-- Accepte une CMD, ou une réception (REC) reliée à sa CMD par source_order_id.
create or replace function public.purchase_order_destinations(_order uuid)
returns table (
  purchase_line_id uuid, part_order_line_id uuid, part_order_id uuid, part_order_number text,
  order_kind text, dispatch_status text, contact_id uuid, contact_name text,
  source_document_id uuid, source_document_number text, qty_client numeric, qty_shop numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p public.purchase_orders%rowtype; cmd uuid;
begin
  select * into p from public.purchase_orders where id = _order;
  if not found or not public.is_member(p.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  cmd := case when p.doc_type = 'CMD' then p.id else p.source_order_id end;
  if cmd is null then
    return;
  end if;
  return query
  select pl.id, l.id, o.id, o.number, o.order_kind::text, o.dispatch_status::text, o.contact_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
         o.source_document_id, d.number, l.qty_client, l.qty_shop
    from public.purchase_lines pl
    join public.part_order_lines l on l.purchase_line_id = pl.id
    join public.part_orders o on o.id = l.order_id
    left join public.contacts c on c.id = o.contact_id
    left join public.documents d on d.id = o.source_document_id
   where pl.order_id = cmd
     and o.company_id = p.company_id
   order by pl.sort_order, o.number;
end $$;

revoke all on function public.purchase_order_destinations(uuid) from public, anon;
grant execute on function public.purchase_order_destinations(uuid) to authenticated;
