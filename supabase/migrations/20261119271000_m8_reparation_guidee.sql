-- =====================================================================
-- M8 — Parcours mecanicien, lot D (19/11/2026) : REPARATION GUIDEE RELIEE A L'OR. ATE010 ATE011 B8 B11.
--
-- Demande du client (19/11) : « on lance la repa qui respecte le plan d'entretien (on peut cocher ce
-- qui est termine), on peut voir ... comment on fait pour chaque piece et chaque etape ».
--
--  1. `repair_order_plan_operations` : LA liste des operations du plan d'entretien de la moto pour cet
--     OR, une ligne par operation, avec sa case. Elle est construite en base
--     (`repair_order_operations_init`) depuis le programme d'entretien de la moto, LE MEME que
--     celui du kit, de la reservation et de l'entretien du (vue maintenance_vehicle_program) :
--       - moto reliee a un manuel d'atelier (source « manuel », 2 640 motos) : operations
--         concessionnaire du manuel (wsm_operations) des echeances de l'entretien choisi de l'OR
--         (annuel + huile = Annual + Oil Service, comme le kit M-109), chacune reliee a sa procedure
--         pas a pas quand le manuel en a une (meme rapprochement que le parcours : operation citee,
--         titre, puis mots communs >= 60 %) ;
--       - sinon (source « plan », 296 motos) : operations du plan d'entretien Ducati
--         (maintenance_service_operations, 3 743 textes) de l'entretien choisi ; procedure si la
--         moto a aussi un manuel, sinon « mode operatoire non disponible pour ce modele ».
--     Les procedures du manuel qu'aucune operation n'a reclamees s'ajoutent en fin de liste, non
--     obligatoires (on ne perd aucun mode operatoire).
--     Chaque operation connait les familles de pieces qu'elle consomme (maintenance_part_need_rules,
--     les memes regles que la generation des kits) : `repair_order_operations_lines` la relie aux
--     LIGNES DE L'OR (kit Q49) par l'article du kit.
--  2. Cocher « fait » / « non faite » (motif, liste parametrable) / revenir « a faire » :
--     `repair_order_operation_set`. Trace : qui, quand, le pointage en cours (lot A) et son
--     operation, + `events`. « Non faite » avec un motif « a reporter » (refus du client, piece
--     indisponible) cree une intervention reportee (mecanisme existant du check-up : relance,
--     date demandee a la facturation) ; les operations non faites sont reprises dans les notes
--     de la facture (`repair_order_operations_not_done_text`) et sur l'impression de l'OR.
--  3. Avancement x / y : vue `repair_order_plan_progress` (OR, planning).
--  4. « Terminer » : `repair_order_operations_finish` — toutes les operations obligatoires sont
--     faites ou « non faites » avec motif ; arret des pointages ouverts sur l'OR (lot A, fin
--     « stop ») puis OR « Pret », ce qui met le SMS de fin de travaux en file si l'envoi est actif
--     (declencheur existant trg_repair_orders_ready_sms). L'ecran demande confirmation.
--
-- Nom : `repair_order_plan_operations` (et non repair_order_operations, table d'essai de juin
-- 20260612250000 restee vide et inutilisee, laissee telle quelle).
-- RLS : politiques dans le style rls_* (rls_writable_companies, migration 20261119230000) : pas
-- besoin de relancer rls_perf_rewrite_all(). Ecritures uniquement par les fonctions.
-- Additive, rejouable. Aucune donnee existante modifiee (hors motifs precharges).
-- NON APPLIQUEE (Simon applique en bloc). Essai a blanc : supabase/tests/m8_reparation_guidee.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Motifs « non faite » (Parametres → Tables)
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, 'workshop_op_not_done_reason', x.code, x.label, x.so, x.extra
  from public.companies c
 cross join (values
   ('refus_client',       'Refus du client',                1, '{"defer":true}'::jsonb),
   ('pas_necessaire',     'Pas nécessaire (état correct)',  2, '{}'::jsonb),
   ('deja_fait',          'Déjà fait récemment',            3, '{}'::jsonb),
   ('piece_indisponible', 'Pièce indisponible',             4, '{"defer":true}'::jsonb),
   ('autre',              'Autre',                          5, '{}'::jsonb)
 ) as x(code, label, so, extra)
