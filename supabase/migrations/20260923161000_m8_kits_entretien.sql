-- =====================================================================
-- Mission 07 — carte 2, partie 2 : les kits de pièces d'entretien
--
-- Décision M-20 (client, 21/09) : « un kit de pièces par famille de moteur et
-- par entretien, proposé automatiquement à partir du catalogue et corrigeable
-- par l'atelier ».
--
-- Un kit = (famille de moteur × échéance d'entretien) pour une société. Son
-- contenu est PROPOSÉ par la déduction (migration 20260923160000) puis devient
-- la propriété de l'atelier : ajout, retrait, quantité. Chaque modification
-- incrémente la version et enregistre une photo complète du contenu
-- (maintenance_kit_versions) ; rien n'est perdu, rien n'est écrasé en silence.
--
-- Un kit édité par l'atelier n'est JAMAIS réécrit par une nouvelle génération :
-- la génération se contente d'y rattacher les modèles-années manquants.
--
-- Les consommables (huile, liquides) n'ont pas de référence dans le catalogue
-- de pièces : le manuel donne le produit et la quantité, l'atelier désigne une
-- fois pour toutes l'article du DMS correspondant (maintenance_fluid_articles).
--
-- Stock : AUCUN mouvement. Le type de gestion N (composant de forfait/kit, B1)
-- reste celui des articles ; on ne crée aucun article.
--
-- Additif : 4 tables, 8 fonctions.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.maintenance_kits (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete restrict,
  engine_family_key   text not null,
  engine_family_label text not null,
  service_code        text not null,
  service_label       text not null,
  content_hash        text not null,           -- signature du contenu proposé
  version             integer not null default 1,
  status              text not null default 'actif' check (status in ('actif', 'archive')),
  edited_at           timestamptz,             -- non nul = l'atelier a repris la main
  edited_by           uuid references auth.users(id) on delete set null,
  generated_at        timestamptz not null default now(),
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists maintenance_kits_uniq
  on public.maintenance_kits (company_id, engine_family_key, service_code, content_hash)
  where status = 'actif';
create index if not exists maintenance_kits_company_idx
  on public.maintenance_kits (company_id, service_code);

create table if not exists public.maintenance_kit_model_years (
  kit_id        uuid not null references public.maintenance_kits(id) on delete cascade,
  model_year_id text not null references public.ducati_catalog_model_years(id) on delete cascade,
  primary key (kit_id, model_year_id)
);
create index if not exists maintenance_kit_my_idx
  on public.maintenance_kit_model_years (model_year_id);

create table if not exists public.maintenance_kit_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  kit_id        uuid not null references public.maintenance_kits(id) on delete cascade,
  family_code   text references public.maintenance_part_families(code) on delete set null,
  article_id    uuid references public.articles(id) on delete set null,
  reference     text,
  designation   text not null,
  quantity      numeric(12,3) not null default 1 check (quantity > 0),
  unit          text,
  kind          text not null default 'piece' check (kind in ('piece', 'consommable')),
  confidence    text not null default 'sur' check (confidence in ('sur', 'a_confirmer')),
  origin        text not null default 'deduit' check (origin in ('deduit', 'ajoute')),
  fluid_product text,
  fluid_spec    text,
  note          text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists maintenance_kit_items_kit_idx on public.maintenance_kit_items (kit_id);

-- Photo du contenu après chaque changement (versionnement).
create table if not exists public.maintenance_kit_versions (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  kit_id     uuid not null references public.maintenance_kits(id) on delete cascade,
  version    integer not null,
  items      jsonb not null,
  reason     text,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null,
  unique (kit_id, version)
);

-- L'article du DMS qui sert de consommable (huile moteur, liquide de frein…).
create table if not exists public.maintenance_fluid_articles (
  company_id  uuid not null references public.companies(id) on delete cascade,
  family_code text not null references public.maintenance_part_families(code) on delete cascade,
  article_id  uuid not null references public.articles(id) on delete restrict,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  primary key (company_id, family_code)
);

alter table public.maintenance_kits             enable row level security;
alter table public.maintenance_kit_model_years  enable row level security;
alter table public.maintenance_kit_items        enable row level security;
alter table public.maintenance_kit_versions     enable row level security;
alter table public.maintenance_fluid_articles   enable row level security;

do $$ begin
  create policy mk_read on public.maintenance_kits for select using (public.is_member(company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mki_read on public.maintenance_kit_items for select using (public.is_member(company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mkv_read on public.maintenance_kit_versions for select using (public.is_member(company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mfa_read on public.maintenance_fluid_articles for select using (public.is_member(company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mkmy_read on public.maintenance_kit_model_years for select using (
    exists (select 1 from public.maintenance_kits k where k.id = kit_id and public.is_member(k.company_id)));
exception when duplicate_object then null; end $$;

revoke insert, update, delete on public.maintenance_kits            from anon, authenticated;
revoke insert, update, delete on public.maintenance_kit_model_years from anon, authenticated;
revoke insert, update, delete on public.maintenance_kit_items       from anon, authenticated;
revoke insert, update, delete on public.maintenance_kit_versions    from anon, authenticated;
revoke insert, update, delete on public.maintenance_fluid_articles  from anon, authenticated;

do $$ begin
  create trigger trg_maintenance_kits_audit after insert or update or delete on public.maintenance_kits
    for each row execute function public.audit_row();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_maintenance_kit_items_audit after insert or update or delete on public.maintenance_kit_items
    for each row execute function public.audit_row();
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. Photo de version (interne)
-- ---------------------------------------------------------------------
create or replace function public._maintenance_kit_snapshot(_kit uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare k public.maintenance_kits%rowtype;
begin
  select * into k from public.maintenance_kits where id = _kit;
  if not found then return; end if;
  insert into public.maintenance_kit_versions (company_id, kit_id, version, items, reason, changed_by)
  select k.company_id, k.id, k.version,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'family_code', i.family_code, 'article_id', i.article_id, 'reference', i.reference,
                     'designation', i.designation, 'quantity', i.quantity, 'unit', i.unit,
                     'kind', i.kind, 'confidence', i.confidence, 'origin', i.origin, 'note', i.note)
                   order by i.sort_order)
                    from public.maintenance_kit_items i where i.kit_id = k.id), '[]'::jsonb),
         _reason, auth.uid()
  on conflict (kit_id, version) do update set items = excluded.items, reason = excluded.reason,
       changed_at = now(), changed_by = excluded.changed_by;
end $$;

revoke all on function public._maintenance_kit_snapshot(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Génération des kits, par lots
--    Pour chaque modèle-année rattaché à un manuel : famille de moteur, puis un
--    kit par échéance. Un kit déjà édité par l'atelier n'est pas retouché.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_kit_generate(
  _company    uuid,
  _limit      integer default 20,
  _offset     integer default 0,
  _model_year text default null        -- un seul modèle-année (bouton « générer ce kit »)
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  my      record;
  svc     record;
  ekey    text;
  elabel  text;
  chash   text;
  kid     uuid;
  created int := 0;
  reused  int := 0;
  linked  int := 0;
  skipped int := 0;
  seen    int := 0;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  for my in
    select l.model_year_id as mid,
           coalesce(max(m.supermodel), max(m.model), l.model_year_id) as smodel,
           max(m.model_year) as myear
      from public.wsm_manual_catalog_links l
      join public.wsm_manuals m on m.id = l.manual_id
     where l.status = 'lie'
       and (_model_year is null or l.model_year_id = _model_year)
       and exists (select 1 from public.ducati_catalog_model_year_drawings d
                    where d.model_year_id = l.model_year_id)
     group by l.model_year_id
     order by l.model_year_id
     limit greatest(coalesce(_limit, 20), 1) offset greatest(coalesce(_offset, 0), 0)
  loop
    seen := seen + 1;
    ekey := public.maintenance_engine_family_key(my.mid);
    if ekey = 'inconnu' then
      skipped := skipped + 1;
      continue;
    end if;
    elabel := my.smodel;

    for svc in
      select p.service_code as sc,
             coalesce((select max(s.name) from public.wsm_services s
                        join public.wsm_manual_catalog_links l2 on l2.manual_id = s.manual_id
                       where l2.model_year_id = my.mid and l2.status = 'lie' and s.code = p.service_code),
                      p.service_code) as slabel,
             md5(string_agg(coalesce(p.family_code, '') || '#' || coalesce(array_to_string(p.references_, '+'), '')
                            || '#' || coalesce(p.quantity::text, ''), ',' order by p.family_code)) as hash,
             jsonb_agg(to_jsonb(p) order by p.family_code) as lines
        from public.maintenance_deduce_parts(my.mid, null) p
       where p.confidence <> 'non_applicable'
       group by p.service_code
    loop
      chash := svc.hash;

      select k.id into kid
        from public.maintenance_kits k
       where k.company_id = _company and k.engine_family_key = ekey
         and k.service_code = svc.sc and k.content_hash = chash and k.status = 'actif';

      if kid is null then
        -- un kit de cette famille/échéance existe-t-il déjà, édité par l'atelier ?
        select k.id into kid
          from public.maintenance_kits k
         where k.company_id = _company and k.engine_family_key = ekey
           and k.service_code = svc.sc and k.status = 'actif' and k.edited_at is not null
         order by k.version desc limit 1;
        if kid is not null then
          skipped := skipped + 1;               -- contenu respecté, on rattache seulement
        end if;
      else
        reused := reused + 1;
      end if;

      if kid is null then
        insert into public.maintenance_kits (company_id, engine_family_key, engine_family_label,
                                             service_code, service_label, content_hash)
        values (_company, ekey, elabel, svc.sc, svc.slabel, chash)
        returning id into kid;
        created := created + 1;

        insert into public.maintenance_kit_items
          (company_id, kit_id, family_code, article_id, reference, designation, quantity, unit,
           kind, confidence, origin, fluid_product, fluid_spec, sort_order)
        select _company, kid,
               x.family_code,
               coalesce(x.article_id, fa.article_id),
               x.article_ref,
               x.designation,
               coalesce(nullif(x.quantity, 0), 1),
               x.unit,
               x.kind,
               case when x.confidence = 'sur' and (x.kind = 'piece' or fa.article_id is not null)
                    then 'sur' else 'a_confirmer' end,
               'deduit',
               x.fluid_product, x.fluid_spec,
               row_number() over (order by x.family_code)
          from jsonb_to_recordset(svc.lines) as x(
                 service_code text, family_code text, family_label text, kind text, optional boolean,
                 references_ text[], quantity numeric, unit text, article_id uuid, article_ref text,
                 designation text, fluid_product text, fluid_spec text, confidence text, matched_labels text[])
          left join public.maintenance_fluid_articles fa
                 on fa.company_id = _company and fa.family_code = x.family_code;

        perform public._maintenance_kit_snapshot(kid, 'generation');
      end if;

      insert into public.maintenance_kit_model_years (kit_id, model_year_id)
      values (kid, my.mid)
      on conflict do nothing;
      if found then linked := linked + 1; end if;
      kid := null;
    end loop;
  end loop;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'maintenance_kit_generate', 'maintenance_kits', _company::text, 'screen', null,
          jsonb_build_object('model_years', seen, 'created', created, 'reused', reused,
                             'linked', linked, 'skipped', skipped, 'offset', _offset));

  return jsonb_build_object('model_years', seen, 'created', created, 'reused', reused,
                            'linked', linked, 'skipped', skipped,
                            'next_offset', greatest(coalesce(_offset, 0), 0) + seen,
                            'done', seen < greatest(coalesce(_limit, 20), 1));
end $$;

revoke all on function public.maintenance_kit_generate(uuid, integer, integer, text) from public, anon;
grant execute on function public.maintenance_kit_generate(uuid, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Lectures
-- ---------------------------------------------------------------------
create or replace function public.maintenance_kits_list(_company uuid, _search text default null)
returns table(
  id uuid, engine_family_key text, engine_family_label text, service_code text, service_label text,
  version integer, status text, edited_at timestamptz, edited_by_name text,
  items_count integer, to_confirm_count integer, model_years_count integer, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select k.id, k.engine_family_key, k.engine_family_label, k.service_code, k.service_label,
         k.version, k.status, k.edited_at,
         coalesce(nullif(btrim(p.full_name), ''), p.email),
         (select count(*)::int from public.maintenance_kit_items i where i.kit_id = k.id),
         (select count(*)::int from public.maintenance_kit_items i where i.kit_id = k.id and i.confidence = 'a_confirmer'),
         (select count(*)::int from public.maintenance_kit_model_years y where y.kit_id = k.id),
         k.updated_at
    from public.maintenance_kits k
    left join public.profiles p on p.id = k.edited_by
   where k.company_id = _company and k.status = 'actif'
     and (_search is null or btrim(_search) = ''
          or k.engine_family_label ilike '%' || btrim(_search) || '%'
          or k.service_label ilike '%' || btrim(_search) || '%')
   order by k.engine_family_label, k.service_label;
end $$;

revoke all on function public.maintenance_kits_list(uuid, text) from public, anon;
grant execute on function public.maintenance_kits_list(uuid, text) to authenticated;

create or replace function public.maintenance_kit_detail(_kit uuid)
returns table(
  id uuid, kit_id uuid, family_code text, article_id uuid, reference text, designation text,
  quantity numeric, unit text, kind text, confidence text, origin text,
  fluid_product text, fluid_spec text, note text, sort_order integer,
  mgmt_type text, bins text[], real_qty numeric, reserved_qty numeric, on_order_qty numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare cid uuid;
begin
  select k.company_id into cid from public.maintenance_kits k where k.id = _kit;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select i.id, i.kit_id, i.family_code, i.article_id,
         coalesce(i.reference, a.reference), i.designation,
         i.quantity, i.unit, i.kind, i.confidence, i.origin,
         i.fluid_product, i.fluid_spec, i.note, i.sort_order,
         a.mgmt_type::text,
         case when a.id is null then array[]::text[] else array(
           select distinct x.b from (
             select nullif(btrim(a.bin_location), '') as b
             union all select nullif(btrim(a.bin_location2), '')
             union all select nullif(btrim(ab.bin_location), '') from public.article_bins ab where ab.article_id = a.id
           ) x where x.b is not null order by x.b) end,
         st.real_qty, st.reserved_qty,
         case when a.id is null then 0 else public.article_on_order_for(a.id, null, null) end
    from public.maintenance_kit_items i
    left join public.articles a on a.id = i.article_id
    left join lateral public.article_stock(i.article_id) st on a.id is not null
   where i.kit_id = _kit
   order by i.sort_order, i.designation;
end $$;

revoke all on function public.maintenance_kit_detail(uuid) from public, anon;
grant execute on function public.maintenance_kit_detail(uuid) to authenticated;

-- Le kit actif d'un modèle-année pour une échéance (null si aucun).
create or replace function public.maintenance_kit_for_model_year(
  _company uuid, _model_year_id text, _service_code text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select k.id
    from public.maintenance_kits k
    join public.maintenance_kit_model_years y on y.kit_id = k.id
   where k.company_id = _company and public.is_member(k.company_id)
     and y.model_year_id = _model_year_id
     and k.service_code = _service_code
     and k.status = 'actif'
   order by k.edited_at desc nulls last, k.version desc
   limit 1;
$$;

revoke all on function public.maintenance_kit_for_model_year(uuid, text, text) from public, anon;
grant execute on function public.maintenance_kit_for_model_year(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Édition par l'atelier (ajout / quantité / retrait), versionnée et tracée
-- ---------------------------------------------------------------------
create or replace function public.maintenance_kit_item_save(
  _kit uuid, _item uuid, _article uuid, _quantity numeric,
  _designation text default null, _note text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k   public.maintenance_kits%rowtype;
  a   public.articles%rowtype;
  rid uuid;
  old public.maintenance_kit_items%rowtype;
begin
  select * into k from public.maintenance_kits where id = _kit;
  if not found then raise exception 'Kit introuvable.' using errcode = 'P0002'; end if;
  if not public.is_member(k.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if k.status <> 'actif' then
    raise exception 'Ce kit est archivé.' using errcode = 'P0001';
  end if;
  if coalesce(_quantity, 0) <= 0 then
    raise exception 'La quantité doit être supérieure à zéro.' using errcode = 'P0001';
  end if;

  if _item is null then
    if _article is null then
      raise exception 'Choisissez une pièce.' using errcode = 'P0001';
    end if;
    select * into a from public.articles where id = _article and company_id = k.company_id;
    if not found then raise exception 'Pièce introuvable.' using errcode = 'P0002'; end if;
    if a.mgmt_type::text not in ('A', 'M', 'N') then
      raise exception 'Seules les pièces et les composants de kit entrent dans un kit d''entretien.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.maintenance_kit_items i where i.kit_id = _kit and i.article_id = _article) then
      raise exception 'Cette pièce est déjà dans le kit.' using errcode = 'P0001';
    end if;
    insert into public.maintenance_kit_items
      (company_id, kit_id, article_id, reference, designation, quantity, kind, confidence, origin, note, sort_order)
    values (k.company_id, _kit, _article, a.reference,
            coalesce(nullif(btrim(_designation), ''), a.designation, a.reference),
            _quantity, 'piece', 'sur', 'ajoute', nullif(btrim(coalesce(_note, '')), ''),
            coalesce((select max(i.sort_order) + 1 from public.maintenance_kit_items i where i.kit_id = _kit), 1))
    returning id into rid;
  else
    select * into old from public.maintenance_kit_items where id = _item and kit_id = _kit;
    if not found then raise exception 'Ligne de kit introuvable.' using errcode = 'P0002'; end if;
    update public.maintenance_kit_items
       set quantity = _quantity,
           article_id = coalesce(_article, article_id),
           reference = case when _article is null then reference
                            else (select reference from public.articles where id = _article) end,
           designation = coalesce(nullif(btrim(_designation), ''), designation),
           note = coalesce(nullif(btrim(coalesce(_note, '')), ''), note),
           confidence = case when coalesce(_article, article_id) is null then 'a_confirmer' else 'sur' end
     where id = _item
     returning id into rid;
  end if;

  update public.maintenance_kits
     set version = version + 1, edited_at = now(), edited_by = auth.uid(), updated_at = now()
   where id = _kit;
  perform public._maintenance_kit_snapshot(_kit, case when _item is null then 'ajout' else 'modification' end);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (k.company_id, auth.uid(), case when _item is null then 'maintenance_kit_item_add' else 'maintenance_kit_item_update' end,
          'maintenance_kits', _kit::text, 'screen',
          case when _item is null then null else to_jsonb(old) end,
          jsonb_build_object('item_id', rid, 'article_id', _article, 'quantity', _quantity));
  return rid;
end $$;

revoke all on function public.maintenance_kit_item_save(uuid, uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.maintenance_kit_item_save(uuid, uuid, uuid, numeric, text, text) to authenticated;

create or replace function public.maintenance_kit_item_delete(_item uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare old public.maintenance_kit_items%rowtype; k public.maintenance_kits%rowtype;
begin
  select * into old from public.maintenance_kit_items where id = _item;
  if not found then return; end if;
  select * into k from public.maintenance_kits where id = old.kit_id;
  if not public.is_member(k.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if k.status <> 'actif' then
    raise exception 'Ce kit est archivé.' using errcode = 'P0001';
  end if;
  delete from public.maintenance_kit_items where id = _item;
  update public.maintenance_kits
     set version = version + 1, edited_at = now(), edited_by = auth.uid(), updated_at = now()
   where id = k.id;
  perform public._maintenance_kit_snapshot(k.id, 'retrait');
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (k.company_id, auth.uid(), 'maintenance_kit_item_delete', 'maintenance_kits', k.id::text, 'screen',
          to_jsonb(old), null);
end $$;

revoke all on function public.maintenance_kit_item_delete(uuid) from public, anon;
grant execute on function public.maintenance_kit_item_delete(uuid) to authenticated;

-- L'article du DMS qui joue le rôle d'un consommable, une fois pour toutes.
create or replace function public.maintenance_fluid_article_set(
  _company uuid, _family text, _article uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.maintenance_part_families f where f.code = _family and f.kind = 'consommable') then
    raise exception 'Famille de consommable inconnue : %', coalesce(_family, '—') using errcode = 'P0001';
  end if;
  if _article is null then
    delete from public.maintenance_fluid_articles where company_id = _company and family_code = _family;
  else
    if not exists (select 1 from public.articles a where a.id = _article and a.company_id = _company) then
      raise exception 'Article introuvable.' using errcode = 'P0002';
    end if;
    insert into public.maintenance_fluid_articles (company_id, family_code, article_id, updated_by)
    values (_company, _family, _article, auth.uid())
    on conflict (company_id, family_code)
      do update set article_id = excluded.article_id, updated_at = now(), updated_by = excluded.updated_by;
    -- les lignes de kit non encore corrigées par l'atelier suivent le réglage
    update public.maintenance_kit_items i
       set article_id = _article, confidence = 'sur'
      from public.maintenance_kits k
     where k.id = i.kit_id and k.company_id = _company
       and i.family_code = _family and i.origin = 'deduit' and i.article_id is null;
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'maintenance_fluid_article_set', 'maintenance_fluid_articles', _family, 'screen',
          null, jsonb_build_object('family_code', _family, 'article_id', _article));
end $$;

revoke all on function public.maintenance_fluid_article_set(uuid, text, uuid) from public, anon;
grant execute on function public.maintenance_fluid_article_set(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
