-- =====================================================================
-- M8 — Parcours mecanicien (Simon, 26/11/2026). ATE014
--
-- 1) Seulement les operations A ECHEANCE. Le plan Ducati generique (posters « ENTRETIEN.pdf »)
--    liste dans l'entretien annuel des operations a periodicite plus longue (courroies 60 mois,
--    liquide de refroidissement 48 mois, huile de fourche 36 mois, liquide de frein 24 mois :
--    maintenance_service_operations.periodicity_months). La decision « due / pas due / inconnue »
--    est une regle PURE cote ecran (src/modules/workshop/plan-ops/due-rules.ts, testee) ; la base
--    fournit le contexte :
--      workshop_periodic_due_context(_vehicle, _service, _or) : les operations periodiques du plan
--      de la moto pour cet entretien (periodicite, forcee ou non par un service choisi, services qui
--      la font d'office), la date de depart (garantie, puis mise en circulation) et l'historique de
--      la moto (operations faites sur ses autres OR, OR factures et leur entretien, lignes de
--      factures DMS / G8, entretiens DCS passes, historique d'entretien).
--    repair_order_plan_operations.due_forced + repair_order_operation_due_force : « Faire quand
--    meme » une operation masquee parce que pas a echeance (trace dans events, reversible).
-- 2) Mode operatoire « maison » quand Ducati n'en a pas : workshop_procedures (une ligne par
--    operation et par modele-annee OU par modele), workshop_procedure_versions (historique leger,
--    append-only), workshop_procedure_save (chef d'atelier, admin, mecanicien ; trace events),
--    workshop_procedures_for_or (ce qui s'applique aux operations d'un OR). Photos : GED existante
--    (attachments, entity_type 'workshop_procedure').
-- Aucune donnee client. Essai a blanc : begin; ...; rollback;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Operations a echeance
-- ---------------------------------------------------------------------
alter table public.repair_order_plan_operations
  add column if not exists due_forced boolean not null default false;
comment on column public.repair_order_plan_operations.due_forced is
  'Vrai : « Faire quand meme » une operation periodique pas a echeance (elle reste affichee). ATE014, 26/11/2026.';

create or replace function public.workshop_periodic_due_context(_vehicle uuid default null, _service text default null, _or uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r public.repair_orders%rowtype; v public.vehicles%rowtype; s record;
  _svc text := _service; _kinds text[]; _start date; _start_src text; _now date := current_date; _km integer;
  _periodic jsonb; _evidence jsonb;
begin
  if _or is not null then
    select * into r from public.repair_orders where id = _or;
    if not found then raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002'; end if;
    _vehicle := r.vehicle_id; _svc := public._ro_plan_service(r);
    _now := coalesce(r.created_at::date, current_date); _km := r.mileage::integer;
  end if;
  select * into v from public.vehicles where id = _vehicle;
  if not found then return null; end if;
  if not public.is_member(v.company_id) then raise exception 'Acces refuse.' using errcode = '42501'; end if;
  if _or is null then _km := coalesce(v.mileage, v.declared_km)::integer; end if;
  _kinds := coalesce(public.workshop_service_kit_codes(_svc), '{}');
  select * into s from public._vehicle_maintenance_source(v.id);

  -- Date de depart pour la premiere echeance : garantie, extract DCS, puis mise en circulation.
  _start := v.warranty_start; _start_src := 'garantie';
  if _start is null then
    select i.warranty_start into _start from public.dcs_maintenance_imports i
     where i.company_id = v.company_id and i.vin = public.vin_normalize(v.vin) and i.warranty_start is not null
     order by i.imported_at desc limit 1;
  end if;
  if _start is null then _start := v.first_registration_date; _start_src := 'mise_en_circulation'; end if;
  if _start is null then _start_src := null; end if;

  -- Operations periodiques (plus de 12 mois) du plan de la moto pour cet entretien.
  with ops as (
    select public._norm_text(o.text) as k, o.text, o.periodicity_months as pm, public.maintenance_service_kind_of(ps.code) as kind
      from public.maintenance_plan_services ps
      join public.maintenance_service_operations o on o.service_id = ps.id
     where s.plan_id is not null and ps.plan_id = s.plan_id and btrim(coalesce(o.text, '')) <> ''
  ), per as (
    select p.k, min(p.text) as text, max(p.pm) as pm
      from ops p where p.pm > 12 and p.kind = any(_kinds) group by p.k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'text', per.text, 'periodicity_months', per.pm,
           -- un service CHOISI la fait d'office (sans periodicite) : toujours affichee
           'forced', exists (select 1 from ops q where q.k = per.k and q.kind = any(_kinds) and coalesce(q.pm, 0) <= 12),
           -- services qui la font d'office (Desmo → courroies...) : un tel entretien passe vaut « faite »
           'covered_by', coalesce((select jsonb_agg(distinct q.kind) from ops q where q.k = per.k and q.kind is not null and coalesce(q.pm, 0) <= 12), '[]'::jsonb),
           'families', to_jsonb(public._operation_part_families(per.text))
         ) order by per.text), '[]'::jsonb)
    into _periodic from per;

  -- Historique de la moto (le plus recent gagne cote regle).
  with ev as (
    -- a. operations cochees « faite » sur ses autres OR
    select 'or_op'::text as source, coalesce(o.done_at::date, ro.updated_at::date) as d, ro.mileage::integer as km,
           'OR ' || coalesce(ro.number, left(ro.id::text, 8)) as ref, o.label as text, null::text[] as kinds
      from public.repair_order_plan_operations o join public.repair_orders ro on ro.id = o.or_id
     where ro.vehicle_id = v.id and ro.id is distinct from _or and ro.status <> 'annule' and o.status = 'fait'
    union all
    -- b. OR factures : leur entretien (Desmo → courroies...)
    select 'or_service', coalesce(d.issue_date, ro.updated_at::date), ro.mileage::integer,
           'OR ' || coalesce(ro.number, left(ro.id::text, 8)), null, public.workshop_service_kit_codes(public._ro_plan_service(ro))
      from public.repair_orders ro left join public.documents d on d.id = ro.invoice_document_id
     where ro.vehicle_id = v.id and ro.id is distinct from _or and ro.status = 'facture' and public._ro_plan_service(ro) is not null
    union all
    -- c. lignes des factures de la moto (DMS et G8 relues) qui peuvent dire une operation periodique
    select 'invoice_line', d.issue_date, null::integer, 'FAC ' || coalesce(d.number, d.legacy_number, left(d.id::text, 8)), dl.designation, null
      from public.documents d join public.document_lines dl on dl.document_id = d.id
     where d.vehicle_id = v.id and d.doc_type = 'FAC' and d.status not in ('brouillon', 'annulee') and d.issue_date is not null
       and dl.designation ~* '(courroie|frein|dot ?[345]|refroidissement|antigel|anti-gel|coolant|fourche|bougie|filtre|huile|desmo|soupape)'
    union all
    -- d. entretiens DCS passes
    select 'dcs', m.event_date, m.km::integer, 'DCS ' || coalesce(m.service_type, ''), m.service_type,
           case when m.service_type ~* '(desmo|valve)' then array['desmo']
                when m.service_type ~* '(1000|600 ?mi)' then array['first_1000']
                when m.service_type ~* '(annual|temporel)' then array['annual']
                when m.service_type ~* 'oil' then array['oil'] end
      from public.vehicle_maintenance m
     where m.vehicle_id = v.id and m.kind = 'past' and m.event_category = 'Maintenance' and m.event_date is not null
    union all
    -- e. historique d'entretien saisi (fiche moto)
    select 'history', h.event_date, h.km::integer, coalesce(nullif(h.source, ''), 'historique'), concat_ws(' ', h.service_family, h.service_label), null
      from public.vehicle_service_history h
     where h.vehicle_id = v.id and h.event_date is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('source', ev.source, 'date', ev.d, 'km', ev.km, 'ref', ev.ref, 'text', ev.text,
                                               'kinds', coalesce(to_jsonb(ev.kinds), '[]'::jsonb)) order by ev.d desc), '[]'::jsonb)
    into _evidence from ev where ev.d is not null;

  return jsonb_build_object(
    'vehicle_id', v.id, 'service', _svc, 'kinds', to_jsonb(_kinds), 'plan_id', s.plan_id,
    'now_date', _now, 'now_km', _km, 'start_date', _start, 'start_source', _start_src,
    'periodic', _periodic, 'evidence', _evidence);
