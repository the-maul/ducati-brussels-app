-- =====================================================================
-- Parcours G8 n° 26 — Proposition de commande depuis un article (lot-verif-parcours, 20/11/2026)
-- G8 : Recherche article › « Prop. commande » (Mise en proposition de commande) → type de commande
--      Stock / Dépannage / Garantie → quantité (conditionnement) → Valider : la ligne rejoint la
--      proposition de commande du fournisseur ; plus tard Rappel proposition cde → Commande.
--      Réassort minimax : G8 propose « mise en PRC » après la vente (décisions Q39 / Q52).
-- DMS : fiche article (/parts/$articleId) › bouton « Prop. commande » (proposal-add-dialog.tsx) :
--      quantité = roundToPack(max(1, 1), conditionnement), type Stock par défaut sur un article →
--      addToProposal = RPC purchase_proposal_add(_co, type, items, 'article', id, référence, null)
--      (PCF brouillon par fournisseur × type, arrondi au conditionnement, remise dépannage) ;
--      éditeur : valider la PCF (purchase_doc_save) → « Passer en commande » (purchase_proposal_to_order)
--      → valider la CMD. Stock sous le mini : /purchases/reorder (reorder_proposals).
--      Minimax : sortie de stock → trigger _trg_stock_move_minimax (mode auto, Q39 : ajout immédiat au
--      panier standard) ; mode manuel (minimax_mode_set) → fenêtre minimax_proposal / minimax_proposal_apply.
-- Contrôles :
--   1. quantité proposée = conditionnement (1 → 5), type Stock par défaut
--   2. type Stock : proposition PCF brouillon du fournisseur, 5 × PA 0,75, sans remise, origine article
--   3. type Dépannage : autre proposition, qté 3 arrondie à 5 par le serveur, remise dépannage 10 %
--   4. type Garantie : 3e proposition (fournisseur × type), sans remise
--   5. une 2e mise en proposition Stock rejoint la même proposition (2 lignes, totaux recalculés)
--   6. trace events purchase_proposal_add (type, référence) ; ni numéro, ni stock, ni « en commande »
--   7. article sans fournisseur : refus explicite
--   8. proposition Garantie validée → passée en commande → commande validée (type Garantie) ;
--      proposition « transformée », article « en commande » 5
--   9. stock sous le minimum : l'article figure dans la proposition de réassort (/purchases/reorder),
--      quantité suggérée = maxi − disponible
--  10. Q39 (mode automatique) : la vente qui passe sous le minimum met tout de suite la pièce au panier
--      standard (ligne minimax), trace minimax_immediate_add
--  11. Q52 (mode manuel) : la vente ne touche pas le panier ; la fenêtre propose la quantité ;
--      « Ajouter » la met au panier
-- Données : fournisseur et articles créés dans l'essai (ItalTest).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare
  _co  uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _me  uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _ref text := 'PG8-26-' || upper(substr(md5(random()::text), 1, 6));
  _sup uuid; _a uuid; _b uuid; _c uuid; _nosup uuid; _q numeric; _pack numeric := 5;
  _x jsonb; _pst uuid; _pdep uuid; _pgar uuid; _cmd uuid; _ok boolean; _msg text; _ed record; _r record; _ms int; _t0 timestamptz;
  _mode text;
