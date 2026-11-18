-- =====================================================================
-- M5 / M2 — Rattrapage G8 (18/11/2026) : ÉTIQUETAGE (B12).
--   * sélection des articles à étiqueter : par référence, par groupe (familles /
--     fournisseur), à la réception, par date de modification de l'article ou du PV,
--     par casier (+ filtre éco-participation) ;
--   * ÉDITION DIFFÉRÉE CUMULÉE PAR POSTE : la file `label_queue` porte maintenant le
--     poste (`workstation_id`), l'origine, l'option double étiquette « prix tarif »,
--     et l'heure / l'auteur de l'impression ; liste « Étiquettes en attente » par poste.
-- L'impression elle-même passe par les périphériques du poste (Zebra ZPL) ou la
-- fenêtre d'impression du navigateur (src/modules/articles/labels/device-print.ts).
-- Idempotente. NON APPLIQUÉE. Le lien vers `workstations` n'est posé que si la
-- migration 20261103250000_m6_postes_peripheriques.sql est déjà passée.
-- =====================================================================

alter table public.label_queue add column if not exists workstation_id uuid;
alter table public.label_queue add column if not exists source         text not null default 'reference';
alter table public.label_queue add column if not exists source_ref     text;
alter table public.label_queue add column if not exists with_tarif     boolean not null default false;
alter table public.label_queue add column if not exists printed_at     timestamptz;
alter table public.label_queue add column if not exists printed_by     uuid references auth.users(id) on delete set null;
comment on column public.label_queue.source is
  'reference | groupe | reception | modif_article | modif_pv | casier | reajustement | fiche';
create index if not exists idx_label_queue_pending on public.label_queue (company_id, workstation_id) where not printed;

do $$
begin
  if to_regclass('public.workstations') is not null
     and not exists (select 1 from pg_constraint where conname = 'label_queue_workstation_fk') then
    alter table public.label_queue
      add constraint label_queue_workstation_fk foreign key (workstation_id) references public.workstations(id) on delete set null;
  end if;
end $$;

-- L'écran d'étiquetage vit aussi dans Stock (/stock/labels).
insert into public.table_write_pages (table_name, page) values ('label_queue', '/stock') on conflict do nothing;

-- ---------------------------------------------------------------------
-- Ajout en lot à la file du poste (édition différée cumulable, B12).
--   _items : [{ "article_id": "...", "qty": 3 }, …] ; qty absente = stock réel (au moins 1).
-- ---------------------------------------------------------------------
create or replace function public.enqueue_labels(_company uuid, _items jsonb, _workstation uuid default null,
                                                 _source text default 'reference', _source_ref text default null,
                                                 _barcode boolean default true, _price boolean default true,
                                                 _tarif boolean default false)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare _it jsonb; _art uuid; _q int; _n int := 0;
begin
  if not public.can_write_table(_company, 'label_queue') then raise exception 'Accès refusé'; end if;
  if jsonb_typeof(_items) <> 'array' then raise exception 'Liste d''articles attendue'; end if;
  for _it in select * from jsonb_array_elements(_items) loop
    _art := nullif(_it->>'article_id', '')::uuid;
    if _art is null or not exists (select 1 from public.articles where id = _art and company_id = _company) then
      raise exception 'Article inconnu pour cette société';
    end if;
    _q := nullif(_it->>'qty', '')::numeric::int;
    if _q is null then
      select greatest(coalesce(sum(qty_delta) filter (where not is_reservation), 0), 1)::int into _q
        from public.stock_moves where article_id = _art;
    end if;
    if _q > 0 then
      insert into public.label_queue (company_id, article_id, qty, with_barcode, with_price, with_tarif,
                                      operator_id, workstation_id, source, source_ref)
      values (_company, _art, _q, coalesce(_barcode, true), coalesce(_price, true), coalesce(_tarif, false),
              auth.uid(), _workstation, coalesce(_source, 'reference'), _source_ref);
      _n := _n + 1;
    end if;
  end loop;
  return _n;
end $$;
grant execute on function public.enqueue_labels(uuid, jsonb, uuid, text, text, boolean, boolean, boolean) to authenticated;

