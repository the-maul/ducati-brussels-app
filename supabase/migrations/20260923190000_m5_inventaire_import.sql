-- =====================================================================
-- M5 / M14 — IMPORT D'UN INVENTAIRE G8 (« l'inventaire fait foi à sa date »)
--
-- Décision M-44 : l'inventaire exporté de G8 est la vérité du stock à sa date.
-- Tout écart postérieur passe par un mouvement tracé, jamais par un UPDATE (B7).
--
-- Ce que la migration installe (rien n'est importé ici : elle ne pose que l'outil) :
--   * `inventory_imports`       — un en-tête par fichier d'inventaire (origine, date, n° d'inventaire)
--   * `inventory_import_lines`  — les lignes du fichier, telles que lues, + leur résolution
--   * `inventory_import_stage`  — dépose un lot de lignes (relançable : remplace la ligne du même n°)
--   * `inventory_import_resolve`— rapproche chaque ligne du DMS (VIN pour les motos, référence sinon)
--   * `inventory_import_preview`— DRY-RUN : ce que l'application ferait, sans rien écrire
--   * `inventory_import_apply`  — applique par lots (chaque appel tient sous les 8 s de PostgREST)
--   * `inventory_import_report` — contrôles d'après import (négatifs, valeur, écarts)
--   * `inventory_import_vin_candidates` / `inventory_import_complete_vins` — VIN des motos du site
--
-- Règles respectées :
--   B4/B7 — le stock n'est JAMAIS mis à jour : un seul mouvement `inventaire` par ligne,
--           de quantité = (stock du fichier − stock calculé), origine + n° d'inventaire + rayon.
--   B5    — le PAMP passe par `record_stock_move` (entrée valorisée) quand c'est exact ;
--           quand la moyenne pondérée ne peut pas retomber sur la valeur G8 (article qui a déjà
--           du stock), le PAMP est aligné explicitement et l'ancienne valeur est tracée dans `events`.
--   B7    — le prix d'achat passe par `record_price_change` (table `price_changes`), jamais en silence.
--   M-40  — aucune fiche moto n'est créée ni dupliquée : une ligne à châssis ne touche que la
--           moto qui porte déjà ce VIN.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. En-tête d'inventaire
-- ---------------------------------------------------------------------
create table if not exists public.inventory_imports (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  origin      text not null,                       -- 'import:g8-inventaire-20260923'
  ref         text,                                -- n° d'inventaire porté par chaque mouvement
  source_file text,
  counted_at  timestamptz not null default now(),  -- date/heure de l'arrêté G8
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  applied_at  timestamptz,
  stats       jsonb,
  unique (company_id, origin)
);

create table if not exists public.inventory_import_lines (
  id             bigint generated always as identity primary key,
  import_id      uuid not null references public.inventory_imports(id) on delete cascade,
  line_no        integer not null,
  reference      text not null,
  reference_norm text not null,
  designation    text,
  vin            text,
  real_qty       numeric(14,3) not null,
  avail_qty      numeric(14,3),
  pamp           numeric(14,3),
  stock_value    numeric(14,4),
  bin_location   text,
  supplier       text,
  rayon          text,
  sous_rayon     text,
  categorie      text,
  barcode        text,
  last_in        date,
  last_out       date,
  -- résolution / résultat
  article_id     uuid references public.articles(id) on delete set null,
  vehicle_id     uuid references public.vehicles(id) on delete set null,
  match_kind     text,                       -- vin | reference | creation | moto_sans_fiche | ambigu
  applied_delta  numeric(14,3),
  move_id        bigint,
  state          text not null default 'staged',   -- staged | applied | skipped
  message        text,
  unique (import_id, line_no)
);
create index if not exists idx_invimportlines_import on public.inventory_import_lines(import_id, state);
create index if not exists idx_invimportlines_norm on public.inventory_import_lines(import_id, reference_norm);
create index if not exists idx_invimportlines_vin on public.inventory_import_lines(import_id, vin) where vin is not null;

alter table public.inventory_imports enable row level security;
alter table public.inventory_import_lines enable row level security;
drop policy if exists invimports_select on public.inventory_imports;
create policy invimports_select on public.inventory_imports for select to authenticated using (public.is_member(company_id));
drop policy if exists invimportlines_select on public.inventory_import_lines;
create policy invimportlines_select on public.inventory_import_lines for select to authenticated
  using (exists (select 1 from public.inventory_imports i where i.id = import_id and public.is_member(i.company_id)));