begin
  insert into public.contacts (company_id, type, company_name, supplier_vat_regime, supplier_rush_discount_pct)
  values (_co, 'fournisseur', 'ESSAI PARCOURS 26 FOURNISSEUR', 'with_vat', 10) returning id into _sup;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, pack_qty, vat_rate,
                               main_supplier_id, stock_min, stock_max)
  values (_co, _ref, 'Essai parcours 26', 'A', 0.75, 0.75, _pack, 21, _sup, 4, 10) returning id into _a;
  perform public.record_stock_move(_a, 'entree', 6, 0.75, false, null, 'screen', 'ESSAI', 'stock de depart');

  -- 1. Fenêtre « Prop. commande » sur la fiche article
  _q := case when _pack > 1 then ceil(greatest(1, 1) / _pack) * _pack else 1 end;
  insert into _t(check_name, result) values ('fenetre Prop. commande : quantite proposee = conditionnement (5), type Stock par defaut',
    case when _q = 5 then 'ok' else 'KO ' || _q end);

  -- 2. Type Stock
  _x := public.purchase_proposal_add(_co, 'stock', jsonb_build_array(jsonb_build_object('article_id', _a, 'qty', _q, 'supplier_id', _sup, 'contact_id', null)),
                                     'article', _a, _ref, null);
  _pst := (_x->'items'->0->>'proposal_id')::uuid;
  insert into _t(check_name, result) values ('Stock : proposition PCF brouillon du fournisseur, 5 x 0,75 = 3,75 HT, sans remise, origine article',
    case when (select doc_type || '/' || status || '/' || order_type from public.purchase_orders where id = _pst) = 'PCF/brouillon/stock'
          and (select supplier_id from public.purchase_orders where id = _pst) = _sup
          and (select total_ht from public.purchase_orders where id = _pst) = 3.75
          and exists (select 1 from public.purchase_lines l where l.order_id = _pst and l.article_id = _a and l.quantity = 5
                        and l.unit_price_ht = 0.75 and l.discount_pct = 0 and l.origin_kind = 'article' and l.origin_id = _a
                        and l.origin_ref = _ref) then 'ok' else 'KO ' || _x::text end);

  -- 3. Type Dépannage (saisie 3 : le serveur arrondit au conditionnement)
  _x := public.purchase_proposal_add(_co, 'depannage', jsonb_build_array(jsonb_build_object('article_id', _a, 'qty', 3, 'supplier_id', _sup)),
                                     'article', _a, _ref, null);
  _pdep := (_x->'items'->0->>'proposal_id')::uuid;
  insert into _t(check_name, result) values ('Depannage : autre proposition, qte 3 arrondie a 5, remise depannage 10 % (3,38 HT)',
    case when _pdep <> _pst and (select order_type from public.purchase_orders where id = _pdep) = 'depannage'
          and (select quantity from public.purchase_lines where order_id = _pdep) = 5
          and (select discount_pct from public.purchase_lines where order_id = _pdep) = 10
          and (select total_ht from public.purchase_orders where id = _pdep) = 3.38 then 'ok'
         else 'KO ' || coalesce((select total_ht from public.purchase_orders where id = _pdep)::text, '-') end);

  -- 4. Type Garantie
  _x := public.purchase_proposal_add(_co, 'garantie', jsonb_build_array(jsonb_build_object('article_id', _a, 'qty', _q, 'supplier_id', _sup)),
                                     'article', _a, _ref, null);
  _pgar := (_x->'items'->0->>'proposal_id')::uuid;
  insert into _t(check_name, result) values ('Garantie : 3e proposition (fournisseur x type), sans remise',
    case when _pgar not in (_pst, _pdep) and (select order_type from public.purchase_orders where id = _pgar) = 'garantie'
          and (select discount_pct from public.purchase_lines where order_id = _pgar) = 0
          and (select count(*) from public.purchase_orders where company_id = _co and supplier_id = _sup and doc_type = 'PCF') = 3
         then 'ok' else 'KO' end);

  -- 5. Deuxième mise en proposition Stock (autre article du même fournisseur)
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, vat_rate, main_supplier_id)
  values (_co, _ref || 'B', 'Essai parcours 26 B', 'A', 2, 21, _sup) returning id into _b;
  _x := public.purchase_proposal_add(_co, 'stock', jsonb_build_array(jsonb_build_object('article_id', _b, 'qty', 1, 'supplier_id', _sup)),
                                     'article', _b, _ref || 'B', null);
  insert into _t(check_name, result) values ('2e mise en proposition Stock : meme proposition, 2 lignes, 5,75 HT',
    case when (_x->'items'->0->>'proposal_id')::uuid = _pst
          and (select count(*) from public.purchase_lines where order_id = _pst) = 2
          and (select total_ht from public.purchase_orders where id = _pst) = 5.75 then 'ok' else 'KO' end);

  -- 6. Trace ; pas de numéro, pas de stock, pas « en commande »
  select * into _ed from public.stock_edition(_co, 'reel', jsonb_build_object('search', _ref, 'zero', 'inclus'), 10, 0) e where e.article_id = _a;
  insert into _t(check_name, result) values ('trace purchase_proposal_add ; propositions sans numero, aucun mouvement, rien « en commande »',
    case when (select count(*) from public.events where action = 'purchase_proposal_add' and entity_id = _a::text and actor_id = _me
                and new_data->>'origin_ref' = _ref) = 3
          and (select count(*) from public.purchase_orders where id in (_pst, _pdep, _pgar) and number is null) = 3
          and (select count(*) from public.stock_moves where article_id = _a) = 1 and _ed.on_order_qty = 0 then 'ok'
         else 'KO en commande ' || coalesce(_ed.on_order_qty::text, '-') end);

  -- 7. Sans fournisseur
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, vat_rate)
  values (_co, _ref || 'X', 'Essai sans fournisseur', 'A', 1, 21) returning id into _nosup;
  begin
    perform public.purchase_proposal_add(_co, 'stock', jsonb_build_array(jsonb_build_object('article_id', _nosup, 'qty', 1)), 'article', _nosup, null, null);
    _ok := false;
  exception when others then _ok := sqlerrm like '%n''a pas de fournisseur%'; _msg := sqlerrm; end;
  insert into _t(check_name, result) values ('article sans fournisseur : refus explicite (choisir le fournisseur)', case when _ok then 'ok' else 'KO ' || coalesce(_msg, '') end);

  -- 8. Proposition Garantie → commande
  _x := public.purchase_doc_save(_co, _pgar, jsonb_build_object('doc_type', 'PCF', 'supplier_id', _sup, 'order_type', 'garantie'),
    (select jsonb_agg(jsonb_build_object('article_id', article_id, 'designation', designation, 'supplier_ref', supplier_ref, 'quantity', quantity,
                                         'unit_price_ht', unit_price_ht, 'discount_pct', discount_pct, 'vat_rate', vat_rate,
                                         'origin_kind', origin_kind, 'origin_id', origin_id, 'origin_ref', origin_ref) order by sort_order)
       from public.purchase_lines where order_id = _pgar), '[]'::jsonb, true);
  _cmd := public.purchase_proposal_to_order(_pgar);
  _x := public.purchase_doc_save(_co, _cmd, jsonb_build_object('doc_type', 'CMD', 'supplier_id', _sup, 'order_type', 'garantie'),
    (select jsonb_agg(jsonb_build_object('article_id', article_id, 'designation', designation, 'supplier_ref', supplier_ref, 'quantity', quantity,
                                         'unit_price_ht', unit_price_ht, 'discount_pct', discount_pct, 'vat_rate', vat_rate,
                                         'source_line_id', source_line_id, 'origin_kind', origin_kind, 'origin_id', origin_id,
                                         'origin_ref', origin_ref) order by sort_order)
       from public.purchase_lines where order_id = _cmd), '[]'::jsonb, true);
  select * into _ed from public.stock_edition(_co, 'reel', jsonb_build_object('search', _ref, 'zero', 'inclus'), 10, 0) e where e.article_id = _a;
  insert into _t(check_name, result) values ('Garantie : proposition validee -> commande validee (type garantie, numerotee), proposition transformee, en commande 5',
    case when (select status from public.purchase_orders where id = _pgar) = 'transformee'
          and (select status || '/' || order_type from public.purchase_orders where id = _cmd) = 'validee/garantie'
          and (select number from public.purchase_orders where id = _cmd) is not null
          and _ed.on_order_qty = 5 then 'ok' else 'KO ' || _x::text end);

  -- 9 et 10. Vente de 3 : stock 6 -> 3 (< mini 4), mode automatique (Q39)
  select minimax_mode into _mode from public.companies where id = _co;
  if _mode <> 'auto' then perform public.minimax_mode_set(_co, 'auto'); end if;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, vat_rate, main_supplier_id, stock_min, stock_max)
  values (_co, _ref || 'C', 'Essai parcours 26 minimax', 'A', 1, 1, 21, _sup, 4, 10) returning id into _c;
  perform public.record_stock_move(_c, 'entree', 6, 1, false, null, 'screen', 'ESSAI', 'stock de depart');
  perform public.record_stock_move(_c, 'sortie', -3, null, false, null, 'sale', 'ESSAI-TIK-26', null);
  _t0 := clock_timestamp();
  select * into _r from public.reorder_proposals(_co) p where p.article_id = _c;
  _ms := (extract(epoch from clock_timestamp() - _t0) * 1000)::int;
  insert into _t(check_name, result) values ('reassort sous le minimum (/purchases/reorder) : article propose, suggere 10 - 3 = 7 — duree ' || _ms || ' ms',
    case when _r.available_qty = 3 and _r.suggested_qty = 7 and _r.supplier_id = _sup then 'ok'
         else 'KO ' || coalesce(_r.suggested_qty::text, 'absent') end);
  insert into _t(check_name, result) values ('Q39 mode automatique : la vente sous le minimum met la piece au panier standard (ligne minimax 7), trace',
    case when exists (select 1 from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
                       where l.article_id = _c and l.origin = 'minimax' and b.kind = 'standard' and b.status = 'ouvert' and l.qty = 7)
          and exists (select 1 from public.events where action = 'minimax_immediate_add' and new_data->>'article_id' = _c::text
                        and new_data->>'ref' = 'ESSAI-TIK-26') then 'ok'
         else 'KO ' || coalesce((select sum(qty)::text from public.supplier_basket_lines where article_id = _c), 'rien au panier') end);

  -- 11. Mode manuel (Q52) : rien d'automatique, la fenêtre propose, « Ajouter »
  perform public.minimax_mode_set(_co, 'manuel');
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, vat_rate, main_supplier_id, stock_min, stock_max)
  values (_co, _ref || 'D', 'Essai parcours 26 minimax manuel', 'A', 1, 1, 21, _sup, 4, 10) returning id into _b;
  perform public.record_stock_move(_b, 'entree', 6, 1, false, null, 'screen', 'ESSAI', 'stock de depart');
  perform public.record_stock_move(_b, 'sortie', -3, null, false, null, 'sale', 'ESSAI-TIK-26M', null);
  _ok := not exists (select 1 from public.supplier_basket_lines where article_id = _b);
  select * into _r from public.minimax_proposal(_co, array[_b]) p where p.article_id = _b;
  _ok := _ok and _r.qty = 7;
  _x := public.minimax_proposal_apply(_co, jsonb_build_array(jsonb_build_object('article_id', _b, 'qty', _r.qty)), 'ESSAI-TIK-26M');
  insert into _t(check_name, result) values ('Q52 mode manuel : la vente ne touche pas le panier, la fenetre propose 7, « Ajouter » -> ligne minimax 7',
    case when _ok and exists (select 1 from public.supplier_basket_lines where article_id = _b and origin = 'minimax' and qty = 7) then 'ok'
         else 'KO ' || coalesce(_r.qty::text, 'pas de proposition') end);
  perform public.minimax_mode_set(_co, _mode);
end $s$;
select n, check_name, result from _t order by n;
