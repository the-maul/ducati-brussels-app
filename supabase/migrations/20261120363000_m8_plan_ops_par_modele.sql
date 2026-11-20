-- =====================================================================
-- M8 — Operations du plan d'entretien filtrees par modele (lot parcours-fix, 20/11/2026).
--
-- Constat du test du 20/11 (Monster 696) : la liste des operations de l'OR montrait
-- « Remplacement bougies (seulement Monster 821) » : les plans « Entretien Transparent » et les
-- manuels regroupent plusieurs modeles et reservent certaines operations a l'un d'eux
-- (« seulement Monster 821 », « seulement 848, 1098 et 1198 », « uniquement pour Panigale V4R MY26 »).
-- Regle (`_plan_op_applies`) : une operation dont le libelle porte « seulement / uniquement [pour] X »
-- ne s'applique que si l'un des modeles cites se retrouve dans le modele de la moto (fiche moto +
-- catalogue : famille, modele, modele-annee). Mention sans modele (« equipes d'embrayage a sec »,
-- « versions avec couvercles en magnesium », « Monster avec moteur 2 soupapes », « Model Year 2018 ») :
-- on ne tranche pas, l'operation reste (le mecanicien la marque « non faite » si besoin).
-- NB : « Controle du jeu aux soupapes (seulement Monster avec moteur 2 soupapes) » S'APPLIQUE au
-- Monster 696 (moteur 2 soupapes) : elle reste.
-- Moto sans modele connu : tout reste. OR deja construits et ouverts : les operations encore
-- « a faire » d'un autre modele passent « non faite », motif « ne_s_applique_pas » (rien n'est supprime ;
-- trace par l'audit de la table).
-- Redefinit (meme signature) : repair_order_operations_init. Essai : supabase/tests/m8_plan_ops_par_modele.sql.
-- =====================================================================

