-- =====================================================================
-- C2 (23/11/2026) — Chemin de chaque piece, client prevenu a reception complete, etiquettes de destination.
-- Migrations 20261123110000, 111000, 112000. ItalTest, simon@themaul.be, transaction ANNULEE (rt.py).
-- Controles :
--   A. commande fournisseur partagee par 2 clients : reception partielle au plus ancien, reliquat ;
--   B. panier commande : la reception sans rappel retrouve le client (lien, BL), reliquat puis complet ;
--   C. classeur Excel commande : la reception retrouve le client (PIE-05) ;
--   D. ni stock, ni PAMP, ni prix : la repartition n'ajoute aucun mouvement ;
--   E. notification : ItalTest ne met RIEN en file ; arrete = rien ; test = une seule en file ;
--      deja prevenu = rien ; incomplete = rien ;
--   F. etiquettes de destination : contenu, file differee a part, cumul, file classique intacte ;
--   G. droits : hors societe refuse ; pas d'ecriture directe.
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;
grant all on _ctx to authenticated;

-- ---------------------------------------------------------------- Donnees d'essai
do $s$
declare
  _co  uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _sup uuid; _cl1 uuid; _cl2 uuid; _a1 uuid; _a2 uuid; _a3 uuid; _ref3 text;
  _o1 uuid; _o2 uuid; _o3 uuid; _o4 uuid; _l1 uuid; _l2 uuid; _l3 uuid; _l4 uuid;
  _b uuid; _bl uuid; _x uuid;
