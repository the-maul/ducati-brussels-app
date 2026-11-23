-- =====================================================================
-- M8 — ATE014 (23/11/2026) : CORRIGER LES KITS PAR PROPOSITIONS VALIDEES.
--
-- Les corrections des kits ne s'appliquent plus d'office. Chaque changement est une proposition,
-- avec sa source (manuel + module, ou dessin + repere). L'atelier accepte ou refuse par groupe de
-- motos identiques ; seules les lignes acceptees sont appliquees, par lots.
--
-- Garanties :
--  - reserve a un administrateur ou au chef d'atelier (jamais la cle de service seule) ;
--  - photo complete du kit (lignes + motos rattachees) avant chaque changement, retour arriere par lot ;
--  - aucun kit n'est supprime ni vide. Un kit cree par separation est archive au retour arriere ;
--  - une ligne liee a une reservation ou a un prelevement n'est ni retiree ni changee de reference ;
--  - une proposition devenue obsolete (le kit a change depuis) n'est pas appliquee.
--
-- Cette migration ne change aucun kit. Rejouable.
-- =====================================================================

create table if not exists public.maintenance_kit_proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  batch_code text not null,
  group_code text not null,
  risk_rank integer not null default 9,
  -- nul seulement pour une separation qui cree le kit d'une moto qui n'en a pas pour cet entretien
  kit_id uuid references public.maintenance_kits(id) on delete restrict,
  model_year_id text references public.ducati_catalog_model_years(id) on delete set null,
  model_year_ids text[] not null default '{}',
  service_code text not null,
  kind text not null check (kind in ('ajout', 'retrait', 'quantite', 'reference', 'separation', 'a_completer')),
  family_code text references public.maintenance_part_families(code) on delete set null,
  kit_item_id uuid,
  current_value jsonb,
  proposed_value jsonb,
  source_type text not null check (source_type in ('manuel', 'dessin', 'plan', 'forfait_g8', 'aucune')),
  source_manual_id text,
  source_page text,
  source_drawing_code text,
  source_position text,
  source_label text not null check (btrim(source_label) <> ''),
  confidence text not null check (confidence in ('haute', 'moyenne', 'basse')),
  status text not null default 'a_valider' check (status in ('a_valider', 'accepte', 'refuse')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  applied_run uuid,
  applied_kit_id uuid references public.maintenance_kits(id) on delete set null,
  apply_result text,
  created_at timestamptz not null default now(),
  constraint maintenance_kit_proposals_decided check (status = 'a_valider' or decided_at is not null),
  constraint maintenance_kit_proposals_applied check (applied_at is null or status = 'accepte'),
  constraint maintenance_kit_proposals_kit check (kit_id is not null or kind = 'separation')
);
create index if not exists maintenance_kit_proposals_batch_idx
  on public.maintenance_kit_proposals (company_id, batch_code, status, risk_rank);
create index if not exists maintenance_kit_proposals_group_idx
  on public.maintenance_kit_proposals (company_id, group_code);
create index if not exists maintenance_kit_proposals_kit_idx on public.maintenance_kit_proposals (kit_id);

create table if not exists public.maintenance_kit_proposal_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  batch_code text not null,
  run_kind text not null default 'application' check (run_kind in ('application', 'verrous')),
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz not null default now(),
  result jsonb,
  reverted_by uuid references auth.users(id) on delete set null,
  reverted_at timestamptz
);
create index if not exists maintenance_kit_proposal_runs_idx on public.maintenance_kit_proposal_runs (company_id, applied_at desc);

