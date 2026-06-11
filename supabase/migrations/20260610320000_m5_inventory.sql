-- =====================================================================
-- M5 — Inventaire : sessions (8 méthodes G8 recomposées en 3 toggles : magasin
-- ouvert/fermé × effacement × édition des écarts), arrêté daté (snapshot),
-- comptage/réajustement (3 modes B6), remise à zéro, réintégration.
-- TOUT en append-only : chaque opération = insertion de mouvement(s) stock_moves
-- (type 'inventaire'/'correction'), JAMAIS d'UPDATE du stock (règle 3 / B7).
-- =====================================================================

-- Session d'inventaire (machine à états légère).
create table if not exists public.inventory_sessions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  magasin_ouvert boolean not null default false,   -- ouvert = on génère un arrêté
  effacement     boolean not null default false,   -- remise à zéro + réajustement cumul
  edition_ecarts boolean not null default false,   -- édition des écarts réel vs arrêté
  mode           text not null default 'annule_remplace', -- annule_remplace | cumul
  status         text not null default 'en_cours', -- en_cours | cloture
  snapshot_id    uuid,
  label          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  closed_at      timestamptz
);
create index if not exists idx_invsessions_company on public.inventory_sessions(company_id, status);

-- Arrêté / copie de stock : photo datée, immuable côté quantités (B4).
create table if not exists public.stock_snapshots (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  kind         text not null default 'arrete',   -- arrete | copie
  label        text,
  reintegrated boolean not null default false,
  created_at   timestamptz not null default now()
);
create table if not exists public.stock_snapshot_lines (
  id          uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.stock_snapshots(id) on delete cascade,
  article_id  uuid not null references public.articles(id) on delete cascade,
  qty         numeric(14,3) not null default 0,
  pamp        numeric(14,3) not null default 0
);
create index if not exists idx_snaplines_snapshot on public.stock_snapshot_lines(snapshot_id);

drop trigger if exists trg_invsessions_audit on public.inventory_sessions;
create trigger trg_invsessions_audit after insert or update or delete on public.inventory_sessions for each row execute function public.audit_row();
drop trigger if exists trg_snapshots_audit on public.stock_snapshots;
create trigger trg_snapshots_audit after insert or update or delete on public.stock_snapshots for each row execute function public.audit_row();

alter table public.inventory_sessions   enable row level security;
alter table public.stock_snapshots       enable row level security;
alter table public.stock_snapshot_lines  enable row level security;
drop policy if exists invsessions_all on public.inventory_sessions;
create policy invsessions_all on public.inventory_sessions for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists snapshots_all on public.stock_snapshots;
create policy snapshots_all on public.stock_snapshots for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists snaplines_all on public.stock_snapshot_lines;
create policy snaplines_all on public.stock_snapshot_lines for all to authenticated
  using (exists (select 1 from public.stock_snapshots s where s.id = snapshot_id and public.is_member(s.company_id)))
  with check (exists (select 1 from public.stock_snapshots s where s.id = snapshot_id and public.is_member(s.company_id)));

-- ---------------------------------------------------------------------
-- Génère un arrêté daté à partir du stock réel courant (B4).
-- ---------------------------------------------------------------------
create or replace function public.generate_stock_snapshot(_company uuid, _label text, _kind text default 'arrete')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare _snap uuid;
begin
  if not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  insert into public.stock_snapshots (company_id, kind, label) values (_company, _kind, _label) returning id into _snap;
  insert into public.stock_snapshot_lines (snapshot_id, article_id, qty, pamp)
  select _snap, s.article_id, s.real_qty, s.pamp from public.article_stock_list(_company) s where s.real_qty <> 0;
  return _snap;
end $$;
grant execute on function public.generate_stock_snapshot(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Réajustement de comptage : insère le delta adéquat (append-only).
--   annule_remplace : delta = compté − réel actuel (on n'écrase jamais)
--   cumul           : delta = compté (la valeur saisie est déjà un ajout)
-- ---------------------------------------------------------------------
create or replace function public.record_inventory_count(_article uuid, _counted numeric, _mode text, _bin text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _real numeric; _delta numeric;
begin
  select company_id into _company from public.articles where id = _article;
  if _company is null or not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  if _mode = 'cumul' then
    _delta := _counted;
  else
    select real_qty into _real from public.article_stock(_article);
    _delta := _counted - coalesce(_real, 0);
  end if;
  if _delta = 0 then return null; end if;
  return public.record_stock_move(_article, 'inventaire', _delta, null, false, _bin, 'inventory', null, 'Réajustement inventaire');
end $$;
grant execute on function public.record_inventory_count(uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Remise à zéro du stock réel (delta = −réel), option conserver V/O/P (n° série).
-- ---------------------------------------------------------------------
create or replace function public.reset_real_stock(_company uuid, _keep_vehicles boolean default true)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare _r record; _n int := 0;
begin
  if not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  for _r in
    select s.article_id, s.real_qty, a.mgmt_type
    from public.article_stock_list(_company) s join public.articles a on a.id = s.article_id
    where s.real_qty <> 0 and (not _keep_vehicles or a.mgmt_type not in ('V','O','P','D'))
  loop
    perform public.record_stock_move(_r.article_id, 'inventaire', -_r.real_qty, null, false, null, 'inventory', null, 'Remise à zéro inventaire');
    _n := _n + 1;
  end loop;
  return _n;
end $$;
grant execute on function public.reset_real_stock(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Réintégration de l'arrêté : réel ← réel + arrêté (delta = qty de l'arrêté).
-- Opération UNIQUE (idempotence : refuse si déjà réintégré). B7.
-- ---------------------------------------------------------------------
create or replace function public.reintegrate_snapshot(_snapshot uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _done boolean; _r record; _n int := 0;
begin
  select company_id, reintegrated into _company, _done from public.stock_snapshots where id = _snapshot;
  if _company is null or not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  if _done then raise exception 'Arrêté déjà réintégré'; end if;
  for _r in select article_id, qty from public.stock_snapshot_lines where snapshot_id = _snapshot and qty <> 0 loop
    perform public.record_stock_move(_r.article_id, 'inventaire', _r.qty, null, false, null, 'inventory', _snapshot::text, 'Réintégration arrêté');
    _n := _n + 1;
  end loop;
  update public.stock_snapshots set reintegrated = true where id = _snapshot;
  return _n;
end $$;
grant execute on function public.reintegrate_snapshot(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Écarts d'inventaire : stock réel courant vs arrêté (quantité + valeur PAMP).
-- ---------------------------------------------------------------------
create or replace function public.inventory_gaps(_company uuid, _snapshot uuid)
returns table(article_id uuid, reference text, designation text, real_qty numeric, snapshot_qty numeric, gap_qty numeric, gap_value numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.article_id, s.reference, s.designation, s.real_qty,
    coalesce(l.qty, 0), s.real_qty - coalesce(l.qty, 0),
    round((s.real_qty - coalesce(l.qty, 0)) * s.pamp, 2)
  from public.article_stock_list(_company) s
  left join public.stock_snapshot_lines l on l.snapshot_id = _snapshot and l.article_id = s.article_id
  where public.is_member(_company) and (s.real_qty <> 0 or l.qty is not null) and s.real_qty <> coalesce(l.qty, 0)
  order by s.reference;
$$;
grant execute on function public.inventory_gaps(uuid, uuid) to authenticated;
