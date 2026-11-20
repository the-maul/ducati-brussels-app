-- =====================================================================
-- Constat 6 du test du 20/11/2026 — essai a blanc de 20261120363000_m8_plan_ops_par_modele.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rt.py, PRE_SQL = la migration).
--   1-6. regle `_plan_op_applies` sur des libelles reels des plans ;
--   7. nouvel OR « Entretien annuel + huile » sur le Monster 696 du test : pas de
--      « Remplacement bougies (seulement Monster 821) », mais le jeu aux soupapes « Monster avec
--      moteur 2 soupapes » reste ; l'operation ecartee est comptee (skipped_other_models).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _veh uuid := 'ea9f97ef-792b-4a04-a144-1cb95a042eb9';
  _desc text := public._vehicle_model_descriptor('ea9f97ef-792b-4a04-a144-1cb95a042eb9');
  _or uuid; _res jsonb; _n821 int; _nsoup int; _uid uuid;
begin
  insert into _t(check_name, result) values ('0. descripteur du Monster 696 : ' || coalesce(_desc, 'null'),
    case when _desc like '%monster%' and _desc like '%696%' then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('1. « seulement Monster 821 » sur un 696 : ecartee',
    case when not public._plan_op_applies('Remplacement bougies (seulement Monster 821)', _desc) then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('2. « seulement Monster 821 » sur un 821 : gardee',
    case when public._plan_op_applies('Remplacement bougies (seulement Monster 821)', 'monster 821 monster 821 2016') then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('3. « Monster avec moteur 2 soupapes » : generique, gardee',
    case when public._plan_op_applies('Contrôle et/ou réglage du jeu aux soupapes (seulement Monster avec moteur 2 soupapes)', _desc) then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('4. « seulement 848, 1098 et 1198 » : 1098 garde, 696 ecarte',
    case when public._plan_op_applies('Remplacement des courroies de distribution (seulement 848, 1098 et 1198)', 'superbike 1098 1098 s')
          and not public._plan_op_applies('Remplacement des courroies de distribution (seulement 848, 1098 et 1198)', _desc) then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('5. « uniquement pour Panigale V4R MY26 » sur Panigale V4 R : gardee ; sur V4 S : ecartee',
    case when public._plan_op_applies('Contrôle du fonctionnement du système Neutral Lock (uniquement pour Panigale V4R MY26)', 'panigale panigale v4 r 2026')
          and not public._plan_op_applies('Contrôle du fonctionnement du système Neutral Lock (uniquement pour Panigale V4R MY26)', 'panigale panigale v4 s 2026') then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('6. sans mention, ou moto sans modele : gardee',
    case when public._plan_op_applies('Vidange de l''huile moteur et remplacement du filtre', _desc)
          and public._plan_op_applies('Remplacement bougies (seulement Monster 821)', null) then 'ok' else 'KO' end);

  -- 7. nouvel OR sur la moto du test
  select ur.user_id into _uid from public.user_roles ur join public.profiles p on p.id = ur.user_id
   where ur.company_id = _co and p.is_active and ur.role in ('admin', 'chef_atelier') limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  insert into public.repair_orders(company_id, status, vehicle_id, mileage, reason_code, service_code)
  values (_co, 'a_faire', _veh, 24500, 'entretien_annuel_huile', 'oil') returning id into _or;
  _res := public.repair_order_operations_init(_or, false);
  select count(*) filter (where label ilike '%Monster 821%'), count(*) filter (where label ilike '%2 soupapes%') into _n821, _nsoup
    from public.repair_order_plan_operations where or_id = _or;
  insert into _t(check_name, result) values ('7. OR du 696 : 821 absente, 2 soupapes presente (' || _res::text || ')',
    case when _n821 = 0 and _nsoup = 1 and coalesce((_res->>'skipped_other_models')::int, 0) >= 1 then 'ok'
         else 'KO 821=' || _n821 || ' soupapes=' || _nsoup end);

  -- 8. rattrapage des OR ouverts (fait par la migration dans cette transaction) : trace dans events
  insert into _t(check_name, result)
  select '8. OR ouverts rattrapes : ' || count(distinct e.entity_id) || ' OR, ' || count(op) || ' operation(s) : '
         || coalesce(string_agg(distinct left(op->>'label', 60), ' | '), '-'), 'ok'
    from public.events e left join lateral jsonb_array_elements(e.new_data->'operations') op on true
   where e.action = 'repair_order_operations_other_model' and e.occurred_at >= now() - interval '1 minute';
end $s$;
