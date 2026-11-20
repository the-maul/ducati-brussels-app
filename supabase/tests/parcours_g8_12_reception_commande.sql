-- =====================================================================
-- Parcours G8 n° 12 — Réception d'une commande (lot-verif-parcours, 20/11/2026)
-- G8 : Appros › Réception → (étiquettes : Non) → fournisseur → opérateur → « Rappel cde » → commande
--      6000004 → lignes reprises → n° facture TESTFA1 → Valider → choix « Réception » → Valider sans
--      éditer → RECEPTION 7000001 ; stock +5, PA mis à jour, PAMP recalculé ; Historique mouvements :
--      « Réception n°7000001 » ancien / nouveau stock ; fenêtre automatique « Infos commandes client ».
-- DMS : Achats › Nouvelle réception (purchase-editor.tsx) → fournisseur → « Rappel cde »
--      (recall-dialog.tsx : purchase_open_lines) → lignes = reste à recevoir avec source_line_id →
--      n° facture / BL + dates → Valider = purchase_doc_save(..., true) (une transaction : n° REC,
--      record_stock_move « reception », record_price_change « reception », PAMP, statut de la commande)
--      → /purchases/$id?infos=1 : customer-infos-dialog.tsx (receipt_customer_infos,
--      receipt_customer_informed). Historique : fiche article › Mouvements (article_moves_detail).
-- Contrôles :
--   1. Rappel cde : la commande validée est proposée, reste à recevoir 5, PA 0,75
--   2. RECEPTION validée, numérotée « suivant de celui d'avant » (série REC), statut « reçue »
--   3. en-tête : n° facture / BL fournisseur et dates, date de réception, opérateur, lien commande
--   4. stock 3 → 8 (+5) ; mouvement « entree » origine reception, réf. = n° REC, facture dans la note
--   5. B7 : historique (article_moves_detail) ancien 3 / nouveau 8, origine, opérateur
--   6. PA mis à jour 0,75 → 0,80, trace price_changes (origine reception, opérateur)
--   7. B5 PAMP : (3 × 0,75 + 5 × 0,80) / 8 = 0,781 (formule record_stock_move, 3 décimales)
--   8. B5 PAMP, stock de départ ≤ 0 : le PAMP repart du coût d'entrée (−1 → +2 à 1,20 ⇒ 1,20)
--   9. commande soldée : statut « reçue », plus « en commande » (Édition du stock), reste 0
--  10. suivi de la commande : la réception y figure
--  11. Infos commandes client : la réservation du client sur l'article apparaît (n°, client, qté 2)
--  12. « Client informé » tracé (append-only) et relu dans la fenêtre
--  13. trace events purchase_validated de la réception (commande « recue » dans le détail)
-- Données : fournisseur, articles, client et réservation créés dans l'essai (ItalTest).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare
  _co  uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _me  uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _tag text := upper(substr(md5(random()::text), 1, 6));
  _ref text := 'PG8-12-' || _tag;
  _today date := (now() at time zone 'Europe/Brussels')::date;
  _y int := extract(year from (now() at time zone 'Europe/Brussels'))::int;
  _sup uuid; _a uuid; _b uuid; _cli uuid; _res uuid; _resnum text;
  _cmd jsonb; _cmd_id uuid; _rec jsonb; _rec_id uuid; _o public.purchase_orders%rowtype;
  _seq public.document_sequences%rowtype; _expected text; _lines jsonb; _ol record; _mv record; _ed record;
  _pamp_exp numeric; _x jsonb;
