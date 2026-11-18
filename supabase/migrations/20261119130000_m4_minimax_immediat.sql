-- =====================================================================
-- M4 / M5 — Réassort minimax immédiat (décisions de Simon du 18/11/2026).
--
-- 1. Réassort immédiat par défaut : dès qu'une sortie de stock (vente, ticket, facture, BL,
--    picking, cession interne, besoin atelier, réajustement, rétrocession… toute ligne de
--    stock_moves qui baisse le stock du minimax) fait passer une pièce SOUS son minimum, le manque
--    jusqu'au maximum (déduction faite de ce qui est déjà en commande / au panier) est mis tout de
--    suite dans le panier standard ouvert, origine « minimax » — exactement la règle de
--    _workshop_minimax_after (atelier, 20261103270000) et de la tâche de nuit basket-minimax-daily
--    (_basket_minimax_need : stock du minimax = réel − réservé − manque des RDV ; filtre rouge /
--    jaune = pièce fin de série / remplacée jamais réassortie).
--    Un mouvement qui REMONTE le stock du minimax (entrée, libération de réservation) ramène la
--    ligne minimax du panier ouvert au besoin réel s'il est plus bas : la facture d'un BL (sortie
--    du réel puis libération de la réservation, deux requêtes séparées) ne commande donc pas deux
--    fois. Robuste : une erreur n'empêche JAMAIS la vente (exception attrapée, tracée dans events
--    « minimax_immediate_error »). Pas de doublon : une seule ligne minimax par article et par
--    panier, quantité = max(ligne actuelle, besoin). Multi-société : société de l'article.
--    Les réservations de l'atelier (origine « atelier ») restent traitées par
--    _workshop_minimax_after. La tâche de nuit reste en filet de sécurité (inchangée).
--    Contournement pour un traitement de masse : set_config('app.minimax_immediate', 'off', true).
--
-- 2. Réglage par société (Paramètres) : companies.minimax_mode = 'auto' (défaut) | 'manuel'.
--    En manuel : rien n'est ajouté automatiquement (ni ventes, ni atelier) ; à la validation d'une
--    vente / caisse / picking l'écran demande minimax_proposal (pièces passées sous leur minimum)
--    et propose « Ajouter » (minimax_proposal_apply) ou « Ignorer » (minimax_proposal_ignore,
--    tracé). Réglage changé par minimax_mode_set (administrateur, tracé).
--
-- 3. Remplacement de référence : quand une pièce reçoit superseded_by_id (écran, import ListPrice
--    état E, gestion des remplacements, fusion), son minimum / maximum passe sur la référence
--    FINALE de la chaîne (article_final_replacement) si celle-ci n'en a pas déjà, et son
--    conditionnement d'achat (pack_qty > 1) est recopié si celui de la nouvelle est vide (≤ 1).
--    L'ancienne référence perd son minimum / maximum (elle n'est plus réassortie) ; la trace est
--    dans events (« article_minimax_transfer » sur l'ancienne, « article_minimax_received » sur la
--    nouvelle). Rattrapage idempotent des remplacements existants, compte rendu par raise notice.
--
-- Additif, idempotent, rejouable. S'applique sur la base de production du 19/11 (bloc jusqu'à
-- 20261119120000 en place). Fonction redéfinie (même signature, corps de production + réglage) :
-- _workshop_minimax_after. Essai à blanc : supabase/tests/m4_minimax_immediat.sql.
-- =====================================================================

-- ------------------------------------------------ 1. Réglage par société
alter table public.companies add column if not exists minimax_mode text not null default 'auto';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_minimax_mode_chk') then
    alter table public.companies add constraint companies_minimax_mode_chk check (minimax_mode in ('auto', 'manuel'));
  end if;
end $$;
comment on column public.companies.minimax_mode is
  'Réassort minimax : auto (défaut, la pièce passée sous son minimum part tout de suite au panier standard) '
  'ou manuel (fenêtre de proposition à la validation d''une vente / caisse / picking, comme G8). '
  'La tâche de nuit basket-minimax-daily tourne dans les deux cas. Changé par minimax_mode_set.';

create or replace function public._minimax_is_auto(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.minimax_mode from public.companies c where c.id = _company), 'auto') = 'auto';
$$;
revoke all on function public._minimax_is_auto(uuid) from public, anon, authenticated;