comment on table public.inventory_imports is
  'Un inventaire importé depuis G8 (M-44). L''inventaire fait foi à sa date ; tout écart ultérieur passe par un mouvement tracé.';
comment on table public.inventory_import_lines is
  'Lignes du fichier d''inventaire telles que lues, avec leur rapprochement et le mouvement de stock produit.';

-- ---------------------------------------------------------------------
-- 2. Ouvrir (ou retrouver) un inventaire — idempotent
-- ---------------------------------------------------------------------
create or replace function public.inventory_import_open(
  _company uuid, _origin text, _ref text default null,
  _source_file text default null, _counted_at timestamptz default now()
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare _id uuid;
begin
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  insert into public.inventory_imports (company_id, origin, ref, source_file, counted_at, created_by)
  values (_company, _origin, _ref, _source_file, coalesce(_counted_at, now()), auth.uid())
  on conflict (company_id, origin) do update
    set ref = coalesce(excluded.ref, public.inventory_imports.ref),
        source_file = coalesce(excluded.source_file, public.inventory_imports.source_file),
        counted_at = excluded.counted_at
  returning id into _id;
  return _id;
end $$;
grant execute on function public.inventory_import_open(uuid, text, text, text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Déposer un lot de lignes — relançable (la ligne du même n° est remplacée)
--    _lines : [{ "line_no":2, "reference":"...", "designation":"...", "vin":"...",
--                "real_qty":3, "avail_qty":1, "pamp":5.117, "stock_value":15.35,
--                "bin_location":"ETAG.1/6", "supplier":"...", "rayon":"...",
--                "sous_rayon":"...", "categorie":"...", "barcode":"...",
--                "last_in":"2026-02-11", "last_out":null }, ... ]
-- ---------------------------------------------------------------------
create or replace function public.inventory_import_stage(_import uuid, _lines jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _n integer;
begin
  select company_id into _company from public.inventory_imports where id = _import;
  if _company is null then raise exception 'Inventaire introuvable.' using errcode = '22023'; end if;
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  insert into public.inventory_import_lines (
    import_id, line_no, reference, reference_norm, designation, vin, real_qty, avail_qty,
    pamp, stock_value, bin_location, supplier, rayon, sous_rayon, categorie, barcode, last_in, last_out)
  select _import,
         (l->>'line_no')::int,
         btrim(l->>'reference'),
         public.ducati_catalog_norm_ref(l->>'reference'),
         nullif(btrim(coalesce(l->>'designation','')), ''),
         nullif(upper(btrim(coalesce(l->>'vin',''))), ''),
         coalesce((l->>'real_qty')::numeric, 0),
         (l->>'avail_qty')::numeric,
         (l->>'pamp')::numeric,
         (l->>'stock_value')::numeric,
         nullif(btrim(coalesce(l->>'bin_location','')), ''),
         nullif(btrim(coalesce(l->>'supplier','')), ''),
         nullif(btrim(coalesce(l->>'rayon','')), ''),
         nullif(btrim(coalesce(l->>'sous_rayon','')), ''),
         nullif(btrim(coalesce(l->>'categorie','')), ''),
         nullif(btrim(coalesce(l->>'barcode','')), ''),
         (l->>'last_in')::date,
         (l->>'last_out')::date
    from jsonb_array_elements(_lines) l
   where public.ducati_catalog_norm_ref(l->>'reference') is not null
  on conflict (import_id, line_no) do update set
    reference = excluded.reference, reference_norm = excluded.reference_norm,
    designation = excluded.designation, vin = excluded.vin,
    real_qty = excluded.real_qty, avail_qty = excluded.avail_qty,
    pamp = excluded.pamp, stock_value = excluded.stock_value,
    bin_location = excluded.bin_location, supplier = excluded.supplier,
    rayon = excluded.rayon, sous_rayon = excluded.sous_rayon,
    categorie = excluded.categorie, barcode = excluded.barcode,
    last_in = excluded.last_in, last_out = excluded.last_out,
    state = case when public.inventory_import_lines.state = 'applied'
                  and public.inventory_import_lines.real_qty is not distinct from excluded.real_qty
                 then 'applied' else 'staged' end;
  get diagnostics _n = row_count;
  return _n;
end $$;
grant execute on function public.inventory_import_stage(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Rapprochement (lecture seule sur le DMS, écrit seulement la résolution)
--    Motos (ligne à châssis) : par VIN, JAMAIS par référence (une même référence
--    G8 porte plusieurs châssis). Pièces : par référence normalisée.
-- ---------------------------------------------------------------------
create or replace function public.inventory_import_resolve(_import uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; st jsonb;
begin
  select company_id into _company from public.inventory_imports where id = _import;
  if _company is null then raise exception 'Inventaire introuvable.' using errcode = '22023'; end if;
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  -- a) remise à plat de la résolution des lignes pas encore appliquées
  update public.inventory_import_lines
     set article_id = null, vehicle_id = null, match_kind = null, message = null
   where import_id = _import and state <> 'applied';

  -- b) motos : une seule fiche portant ce VIN
  with v as (
    select l.id lid, min(ve.id::text) vid, count(*) n
      from public.inventory_import_lines l
      join public.vehicles ve on ve.company_id = _company and upper(coalesce(ve.vin, '')) = l.vin
     where l.import_id = _import and l.vin is not null and l.state <> 'applied'
     group by l.id)
  update public.inventory_import_lines l
     set vehicle_id = v.vid::uuid,
         match_kind = case when v.n > 1 then 'ambigu' else 'vin' end,
         message = case when v.n > 1 then v.n || ' fiches moto portent ce châssis' end
    from v where v.lid = l.id;

  update public.inventory_import_lines l
     set article_id = a.id
    from public.articles a
   where l.import_id = _import and l.state <> 'applied'
     and l.vehicle_id is not null and a.vehicle_id = l.vehicle_id;

  update public.inventory_import_lines l
     set match_kind = 'moto_sans_fiche',
         message = coalesce(l.message,
           case when l.vehicle_id is null then 'Châssis absent du parc : fiche moto à créer à la main (M03)'
                else 'Moto présente au parc mais sans article stocké (statut non vendable) : rien n''est créé' end)
   where l.import_id = _import and l.state <> 'applied'
     and l.vin is not null and l.article_id is null;

  -- c) pièces : par référence normalisée (une seule correspondance)
  with r as (
    select l.id lid, min(a.id::text) aid, count(*) n
      from public.inventory_import_lines l
      join public.articles a on a.company_id = _company
       and regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') = l.reference_norm
     where l.import_id = _import and l.vin is null and l.state <> 'applied'
     group by l.id)
  update public.inventory_import_lines l
     set article_id = r.aid::uuid,
         match_kind = case when r.n > 1 then 'ambigu' else 'reference' end,
         message = case when r.n > 1 then r.n || ' articles portent cette référence' end
    from r where r.lid = l.id;

  update public.inventory_import_lines
     set match_kind = 'creation'
   where import_id = _import and state <> 'applied' and vin is null and article_id is null;

  select jsonb_build_object(
    'lignes', count(*),
    'par_vin', count(*) filter (where match_kind = 'vin'),
    'par_reference', count(*) filter (where match_kind = 'reference'),
    'a_creer', count(*) filter (where match_kind = 'creation'),
    'motos_sans_fiche', count(*) filter (where match_kind = 'moto_sans_fiche'),
    'ambigus', count(*) filter (where match_kind = 'ambigu'),
    'deja_appliquees', count(*) filter (where state = 'applied'))
    into st
    from public.inventory_import_lines where import_id = _import;
  return st;
end $$;
grant execute on function public.inventory_import_resolve(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. DRY-RUN — ce que l'application ferait, sans rien écrire
-- ---------------------------------------------------------------------
create or replace function public.inventory_import_preview(_import uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; st jsonb;
begin
  select company_id into _company from public.inventory_imports where id = _import;
  if _company is null then raise exception 'Inventaire introuvable.' using errcode = '22023'; end if;
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  with l as (
    select li.*,
           coalesce((select sum(case when not sm.is_reservation then sm.qty_delta else 0 end)
                       from public.stock_moves sm where sm.article_id = li.article_id), 0) as cur_stock,
           a.pamp cur_pamp, a.purchase_price cur_pa, a.bin_location cur_bin, a.to_complete cur_tc
      from public.inventory_import_lines li
      left join public.articles a on a.id = li.article_id
     where li.import_id = _import)
  select jsonb_build_object(
    'lignes_lues', count(*),
    'articles_trouves', count(*) filter (where article_id is not null),
    'articles_a_creer', count(*) filter (where match_kind = 'creation'),
    'motos_par_vin', count(*) filter (where match_kind = 'vin'),
    'motos_sans_fiche', count(*) filter (where match_kind = 'moto_sans_fiche'),
    'ambigus', count(*) filter (where match_kind = 'ambigu'),
    'mouvements_a_creer', count(*) filter (where match_kind in ('creation') or
                                                 (article_id is not null and real_qty <> cur_stock)),
    'lignes_deja_au_bon_stock', count(*) filter (where article_id is not null and real_qty = cur_stock),
    'pieces_a_entrer', coalesce(sum(case when article_id is not null and real_qty > cur_stock
                                         then real_qty - cur_stock else 0 end), 0)
                       + coalesce(sum(case when match_kind = 'creation' then real_qty else 0 end), 0),
    'pieces_a_sortir', coalesce(sum(case when article_id is not null and real_qty < cur_stock
                                         then cur_stock - real_qty else 0 end), 0),
    'pamp_a_poser', count(*) filter (where pamp is not null
                                       and coalesce(cur_pamp, 0) is distinct from round(pamp, 3)),
    'prix_achat_a_poser', count(*) filter (where coalesce(pamp, 0) > 0 and coalesce(cur_pa, 0) = 0),
    'casiers_a_poser', count(*) filter (where bin_location is not null
                                          and coalesce(cur_bin, '') is distinct from bin_location),
    'lignes_negatives', count(*) filter (where real_qty < 0),
    'valeur_fichier', round(coalesce(sum(stock_value), 0), 2),
    'valeur_lignes_appliquables', round(coalesce(sum(stock_value) filter
        (where article_id is not null or match_kind = 'creation'), 0), 2),
    'valeur_lignes_ecartees', round(coalesce(sum(stock_value) filter
        (where article_id is null and match_kind <> 'creation'), 0), 2))
    into st from l;
  return st;
end $$;
grant execute on function public.inventory_import_preview(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. APPLICATION par lots — chaque appel reste sous les 8 s de PostgREST.
--    Un seul mouvement `inventaire` par ligne (delta = stock G8 − stock calculé).
-- ---------------------------------------------------------------------
create or replace function public.inventory_import_apply(_import uuid, _limit integer default 300)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t0 timestamptz := clock_timestamp();
  _company uuid; _origin text; _ref text;
  lim integer := least(greatest(coalesce(_limit, 300), 1), 5000);
  r record;
  _cur numeric; _delta numeric; _cost numeric; _move bigint; _new_pamp numeric; _aid uuid;
  n_lines int := 0; n_created int := 0; n_moves int := 0; n_pamp int := 0; n_pa int := 0;
  n_bin int := 0; n_skip int := 0; n_tc int := 0; q_in numeric := 0; q_out numeric := 0;
  st jsonb;
begin
  select company_id, origin, ref into _company, _origin, _ref from public.inventory_imports where id = _import;
  if _company is null then raise exception 'Inventaire introuvable.' using errcode = '22023'; end if;
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory_import_apply:' || _import::text));

  for r in
    select * from public.inventory_import_lines
     where import_id = _import and state = 'staged'
     order by line_no limit lim
  loop
    -- a) ligne non applicable : on la range avec sa raison, rien n'est écrit
    if r.match_kind in ('moto_sans_fiche', 'ambigu') then
      update public.inventory_import_lines set state = 'skipped' where id = r.id;
      n_skip := n_skip + 1; n_lines := n_lines + 1;
      continue;
    end if;

    _aid := r.article_id;

    -- b) article absent du DMS : on le crée (type A stocké, désignation du fichier)
    if _aid is null then
      insert into public.articles (
        company_id, reference, designation, brand, mgmt_type, is_library, is_active,
        vat_rate, publishable, bin_location, category_path, note, to_complete, to_complete_source)
      values (
        _company, r.reference, coalesce(r.designation, r.reference),
        case when upper(coalesce(r.supplier, '')) like 'DUCATI%' then 'Ducati' else initcap(coalesce(r.supplier, '')) end,
        'A', false, true, 21, false, r.bin_location,
        nullif(concat_ws('/', r.rayon, r.sous_rayon), ''),
        nullif(concat_ws(' · ', 'Créé par l''inventaire G8 du ' ||
               to_char((select counted_at from public.inventory_imports where id = _import), 'DD/MM/YYYY'),
               nullif(r.categorie, '')), ''),
        coalesce(r.pamp, 0) <= 0, case when coalesce(r.pamp, 0) <= 0 then 'inventaire_g8' end)
      on conflict (company_id, reference) do nothing
      returning id into _aid;

      if _aid is null then      -- course : l'article vient d'être créé ailleurs
        select id into _aid from public.articles
         where company_id = _company and reference = r.reference limit 1;
      else
        n_created := n_created + 1;
      end if;
      update public.inventory_import_lines set article_id = _aid where id = r.id;
    end if;

    -- c) STOCK — un seul mouvement d'inventaire, quantité = cible − stock calculé (B7)
    select coalesce(sum(case when not is_reservation then qty_delta else 0 end), 0)
      into _cur from public.stock_moves where article_id = _aid;
    _delta := round(r.real_qty - _cur, 3);
    _move := null;

    if _delta <> 0 then
      -- PAMP par la porte officielle quand elle retombe EXACTEMENT sur la valeur G8 :
      -- entrée valorisée sur un stock de départ ≤ 0 → le PAMP repart du coût (B5).
      _cost := case when _delta > 0 and coalesce(r.pamp, 0) > 0 and _cur <= 0 then r.pamp end;
      _move := public.record_stock_move(
        _aid, 'inventaire', _delta, _cost, false, r.bin_location,
        _origin, _ref, nullif(concat_ws(' · ', r.rayon, r.sous_rayon), ''));
      n_moves := n_moves + 1;
      if _delta > 0 then q_in := q_in + _delta; else q_out := q_out - _delta; end if;
    end if;

    -- d) PAMP — aligné sur l'inventaire quand la porte officielle ne pouvait pas y arriver
    --    (article qui avait déjà du stock : la moyenne pondérée mélangerait un PAMP périmé).
    if coalesce(r.pamp, 0) > 0 then
      select pamp into _new_pamp from public.articles where id = _aid;
      if coalesce(_new_pamp, 0) is distinct from round(r.pamp, 3) then
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_company, auth.uid(), 'inventory_pamp_set', 'articles', _aid::text, _origin,
                jsonb_build_object('pamp', _new_pamp),
                jsonb_build_object('pamp', round(r.pamp, 3), 'reference', r.reference,
                                   'inventaire', _ref, 'stock', r.real_qty));
        update public.articles set pamp = round(r.pamp, 3), updated_at = now() where id = _aid;
        n_pamp := n_pamp + 1;
      end if;
    end if;

    -- e) PRIX D'ACHAT — par price_changes (B7), et seulement s'il est encore vide :
    --    on ne remplace jamais un prix d'achat réel par une moyenne.
    if coalesce(r.pamp, 0) > 0
       and coalesce((select purchase_price from public.articles where id = _aid), 0) = 0 then
      perform public.record_price_change(_aid, round(r.pamp, 4), null, null, null, _origin);
      n_pa := n_pa + 1;

      -- la moto n'attend plus son prix d'achat (marqueur posé le 23/09, migration M-40)
      update public.articles set to_complete = false, to_complete_source = null, updated_at = now()
       where id = _aid and to_complete and to_complete_source = 'prix_achat_moto';
      if found then
        n_tc := n_tc + 1;
        update public.vehicles v
           set to_complete_reason = nullif(trim(both ' · ' from
                 replace(coalesce(v.to_complete_reason, ''), 'Prix d''achat à compléter', '')), ''),
               updated_at = now()
          from public.articles a
         where a.id = _aid and a.vehicle_id = v.id;
        update public.vehicles v set to_complete = false
          from public.articles a
         where a.id = _aid and a.vehicle_id = v.id and v.to_complete_reason is null;
      end if;
    end if;

    -- f) CASIER — l'inventaire fait foi sur l'emplacement (changement tracé, règle 4)
    if r.bin_location is not null
       and coalesce((select bin_location from public.articles where id = _aid), '') is distinct from r.bin_location then
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      select _company, auth.uid(), 'inventory_bin_set', 'articles', _aid::text, _origin,
             jsonb_build_object('bin_location', a.bin_location),
             jsonb_build_object('bin_location', r.bin_location, 'reference', r.reference, 'inventaire', _ref)
        from public.articles a where a.id = _aid;
      update public.articles set bin_location = r.bin_location, updated_at = now() where id = _aid;
      n_bin := n_bin + 1;
    end if;

    update public.inventory_import_lines
       set state = 'applied', applied_delta = _delta, move_id = _move,
           match_kind = coalesce(match_kind, 'creation')
     where id = r.id;
    n_lines := n_lines + 1;
  end loop;

  st := jsonb_build_object(
    'lignes_traitees', n_lines, 'articles_crees', n_created, 'mouvements', n_moves,
    'pieces_entrees', q_in, 'pieces_sorties', q_out,
    'pamp_alignes', n_pamp, 'prix_achat_poses', n_pa, 'motos_prix_achat_completes', n_tc,
    'casiers_poses', n_bin, 'lignes_ecartees', n_skip,
    'reste_a_traiter', (select count(*) from public.inventory_import_lines
                         where import_id = _import and state = 'staged'),
    'duration_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);

  update public.inventory_imports
     set applied_at = case when (st->>'reste_a_traiter')::int = 0 then now() else applied_at end,
         stats = coalesce(stats, '{}'::jsonb) || st
   where id = _import;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'inventory_import_apply', 'inventory_imports', _import::text,
          case when auth.uid() is null then 'system' else 'screen' end, null, st);
  return st;