end $$;
revoke all on function public.workshop_periodic_due_context(uuid, text, uuid) from public, anon;
grant execute on function public.workshop_periodic_due_context(uuid, text, uuid) to authenticated;
comment on function public.workshop_periodic_due_context(uuid, text, uuid) is
  'Contexte de la regle « operations a echeance » (due-rules.ts) : operations periodiques du plan, depart, historique de la moto. ATE014, 26/11/2026.';

-- « Faire quand meme » (ou de nouveau masquer) une operation pas a echeance : trace, reversible.
create or replace function public.repair_order_operation_due_force(_op uuid, _force boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.repair_order_plan_operations%rowtype; n public.repair_order_plan_operations%rowtype; r public.repair_orders%rowtype;
begin
  select * into o from public.repair_order_plan_operations where id = _op for update;
  if not found then raise exception 'Operation introuvable.' using errcode = 'P0002'; end if;
  select * into r from public.repair_orders where id = o.or_id;
  if not public.can_write_table(r.company_id, 'repair_orders') then raise exception 'Acces refuse.' using errcode = '42501'; end if;
  if r.status in ('facture', 'annule') then
    raise exception 'OR % : statut %, les operations ne se modifient plus.', coalesce(r.number, r.id::text), r.status using errcode = '23514';
  end if;
  if o.due_forced = coalesce(_force, true) then return jsonb_build_object('status', 'unchanged', 'operation_id', o.id); end if;
  update public.repair_order_plan_operations
     set due_forced = coalesce(_force, true),
         -- remise « a faire » si elle avait ete reglee « pas a echeance »
         status = case when coalesce(_force, true) and status = 'non_fait' and not_done_note like 'Pas à échéance%' then 'a_faire' else status end,
         not_done_reason = case when coalesce(_force, true) and status = 'non_fait' and not_done_note like 'Pas à échéance%' then null else not_done_reason end,
         done_at = case when coalesce(_force, true) and status = 'non_fait' and not_done_note like 'Pas à échéance%' then null else done_at end,
         done_by = case when coalesce(_force, true) and status = 'non_fait' and not_done_note like 'Pas à échéance%' then null else done_by end,
         done_by_name = case when coalesce(_force, true) and status = 'non_fait' and not_done_note like 'Pas à échéance%' then null else done_by_name end,
         not_done_note = case when coalesce(_force, true) and status = 'non_fait' and not_done_note like 'Pas à échéance%' then null else not_done_note end,
         updated_at = now()
   where id = o.id
  returning * into n;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), case when n.due_forced then 'repair_order_operation_due_forced' else 'repair_order_operation_due_unforced' end,
          'repair_orders', r.id::text, 'screen',
          jsonb_build_object('operation_id', o.id, 'op_key', o.op_key, 'due_forced', o.due_forced, 'status', o.status, 'note', o.not_done_note),
          jsonb_build_object('operation_id', n.id, 'op_key', n.op_key, 'label', n.label, 'due_forced', n.due_forced, 'status', n.status));
  return jsonb_build_object('status', n.status, 'operation_id', n.id, 'due_forced', n.due_forced);