begin
  select id into _sup from public.contacts where company_id = _co and type = 'fournisseur' order by id limit 1;
  update public.contacts set supplier_is_dcs = true where id = _sup;
  select id into _cl1 from public.contacts where company_id = _co and type = 'particulier' order by id limit 1;
  select id into _cl2 from public.contacts where company_id = _co and type = 'particulier' and id <> _cl1 order by id limit 1;
  update public.contacts set email = 'essai.c2@example.invalid' where id in (_cl1, _cl2);
  delete from public.contact_consents where contact_id in (_cl1, _cl2);

  select c.reference, a.id into _ref3, _a3
    from public.excel_catalog c join public.articles a on a.company_id = c.company_id and a.reference = c.reference
   where c.company_id = _co and a.mgmt_type::text = 'A' and coalesce(a.supplier_availability, '') not in ('red', 'yellow')
   order by c.reference limit 1;
  select id into _a1 from public.articles
   where company_id = _co and mgmt_type::text = 'A' and coalesce(is_active, true) and coalesce(supplier_availability, '') not in ('red', 'yellow')
     and id <> _a3 and not exists (select 1 from public.part_order_lines x where x.article_id = articles.id)
   order by reference limit 1;
  select id into _a2 from public.articles
   where company_id = _co and mgmt_type::text = 'A' and coalesce(is_active, true) and coalesce(supplier_availability, '') not in ('red', 'yellow')
     and id not in (_a1, _a3) and not exists (select 1 from public.supplier_basket_lines x where x.article_id = articles.id)
   order by reference limit 1;

  insert into public.part_orders (company_id, contact_id, order_kind) values (_co, _cl1, 'standard') returning id into _o1;
  insert into public.part_orders (company_id, contact_id, order_kind) values (_co, _cl2, 'standard') returning id into _o2;
  insert into public.part_orders (company_id, contact_id, order_kind) values (_co, _cl1, 'urgente') returning id into _o3;
  insert into public.part_orders (company_id, contact_id, order_kind) values (_co, _cl2, 'excel') returning id into _o4;
  insert into public.part_order_lines (order_id, article_id, reference, designation, supplier_id, qty_client, unit_price_ht, vat_rate)
  values (_o1, _a1, 'C2A', 'Piece A', _sup, 2, 10, 21) returning id into _l1;
  insert into public.part_order_lines (order_id, article_id, reference, designation, supplier_id, qty_client, unit_price_ht, vat_rate)
  values (_o2, _a1, 'C2A', 'Piece A', _sup, 3, 10, 21) returning id into _l2;
  insert into public.part_order_lines (order_id, article_id, reference, designation, supplier_id, qty_client, unit_price_ht, vat_rate)
  values (_o3, _a2, 'C2B', 'Piece B', _sup, 2, 10, 21) returning id into _l3;
  insert into public.part_order_lines (order_id, article_id, reference, designation, supplier_id, qty_client, unit_price_ht, vat_rate)
  values (_o4, _a3, _ref3, 'Piece C', _sup, 1, 10, 21) returning id into _l4;

  perform set_config('app.part_order_rpc', 'on', true);
  update public.part_orders set dispatch_status = 'a_envoyer', number = 'C2-' || left(id::text, 6),
         validated_at = now() - interval '2 days' where id = _o1;
  update public.part_orders set dispatch_status = 'a_envoyer', number = 'C2-' || left(id::text, 6),
         validated_at = now() - interval '1 day' where id = _o2;
  update public.part_orders set dispatch_status = 'envoyee', number = 'C2-' || left(id::text, 6), validated_at = now() where id in (_o3, _o4);
  perform set_config('app.part_order_rpc', 'off', true);

  -- Panier commande pour la piece B
  insert into public.supplier_baskets (company_id, kind, label, status, supplier_id)
  values (_co, 'urgente', 'PANIER C2', 'ouvert', _sup) returning id into _b;
  perform set_config('app.basket_rpc', 'on', true);
  insert into public.supplier_basket_lines (basket_id, company_id, article_id, reference, designation, qty, origin, origin_ref, origin_line_id, contact_id)
  values (_b, _co, _a2, 'C2B', 'Piece B', 2, 'comptoir', 'C2', _l3, _cl1) returning id into _bl;
  update public.supplier_baskets set status = 'commande', ordered_at = now(), dcs_order_number = 'DCS-C2' where id = _b;
  perform set_config('app.basket_rpc', 'off', true);

  -- Classeur Excel commande pour la piece C
  select id into _x from public.excel_orders where company_id = _co and status in ('en_cours', 'telecharge') limit 1;
  if _x is null then
    insert into public.excel_orders (company_id, status, kind, tab) values (_co, 'en_cours', 'demo', 'demo') returning id into _x;
  end if;
  insert into public.excel_order_lines (excel_order_id, tab, reference, description, qty, price_dealer, extra_discount, contact_id,
                                        part_order_id, part_order_line_id, sort_order)
  values (_x, 'demo', _ref3, 'Piece C', 1, 10, 0, _cl2, _o4, _l4, 999999);
  update public.excel_orders set status = 'commandee', ordered_at = now(), number = coalesce(number, 'CEX-C2') where id = _x;

  insert into _ctx values ('co', _co), ('sup', _sup), ('cl1', _cl1), ('cl2', _cl2), ('a1', _a1), ('a2', _a2), ('a3', _a3),
    ('o1', _o1), ('o2', _o2), ('o3', _o3), ('o4', _o4), ('l1', _l1), ('l2', _l2), ('l3', _l3), ('l4', _l4), ('b', _b), ('bl', _bl), ('x', _x);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

create or replace function pg_temp.c(_k text) returns uuid language sql stable as $$ select v::uuid from _ctx where k = _k $$;
create or replace function pg_temp.rcv(_o text, _a text) returns numeric language sql stable as $$
  select coalesce(sum((e ->> 'received')::numeric), 0)
    from public.part_path_rows(pg_temp.c('co'), 'part_order', pg_temp.c(_o), false, 100) r, jsonb_array_elements(r.supplies) e
   where r.article_id = pg_temp.c(_a) $$;