end $$;
grant execute on function public.inventory_import_apply(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Contrôles d'après import
-- ---------------------------------------------------------------------
create or replace function public.inventory_import_report(_import uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; st jsonb;
begin
  select company_id into _company from public.inventory_imports where id = _import;
  if _company is null then raise exception 'Inventaire introuvable.' using errcode = '22023'; end if;
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  with s as (
    select article_id, sum(case when not is_reservation then qty_delta else 0 end) real_qty
      from public.stock_moves group by 1),
  a as (
    select a.id, a.reference, coalesce(s.real_qty, 0) real_qty, coalesce(a.pamp, 0) pamp
      from public.articles a left join s on s.article_id = a.id
     where a.company_id = _company),
  l as (
    select li.*, coalesce(s.real_qty, 0) cur_stock, coalesce(ar.pamp, 0) cur_pamp
      from public.inventory_import_lines li
      left join s on s.article_id = li.article_id
      left join public.articles ar on ar.id = li.article_id
     where li.import_id = _import)
  select jsonb_build_object(
    'lignes', (select count(*) from l),
    'lignes_appliquees', (select count(*) from l where state = 'applied'),
    'lignes_ecartees', (select count(*) from l where state = 'skipped'),
    'lignes_en_attente', (select count(*) from l where state = 'staged'),
    'stock_conforme', (select count(*) from l where state = 'applied' and cur_stock = real_qty),
    'stock_non_conforme', (select count(*) from l where state = 'applied' and cur_stock <> real_qty),
    'pamp_conforme', (select count(*) from l where state = 'applied'
                        and coalesce(pamp, 0) > 0 and cur_pamp = round(pamp, 3)),
    'pamp_non_conforme', (select count(*) from l where state = 'applied'
                        and coalesce(pamp, 0) > 0 and cur_pamp <> round(pamp, 3)),
    'negatifs_attendus_fichier', (select count(*) from l where real_qty < 0),
    'negatifs_dms', (select count(*) from a where real_qty < 0),
    'negatifs_dms_hors_fichier', (select count(*) from a
        where real_qty < 0 and not exists (select 1 from l where l.article_id = a.id and l.real_qty < 0)),
    'articles_stock_positif', (select count(*) from a where real_qty > 0),
    'valeur_stock_dms', (select round(coalesce(sum(real_qty * pamp), 0), 2) from a where real_qty <> 0),
    'valeur_stock_fichier', (select round(coalesce(sum(stock_value), 0), 2) from l),
    'valeur_lignes_ecartees', (select round(coalesce(sum(stock_value), 0), 2) from l where state = 'skipped'),
    'mouvements_import', (select count(*) from public.stock_moves sm
        where sm.origin = (select origin from public.inventory_imports where id = _import)))
    into st;
  return st;
end $$;
grant execute on function public.inventory_import_report(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. VIN des motos créées depuis le site (référence WEB-…, « à compléter », M-40)
--    Un châssis n'est proposé que si le rapprochement est SANS AMBIGUÏTÉ :
--    un seul modèle candidat de chaque côté, et un prix de vente cohérent avec
--    le PAMP de l'inventaire (marge entre 0 et 45 %).
-- ---------------------------------------------------------------------
create or replace function public.inventory_import_vin_candidates(_import uuid)
returns table (
  vehicle_id uuid, vehicle_reference text, vehicle_model text, sale_price_ttc numeric,
  line_no integer, file_reference text, file_designation text, vin text, pamp numeric,
  marge_pct numeric, n_candidats_moto integer, n_candidats_ligne integer, retenu boolean
) language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid;
begin
  select company_id into _company from public.inventory_imports where id = _import;
  if _company is null then raise exception 'Inventaire introuvable.' using errcode = '22023'; end if;
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  return query
  with web as (
    select v.id, v.reference, v.model, a.sale_price_ttc, a.vat_rate,
           public.ducati_catalog_norm_ref(v.model) mnorm
      from public.vehicles v join public.articles a on a.vehicle_id = v.id
     where v.company_id = _company and v.to_complete
       and nullif(btrim(coalesce(v.vin, '')), '') is null),
  orphan as (
    select l.line_no, l.reference, l.designation, l.vin, l.pamp,
           public.ducati_catalog_norm_ref(l.designation) dnorm
      from public.inventory_import_lines l
     where l.import_id = _import and l.vin is not null and l.match_kind = 'moto_sans_fiche'
       and l.vehicle_id is null),
  pair as (
    select w.id, w.reference, w.model, w.sale_price_ttc, o.line_no, o.reference fref,
           o.designation, o.vin, o.pamp,
           round((w.sale_price_ttc / (1 + coalesce(nullif(w.vat_rate, 0), 21) / 100) - o.pamp)
                 / nullif(o.pamp, 0) * 100, 1) marge
      from web w join orphan o
        on w.mnorm = o.dnorm or o.dnorm like w.mnorm || '%' or w.mnorm like o.dnorm || '%'
     where o.pamp > 0),
  cnt as (
    select p.*, count(*) over (partition by p.id) nm, count(*) over (partition by p.line_no) nl from pair p)
  select c.id, c.reference, c.model, c.sale_price_ttc, c.line_no, c.fref, c.designation, c.vin,
         c.pamp, c.marge, c.nm::int, c.nl::int,
         (c.nm = 1 and c.nl = 1 and c.marge >= 0 and c.marge <= 45)
    from cnt c order by c.line_no;
end $$;
grant execute on function public.inventory_import_vin_candidates(uuid) to authenticated, service_role;

create or replace function public.inventory_import_complete_vins(_import uuid, _apply boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _origin text; n int := 0; c record; st jsonb;
begin
  select company_id, origin into _company, _origin from public.inventory_imports where id = _import;
  if _company is null then raise exception 'Inventaire introuvable.' using errcode = '22023'; end if;
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  for c in select * from public.inventory_import_vin_candidates(_import) where retenu loop
    n := n + 1;
    if _apply then
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, auth.uid(), 'inventory_vin_complete', 'vehicles', c.vehicle_id::text, _origin,
              jsonb_build_object('vin', null),
              jsonb_build_object('vin', c.vin, 'source', c.file_reference, 'marge_pct', c.marge_pct));
      update public.vehicles
         set vin = c.vin,
             to_complete_reason = nullif(trim(both ' · ' from replace(coalesce(to_complete_reason, ''),
               'VIN à compléter — fiche créée automatiquement depuis l''annonce du site (décision M-40). '
               'Cette moto ne peut pas être facturée tant que son numéro de châssis n''est pas saisi.', '')), ''),
             updated_at = now()
       where id = c.vehicle_id;
      update public.vehicles set to_complete = false where id = c.vehicle_id and to_complete_reason is null;
    end if;
  end loop;

  st := jsonb_build_object('candidats_retenus', n, 'applique', coalesce(_apply, false),
                           'restent_a_completer', (select count(*) from public.vehicles
                              where company_id = _company and to_complete
                                and nullif(btrim(coalesce(vin, '')), '') is null));
  return st;
end $$;
grant execute on function public.inventory_import_complete_vins(uuid, boolean) to authenticated, service_role;
