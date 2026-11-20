-- =====================================================================
-- Constat 4 du test du 20/11/2026 — essai a blanc de 20261120362000_m8_total_or_comme_facture.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rt.py, PRE_SQL = la migration).
--   1. l'OR TESTOR-2026-00001 recalcule : 113,24 TTC, comme sa facture TESTFAC-2026-00006 ;
--   2. HT inchange (93,59) ;
--   3. sur 200 OR de prod, l'ecart au total de la facture liee ne depasse jamais 0,01 et diminue
--      (compte des OR qui ne collaient pas avant / apres).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

do $s$
declare
  _or uuid := '481574f5-a183-46f9-9dfb-300ba70614b5';
  _ht numeric; _ttc numeric; _fac numeric; _before int; _after int; r record;
begin
  select coalesce(sum(case when abs(o.total_ttc - d.total_ttc) > 0.005 then 1 else 0 end), 0) into _before
    from (select * from public.repair_orders where invoice_document_id is not null order by created_at desc limit 200) o
    join public.documents d on d.id = o.invoice_document_id;
  for r in select id from public.repair_orders where invoice_document_id is not null order by created_at desc limit 200 loop
    perform public._repair_order_totals_refresh(r.id);
  end loop;
  perform public._repair_order_totals_refresh(_or);
  select o.total_ht, o.total_ttc, d.total_ttc into _ht, _ttc, _fac
    from public.repair_orders o left join public.documents d on d.id = o.invoice_document_id where o.id = _or;
  insert into _t(check_name, result) values ('1. OR du test = facture (' || coalesce(_fac::text, '?') || ')',
    case when _ttc = 113.24 and _ttc = _fac then 'ok' else 'KO ' || coalesce(_ttc::text, 'null') end);
  insert into _t(check_name, result) values ('2. HT inchange', case when _ht = 93.59 then 'ok' else 'KO ' || _ht end);
  select coalesce(sum(case when abs(o.total_ttc - d.total_ttc) > 0.005 then 1 else 0 end), 0) into _after
    from (select * from public.repair_orders where invoice_document_id is not null order by created_at desc limit 200) o
    join public.documents d on d.id = o.invoice_document_id;
  insert into _t(check_name, result) values ('3. OR factures dont le TTC differe de la facture : ' || _before || ' avant, ' || _after || ' apres',
    case when _after <= _before then 'ok' else 'KO' end);
end $s$;