create table if not exists public.maintenance_kit_proposal_backups (
  run_id uuid not null references public.maintenance_kit_proposal_runs(id) on delete restrict,
  kit_id uuid not null references public.maintenance_kits(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  created_by_run boolean not null default false,
  kit jsonb not null,
  items jsonb not null,
  model_year_ids text[] not null default '{}',
  primary key (run_id, kit_id)
);
create index if not exists maintenance_kit_proposal_backups_company_idx on public.maintenance_kit_proposal_backups (company_id);

alter table public.maintenance_kit_proposals enable row level security;
alter table public.maintenance_kit_proposal_runs enable row level security;
alter table public.maintenance_kit_proposal_backups enable row level security;

-- Lecture pour les membres de la societe ; aucune ecriture directe (tout passe par les fonctions).
drop policy if exists mkp_read on public.maintenance_kit_proposals;
create policy mkp_read on public.maintenance_kit_proposals for select
  using (coalesce(company_id in (select public.rls_member_companies()), false));
drop policy if exists mkpr_read on public.maintenance_kit_proposal_runs;
create policy mkpr_read on public.maintenance_kit_proposal_runs for select
  using (coalesce(company_id in (select public.rls_member_companies()), false));
drop policy if exists mkpb_read on public.maintenance_kit_proposal_backups;
create policy mkpb_read on public.maintenance_kit_proposal_backups for select
  using (coalesce(company_id in (select public.rls_member_companies()), false));

revoke all on public.maintenance_kit_proposals, public.maintenance_kit_proposal_runs, public.maintenance_kit_proposal_backups from anon;
revoke insert, update, delete, truncate on public.maintenance_kit_proposals, public.maintenance_kit_proposal_runs, public.maintenance_kit_proposal_backups from authenticated;
grant select on public.maintenance_kit_proposals, public.maintenance_kit_proposal_runs, public.maintenance_kit_proposal_backups to authenticated;

-- ---------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------
create or replace function public._maintenance_kit_proposal_gate(_company uuid)
returns void
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or _company is null
     or not (public.is_admin(_company) or public.has_role(_company, 'chef_atelier'::public.app_role)) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Photo d'un kit avant changement
-- ---------------------------------------------------------------------
create or replace function public._maintenance_kit_proposal_backup(_run uuid, _kit uuid, _created boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare k public.maintenance_kits%rowtype;
begin
  if exists (select 1 from public.maintenance_kit_proposal_backups b where b.run_id = _run and b.kit_id = _kit) then
    return;
  end if;
  select * into k from public.maintenance_kits where id = _kit;
  if not found then return; end if;
  -- l'historique garde l'etat courant s'il n'a pas encore sa version
  if not _created and not exists (select 1 from public.maintenance_kit_versions v where v.kit_id = _kit and v.version = k.version) then
    perform public._maintenance_kit_snapshot(_kit, 'avant propositions');
  end if;
  insert into public.maintenance_kit_proposal_backups (run_id, kit_id, company_id, created_by_run, kit, items, model_year_ids)
  values (_run, _kit, k.company_id, _created, to_jsonb(k),
          coalesce((select jsonb_agg(to_jsonb(i)) from public.maintenance_kit_items i where i.kit_id = _kit), '[]'::jsonb),
          array(select y.model_year_id from public.maintenance_kit_model_years y where y.kit_id = _kit));
end $$;

-- ---------------------------------------------------------------------
-- Application d'une ligne sur un kit existant
-- ---------------------------------------------------------------------
create or replace function public._maintenance_kit_proposal_line(_p public.maintenance_kit_proposals)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  it public.maintenance_kit_items%rowtype;
  v jsonb := coalesce(_p.proposed_value, '{}'::jsonb);
  cv jsonb := coalesce(_p.current_value, '{}'::jsonb);
  linked boolean := false;
  trace jsonb := jsonb_build_object('proposition', _p.id);
begin
  if _p.kit_item_id is not null then
    select * into it from public.maintenance_kit_items i
     where i.id = _p.kit_item_id and i.kit_id = _p.kit_id for update;
    if not found then return 'conflit'; end if;
    if cv ? 'reference' and upper(btrim(coalesce(it.reference, ''))) <> upper(btrim(coalesce(cv ->> 'reference', ''))) then
      return 'conflit';
    end if;
    if cv ? 'quantity' and it.quantity is distinct from (cv ->> 'quantity')::numeric then
      return 'conflit';
    end if;
    linked := exists (select 1 from public.stock_reservations r where r.kit_item_id = it.id)
           or exists (select 1 from public.picking_list_items l where l.kit_item_id = it.id);
  end if;

  if _p.kind = 'quantite' then
    if _p.kit_item_id is null or coalesce((v ->> 'quantity')::numeric, 0) <= 0 then return 'conflit'; end if;
    update public.maintenance_kit_items
       set quantity = (v ->> 'quantity')::numeric,
           provenance = coalesce(provenance, '{}'::jsonb) || trace || jsonb_build_object('ancienne_quantite', it.quantity)
     where id = it.id;
    return 'applique';

  elsif _p.kind = 'reference' then
    if _p.kit_item_id is null or nullif(btrim(v ->> 'reference'), '') is null then return 'conflit'; end if;
    if linked then return 'bloque_lien'; end if;
    update public.maintenance_kit_items
       set reference = v ->> 'reference',
           article_id = nullif(v ->> 'article_id', '')::uuid,
           designation = coalesce(v ->> 'designation', designation),
           quantity = coalesce(nullif(v ->> 'quantity', '')::numeric, quantity),
           catalog_refs = case when jsonb_typeof(v -> 'catalog_refs') = 'array'
                               then array(select jsonb_array_elements_text(v -> 'catalog_refs')) else catalog_refs end,
           confidence = coalesce(v ->> 'confidence', confidence),
           provenance = coalesce(provenance, '{}'::jsonb) || trace
                        || jsonb_build_object('ancienne_reference', it.reference, 'reference', 'catalogue')
     where id = it.id;
    return 'applique';

  elsif _p.kind = 'retrait' then
    if _p.kit_item_id is null then return 'conflit'; end if;
    if linked then return 'bloque_lien'; end if;
    -- jamais de kit vide : la derniere vraie ligne reste
    if not exists (select 1 from public.maintenance_kit_items o
                    where o.kit_id = _p.kit_id and o.id <> it.id and o.kind <> 'forfait') then
      return 'bloque_vide';
    end if;
    delete from public.maintenance_kit_items where id = it.id;
    return 'applique';

  elsif _p.kind = 'a_completer' then
    if _p.kit_item_id is not null then
      if linked then return 'bloque_lien'; end if;
      update public.maintenance_kit_items
         set provenance = coalesce(provenance, '{}'::jsonb) || trace
                          || jsonb_build_object('reference', null, 'ancienne_reference', it.reference),
             article_id = null, reference = null, catalog_refs = null, confidence = 'absent',
             note = 'Référence à compléter : aucune source fiable pour cette moto.'
       where id = it.id;
      return 'applique';
    end if;
    if v ? 'family_code' then
      if exists (select 1 from public.maintenance_kit_items o where o.kit_id = _p.kit_id and o.family_code = v ->> 'family_code') then
        return 'deja_present';
      end if;
    else
      -- plus aucune source : le contenu reste, le kit est signale
      update public.maintenance_kits
         set note = 'À revoir : aucune source fiable pour cet entretien sur au moins une moto.', updated_at = now()
       where id = _p.kit_id;
      return 'applique';
    end if;

  elsif _p.kind = 'ajout' then
    if exists (select 1 from public.maintenance_kit_items o
                where o.kit_id = _p.kit_id and o.family_code = v ->> 'family_code'
                  and (v ->> 'kind' = 'consommable'
                       or upper(btrim(coalesce(o.reference, ''))) = upper(btrim(coalesce(v ->> 'reference', ''))))) then
      return 'deja_present';
    end if;
  else
    return 'conflit';
  end if;

  -- ajout, ou ligne « a completer » nouvelle
  insert into public.maintenance_kit_items
    (company_id, kit_id, family_code, article_id, reference, catalog_refs, designation, quantity, unit,
     kind, confidence, origin, fluid_product, fluid_spec, note, provenance, sort_order)
  values
    (_p.company_id, _p.kit_id, v ->> 'family_code', nullif(v ->> 'article_id', '')::uuid, nullif(v ->> 'reference', ''),
     case when jsonb_typeof(v -> 'catalog_refs') = 'array' then array(select jsonb_array_elements_text(v -> 'catalog_refs')) end,
     coalesce(v ->> 'designation', v ->> 'family_code'), coalesce(nullif(v ->> 'quantity', '')::numeric, 1), v ->> 'unit',
     coalesce(v ->> 'kind', 'piece'),
     case when _p.kind = 'a_completer' then 'absent' else coalesce(v ->> 'confidence', 'a_confirmer') end,
     'deduit', v ->> 'fluid_product', v ->> 'fluid_spec',
     case when _p.kind = 'a_completer' then 'Référence à compléter : aucune source fiable pour cette moto.' end,
     trace || jsonb_build_object('besoin', _p.source_type),
     coalesce((select max(o.sort_order) + 1 from public.maintenance_kit_items o where o.kit_id = _p.kit_id), 1));
  return 'applique';
end $$;

-- ---------------------------------------------------------------------
-- Separation : un groupe de motos quitte un kit partage pour son propre kit
-- ---------------------------------------------------------------------
create or replace function public._maintenance_kit_proposal_split(_p public.maintenance_kit_proposals, _run uuid, _actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb := coalesce(_p.proposed_value, '{}'::jsonb);
  src public.maintenance_kits%rowtype;
  mys text[] := _p.model_year_ids;
  kid uuid;
begin
  if cardinality(mys) = 0 or jsonb_array_length(coalesce(v -> 'items', '[]'::jsonb)) = 0 then
    return null;
  end if;
  if _p.kit_id is not null then
    select * into src from public.maintenance_kits where id = _p.kit_id for update;
    if not found or src.status <> 'actif' then return null; end if;
    mys := array(select y.model_year_id from public.maintenance_kit_model_years y
                  where y.kit_id = _p.kit_id and y.model_year_id = any(mys));
    if cardinality(mys) = 0 then return null; end if;
    -- le kit d'origine garde toujours au moins une moto
    if not exists (select 1 from public.maintenance_kit_model_years y
                    where y.kit_id = _p.kit_id and not (y.model_year_id = any(mys))) then
      return null;
    end if;
    perform public._maintenance_kit_proposal_backup(_run, _p.kit_id, false);
  end if;

  insert into public.maintenance_kits
    (company_id, engine_family_key, engine_family_label, service_code, service_label, service_kind, source,
     service_km, content_hash, edited_at, edited_by, note)
  values
    (_p.company_id,
     coalesce(src.engine_family_key, public.maintenance_engine_family_key(mys[1])),
     coalesce(v ->> 'engine_family_label', src.engine_family_label, mys[1]),
     coalesce(v ->> 'service_code', src.service_code, _p.service_code),
     coalesce(v ->> 'service_label', src.service_label, _p.service_code),
     coalesce(v ->> 'service_kind', src.service_kind),
     coalesce(v ->> 'source', src.source),
     coalesce(nullif(v ->> 'service_km', '')::int, src.service_km),
     md5('proposition|' || _p.id::text),
     now(), _actor,
     'Créé par la proposition ' || _p.id::text)
  returning id into kid;

  insert into public.maintenance_kit_items
    (company_id, kit_id, family_code, article_id, reference, catalog_refs, designation, quantity, unit,
     kind, confidence, origin, fluid_product, fluid_spec, note, provenance, sort_order)
  select _p.company_id, kid, x.family_code, x.article_id, x.reference, x.catalog_refs,
         coalesce(x.designation, x.family_code), coalesce(nullif(x.quantity, 0), 1), x.unit,
         coalesce(x.kind, 'piece'), coalesce(x.confidence, 'a_confirmer'), 'deduit',
         x.fluid_product, x.fluid_spec, x.note,
         coalesce(x.provenance, '{}'::jsonb) || jsonb_build_object('proposition', _p.id),
         row_number() over ()
    from jsonb_to_recordset(v -> 'items') as x(
           family_code text, article_id uuid, reference text, catalog_refs text[], designation text, quantity numeric,
           unit text, kind text, confidence text, fluid_product text, fluid_spec text, note text, provenance jsonb);

  insert into public.maintenance_kit_model_years (kit_id, model_year_id)
  select kid, m from unnest(mys) m on conflict do nothing;

  if _p.kit_id is not null then
    -- les lignes de service G8 suivent le kit d'origine
    insert into public.maintenance_kit_items
      (company_id, kit_id, family_code, article_id, reference, catalog_refs, designation, quantity, unit,
       kind, confidence, origin, fluid_product, fluid_spec, note, provenance, sort_order)
    select i.company_id, kid, i.family_code, i.article_id, i.reference, i.catalog_refs, i.designation, i.quantity, i.unit,
           i.kind, i.confidence, i.origin, i.fluid_product, i.fluid_spec, i.note, i.provenance, 1000 + i.sort_order
      from public.maintenance_kit_items i where i.kit_id = _p.kit_id and i.kind = 'forfait';
    delete from public.maintenance_kit_model_years y where y.kit_id = _p.kit_id and y.model_year_id = any(mys);
  else
    perform public._maintenance_kit_complete(kid, false);
  end if;

  perform public._maintenance_kit_proposal_backup(_run, kid, true);
  perform public._maintenance_kit_snapshot(kid, 'separation : proposition validee');
  return kid;
end $$;

-- ---------------------------------------------------------------------
-- Application par lots
-- ---------------------------------------------------------------------
create or replace function public._maintenance_kit_proposals_apply_core(_company uuid, _batch text, _groups text[], _max_kits integer, _actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run uuid;
  ids uuid[];
  p public.maintenance_kit_proposals%rowtype;
  res text;
  kid uuid;
  touched uuid[] := array[]::uuid[];
  counts jsonb := '{}'::jsonb;
  lim int := least(greatest(coalesce(_max_kits, 25), 1), 200);
  out jsonb;
begin
  insert into public.maintenance_kit_proposal_runs (company_id, batch_code, applied_by)
  values (_company, _batch, _actor) returning id into run;

  -- un lot = un nombre de kits, toutes leurs lignes acceptees ensemble
  select array_agg(x.id) into ids from (
    select q.id, dense_rank() over (order by q.top_rank, q.kit_key) as rk
      from (select c.id, coalesce(c.kit_id::text, c.id::text) as kit_key,
                   min(c.risk_rank) over (partition by coalesce(c.kit_id::text, c.id::text)) as top_rank
              from public.maintenance_kit_proposals c
             where c.company_id = _company and c.batch_code = _batch and c.status = 'accepte' and c.applied_at is null
               and (_groups is null or c.group_code = any(_groups))) q) x
   where x.rk <= lim;

  -- les separations d'abord : elles partent du contenu propose, pas du kit deja modifie ;
  -- les retraits en dernier : un kit dont une piece est remplacee n'est jamais vide en chemin
  for p in
    select * from public.maintenance_kit_proposals
     where id = any(coalesce(ids, array[]::uuid[]))
     order by (kind = 'separation') desc, kit_id,
              case kind when 'ajout' then 1 when 'reference' then 2 when 'quantite' then 3 when 'a_completer' then 4 else 5 end,
              risk_rank, id
     for update
  loop
    if p.kind = 'separation' then
      kid := public._maintenance_kit_proposal_split(p, run, _actor);
      res := case when kid is null then 'conflit' else 'applique' end;
      if kid is not null then
        update public.maintenance_kit_proposals
           set applied_kit_id = kid where id = p.id;
      end if;
    else
      perform public._maintenance_kit_proposal_backup(run, p.kit_id, false);
      res := public._maintenance_kit_proposal_line(p);
      if res = 'applique' then touched := touched || p.kit_id; end if;
    end if;
    counts := jsonb_set(counts, array[res], to_jsonb(coalesce((counts ->> res)::int, 0) + 1));
    update public.maintenance_kit_proposals
       set apply_result = res,
           applied_at = case when res in ('applique', 'deja_present') then now() end,
           applied_by = case when res in ('applique', 'deja_present') then _actor end,
           applied_run = case when res in ('applique', 'deja_present') then run end
     where id = p.id;
  end loop;

  -- nouvelle version de chaque kit modifie : le kit a desormais un vrai auteur
  for kid in select distinct t from unnest(touched) t loop
    update public.maintenance_kits
       set version = version + 1, edited_at = now(), edited_by = _actor, updated_at = now(),
           content_hash = md5('proposition|' || id::text || '|' || (version + 1)::text)
     where id = kid;
    perform public._maintenance_kit_snapshot(kid, 'propositions validees (' || _batch || ')');
  end loop;

  out := jsonb_build_object('run', run, 'proposals', coalesce(cardinality(ids), 0), 'kits_changed',
                            (select count(distinct t) from unnest(touched) t), 'results', counts);
  update public.maintenance_kit_proposal_runs set result = out where id = run;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, _actor, 'maintenance_kit_proposals_apply', 'maintenance_kit_proposal_runs', run::text, 'screen', null, out);
  return out;
end $$;

create or replace function public.maintenance_kit_proposals_apply(_company uuid, _batch text, _groups text[] default null, _max_kits integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._maintenance_kit_proposal_gate(_company);
  return public._maintenance_kit_proposals_apply_core(_company, _batch, _groups, _max_kits, auth.uid());
end $$;

-- ---------------------------------------------------------------------
-- Decision humaine, par groupe ou par ligne
-- ---------------------------------------------------------------------
create or replace function public.maintenance_kit_proposals_decide(_company uuid, _batch text, _status text, _groups text[] default null, _ids uuid[] default null, _note text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  perform public._maintenance_kit_proposal_gate(_company);
  if _status not in ('accepte', 'refuse', 'a_valider') then
    raise exception 'Décision inconnue.' using errcode = '22023';
  end if;
  if _groups is null and _ids is null then
    raise exception 'Indiquer un groupe ou des lignes.' using errcode = '22023';
  end if;
  update public.maintenance_kit_proposals p
     set status = _status,
         decided_by = case when _status = 'a_valider' then null else auth.uid() end,
         decided_at = case when _status = 'a_valider' then null else now() end,
         decision_note = _note
   where p.company_id = _company and p.batch_code = _batch and p.applied_at is null
     and (_groups is null or p.group_code = any(_groups))
     and (_ids is null or p.id = any(_ids));
  get diagnostics n = row_count;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'maintenance_kit_proposals_decide', 'maintenance_kit_proposals', _batch, 'screen', null,
          jsonb_build_object('status', _status, 'groups', _groups, 'ids', _ids, 'count', n, 'note', _note));
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Retour arriere d'un lot
-- ---------------------------------------------------------------------
create or replace function public._maintenance_kit_proposals_revert_core(_company uuid, _run uuid, _actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.maintenance_kit_proposal_runs%rowtype;
  b record;
  kept int := 0;
  restored int := 0;
  archived int := 0;
  out jsonb;
begin
  select * into r from public.maintenance_kit_proposal_runs where id = _run and company_id = _company for update;
  if not found then raise exception 'Lot introuvable.' using errcode = 'P0002'; end if;
  if r.reverted_at is not null then raise exception 'Lot déjà annulé.' using errcode = '22023'; end if;
  if exists (select 1 from public.maintenance_kit_proposal_runs n
              where n.company_id = _company and n.applied_at > r.applied_at and n.reverted_at is null
                and exists (select 1 from public.maintenance_kit_proposal_backups x
                             join public.maintenance_kit_proposal_backups y on y.kit_id = x.kit_id
                            where x.run_id = n.id and y.run_id = _run)) then
    raise exception 'Annuler d''abord les lots plus récents sur ces kits.' using errcode = '22023';
  end if;

  -- les kits crees d'abord : leurs motos retournent au kit d'origine juste apres
  for b in select * from public.maintenance_kit_proposal_backups where run_id = _run order by created_by_run desc loop
    if b.created_by_run then
      delete from public.maintenance_kit_model_years y where y.kit_id = b.kit_id;
      update public.maintenance_kits
         set status = 'archive', version = version + 1, updated_at = now(), note = 'Archivé : retour arrière des propositions.'
       where id = b.kit_id;
      perform public._maintenance_kit_snapshot(b.kit_id, 'retour arriere des propositions');
      archived := archived + 1;
      continue;
    end if;

    -- lignes ajoutees depuis la photo : retirees, sauf si l'atelier s'en sert deja
    delete from public.maintenance_kit_items i
     where i.kit_id = b.kit_id
       and not exists (select 1 from jsonb_array_elements(b.items) e where (e ->> 'id')::uuid = i.id)
       and not exists (select 1 from public.stock_reservations s where s.kit_item_id = i.id)
       and not exists (select 1 from public.picking_list_items l where l.kit_item_id = i.id);
    kept := kept + (select count(*) from public.maintenance_kit_items i
                     where i.kit_id = b.kit_id
                       and not exists (select 1 from jsonb_array_elements(b.items) e where (e ->> 'id')::uuid = i.id));

    insert into public.maintenance_kit_items
      (id, company_id, kit_id, family_code, article_id, reference, catalog_refs, designation, quantity, unit,
       kind, confidence, origin, fluid_product, fluid_spec, note, provenance, sort_order, created_at)
    select x.id, x.company_id, x.kit_id, x.family_code, x.article_id, x.reference, x.catalog_refs, x.designation, x.quantity, x.unit,
           x.kind, x.confidence, x.origin, x.fluid_product, x.fluid_spec, x.note, x.provenance, x.sort_order, x.created_at
      from jsonb_populate_recordset(null::public.maintenance_kit_items, b.items) x
    on conflict (id) do update
       set family_code = excluded.family_code, article_id = excluded.article_id, reference = excluded.reference,
           catalog_refs = excluded.catalog_refs, designation = excluded.designation, quantity = excluded.quantity,
           unit = excluded.unit, kind = excluded.kind, confidence = excluded.confidence, origin = excluded.origin,
           fluid_product = excluded.fluid_product, fluid_spec = excluded.fluid_spec, note = excluded.note,
           provenance = excluded.provenance, sort_order = excluded.sort_order;

    insert into public.maintenance_kit_model_years (kit_id, model_year_id)
    select b.kit_id, m from unnest(b.model_year_ids) m on conflict do nothing;

    update public.maintenance_kits
       set version = version + 1, updated_at = now(),
           edited_at = nullif(b.kit ->> 'edited_at', '')::timestamptz,
           edited_by = nullif(b.kit ->> 'edited_by', '')::uuid,
           note = b.kit ->> 'note',
           content_hash = b.kit ->> 'content_hash'
     where id = b.kit_id;
    perform public._maintenance_kit_snapshot(b.kit_id, 'retour arriere des propositions');
    restored := restored + 1;
  end loop;

  update public.maintenance_kit_proposals
     set applied_at = null, applied_by = null, applied_run = null, applied_kit_id = null, apply_result = 'annule'
   where applied_run = _run;
  update public.maintenance_kit_proposal_runs set reverted_at = now(), reverted_by = _actor where id = _run;

  out := jsonb_build_object('run', _run, 'kits_restored', restored, 'kits_archived', archived, 'lines_kept_in_use', kept);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, _actor, 'maintenance_kit_proposals_revert', 'maintenance_kit_proposal_runs', _run::text, 'screen', r.result, out);
  return out;
end $$;

create or replace function public.maintenance_kit_proposals_revert(_company uuid, _run uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._maintenance_kit_proposal_gate(_company);
  return public._maintenance_kit_proposals_revert_core(_company, _run, auth.uid());
end $$;

-- ---------------------------------------------------------------------
-- Faux verrou : un kit « corrige par l'atelier » sans auteur humain
-- ---------------------------------------------------------------------
-- Par defaut, compte seulement. Ne se lance qu'apres la confirmation de l'atelier : une fois le
-- verrou leve, maintenance_kit_generate peut de nouveau recalculer ces kits.
create or replace function public._maintenance_kit_release_script_locks_core(_company uuid, _apply boolean, _actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run uuid;
  k record;
  n int := 0;
  total int;
begin
  select count(*) into total from public.maintenance_kits
   where company_id = _company and status = 'actif' and edited_at is not null and edited_by is null;
  if not coalesce(_apply, false) then
    return jsonb_build_object('applied', false, 'kits', total);
  end if;
  insert into public.maintenance_kit_proposal_runs (company_id, batch_code, run_kind, applied_by)
  values (_company, 'verrous', 'verrous', _actor) returning id into run;
  for k in select id from public.maintenance_kits
            where company_id = _company and status = 'actif' and edited_at is not null and edited_by is null
            for update
  loop
    perform public._maintenance_kit_proposal_backup(run, k.id, false);
    update public.maintenance_kits set edited_at = null, updated_at = now() where id = k.id;
    n := n + 1;
  end loop;
  update public.maintenance_kit_proposal_runs set result = jsonb_build_object('kits', n) where id = run;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, _actor, 'maintenance_kit_release_script_locks', 'maintenance_kit_proposal_runs', run::text, 'screen', null,
          jsonb_build_object('kits', n));
  return jsonb_build_object('applied', true, 'run', run, 'kits', n);
end $$;

create or replace function public.maintenance_kit_release_script_locks(_company uuid, _apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._maintenance_kit_proposal_gate(_company);
  return public._maintenance_kit_release_script_locks_core(_company, _apply, auth.uid());
end $$;

revoke all on function public._maintenance_kit_proposal_gate(uuid) from public, anon, authenticated;
revoke all on function public._maintenance_kit_proposal_backup(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public._maintenance_kit_proposal_line(public.maintenance_kit_proposals) from public, anon, authenticated;
revoke all on function public._maintenance_kit_proposal_split(public.maintenance_kit_proposals, uuid, uuid) from public, anon, authenticated;
revoke all on function public._maintenance_kit_proposals_apply_core(uuid, text, text[], integer, uuid) from public, anon, authenticated;
revoke all on function public._maintenance_kit_proposals_revert_core(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._maintenance_kit_release_script_locks_core(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.maintenance_kit_proposals_apply(uuid, text, text[], integer) from public, anon;
revoke all on function public.maintenance_kit_proposals_decide(uuid, text, text, text[], uuid[], text) from public, anon;
revoke all on function public.maintenance_kit_proposals_revert(uuid, uuid) from public, anon;
revoke all on function public.maintenance_kit_release_script_locks(uuid, boolean) from public, anon;
grant execute on function public.maintenance_kit_proposals_apply(uuid, text, text[], integer) to authenticated;
grant execute on function public.maintenance_kit_proposals_decide(uuid, text, text, text[], uuid[], text) to authenticated;
grant execute on function public.maintenance_kit_proposals_revert(uuid, uuid) to authenticated;
grant execute on function public.maintenance_kit_release_script_locks(uuid, boolean) to authenticated;
