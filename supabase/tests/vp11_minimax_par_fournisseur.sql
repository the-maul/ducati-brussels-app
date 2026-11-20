-- =====================================================================
-- VP11 (décision du client, 20/11/2026, comme G8) — Réassort minimax : une proposition (panier) par
-- fournisseur de l'article, Ducati standard par défaut. Migration 20261120347000. ItalTest,
-- simon@themaul.be, transaction annulée (rt.py).
-- Contrôles :
--   1. pièce sans fournisseur sous son minimum, réassort accepté (minimax_proposal_apply) : panier
--      Ducati standard (sans fournisseur) ;
--   2. pièce d'un fournisseur (non DCS) : panier de CE fournisseur, libellé avec son nom ;
--   3. pièce d'un fournisseur DCS (Ducati) : panier Ducati ;
--   4. une seule acceptation des trois : deux paniers (Ducati + fournisseur), basket_ids renvoyés ;
--   5. basket_current (écran, commandes client) reste le panier Ducati ;
--   6. remplir le panier du fournisseur (_basket_fill_minimax) : seulement ses pièces ;
--   7. le fournisseur d'un panier ne change pas.
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08'; _tag text := to_char(clock_timestamp(), 'HH24MISSUS');
  _sup uuid; _dcs uuid; _a1 uuid; _a2 uuid; _a3 uuid;
begin
  insert into public.contacts (company_id, type, status, company_name, country) values (_co, 'fournisseur', 'client', 'FOURNISSEUR VP11', 'BE') returning id into _sup;
  insert into public.contacts (company_id, type, status, company_name, country, supplier_is_dcs) values (_co, 'fournisseur', 'client', 'DUCATI VP11', 'IT', true) returning id into _dcs;
  insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate, stock_min, stock_max)
  values (_co, 'VP11A' || _tag, 'Piece sans fournisseur', 'A', 21, 2, 4) returning id into _a1;
  insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate, stock_min, stock_max, main_supplier_id)
  values (_co, 'VP11B' || _tag, 'Piece du fournisseur', 'A', 21, 2, 4, _sup) returning id into _a2;
  insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate, stock_min, stock_max, main_supplier_id)
  values (_co, 'VP11C' || _tag, 'Piece Ducati DCS', 'A', 21, 2, 4, _dcs) returning id into _a3;
  perform set_config('test.sup', _sup::text, true);
  perform set_config('test.a1', _a1::text, true); perform set_config('test.a2', _a2::text, true); perform set_config('test.a3', _a3::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _sup uuid := current_setting('test.sup')::uuid;
  _a1 uuid := current_setting('test.a1')::uuid; _a2 uuid := current_setting('test.a2')::uuid; _a3 uuid := current_setting('test.a3')::uuid;
  r jsonb; _duc uuid; _bs uuid; _cur uuid; _fill jsonb;
begin
  r := public.minimax_proposal_apply(_co, jsonb_build_array(
         jsonb_build_object('article_id', _a1, 'qty', 4), jsonb_build_object('article_id', _a2, 'qty', 4),
         jsonb_build_object('article_id', _a3, 'qty', 4)), 'ESSAI-VP11');
  select l.basket_id into _duc from public.supplier_basket_lines l where l.article_id = _a1 limit 1;
  select l.basket_id into _bs from public.supplier_basket_lines l where l.article_id = _a2 limit 1;
  insert into _t(check_name, result) values
    ('piece sans fournisseur : panier Ducati standard (sans fournisseur)',
     case when (select supplier_id from public.supplier_baskets where id = _duc) is null
               and (select kind from public.supplier_baskets where id = _duc) = 'standard' then 'ok' else 'KO' end),
    ('piece d''un fournisseur : panier de ce fournisseur (' || coalesce((select label from public.supplier_baskets where id = _bs), 'null') || ')',
     case when (select supplier_id from public.supplier_baskets where id = _bs) = _sup
               and (select label from public.supplier_baskets where id = _bs) like '% — FOURNISSEUR VP11' then 'ok' else 'KO' end),
    ('piece d''un fournisseur DCS (Ducati) : panier Ducati',
     case when exists (select 1 from public.supplier_basket_lines l where l.article_id = _a3 and l.basket_id = _duc) then 'ok' else 'KO' end),
    ('une acceptation, deux paniers ; basket_ids renvoyes',
     case when jsonb_array_length(r->'basket_ids') = 2 and (r->>'added')::int = 3 then 'ok' else 'KO ' || r::text end);

  _cur := public.basket_current(_co, 'standard');
  insert into _t(check_name, result) values ('basket_current (ecran, commandes client) : toujours le panier Ducati',
    case when _cur = _duc then 'ok' else 'KO' end);

  _fill := public.basket_fill_minimax(_co, _bs);
  insert into _t(check_name, result) values ('remplir le panier du fournisseur : seulement ses pieces',
    case when not exists (select 1 from public.supplier_basket_lines l where l.basket_id = _bs and l.article_id in (_a1, _a3))
              and exists (select 1 from public.supplier_basket_lines l where l.basket_id = _bs and l.article_id = _a2) then 'ok' else 'KO' end);

  begin
    update public.supplier_baskets set supplier_id = null where id = _bs;
    insert into _t(check_name, result) values ('le fournisseur d''un panier ne change pas', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('le fournisseur d''un panier ne change pas', 'ok'); end;
end $s$;

select n, check_name, result from _t order by n;