on conflict (company_id, table_key, code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Table des operations de l'OR
-- ---------------------------------------------------------------------
create table if not exists public.repair_order_plan_operations (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete restrict,
  or_id                uuid not null references public.repair_orders(id) on delete cascade,
  op_key               text not null,
  sort_order           integer not null default 0,
  label                text not null,
  source               text not null,
  service_code         text,
  service_label        text,
  manual_id            text,
  plan_id              text,
  wsm_operation_id     uuid,
  plan_operation_id    uuid,
  procedure_id         text,
  family_codes         text[] not null default '{}',
  mandatory            boolean not null default true,
  status               text not null default 'a_faire',
  done_at              timestamptz,
  done_by              uuid references auth.users(id) on delete set null,
  done_by_name         text,
  time_entry_id        uuid references public.workshop_time_entries(id) on delete set null,
  time_entry_operation text,
  not_done_reason      text,
  not_done_note        text,
  deferred_intervention_id uuid references public.deferred_interventions(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ro_plan_ops_status_chk check (status in ('a_faire', 'fait', 'non_fait')),
  constraint ro_plan_ops_source_chk check (source in ('manuel', 'plan')),
  constraint ro_plan_ops_not_done_chk check (status <> 'non_fait' or not_done_reason is not null),
  constraint ro_plan_ops_key_uniq unique (or_id, op_key)
);
comment on table public.repair_order_plan_operations is
  'Lot D parcours mecanicien : operations du plan d''entretien de la moto pour un OR (manuel d''atelier ou plan Ducati), case par operation. op_key = cle de l''operation dans le parcours technicien et dans les pointages (workshop_time_entries.journey_operation). Ecriture : repair_order_operations_init / repair_order_operation_set / repair_order_operations_finish.';
comment on column public.repair_order_plan_operations.procedure_id is 'Procedure pas a pas du manuel (ducati_manual_procedures.id) ; NULL = mode operatoire non disponible pour ce modele.';
comment on column public.repair_order_plan_operations.family_codes is 'Familles de pieces / liquides consommees (maintenance_part_need_rules) : relient l''operation aux lignes de l''OR (repair_order_operations_lines).';
comment on column public.repair_order_plan_operations.time_entry_id is 'Pointage en cours (lot A) au moment ou l''operation a ete cochee.';
create index if not exists idx_ro_ops_or on public.repair_order_plan_operations(or_id, sort_order);
create index if not exists idx_ro_ops_company on public.repair_order_plan_operations(company_id);
create index if not exists idx_ro_ops_time_entry on public.repair_order_plan_operations(time_entry_id) where time_entry_id is not null;
create index if not exists idx_ro_ops_deferred on public.repair_order_plan_operations(deferred_intervention_id) where deferred_intervention_id is not null;

alter table public.repair_order_plan_operations enable row level security;
drop policy if exists ro_ops_select on public.repair_order_plan_operations;
create policy ro_ops_select on public.repair_order_plan_operations for select to authenticated
  using (COALESCE((company_id IN (SELECT public.rls_writable_companies('repair_orders'::text))), false));
revoke insert, update, delete on public.repair_order_plan_operations from anon, authenticated;
grant select on public.repair_order_plan_operations to authenticated;

-- Avancement par OR (OR, planning).
create or replace view public.repair_order_plan_progress
with (security_invoker = true) as
select o.or_id,
       o.company_id,
       count(*)                                                  as total,
       count(*) filter (where o.status = 'fait')                 as done,
       count(*) filter (where o.status = 'non_fait')             as not_done,
       count(*) filter (where o.mandatory)                       as mandatory_total,
       count(*) filter (where o.mandatory and o.status = 'a_faire') as mandatory_open,
       max(o.done_at)                                            as last_done_at
  from public.repair_order_plan_operations o
 group by o.or_id, o.company_id;
comment on view public.repair_order_plan_progress is 'Lot D : avancement des operations du plan par OR (fait / non faite / obligatoires restantes). RLS de la table (security_invoker).';
grant select on public.repair_order_plan_progress to authenticated;

-- ---------------------------------------------------------------------
-- 3. Aides : programme de la moto, texte normalise, rapprochement operation -> procedure
-- ---------------------------------------------------------------------
-- Source du programme d'entretien d'une moto : MEME regle que la vue maintenance_vehicle_program
-- (usage piste avec plan → plan ; sinon manuel relie ; sinon plan route ; sinon plan de l'usage).
create or replace function public._vehicle_maintenance_source(_vehicle uuid)
returns table(source text, manual_id text, plan_id text, model_year_id text, usage text)
language sql stable security definer set search_path = public, pg_temp as $$
  with v as (
    select v.ducati_model_year_id as my, coalesce(nullif(v.maintenance_usage, ''), 'route') as usage
      from public.vehicles v where v.id = _vehicle and v.ducati_model_year_id is not null
  ), man as (
    select w.manual_id from public.wsm_manual_catalog_links w join public.wsm_manuals m on m.id = w.manual_id, v
     where w.status = 'lie' and w.model_year_id = v.my
     order by m.model_year desc nulls last, m.id limit 1
  ), pu as (
    select p.id from public.maintenance_plan_catalog_links l join public.maintenance_plans p on p.id = l.plan_id, v
     where l.status = 'lie' and l.model_year_id = v.my and p.usage = v.usage
     order by p.year_from desc nulls last, p.id limit 1
  ), pr as (
    select p.id from public.maintenance_plan_catalog_links l join public.maintenance_plans p on p.id = l.plan_id, v
     where l.status = 'lie' and l.model_year_id = v.my and p.usage = 'route'
     order by p.year_from desc nulls last, p.id limit 1
  )
  select case when v.usage <> 'route' and (select id from pu) is not null then 'plan'
              when (select manual_id from man) is not null then 'manuel'
              when (select id from pr) is not null then 'plan'
              when (select id from pu) is not null then 'plan' end,
         (select manual_id from man),
         case when v.usage <> 'route' and (select id from pu) is not null then (select id from pu)
              else coalesce((select id from pr), (select id from pu)) end,
         v.my, v.usage
    from v;
$$;
revoke all on function public._vehicle_maintenance_source(uuid) from public, anon, authenticated;

-- « Contrôle du niveau d'huile » → « controle du niveau d huile » (sans accent, sans ponctuation).
create or replace function public._norm_text(_s text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select btrim(regexp_replace(lower(public.unaccent(coalesce(_s, ''))), '[^a-z0-9]+', ' ', 'g'));
$$;
grant execute on function public._norm_text(text) to authenticated;

-- Procedure du manuel pour une operation (miroir de journey/rules.ts matchProcedure) : operation
-- citee identique, puis titre identique, puis mots communs (> 3 lettres) >= 60 % ; les procedures
-- pas encore reclamees passent d'abord.
create or replace function public._wsm_match_procedure(_manual text, _codes text[], _label text, _claimed text[])
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  l text := public._norm_text(_label); _words text[]; _best text; _score numeric; _bs numeric := 0; x record; _pass int;
begin
  if l = '' or _manual is null then return null; end if;
  for _pass in 1..2 loop
    select sp.procedure_id into _best
      from public.wsm_service_procedures sp left join public.wsm_procedures p on p.id = sp.procedure_id
     where sp.manual_id = _manual and sp.service_code = any(_codes)
       and (_pass = 2 or not (sp.procedure_id = any(coalesce(_claimed, '{}'))))
       and (public._norm_text(sp.operation) = l or public._norm_text(p.title) = l)
     order by (public._norm_text(sp.operation) = l) desc, sp.sort
     limit 1;
    if _best is not null then return _best; end if;
  end loop;
  select array_agg(distinct w) into _words from unnest(string_to_array(l, ' ')) w where length(w) > 3;
  if coalesce(array_length(_words, 1), 0) = 0 then return null; end if;
  for _pass in 1..2 loop
    for x in
      select sp.procedure_id, sp.sort,
             (select count(*) from unnest(_words) w
               where w = any(string_to_array(public._norm_text(coalesce(sp.operation, '') || ' ' || coalesce(p.title, '')), ' ')))::numeric
             / array_length(_words, 1) as score
        from public.wsm_service_procedures sp left join public.wsm_procedures p on p.id = sp.procedure_id
       where sp.manual_id = _manual and sp.service_code = any(_codes)
         and (_pass = 2 or not (sp.procedure_id = any(coalesce(_claimed, '{}'))))
       order by sp.sort
    loop
      if x.score >= 0.6 and x.score > _bs then _bs := x.score; _best := x.procedure_id; end if;
    end loop;
    if _best is not null then return _best; end if;
  end loop;
  return null;
end $$;
revoke all on function public._wsm_match_procedure(text, text[], text, text[]) from public, anon, authenticated;

-- Familles de pieces consommees par une operation (memes regles que la generation des kits).
create or replace function public._operation_part_families(_label text)
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct r.family_code order by r.family_code), '{}')
    from public.maintenance_part_need_rules r
   where coalesce(_label, '') ~* r.pattern;
$$;
revoke all on function public._operation_part_families(text) from public, anon, authenticated;

-- L'entretien de l'OR : entretien choisi, sinon celui du motif.
create or replace function public._ro_plan_service(r public.repair_orders)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(r.service_code, public.workshop_service_for_reason(r.company_id, r.reason_code));
$$;
revoke all on function public._ro_plan_service(public.repair_orders) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Construire la liste de l'OR
-- ---------------------------------------------------------------------
-- Rejouable : si la liste existe, elle est rendue telle quelle. `_rebuild` = la reconstruire
-- (entretien change) — refuse des qu'une operation est cochee ou marquee « non faite ».
-- Reponse : {status: created | exists | rebuilt | no_service | no_vehicle | no_catalog | no_program, count, source}.
create or replace function public.repair_order_operations_init(_or uuid, _rebuild boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.repair_orders%rowtype;
  _svc text; _kinds text[]; s record; _codes text[]; _svc_label text;
  _claimed text[] := '{}'; _proc text; _n int := 0; x record; _existing int; _resolved int;
begin
  select * into r from public.repair_orders where id = _or for update;
  if not found then raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002'; end if;
  if not public.can_write_table(r.company_id, 'repair_orders') then
    raise exception 'Acces refuse.' using errcode = '42501';
  end if;

  select count(*), count(*) filter (where status <> 'a_faire') into _existing, _resolved
    from public.repair_order_plan_operations where or_id = r.id;
  if _existing > 0 and not coalesce(_rebuild, false) then
    return jsonb_build_object('status', 'exists', 'count', _existing,
      'source', (select o.source from public.repair_order_plan_operations o where o.or_id = r.id limit 1));
  end if;
  if _existing > 0 and _resolved > 0 then
    raise exception 'OR % : des operations sont deja cochees, la liste ne se reconstruit plus.', coalesce(r.number, r.id::text) using errcode = '23514';
  end if;
  if r.status in ('facture', 'annule') then
    raise exception 'OR % : statut %, la liste des operations ne se construit plus.', coalesce(r.number, r.id::text), r.status using errcode = '23514';
  end if;

  _svc := public._ro_plan_service(r);
  if _svc is null then return jsonb_build_object('status', 'no_service', 'count', 0); end if;
  if r.vehicle_id is null then return jsonb_build_object('status', 'no_vehicle', 'count', 0); end if;
  select * into s from public._vehicle_maintenance_source(r.vehicle_id);
  if s.model_year_id is null then return jsonb_build_object('status', 'no_catalog', 'count', 0); end if;
  if s.source is null then return jsonb_build_object('status', 'no_program', 'count', 0); end if;
  _kinds := public.workshop_service_kit_codes(_svc);

  if _existing > 0 then delete from public.repair_order_plan_operations where or_id = r.id; end if;

  -- Echeances du manuel de l'entretien (une par type ; grille : la plus proche du km de l'OR).
  if s.manual_id is not null then
    select array_agg(q.code), string_agg(q.name, ' + ' order by q.ord) into _codes, _svc_label
      from (
        select distinct on (k.kind) w.code, w.name, array_position(_kinds, k.kind) as ord
          from public.wsm_services w
          cross join lateral (select public.maintenance_service_kind(w.code, w.km, w.months, w.first_service) as kind) k
         where w.manual_id = s.manual_id and public.maintenance_is_real_service(w.name) and k.kind = any(_kinds)
         order by k.kind, abs(coalesce(w.km, 0) - coalesce(r.mileage, 0)), w.sort
      ) q;
  end if;

  if s.source = 'manuel' then
    if coalesce(array_length(_codes, 1), 0) = 0 then return jsonb_build_object('status', 'no_program', 'count', 0); end if;
    for x in
      select * from (
        select distinct on (public._norm_text(o.label)) o.id, o.label, o.sort
          from public.wsm_operations o
         where o.manual_id = s.manual_id and o.scope = 'concessionnaire' and o.service_codes && _codes
         order by public._norm_text(o.label), o.sort
      ) d order by d.sort
    loop
      _proc := public._wsm_match_procedure(s.manual_id, _codes, x.label, _claimed);
      if _proc is not null then _claimed := _claimed || _proc; end if;
      _n := _n + 1;
      insert into public.repair_order_plan_operations
        (company_id, or_id, op_key, sort_order, label, source, service_code, service_label, manual_id, wsm_operation_id, procedure_id, family_codes, mandatory)
      values (r.company_id, r.id, 'op' || _n, _n, x.label, 'manuel', _svc, _svc_label, s.manual_id, x.id, _proc,
              public._operation_part_families(x.label), true);
    end loop;
  else
    select string_agg(ps.name, ' + ' order by ps.sort) into _svc_label
      from public.maintenance_plan_services ps
     where ps.plan_id = s.plan_id and public.maintenance_is_real_service(ps.name) and public.maintenance_service_kind_of(ps.code) = any(_kinds);
    for x in
      select * from (
        select distinct on (public._norm_text(o.text)) o.id, o.text as label, ps.sort as ssort, o.sort
          from public.maintenance_plan_services ps
          join public.maintenance_service_operations o on o.service_id = ps.id
         where ps.plan_id = s.plan_id and public.maintenance_is_real_service(ps.name)
           and public.maintenance_service_kind_of(ps.code) = any(_kinds)
           and btrim(coalesce(o.text, '')) <> ''
         order by public._norm_text(o.text), ps.sort, o.sort
      ) d order by d.ssort, d.sort
    loop
      _proc := case when s.manual_id is not null and _codes is not null
                    then public._wsm_match_procedure(s.manual_id, _codes, x.label, _claimed) end;
      if _proc is not null then _claimed := _claimed || _proc; end if;
      _n := _n + 1;
      insert into public.repair_order_plan_operations
        (company_id, or_id, op_key, sort_order, label, source, service_code, service_label, plan_id, manual_id, plan_operation_id, procedure_id, family_codes, mandatory)
      values (r.company_id, r.id, 'op' || _n, _n, x.label, 'plan', _svc, _svc_label, s.plan_id, s.manual_id, x.id, _proc,
              public._operation_part_families(x.label), true);
    end loop;
  end if;

  -- Procedures du manuel de cet entretien qu'aucune operation n'a reclamees : en fin de liste, non
  -- obligatoires (une seule par titre).
  if s.manual_id is not null and _codes is not null then
    for x in
      select * from (
        select distinct on (public._norm_text(coalesce(p.title, sp.operation))) sp.procedure_id, coalesce(p.title, sp.operation) as label, sp.sort
          from public.wsm_service_procedures sp left join public.wsm_procedures p on p.id = sp.procedure_id
         where sp.manual_id = s.manual_id and sp.service_code = any(_codes)
           and not (sp.procedure_id = any(_claimed))
         order by public._norm_text(coalesce(p.title, sp.operation)), sp.sort
      ) d
      where not exists (select 1 from public.repair_order_plan_operations o where o.or_id = r.id and public._norm_text(o.label) = public._norm_text(d.label))
      order by d.sort
    loop
      _n := _n + 1;
      insert into public.repair_order_plan_operations
        (company_id, or_id, op_key, sort_order, label, source, service_code, service_label, manual_id, plan_id, procedure_id, family_codes, mandatory)
      values (r.company_id, r.id, 'op' || _n, _n, x.label, s.source, _svc, _svc_label, s.manual_id, s.plan_id, x.procedure_id,
              public._operation_part_families(x.label), false);
    end loop;
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'repair_order_operations_built', 'repair_orders', r.id::text, 'screen',
          case when _existing > 0 then jsonb_build_object('count', _existing) end,
          jsonb_build_object('count', _n, 'source', s.source, 'service', _svc, 'manual_id', s.manual_id, 'plan_id', s.plan_id));

  return jsonb_build_object('status', case when _existing > 0 then 'rebuilt' when _n > 0 then 'created' else 'no_program' end,
                            'count', _n, 'source', s.source);
end $$;
revoke all on function public.repair_order_operations_init(uuid, boolean) from public, anon;
grant execute on function public.repair_order_operations_init(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Lien operation -> lignes de l'OR (pieces / liquides du kit)
-- ---------------------------------------------------------------------
create or replace function public.repair_order_operations_lines(_or uuid)
returns table(operation_id uuid, line_id uuid, family_code text, article_id uuid, designation text, quantity numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.repair_orders%rowtype; _my text; _svc text;
begin
  select * into r from public.repair_orders where id = _or;
  if not found or not public.can_write_table(r.company_id, 'repair_orders') then return; end if;
  select v.ducati_model_year_id into _my from public.vehicles v where v.id = r.vehicle_id;
  _svc := public._ro_plan_service(r);
  return query
  with kit as (
    select k.family_code, k.article_id from public._workshop_service_kit_items(r.company_id, _my, _svc) k
     where k.article_id is not null and k.family_code is not null
  )
  select distinct o.id, l.id, kit.family_code, l.article_id, l.designation, l.quantity
    from public.repair_order_plan_operations o
    cross join lateral unnest(o.family_codes) f(code)
    join kit on kit.family_code = f.code
    join public.repair_order_lines l on l.or_id = o.or_id and l.article_id = kit.article_id
   where o.or_id = r.id;
end $$;
revoke all on function public.repair_order_operations_lines(uuid) from public, anon;
grant execute on function public.repair_order_operations_lines(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Cocher / non faite / a faire
-- ---------------------------------------------------------------------
create or replace function public.repair_order_operation_set(
  _op uuid, _status text, _reason text default null, _note text default null, _mechanic_code text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.repair_order_plan_operations%rowtype; n public.repair_order_plan_operations%rowtype;
  r public.repair_orders%rowtype; e public.workshop_time_entries%rowtype;
  _st text := btrim(coalesce(_status, '')); _r text := nullif(btrim(coalesce(_reason, '')), '');
  _code text := nullif(btrim(coalesce(_mechanic_code, '')), ''); _defer boolean := false; _def uuid; _rv record;
begin
  if _st not in ('fait', 'non_fait', 'a_faire') then
    raise exception 'Operation : etat inconnu (%).', _st using errcode = '22023';
  end if;
  select * into o from public.repair_order_plan_operations where id = _op for update;
  if not found then raise exception 'Operation introuvable.' using errcode = 'P0002'; end if;
  select * into r from public.repair_orders where id = o.or_id;
  if not public.can_write_table(r.company_id, 'repair_orders') then
    raise exception 'Acces refuse.' using errcode = '42501';
  end if;
  if r.status in ('facture', 'annule') then
    raise exception 'OR % : statut %, les operations ne se modifient plus.', coalesce(r.number, r.id::text), r.status using errcode = '23514';
  end if;
  if _st = 'non_fait' then
    if _r is null then raise exception 'Operation non faite : motif obligatoire.' using errcode = '22023'; end if;
    select rv.code, rv.extra into _rv from public.reference_values rv
     where rv.company_id = r.company_id and rv.table_key = 'workshop_op_not_done_reason' and rv.code = _r and rv.is_active;
    if not found and _r <> 'autre' then
      raise exception 'Motif inconnu : %.', _r using errcode = '22023';
    end if;
    _defer := coalesce((_rv.extra->>'defer')::boolean, false);
  end if;
  if o.status = _st and o.not_done_reason is not distinct from _r and o.not_done_note is not distinct from nullif(btrim(coalesce(_note, '')), '') then
    return jsonb_build_object('status', 'unchanged', 'operation_id', o.id);
  end if;

  -- Le pointage en cours sur cet OR : celui du mecanicien (compte ou code), sinon le dernier ouvert.
  if _st <> 'a_faire' then
    select x.* into e from public.workshop_time_entries x
     where x.or_id = r.id and x.kind = 'travail' and x.ended_at is null
     order by (case when _code is not null then x.mechanic_code = _code else x.mechanic_id = auth.uid() and x.mechanic_code is null end) desc,
              x.started_at desc
     limit 1;
  end if;

  -- Intervention reportee (refus client, piece indisponible) : mecanisme existant du check-up.
  if _st = 'non_fait' and _defer and o.deferred_intervention_id is null then
    insert into public.deferred_interventions (company_id, vehicle_id, contact_id, repair_order_id, label, amount_ttc, status)
    values (r.company_id, r.vehicle_id, r.contact_id, r.id, o.label, 0, 'a_planifier')
    returning id into _def;
  elsif o.deferred_intervention_id is not null and not (_st = 'non_fait' and _defer) then
    update public.deferred_interventions set status = 'abandonne'
     where id = o.deferred_intervention_id and status = 'a_planifier';
    _def := null;
  else
    _def := o.deferred_intervention_id;
  end if;

  update public.repair_order_plan_operations
     set status = _st,
         done_at = case when _st = 'a_faire' then null else now() end,
         done_by = case when _st = 'a_faire' then null else auth.uid() end,
         done_by_name = case when _st = 'a_faire' then null
                             else coalesce(e.mechanic_name, (select rv.label from public.reference_values rv where rv.company_id = r.company_id and rv.table_key = 'workshop_mechanic' and rv.code = _code limit 1), _code, public._current_user_name()) end,
         time_entry_id = case when _st = 'a_faire' then null else e.id end,
         time_entry_operation = case when _st = 'a_faire' then null else e.journey_operation end,
         not_done_reason = case when _st = 'non_fait' then _r end,
         not_done_note = case when _st = 'non_fait' then nullif(btrim(coalesce(_note, '')), '') end,
         deferred_intervention_id = _def,
         updated_at = now()
   where id = o.id
  returning * into n;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(),
          case _st when 'fait' then 'repair_order_operation_done' when 'non_fait' then 'repair_order_operation_not_done' else 'repair_order_operation_reset' end,
          'repair_orders', r.id::text, 'screen',
          jsonb_build_object('operation_id', o.id, 'op_key', o.op_key, 'status', o.status, 'reason', o.not_done_reason),
          jsonb_build_object('operation_id', n.id, 'op_key', n.op_key, 'label', n.label, 'status', n.status, 'reason', n.not_done_reason,
                             'note', n.not_done_note, 'by', n.done_by_name, 'time_entry_id', n.time_entry_id,
                             'time_entry_operation', n.time_entry_operation, 'deferred_intervention_id', n.deferred_intervention_id));

  return jsonb_build_object('status', n.status, 'operation_id', n.id, 'done_at', n.done_at, 'done_by_name', n.done_by_name,
                            'time_entry_id', n.time_entry_id, 'deferred_intervention_id', n.deferred_intervention_id,
                            'mandatory_open', (select count(*) from public.repair_order_plan_operations x where x.or_id = r.id and x.mandatory and x.status = 'a_faire'));
end $$;
revoke all on function public.repair_order_operation_set(uuid, text, text, text, text) from public, anon;
grant execute on function public.repair_order_operation_set(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Operations non faites : texte repris sur la facture (notes) et l'impression
-- ---------------------------------------------------------------------
create or replace function public.repair_order_operations_not_done_text(_or uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case when count(*) = 0 then null else
         'Opérations non réalisées : ' || string_agg(
           o.label || ' (' || coalesce(rv.label, o.not_done_reason) || coalesce(' : ' || o.not_done_note, '') || ')',
           ' ; ' order by o.sort_order) end
    from public.repair_order_plan_operations o
    join public.repair_orders r on r.id = o.or_id
    left join public.reference_values rv on rv.company_id = o.company_id and rv.table_key = 'workshop_op_not_done_reason' and rv.code = o.not_done_reason
   where o.or_id = _or and o.status = 'non_fait' and public.can_write_table(r.company_id, 'repair_orders');
$$;
revoke all on function public.repair_order_operations_not_done_text(uuid) from public, anon;
grant execute on function public.repair_order_operations_not_done_text(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. « Terminer » : arret du pointage puis OR « Pret » (SMS existant)
-- ---------------------------------------------------------------------
create or replace function public.repair_order_operations_finish(_or uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.repair_orders%rowtype; _open int; _total int; x record; _stopped int := 0; _minutes numeric := 0; e public.workshop_time_entries%rowtype;
begin
  select * into r from public.repair_orders where id = _or for update;
  if not found then raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002'; end if;
  if not public.can_write_table(r.company_id, 'repair_orders') then
    raise exception 'Acces refuse.' using errcode = '42501';
  end if;
  if r.status not in ('a_faire', 'attente_devis', 'attente_pieces', 'en_cours') then
    raise exception 'OR % : il ne peut plus passer « Pret » (statut %).', coalesce(r.number, r.id::text), r.status using errcode = '23514';
  end if;
  select count(*), count(*) filter (where mandatory and status = 'a_faire') into _total, _open
    from public.repair_order_plan_operations where or_id = r.id;
  if _open > 0 then
    raise exception 'OR % : % operation(s) obligatoire(s) ni faite(s) ni marquee(s) « non faite ».', coalesce(r.number, r.id::text), _open using errcode = '23514';
  end if;

  -- Arret des pointages de travail encore ouverts sur l'OR (lot A, fin « Terminer »).
  for x in select id from public.workshop_time_entries where or_id = r.id and kind = 'travail' and ended_at is null order by started_at for update loop
    e := public._wte_close(x.id, 'stop', null, now(), 'screen');
    _stopped := _stopped + 1;
    _minutes := _minutes + coalesce(e.minutes, 0);
  end loop;

  update public.repair_orders set status = 'pret' where id = r.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'repair_order_operations_finished', 'repair_orders', r.id::text, 'screen',
          jsonb_build_object('status', r.status),
          jsonb_build_object('status', 'pret', 'operations', _total,
                             'not_done', (select count(*) from public.repair_order_plan_operations o where o.or_id = r.id and o.status = 'non_fait'),
                             'time_entries_stopped', _stopped));
  return jsonb_build_object('status', 'pret', 'previous_status', r.status, 'time_entries_stopped', _stopped, 'minutes_stopped', _minutes,
                            'sms', public.sms_ready_state(r.id));
end $$;
revoke all on function public.repair_order_operations_finish(uuid) from public, anon;
grant execute on function public.repair_order_operations_finish(uuid) to authenticated;