create or replace function public.minimax_mode_set(_company uuid, _mode text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare _old text;
begin
  if _company is null or not public.is_admin(_company) then
    raise exception 'Réservé à un administrateur de la société.' using errcode = '42501';
  end if;
  if _mode is null or _mode not in ('auto', 'manuel') then
    raise exception 'Réglage inconnu : % (auto ou manuel).', _mode using errcode = 'P0001';
  end if;
  select minimax_mode into _old from public.companies where id = _company for update;
  if _old is not distinct from _mode then
    return _mode;
  end if;
  update public.companies set minimax_mode = _mode where id = _company;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'minimax_mode_set', 'companies', _company::text, 'screen',
          jsonb_build_object('minimax_mode', _old), jsonb_build_object('minimax_mode', _mode));
  return _mode;
end $$;
revoke all on function public.minimax_mode_set(uuid, text) from public, anon;
grant execute on function public.minimax_mode_set(uuid, text) to authenticated;

-- ------------------------------------------------ 2. Cœur : aligner la ligne minimax d'un article
-- Quantité minimax de l'article dans le panier standard ouvert (0 si pas de panier).
create or replace function public._minimax_line_qty(_basket uuid, _article uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select sum(l.qty) from public.supplier_basket_lines l
                    where _basket is not null and l.basket_id = _basket and l.article_id = _article
                      and l.origin = 'minimax'), 0);
$$;
revoke all on function public._minimax_line_qty(uuid, uuid) from public, anon, authenticated;

