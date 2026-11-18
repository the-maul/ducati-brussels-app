-- =====================================================================
-- Rattrapage G8 achats (18/11/2026) — essai a blanc des migrations
--   20261118200000_m4_reception_g8.sql et 20261118201000_m4_fournisseurs_listes_g8.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118200000_m4_reception_g8.sql \
--      supabase/migrations/20261118201000_m4_fournisseurs_listes_g8.sql \
--      supabase/tests/m4_achats_g8.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Joue un administrateur (claims JWT simulees) dans ITALBIKE STORE :
--   commande 5 + 3 -> reception partielle 3 avec port reparti (PAMP 12,4, PA 12, commande « partielle »,
--   en commande 2) -> garde (statut non modifiable a la main) -> 2e reception (commande « recue »,
--   en commande 0) -> retrocession 1 (stock 4, PAMP inchange) -> reception refusee sur un chassis
--   deja connu : AUCUN mouvement ecrit (atomicite) -> brouillon valide plus tard -> regroupement ->
--   proposition depannage (conditionnement, remise depannage) -> proposition -> commande ->
--   lectures (infos client, encours, CA, TVA, echeances, historique, liste).
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _c(k text primary key, v text) on commit drop;
grant all on _t, _c to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _sup uuid; _a1 uuid; _a2 uuid; _cmd jsonb; _cmd_id uuid; _l1 uuid; _l2 uuid; _rec jsonb; _x jsonb; _n bigint; _ok boolean;
  _draft jsonb; _c1 jsonb; _c2 jsonb; _pcf uuid; _cmd2 uuid; _pamp numeric;
