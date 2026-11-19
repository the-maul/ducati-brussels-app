-- =====================================================================
-- M4 — Réassort minimax : la nuit en mode « proposition manuelle » (décision client Q52, 19/11/2026).
--
-- Comme G8 : quand la société est réglée en « proposition manuelle » (companies.minimax_mode =
-- 'manuel', migration 20261119130000), la tâche de nuit basket-minimax-daily ne met PLUS RIEN au
-- panier. Elle prépare seulement la liste des pièces passées sous leur minimum (même calcul
-- _basket_minimax_need, déduction faite de la ligne minimax déjà au panier) dans minimax_night_list.
-- L'utilisateur la retrouve le lendemain dans la fenêtre « Pièces passées sous leur minimum »
-- (Ajouter au panier / Ignorer), à l'ouverture de l'écran des paniers ou des achats.
--   - Ajouter (minimax_proposal_apply) : la pièce part au panier et sort de la liste ;
--   - Ignorer (minimax_proposal_ignore) : la pièce n'est plus reproposée tant que son stock ne bouge
--     pas (dernier mouvement de stock_moves noté à la décision ; un nouveau mouvement la libère).
-- En mode automatique : rien ne change (corps de production de _cron_basket_minimax).
--
-- Additif, idempotent. S'applique après 20261119130000 (en production). Fonctions redéfinies
-- (même signature) : _cron_basket_minimax, minimax_proposal_apply, minimax_proposal_ignore.
-- Essai à blanc : supabase/tests/m4_minimax_nuit_manuel.sql.
-- =====================================================================

-- ------------------------------------------------ 1. La liste de la nuit
create table if not exists public.minimax_night_list (
  company_id    uuid not null references public.companies(id) on delete cascade,
  article_id    uuid not null references public.articles(id) on delete cascade,
  status        text not null default 'proposee' check (status in ('proposee', 'ignoree')),
  qty           numeric(14,3) not null default 0,
  minimax_stock numeric(14,3),
  stock_min     numeric(14,3),
  stock_max     numeric(14,3),
  on_order      numeric(14,3),
  last_move_id  bigint,
  prepared_at   timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references auth.users(id) on delete set null,
  primary key (company_id, article_id)
);
comment on table public.minimax_night_list is
  'Réassort minimax en proposition manuelle (Q52, 19/11/2026) : pièces sous leur minimum préparées par la '
  'tâche de nuit (proposee) ou écartées par l''utilisateur (ignoree, last_move_id = dernier mouvement de stock '
  'à la décision). Écrite uniquement par les fonctions _minimax_prepare_night_list / minimax_proposal_*.';
comment on column public.minimax_night_list.last_move_id is
  'Ignorée : id du dernier stock_moves de l''article au moment de « Ignorer ». Un mouvement plus récent la repropose.';
create index if not exists idx_minimax_night_list_status on public.minimax_night_list (company_id, status);

-- Pas d'audit_row ligne à ligne (la nuit réécrit la liste) : la préparation est tracée par un
-- événement de synthèse « minimax_night_list », chaque décision par minimax_proposal_added / _ignored.

alter table public.minimax_night_list enable row level security;
revoke all on public.minimax_night_list from anon;
revoke insert, update, delete on public.minimax_night_list from authenticated;
grant select on public.minimax_night_list to authenticated;
drop policy if exists minimax_night_list_select on public.minimax_night_list;
create policy minimax_night_list_select on public.minimax_night_list for select to authenticated
  using (public.is_member(company_id));

-- Dernier mouvement de stock d'un article (0 s'il n'en a aucun) : « le stock a-t-il bougé ? ».
create or replace function public._minimax_last_move(_article uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select max(m.id) from public.stock_moves m where m.article_id = _article), 0);
$$;
revoke all on function public._minimax_last_move(uuid) from public, anon, authenticated;

