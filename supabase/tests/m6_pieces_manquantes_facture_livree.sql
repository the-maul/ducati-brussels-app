-- =====================================================================
-- Constat du 20/11/2026 — essai a blanc de 20261120365000_fix_pieces_manquantes_facture_livree.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rt.py, PRE_SQL = la migration).
--  1. La facture de l'OR test (TESTFAC-2026-00006, ItalTest, filtre + huile sortis d'un stock a 0)
--     ne reclame plus aucune piece pour le client (avant : 2).
--  2. Un document qui n'a rien sorti (devis, commande, brouillon) garde exactement le calcul d'avant :
--     manquant = besoin - max(libre, 0) - en commande - brouillons, sur 300 documents recents.
--  La sortie partielle (reste manquant) est couverte par le miroir TS (tests/orders-from-document.test.ts).
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

do $s$
declare
  _fac uuid; _n int; _bad int; _doc record; _q numeric;
begin
  select id into _fac from public.documents where number = 'TESTFAC-2026-00006'
    and company_id = '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  if _fac is null then
    insert into _t(check_name, result) values ('1. facture test presente', 'SKIP (absente)');
  else
    select count(*) into _n from public._document_order_needs(_fac) where missing_qty > 0;
    insert into _t(check_name, result) values ('1. facture validee : aucune piece manquante (avant 2)',
      case when _n = 0 then 'ok' else 'KO ' || _n end);
  end if;

  -- 2. documents sans sortie propre : formule d'avant
  _bad := 0; _n := 0;
  for _doc in
    select d.id, d.number, d.company_id from public.documents d
     where d.doc_type in ('DEV', 'BC', 'RES', 'FAC') and d.created_at > now() - interval '120 days'
       and not exists (select 1 from public.stock_moves m where m.ref = d.number and m.company_id = d.company_id and not m.is_reservation)
     order by d.created_at desc limit 300
  loop
    _n := _n + 1;
    select count(*) into _q from public._document_order_needs(_doc.id) x
     where x.missing_qty <> greatest(x.qty_needed - greatest(x.free_qty, 0) - x.on_order_qty - x.draft_qty, 0);
    _bad := _bad + _q::int;
  end loop;
  insert into _t(check_name, result) values ('2. ' || _n || ' documents sans sortie : calcul inchange',
    case when _bad = 0 then 'ok' else 'KO ' || _bad end);

  -- (la sortie partielle est couverte par tests/orders-from-document.test.ts, miroir TS)
end $s$;