begin
  insert into public.contacts (company_id, type, company_name, supplier_rush_discount_pct, supplier_vat_regime)
  values (_co, 'fournisseur', 'ESSAI G8 FOURNISSEUR', 10, 'with_vat') returning id into _sup;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, pack_qty)
  values (_co, 'ESSAI-G8-A1', 'Essai article 1', 'A', 10, 10, 2) returning id into _a1;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp)
  values (_co, 'ESSAI-G8-A2', 'Essai article 2', 'A', 20, 0) returning id into _a2;
  perform public.record_stock_move(_a1, 'entree', 2, 10, false, null, 'screen', 'ESSAI', 'stock de depart');

  -- 1. Commande validee
  _cmd := public.purchase_doc_save(_co, null,
    jsonb_build_object('doc_type', 'CMD', 'supplier_id', _sup, 'order_type', 'stock'),
    jsonb_build_array(
      jsonb_build_object('article_id', _a1, 'designation', 'A1', 'quantity', 5, 'unit_price_ht', 12, 'vat_rate', 21),
      jsonb_build_object('article_id', _a2, 'designation', 'A2', 'quantity', 3, 'unit_price_ht', 20, 'vat_rate', 21)),
    '[]'::jsonb, true);
  _cmd_id := (_cmd->>'id')::uuid;
  select id into _l1 from public.purchase_lines where order_id = _cmd_id and article_id = _a1;
  select id into _l2 from public.purchase_lines where order_id = _cmd_id and article_id = _a2;
  insert into _t(check_name, result) select 'commande validee, numerotee, totaux serveur (120 HT, 145,20 TTC)',
    case when _cmd->>'status' = 'validee' and _cmd->>'number' is not null
          and (select total_ht from public.purchase_orders where id = _cmd_id) = 120
          and (select total_ttc from public.purchase_orders where id = _cmd_id) = 145.20 then 'ok' else 'KO ' || _cmd::text end;
  insert into _t(check_name, result) select 'en commande apres la commande : A1 = 5',
    case when public.article_on_order_for(_a1, null, null) = 5 then 'ok' else 'KO ' || public.article_on_order_for(_a1, null, null) end;

  -- 2. Reception partielle (rappel de la commande), port 6 reparti
  _rec := public.purchase_doc_save(_co, null,
    jsonb_build_object('doc_type', 'REC', 'supplier_id', _sup, 'supplier_invoice_no', 'ESSAI-FA1', 'invoice_date', current_date,
                       'supplier_bl_no', 'ESSAI-BL1', 'bl_date', current_date, 'shipping_ht', 6, 'spread_costs', true),
    jsonb_build_array(jsonb_build_object('article_id', _a1, 'designation', 'A1', 'quantity', 3, 'unit_price_ht', 12,
                                         'vat_rate', 21, 'source_line_id', _l1, 'labels', 3)),
    '[]'::jsonb, true);
  insert into _t(check_name, result) select 'reception partielle : stock A1 = 5, PAMP = 12,4 (port reparti), PA = 12',
    case when (select real_qty from public.article_stock(_a1)) = 5
          and (select pamp from public.articles where id = _a1) = 12.4
          and (select purchase_price from public.articles where id = _a1) = 12 then 'ok'
         else 'KO stock ' || (select real_qty from public.article_stock(_a1)) || ' pamp ' || (select pamp from public.articles where id = _a1) end;
  insert into _t(check_name, result) select 'commande passee « partielle », reliquat en commande : A1 = 2, A2 = 3',
    case when (select status from public.purchase_orders where id = _cmd_id) = 'partielle'
          and public.article_on_order_for(_a1, null, null) = 2 and public.article_on_order_for(_a2, null, null) = 3 then 'ok'
         else 'KO ' || (select status from public.purchase_orders where id = _cmd_id) || ' ' || public.article_on_order_for(_a1, null, null) end;
  insert into _t(check_name, result) select 'etiquettes de reception en file (B12) : 3',
    case when (select sum(qty) from public.label_queue where article_id = _a1) = 3 then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'reste a recevoir (rappel) : A1 2, A2 3',
    case when (select remaining from public.purchase_open_lines(_co, _sup, 'CMD', _cmd_id) where line_id = _l1) = 2
          and (select remaining from public.purchase_open_lines(_co, _sup, 'CMD', _cmd_id) where line_id = _l2) = 3 then 'ok' else 'KO' end;

  -- 3. Garde : le statut ne se change pas a la main
  begin
    update public.purchase_orders set status = 'recue' where id = _cmd_id;
    _ok := false;
  exception when others then _ok := true; end;
  insert into _t(check_name, result) select 'garde : statut d''une commande non modifiable directement', case when _ok then 'ok' else 'KO' end;
  begin
    update public.purchase_lines set quantity = 99 where id = _l2;
    _ok := false;
  exception when others then _ok := true; end;
  insert into _t(check_name, result) select 'garde : ligne d''une commande validee figee', case when _ok then 'ok' else 'KO' end;

  -- 4. Seconde reception : solde
  _rec := public.purchase_doc_save(_co, null,
    jsonb_build_object('doc_type', 'REC', 'supplier_id', _sup, 'supplier_invoice_no', 'ESSAI-FA2'),
    jsonb_build_array(
      jsonb_build_object('article_id', _a1, 'designation', 'A1', 'quantity', 2, 'unit_price_ht', 12, 'vat_rate', 21, 'source_line_id', _l1),
      jsonb_build_object('article_id', _a2, 'designation', 'A2', 'quantity', 3, 'unit_price_ht', 20, 'vat_rate', 21, 'source_line_id', _l2)),
    '[]'::jsonb, true);
  insert into _t(check_name, result) select 'commande « recue », plus rien en commande',
    case when (select status from public.purchase_orders where id = _cmd_id) = 'recue'
          and public.article_on_order_for(_a1, null, null) = 0 and public.article_on_order_for(_a2, null, null) = 0 then 'ok' else 'KO' end;

  -- 5. Retrocession 1 x A1 : sortie, PAMP inchange
  select pamp into _pamp from public.articles where id = _a1;
  _x := public.purchase_doc_save(_co, null, jsonb_build_object('doc_type', 'RTF', 'supplier_id', _sup),
    jsonb_build_array(jsonb_build_object('article_id', _a1, 'designation', 'A1', 'quantity', 1, 'unit_price_ht', 12)), '[]'::jsonb, true);
  insert into _t(check_name, result) select 'retrocession : stock A1 7 - 1 = 6, mouvement « retour_fournisseur », PAMP inchange',
    case when (select real_qty from public.article_stock(_a1)) = 6
          and exists (select 1 from public.stock_moves where article_id = _a1 and origin = 'retour_fournisseur' and qty_delta = -1)
          and (select pamp from public.articles where id = _a1) = _pamp then 'ok'
         else 'KO ' || (select real_qty from public.article_stock(_a1)) end;

  -- 6. Atomicite : chassis deja connu -> rien n'est ecrit
  insert into public.vehicles (company_id, vin, status) values (_co, 'ZDMESSAIG8000001', 'stock_vn');
  select count(*) into _n from public.stock_moves where article_id = _a2;
  begin
    perform public.purchase_doc_save(_co, null, jsonb_build_object('doc_type', 'REC', 'supplier_id', _sup),
      jsonb_build_array(jsonb_build_object('article_id', _a2, 'designation', 'A2', 'quantity', 1, 'unit_price_ht', 20,
                                           'chassis', jsonb_build_object('vin', 'zdmessaig8000001'))), '[]'::jsonb, true);
    _ok := false;
  exception when others then _ok := true; end;
  insert into _t(check_name, result) select 'atomicite : VIN en double refuse, aucun mouvement ni document ecrit',
    case when _ok and (select count(*) from public.stock_moves where article_id = _a2) = _n
          and not exists (select 1 from public.purchase_orders where company_id = _co and supplier_id = _sup and doc_type = 'REC'
                            and status = 'brouillon') then 'ok' else 'KO' end;

  -- 7. Brouillon puis validation plus tard
  _draft := public.purchase_doc_save(_co, null, jsonb_build_object('doc_type', 'REC', 'supplier_id', _sup),
    jsonb_build_array(jsonb_build_object('article_id', _a2, 'designation', 'A2', 'quantity', 1, 'unit_price_ht', 20)), '[]'::jsonb, false);
  insert into _t(check_name, result) select 'brouillon : pas de numero, pas de stock',
    case when _draft->>'status' = 'brouillon' and (select number from public.purchase_orders where id = (_draft->>'id')::uuid) is null
          and (select real_qty from public.article_stock(_a2)) = 3 then 'ok' else 'KO' end;
  _x := public.purchase_doc_save(_co, (_draft->>'id')::uuid, jsonb_build_object('doc_type', 'REC', 'supplier_id', _sup),
    jsonb_build_array(jsonb_build_object('article_id', _a2, 'designation', 'A2', 'quantity', 2, 'unit_price_ht', 20)), '[]'::jsonb, true);
  insert into _t(check_name, result) select 'brouillon valide plus tard : meme document, numerote, stock A2 = 5',
    case when _x->>'id' = _draft->>'id' and _x->>'number' is not null and (select real_qty from public.article_stock(_a2)) = 5 then 'ok' else 'KO' end;

  -- 8. Regroupement de deux commandes en brouillon
  _c1 := public.purchase_doc_save(_co, null, jsonb_build_object('doc_type', 'CMD', 'supplier_id', _sup),
    jsonb_build_array(jsonb_build_object('article_id', _a1, 'designation', 'A1', 'quantity', 1, 'unit_price_ht', 12)), '[]'::jsonb, false);
  _c2 := public.purchase_doc_save(_co, null, jsonb_build_object('doc_type', 'CMD', 'supplier_id', _sup),
    jsonb_build_array(jsonb_build_object('article_id', _a2, 'designation', 'A2', 'quantity', 1, 'unit_price_ht', 20)), '[]'::jsonb, false);
  _x := public.purchase_orders_merge(_co, array[(_c1->>'id')::uuid, (_c2->>'id')::uuid], 'essai');
  insert into _t(check_name, result) select 'regroupement : 2 lignes dans la premiere, la seconde annulee et reliee',
    case when (select count(*) from public.purchase_lines where order_id = (_c1->>'id')::uuid) = 2
          and (select status from public.purchase_orders where id = (_c2->>'id')::uuid) = 'annulee'
          and (select merged_into_id from public.purchase_orders where id = (_c2->>'id')::uuid) = (_c1->>'id')::uuid
          and (select total_ht from public.purchase_orders where id = (_c1->>'id')::uuid) = 32 then 'ok' else 'KO' end;

  -- 9. Proposition depannage depuis un article : conditionnement 2 (3 -> 4), remise depannage 10 %
  _x := public.purchase_proposal_add(_co, 'depannage', jsonb_build_array(jsonb_build_object('article_id', _a1, 'qty', 3, 'supplier_id', _sup)),
                                     'article', _a1, 'ESSAI-G8-A1', null);
  _pcf := (_x->'items'->0->>'proposal_id')::uuid;
  insert into _t(check_name, result) select 'proposition : PCF brouillon depannage, qte 4, remise 10',
    case when (select doc_type || status || order_type from public.purchase_orders where id = _pcf) = 'PCFbrouillondepannage'
          and (select quantity from public.purchase_lines where order_id = _pcf) = 4
          and (select discount_pct from public.purchase_lines where order_id = _pcf) = 10 then 'ok' else 'KO' end;
  -- valider la proposition (meme ecran), puis la passer en commande
  _x := public.purchase_doc_save(_co, _pcf, jsonb_build_object('doc_type', 'PCF', 'supplier_id', _sup, 'order_type', 'depannage'),
    (select jsonb_agg(jsonb_build_object('article_id', article_id, 'designation', designation, 'quantity', quantity,
                                         'unit_price_ht', unit_price_ht, 'discount_pct', discount_pct)) from public.purchase_lines where order_id = _pcf),
    '[]'::jsonb, true);
  _cmd2 := public.purchase_proposal_to_order(_pcf);
  _x := public.purchase_doc_save(_co, _cmd2, jsonb_build_object('doc_type', 'CMD', 'supplier_id', _sup, 'order_type', 'depannage'),
    (select jsonb_agg(jsonb_build_object('article_id', article_id, 'designation', designation, 'quantity', quantity,
                                         'unit_price_ht', unit_price_ht, 'discount_pct', discount_pct, 'source_line_id', source_line_id))
       from public.purchase_lines where order_id = _cmd2), '[]'::jsonb, true);
  insert into _t(check_name, result) select 'proposition -> commande validee : proposition « transformee »',
    case when (select status from public.purchase_orders where id = _pcf) = 'transformee'
          and (select status from public.purchase_orders where id = _cmd2) = 'validee' then 'ok' else 'KO' end;

  -- 10. Envoi, encours, lectures
  perform public.purchase_order_log_send(_cmd2, 'mail', 'essai');
  insert into _t(check_name, result) select 'envoi trace (date et heure) et encours fournisseur = 4 x 12 x 0,9 = 43,20',
    case when (select count(*) from public.purchase_order_sends where order_id = _cmd2) = 1
          and (public.supplier_open_orders(_sup)->>'amount_ht')::numeric = 43.20 then 'ok'
         else 'KO ' || public.supplier_open_orders(_sup)::text end;
  perform public.purchase_order_close_remainder(_cmd2, 'essai');
  insert into _t(check_name, result) select 'solde du reliquat : commande « soldee », plus en commande',
    case when (select status from public.purchase_orders where id = _cmd2) = 'soldee' and public.article_on_order_for(_a1, null, null) = 0
         then 'ok' else 'KO' end;

  insert into _t(check_name, result) select 'lectures : infos client, CA, TVA, echeances, historique, liste, suivi',
    case when (select count(*) from public.receipt_customer_infos((_rec->>'id')::uuid)) >= 0
          and (select count(*) from public.supplier_turnover(_sup)) = 3
          and (select purchases_ht from public.supplier_turnover(_sup) limit 1) > 0
          and (select count(*) from public.purchase_vat_by_supplier(_co, current_date - 1, current_date + 1, 'receipt') where supplier_id = _sup) >= 1
          and (select count(*) from public.purchase_due_schedules(_co, null, null, _sup)) >= 3
          and (select count(*) from public.purchase_order_history(_co, null, null, _sup)) = 1
          and (select count(*) from public.purchase_documents(_co, 'REC', null, null, _sup, 50)) = 3
          and jsonb_array_length(public.purchase_order_follow(_cmd_id)->'receipts') = 2 then 'ok' else 'KO' end;

  perform public.receipt_customer_informed((_rec->>'id')::uuid, _a1, 'document', gen_random_uuid(), null, 'telephone', 'essai');
  insert into _t(check_name, result) select 'client informe : trace append-only',
    case when (select count(*) from public.purchase_customer_notices where receipt_id = (_rec->>'id')::uuid) = 1 then 'ok' else 'KO' end;

  insert into public.supplier_year_end_rebates (company_id, supplier_id, family_code, label, rebate_pct, amount)
  values (_co, _sup, '02', 'RFA essai', 2, 150);
  insert into _t(check_name, result) select 'remise de fin d''annee enregistree (fournisseur x famille)',
    case when (select amount from public.supplier_year_end_rebates where supplier_id = _sup) = 150 then 'ok' else 'KO' end;
end $s$;

select n, check_name, result from _t order by n;