-- ------------------------------------------------ 2. Préparation de nuit (mode manuel) : aucune écriture au panier
create or replace function public._minimax_prepare_night_list(_company uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid; r record; need numeric; cur numeric; keep uuid[] := '{}'; n int;
begin
  bid := public._basket_current(_company, 'standard', false);
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
end $$;
revoke all on function public._minimax_prepare_night_list(uuid) from public, anon, authenticated;

-- Tâche de nuit redéfinie : automatique = corps de production inchangé ; manuel = liste seulement.
create or replace function public._cron_basket_minimax()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare _co record; bid uuid; res jsonb; _n int := 0; _cnt int;
begin
  for _co in select id from public.companies loop
    begin
      if public._minimax_is_auto(_co.id) then
        bid := public._basket_current(_co.id, 'standard', true);
        res := public._basket_fill_minimax(bid);
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
end $$;
revoke all on function public._cron_basket_minimax() from public, anon, authenticated;

-- ------------------------------------------------ 3. Lecture par l'écran
create or replace function public.minimax_night_list_count(_company uuid)
returns integer language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return (select count(*)::int from public.minimax_night_list l where l.company_id = _company and l.status = 'proposee');
end $$;
revoke all on function public.minimax_night_list_count(uuid) from public, anon;
grant execute on function public.minimax_night_list_count(uuid) to authenticated;

-- La liste préparée, recalculée à l'ouverture (mêmes colonnes que minimax_proposal) ; les pièces
-- dont le besoin a disparu depuis la nuit en sortent.
create or replace function public.minimax_night_list_rows(_company uuid)
returns table (article_id uuid, reference text, designation text, stock_min numeric, stock_max numeric,
               minimax_stock numeric, on_order numeric, in_basket numeric, qty numeric)
language plpgsql security definer set search_path = public, pg_temp as $$
declare ids uuid[]; live uuid[] := '{}'; rec record;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select coalesce(array_agg(l.article_id), '{}') into ids
    from public.minimax_night_list l where l.company_id = _company and l.status = 'proposee';
  if cardinality(ids) = 0 then return; end if;
  for rec in select * from public.minimax_proposal(_company, ids) loop
    article_id := rec.article_id; reference := rec.reference; designation := rec.designation;
    stock_min := rec.stock_min; stock_max := rec.stock_max; minimax_stock := rec.minimax_stock;
    on_order := rec.on_order; in_basket := rec.in_basket; qty := rec.qty;
    live := live || rec.article_id;
    return next;
  end loop;
  delete from public.minimax_night_list l
   where l.company_id = _company and l.status = 'proposee' and not (l.article_id = any (live));
end $$;
revoke all on function public.minimax_night_list_rows(uuid) from public, anon;
grant execute on function public.minimax_night_list_rows(uuid) to authenticated;

-- ------------------------------------------------ 4. Ajouter / Ignorer tiennent la liste à jour
create or replace function public.minimax_proposal_apply(_company uuid, _lines jsonb, _ref text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid; j jsonb; lines jsonb := '[]'::jsonb; res jsonb; aid uuid; q numeric; ids uuid[] := '{}';
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
  bid := public._basket_current(_company, 'standard', true);
  res := public._basket_add_lines(bid, lines, false);
  -- Au panier : la pièce sort de la liste de la nuit.
  delete from public.minimax_night_list l where l.company_id = _company and l.article_id = any (ids);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'minimax_proposal_added', 'supplier_baskets', bid::text, 'screen', null,
          jsonb_build_object('ref', _ref, 'lines', lines));
  return res;
end $$;
revoke all on function public.minimax_proposal_apply(uuid, jsonb, text) from public, anon;
grant execute on function public.minimax_proposal_apply(uuid, jsonb, text) to authenticated;

-- Ignorer : tracé, et la pièce n'est plus reproposée (fenêtre ou nuit) tant que son stock ne bouge pas.
create or replace function public.minimax_proposal_ignore(_company uuid, _articles uuid[], _ref text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  insert into public.minimax_night_list (company_id, article_id, status, qty, last_move_id, prepared_at, decided_at, decided_by)
  select _company, a.id, 'ignoree', 0, public._minimax_last_move(a.id), now(), now(), auth.uid()
    from public.articles a
   where a.company_id = _company and a.id = any (coalesce(_articles, '{}'::uuid[]))
  on conflict (company_id, article_id) do update
     set status = 'ignoree', last_move_id = excluded.last_move_id, decided_at = excluded.decided_at,
         decided_by = excluded.decided_by;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'minimax_proposal_ignored', 'companies', _company::text, 'screen', null,
          jsonb_build_object('ref', _ref, 'articles', to_jsonb(coalesce(_articles, '{}'::uuid[]))));
end $$;
revoke all on function public.minimax_proposal_ignore(uuid, uuid[], text) from public, anon;
grant execute on function public.minimax_proposal_ignore(uuid, uuid[], text) to authenticated;