-- Modele de la moto, en texte normalise (fiche moto + catalogue Ducati).
create or replace function public._vehicle_model_descriptor(_vehicle uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(public._norm_text(concat_ws(' ', v.model, f.description, cm.description, my.name)), '')
    from public.vehicles v
    left join public.ducati_catalog_model_years my on my.id = v.ducati_model_year_id
    left join public.ducati_catalog_models cm on cm.id = my.model_id
    left join public.ducati_catalog_families f on f.id = cm.family_id
   where v.id = _vehicle;
$$;
revoke all on function public._vehicle_model_descriptor(uuid) from public, anon, authenticated;

-- L'operation s'applique-t-elle a ce modele ? (vrai sauf si elle est reservee a d'autres modeles)
create or replace function public._plan_op_applies(_label text, _descriptor text)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare _m text; _names text[]; _n text; _toks text[]; _t text; _all boolean; _d text; _dc text; _read int := 0;
begin
  if _descriptor is null or btrim(_descriptor) = '' or _label is null then return true; end if;
  -- les virgules separent des modeles (« 848, 1098 et 1198 ») : elles valent « et »
  _m := substring(public._norm_text(replace(_label, ',', ' et ')) from '(?:seulement|uniquement)(?: pour)?(?: les?)? (.*)$');
  if _m is null or btrim(_m) = '' then return true; end if;
  -- la mention s'arrete au premier mot de saisie (« valeur ... », « remarque ... »)
  _m := regexp_replace(_m, '\m(valeur|remarque|note)\M.*$', '');
  -- mention generique (equipement, version, moteur...) : on ne tranche pas
  if _m ~ '\m(avec|equip\w*|version\w*|ceux|celles|garni\w*|moteur|embrayage|couvercle\w*|carter|motos?|modeles?)\M' then return true; end if;
  -- les annees ne se comparent pas : on les retire
  _m := regexp_replace(_m, '\m(model year|my) ?[0-9]{2,4}( [0-9]{2,4})?\M', ' ', 'g');
  _m := regexp_replace(_m, '\mmy[0-9]{2,4}\M', ' ', 'g');
  _names := regexp_split_to_array(btrim(regexp_replace(_m, '\s+', ' ', 'g')), '\s*\m(?:et|ou)\M\s*');
  _d := ' ' || _descriptor || ' ';
  _dc := replace(_descriptor, ' ', '');
  foreach _n in array _names loop
    _n := btrim(_n);
    continue when _n = '';
    _read := _read + 1;
    _all := true;
    _toks := regexp_split_to_array(_n, ' ');
    foreach _t in array _toks loop
      if position(' ' || _t || ' ' in _d) = 0 then _all := false; exit; end if;
    end loop;
    if _all then return true; end if;
    -- « Panigale V4R » face a « PANIGALE V4 R » : les mots colles
    if array_length(_toks, 1) >= 2 and position(replace(_n, ' ', '') in _dc) > 0 then return true; end if;
  end loop;
  -- aucun modele cite ne correspond (rien d'exploitable lu : on garde)
  return _read = 0;
end $$;
comment on function public._plan_op_applies(text, text) is
  'Faux si le libelle d''une operation du plan est reserve (« seulement / uniquement X ») a d''autres modeles que celui decrit. Lot parcours-fix 20/11/2026.';

CREATE OR REPLACE FUNCTION public.repair_order_operations_init(_or uuid, _rebuild boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r public.repair_orders%rowtype;
  _svc text; _kinds text[]; s record; _codes text[]; _svc_label text;
  _claimed text[] := '{}'; _proc text; _n int := 0; x record; _existing int; _resolved int;
  _desc text; _skipped int := 0;
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
  -- Lot parcours-fix (20/11) : le modele de la moto, pour ecarter les operations reservees a un autre modele.
  _desc := public._vehicle_model_descriptor(r.vehicle_id);

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
      if not public._plan_op_applies(x.label, _desc) then _skipped := _skipped + 1; continue; end if;
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
      if not public._plan_op_applies(x.label, _desc) then _skipped := _skipped + 1; continue; end if;
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
      if not public._plan_op_applies(x.label, _desc) then _skipped := _skipped + 1; continue; end if;
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
          jsonb_build_object('count', _n, 'source', s.source, 'service', _svc, 'manual_id', s.manual_id, 'plan_id', s.plan_id, 'skipped_other_models', _skipped));

  return jsonb_build_object('status', case when _existing > 0 then 'rebuilt' when _n > 0 then 'created' else 'no_program' end,
                            'count', _n, 'source', s.source, 'skipped_other_models', _skipped);
end $function$
;
revoke all on function public.repair_order_operations_init(uuid, boolean) from public, anon;
grant execute on function public.repair_order_operations_init(uuid, boolean) to authenticated;

-- OR deja construits et encore ouverts : operations « a faire » d'un autre modele -> « non faite »
-- (motif ne_s_applique_pas), trace dans events (une ligne par OR).
with upd as (
  update public.repair_order_plan_operations o
     set status = 'non_fait', not_done_reason = 'ne_s_applique_pas',
         not_done_note = 'Operation reservee a un autre modele (lot parcours-fix, 20/11/2026).', updated_at = now()
    from public.repair_orders r
   where r.id = o.or_id and r.status not in ('facture', 'annule') and o.status = 'a_faire'
     and not public._plan_op_applies(o.label, public._vehicle_model_descriptor(r.vehicle_id))
  returning o.company_id, o.or_id, o.op_key, o.label
)
insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
select u.company_id, null, 'repair_order_operations_other_model', 'repair_orders', u.or_id::text, 'migration',
       jsonb_build_object('status', 'a_faire'),
       jsonb_build_object('status', 'non_fait', 'reason', 'ne_s_applique_pas',
                          'operations', jsonb_agg(jsonb_build_object('op_key', u.op_key, 'label', u.label)))
  from upd u
 group by u.company_id, u.or_id;
