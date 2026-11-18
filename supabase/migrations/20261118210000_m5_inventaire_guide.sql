-- =====================================================================
-- M5 — Rattrapage G8 (18/11/2026) : INVENTAIRE GUIDÉ, ARRÊTÉ RÉAJUSTABLE,
-- COPIES DE STOCK, RÉAJUSTEMENT ET REMISE À ZÉRO DU STOCK RÉEL.
-- Invariants : B4 (triple stock + copies datées), B6 (3 modes de réajustement),
-- B7 (traçabilité append-only). Idempotente. NON APPLIQUÉE (Simon la passe en bloc).
--
-- 1. Les 8 méthodes G8 (magasin ouvert / fermé × effacement × édition des écarts)
--    deviennent une CHECK-LIST d'étapes datées (journal append-only
--    `inventory_step_log`) avec retour arrière sur la dernière étape validée.
-- 2. L'arrêté reste une photo immuable (`stock_snapshot_lines`) ; ses réajustements
--    (annule et remplace, cumul multi-emplacements, par casier) sont des LIGNES
--    AJOUTÉES dans `stock_snapshot_adjustments` (ancien / nouveau, opérateur, heure).
-- 3. La réintégration (une seule fois) calcule pour chaque article :
--      stock réel cible = arrêté réajusté + mouvements faits APRÈS l'arrêté
--      (ventes, réceptions… pendant le comptage, hors mouvements de l'inventaire)
--    et insère le seul mouvement `inventaire` qui y mène. Juste avec ou sans
--    remise à zéro du stock réel.
-- 4. Les copies de stock (15, fin de mois, à la demande, sauvegardes d'inventaire)
--    se calculent SANS dépendre de l'utilisateur connecté : les copies automatiques
--    de pg_cron n'étaient plus vides que de nom (article_stock_list exige is_member,
--    auth.uid() est nul sous pg_cron → 0 ligne).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Colonnes ajoutées
-- ---------------------------------------------------------------------
alter table public.inventory_sessions add column if not exists method_code   text;
alter table public.inventory_sessions add column if not exists keep_vehicles boolean not null default true;
comment on column public.inventory_sessions.method_code is
  'Méthode G8 : ouvert | ouvert_effacement | ouvert_ecarts | ouvert_effacement_ecarts | ferme | ferme_effacement | ferme_ecarts | ferme_effacement_ecarts';

alter table public.stock_snapshots add column if not exists status          text not null default 'actif';
alter table public.stock_snapshots add column if not exists origin          text not null default 'manuel';
alter table public.stock_snapshots add column if not exists session_id      uuid references public.inventory_sessions(id) on delete set null;
alter table public.stock_snapshots add column if not exists created_by      uuid references auth.users(id) on delete set null;
alter table public.stock_snapshots add column if not exists reintegrated_at timestamptz;
comment on column public.stock_snapshots.status is 'actif | annule (retour arrière de la génération : la photo reste consultable)';
comment on column public.stock_snapshots.origin is 'manuel | auto (pg_cron 15 et fin de mois) | inventaire (étape d''une méthode)';
create index if not exists idx_snapshots_company_created on public.stock_snapshots (company_id, created_at desc);
create index if not exists idx_snaplines_snapshot_article on public.stock_snapshot_lines (snapshot_id, article_id);

-- La photo est immuable : personne n'écrit directement dans les arrêtés et copies.
-- (Les fonctions SECURITY DEFINER ci-dessous restent les seules portes d'écriture.)
revoke insert, update, delete on public.stock_snapshot_lines from authenticated, anon;
revoke insert, update, delete on public.stock_snapshots from authenticated, anon;

-- ---------------------------------------------------------------------
-- 1. Journal des étapes d'inventaire (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.inventory_step_log (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete restrict,
  session_id  uuid not null references public.inventory_sessions(id) on delete restrict,
  step_code   text not null,
  action      text not null check (action in ('valide', 'retour')),
  detail      jsonb not null default '{}'::jsonb,
  operator_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_invsteplog_session on public.inventory_step_log (session_id, id);
alter table public.inventory_step_log enable row level security;
drop policy if exists invsteplog_select on public.inventory_step_log;
create policy invsteplog_select on public.inventory_step_log for select to authenticated using (public.is_member(company_id));
revoke insert, update, delete on public.inventory_step_log from authenticated, anon;

-- ---------------------------------------------------------------------
-- 2. Réajustements de l'arrêté (append-only, B6 / B7)
-- ---------------------------------------------------------------------
create table if not exists public.stock_snapshot_adjustments (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete restrict,
  snapshot_id uuid not null references public.stock_snapshots(id) on delete restrict,
  article_id  uuid not null references public.articles(id) on delete restrict,
  -- annule_remplace | cumul | casier = comptages ; raz = remise à zéro de l'arrêté
  -- (effacement) ; retour = compensation d'une remise à zéro annulée.
  mode        text not null check (mode in ('annule_remplace', 'cumul', 'casier', 'raz', 'retour')),
  counted     numeric(14,3),
  bin         text,
  old_qty     numeric(14,3) not null,
  new_qty     numeric(14,3) not null,
  delta       numeric(14,3) not null,
  origin      text not null default 'screen',
  note        text,
  operator_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_snapadj_snapshot_article on public.stock_snapshot_adjustments (snapshot_id, article_id, id);
alter table public.stock_snapshot_adjustments enable row level security;
drop policy if exists snapadj_select on public.stock_snapshot_adjustments;
create policy snapadj_select on public.stock_snapshot_adjustments for select to authenticated using (public.is_member(company_id));
revoke insert, update, delete on public.stock_snapshot_adjustments from authenticated, anon;

-- ---------------------------------------------------------------------
-- 3. Briques internes (aucun contrôle d'utilisateur : réservées aux fonctions)
-- ---------------------------------------------------------------------
-- Type de gestion « stocké » (B1) : pièces A, véhicules V/O/P, dépôt-vente D.
create or replace function public._is_stocked_type(_t text)
returns boolean language sql immutable as $$ select coalesce(_t, '') in ('A', 'V', 'O', 'P', 'D') $$;

-- Stock réel par article (somme des mouvements hors réservation), à une date ou maintenant.
create or replace function public._stock_levels(_company uuid, _at timestamptz default null)
returns table(article_id uuid, real_qty numeric, pamp numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.article_id, sum(m.qty_delta), max(a.pamp)
    from public.stock_moves m
    join public.articles a on a.id = m.article_id
   where m.company_id = _company and not m.is_reservation
     and (_at is null or m.occurred_at <= _at)
   group by m.article_id
  having sum(m.qty_delta) <> 0;
$$;
revoke all on function public._stock_levels(uuid, timestamptz) from public, anon, authenticated;

-- Photo datée (arrêté ou copie) : lignes = articles à stock réel ≠ 0, PAMP du moment.
create or replace function public._stock_photo(_company uuid, _kind text, _label text, _origin text, _session uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare _snap uuid;
begin
  insert into public.stock_snapshots (company_id, kind, label, origin, session_id, created_by)
  values (_company, _kind, _label, _origin, _session, auth.uid())
  returning id into _snap;
  insert into public.stock_snapshot_lines (snapshot_id, article_id, qty, pamp)
  select _snap, s.article_id, s.real_qty, coalesce(s.pamp, 0) from public._stock_levels(_company) s;
  return _snap;
end $$;
revoke all on function public._stock_photo(uuid, text, text, text, uuid) from public, anon, authenticated;

-- Arrêté réajusté : quantité de la photo + somme des réajustements (par article).
create or replace function public._snapshot_effective(_snapshot uuid)
returns table(article_id uuid, initial_qty numeric, adjusted_qty numeric, counted boolean, pamp numeric, last_count_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with l as (
    select sl.article_id, sum(sl.qty) as qty, max(sl.pamp) as pamp
      from public.stock_snapshot_lines sl where sl.snapshot_id = _snapshot group by sl.article_id
  ), j as (
    select ad.article_id, sum(ad.delta) as d,
           bool_or(ad.mode in ('annule_remplace', 'cumul', 'casier')) as counted,
           max(ad.occurred_at) filter (where ad.mode in ('annule_remplace', 'cumul', 'casier')) as at
      from public.stock_snapshot_adjustments ad where ad.snapshot_id = _snapshot group by ad.article_id
  )
  select coalesce(l.article_id, j.article_id), coalesce(l.qty, 0), coalesce(l.qty, 0) + coalesce(j.d, 0),
         coalesce(j.counted, false), l.pamp, j.at
    from l full join j on j.article_id = l.article_id;
$$;
revoke all on function public._snapshot_effective(uuid) from public, anon, authenticated;

-- Nouvelle quantité de l'arrêté après un comptage (B6) — miroir TS :
-- src/modules/stock/inventory-rules.ts `nextArreteQty` (tests/inventaire-guide.test.ts).
--   annule_remplace : la saisie remplace la quantité ;
--   cumul           : la saisie s'ajoute aux comptages « cumul » déjà faits depuis le
--                     dernier comptage d'un autre mode (multi-emplacements, part de 0) ;
--   casier          : la quantité de l'article = somme du dernier comptage de chaque
--                     casier compté depuis le dernier comptage d'un autre mode.
create or replace function public._arrete_next_qty(_snapshot uuid, _article uuid, _mode text, _counted numeric, _bin text)
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _last_other bigint; _sum numeric;
begin
  if _mode = 'annule_remplace' then return _counted; end if;
  select max(id) into _last_other from public.stock_snapshot_adjustments
   where snapshot_id = _snapshot and article_id = _article
     and mode in ('annule_remplace', 'cumul', 'casier', 'raz') and mode <> _mode;
  if _mode = 'cumul' then
    select coalesce(sum(counted), 0) into _sum from public.stock_snapshot_adjustments
     where snapshot_id = _snapshot and article_id = _article and mode = 'cumul' and id > coalesce(_last_other, 0);
    return _sum + _counted;
  end if;
  -- casier
  select coalesce(sum(x.counted), 0) into _sum from (
    select distinct on (coalesce(bin, '')) coalesce(bin, '') as b, counted
      from public.stock_snapshot_adjustments
     where snapshot_id = _snapshot and article_id = _article and mode = 'casier' and id > coalesce(_last_other, 0)
     order by coalesce(bin, ''), id desc
  ) x where x.b <> coalesce(_bin, '');
  return _sum + _counted;
end $$;
revoke all on function public._arrete_next_qty(uuid, uuid, text, numeric, text) from public, anon, authenticated;

-- Étapes d'une méthode (ordre G8) — miroir TS : `methodSteps` (inventory-rules.ts).
create or replace function public._inventory_method_steps(_open boolean, _erase boolean, _gaps boolean)
returns text[] language sql immutable as $$
  select case when _open then
    array['debut', 'sauvegarde', 'generation_arrete', 'raz_stock_reel', 'edition_arrete_initial']
    || case when _erase then array['raz_arrete'] else array[]::text[] end
    || array['comptage', 'reajustement_arrete']
    || case when _gaps then array['edition_ecarts'] else array[]::text[] end
    || array['edition_arrete_final', 'sauvegarde_finale', 'reintegration', 'copie_stock', 'fin']
  else
    array['debut', 'sauvegarde', 'generation_arrete', 'edition_arrete_initial']
    || case when _erase then array['raz_stock_reel'] else array[]::text[] end
    || array['comptage', 'reajustement_reel']
    || case when _gaps then array['edition_ecarts'] else array[]::text[] end
    || array['sauvegarde_finale', 'copie_stock', 'fin']
  end;
$$;

create or replace function public._inventory_method_code(_open boolean, _erase boolean, _gaps boolean)
returns text language sql immutable as $$
  select case when _open then 'ouvert' else 'ferme' end
      || case when _erase then '_effacement' else '' end
      || case when _gaps then '_ecarts' else '' end;
$$;

-- Étapes validées (dernière action par étape = 'valide').
create or replace function public._inventory_validated(_session uuid)
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(step_code), array[]::text[]) from (
    select distinct on (step_code) step_code, action
      from public.inventory_step_log where session_id = _session
     order by step_code, id desc
  ) x where x.action = 'valide';
$$;
revoke all on function public._inventory_validated(uuid) from public, anon, authenticated;

-- Remise à zéro du stock réel (tous ou négatifs seuls), mouvements tracés.
create or replace function public._stock_reset(_company uuid, _scope text, _keep_vehicles boolean, _ref text, _note text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare _r record; _n int := 0;
begin
  for _r in
    select s.article_id, s.real_qty
      from public._stock_levels(_company) s join public.articles a on a.id = s.article_id
     where (_scope <> 'negatifs' or s.real_qty < 0)
       and (not _keep_vehicles or a.mgmt_type::text not in ('V', 'O', 'P', 'D'))
  loop
    perform public.record_stock_move(_r.article_id, 'inventaire', -_r.real_qty, null, false, null, 'inventory', _ref, _note);
    _n := _n + 1;
  end loop;
  return _n;
end $$;
revoke all on function public._stock_reset(uuid, text, boolean, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Copies de stock : génération (à la demande, cron) sans dépendre de auth.uid()
-- ---------------------------------------------------------------------
create or replace function public.generate_stock_snapshot(_company uuid, _label text, _kind text default 'arrete')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  if _kind not in ('arrete', 'copie') then raise exception 'Type de photo inconnu : %', _kind; end if;
  return public._stock_photo(_company, _kind, coalesce(nullif(btrim(_label), ''),
    case when _kind = 'copie' then 'Copie de stock du ' else 'Arrêté du ' end || to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY HH24:MI')),
    'manuel', null);
end $$;
grant execute on function public.generate_stock_snapshot(uuid, text, text) to authenticated;

create or replace function public._cron_stock_copies()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare _co record; _label text; _n int := 0; _day date := (now() at time zone 'Europe/Brussels')::date;
begin
  _label := 'Copie auto ' || to_char(_day, 'YYYY-MM-DD');
  for _co in select id from public.companies loop
    -- Idempotent : une seule copie automatique par société et par jour.
    if exists (select 1 from public.stock_snapshots s where s.company_id = _co.id and s.kind = 'copie'
                and s.origin = 'auto' and (s.created_at at time zone 'Europe/Brussels')::date = _day) then
      continue;
    end if;
    perform public._stock_photo(_co.id, 'copie', _label, 'auto', null);
    _n := _n + 1;
  end loop;
  return _n;
end $$;
revoke all on function public._cron_stock_copies() from public, anon, authenticated;

-- Le 15 ou le dernier jour du mois, heure de Bruxelles — miroir TS `isAutoCopyDay`.
create or replace function public._cron_maybe_stock_copy()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _d date := (now() at time zone 'Europe/Brussels')::date;
begin
  if extract(day from _d)::int = 15 or (_d + 1) = date_trunc('month', _d + 1)::date then
    perform public._cron_stock_copies();
  end if;
end $$;
revoke all on function public._cron_maybe_stock_copy() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Inventaire guidé : démarrer, valider une étape, revenir en arrière
-- ---------------------------------------------------------------------
create or replace function public.inventory_start(_company uuid, _open boolean, _erase boolean, _gaps boolean,
                                                  _keep_vehicles boolean default true, _label text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare _id uuid;
begin
  if not public.can_write_table(_company, 'inventory_sessions') then raise exception 'Accès refusé'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory:' || _company::text));
  if exists (select 1 from public.inventory_sessions where company_id = _company and status = 'en_cours') then
    raise exception 'Un inventaire est déjà en cours pour cette société';
  end if;
  insert into public.inventory_sessions (company_id, magasin_ouvert, effacement, edition_ecarts, mode, label,
                                         created_by, method_code, keep_vehicles)
  values (_company, _open, _erase, _gaps, case when _erase then 'cumul' else 'annule_remplace' end,
          nullif(btrim(coalesce(_label, '')), ''), auth.uid(), public._inventory_method_code(_open, _erase, _gaps),
          coalesce(_keep_vehicles, true))
  returning id into _id;
  return _id;
end $$;
grant execute on function public.inventory_start(uuid, boolean, boolean, boolean, boolean, text) to authenticated;

-- Liste des étapes avec leur état (date, heure, opérateur).
create or replace function public.inventory_session_steps(_session uuid)
returns table(step_no int, step_code text, validated boolean, validated_at timestamptz,
              operator_name text, detail jsonb, is_next boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _s public.inventory_sessions; _steps text[]; _done text[]; _next text;
begin
  select * into _s from public.inventory_sessions where id = _session;
  if _s.id is null or not public.is_member(_s.company_id) then raise exception 'Accès refusé'; end if;
  _steps := public._inventory_method_steps(_s.magasin_ouvert, _s.effacement, _s.edition_ecarts);
  _done := public._inventory_validated(_session);
  select st into _next from unnest(_steps) with ordinality u(st, i) where not (st = any(_done)) order by i limit 1;
  return query
  select u.i::int, u.st,
         u.st = any(_done),
         case when u.st = any(_done) then lg.occurred_at end,
         case when u.st = any(_done) then coalesce(p.full_name, p.email) end,
         case when u.st = any(_done) then lg.detail else '{}'::jsonb end,
         u.st = _next
    from unnest(_steps) with ordinality u(st, i)
    left join lateral (
      select l.occurred_at, l.operator_id, l.detail from public.inventory_step_log l
       where l.session_id = _session and l.step_code = u.st order by l.id desc limit 1
    ) lg on true
    left join public.profiles p on p.id = lg.operator_id
   order by u.i;
end $$;
grant execute on function public.inventory_session_steps(uuid) to authenticated;

-- Réintégration de l'arrêté réajusté dans le stock réel (une seule fois, B4/B6).
--   _ref : référence portée par les mouvements de l'inventaire (id de session, ou id de
--   l'arrêté hors méthode) — ces mouvements-là ne comptent pas comme « faits pendant le comptage ».
create or replace function public._snapshot_reintegrate(_snapshot uuid, _ref text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare _snap public.stock_snapshots; _r record; _n int := 0;
begin
  select * into _snap from public.stock_snapshots where id = _snapshot for update;
  if _snap.id is null then raise exception 'Aucun arrêté pour cet inventaire'; end if;
  if _snap.kind <> 'arrete' then raise exception 'Seul un arrêté se réintègre'; end if;
  if _snap.reintegrated then raise exception 'Arrêté déjà réintégré'; end if;
  if _snap.status <> 'actif' then raise exception 'Arrêté annulé'; end if;
  for _r in
    with eff as (select * from public._snapshot_effective(_snap.id)),
    since as (
      select m.article_id, sum(m.qty_delta) as q
        from public.stock_moves m
       where m.company_id = _snap.company_id and not m.is_reservation and m.occurred_at > _snap.created_at
         and m.article_id in (select e.article_id from eff e)
         and not (m.origin = 'inventory' and m.ref = _ref)
       group by m.article_id
    ), cur as (
      select m.article_id, sum(m.qty_delta) as q
        from public.stock_moves m
       where not m.is_reservation and m.article_id in (select e.article_id from eff e)
       group by m.article_id
    )
    select eff.article_id, eff.adjusted_qty + coalesce(since.q, 0) - coalesce(cur.q, 0) as delta
      from eff left join since on since.article_id = eff.article_id left join cur on cur.article_id = eff.article_id
  loop
    if _r.delta <> 0 then
      perform public.record_stock_move(_r.article_id, 'inventaire', _r.delta, null, false, null, 'inventory',
                                       _ref, 'Réintégration de l''arrêté');
      _n := _n + 1;
    end if;
  end loop;
  update public.stock_snapshots set reintegrated = true, reintegrated_at = now() where id = _snap.id;
  return _n;
end $$;
revoke all on function public._snapshot_reintegrate(uuid, text) from public, anon, authenticated;

-- Réintégration d'un arrêté généré HORS méthode d'inventaire (Gestion d'arrêté G8).
create or replace function public.snapshot_reintegrate(_snapshot uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _session uuid;
begin
  select company_id, session_id into _company, _session from public.stock_snapshots where id = _snapshot;
  if _company is null or not public.can_write_table(_company, 'inventory_sessions') then raise exception 'Accès refusé'; end if;
  if _session is not null then raise exception 'Arrêté d''inventaire : réintégrez-le depuis la check-list de l''inventaire'; end if;
  return public._snapshot_reintegrate(_snapshot, _snapshot::text);
end $$;
grant execute on function public.snapshot_reintegrate(uuid) to authenticated;

create or replace function public.inventory_step_validate(_session uuid, _step text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _s public.inventory_sessions; _steps text[]; _done text[]; _next text; _detail jsonb := '{}'::jsonb;
        _snap uuid; _n int; _r record; _label text;
begin
  select * into _s from public.inventory_sessions where id = _session for update;
  if _s.id is null or not public.can_write_table(_s.company_id, 'inventory_sessions') then raise exception 'Accès refusé'; end if;
  if _s.status <> 'en_cours' then raise exception 'Inventaire clôturé'; end if;
  _steps := public._inventory_method_steps(_s.magasin_ouvert, _s.effacement, _s.edition_ecarts);
  _done := public._inventory_validated(_session);
  select st into _next from unnest(_steps) with ordinality u(st, i) where not (st = any(_done)) order by i limit 1;
  if _next is null or _next <> _step then
    raise exception 'Étape attendue : %', coalesce(_next, 'aucune');
  end if;
  _label := to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY HH24:MI');

  if _step in ('sauvegarde', 'sauvegarde_finale', 'copie_stock') then
    _snap := public._stock_photo(_s.company_id, 'copie',
      case _step when 'sauvegarde' then 'Sauvegarde début d''inventaire '
                 when 'sauvegarde_finale' then 'Sauvegarde fin d''inventaire '
                 else 'Copie de stock fin d''inventaire ' end || _label, 'inventaire', _s.id);
    _detail := jsonb_build_object('snapshot_id', _snap);
  elsif _step = 'generation_arrete' then
    _snap := public._stock_photo(_s.company_id, 'arrete', coalesce(_s.label, 'Arrêté d''inventaire ' || _label), 'inventaire', _s.id);
    update public.inventory_sessions set snapshot_id = _snap where id = _s.id;
    _detail := jsonb_build_object('snapshot_id', _snap);
  elsif _step = 'raz_stock_reel' then
    _n := public._stock_reset(_s.company_id, 'tous', _s.keep_vehicles, _s.id::text, 'Remise à zéro du stock réel (inventaire)');
    _detail := jsonb_build_object('moves', _n);
  elsif _step = 'raz_arrete' then
    if _s.snapshot_id is null then raise exception 'Aucun arrêté pour cet inventaire'; end if;
    _n := 0;
    for _r in select e.article_id, e.adjusted_qty from public._snapshot_effective(_s.snapshot_id) e where e.adjusted_qty <> 0 loop
      insert into public.stock_snapshot_adjustments (company_id, snapshot_id, article_id, mode, counted, old_qty, new_qty, delta, origin, note, operator_id)
      values (_s.company_id, _s.snapshot_id, _r.article_id, 'raz', null, _r.adjusted_qty, 0, -_r.adjusted_qty, 'inventory', _s.id::text, auth.uid());
      _n := _n + 1;
    end loop;
    _detail := jsonb_build_object('lines', _n);
  elsif _step = 'reintegration' then
    if _s.snapshot_id is null then raise exception 'Aucun arrêté pour cet inventaire'; end if;
    _n := public._snapshot_reintegrate(_s.snapshot_id, _s.id::text);
    _detail := jsonb_build_object('moves', _n);
  elsif _step = 'fin' then
    update public.inventory_sessions set status = 'cloture', closed_at = now() where id = _s.id;
  end if;

  insert into public.inventory_step_log (company_id, session_id, step_code, action, detail, operator_id)
  values (_s.company_id, _s.id, _step, 'valide', _detail, auth.uid());
  return _detail;
end $$;
grant execute on function public.inventory_step_validate(uuid, text) to authenticated;

-- Retour arrière : annule la DERNIÈRE étape validée (pile). Les photos restent
-- consultables ; une remise à zéro est compensée par des mouvements inverses ;
-- la réintégration est définitive (réintégration unique).
create or replace function public.inventory_step_rollback(_session uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare _s public.inventory_sessions; _steps text[]; _done text[]; _last text; _r record; _n int := 0;
begin
  select * into _s from public.inventory_sessions where id = _session for update;
  if _s.id is null or not public.can_write_table(_s.company_id, 'inventory_sessions') then raise exception 'Accès refusé'; end if;
  _steps := public._inventory_method_steps(_s.magasin_ouvert, _s.effacement, _s.edition_ecarts);
  _done := public._inventory_validated(_session);
  select st into _last from unnest(_steps) with ordinality u(st, i) where st = any(_done) order by i desc limit 1;
  if _last is null then raise exception 'Aucune étape à annuler'; end if;
  if _last = 'reintegration' then raise exception 'La réintégration de l''arrêté est définitive'; end if;
  if _s.status <> 'en_cours' and _last <> 'fin' then raise exception 'Inventaire clôturé'; end if;

  if _last = 'fin' then
    update public.inventory_sessions set status = 'en_cours', closed_at = null where id = _s.id;
  elsif _last = 'generation_arrete' then
    update public.stock_snapshots set status = 'annule' where id = _s.snapshot_id;
    update public.inventory_sessions set snapshot_id = null where id = _s.id;
  elsif _last = 'raz_stock_reel' then
    -- Compensation exacte des mouvements de remise à zéro de CET inventaire.
    for _r in
      select m.article_id, sum(m.qty_delta) as q from public.stock_moves m
       where m.company_id = _s.company_id and m.origin = 'inventory' and m.ref = _s.id::text
         and m.note in ('Remise à zéro du stock réel (inventaire)', 'Retour arrière : remise à zéro annulée')
       group by m.article_id having sum(m.qty_delta) <> 0
    loop
      perform public.record_stock_move(_r.article_id, 'inventaire', -_r.q, null, false, null, 'inventory', _s.id::text,
                                       'Retour arrière : remise à zéro annulée');
      _n := _n + 1;
    end loop;
  elsif _last = 'raz_arrete' then
    for _r in
      select ad.article_id, sum(ad.delta) as q from public.stock_snapshot_adjustments ad
       where ad.snapshot_id = _s.snapshot_id and ad.mode in ('raz', 'retour') and ad.note = _s.id::text
       group by ad.article_id having sum(ad.delta) <> 0
    loop
      insert into public.stock_snapshot_adjustments (company_id, snapshot_id, article_id, mode, counted, old_qty, new_qty, delta, origin, note, operator_id)
      select _s.company_id, _s.snapshot_id, _r.article_id, 'retour', null, e.adjusted_qty, e.adjusted_qty - _r.q, -_r.q, 'inventory', _s.id::text, auth.uid()
        from public._snapshot_effective(_s.snapshot_id) e where e.article_id = _r.article_id;
      _n := _n + 1;
    end loop;
  end if;

  insert into public.inventory_step_log (company_id, session_id, step_code, action, detail, operator_id)
  values (_s.company_id, _s.id, _last, 'retour', jsonb_build_object('compensations', _n), auth.uid());
  return _last;
end $$;
grant execute on function public.inventory_step_rollback(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Réajustement de l'ARRÊTÉ (3 modes, B6)
-- ---------------------------------------------------------------------
create or replace function public.snapshot_adjust(_snapshot uuid, _article uuid, _counted numeric, _mode text,
                                                  _bin text default null, _note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _snap public.stock_snapshots; _company uuid; _old numeric; _new numeric;
begin
  if _mode not in ('annule_remplace', 'cumul', 'casier') then raise exception 'Mode inconnu : %', _mode; end if;
  if _mode = 'casier' and nullif(btrim(coalesce(_bin, '')), '') is null then raise exception 'Casier obligatoire en mode casier'; end if;
  if _counted is null then raise exception 'Quantité obligatoire'; end if;
  select * into _snap from public.stock_snapshots where id = _snapshot for update;
  if _snap.id is null or not public.can_write_table(_snap.company_id, 'inventory_sessions') then raise exception 'Accès refusé'; end if;
  if _snap.kind <> 'arrete' then raise exception 'Seul un arrêté se réajuste (une copie est une photo figée)'; end if;
  if _snap.status <> 'actif' then raise exception 'Arrêté annulé'; end if;
  if _snap.reintegrated then raise exception 'Arrêté déjà réintégré'; end if;
  select company_id into _company from public.articles where id = _article;
  if _company is distinct from _snap.company_id then raise exception 'Article d''une autre société'; end if;

  select coalesce((select adjusted_qty from public._snapshot_effective(_snapshot) where article_id = _article), 0) into _old;
  _new := public._arrete_next_qty(_snapshot, _article, _mode, _counted, nullif(btrim(coalesce(_bin, '')), ''));
  insert into public.stock_snapshot_adjustments (company_id, snapshot_id, article_id, mode, counted, bin, old_qty, new_qty, delta, origin, note, operator_id)
  values (_snap.company_id, _snapshot, _article, _mode, _counted, nullif(btrim(coalesce(_bin, '')), ''), _old, _new, _new - _old, 'screen', _note, auth.uid());
  return jsonb_build_object('old', _old, 'new', _new, 'delta', _new - _old);
end $$;
grant execute on function public.snapshot_adjust(uuid, uuid, numeric, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Réajustement du STOCK RÉEL (3 modes, B6) — miroir TS `realReadjustDelta`.
--   annule_remplace : la saisie devient le stock réel ;
--   cumul           : la saisie s'ajoute au stock réel ;
--   casier          : article à UN seul emplacement → la saisie devient son stock ;
--                     article multi-emplacements → la saisie devient le stock DU casier
--                     (somme des mouvements de ce casier, `bin_stock`).
-- Toujours un mouvement `inventaire` tracé (ancien / nouveau en retour, opérateur).
-- ---------------------------------------------------------------------
create or replace function public.stock_readjust(_article uuid, _counted numeric, _mode text,
                                                 _bin text default null, _ref text default null, _note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _a public.articles; _real numeric; _bin_q numeric; _multi boolean; _delta numeric; _b text := nullif(btrim(coalesce(_bin, '')), '');
begin
  if _mode not in ('annule_remplace', 'cumul', 'casier') then raise exception 'Mode inconnu : %', _mode; end if;
  if _counted is null then raise exception 'Quantité obligatoire'; end if;
  select * into _a from public.articles where id = _article;
  if _a.id is null or not public.can_write_table(_a.company_id, 'inventory_sessions') then raise exception 'Accès refusé'; end if;
  if not public._is_stocked_type(_a.mgmt_type::text) then raise exception 'Article non stocké (type %)', _a.mgmt_type; end if;
  if _mode = 'casier' and _b is null then raise exception 'Casier obligatoire en mode casier'; end if;
  perform pg_advisory_xact_lock(hashtext('stock:' || _article::text));
  select coalesce(sum(qty_delta), 0) into _real from public.stock_moves where article_id = _article and not is_reservation;
  if _mode = 'annule_remplace' then
    _delta := _counted - _real;
  elsif _mode = 'cumul' then
    _delta := _counted;
  else
    _multi := nullif(btrim(coalesce(_a.bin_location2, '')), '') is not null
           or (select count(*) from public.article_bins ab where ab.article_id = _article
                 and ab.bin_location is distinct from _a.bin_location) > 0;
    if _multi then
      select coalesce(sum(qty_delta), 0) into _bin_q from public.stock_moves
       where article_id = _article and not is_reservation and coalesce(bin_location, '') = _b;
      _delta := _counted - _bin_q;
    else
      _delta := _counted - _real;
    end if;
  end if;
  if _delta <> 0 then
    perform public.record_stock_move(_article, 'inventaire', _delta, null, false, _b, 'inventory', _ref,
      coalesce(nullif(btrim(coalesce(_note, '')), ''), 'Réajustement ' || replace(_mode, '_', ' ') || coalesce(' / ' || _b, '')));
  end if;
  return jsonb_build_object('old', _real, 'new', _real + _delta, 'delta', _delta);
end $$;
grant execute on function public.stock_readjust(uuid, numeric, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Remise à zéro du stock réel HORS inventaire (confirmation forte)
--   _scope : 'tous' (positifs et négatifs) | 'negatifs' (uniquement négatifs).
--   Une copie de stock « avant remise à zéro » est prise d'abord (retour possible).
-- ---------------------------------------------------------------------
create or replace function public.stock_reset_real(_company uuid, _scope text, _keep_vehicles boolean, _confirm text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _snap uuid; _n int; _ref text;
begin
  if not public.can_write_table(_company, 'inventory_sessions') then raise exception 'Accès refusé'; end if;
  if _scope not in ('tous', 'negatifs') then raise exception 'Portée inconnue : %', _scope; end if;
  if coalesce(_confirm, '') <> 'REMISE A ZERO' then raise exception 'Confirmation manquante : tapez REMISE A ZERO'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory:' || _company::text));
  _ref := 'RAZ-' || to_char(now() at time zone 'Europe/Brussels', 'YYYYMMDD-HH24MISS');
  _snap := public._stock_photo(_company, 'copie', 'Copie avant remise à zéro ' || to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY HH24:MI'), 'manuel', null);
  _n := public._stock_reset(_company, _scope, coalesce(_keep_vehicles, true), _ref,
          case when _scope = 'negatifs' then 'Remise à zéro des stocks négatifs' else 'Remise à zéro du stock réel' end);
  insert into public.events (company_id, entity_type, entity_id, action, origin, new_data)
  values (_company, 'stock', _company::text, 'stock_reset', 'screen',
          jsonb_build_object('scope', _scope, 'keep_vehicles', _keep_vehicles, 'moves', _n, 'ref', _ref, 'copy_before', _snap, 'by', auth.uid()));
  return jsonb_build_object('moves', _n, 'ref', _ref, 'snapshot_id', _snap);
end $$;
grant execute on function public.stock_reset_real(uuid, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Liste de comptage : TOUS les articles stockés (pas seulement les mouvementés)
--   _scope : 'stock' (en stock, dans l'arrêté, déjà comptés ou avec un mini)
--            | 'tous' (tous les articles stockés A/V/O/P/D actifs, hors librairie)
--            | 'non_comptes' (dans l'arrêté ou en stock, pas encore comptés)
--   _bin : filtre casier (localisation 1 ou 2, ou casier secondaire), début du code.
-- ---------------------------------------------------------------------
create or replace function public.inventory_count_list(_company uuid, _snapshot uuid default null, _scope text default 'stock',
                                                       _search text default null, _bin text default null,
                                                       _limit int default 200, _offset int default 0)
returns table(article_id uuid, reference text, designation text, mgmt_type text, bin_location text, bin_location2 text,
              real_qty numeric, snapshot_qty numeric, adjusted_qty numeric, counted boolean, last_count_at timestamptz,
              pamp numeric, multi_bin boolean, total_count bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with lv as (select * from public._stock_levels(_company)),
  eff as (select * from public._snapshot_effective(_snapshot) where _snapshot is not null),
  q as (select nullif(btrim(coalesce(_search, '')), '') as s, nullif(btrim(coalesce(_bin, '')), '') as b)
  select a.id, a.reference, a.designation, a.mgmt_type::text, a.bin_location, a.bin_location2,
         coalesce(lv.real_qty, 0), coalesce(eff.initial_qty, 0), coalesce(eff.adjusted_qty, 0),
         coalesce(eff.counted, false), eff.last_count_at, a.pamp,
         (nullif(btrim(coalesce(a.bin_location2, '')), '') is not null
           or exists (select 1 from public.article_bins ab where ab.article_id = a.id and ab.bin_location is distinct from a.bin_location)),
         count(*) over ()
    from public.articles a
    cross join q
    left join lv on lv.article_id = a.id
    left join eff on eff.article_id = a.id
   where a.company_id = _company and public.is_member(_company)
     and public._is_stocked_type(a.mgmt_type::text)
     and (a.is_active or lv.article_id is not null or eff.article_id is not null)
     and (not a.is_library or lv.article_id is not null or eff.article_id is not null)
     and case coalesce(_scope, 'stock')
           when 'tous' then true
           when 'non_comptes' then (lv.article_id is not null or eff.article_id is not null) and not coalesce(eff.counted, false)
           else lv.article_id is not null or eff.article_id is not null or coalesce(a.stock_min, 0) > 0
         end
     and (q.s is null or a.reference ilike '%' || q.s || '%' or a.designation ilike '%' || q.s || '%'
          or a.supplier_ref ilike '%' || q.s || '%'
          or exists (select 1 from public.article_barcodes bc where bc.article_id = a.id and bc.barcode = q.s))
     and (q.b is null or a.bin_location ilike q.b || '%' or a.bin_location2 ilike q.b || '%'
          or exists (select 1 from public.article_bins ab where ab.article_id = a.id and ab.bin_location ilike q.b || '%'))
   order by a.bin_location nulls last, a.reference
   limit least(greatest(coalesce(_limit, 200), 1), 1000)
  offset greatest(coalesce(_offset, 0), 0);
$$;
revoke all on function public.inventory_count_list(uuid, uuid, text, text, text, int, int) from public, anon;
grant execute on function public.inventory_count_list(uuid, uuid, text, text, text, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Écarts d'un inventaire : arrêté initial vs compté
--   magasin ouvert : compté = arrêté réajusté ; magasin fermé : compté = stock réel.
-- ---------------------------------------------------------------------
create or replace function public.inventory_session_gaps(_session uuid)
returns table(article_id uuid, reference text, designation text, bin_location text,
              initial_qty numeric, counted_qty numeric, gap_qty numeric, pamp numeric, gap_value numeric, counted boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _s public.inventory_sessions;
begin
  select * into _s from public.inventory_sessions where id = _session;
  if _s.id is null or not public.is_member(_s.company_id) then raise exception 'Accès refusé'; end if;
  if _s.snapshot_id is null then return; end if;
  return query
  with eff as (select * from public._snapshot_effective(_s.snapshot_id)),
  lv as (select * from public._stock_levels(_s.company_id)),
  base as (
    select coalesce(eff.article_id, lv.article_id) as aid, coalesce(eff.initial_qty, 0) as ini,
           case when _s.magasin_ouvert then coalesce(eff.adjusted_qty, 0) else coalesce(lv.real_qty, 0) end as cnt,
           coalesce(eff.pamp, lv.pamp) as pa, coalesce(eff.counted, false) as c
      from eff full join lv on lv.article_id = eff.article_id
     where _s.magasin_ouvert = false or eff.article_id is not null
  )
  select a.id, a.reference, a.designation, a.bin_location, b.ini, b.cnt, b.cnt - b.ini, coalesce(b.pa, a.pamp),
         round((b.cnt - b.ini) * coalesce(b.pa, a.pamp), 2), b.c
    from base b join public.articles a on a.id = b.aid
   where b.cnt <> b.ini
   order by a.reference;
end $$;
grant execute on function public.inventory_session_gaps(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Copies et arrêtés : liste avec nombre de lignes et valeur
-- ---------------------------------------------------------------------
create or replace function public.stock_snapshot_summaries(_company uuid, _limit int default 100)
returns table(id uuid, kind text, label text, status text, origin text, created_at timestamptz,
              created_by_name text, session_id uuid, reintegrated boolean, reintegrated_at timestamptz,
              line_count bigint, total_qty numeric, total_value numeric, adjusted_count bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.kind, s.label, s.status, s.origin, s.created_at, coalesce(p.full_name, p.email),
         s.session_id, s.reintegrated, s.reintegrated_at,
         (select count(*) from public.stock_snapshot_lines l where l.snapshot_id = s.id),
         (select coalesce(sum(l.qty), 0) from public.stock_snapshot_lines l where l.snapshot_id = s.id),
         (select coalesce(round(sum(l.qty * l.pamp), 2), 0) from public.stock_snapshot_lines l where l.snapshot_id = s.id),
         (select count(distinct ad.article_id) from public.stock_snapshot_adjustments ad where ad.snapshot_id = s.id
            and ad.mode in ('annule_remplace', 'cumul', 'casier'))
    from public.stock_snapshots s
    left join public.profiles p on p.id = s.created_by
   where s.company_id = _company and public.is_member(_company)
   order by s.created_at desc
   limit least(greatest(coalesce(_limit, 100), 1), 500);
$$;
grant execute on function public.stock_snapshot_summaries(uuid, int) to authenticated;

-- Le tableau de bord des droits (M0) : ces tables s'écrivent depuis /stock.
insert into public.table_write_pages (table_name, page) values
  ('inventory_step_log', '/stock'), ('stock_snapshot_adjustments', '/stock'), ('stock_snapshots', '/stock')
on conflict do nothing;

-- Audit (B7) des en-têtes de photo (statut, réintégration).
drop trigger if exists trg_snapshots_audit on public.stock_snapshots;
create trigger trg_snapshots_audit after insert or update or delete on public.stock_snapshots for each row execute function public.audit_row();
