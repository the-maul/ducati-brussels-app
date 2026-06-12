-- =====================================================================
-- M5 — Inventaire : 3e mode de réajustement (CASIER à la volée, B6) + inventaire
-- TOURNANT (candidats à recompter) + file d'ÉTIQUETAGE différée cumulable (B12).
-- =====================================================================

-- Relâche la garde de record_stock_move : autorise les contextes serveur/cron
-- (service role, auth.uid() null) ; un appel authentifié reste contrôlé is_member.
create or replace function public.record_stock_move(
  _article uuid, _type public.stock_move_type, _qty numeric,
  _unit_cost numeric default null, _is_reservation boolean default false,
  _bin text default null, _origin text default 'screen', _ref text default null, _note text default null
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _old_real numeric; _old_pamp numeric; _move_id bigint;
begin
  select company_id, pamp into _company, _old_pamp from public.articles where id = _article;
  if _company is null then raise exception 'Article introuvable'; end if;
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;

  insert into public.stock_moves (company_id, article_id, move_type, qty_delta, is_reservation, unit_cost, bin_location, origin, ref, note, operator_id)
  values (_company, _article, _type, _qty, _is_reservation, _unit_cost, _bin, _origin, _ref, _note, auth.uid())
  returning id into _move_id;

  if not _is_reservation and _qty > 0 and _unit_cost is not null then
    select real_qty into _old_real from public.article_stock(_article);
    _old_real := _old_real - _qty;
    if _old_real <= 0 then
      update public.articles set pamp = round(_unit_cost, 3) where id = _article;
    else
      update public.articles
        set pamp = round((coalesce(_old_pamp,0) * _old_real + _unit_cost * _qty) / (_old_real + _qty), 3)
        where id = _article;
    end if;
  end if;
  return _move_id;
end $$;

-- Stock réel d'un article DANS un casier donné (somme des mouvements de ce casier).
create or replace function public.bin_stock(_article uuid, _bin text)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(case when not is_reservation then qty_delta else 0 end), 0)
  from public.stock_moves where article_id = _article and coalesce(bin_location,'') = coalesce(_bin,'');
$$;
grant execute on function public.bin_stock(uuid, text) to authenticated;

-- 3 modes de réajustement (B6) : annule_remplace · cumul · CASIER (par emplacement).
create or replace function public.record_inventory_count(_article uuid, _counted numeric, _mode text, _bin text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _real numeric; _delta numeric;
begin
  select company_id into _company from public.articles where id = _article;
  if _company is null then raise exception 'Article introuvable'; end if;
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;

  if _mode = 'cumul' then
    _delta := _counted;
  elsif _mode = 'casier' then
    -- réajuste le stock DU CASIER : delta pour atteindre _counted dans ce casier.
    _delta := _counted - public.bin_stock(_article, _bin);
  else -- annule_remplace
    select real_qty into _real from public.article_stock(_article);
    _delta := _counted - coalesce(_real, 0);
  end if;
  if _delta = 0 then return null; end if;
  return public.record_stock_move(_article, 'inventaire', _delta, null, false, _bin, 'inventory', null,
    'Réajustement inventaire (' || _mode || coalesce(' / ' || _bin, '') || ')');
end $$;
grant execute on function public.record_inventory_count(uuid, numeric, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Inventaire TOURNANT : articles à recompter (stock != 0), priorité au plus ancien
-- mouvement, filtrable par rayon. Permet un comptage partiel récurrent sans arrêt.
-- ---------------------------------------------------------------------
create or replace function public.cycle_count_candidates(_company uuid, _category text default null, _limit int default 50)
returns table(article_id uuid, reference text, designation text, bin_location text, real_qty numeric, last_move timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.reference, a.designation, a.bin_location,
    coalesce(sum(case when not m.is_reservation then m.qty_delta else 0 end), 0) as real_qty,
    max(m.occurred_at) as last_move
  from public.articles a
  left join public.stock_moves m on m.article_id = a.id
  where a.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and a.mgmt_type = 'A' and (_category is null or a.category_path ilike '%'||_category||'%')
  group by a.id, a.reference, a.designation, a.bin_location
  having coalesce(sum(case when not m.is_reservation then m.qty_delta else 0 end), 0) <> 0
  order by max(m.occurred_at) nulls first
  limit _limit;
$$;
grant execute on function public.cycle_count_candidates(uuid, text, int) to authenticated;

-- ---------------------------------------------------------------------
-- File d'ÉTIQUETAGE différée cumulable (B12) : on accumule des étiquettes à
-- imprimer plus tard, par poste/opérateur, avec/sans code-barres, avec/sans prix.
-- ---------------------------------------------------------------------
create table if not exists public.label_queue (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  article_id   uuid not null references public.articles(id) on delete cascade,
  qty          int not null default 1,
  with_barcode boolean not null default true,
  with_price   boolean not null default true,
  printed      boolean not null default false,
  operator_id  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_label_queue_company on public.label_queue(company_id, printed);

alter table public.label_queue enable row level security;
drop policy if exists label_queue_all on public.label_queue;
create policy label_queue_all on public.label_queue for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Ajoute une étiquette à la file (par défaut quantité = stock réel, B12).
create or replace function public.enqueue_label(_article uuid, _qty int default null, _barcode boolean default true, _price boolean default true)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _q int; _id bigint;
begin
  select company_id into _company from public.articles where id = _article;
  if _company is null then raise exception 'Article introuvable'; end if;
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  if _qty is null then
    select greatest(coalesce(real_qty,0),1)::int into _q from public.article_stock(_article);
  else
    _q := _qty;
  end if;
  insert into public.label_queue (company_id, article_id, qty, with_barcode, with_price, operator_id)
    values (_company, _article, _q, _barcode, _price, auth.uid()) returning id into _id;
  return _id;
end $$;
grant execute on function public.enqueue_label(uuid, int, boolean, boolean) to authenticated, service_role;
