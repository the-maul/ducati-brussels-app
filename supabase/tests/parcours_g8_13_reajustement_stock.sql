-- =====================================================================
-- Parcours G8 n° 13 — Réajustement de stock « annule et remplace » (lot-verif-parcours, 20/11/2026)
-- G8 : Stock › Gestion du stock réel › Réajustement de stock › Mode annule et remplace → ligne
--      (réf. 000017847) → nouveau stock 10 (ancien 3 ; nouvelle valeur 7,50 € au PAMP 0,75) → Valider
--      → édition ; mouvement tracé dans Historique mouvements. Autres modes : cumul, par code casier.
-- DMS : Stock › Réajustement (/stock/readjust, readjust-screen.tsx, onglet « Stock réel ») :
--      ReadjustGrid → liste inventory_count_list (recherche par référence) → saisie du compté →
--      Appliquer = readjustReal → RPC stock_readjust(article, compté, mode, casier, ref null, note null)
--      (mouvement « inventaire » append-only par record_stock_move) ; case « étiquettes » →
--      enqueue_labels(source 'reajustement', qté = nouveau stock). Historique : article_moves_detail.
-- Contrôles :
--   1. la grille trouve l'article par sa référence (stock réel 3, PAMP 0,75)
--   2. annule et remplace 3 → 10 : ancien 3, nouveau 10, mouvement +7
--   3. mouvement tracé : type inventaire, origine inventory, opérateur, libellé « annule et remplace »
--   4. B7 historique : ancien 3 / nouveau 10 / +7, opérateur
--   5. PAMP inchangé (0,75) ; nouvelle valeur = 10 × 0,75 = 7,50 (Édition du stock)
--   6. même saisie une 2e fois : aucun mouvement (delta 0)
--   7. étiquettes du réajustement en attente (B12) : 10, source reajustement
--   8. B6 mode cumul : +2 → 12
--   9. B6 mode par casier (multi-emplacements) : casier C2 compté 4 (+4), casier C1 compté 2 (−1)
--  10. B6 casier obligatoire en mode casier
--  11. article non stocké (type M) refusé
--  12. append-only : aucun mouvement modifiable / supprimable
-- Données : articles créés dans l'essai (ItalTest).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare
  _co  uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _me  uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _ref text := 'PG8-13-' || upper(substr(md5(random()::text), 1, 6));
  _a uuid; _c uuid; _m uuid; _r jsonb; _row record; _mv record; _ed record; _n bigint; _ok boolean; _msg text; _q int;
