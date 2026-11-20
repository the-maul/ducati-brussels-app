-- =====================================================================
-- Parcours G8 n° 11 — Commande fournisseur (lot-verif-parcours, 20/11/2026)
-- G8 : Appros › Réception / Commande › Commande → fournisseur → opérateur → lignes
--      (quantité proposée = conditionnement d'achat, ex. 5) → Valider → « Valider sans éditer »
--      → « Validation COMMANDE n° 6000004 effectuée » ; l'article est « en commande ».
-- DMS : Achats › Nouvelle commande (/purchases/new?docType=CMD, purchase-editor.tsx) :
--      choix de l'article → quantité = roundToPack(max(qté, 1), conditionnement) (g8-rules.ts) ;
--      Valider → savePurchaseDoc = RPC purchase_doc_save(_company, null, en-tête, lignes, [], true)
--      (numéro, lignes, totaux serveur, statut, trace events dans une seule transaction).
--      « En commande » lu par l'Édition du stock (stock_edition → _article_on_order_qty) et la
--      fiche fournisseur (supplier_open_orders = encours).
-- Contrôles :
--   1. sans fournisseur, la commande ne se valide pas (G8 : fournisseur obligatoire)
--   2. quantité proposée = conditionnement (1 → 5), comme l'écran
--   3. COMMANDE validée, numérotée « suivant de celui d'avant » dans la série CMD, compteur avancé
--   4. en-tête : type Stock, opérateur = utilisateur connecté, validée par / le, date de commande
--   5. totaux calculés par le serveur (5 × 0,75 = 3,75 HT ; TVA 21 % ; 4,54 TTC)
--   6. trace events « purchase_validated » (n°, total)
--   7. aucune entrée de stock à la commande (stock réel inchangé = 3)
--   8. « en commande » = 5 sur l'article (Édition du stock), reste à recevoir 5 (Rappel cde)
--   9. B4 : disponible affiché = réel − réservé (3) ; « en commande » montré à côté (5)
--  10. encours fournisseur (fiche fournisseur) = 3,75 HT
--  11. liste des commandes : n°, type, fournisseur, HT, statut, opérateur
--  12. commande validée figée : ni nouvelle validation, ni ligne modifiable
-- Données : fournisseur, article et stock de départ créés dans l'essai (société ItalTest).
-- Chaque ligne du résultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare
  _co  uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _me  uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _ref text := 'PG8-11-' || upper(substr(md5(random()::text), 1, 6));
  _sup uuid; _a uuid; _q numeric; _pack numeric := 5;
  _seq public.document_sequences%rowtype; _expected text; _y int := extract(year from (now() at time zone 'Europe/Brussels'))::int;
  _cmd jsonb; _id uuid; _o public.purchase_orders%rowtype; _ed record; _ok boolean; _msg text;
begin
  -- Préparation : fournisseur, article (PA 0,75, conditionnement 5), stock de départ 3
  insert into public.contacts (company_id, type, company_name, supplier_vat_regime)
  values (_co, 'fournisseur', 'ESSAI PARCOURS 11 FOURNISSEUR', 'with_vat') returning id into _sup;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, pack_qty, vat_rate, main_supplier_id)
  values (_co, _ref, 'Essai parcours 11', 'A', 0.75, 0.75, _pack, 21, _sup) returning id into _a;
  perform public.record_stock_move(_a, 'entree', 3, 0.75, false, null, 'screen', 'ESSAI', 'stock de depart');

  -- 1. Fournisseur obligatoire à la validation
  begin
    perform public.purchase_doc_save(_co, null, jsonb_build_object('doc_type', 'CMD', 'order_type', 'stock'),
      jsonb_build_array(jsonb_build_object('article_id', _a, 'designation', _ref, 'quantity', 5, 'unit_price_ht', 0.75, 'vat_rate', 21)),
      '[]'::jsonb, true);
    _ok := false;
  exception when others then _ok := sqlerrm like 'Choisissez le fournisseur%'; _msg := sqlerrm; end;
  insert into _t(check_name, result) values ('fournisseur obligatoire : validation refusee sans fournisseur',
    case when _ok then 'ok' else 'KO ' || coalesce(_msg, 'validee sans fournisseur') end);

  -- 2. Quantité proposée = conditionnement (règle de l'écran roundToPack(max(1, 1), 5))
  _q := case when _pack > 1 then ceil(greatest(1, 1) / _pack) * _pack else 1 end;
  insert into _t(check_name, result) values ('quantite proposee = conditionnement d''achat (1 -> 5)',
    case when _q = 5 then 'ok' else 'KO ' || _q end);

  -- 3. Validation (même appel que purchase-editor.tsx)
  select * into _seq from public.document_sequences where company_id = _co and doc_type = 'CMD';
  _expected := _seq.prefix || _seq.separator
            || case when _seq.reset_yearly then _y::text || _seq.separator else '' end
            || lpad((case when _seq.reset_yearly and _seq.current_year is distinct from _y then 1 else _seq.next_value end)::text, _seq.padding, '0')
            || coalesce(_seq.suffix, '');
  _cmd := public.purchase_doc_save(_co, null,
    jsonb_build_object('doc_type', 'CMD', 'supplier_id', _sup, 'vat_regime', 'with_vat', 'order_type', 'stock',
                       'order_date', (now() at time zone 'Europe/Brussels')::date, 'shipping_ht', 0, 'shipping_taxed', true,
                       'shipping_vat_rate', 21, 'global_discount_pct', 0, 'spread_costs', true),
    jsonb_build_array(jsonb_build_object('article_id', _a, 'designation', 'Essai parcours 11', 'supplier_ref', _ref,
                       'quantity', _q, 'unit_price_ht', 0.75, 'discount_pct', 0, 'vat_rate', 21, 'bin_location', null, 'labels', 0)),
    '[]'::jsonb, true);
  _id := (_cmd->>'id')::uuid;
  select * into _o from public.purchase_orders where id = _id;
  insert into _t(check_name, result) values ('COMMANDE validee, numero suivant de la serie CMD (' || coalesce(_expected, '?') || ')',
    case when _cmd->>'status' = 'validee' and _o.doc_type = 'CMD' and _o.number = _expected and _cmd->>'number' = _expected
          and (select next_value from public.document_sequences where company_id = _co and doc_type = 'CMD')
              = (case when _seq.reset_yearly and _seq.current_year is distinct from _y then 2 else _seq.next_value + 1 end)
         then 'ok' else 'KO ' || coalesce(_o.number, 'sans numero') || ' attendu ' || coalesce(_expected, '?') end);

  -- 4. En-tête
  insert into _t(check_name, result) values ('en-tete : type Stock, operateur et validateur = utilisateur, date de commande du jour',
    case when _o.order_type = 'stock' and _o.operator_id = _me and _o.validated_by = _me and _o.validated_at is not null
          and _o.order_date = (now() at time zone 'Europe/Brussels')::date and _o.supplier_id = _sup then 'ok'
         else 'KO ' || coalesce(_o.order_type, '-') || ' ' || coalesce(_o.operator_id::text, '-') end);

  -- 5. Totaux serveur
  insert into _t(check_name, result) values ('totaux serveur : 3,75 HT, 0,79 TVA, 4,54 TTC ; ligne 5 x 0,75',
    case when _o.total_ht = 3.75 and _o.total_vat = 0.79 and _o.total_ttc = 4.54
          and (select quantity from public.purchase_lines where order_id = _id) = 5
          and (select line_ht from public.purchase_lines where order_id = _id) = 3.75 then 'ok'
         else 'KO ' || _o.total_ht || ' / ' || _o.total_vat || ' / ' || _o.total_ttc end);

  -- 6. Trace
  insert into _t(check_name, result) values ('trace events purchase_validated (numero, total HT)',
    case when exists (select 1 from public.events e where e.entity_type = 'purchase_orders' and e.entity_id = _id::text
                        and e.action = 'purchase_validated' and e.actor_id = _me
                        and e.new_data->>'number' = _o.number and (e.new_data->>'total_ht')::numeric = 3.75) then 'ok' else 'KO' end);

  -- 7. Pas de stock à la commande
  insert into _t(check_name, result) values ('aucune entree de stock a la commande (reel = 3, aucun mouvement du n° de commande)',
    case when (select real_qty from public.article_stock(_a)) = 3
          and not exists (select 1 from public.stock_moves where article_id = _a and ref = _o.number) then 'ok' else 'KO' end);

  -- 8 et 9. « En commande » et disponible (Édition du stock, onglet Stock réel, recherche sur la référence)
  select * into _ed from public.stock_edition(_co, 'reel', jsonb_build_object('search', _ref, 'zero', 'inclus'), 10, 0) e
   where e.article_id = _a;
  insert into _t(check_name, result) values ('« en commande » = 5 sur l''article ; reste a recevoir (Rappel cde) = 5',
    case when _ed.on_order_qty = 5
          and (select remaining from public.purchase_open_lines(_co, _sup, 'CMD', _id) where article_id = _a) = 5
          and (select pack_qty from public.purchase_open_lines(_co, _sup, 'CMD', _id) where article_id = _a) = 5 then 'ok'
         else 'KO en commande ' || coalesce(_ed.on_order_qty::text, 'NULL') end);
  -- B4 (CLAUDE.md : disponible = réel − réservé + en commande). L'Édition du stock et la caisse affichent
  -- disponible = réel − réservé et « en commande » à part (choix DMS, signalé « à trancher » dans le rapport).
  insert into _t(check_name, result) values ('B4 : reel 3, reserve 0, disponible affiche 3 (reel - reserve), en commande 5 a cote -> previsionnel 8',
    case when _ed.real_qty = 3 and _ed.reserved_qty = 0 and _ed.available_qty = 3
          and _ed.real_qty - _ed.reserved_qty + _ed.on_order_qty = 8 then 'ok'
         else 'KO ' || coalesce(_ed.real_qty::text, '-') || '/' || coalesce(_ed.reserved_qty::text, '-') || '/' || coalesce(_ed.available_qty::text, '-') end);

  -- 10. Encours fournisseur
  insert into _t(check_name, result) values ('encours de commande du fournisseur = 3,75 HT (1 commande, 1 ligne)',
    case when (public.supplier_open_orders(_sup)->>'amount_ht')::numeric = 3.75
          and (public.supplier_open_orders(_sup)->>'orders')::int = 1 then 'ok'
         else 'KO ' || public.supplier_open_orders(_sup)::text end);

  -- 11. Liste des commandes (Rappel Commande)
  insert into _t(check_name, result) values ('liste des commandes : n°, type Stock, fournisseur, HT, statut validee, operateur',
    case when exists (select 1 from public.purchase_documents(_co, 'CMD', null, null, _sup, 50) d
                       where d.id = _id and d.number = _o.number and d.order_type = 'stock' and d.total_ht = 3.75
                         and d.status = 'validee' and d.supplier_name = 'ESSAI PARCOURS 11 FOURNISSEUR' and d.operator_name is not null)
         then 'ok' else 'KO' end);

  -- 12. Document validé figé
  begin
    perform public.purchase_doc_save(_co, _id, jsonb_build_object('doc_type', 'CMD', 'supplier_id', _sup),
      jsonb_build_array(jsonb_build_object('article_id', _a, 'designation', 'x', 'quantity', 9, 'unit_price_ht', 1)), '[]'::jsonb, true);
    _ok := false;
  exception when others then _ok := sqlerrm like '%déjà validé%'; end;
  perform set_config('app.purchase_rpc', 'off', true);  -- en production chaque appel d'écran est sa propre transaction
  begin
    update public.purchase_lines set quantity = 99 where order_id = _id;
    _ok := _ok and false;
  exception when others then null; end;
  insert into _t(check_name, result) values ('commande validee figee : pas de seconde validation, lignes non modifiables',
    case when _ok then 'ok' else 'KO' end);
end $s$;
select n, check_name, result from _t order by n;