begin
  -- Préparation : fournisseur, article A (PA 0,75, stock 3), article B (stock −1), client + réservation de 2 A
  insert into public.contacts (company_id, type, company_name, supplier_vat_regime)
  values (_co, 'fournisseur', 'ESSAI PARCOURS 12 FOURNISSEUR', 'with_vat') returning id into _sup;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, pack_qty, vat_rate, main_supplier_id, bin_location)
  values (_co, _ref, 'Essai parcours 12', 'A', 0.75, 0.75, 5, 21, _sup, 'A12') returning id into _a;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, vat_rate, main_supplier_id)
  values (_co, _ref || 'B', 'Essai parcours 12 stock negatif', 'A', 1, 1, 21, _sup) returning id into _b;
  perform public.record_stock_move(_a, 'entree', 3, 0.75, false, null, 'screen', 'ESSAI', 'stock de depart');
  perform public.record_stock_move(_b, 'sortie', -1, null, false, null, 'sale', 'ESSAI', 'vente sans stock');

  insert into public.contacts (company_id, type, first_name, last_name, gsm)
  values (_co, 'particulier', 'Essai', 'PARCOURS12', '+32470000012') returning id into _cli;
  -- Réservation (même enchaînement que l'écran de vente : brouillon, lignes, document_assign_number, réservation de stock)
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'RES', 'brouillon', _cli, _today, 2, 0.42, 2.42, 'ttc') returning id into _res;
  insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_res, _a, 'Essai parcours 12', 2, 1, 21, 2, 2.42, 0, 'article');
  _resnum := public.document_assign_number(_res);
  perform public.record_stock_move(_a, 'reservation', 2, null, true, null, 'sale', _resnum, null);

  -- Commande (parcours 11) : 5 × 0,75
  _cmd := public.purchase_doc_save(_co, null,
    jsonb_build_object('doc_type', 'CMD', 'supplier_id', _sup, 'vat_regime', 'with_vat', 'order_type', 'stock', 'order_date', _today),
    jsonb_build_array(jsonb_build_object('article_id', _a, 'designation', 'Essai parcours 12', 'supplier_ref', _ref,
                       'quantity', 5, 'unit_price_ht', 0.75, 'discount_pct', 0, 'vat_rate', 21, 'bin_location', 'A12', 'labels', 0)),
    '[]'::jsonb, true);
  _cmd_id := (_cmd->>'id')::uuid;

  -- 1. Rappel cde (recall-dialog.tsx : purchase_open_lines(société, fournisseur, 'CMD', null))
  select * into _ol from public.purchase_open_lines(_co, _sup, 'CMD', null) where order_id = _cmd_id;
  insert into _t(check_name, result) values ('Rappel cde : la commande ' || coalesce(_cmd->>'number', '?') || ' est proposee, reste 5, PA 0,75',
    case when _ol.order_number = _cmd->>'number' and _ol.remaining = 5 and _ol.unit_price_ht = 0.75 and _ol.order_status = 'validee'
         then 'ok' else 'KO ' || coalesce(_ol.remaining::text, 'commande absente') end);

  -- Lignes reprises comme applyRecall (purchase-editor.tsx) ; le PA de la facture fournisseur est saisi : 0,80
  _lines := jsonb_build_array(jsonb_build_object('article_id', _ol.article_id, 'designation', _ol.designation,
              'supplier_ref', _ol.supplier_ref, 'quantity', _ol.remaining, 'unit_price_ht', 0.80, 'discount_pct', _ol.discount_pct,
              'vat_rate', _ol.vat_rate, 'sale_price_ttc', _ol.sale_price_ttc, 'bin_location', coalesce(_ol.bin_location, ''),
              'labels', 0, 'source_line_id', _ol.line_id, 'contact_id', _ol.contact_id),
            -- réception hors commande de l'article B (stock −1) pour la règle PAMP stock ≤ 0
            jsonb_build_object('article_id', _b, 'designation', 'Essai parcours 12 stock negatif', 'quantity', 2,
              'unit_price_ht', 1.20, 'discount_pct', 0, 'vat_rate', 21, 'labels', 0));

  select * into _seq from public.document_sequences where company_id = _co and doc_type = 'REC';
  _expected := _seq.prefix || _seq.separator
            || case when _seq.reset_yearly then _y::text || _seq.separator else '' end
            || lpad((case when _seq.reset_yearly and _seq.current_year is distinct from _y then 1 else _seq.next_value end)::text, _seq.padding, '0')
            || coalesce(_seq.suffix, '');

  _rec := public.purchase_doc_save(_co, null,
    jsonb_build_object('doc_type', 'REC', 'supplier_id', _sup, 'vat_regime', 'with_vat', 'order_type', 'stock',
                       'supplier_invoice_no', 'TESTFA1-' || _tag, 'invoice_date', _today, 'supplier_bl_no', 'TESTBL1-' || _tag,
                       'bl_date', _today, 'receipt_date', _today, 'shipping_ht', 0, 'shipping_taxed', true, 'shipping_vat_rate', 21,
                       'global_discount_pct', 0, 'spread_costs', true),
    _lines, '[]'::jsonb, true);
  _rec_id := (_rec->>'id')::uuid;
  select * into _o from public.purchase_orders where id = _rec_id;

  -- 2. Numéro et statut
  insert into _t(check_name, result) values ('RECEPTION validee, numero suivant de la serie REC (' || coalesce(_expected, '?') || '), statut recue',
    case when _o.doc_type = 'REC' and _o.status = 'recue' and _o.number = _expected
          and (select next_value from public.document_sequences where company_id = _co and doc_type = 'REC')
              = (case when _seq.reset_yearly and _seq.current_year is distinct from _y then 2 else _seq.next_value + 1 end)
         then 'ok' else 'KO ' || coalesce(_o.number, 'sans numero') || ' ' || _o.status end);

  -- 3. En-tête
  insert into _t(check_name, result) values ('en-tete : n° facture / BL fournisseur + dates, date de reception, operateur, lien vers la commande',
    case when _o.supplier_invoice_no = 'TESTFA1-' || _tag and _o.supplier_bl_no = 'TESTBL1-' || _tag
          and _o.invoice_date = _today and _o.bl_date = _today and _o.receipt_date = _today
          and _o.operator_id = _me and _o.validated_by = _me and _o.source_order_id = _cmd_id then 'ok' else 'KO' end);

  -- 4. Stock +5
  select * into _mv from public.stock_moves where article_id = _a and ref = _o.number;
  insert into _t(check_name, result) values ('stock 3 -> 8 (+5) : mouvement entree, origine reception, ref = n° REC, facture dans le libelle',
    case when (select real_qty from public.article_stock(_a)) = 8 and _mv.qty_delta = 5 and _mv.move_type = 'entree'
          and _mv.origin = 'reception' and not _mv.is_reservation and _mv.unit_cost = 0.80 and _mv.operator_id = _me
          and _mv.note like '%TESTFA1-' || _tag || '%' then 'ok'
         else 'KO reel ' || (select real_qty from public.article_stock(_a)) end);

  -- 5. B7 : historique des mouvements (fiche article › Mouvements)
  select * into _mv from public.article_moves_detail(_a, null, null, false) d where d.ref = _o.number and d.row_kind = 'move';
  insert into _t(check_name, result) values ('B7 historique : ancien stock 3, nouveau 8, mouvement +5, origine reception, operateur',
    case when _mv.real_before = 3 and _mv.real_after = 8 and _mv.qty_delta = 5 and _mv.origin = 'reception'
          and _mv.operator_name is not null then 'ok'
         else 'KO ' || coalesce(_mv.real_before::text, '-') || ' -> ' || coalesce(_mv.real_after::text, '-') end);

  -- 6. PA mis à jour
  insert into _t(check_name, result) values ('PA de la fiche mis a jour 0,75 -> 0,80, trace price_changes (origine reception, operateur)',
    case when (select purchase_price from public.articles where id = _a) = 0.80
          and exists (select 1 from public.price_changes pc where pc.article_id = _a and pc.old_purchase = 0.75
                        and pc.new_purchase = 0.80 and pc.origin = 'reception' and pc.operator_id = _me) then 'ok'
         else 'KO PA ' || (select purchase_price from public.articles where id = _a) end);

  -- 7. PAMP pondéré (B5)
  _pamp_exp := round((0.75 * 3 + 0.80 * 5) / (3 + 5), 3);
  insert into _t(check_name, result) values ('B5 PAMP pondere : (3 x 0,75 + 5 x 0,80) / 8 = ' || _pamp_exp,
    case when (select pamp from public.articles where id = _a) = _pamp_exp and _pamp_exp = 0.781 then 'ok'
         else 'KO ' || (select pamp from public.articles where id = _a) end);
  -- 8. PAMP depuis un stock ≤ 0 (B5) : repart du coût
  insert into _t(check_name, result) values ('B5 PAMP stock de depart <= 0 : -1 + 2 a 1,20 -> PAMP 1,20, stock 1',
    case when (select pamp from public.articles where id = _b) = 1.20 and (select real_qty from public.article_stock(_b)) = 1 then 'ok'
         else 'KO ' || (select pamp from public.articles where id = _b) end);

  -- 9. « En commande » soldé
  select * into _ed from public.stock_edition(_co, 'reel', jsonb_build_object('search', _ref, 'zero', 'inclus'), 10, 0) e where e.article_id = _a;
  insert into _t(check_name, result) values ('commande soldee : statut recue, en commande 0, reste a recevoir 0 ; reel 8, reserve 2, disponible 6',
    case when (select status from public.purchase_orders where id = _cmd_id) = 'recue' and _ed.on_order_qty = 0
          and not exists (select 1 from public.purchase_open_lines(_co, _sup, 'CMD', _cmd_id) where remaining > 0)
          and _ed.real_qty = 8 and _ed.reserved_qty = 2 and _ed.available_qty = 6 then 'ok'
         else 'KO ' || (select status from public.purchase_orders where id = _cmd_id) || ' en cde ' || coalesce(_ed.on_order_qty::text, '-') end);

  -- 10. Suivi de la commande
  _x := public.purchase_order_follow(_cmd_id);
  insert into _t(check_name, result) values ('suivi de la commande : la reception y figure (n°, n° facture)',
    case when exists (select 1 from jsonb_array_elements(_x->'receipts') r where r->>'id' = _rec_id::text
                        and r->>'number' = _o.number and r->>'invoice_no' = 'TESTFA1-' || _tag) then 'ok' else 'KO ' || _x::text end);

  -- 11. Infos commandes client
  insert into _t(check_name, result) values ('Infos commandes client : reservation ' || coalesce(_resnum, '?') || ' du client, qte 2, telephone, casier',
    case when exists (select 1 from public.receipt_customer_infos(_rec_id) i
                       where i.article_id = _a and i.source_kind = 'document' and i.source_id = _res and i.source_number = _resnum
                         and i.source_type = 'RES' and i.contact_id = _cli and i.contact_name = 'Essai PARCOURS12'
                         and i.contact_phone = '+32470000012' and i.qty_needed = 2 and i.qty_received = 5
                         and i.bin_location = 'A12' and i.informed_at is null) then 'ok' else 'KO' end);

  -- 12. Client informé
  perform public.receipt_customer_informed(_rec_id, _a, 'document', _res, _cli, 'telephone', null);
  insert into _t(check_name, result) values ('client informe (telephone) : trace append-only + events, relu dans la fenetre',
    case when (select count(*) from public.purchase_customer_notices where receipt_id = _rec_id and source_id = _res) = 1
          and exists (select 1 from public.receipt_customer_infos(_rec_id) i where i.source_id = _res and i.informed_channel = 'telephone'
                        and i.informed_at is not null)
          and exists (select 1 from public.events where action = 'customer_informed_arrival' and entity_id = _cli::text) then 'ok' else 'KO' end);

  -- 13. Trace de la réception
  insert into _t(check_name, result) values ('trace events purchase_validated de la reception (commande passee recue dans le detail)',
    case when exists (select 1 from public.events e where e.entity_id = _rec_id::text and e.action = 'purchase_validated'
                        and e.new_data->>'number' = _o.number
                        and exists (select 1 from jsonb_array_elements(e.new_data->'orders') x
                                     where x->>'id' = _cmd_id::text and x->>'status' = 'recue')) then 'ok' else 'KO' end);
end $s$;
select n, check_name, result from _t order by n;