begin
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, vat_rate, bin_location)
  values (_co, _ref, 'Essai parcours 13', 'A', 0.75, 0.75, 21, 'R13') returning id into _a;
  perform public.record_stock_move(_a, 'entree', 3, 0.75, false, null, 'screen', 'ESSAI', 'stock de depart');

  -- 1. Grille (onglet Stock réel, recherche)
  select * into _row from public.inventory_count_list(_co, null, 'stock', _ref, null, 200, 0) l where l.article_id = _a;
  insert into _t(check_name, result) values ('grille de reajustement : article trouve par sa reference, reel 3, PAMP 0,75',
    case when _row.real_qty = 3 and _row.pamp = 0.75 and _row.reference = _ref then 'ok' else 'KO ' || coalesce(_row.real_qty::text, 'absent') end);

  -- 2. Annule et remplace 3 -> 10
  _r := public.stock_readjust(_a, 10, 'annule_remplace', null, null, null);
  insert into _t(check_name, result) values ('annule et remplace 3 -> 10 : ancien 3, nouveau 10, mouvement +7 ; stock reel 10',
    case when (_r->>'old')::numeric = 3 and (_r->>'new')::numeric = 10 and (_r->>'delta')::numeric = 7
          and (select real_qty from public.article_stock(_a)) = 10 then 'ok' else 'KO ' || _r::text end);

  -- 3. Mouvement
  select * into _mv from public.stock_moves where article_id = _a and origin = 'inventory' order by id desc limit 1;
  insert into _t(check_name, result) values ('mouvement trace : inventaire +7, origine inventory, operateur, libelle « annule et remplace », sans cout',
    case when _mv.move_type = 'inventaire' and _mv.qty_delta = 7 and _mv.operator_id = _me and not _mv.is_reservation
          and _mv.note ilike '%annule et remplace%' and _mv.unit_cost is null then 'ok' else 'KO ' || coalesce(_mv.note, '-') end);

  -- 4. B7
  select * into _row from public.article_moves_detail(_a, null, null, false) d where d.move_id = _mv.id and d.row_kind = 'move';
  insert into _t(check_name, result) values ('B7 historique : ancien stock 3, nouveau 10, mouvement +7, operateur',
    case when _row.real_before = 3 and _row.real_after = 10 and _row.qty_delta = 7 and _row.operator_name is not null then 'ok'
         else 'KO ' || coalesce(_row.real_before::text, '-') || ' -> ' || coalesce(_row.real_after::text, '-') end);

  -- 5. PAMP et valeur
  select * into _ed from public.stock_edition(_co, 'reel', jsonb_build_object('search', _ref, 'zero', 'inclus'), 10, 0) e where e.article_id = _a;
  insert into _t(check_name, result) values ('PAMP inchange 0,75 ; nouvelle valeur du stock = 10 x 0,75 = 7,50',
    case when (select pamp from public.articles where id = _a) = 0.75 and _ed.real_qty = 10 and _ed.stock_value = 7.50 then 'ok'
         else 'KO pamp ' || (select pamp from public.articles where id = _a) || ' valeur ' || coalesce(_ed.stock_value::text, '-') end);

  -- 6. Même saisie : rien
  select count(*) into _n from public.stock_moves where article_id = _a;
  _r := public.stock_readjust(_a, 10, 'annule_remplace', null, null, null);
  insert into _t(check_name, result) values ('meme comptage une deuxieme fois : delta 0, aucun mouvement ajoute',
    case when (_r->>'delta')::numeric = 0 and (select count(*) from public.stock_moves where article_id = _a) = _n then 'ok' else 'KO' end);

  -- 7. Étiquettes (case de la grille)
  _q := public.enqueue_labels(_co, jsonb_build_array(jsonb_build_object('article_id', _a, 'qty', 10)), null, 'reajustement', null, true, true, false);
  insert into _t(check_name, result) values ('B12 etiquettes du reajustement en attente : 10, source reajustement',
    case when _q = 1 and (select sum(qty) from public.label_queue where article_id = _a and source = 'reajustement' and not printed) = 10
         then 'ok' else 'KO' end);

  -- 8. Mode cumul
  _r := public.stock_readjust(_a, 2, 'cumul', null, null, null);
  insert into _t(check_name, result) values ('B6 mode cumul : +2 -> 12',
    case when (_r->>'delta')::numeric = 2 and (select real_qty from public.article_stock(_a)) = 12 then 'ok' else 'KO ' || _r::text end);

  -- 9. Mode par casier : article sur deux casiers (C1 : 3 ; C2 : 0)
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, vat_rate, bin_location, bin_location2)
  values (_co, _ref || 'C', 'Essai parcours 13 deux casiers', 'A', 2, 2, 21, 'C1', 'C2') returning id into _c;
  perform public.record_stock_move(_c, 'entree', 3, 2, false, 'C1', 'screen', 'ESSAI', 'stock de depart casier C1');
  _r := public.stock_readjust(_c, 4, 'casier', 'C2', null, null);
  _ok := (_r->>'delta')::numeric = 4 and (select real_qty from public.article_stock(_c)) = 7;
  _r := public.stock_readjust(_c, 2, 'casier', 'C1', null, null);
  insert into _t(check_name, result) values ('B6 mode par casier : C2 compte 4 (+4), C1 compte 2 (-1) -> stock 6, mouvements portant le casier',
    case when _ok and (_r->>'delta')::numeric = -1 and (select real_qty from public.article_stock(_c)) = 6
          and (select count(*) from public.stock_moves where article_id = _c and origin = 'inventory' and bin_location in ('C1', 'C2')) = 2
         then 'ok' else 'KO ' || _r::text end);

  -- 10. Casier obligatoire
  begin
    perform public.stock_readjust(_c, 1, 'casier', null, null, null); _ok := false;
  exception when others then _ok := sqlerrm like 'Casier obligatoire%'; _msg := sqlerrm; end;
  insert into _t(check_name, result) values ('B6 : casier obligatoire en mode casier', case when _ok then 'ok' else 'KO ' || coalesce(_msg, '') end);

  -- 11. Non stocké
  insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate)
  values (_co, _ref || 'M', 'Essai non stocke', 'M', 21) returning id into _m;
  begin
    perform public.stock_readjust(_m, 5, 'annule_remplace', null, null, null); _ok := false;
  exception when others then _ok := sqlerrm like 'Article non stocké%'; _msg := sqlerrm; end;
  insert into _t(check_name, result) values ('article non stocke (type M) : reajustement refuse', case when _ok then 'ok' else 'KO ' || coalesce(_msg, '') end);

  -- 12. Append-only
  begin
    update public.stock_moves set qty_delta = 99 where id = _mv.id;
    _ok := not found;
  exception when others then _ok := true; end;
  begin
    delete from public.stock_moves where id = _mv.id;
    _ok := _ok and not found;
  exception when others then null; end;
  insert into _t(check_name, result) values ('append-only : le mouvement de reajustement ne se modifie ni ne se supprime',
    case when _ok and (select qty_delta from public.stock_moves where id = _mv.id) = 7 then 'ok' else 'KO' end);
end $s$;
select n, check_name, result from _t order by n;
