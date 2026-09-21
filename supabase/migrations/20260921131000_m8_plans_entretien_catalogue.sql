-- =====================================================================
-- Mission 07, carte 1 — rattachement des plans d'entretien au catalogue Ducati (mission 06)
-- et à la fiche moto (M03).
--
--   * maintenance_plan_catalog_links : plan ↔ modèle-année du catalogue.
--       status : 'lie' (rattaché), 'a_valider' (proposé, à confirmer), 'rejete' (détaché : la
--       proposition automatique ne le recrée pas) ; origin : 'auto' (proposition) / 'manuel'.
--   * maintenance_propose_catalog_links : proposition automatique PRUDENTE, relançable
--       (bouton « Proposer les rattachements ») — même famille, nom de modèle, millésime dans la
--       plage du plan. Nom exact + plage connue + un seul plan du même usage = « lie » ;
--       tout le reste (variante, plage inconnue, plusieurs plans possibles) = « a_valider ».
--       Ne modifie jamais un rattachement existant (lié, à valider ou détaché).
--   * maintenance_link_set : Rattacher / Détacher (administrateur ou chef d'atelier).
--   * maintenance_catalog_coverage : modèles-années du catalogue (Europe, depuis 2000) sans plan.
--   * vehicles.ducati_model_year_id : modèle-année du catalogue de la moto. Colonne prévue pour la
--       carte 06-4 « Reconnaître exactement la moto du client par son VIN » ; NON remplie ici.
--   * vehicles.maintenance_usage : usage choisi par le client (route par défaut, M-16).
--
-- Traces : une ligne events par proposition / rattachement / détachement (jamais par ligne).
-- Additif uniquement. Aucune donnée écrite par la migration.
-- =====================================================================

create table if not exists public.maintenance_plan_catalog_links (
  id             uuid primary key default gen_random_uuid(),
  plan_id        text not null references public.maintenance_plans(id) on delete cascade,
  model_year_id  text not null references public.ducati_catalog_model_years(id) on delete cascade,
  status         text not null check (status in ('lie', 'a_valider', 'rejete')),
  origin         text not null default 'auto' check (origin in ('auto', 'manuel')),
  reason         text,                          -- pourquoi la proposition (nom, plage)
  proposed_at    timestamptz not null default now(),
  decided_by     uuid references auth.users(id) on delete set null,
  decided_at     timestamptz,
  unique (plan_id, model_year_id)
);
create index if not exists idx_mp_links_model_year on public.maintenance_plan_catalog_links(model_year_id);
create index if not exists idx_mp_links_status on public.maintenance_plan_catalog_links(status);

comment on table public.maintenance_plan_catalog_links is 'Plan d''entretien ↔ modèle-année du catalogue Ducati (mission 07). lie / a_valider / rejete ; auto (proposition) ou manuel.';

alter table public.maintenance_plan_catalog_links enable row level security;
drop policy if exists maintenance_plan_catalog_links_read on public.maintenance_plan_catalog_links;
create policy maintenance_plan_catalog_links_read on public.maintenance_plan_catalog_links
  for select to authenticated using ((select public.ducati_catalog_is_staff()));
revoke all on public.maintenance_plan_catalog_links from anon;
revoke insert, update, delete, truncate on public.maintenance_plan_catalog_links from authenticated;

-- Moto ↔ catalogue (rempli par la carte 06-4) et usage d'entretien choisi par le client.
alter table public.vehicles
  add column if not exists ducati_model_year_id text references public.ducati_catalog_model_years(id) on delete set null;
alter table public.vehicles
  add column if not exists maintenance_usage text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_maintenance_usage_check') then
    alter table public.vehicles add constraint vehicles_maintenance_usage_check
      check (maintenance_usage is null or maintenance_usage in ('route', 'piste_amateur', 'racing'));
  end if;
end $$;
create index if not exists idx_vehicles_ducati_model_year on public.vehicles(ducati_model_year_id) where ducati_model_year_id is not null;
comment on column public.vehicles.ducati_model_year_id is 'Modèle-année du catalogue Ducati (mission 06, carte 4 : reconnaissance par le VIN). Donne le plan d''entretien (mission 07).';
comment on column public.vehicles.maintenance_usage is 'Usage choisi par le client pour le plan d''entretien : route (défaut si vide), piste_amateur, racing (décision M-16).';

-- ---------------------------------------------------------------------
-- Aides
-- ---------------------------------------------------------------------
-- Nom normalisé pour comparer : majuscules sans accents, tout ce qui n'est pas A-Z0-9 → espace.
create or replace function public._mp_norm(_s text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select nullif(btrim(regexp_replace(
    upper(translate(coalesce(_s, ''), 'áàâäãéèêëíìîïóòôöõúùûüçñÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ',
                                      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
    '[^A-Z0-9]+', ' ', 'g')), '');
$$;
revoke all on function public._mp_norm(text) from public, anon, authenticated;

-- Qui peut rattacher / détacher : administrateur ou chef d'atelier de la société active
-- (ou la clé de service).
create or replace function public._mp_can_link(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (_company is not null and (public.is_admin(_company) or public.has_role(_company, 'chef_atelier')));
$$;
revoke all on function public._mp_can_link(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Proposition automatique (relançable)
-- ---------------------------------------------------------------------
create or replace function public.maintenance_propose_catalog_links(_company uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_lie integer := 0; n_av integer := 0; n_seen integer := 0; n_my integer := 0;
begin
  if not public._mp_can_link(_company) then
    raise exception 'Rattachement des plans réservé à un administrateur ou au chef d''atelier' using errcode = '42501';
  end if;

  select count(*) into n_my from public.ducati_catalog_model_years;

  drop table if exists _mp_hits;
  create temp table _mp_hits on commit drop as
  with cand as (
    select p.id as plan_id, p.usage, p.year_from, p.year_to, public._mp_norm(p.family) as fam,
           public._mp_norm(n.name) as name
      from public.maintenance_plans p
      cross join lateral unnest(p.match_names) as n(name)
     where public._mp_norm(n.name) is not null
  ), my as (
    select y.id as my_id, y.year, public._mp_norm(m.description) as mname, public._mp_norm(f.description) as fam
      from public.ducati_catalog_model_years y
      join public.ducati_catalog_models m on m.id = y.model_id
      join public.ducati_catalog_families f on f.id = m.family_id
     where m.is_europe
  )
  select c.plan_id, c.usage, my.my_id,
         bool_or(my.mname = c.name or replace(my.mname, ' ', '') = replace(c.name, ' ', '')) as exact_name,
         (min(c.year_from) is not null and my.year is not null) as range_known,
         min(my.mname) as mname, min(my.year) as year
    from cand c
    join my on my.fam = c.fam
           and (my.mname = c.name or my.mname like c.name || ' %'
                or replace(my.mname, ' ', '') = replace(c.name, ' ', ''))
           and (my.year is null or ((c.year_from is null or my.year >= c.year_from)
                                and (c.year_to is null or my.year <= c.year_to)))
   group by c.plan_id, c.usage, my.my_id, my.year;

  -- Un modèle-année « exact » pour plusieurs plans du même usage : aucun n'est lié d'office.
  with graded as (
    select h.*, (select count(*) from _mp_hits h2
                  where h2.my_id = h.my_id and h2.usage = h.usage and h2.exact_name and h2.range_known) as n_exact
      from _mp_hits h
  ), ins as (
    insert into public.maintenance_plan_catalog_links (plan_id, model_year_id, status, origin, reason)
    select g.plan_id, g.my_id,
           case when g.exact_name and g.range_known and g.n_exact = 1 then 'lie' else 'a_valider' end,
           'auto',
           case when not g.exact_name then 'Variante du modèle (nom proche)'
                when not g.range_known then 'Années du plan non précisées'
                when g.n_exact > 1 then 'Plusieurs plans possibles'
                else 'Nom exact, millésime dans la plage' end
      from graded g
    on conflict (plan_id, model_year_id) do nothing
    returning status
  )
  select count(*) filter (where status = 'lie'), count(*) filter (where status = 'a_valider')
    into n_lie, n_av from ins;
  select count(*) into n_seen from _mp_hits;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'maintenance_links_proposed', 'maintenance_plans', null, 'screen', null,
          jsonb_build_object('model_years', n_my, 'candidates', n_seen, 'linked', n_lie, 'to_validate', n_av));

  return jsonb_build_object('modelYears', n_my, 'candidates', n_seen, 'linked', n_lie, 'toValidate', n_av,
                            'alreadyKnown', n_seen - n_lie - n_av);
end $$;
revoke all on function public.maintenance_propose_catalog_links(uuid) from public, anon;
grant execute on function public.maintenance_propose_catalog_links(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Rattacher (status 'lie') / Détacher (status 'rejete')
-- ---------------------------------------------------------------------
create or replace function public.maintenance_link_set(_company uuid, _plan text, _model_year_ids text[], _status text)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer := 0;
begin
  if not public._mp_can_link(_company) then
    raise exception 'Rattachement des plans réservé à un administrateur ou au chef d''atelier' using errcode = '42501';
  end if;
  if _status not in ('lie', 'rejete') then
    raise exception 'État de rattachement inconnu : %', _status using errcode = '22023';
  end if;
  if not exists (select 1 from public.maintenance_plans where id = _plan) then
    raise exception 'Plan d''entretien introuvable' using errcode = 'P0002';
  end if;

  insert into public.maintenance_plan_catalog_links as t (plan_id, model_year_id, status, origin, reason, decided_by, decided_at)
  select _plan, y.id, _status, 'manuel', null, auth.uid(), now()
    from public.ducati_catalog_model_years y
   where y.id = any (coalesce(_model_year_ids, '{}'))
  on conflict (plan_id, model_year_id) do update
    set status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at
    where t.status is distinct from excluded.status;
  get diagnostics n = row_count;

  if n > 0 then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), case when _status = 'lie' then 'maintenance_plan_linked' else 'maintenance_plan_unlinked' end,
            'maintenance_plan', _plan, 'screen', null,
            jsonb_build_object('model_year_ids', to_jsonb(_model_year_ids), 'changed', n));
  end if;
  return n;
end $$;
revoke all on function public.maintenance_link_set(uuid, text, text[], text) from public, anon;
grant execute on function public.maintenance_link_set(uuid, text, text[], text) to authenticated;

-- ---------------------------------------------------------------------
-- Couverture : modèles-années du catalogue (Europe, depuis 2000) sans plan rattaché
-- ---------------------------------------------------------------------
create or replace function public.maintenance_catalog_coverage(_limit integer default 300)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.ducati_catalog_is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return (
    with my as (
      select y.id, y.year, y.name, m.description as model, f.description as family,
             exists (select 1 from public.maintenance_plan_catalog_links l where l.model_year_id = y.id and l.status = 'lie') as covered,
             exists (select 1 from public.maintenance_plan_catalog_links l where l.model_year_id = y.id and l.status = 'a_valider') as pending
        from public.ducati_catalog_model_years y
        join public.ducati_catalog_models m on m.id = y.model_id
        join public.ducati_catalog_families f on f.id = m.family_id
       where m.is_europe and (y.year is null or y.year >= 2000)
    )
    select jsonb_build_object(
      'modelYears', (select count(*) from my),
      'covered', (select count(*) from my where covered),
      'pending', (select count(*) from my where not covered and pending),
      'uncovered', (select count(*) from my where not covered),
      'list', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'year', x.year, 'name', x.name,
                         'model', x.model, 'family', x.family, 'pending', x.pending)
                         order by x.family, x.model, x.year)
                  from (select * from my where not covered order by family, model, year
                        limit greatest(coalesce(_limit, 300), 1)) x), '[]'::jsonb)
    )
  );
end $$;
revoke all on function public.maintenance_catalog_coverage(integer) from public, anon;
grant execute on function public.maintenance_catalog_coverage(integer) to authenticated;
