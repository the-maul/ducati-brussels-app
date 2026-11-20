-- =====================================================================
-- VP11 — Réassort minimax : une proposition (panier) par fournisseur de l'article, comme G8
-- (décision du client, 20/11/2026 : « tout comme G8 »). ACH004 INV009
--
-- G8 : le réassort minimax fait une proposition par fournisseur. Le DMS mettait tout au panier
-- Ducati standard (aucun impact aujourd'hui : 1 article seulement a un fournisseur principal, et
-- aucun des articles à minimum).
--
-- 1. supplier_baskets.supplier_id (nouvelle colonne, facultative) : vide = panier Ducati (DCS,
--    comme avant) ; renseigné = panier de ce fournisseur (libellé « Standard du JJ/MM/AAAA —
--    FOURNISSEUR »). Ne change plus après la création (garde). Pas de nouvelle politique RLS
--    (colonne d'une table déjà protégée).
-- 2. Fournisseur de réassort d'un article (_minimax_supplier) : son fournisseur principal
--    (articles.main_supplier_id) s'il n'est pas un fournisseur DCS (Ducati) ; sinon, ou sans
--    fournisseur : panier Ducati standard (défaut).
-- 3. Fonctions du réassort redéfinies (corps de production, seul le choix du panier change) :
--    _basket_current (ne rend plus que le panier Ducati), _minimax_immediate, _workshop_minimax_after,
--    _minimax_prepare_night_list, minimax_proposal, _basket_fill_minimax (ne remplit un panier
--    qu'avec les articles de son fournisseur), _cron_basket_minimax (mode automatique : un panier
--    par fournisseur qui a une pièce à réassortir), minimax_proposal_apply (mode manuel : les
--    lignes acceptées sont réparties par fournisseur ; renvoie aussi basket_ids).
--    Les autres remplissages (commandes client, Shopify, saisie) vont toujours au panier Ducati.
--
-- Additive, rejouable. Essai à blanc : supabase/tests/vp11_minimax_par_fournisseur.sql. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '5s';

alter table public.supplier_baskets
  add column if not exists supplier_id uuid references public.contacts(id) on delete restrict;
create index if not exists idx_supplier_baskets_supplier on public.supplier_baskets(company_id, supplier_id, kind, status)
  where supplier_id is not null;
comment on column public.supplier_baskets.supplier_id is
  'VP11 (20/11/2026) : fournisseur du panier (réassort minimax par fournisseur) ; vide = panier Ducati (DCS).';

-- Le fournisseur d'un panier ne change pas après sa création.
create or replace function public._supplier_baskets_supplier_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $fn$
begin
  if new.supplier_id is distinct from old.supplier_id then
    raise exception 'Le fournisseur d''un panier ne se change pas : ouvrez un autre panier.' using errcode = '42501';
  end if;
  return new;
end $fn$;
drop trigger if exists trg_supplier_baskets_supplier_guard on public.supplier_baskets;
create trigger trg_supplier_baskets_supplier_guard before update of supplier_id on public.supplier_baskets
  for each row execute function public._supplier_baskets_supplier_guard();

-- Fournisseur de réassort : fournisseur principal non DCS ; null = Ducati.
create or replace function public._minimax_supplier(_article uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $fn$
  select s.id from public.articles a join public.contacts s on s.id = a.main_supplier_id and s.company_id = a.company_id
   where a.id = _article and not coalesce(s.supplier_is_dcs, false);
$fn$;
revoke all on function public._minimax_supplier(uuid) from public, anon, authenticated;

-- Panier ouvert d'un fournisseur (créé au besoin).
create or replace function public._basket_current_supplier(_company uuid, _kind text, _create boolean, _supplier uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare bid uuid; lbl text; sname text;
begin
  if _supplier is null then return public._basket_current(_company, _kind, _create); end if;
  if _kind not in ('standard', 'urgente', 'demo') then
    raise exception 'Type de panier inconnu : %', _kind using errcode = 'P0001';
  end if;
  select b.id into bid from public.supplier_baskets b
   where b.company_id = _company and b.kind = _kind and b.status = 'ouvert' and b.supplier_id = _supplier
   order by b.created_at desc limit 1;
  if bid is not null or not _create then return bid; end if;
  select coalesce(nullif(btrim(s.company_name), ''), nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), '?')
    into sname from public.contacts s where s.id = _supplier and s.company_id = _company;
  if sname is null then raise exception 'Fournisseur introuvable dans cette société.' using errcode = 'P0002'; end if;
  lbl := case _kind when 'urgente' then 'Urgente du ' when 'demo' then 'Démo du ' else 'Standard du ' end
         || to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY') || ' — ' || sname;
  perform set_config('app.basket_rpc', 'on', true);
  insert into public.supplier_baskets (company_id, kind, label, supplier_id, created_by)
  values (_company, _kind, lbl, _supplier, auth.uid()) returning id into bid;
  perform set_config('app.basket_rpc', 'off', true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'basket_open', 'supplier_baskets', bid::text,
          case when auth.uid() is null then 'system' else 'screen' end, null,
          jsonb_build_object('kind', _kind, 'label', lbl, 'supplier_id', _supplier));
  return bid;
end $fn$;
revoke all on function public._basket_current_supplier(uuid, text, boolean, uuid) from public, anon, authenticated;

-- Panier de réassort d'un article.
create or replace function public._minimax_basket(_company uuid, _article uuid, _create boolean)
returns uuid language sql security definer set search_path = public, pg_temp as $fn$
  select public._basket_current_supplier(_company, 'standard', _create, public._minimax_supplier(_article));
$fn$;
revoke all on function public._minimax_basket(uuid, uuid, boolean) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._basket_current(_company uuid, _kind text, _create boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare bid uuid; lbl text;
begin
  if _kind not in ('standard', 'urgente', 'demo') then
    raise exception 'Type de panier inconnu : %', _kind using errcode = 'P0001';
  end if;
  select b.id into bid from public.supplier_baskets b
   where b.company_id = _company and b.kind = _kind and b.status = 'ouvert'
     and b.supplier_id is null   -- VP11 : panier Ducati (DCS) ; les paniers fournisseurs sont à part
   order by b.created_at desc limit 1;
  if bid is not null or not _create then
    return bid;
  end if;
  lbl := case _kind when 'urgente' then 'Urgente du ' when 'demo' then 'Démo du ' else 'Standard du ' end
         || to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY');
  perform set_config('app.basket_rpc', 'on', true);
  insert into public.supplier_baskets (company_id, kind, label, created_by)
  values (_company, _kind, lbl, auth.uid()) returning id into bid;
  perform set_config('app.basket_rpc', 'off', true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'basket_open', 'supplier_baskets', bid::text,
          case when auth.uid() is null then 'system' else 'screen' end, null,
          jsonb_build_object('kind', _kind, 'label', lbl));
  return bid;
end $function$;

CREATE OR REPLACE FUNCTION public._minimax_immediate(_company uuid, _article uuid, _lowering boolean, _ref text DEFAULT NULL::text, _source text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare bid uuid; need numeric; cur numeric;
begin
  bid := public._minimax_basket(_company, _article, false);
  if bid is not null then
    -- verrou du panier AVANT le calcul : deux ventes simultanées de la même pièce se suivent.
    perform 1 from public.supplier_baskets where id = bid for update;
  end if;
  need := coalesce(public._basket_minimax_need(_company, bid, _article), 0);
  cur  := public._minimax_line_qty(bid, _article);
  if _lowering then
    if need <= cur then
      return 0;
    end if;
    if bid is null then
      bid := public._minimax_basket(_company, _article, true);
    end if;
    perform public._basket_add_lines(bid, jsonb_build_array(
      jsonb_build_object('article_id', _article, 'qty', need, 'origin', 'minimax')), true);
  else
    if bid is null or cur <= need then
      return 0;
    end if;
    perform set_config('app.basket_rpc', 'on', true);
    delete from public.supplier_basket_lines l
     where l.basket_id = bid and l.article_id = _article and l.origin = 'minimax';
    perform set_config('app.basket_rpc', 'off', true);
    if need > 0 then
      perform public._basket_add_lines(bid, jsonb_build_array(
        jsonb_build_object('article_id', _article, 'qty', need, 'origin', 'minimax')), true);
    else
      perform public._basket_refresh_total(bid);
    end if;
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), case when _lowering then 'minimax_immediate_add' else 'minimax_immediate_reduce' end,
          'supplier_baskets', bid::text, 'system',
          jsonb_build_object('article_id', _article, 'qty', cur),
          jsonb_build_object('article_id', _article, 'qty', need, 'ref', _ref, 'source', _source,
                             'minimax_stock', public._minimax_stock(_article)));
  return 1;
end $function$;

CREATE OR REPLACE FUNCTION public._workshop_minimax_after(_company uuid, _article uuid, _ref text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare bid uuid; need numeric;
begin
  -- Réglage « proposition manuelle » : rien n'entre au panier sans l'accord de l'utilisateur.
  if not public._minimax_is_auto(_company) then
    return 0;
  end if;
  bid := public._minimax_basket(_company, _article, false);
  need := public._basket_minimax_need(_company, bid, _article);
  if coalesce(need, 0) <= 0 then
    return 0;
  end if;
  if bid is null then
    bid := public._minimax_basket(_company, _article, true);
  end if;
  perform public._basket_add_lines(bid, jsonb_build_array(jsonb_build_object('article_id', _article, 'qty', need, 'origin', 'minimax')), true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'workshop_reservation_minimax', 'supplier_baskets', bid::text, 'system', null,
          jsonb_build_object('article_id', _article, 'qty', need, 'ref', _ref, 'minimax_stock', public._minimax_stock(_article)));
  return 1;
end $function$;

CREATE OR REPLACE FUNCTION public._minimax_prepare_night_list(_company uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare bid uuid; r record; need numeric; cur numeric; keep uuid[] := '{}'; n int;
begin
  -- Ignorées dont le stock a bougé depuis la décision : redeviennent candidates.
  delete from public.minimax_night_list l
   where l.company_id = _company and l.status = 'ignoree'
     and coalesce(l.last_move_id, 0) <> public._minimax_last_move(l.article_id);
  for r in
    select a.id, a.stock_min, a.stock_max from public.articles a
     where a.company_id = _company and a.mgmt_type = 'A' and coalesce(a.is_active, true)
       and coalesce(a.stock_min, 0) > 0
       and coalesce(a.supplier_availability, '') not in ('red', 'yellow')
  loop
    bid := public._minimax_basket(_company, r.id, false);
    need := coalesce(public._basket_minimax_need(_company, bid, r.id), 0);
    cur  := public._minimax_line_qty(bid, r.id);
    if need <= cur then continue; end if;
    if exists (select 1 from public.minimax_night_list l
                where l.company_id = _company and l.article_id = r.id and l.status = 'ignoree') then
      continue;
    end if;
    insert into public.minimax_night_list (company_id, article_id, status, qty, minimax_stock, stock_min, stock_max,
                                           on_order, last_move_id, prepared_at, decided_at, decided_by)
    values (_company, r.id, 'proposee', need - cur, public._minimax_stock(r.id), r.stock_min, r.stock_max,
            public._basket_on_order_qty(_company, r.id, bid), null, now(), null, null)
    on conflict (company_id, article_id) do update
       set status = 'proposee', qty = excluded.qty, minimax_stock = excluded.minimax_stock,
           stock_min = excluded.stock_min, stock_max = excluded.stock_max, on_order = excluded.on_order,
           last_move_id = null, prepared_at = excluded.prepared_at, decided_at = null, decided_by = null;
    keep := keep || r.id;
  end loop;
  -- Proposées d'hier dont le besoin a disparu.
  delete from public.minimax_night_list l
   where l.company_id = _company and l.status = 'proposee' and not (l.article_id = any (keep));
  select count(*) into n from public.minimax_night_list l where l.company_id = _company and l.status = 'proposee';
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.minimax_proposal(_company uuid, _articles uuid[])
 RETURNS TABLE(article_id uuid, reference text, designation text, stock_min numeric, stock_max numeric, minimax_stock numeric, on_order numeric, in_basket numeric, qty numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare bid uuid; r record; need numeric; cur numeric;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  for r in
    select a.id, a.reference, coalesce(a.designation, '') as designation, a.stock_min, a.stock_max
      from public.articles a
     where a.company_id = _company and a.id in (select distinct x from unnest(coalesce(_articles, '{}'::uuid[])) x)
     order by a.reference
  loop
    bid := public._minimax_basket(_company, r.id, false);
    need := coalesce(public._basket_minimax_need(_company, bid, r.id), 0);
    cur  := public._minimax_line_qty(bid, r.id);
    if need > cur then
      article_id := r.id; reference := r.reference; designation := r.designation;
      stock_min := r.stock_min; stock_max := r.stock_max;
      minimax_stock := public._minimax_stock(r.id);
      on_order := public._basket_on_order_qty(_company, r.id, bid)
                  + coalesce((select sum(l.qty) from public.supplier_basket_lines l
                               where bid is not null and l.basket_id = bid and l.article_id = r.id
                                 and l.origin <> 'minimax'), 0);
      in_basket := cur;
      qty := need - cur;
      return next;
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public._basket_fill_minimax(_basket uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  b       public.supplier_baskets%rowtype;
  r       record;
  need    numeric;
  lines   jsonb := '[]'::jsonb;
  n_rm    int := 0;
  res     jsonb;
begin
  select * into b from public.supplier_baskets where id = _basket;
  if not found then
    raise exception 'Panier introuvable.' using errcode = 'P0002';
  end if;
  if b.status <> 'ouvert' then
    raise exception 'Ce panier est déjà commandé (%).', b.label using errcode = 'P0001';
  end if;
  for r in
    select a.id from public.articles a
     where a.company_id = b.company_id and a.mgmt_type = 'A' and coalesce(a.is_active, true)
       and coalesce(a.stock_min, 0) > 0
       and coalesce(a.supplier_availability, '') not in ('red', 'yellow')
       and public._minimax_supplier(a.id) is not distinct from b.supplier_id   -- VP11
  loop
    need := public._basket_minimax_need(b.company_id, _basket, r.id);
    if need > 0 then
      lines := lines || jsonb_build_object('article_id', r.id, 'qty', need, 'origin', 'minimax');
    end if;
  end loop;
  perform set_config('app.basket_rpc', 'on', true);
  with keep as (select (x ->> 'article_id')::uuid as aid from jsonb_array_elements(lines) x)
  delete from public.supplier_basket_lines l
   where l.basket_id = _basket and l.origin = 'minimax'
     and l.article_id not in (select aid from keep);
  get diagnostics n_rm = row_count;
  perform set_config('app.basket_rpc', 'off', true);
  res := public._basket_add_lines(_basket, lines, true);
  return res || jsonb_build_object('removed', n_rm);
end $function$;

CREATE OR REPLACE FUNCTION public._cron_basket_minimax()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare _co record; _sup record; bid uuid; res jsonb; _n int := 0; _cnt int;
begin
  for _co in select id from public.companies loop
    begin
      if public._minimax_is_auto(_co.id) then
        bid := public._basket_current(_co.id, 'standard', true);
        res := public._basket_fill_minimax(bid);
        -- VP11 : un panier par fournisseur (hors Ducati) qui a au moins une pièce à réassortir.
        for _sup in select distinct public._minimax_supplier(a.id) as sid from public.articles a
                     where a.company_id = _co.id and a.mgmt_type = 'A' and coalesce(a.is_active, true)
                       and coalesce(a.stock_min, 0) > 0 and a.main_supplier_id is not null loop
          continue when _sup.sid is null;
          bid := public._basket_current_supplier(_co.id, 'standard', false, _sup.sid);
          if bid is null and not exists (select 1 from public.articles a where a.company_id = _co.id and a.main_supplier_id = _sup.sid
                                         and coalesce(public._basket_minimax_need(_co.id, null, a.id), 0) > 0) then
            continue;
          end if;
          bid := coalesce(bid, public._basket_current_supplier(_co.id, 'standard', true, _sup.sid));
          res := res || jsonb_build_object('supplier_' || _sup.sid::text, public._basket_fill_minimax(bid));
        end loop;
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_co.id, null, 'basket_fill_minimax', 'supplier_baskets', bid::text, 'system', null, res || jsonb_build_object('at', now()));
      else
        _cnt := public._minimax_prepare_night_list(_co.id);
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_co.id, null, 'minimax_night_list', 'companies', _co.id::text, 'system', null,
                jsonb_build_object('proposed', _cnt, 'at', now()));
      end if;
      _n := _n + 1;
    exception when others then
      raise notice 'basket minimax skipped for company %: %', _co.id, sqlerrm;
    end;
  end loop;
  return _n;
end $function$;

CREATE OR REPLACE FUNCTION public.minimax_proposal_apply(_company uuid, _lines jsonb, _ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare bid uuid; j jsonb; lines jsonb := '[]'::jsonb; res jsonb; aid uuid; q numeric; ids uuid[] := '{}';
        g record; r1 jsonb; bids uuid[] := '{}'; n_add int := 0; n_merge int := 0; n_skip int := 0;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if _lines is null or jsonb_typeof(_lines) <> 'array' then
    raise exception 'Lignes attendues sous forme de liste.' using errcode = 'P0001';
  end if;
  for j in select * from jsonb_array_elements(_lines) loop
    aid := nullif(j ->> 'article_id', '')::uuid;
    q   := coalesce(public._jnum(j, 'qty'), 0);
    if aid is null or q <= 0 then continue; end if;
    if not exists (select 1 from public.articles a where a.id = aid and a.company_id = _company) then
      raise exception 'Article introuvable dans cette société (%).', aid using errcode = 'P0002';
    end if;
    lines := lines || jsonb_build_object('article_id', aid, 'qty', q, 'origin', 'minimax');
    ids := ids || aid;
  end loop;
  if jsonb_array_length(lines) = 0 then
    return jsonb_build_object('basket_id', null, 'added', 0, 'merged', 0, 'skipped', 0);
  end if;
  -- VP11 : une proposition (panier) par fournisseur de l'article, panier Ducati standard sinon.
  for g in select public._minimax_supplier((x ->> 'article_id')::uuid) as sid, jsonb_agg(x) as ls
             from jsonb_array_elements(lines) x group by 1 loop
    bid := case when g.sid is null then public._basket_current(_company, 'standard', true)
                else public._basket_current_supplier(_company, 'standard', true, g.sid) end;
    r1 := public._basket_add_lines(bid, g.ls, false);
    bids := bids || bid;
    n_add := n_add + coalesce((r1 ->> 'added')::int, 0);
    n_merge := n_merge + coalesce((r1 ->> 'merged')::int, 0);
    n_skip := n_skip + coalesce((r1 ->> 'skipped')::int, 0);
  end loop;
  bid := bids[1];
  res := jsonb_build_object('basket_id', bid, 'basket_ids', to_jsonb(bids), 'added', n_add, 'merged', n_merge, 'skipped', n_skip);
  -- Au panier : la pièce sort de la liste de la nuit.
  delete from public.minimax_night_list l where l.company_id = _company and l.article_id = any (ids);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'minimax_proposal_added', 'supplier_baskets', bid::text, 'screen', null,
          jsonb_build_object('ref', _ref, 'lines', lines, 'baskets', to_jsonb(bids)));
  return res;
end $function$;
