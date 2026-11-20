-- =====================================================================
-- Constat du 20/11/2026 — essai a blanc de 20261120366000_m8_operateur_or_depuis_rdv.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rt.py, PRE_SQL = la migration).
-- Societe ItalTest. Le compte de Domenico est detache de sa fiche puis relie a la fiche « John »
-- (tout est annule a la fin) :
--   1. un OR ouvert au nom de « John » (texte seul) prend le compte quand la fiche est reliee ;
--   2. un nouveau RDV de John relie a un OR sans operateur : l'OR prend le compte de John ;
--   3. un OR dont l'operateur-compte est deja choisi n'est pas ecrase ;
--   4. l'OR facture du test du 20/11 (TESTOR-2026-00001) reste intouche.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _dom uuid := '8cc89d58-fc0f-463f-b8ad-33c9e00b239a';
  _simon uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _john uuid; _or1 uuid; _or2 uuid; _or3 uuid; _op uuid; _txt text;
begin
  select id into _john from public.workshop_mechanics where company_id = _co and name = 'John';

  insert into public.repair_orders(company_id, status, operator) values (_co, 'a_faire', 'john ') returning id into _or1;
  insert into public.repair_orders(company_id, status, operator) values (_co, 'a_faire', null) returning id into _or2;
  insert into public.repair_orders(company_id, status, operator, operator_id) values (_co, 'en_cours', 'Simon', _simon) returning id into _or3;

  -- la fiche de Domenico rend son compte, la fiche John le recoit
  update public.workshop_mechanics set user_id = null where company_id = _co and user_id = _dom;
  update public.workshop_mechanics set user_id = _dom where id = _john;

  select operator_id into _op from public.repair_orders where id = _or1;
  insert into _t(check_name, result) values ('1. OR au nom de John : prend le compte a la liaison de la fiche',
    case when _op = _dom then 'ok' else 'KO ' || coalesce(_op::text, 'null') end);

  insert into public.workshop_appointments(company_id, starts_at, mechanic_id, mechanic_name, or_id, planned_minutes)
  values (_co, now() + interval '30 days', _john, 'John', _or2, 60);
  select operator_id, operator into _op, _txt from public.repair_orders where id = _or2;
  insert into _t(check_name, result) values ('2. RDV de John relie a l''OR : compte et nom passes a l''OR',
    case when _op = _dom and _txt = 'John' then 'ok' else 'KO ' || coalesce(_op::text, 'null') || ' / ' || coalesce(_txt, 'null') end);

  insert into public.workshop_appointments(company_id, starts_at, mechanic_id, mechanic_name, or_id, planned_minutes)
  values (_co, now() + interval '31 days', _john, 'John', _or3, 60);
  select operator_id into _op from public.repair_orders where id = _or3;
  insert into _t(check_name, result) values ('3. operateur-compte deja choisi : pas ecrase',
    case when _op = _simon then 'ok' else 'KO ' || coalesce(_op::text, 'null') end);

  select operator_id into _op from public.repair_orders where number = 'TESTOR-2026-00001' and company_id = _co;
  insert into _t(check_name, result) values ('4. OR facture du test : intouche',
    case when _op is null then 'ok' else 'KO ' || _op end);
end $s$;