end $$;
revoke all on function public.repair_order_operation_due_force(uuid, boolean) from public, anon;
grant execute on function public.repair_order_operation_due_force(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Mode operatoire de l'atelier
-- ---------------------------------------------------------------------
create table if not exists public.workshop_procedures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  -- « ce modele-annee » (model_year) ou « toutes les motos de ce modele » (model)
  scope text not null check (scope in ('model_year', 'model')),
  model_year_id text,
  model_id text not null,
  -- operation : libelle normalise (_norm_text) et libelle affiche
  op_key text not null,
  op_label text not null,
  steps jsonb not null default '[]'::jsonb,
  torques jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  remarks text,
  version integer not null default 1,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  constraint workshop_procedures_scope_my check (scope <> 'model_year' or model_year_id is not null)
);
create unique index if not exists uq_workshop_procedures_my on public.workshop_procedures (company_id, op_key, model_year_id) where scope = 'model_year';
create unique index if not exists uq_workshop_procedures_model on public.workshop_procedures (company_id, op_key, model_id) where scope = 'model';
comment on table public.workshop_procedures is
  'Mode operatoire ecrit par l''atelier pour une operation, quand le modele n''a pas de manuel Ducati. Par modele-annee ou par modele. ATE014, 26/11/2026.';

create table if not exists public.workshop_procedure_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  procedure_id uuid not null references public.workshop_procedures(id) on delete cascade,
  version integer not null,
  scope text not null,
  model_year_id text,
  model_id text not null,
  op_label text not null,
  steps jsonb not null,
  torques jsonb not null,
  tools jsonb not null,
  remarks text,
  edited_by uuid default auth.uid(),
  edited_by_name text,
  edited_at timestamptz not null default now(),
  unique (procedure_id, version)
);
comment on table public.workshop_procedure_versions is
  'Historique (append-only) des versions d''un mode operatoire de l''atelier. ATE014, 26/11/2026.';

drop trigger if exists trg_workshop_procedures_audit on public.workshop_procedures;
create trigger trg_workshop_procedures_audit after insert or update or delete on public.workshop_procedures
  for each row execute function public.audit_row();

