-- =====================================================================
-- Constat 2 du test du 20/11/2026 — essai a blanc de 20261120361000_m8_mo_forfait_entretien.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rt.py, PRE_SQL = la migration).
-- Moto du test : Monster 696 (ZDMM500AA8B001777, modele-annee 1634), societe ItalTest.
--   1. « Entretien annuel + huile » (oil) : la MO arrive avec le temps du forfait G8
--      ENTRETIEN ANNUEL 2 SOUPAPES (1,80 h), article MO de type T ;
--   2. « Entretien annuel » (annual) : forfait OIL SERVICE 2 SOUPAPES (1,00 h) ;
--   3. les lignes du kit mises sur l'OR (workshop_service_kit_lines) contiennent UNE ligne MO,
--      a la fin, et toujours le filtre et l'huile ;
--   4. un kit qui porte deja sa MO : pas de seconde ligne MO ;
--   5. les heures sont lues dans la nomenclature (si l'atelier change le forfait, l'OR suit).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _veh uuid := 'ea9f97ef-792b-4a04-a144-1cb95a042eb9';
  _h numeric; _ref text; _type text; _n int; _last text; _filter int; _kid uuid; _mo uuid; _fid uuid;
begin
  select l.hours, a.reference, a.mgmt_type into _h, _ref, _type
    from public._workshop_service_labour(_co, '1634', 'oil') l join public.articles a on a.id = l.article_id;
  insert into _t(check_name, result) values ('1. oil : MO 1,80 h (ENTRETIEN ANNUEL 2 SOUPAPES), type T',
    case when _h = 1.8 and _type = 'T' then 'ok' else 'KO ' || coalesce(_h::text, 'null') || ' / ' || coalesce(_type, 'null') end);

  select l.hours into _h from public._workshop_service_labour(_co, '1634', 'annual') l;
  insert into _t(check_name, result) values ('2. annual : MO 1,00 h (OIL SERVICE 2 SOUPAPES)',
    case when _h = 1.0 then 'ok' else 'KO ' || coalesce(_h::text, 'null') end);

  -- lignes du kit vues par l'application (is_member : le test tourne comme le service, sans auth)
  perform set_config('request.jwt.claims', json_build_object('sub', (select ur.user_id from public.user_roles ur join public.profiles p on p.id = ur.user_id where ur.company_id = _co and p.is_active limit 1), 'role', 'authenticated')::text, true);
  select count(*) filter (where a.mgmt_type = 'T'), count(*) filter (where k.designation ilike '%filtre%')
    into _n, _filter
    from public.workshop_service_kit_lines(_veh, 'oil') k left join public.articles a on a.id = k.article_id;
  select a.mgmt_type into _last
    from public.workshop_service_kit_lines(_veh, 'oil') with ordinality k left join public.articles a on a.id = k.article_id
   order by ordinality desc limit 1;
  insert into _t(check_name, result) values ('3. lignes du kit vers l''OR : une MO, en dernier, filtre toujours la',
    case when _n = 1 and _last = 'T' and _filter >= 1 then 'ok' else 'KO mo=' || _n || ' dernier=' || coalesce(_last, 'null') || ' filtre=' || _filter end);

  -- 4. un kit de l'entretien porte deja une MO
  select l.article_id into _mo from public._workshop_service_labour(_co, '1634', 'oil') l;
  _kid := public._workshop_kit_for(_co, '1634', 'oil');
  insert into public.maintenance_kit_items(company_id, kit_id, article_id, reference, designation, quantity, kind, origin, sort_order)
  values (_co, _kid, _mo, 'MO', 'MO deja dans le kit', 2, 'forfait', 'ajoute', 999);
  select count(*) into _n from public._workshop_service_labour(_co, '1634', 'oil');
  insert into _t(check_name, result) values ('4. kit qui porte deja sa MO : pas de seconde ligne', case when _n = 0 then 'ok' else 'KO ' || _n end);
  delete from public.maintenance_kit_items where kit_id = _kid and designation = 'MO deja dans le kit';

  -- 5. heures lues dans la nomenclature
  select a.id into _fid from public.articles a where a.company_id = _co and a.mgmt_type = 'N' and upper(a.designation) = 'ENTRETIEN ANNUEL 2 SOUPAPES' limit 1;
  update public.article_kit_items k set quantity = 2.5 from public.articles c
   where k.kit_id = _fid and c.id = k.component_id and c.mgmt_type = 'T';
  select l.hours into _h from public._workshop_service_labour(_co, '1634', 'oil') l;
  insert into _t(check_name, result) values ('5. heures lues dans le forfait (2,5 h apres modification)', case when _h = 2.5 then 'ok' else 'KO ' || coalesce(_h::text, 'null') end);
end $s$;