-- ---------------------------------------------------------------- A. CMD partagee, reception partielle
do $s$
declare _r jsonb; _cmd uuid; _pl uuid; _moves bigint; _rec uuid;
begin
  _r := public.supplier_order_from_proposal(pg_temp.c('co'), pg_temp.c('sup'), array[pg_temp.c('l1'), pg_temp.c('l2')], 'Essai C2');
  _cmd := (_r -> 'orders' -> 0 ->> 'id')::uuid;
  select id into _pl from public.purchase_lines where order_id = _cmd and article_id = pg_temp.c('a1');
  insert into _ctx values ('cmd', _cmd), ('cmd_line', _pl);

  insert into _t(check_name, result) values ('A1 une ligne fournisseur pour 2 clients (5 pieces)',
    case when (select quantity from public.purchase_lines where id = _pl) = 5 then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('A2 avant reception : rien de recu, commande visible sur la piece',
    case when pg_temp.rcv('o1', 'a1') = 0
          and (select r.supplies -> 0 ->> 'kind' from public.part_path_rows(pg_temp.c('co'), 'part_order', pg_temp.c('o1'), false, 10) r) = 'cmd'
         then 'ok' else 'KO' end);

  _r := public.purchase_doc_save(pg_temp.c('co'), null,
    jsonb_build_object('doc_type', 'REC', 'supplier_id', pg_temp.c('sup'), 'vat_regime', 'with_vat', 'supplier_bl_no', 'BL-C2-1'),
    jsonb_build_array(jsonb_build_object('article_id', pg_temp.c('a1'), 'designation', 'Piece A', 'quantity', 3, 'unit_price_ht', 0,
                                         'discount_pct', 0, 'vat_rate', 21, 'source_line_id', _pl)),
    '[]'::jsonb, true);
  _rec := (_r ->> 'id')::uuid;
  insert into _ctx values ('rec1', _rec);

  insert into _t(check_name, result) values ('A3 reception de 3 : le plus ancien complet (2/2), le suivant en reliquat (1/3)',
    case when pg_temp.rcv('o1', 'a1') = 2 and pg_temp.rcv('o2', 'a1') = 1 then 'ok'
         else 'KO ' || pg_temp.rcv('o1', 'a1') || '/' || pg_temp.rcv('o2', 'a1') end);
  insert into _t(check_name, result) values ('A4 la reception et son BL sont sur le chemin',
    case when (select r.supplies -> 0 -> 'receipts' -> 0 ->> 'bl' from public.part_path_rows(pg_temp.c('co'), 'part_order', pg_temp.c('o1'), false, 10) r) = 'BL-C2-1'
         then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('A5 vue par commande fournisseur et par reception',
    case when (select count(*) from public.part_path_rows(pg_temp.c('co'), 'purchase', _pl, false, 10)) = 0
          and (select count(*) from public.part_path_rows(pg_temp.c('co'), 'purchase', _cmd, false, 10)) = 2
          and (select count(*) from public.part_path_rows(pg_temp.c('co'), 'purchase', _rec, false, 10)) = 2
         then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('A6 ligne rappelee : aucune repartition en plus',
    case when not exists (select 1 from public.part_receipt_allocations where receipt_id = _rec) then 'ok' else 'KO' end);
end $s$;

-- ---------------------------------------------------------------- B. Panier, reception sans rappel
do $s$
declare _r jsonb; _rec uuid; _before numeric; _after numeric;
begin
  select coalesce(sum(qty_delta), 0) into _before from public.stock_moves where article_id = pg_temp.c('a2') and not is_reservation;
  _r := public.purchase_doc_save(pg_temp.c('co'), null,
    jsonb_build_object('doc_type', 'REC', 'supplier_id', pg_temp.c('sup'), 'vat_regime', 'with_vat', 'supplier_bl_no', 'BL-C2-2'),
    jsonb_build_array(jsonb_build_object('article_id', pg_temp.c('a2'), 'designation', 'Piece B', 'quantity', 1, 'unit_price_ht', 0,
                                         'discount_pct', 0, 'vat_rate', 21)),
    '[]'::jsonb, true);
  _rec := (_r ->> 'id')::uuid;
  insert into _ctx values ('rec2', _rec);
  select coalesce(sum(qty_delta), 0) into _after from public.stock_moves where article_id = pg_temp.c('a2') and not is_reservation;

  insert into _t(check_name, result) values ('B1 panier : 1 recue sur 2 (reliquat 1)',
    case when pg_temp.rcv('o3', 'a2') = 1 then 'ok' else 'KO ' || pg_temp.rcv('o3', 'a2') end);
  insert into _t(check_name, result) values ('D1 stock : une seule entree de 1, la repartition ne bouge rien',
    case when _after - _before = 1 then 'ok' else 'KO ' || (_after - _before) end);
  insert into _t(check_name, result) values ('B2 Infos commandes client : client retrouve alors que sa commande est deja envoyee, par le panier',
    case when exists (select 1 from public.receipt_customer_infos(_rec) i
                       where i.source_id = pg_temp.c('o3') and i.ordered_for and i.via_kind = 'basket' and i.via_number = 'DCS-C2')
         then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('B3 n° DCS du panier sur le chemin',
    case when (select r.supplies -> 0 ->> 'dcs' from public.part_path_rows(pg_temp.c('co'), 'part_order', pg_temp.c('o3'), false, 10) r) = 'DCS-C2'
         then 'ok' else 'KO' end);

  _r := public.purchase_doc_save(pg_temp.c('co'), null,
    jsonb_build_object('doc_type', 'REC', 'supplier_id', pg_temp.c('sup'), 'vat_regime', 'with_vat', 'supplier_bl_no', 'BL-C2-3'),
    jsonb_build_array(jsonb_build_object('article_id', pg_temp.c('a2'), 'designation', 'Piece B', 'quantity', 5, 'unit_price_ht', 0,
                                         'discount_pct', 0, 'vat_rate', 21)),
    '[]'::jsonb, true);
  insert into _t(check_name, result) values ('B4 seconde reception (5) : le panier est complet, jamais plus que commande',
    case when pg_temp.rcv('o3', 'a2') = 2
          and (select sum(qty) from public.part_receipt_allocations where supply_line_id = pg_temp.c('bl')) = 2
         then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('B5 deux receptions sur le chemin',
    case when (select jsonb_array_length(r.supplies -> 0 -> 'receipts') from public.part_path_rows(pg_temp.c('co'), 'part_order', pg_temp.c('o3'), false, 10) r) = 2
         then 'ok' else 'KO' end);
end $s$;

-- ---------------------------------------------------------------- C. Classeur Excel
do $s$
declare _r jsonb; _rec uuid;
begin
  _r := public.purchase_doc_save(pg_temp.c('co'), null,
    jsonb_build_object('doc_type', 'REC', 'supplier_id', pg_temp.c('sup'), 'vat_regime', 'with_vat', 'supplier_bl_no', 'BL-C2-4'),
    jsonb_build_array(jsonb_build_object('article_id', pg_temp.c('a3'), 'designation', 'Piece C', 'quantity', 1, 'unit_price_ht', 0,
                                         'discount_pct', 0, 'vat_rate', 21)),
    '[]'::jsonb, true);
  _rec := (_r ->> 'id')::uuid;
  insert into _ctx values ('rec3', _rec);
  insert into _t(check_name, result) values ('C1 Excel : BL -> classeur -> client retrouve a la reception',
    case when exists (select 1 from public.receipt_customer_infos(_rec) i
                       where i.source_id = pg_temp.c('o4') and i.contact_id = pg_temp.c('cl2') and i.via_kind = 'excel')
         then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('C2 Excel : piece recue sur le chemin',
    case when pg_temp.rcv('o4', 'a3') = 1 then 'ok' else 'KO ' || pg_temp.rcv('o4', 'a3') end);
end $s$;

-- ---------------------------------------------------------------- E. Notification
reset role;
insert into _t(check_name, result)
select 'E1 ItalTest : commande complete, RIEN en file',
       case when not exists (select 1 from public.notifications where template = 'parts_received'
                              and entity_id in (select v from _ctx where k in ('o1', 'o3', 'o4')))
             and public._part_order_notify_received(pg_temp.c('o1')) = 'test_company'
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'E2 interrupteur inconnu du reste : arrete par defaut, et relie au modele de mail',
       case when public.automation_mode(pg_temp.c('co'), 'parts_received_mail') = 'arrete'
             and public._mail_switch_key('parts_received') = 'parts_received_mail' then 'ok' else 'KO' end;

-- La suite de la regle se verifie sur une societe JETABLE, creee dans cette transaction annulee : le
-- marquage d'ItalTest est protege (on n'y touche pas) et aucune fiche reelle n'est utilisee.
do $s$
declare _cx uuid; _c uuid; _art uuid; _oa uuid; _ob uuid; _oc uuid; _la uuid; _lb uuid; _lc uuid; _b1 uuid; _b2 uuid; _r1 text; _r2 text;
begin
  insert into public.companies (code, name) values ('C2JET', 'C2 ESSAI JETABLE') returning id into _cx;
  insert into public.contacts (company_id, type, first_name, last_name, email)
  values (_cx, 'particulier', 'JEAN', 'ESSAI', 'essai.c2@example.invalid') returning id into _c;
  insert into public.articles (company_id, reference, designation) values (_cx, 'C2-JETABLE', 'Piece jetable') returning id into _art;
  insert into public.part_orders (company_id, contact_id, order_kind) values (_cx, _c, 'standard') returning id into _oa;
  insert into public.part_orders (company_id, contact_id, order_kind) values (_cx, _c, 'standard') returning id into _ob;
  insert into public.part_orders (company_id, contact_id, order_kind) values (_cx, _c, 'standard') returning id into _oc;
  insert into public.part_order_lines (order_id, article_id, reference, designation, qty_client, unit_price_ht, vat_rate)
  values (_oa, _art, 'C2-JETABLE', 'Piece jetable', 1, 10, 21) returning id into _la;
  insert into public.part_order_lines (order_id, article_id, reference, designation, qty_client, unit_price_ht, vat_rate)
  values (_ob, _art, 'C2-JETABLE', 'Piece jetable', 1, 10, 21) returning id into _lb;
  insert into public.part_order_lines (order_id, article_id, reference, designation, qty_client, unit_price_ht, vat_rate)
  values (_oc, _art, 'C2-JETABLE', 'Piece jetable', 1, 10, 21) returning id into _lc;
  perform set_config('app.part_order_rpc', 'on', true);
  update public.part_orders set dispatch_status = 'envoyee', number = 'C2J-' || left(id::text, 6), validated_at = now() where company_id = _cx;
  perform set_config('app.part_order_rpc', 'off', true);
  insert into public.supplier_baskets (company_id, kind, label, status) values (_cx, 'standard', 'RECU', 'ouvert') returning id into _b1;
  insert into public.supplier_baskets (company_id, kind, label, status) values (_cx, 'standard', 'COMMANDE', 'ouvert') returning id into _b2;
  perform set_config('app.basket_rpc', 'on', true);
  insert into public.supplier_basket_lines (basket_id, company_id, article_id, reference, designation, qty, origin, origin_line_id, contact_id)
  values (_b1, _cx, _art, 'C2-JETABLE', 'Piece jetable', 1, 'comptoir', _la, _c),
         (_b1, _cx, _art, 'C2-JETABLE', 'Piece jetable', 1, 'comptoir', _lb, _c),
         (_b2, _cx, _art, 'C2-JETABLE', 'Piece jetable', 1, 'comptoir', _lc, _c);
  update public.supplier_baskets set status = 'recu', ordered_at = now(), received_at = now() where id = _b1;
  update public.supplier_baskets set status = 'commande', ordered_at = now() where id = _b2;
  perform set_config('app.basket_rpc', 'off', true);

  insert into _t(check_name, result) values ('E3 envoi arrete : rien en file, on coche a la main',
    case when public._part_order_notify_received(_oa) = 'off'
          and not exists (select 1 from public.notifications where company_id = _cx) then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('E4 reception incomplete : rien',
    case when public._part_order_notify_received(_oc) = 'incomplete' then 'ok' else 'KO' end);
  insert into public.automation_switches (company_id, key, mode) values (_cx, 'parts_received_mail', 'test');
  _r1 := public._part_order_notify_received(_oa);
  _r2 := public._part_order_notify_received(_oa);
  insert into _t(check_name, result) values ('E5 mode test : une notification preparee, puis plus aucune',
    case when _r1 = 'queued' and _r2 = 'already_queued'
          and (select count(*) from public.notifications where company_id = _cx and template = 'parts_received' and status = 'pending') = 1
         then 'ok' else 'KO ' || _r1 || '/' || _r2 end);
  insert into _t(check_name, result) values ('E5b texte du mail : Bonjour + prenom + n° de commande',
    case when (select body from public.notifications where company_id = _cx and template = 'parts_received') like 'Bonjour Jean, les pièces de votre commande C2J-%'
         then 'ok' else 'KO ' || coalesce((select left(body, 60) from public.notifications where company_id = _cx and template = 'parts_received'), '-') end);
  insert into public.purchase_customer_notices (company_id, receipt_id, article_id, source_kind, source_id, contact_id, channel)
  values (_cx, null, _art, 'part_order', _ob, _c, 'telephone');
  insert into _t(check_name, result) values ('E6 client deja prevenu a la main : rien',
    case when public._part_order_notify_received(_ob) = 'already_informed' then 'ok' else 'KO' end);
  update public.notifications set status = 'sent', is_test = true, sent_at = now() where company_id = _cx and template = 'parts_received';
  insert into _t(check_name, result) values ('E7 mail parti a l''adresse de test : le client n''est pas compte comme prevenu',
    case when (select r.informed_at from public._part_path_rows(_cx, 'part_order', _oa, false, 10) r) is null then 'ok' else 'KO' end);
  update public.notifications set is_test = false where company_id = _cx and template = 'parts_received';
  insert into _t(check_name, result) values ('E8 mail reel parti : client prevenu sur le chemin',
    case when (select r.informed_channel from public._part_path_rows(_cx, 'part_order', _oa, false, 10) r) = 'email' then 'ok' else 'KO' end);
  update public.contacts set email = null, email_pro = null where id = _c;
  delete from public.notifications where company_id = _cx;
  delete from public.purchase_customer_notices where company_id = _cx;
  insert into _t(check_name, result) values ('E9 client sans e-mail : rien en file, on coche a la main',
    case when public._part_order_notify_received(_oa) = 'no_email' then 'ok' else 'KO' end);
end $s$;

-- ---------------------------------------------------------------- F. Etiquettes de destination
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare _n int; _plain bigint; _ids bigint[]; _items jsonb;
begin
  select count(*) into _plain from public.label_queue_pending(pg_temp.c('co'));
  insert into _t(check_name, result) values ('F1 reception : etiquette pour le client, avec le n° de commande et la quantite',
    case when exists (select 1 from public.part_destination_labels('receipt', pg_temp.c('rec2')) l
                       where l.article_id = pg_temp.c('a2') and l.source_id = pg_temp.c('o3') and l.is_direct
                         and l.customer_name is not null and l.doc_number is not null and l.qty = 1)
         then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('F2 commande de pieces : une etiquette par piece',
    case when (select count(*) from public.part_destination_labels('part_order', pg_temp.c('o1'))) = 1 then 'ok' else 'KO' end);

  select jsonb_agg(jsonb_build_object('article_id', l.article_id, 'qty', 2, 'customer_name', l.customer_name, 'doc_number', l.doc_number,
                                      'bin_location', l.bin_location))
    into _items from public.part_destination_labels('part_order', pg_temp.c('o1')) l;
  _n := public.destination_labels_enqueue(pg_temp.c('co'), _items, null, 'part_order', pg_temp.c('o1')::text);
  _n := _n + public.destination_labels_enqueue(pg_temp.c('co'), _items, null, 'part_order', pg_temp.c('o1')::text);
  select p.ids into _ids from public.destination_labels_pending(pg_temp.c('co')) p where p.article_id = pg_temp.c('a1');
  insert into _t(check_name, result) values ('F3 edition differee cumulee (B12) : 2 + 2 = 4 sur la meme destination',
    case when _n = 2 and (select p.qty from public.destination_labels_pending(pg_temp.c('co')) p where p.article_id = pg_temp.c('a1')) = 4
         then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('F4 la file classique ne voit pas les etiquettes de destination',
    case when (select count(*) from public.label_queue_pending(pg_temp.c('co'))) = _plain then 'ok' else 'KO' end);
  perform public.label_queue_done(pg_temp.c('co'), _ids, 'imprime');
  insert into _t(check_name, result) values ('F5 imprimees : sorties de la file',
    case when not exists (select 1 from public.destination_labels_pending(pg_temp.c('co')) p where p.article_id = pg_temp.c('a1')) then 'ok' else 'KO' end);
end $s$;

-- ---------------------------------------------------------------- H. OR et preparation (lien du dossier atelier)
reset role;
do $s$
declare _ro uuid; _res uuid; _pk uuid; _num text;
begin
  select id, number into _ro, _num from public.repair_orders
   where company_id = pg_temp.c('co') and status::text not in ('facture', 'annule') order by created_at desc limit 1;
  if _ro is null then
    insert into _t(check_name, result) values ('H constat : aucun OR ouvert dans ItalTest, controle saute', 'ok');
    return;
  end if;
  insert into public.stock_reservations (company_id, article_id, repair_order_id, contact_id, reference, designation, qty_needed, qty_reserved, qty_to_order, status, origin)
  values (pg_temp.c('co'), pg_temp.c('a2'), _ro, pg_temp.c('cl1'), 'C2B', 'Piece B', 2, 1, 1, 'active', 'manuel') returning id into _res;
  insert into public.picking_lists (company_id, repair_order_id, status) values (pg_temp.c('co'), _ro, 'en_cours') returning id into _pk;
  insert into public.picking_list_items (company_id, picking_id, article_id, designation, reference, qty_ordered, qty_picked, status)
  values (pg_temp.c('co'), _pk, pg_temp.c('a2'), 'Piece B', 'C2B', 2, 2, 'pret');

  insert into _t(check_name, result) values ('H1 vue par OR : la piece, son OR, sa preparation',
    case when exists (select 1 from public._part_path_rows(pg_temp.c('co'), 'repair_order', _ro, false, 50) r
                       where r.demand_id = _res and r.or_number = _num and r.qty_reserved = 1 and r.qty_prepared = 2)
         then 'ok' else 'KO' end);
  perform set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
  insert into _t(check_name, result) values ('H2 etiquette a la preparation : piece, n° d''OR, quantite',
    case when exists (select 1 from public.part_destination_labels('picking', _pk) l
                       where l.article_id = pg_temp.c('a2') and l.doc_number = _num and l.qty = 2 and l.source_kind = 'repair_order')
         then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('H3 etiquettes de l''OR (lien du dossier atelier)',
    case when exists (select 1 from public.part_destination_labels('repair_order', _ro) l
                       where l.article_id = pg_temp.c('a2') and l.doc_number = _num and l.qty >= 2)
         then 'ok' else 'KO' end);
end $s$;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

-- ---------------------------------------------------------------- G. Droits
do $s$
declare _ok boolean := false;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}', true);
  begin
    perform * from public.part_path_rows(pg_temp.c('co'));
  exception when insufficient_privilege then _ok := true; end;
  insert into _t(check_name, result) values ('G1 chemin : refuse hors de la societe', case when _ok then 'ok' else 'KO' end);
  _ok := false;
  begin
    perform * from public.part_destination_labels('part_order', pg_temp.c('o1'));
  exception when insufficient_privilege then _ok := true; end;
  insert into _t(check_name, result) values ('G2 etiquettes : refuse hors de la societe', case when _ok then 'ok' else 'KO' end);
  perform set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
  _ok := false;
  begin
    insert into public.part_receipt_allocations (company_id, receipt_id, receipt_line_id, supply_kind, supply_line_id, qty)
    values (pg_temp.c('co'), pg_temp.c('rec1'), pg_temp.c('cmd_line'), 'basket', pg_temp.c('bl'), 1);
  exception when insufficient_privilege then _ok := true; end;
  insert into _t(check_name, result) values ('G3 lien reception : aucune ecriture directe', case when _ok then 'ok' else 'KO' end);
end $s$;
reset role;