alter table public.workshop_procedures enable row level security;
alter table public.workshop_procedure_versions enable row level security;
drop policy if exists workshop_procedures_select on public.workshop_procedures;
create policy workshop_procedures_select on public.workshop_procedures for select to authenticated
  using (public.is_member(company_id));
drop policy if exists workshop_procedure_versions_select on public.workshop_procedure_versions;
create policy workshop_procedure_versions_select on public.workshop_procedure_versions for select to authenticated
  using (public.is_member(company_id));
-- Ecriture : seulement par workshop_procedure_save (droits verifies, version, trace).

-- Qui peut ecrire : chef d'atelier, admin, mecanicien.
create or replace function public._can_write_workshop_procedure(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin(_company) or public.has_role(_company, 'chef_atelier'::public.app_role)
      or public.has_role(_company, 'mecanicien'::public.app_role);
$$;
revoke all on function public._can_write_workshop_procedure(uuid) from public, anon;
grant execute on function public._can_write_workshop_procedure(uuid) to authenticated;

-- Moto de l'OR → modele-annee, modele, libelles.
create or replace function public._or_model_scope(_or uuid)
returns table(company_id uuid, model_year_id text, model_year integer, model_year_name text, model_id text, model_name text, family_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.company_id, my.id, my.year, my.name, cm.id, cm.description, f.description
    from public.repair_orders r
    join public.vehicles v on v.id = r.vehicle_id
    join public.ducati_catalog_model_years my on my.id = v.ducati_model_year_id
    join public.ducati_catalog_models cm on cm.id = my.model_id
    left join public.ducati_catalog_families f on f.id = cm.family_id
   where r.id = _or;
$$;
revoke all on function public._or_model_scope(uuid) from public, anon, authenticated;

-- Ce qui s'applique aux operations de l'OR : modele-annee d'abord, sinon modele.
create or replace function public.workshop_procedures_for_or(_or uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare m record; _company uuid; _list jsonb;
begin
  select r.company_id into _company from public.repair_orders r where r.id = _or;
  if _company is null then return null; end if;
  if not public.is_member(_company) then raise exception 'Acces refuse.' using errcode = '42501'; end if;
  select * into m from public._or_model_scope(_or);
  if m.model_id is null then
    return jsonb_build_object('model_year_id', null, 'model_id', null, 'can_write', public._can_write_workshop_procedure(_company), 'procedures', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'op_id', o.id, 'op_key', o.op_key,
           'procedure', to_jsonb(p) || jsonb_build_object('versions', (select count(*) from public.workshop_procedure_versions x where x.procedure_id = p.id))
         ) order by o.sort_order), '[]'::jsonb)
    into _list
    from public.repair_order_plan_operations o
    cross join lateral (
      select w.* from public.workshop_procedures w
       where w.company_id = _company and w.op_key = public._norm_text(o.label)
         and ((w.scope = 'model_year' and w.model_year_id = m.model_year_id) or (w.scope = 'model' and w.model_id = m.model_id))
       order by (w.scope = 'model_year') desc, w.updated_at desc
       limit 1
    ) p
   where o.or_id = _or;
  return jsonb_build_object(
    'model_year_id', m.model_year_id, 'model_year', m.model_year, 'model_year_name', m.model_year_name,
    'model_id', m.model_id, 'model_name', m.model_name, 'family_name', m.family_name,
    'can_write', public._can_write_workshop_procedure(_company), 'procedures', _list);
end $$;
revoke all on function public.workshop_procedures_for_or(uuid) from public, anon;
grant execute on function public.workshop_procedures_for_or(uuid) to authenticated;

-- Enregistrer (creer ou modifier) le mode operatoire d'une operation de l'OR, pour son modele-annee
-- ou pour tout le modele. Nouvelle version a chaque enregistrement (historique), trace dans events.
create or replace function public.workshop_procedure_save(
  _or uuid, _op_label text, _scope text, _steps jsonb, _torques jsonb default '[]'::jsonb,
  _tools jsonb default '[]'::jsonb, _remarks text default null, _id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m record; p public.workshop_procedures%rowtype; n public.workshop_procedures%rowtype; _key text; _who text;
        _steps_c jsonb; _torques_c jsonb; _tools_c jsonb;
begin
  select * into m from public._or_model_scope(_or);
  if m.company_id is null then
    select r.company_id into m.company_id from public.repair_orders r where r.id = _or;
    if m.company_id is null then raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002'; end if;
  end if;
  if not public._can_write_workshop_procedure(m.company_id) then
    raise exception 'Acces refuse : chef d''atelier, mecanicien ou administrateur.' using errcode = '42501';
  end if;
  if m.model_id is null then raise exception 'Moto sans modele Ducati : reliez-la au catalogue.' using errcode = '22023'; end if;
  if _scope not in ('model_year', 'model') then raise exception 'Portee inconnue (%).', _scope using errcode = '22023'; end if;
  _key := public._norm_text(_op_label);
  if _key = '' then raise exception 'Operation sans libelle.' using errcode = '22023'; end if;
  -- Nettoyage : textes vides retires.
  select coalesce(jsonb_agg(jsonb_build_object('text', btrim(e->>'text'))), '[]'::jsonb) into _steps_c
    from jsonb_array_elements(coalesce(_steps, '[]'::jsonb)) e where btrim(coalesce(e->>'text', '')) <> '';
  select coalesce(jsonb_agg(jsonb_build_object('label', btrim(coalesce(e->>'label', '')), 'value', btrim(coalesce(e->>'value', '')))), '[]'::jsonb) into _torques_c
    from jsonb_array_elements(coalesce(_torques, '[]'::jsonb)) e where btrim(coalesce(e->>'label', '') || coalesce(e->>'value', '')) <> '';
  select coalesce(jsonb_agg(to_jsonb(btrim(e #>> '{}'))), '[]'::jsonb) into _tools_c
    from jsonb_array_elements(coalesce(_tools, '[]'::jsonb)) e where btrim(coalesce(e #>> '{}', '')) <> '';
  if jsonb_array_length(_steps_c) = 0 then raise exception 'Au moins une etape.' using errcode = '22023'; end if;
  _who := public._current_user_name();

  if _id is not null then
    select * into p from public.workshop_procedures where id = _id and company_id = m.company_id for update;
    if not found then raise exception 'Mode operatoire introuvable.' using errcode = 'P0002'; end if;
  else
    select * into p from public.workshop_procedures w
     where w.company_id = m.company_id and w.op_key = _key and w.scope = _scope
       and ((_scope = 'model_year' and w.model_year_id = m.model_year_id) or (_scope = 'model' and w.model_id = m.model_id))
     for update;
  end if;

  if p.id is null then
    insert into public.workshop_procedures (company_id, scope, model_year_id, model_id, op_key, op_label, steps, torques, tools, remarks,
                                            version, created_by_name, updated_by, updated_by_name)
    values (m.company_id, _scope, case when _scope = 'model_year' then m.model_year_id end, m.model_id, _key, btrim(_op_label),
            _steps_c, _torques_c, _tools_c, nullif(btrim(coalesce(_remarks, '')), ''), 1, _who, auth.uid(), _who)
    returning * into n;
  else
    update public.workshop_procedures
       set scope = _scope, model_year_id = case when _scope = 'model_year' then m.model_year_id end, model_id = m.model_id,
           steps = _steps_c, torques = _torques_c, tools = _tools_c, remarks = nullif(btrim(coalesce(_remarks, '')), ''),
           version = p.version + 1, updated_by = auth.uid(), updated_by_name = _who, updated_at = now()
     where id = p.id
    returning * into n;
  end if;

  insert into public.workshop_procedure_versions (company_id, procedure_id, version, scope, model_year_id, model_id, op_label, steps, torques, tools, remarks, edited_by_name)
  values (n.company_id, n.id, n.version, n.scope, n.model_year_id, n.model_id, n.op_label, n.steps, n.torques, n.tools, n.remarks, _who);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (n.company_id, auth.uid(), case when p.id is null then 'workshop_procedure_created' else 'workshop_procedure_updated' end,
          'workshop_procedures', n.id::text, 'screen',
          case when p.id is not null then jsonb_build_object('version', p.version, 'scope', p.scope, 'steps', jsonb_array_length(p.steps)) end,
          jsonb_build_object('version', n.version, 'scope', n.scope, 'model_year_id', n.model_year_id, 'model_id', n.model_id,
                             'op_label', n.op_label, 'steps', jsonb_array_length(n.steps), 'or_id', _or));
  return to_jsonb(n);
exception when unique_violation then
  raise exception 'Un mode operatoire de l''atelier existe deja pour cette operation et cette portee.' using errcode = '23505';
end $$;
revoke all on function public.workshop_procedure_save(uuid, text, text, jsonb, jsonb, jsonb, text, uuid) from public, anon;
grant execute on function public.workshop_procedure_save(uuid, text, text, jsonb, jsonb, jsonb, text, uuid) to authenticated;