-- _lowering = true : le mouvement a baissé le stock du minimax -> ligne portée au besoin s'il est
-- plus haut (jamais baissée : une quantité augmentée à la main est gardée).
-- _lowering = false : le stock du minimax est remonté -> ligne ramenée au besoin s'il est plus bas
-- (retirée s'il est nul). Retour : 1 si le panier a changé.
create or replace function public._minimax_immediate(_company uuid, _article uuid, _lowering boolean,
                                                    _ref text default null, _source text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid; need numeric; cur numeric;
begin
  bid := public._basket_current(_company, 'standard', false);
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
      bid := public._basket_current(_company, 'standard', true);
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
end $$;
revoke all on function public._minimax_immediate(uuid, uuid, boolean, text, text) from public, anon, authenticated;

-- ------------------------------------------------ 3. Déclencheur sur stock_moves
-- Nommé « zz » : les déclencheurs AFTER d'une même table partent par ordre alphabétique ; celui-ci
-- passe après la re-réservation de l'atelier à l'entrée en stock (trg_stock_moves_workshop_reservations)
-- et voit donc l'état final.
create or replace function public._trg_stock_move_minimax()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; _lowering boolean;
begin
  if coalesce(new.qty_delta, 0) = 0 or new.article_id is null then
    return null;
  end if;
  if coalesce(current_setting('app.minimax_immediate', true), '') = 'off' then
    return null;
  end if;
  -- Réservations de l'atelier : déjà traitées par _workshop_minimax_after (même règle).
  if new.is_reservation and new.origin = 'atelier' then
    return null;
  end if;
  -- baisse du stock du minimax = sortie du réel OU réservation ; hausse = entrée OU libération.
  _lowering := (new.qty_delta < 0) <> coalesce(new.is_reservation, false);
  begin
    select x.company_id, x.mgmt_type::text as mgmt, coalesce(x.is_active, true) as active,
           coalesce(x.stock_min, 0) as smin, coalesce(x.supplier_availability, '') as avail
      into a from public.articles x where x.id = new.article_id;
    if not found then
      return null;
    end if;
    if _lowering then
      if a.mgmt <> 'A' or not a.active or a.smin <= 0 or a.avail in ('red', 'yellow') then
        return null;
      end if;
    elsif not exists (select 1 from public.supplier_basket_lines l
                        join public.supplier_baskets b on b.id = l.basket_id
                       where l.article_id = new.article_id and l.origin = 'minimax'
                         and b.company_id = a.company_id and b.kind = 'standard' and b.status = 'ouvert') then
      return null;
    end if;
    if not public._minimax_is_auto(a.company_id) then
      return null;
    end if;
    perform public._minimax_immediate(a.company_id, new.article_id, _lowering, new.ref,
                                      coalesce(new.origin, '') || ':' || new.move_type::text);
  exception when others then
    -- Jamais d'échec de la vente : on trace et on continue (la tâche de nuit rattrapera).
    begin
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (coalesce(a.company_id, new.company_id), auth.uid(), 'minimax_immediate_error', 'stock_moves',
              new.id::text, 'system', null,
              jsonb_build_object('article_id', new.article_id, 'qty_delta', new.qty_delta, 'ref', new.ref,
                                 'error', sqlerrm, 'sqlstate', sqlstate));
    exception when others then
      raise notice 'minimax immediat ignore (mouvement %) : %', new.id, sqlerrm;
    end;
  end;
  return null;
end $$;
revoke all on function public._trg_stock_move_minimax() from public, anon, authenticated;

drop trigger if exists trg_stock_moves_zz_minimax on public.stock_moves;
create trigger trg_stock_moves_zz_minimax after insert on public.stock_moves
  for each row execute function public._trg_stock_move_minimax();

-- ------------------------------------------------ 4. Atelier : même réglage (corps de production inchangé sinon)
create or replace function public._workshop_minimax_after(_company uuid, _article uuid, _ref text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid; need numeric;
begin
  -- Réglage « proposition manuelle » : rien n'entre au panier sans l'accord de l'utilisateur.
  if not public._minimax_is_auto(_company) then
    return 0;
  end if;
  bid := public._basket_current(_company, 'standard', false);
  need := public._basket_minimax_need(_company, bid, _article);
  if coalesce(need, 0) <= 0 then
    return 0;
  end if;
  if bid is null then
    bid := public._basket_current(_company, 'standard', true);
  end if;
  perform public._basket_add_lines(bid, jsonb_build_array(jsonb_build_object('article_id', _article, 'qty', need, 'origin', 'minimax')), true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'workshop_reservation_minimax', 'supplier_baskets', bid::text, 'system', null,
          jsonb_build_object('article_id', _article, 'qty', need, 'ref', _ref, 'minimax_stock', public._minimax_stock(_article)));
  return 1;
end $$;
revoke all on function public._workshop_minimax_after(uuid, uuid, text) from public, anon, authenticated;

-- ------------------------------------------------ 5. Mode manuel : proposition à la validation
-- Pièces (parmi _articles) passées sous leur minimum et pas encore couvertes par la ligne minimax du
-- panier standard ouvert. qty = ce qu'il reste à ajouter. Aucune écriture.
create or replace function public.minimax_proposal(_company uuid, _articles uuid[])
returns table (article_id uuid, reference text, designation text, stock_min numeric, stock_max numeric,
               minimax_stock numeric, on_order numeric, in_basket numeric, qty numeric)
language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid; r record; need numeric; cur numeric;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  bid := public._basket_current(_company, 'standard', false);
  for r in
    select a.id, a.reference, coalesce(a.designation, '') as designation, a.stock_min, a.stock_max
      from public.articles a
     where a.company_id = _company and a.id in (select distinct x from unnest(coalesce(_articles, '{}'::uuid[])) x)
     order by a.reference
  loop
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
end $$;
revoke all on function public.minimax_proposal(uuid, uuid[]) from public, anon;
grant execute on function public.minimax_proposal(uuid, uuid[]) to authenticated;

-- « Ajouter » : _lines = [{article_id, qty}] ; quantité ajoutée à la ligne minimax du panier standard
-- ouvert (créé si absent). Pièces rouges / jaunes refusées par la garde du panier (20261103280000).
create or replace function public.minimax_proposal_apply(_company uuid, _lines jsonb, _ref text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid; j jsonb; lines jsonb := '[]'::jsonb; res jsonb; aid uuid; q numeric;
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
  end loop;
  if jsonb_array_length(lines) = 0 then
    return jsonb_build_object('basket_id', null, 'added', 0, 'merged', 0, 'skipped', 0);
  end if;
  bid := public._basket_current(_company, 'standard', true);
  res := public._basket_add_lines(bid, lines, false);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'minimax_proposal_added', 'supplier_baskets', bid::text, 'screen', null,
          jsonb_build_object('ref', _ref, 'lines', lines));
  return res;
end $$;
revoke all on function public.minimax_proposal_apply(uuid, jsonb, text) from public, anon;
grant execute on function public.minimax_proposal_apply(uuid, jsonb, text) to authenticated;

-- « Ignorer » : rien au panier, la décision est tracée (la tâche de nuit reste le filet).
create or replace function public.minimax_proposal_ignore(_company uuid, _articles uuid[], _ref text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'minimax_proposal_ignored', 'companies', _company::text, 'screen', null,
          jsonb_build_object('ref', _ref, 'articles', to_jsonb(coalesce(_articles, '{}'::uuid[]))));
end $$;
revoke all on function public.minimax_proposal_ignore(uuid, uuid[], text) from public, anon;
grant execute on function public.minimax_proposal_ignore(uuid, uuid[], text) to authenticated;

-- ------------------------------------------------ 6. Remplacement : le minimax suit la nouvelle référence
-- Retour : 1 si une fiche a changé. Cible = bout de la chaîne des remplacements, même société.
create or replace function public._article_minimax_transfer(_source uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.articles%rowtype;
  t public.articles%rowtype;
  _tid uuid;
  _move boolean; _take boolean; _pack boolean;
begin
  select * into s from public.articles where id = _source;
  if not found or s.superseded_by_id is null then
    return 0;
  end if;
  _tid := public.article_final_replacement(s.id);
  if _tid is null or _tid = s.id then
    return 0;
  end if;
  select * into t from public.articles where id = _tid for update;
  if not found or t.company_id <> s.company_id then
    return 0;
  end if;
  _move := coalesce(s.stock_min, 0) > 0 or coalesce(s.stock_max, 0) > 0;
  _take := _move and coalesce(t.stock_min, 0) <= 0 and coalesce(t.stock_max, 0) <= 0;
  _pack := coalesce(s.pack_qty, 0) > 1 and coalesce(t.pack_qty, 0) <= 1;
  if not _move and not _pack then
    return 0;
  end if;
  if _take or _pack then
    update public.articles
       set stock_min = case when _take then s.stock_min else stock_min end,
           stock_max = case when _take then s.stock_max else stock_max end,
           pack_qty  = case when _pack then s.pack_qty else pack_qty end
     where id = t.id;
  end if;
  if _move then
    update public.articles set stock_min = 0, stock_max = 0 where id = s.id;
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (s.company_id, auth.uid(), 'article_minimax_transfer', 'article', s.id::text, 'system',
          jsonb_build_object('reference', s.reference, 'stock_min', s.stock_min, 'stock_max', s.stock_max, 'pack_qty', s.pack_qty),
          jsonb_build_object('target_id', t.id, 'target_reference', t.reference,
                             'stock_min', case when _move then 0 else s.stock_min end,
                             'stock_max', case when _move then 0 else s.stock_max end,
                             'minimax_moved', _take, 'target_kept_own_minimax', _move and not _take,
                             'pack_copied', _pack));
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (t.company_id, auth.uid(), 'article_minimax_received', 'article', t.id::text, 'system',
          jsonb_build_object('stock_min', t.stock_min, 'stock_max', t.stock_max, 'pack_qty', t.pack_qty),
          jsonb_build_object('source_id', s.id, 'source_reference', s.reference,
                             'stock_min', case when _take then s.stock_min else t.stock_min end,
                             'stock_max', case when _take then s.stock_max else t.stock_max end,
                             'pack_qty', case when _pack then s.pack_qty else t.pack_qty end));
  return 1;
end $$;
revoke all on function public._article_minimax_transfer(uuid) from public, anon, authenticated;

-- AFTER (et non BEFORE) : un import qui met à jour plusieurs fiches dans une même requête ne voit
-- pas « ligne déjà modifiée par la commande en cours ». Une erreur ne bloque jamais le remplacement.
create or replace function public._trg_articles_minimax_transfer()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.superseded_by_id is not distinct from old.superseded_by_id then
    return null;
  end if;
  begin
    perform public._article_minimax_transfer(new.id);
  exception when others then
    raise notice 'minimax du remplacement non transfere (%) : %', new.reference, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public._trg_articles_minimax_transfer() from public, anon, authenticated;

drop trigger if exists trg_articles_minimax_transfer on public.articles;
create trigger trg_articles_minimax_transfer after insert or update of superseded_by_id on public.articles
  for each row when (new.superseded_by_id is not null)
  execute function public._trg_articles_minimax_transfer();

-- ------------------------------------------------ 7. Rattrapage des remplacements déjà en base
-- Idempotent : une source traitée n'a plus de minimum / maximum et sa cible a un conditionnement > 1.
-- Le remplacement le plus récent passe en premier (il l'emporte pour le conditionnement).
do $$
declare r record; _n int := 0; _src_minmax int := 0; _src_pack int := 0;
begin
  for r in
    select s.id, (coalesce(s.stock_min, 0) > 0 or coalesce(s.stock_max, 0) > 0) as has_minmax,
           coalesce(s.pack_qty, 0) > 1 as has_pack
      from public.articles s
     where s.superseded_by_id is not null
       and (coalesce(s.stock_min, 0) > 0 or coalesce(s.stock_max, 0) > 0 or coalesce(s.pack_qty, 0) > 1)
     order by s.superseded_at desc nulls last, s.reference
  loop
    if public._article_minimax_transfer(r.id) = 1 then
      _n := _n + 1;
      if r.has_minmax then _src_minmax := _src_minmax + 1; end if;
      if r.has_pack then _src_pack := _src_pack + 1; end if;
    end if;
  end loop;
  raise notice 'Rattrapage remplacements minimax : % ancienne(s) reference(s) traitee(s) (% avec minimum/maximum, % avec conditionnement).',
    _n, _src_minmax, _src_pack;
end $$;