-- Étiquettes en attente, CUMULÉES par poste et par article (mêmes options).
create or replace function public.label_queue_pending(_company uuid)
returns table(workstation_id uuid, workstation_name text, article_id uuid, reference text, designation text,
              with_barcode boolean, with_price boolean, with_tarif boolean, qty bigint, lines bigint,
              first_at timestamptz, last_at timestamptz, operators text, ids bigint[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
        where q.company_id = $1 and not q.printed
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
       where q.company_id = _company and not q.printed
       group by q.workstation_id, q.article_id, a.reference, a.designation, q.with_barcode, q.with_price, q.with_tarif
       order by a.reference;
  end if;
end $$;
grant execute on function public.label_queue_pending(uuid) to authenticated;

-- Marque des lignes de la file comme imprimées (heure + auteur), ou les retire.
create or replace function public.label_queue_done(_company uuid, _ids bigint[], _action text default 'imprime')
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare _n int;
begin
  if not public.can_write_table(_company, 'label_queue') then raise exception 'Accès refusé'; end if;
  if _action = 'retire' then
    delete from public.label_queue where company_id = _company and id = any(_ids) and not printed;
  else
    update public.label_queue set printed = true, printed_at = now(), printed_by = auth.uid()
     where company_id = _company and id = any(_ids) and not printed;
  end if;
  get diagnostics _n = row_count;
  return _n;
end $$;
grant execute on function public.label_queue_done(uuid, bigint[], text) to authenticated;

-- ---------------------------------------------------------------------
-- Articles à étiqueter selon l'origine choisie (écran « Reprise étiquetage » G8).
--   _source : reference | groupe | reception | modif_article | modif_pv | casier
--   _f : search, category, supplier_id, bin, from, to (dates), reception_id, eco (bool), only_stock (bool)
--   default_qty = quantité reçue (réception, colonne « étiquettes » si saisie) sinon stock réel.
-- ---------------------------------------------------------------------
create or replace function public.label_candidates(_company uuid, _source text, _f jsonb default '{}'::jsonb,
                                                   _limit int default 500, _offset int default 0)
returns table(article_id uuid, reference text, designation text, bin_location text, bin_location2 text,
              price_ttc numeric, price_ht numeric, price_tarif numeric, pack_qty numeric, barcode text,
              real_qty numeric, default_qty numeric, changed_at timestamptz, total_count bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with p as (
    select coalesce(_source, 'reference') as src,
           nullif(btrim(coalesce(_f->>'search', '')), '') as s,
           nullif(btrim(coalesce(_f->>'category', '')), '') as cat,
           nullif(_f->>'supplier_id', '')::uuid as sup,
           nullif(btrim(coalesce(_f->>'bin', '')), '') as bin,
           nullif(_f->>'from', '')::date as dfrom,
           coalesce(nullif(_f->>'to', '')::date, (now() at time zone 'Europe/Brussels')::date) as dto,
           nullif(_f->>'reception_id', '')::uuid as rec,
           coalesce((_f->>'eco')::boolean, false) as eco,
           coalesce((_f->>'only_stock')::boolean, false) as only_stock
  ),
  rl as (
    select l.article_id, sum(case when coalesce(l.labels, 0) > 0 then l.labels else l.quantity end) as q
      from p join public.purchase_lines l on l.order_id = p.rec
      join public.purchase_orders o on o.id = l.order_id and o.company_id = _company
     where p.src = 'reception' and l.article_id is not null
     group by l.article_id
  ),
  pc as (
    select c.article_id, max(c.occurred_at) as at from p join public.price_changes c on c.company_id = _company
     where p.src = 'modif_pv' and c.new_sale_ttc is distinct from c.old_sale_ttc
       and (c.occurred_at at time zone 'Europe/Brussels')::date between coalesce(p.dfrom, p.dto) and p.dto
     group by c.article_id
  ),
  lv as (
    select m.article_id, sum(m.qty_delta) as q from public.stock_moves m
     where m.company_id = _company and not m.is_reservation group by m.article_id
  ),
  sel as (
    select a.*, coalesce(lv.q, 0) as real_q, rl.q as rec_q,
           case p.src when 'modif_pv' then pc.at when 'modif_article' then a.updated_at end as chg
      from public.articles a cross join p
      left join lv on lv.article_id = a.id
      left join rl on rl.article_id = a.id
      left join pc on pc.article_id = a.id
     where a.company_id = _company and public.is_member(_company)
       and a.mgmt_type::text not in ('F', 'T', 'R')
       and case p.src
             when 'reception' then rl.article_id is not null
             when 'modif_pv' then pc.article_id is not null
             when 'modif_article' then (a.updated_at at time zone 'Europe/Brussels')::date between coalesce(p.dfrom, p.dto) and p.dto
             when 'casier' then p.bin is not null
             when 'groupe' then (p.cat is not null or p.sup is not null)
             else p.s is not null or p.cat is not null or p.sup is not null or p.bin is not null
           end
       and (p.s is null or a.reference ilike '%' || p.s || '%' or a.designation ilike '%' || p.s || '%'
            or a.supplier_ref ilike '%' || p.s || '%'
            or exists (select 1 from public.article_barcodes bc where bc.article_id = a.id and bc.barcode = p.s))
       and (p.cat is null or a.category_path ilike p.cat || '%')
       and (p.sup is null or a.main_supplier_id = p.sup)
       and (p.bin is null or a.bin_location ilike p.bin || '%' or a.bin_location2 ilike p.bin || '%'
            or exists (select 1 from public.article_bins ab where ab.article_id = a.id and ab.bin_location ilike p.bin || '%'))
       and (not p.eco or coalesce(a.eco_tax_ttc, 0) > 0 or a.deee)
       and (not p.only_stock or coalesce(lv.q, 0) > 0)
  )
  select s.id, s.reference, s.designation, s.bin_location, s.bin_location2,
         s.sale_price_ttc, s.sale_price_ht, s.ppc_ttc, s.pack_qty,
         (select bc.barcode from public.article_barcodes bc where bc.article_id = s.id order by bc.is_primary desc, bc.created_at limit 1),
         s.real_q, coalesce(s.rec_q, s.real_q), s.chg, count(*) over ()
    from sel s
   order by s.bin_location nulls last, s.reference
   limit least(greatest(coalesce(_limit, 500), 1), 1000)
  offset greatest(coalesce(_offset, 0), 0);
$$;
revoke all on function public.label_candidates(uuid, text, jsonb, int, int) from public, anon;
grant execute on function public.label_candidates(uuid, text, jsonb, int, int) to authenticated;
