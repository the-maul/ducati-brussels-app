-- =====================================================================
-- Parcours G8 n° 3 (lot-verif-parcours, 20/11/2026) — Reprise d'une moto à un particulier.
-- G8 joué (parcours.md n° 3, 03-vehicules.md « Achat occasion → Fiche de reprise ») :
--   Fichiers › Parc › Achat occasion → n° de série + client (onglet Client) + prix de reprise
--   5 000 € (onglet Conditions, TVA 0 % « Reprise à un particulier », classement 08 OCCASIONS /
--   01 OCCASIONS PARTICULIERS) → Valider → article OCC1000000, type d'achat RACHAT, PAHT 5 000,
--   n° livre de police automatique, stock +1, cession VO ouverte d'office.
-- Chemin DMS rejoué EXACTEMENT comme l'écran (flux B3) :
--   1. Véhicules › Reprises › Nouvelle reprise (reprise-wizard.tsx → write-api.ts createReprise) :
--      next_document_number('REP') ; INSERT vehicles (statut « repris », prix de reprise) ;
--      INSERT vehicle_owners (vendeur = propriétaire précédent) ; INSERT oro (dossier REP) ;
--   2. Valider la reprise (validate-dialog → validate-api.ts validateReprise) : INSERT articles
--      (type O, référence = n° REP, PA = PAMP = coût, TVA 0, famille 08-01-01) ;
--      record_stock_move(entrée 1 au coût) ; UPDATE vehicles (article, « stock_vo », prix) ;
--      UPDATE oro (statut « repris », check-list, statut TVA vendeur, montants, prix minimum,
--      classement) ; déclencheurs : registre des véhicules (code 4), cession VO automatique.
-- Correctifs du dépôt nécessaires (PRE_SQL) : 20261120120100 (colonnes du dossier de reprise en
--   base), 20261120120200 (n° livre de police sur la fiche moto).
-- Société de test ItalTest, administrateur simon@themaul.be, transaction annulée (rt.py).
-- Contrôles :
--   1. n° REP = suivant de la série REP de la société (compteur +1) ;
--   2. demande de reprise : moto « repris », sans article ni stock, vendeur = propriétaire précédent ;
--   3. article d'occasion créé : type O (TVA marge), TVA 0 % (reprise à un particulier), réf = n° REP,
--      famille 08-01-01 ;
--   4. PA = PAMP = 5 000 (B5) ;
--   5. mouvement de stock : entrée +1 au coût 5 000, origine, référence REP, opérateur (B7) ;
--   6. historique du mouvement : ancien stock 0 → nouveau stock 1 ;
--   7. valeur du stock de la société + 5 000 ;
--   8. fiche moto : « en stock occasion », article lié, prix d'achat / coût de revient 5 000 ;
--   9. dossier REP (ORO) relié à la moto (B3) ;
--  10. registre des véhicules : entrée code 4, source reprise, vendeur, date du jour ;
--  11. n° livre de police recopié sur la fiche moto (correctif 20261120120200) ;
--  12. cession VO ouverte d'office (type 01, origine reprise, n° de la série ORO, dossier et vendeur) ;
--  13. dossier en base : statut « repris », statut TVA particulier, prix minimum 6 000 (correctif 120100) ;
--  14. traces events : création et entrée en stock de la moto ;
--  15. écart G8 / DMS (constat) : référence REP-… (G8 : OCC + 7 chiffres).
-- Chaque ligne du résultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _vin text := 'ZDMP03' || to_char(clock_timestamp(), 'HH24MISSUS');
  _seller uuid; _num text; _seq_before int; _seq_after int; _prefix text;
  _veh uuid; _oro uuid; _art uuid; _val_before numeric; _val_after numeric;
  v record; a record; m record; d record; r record; c record; o record; _real numeric; _n int;
begin
  -- Vendeur : client particulier (parcours 1)
  insert into public.contacts (company_id, type, status, civility, first_name, last_name, zip, city, country)
  values (_co, 'particulier', 'prospect', 'M', 'Paul', 'VENDEUR P03', '1000', 'Bruxelles', 'BE') returning id into _seller;
  _val_before := public.stock_value_owned(_co);

  -- ------------------------------------------------ 1. createReprise
  select next_value, prefix into _seq_before, _prefix from public.document_sequences where company_id = _co and doc_type = 'REP';
  _num := public.next_document_number(_co, 'REP');
  select next_value into _seq_after from public.document_sequences where company_id = _co and doc_type = 'REP';
  insert into _t(check_name, result) values
    ('n° ' || _num || ' : suivant de la serie REP (compteur +1)',
     case when _num like _prefix || '%' and _seq_after = _seq_before + 1 then 'ok' else 'KO ' || _num || ' ' || _seq_before || '->' || _seq_after end);

  insert into public.vehicles (company_id, vin, brand, model, mileage, first_registration_date, model_year,
                               purchase_price, cost_price, display_price, status)
  values (_co, _vin, 'Ducati', 'Monster 821', 18500, date '2019-04-01', 2019, 5000, 5000, 6500, 'repris')
  returning id into _veh;
  insert into public.vehicle_owners (vehicle_id, contact_id, from_date, to_date, is_current)
  values (_veh, _seller, date '2019-04-01', current_date, false);
  insert into public.oro (company_id, number, vehicle_id, status) values (_co, _num, _veh, 'ouvert') returning id into _oro;

  select * into v from public.vehicles where id = _veh;
  insert into _t(check_name, result) values
    ('demande : moto « repris », sans article ni stock, vendeur proprietaire precedent',
     case when v.status::text = 'repris' and v.article_id is null
               and exists (select 1 from public.vehicle_owners where vehicle_id = _veh and contact_id = _seller and not is_current)
               and not exists (select 1 from public.vehicle_register where vehicle_id = _veh) then 'ok' else 'KO ' || v.status::text end);

  -- ------------------------------------------------ 2. validateReprise (particulier : TVA 0, cout = prix TVAC)
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, sale_price_ttc, vat_rate,
                               category_path, note)
  values (_co, _num, 'Ducati Monster 821', 'O', 5000, 5000, 6500, 0, '08-01-01',
          'DUCATI BRUXELLES / 08 - OCCASIONS / 01 - OCCASIONS PARTICULIERS / 01 - OCCASIONS PARTICULIERS')
  returning id into _art;
  perform public.record_stock_move(_art, 'entree'::public.stock_move_type, 1, 5000, false, null, 'reception', _num,
                                   'Reprise validée — entrée en stock occasion');
  update public.vehicles set article_id = _art, status = 'stock_vo', purchase_price = 5000, cost_price = 5000, display_price = 6500
   where id = _veh;
  update public.oro set tradein_status = 'repris',
         checklist = '{"coc":true,"registration":true,"main_key":true,"second_key":true,"code_card":false,"original_parts":true,"service_book":true,"user_manual":true,"service_invoices":false}'::jsonb,
         seller_vat_status = 'particulier', attestation = jsonb_build_object('place', 'Bruxelles', 'date', current_date, 'signed', true),
         vat_rate = 0, buy_price_ttc = 5000, buy_price_ht = 5000, sale_price = 6500, min_sale_price = 6000,
         classification = '{"supplier":"DUCATI BRUXELLES","rayon":"08 - OCCASIONS","sub_rayon":"01 - OCCASIONS PARTICULIERS","category":"01 - OCCASIONS PARTICULIERS"}'::jsonb,
         validated_at = now(), cancelled_at = null
   where id = _oro;

  select * into a from public.articles where id = _art;
  select * into v from public.vehicles where id = _veh;
  insert into _t(check_name, result) values
    ('article occasion : type O (TVA marge), TVA 0 % reprise a un particulier, ref = n° REP, famille 08-01-01',
     case when a.mgmt_type::text = 'O' and a.vat_rate = 0 and a.reference = _num and a.category_path = '08-01-01' then 'ok' else 'KO ' || a.mgmt_type::text || ' ' || a.vat_rate end),
    ('PA = PAMP = 5 000 (B5)', case when a.purchase_price = 5000 and a.pamp = 5000 then 'ok' else 'KO ' || a.purchase_price || ' / ' || a.pamp end);

  select * into m from public.stock_moves where article_id = _art order by occurred_at desc, id desc limit 1;
  insert into _t(check_name, result) values
    ('mouvement : entree +1 au cout 5 000, origine, ref REP, operateur (B7)',
     case when m.move_type::text = 'entree' and m.qty_delta = 1 and m.unit_cost = 5000 and m.ref = _num
               and m.origin is not null and m.operator_id = auth.uid() then 'ok' else 'KO ' || coalesce(m.move_type::text, 'aucun') end);
  select * into d from public.article_moves_detail(_art) x where x.move_id = m.id;
  insert into _t(check_name, result) values
    ('historique : ancien stock 0 -> nouveau stock 1', case when d.real_before = 0 and d.real_after = 1 then 'ok' else 'KO ' || coalesce(d.real_before::text, '?') || '->' || coalesce(d.real_after::text, '?') end);
  _val_after := public.stock_value_owned(_co);
  insert into _t(check_name, result) values
    ('valeur du stock + 5 000', case when _val_after - _val_before = 5000 then 'ok' else 'KO ecart ' || (_val_after - _val_before) end),
    ('fiche moto : en stock occasion, article lie, PA / cout de revient 5 000',
     case when v.status::text = 'stock_vo' and v.article_id = _art and v.purchase_price = 5000 and v.cost_price = 5000 then 'ok' else 'KO ' || v.status::text end),
    ('dossier REP (ORO) relie a la moto (B3)', case when exists (select 1 from public.oro where id = _oro and vehicle_id = _veh and number = _num) then 'ok' else 'KO' end);

  -- Registre des vehicules (livre de police)
  select * into r from public.vehicle_register where vehicle_id = _veh and source = 'reprise' order by created_at desc limit 1;
  insert into _t(check_name, result) values
    ('registre : entree code 4, source reprise, vendeur, date du jour',
     case when r.id is not null and r.nature_code = '4' and r.contact_id = _seller and r.entered_at = current_date and r.source_id = _oro then 'ok'
          else 'KO ' || coalesce(r.nature_code, 'aucune ligne') end),
    ('n° livre de police sur la fiche moto (' || coalesce(r.year || '-' || lpad(r.seq::text, 4, '0'), '?') || ')',
     case when v.police_book_number = r.year || '-' || lpad(r.seq::text, 4, '0') then 'ok' else 'KO ' || coalesce(v.police_book_number, 'vide') end);

  -- Cession VO automatique (G8 : cession 5000011 « CESSION VO » ouverte d'office)
  select * into c from public.internal_cessions where vehicle_id = _veh and origin = 'reprise';
  select prefix into _prefix from public.document_sequences where company_id = _co and doc_type = 'ORO';
  insert into _t(check_name, result) values
    ('cession VO ouverte d office : type 01, ouverte, n° serie ORO, dossier et vendeur',
     case when c.id is not null and c.cession_type = '01' and c.status = 'ouvert' and c.number like _prefix || '%'
               and c.oro_id = _oro and c.contact_id = _seller then 'ok' else 'KO ' || coalesce(c.cession_type, 'aucune') end);

  -- Dossier en base (correctif 20261120120100)
  select * into o from public.oro where id = _oro;
  insert into _t(check_name, result) values
    ('dossier en base : statut repris, vendeur particulier, prix minimum 6 000, classement',
     case when o.tradein_status = 'repris' and o.seller_vat_status = 'particulier' and o.min_sale_price = 6000
               and o.classification->>'rayon' = '08 - OCCASIONS' and o.validated_at is not null then 'ok' else 'KO' end);

  -- Traces
  insert into _t(check_name, result) values
    ('events : creation et entree en stock de la moto tracees',
     case when exists (select 1 from public.events where entity_type = 'vehicles' and entity_id = _veh::text and action = 'insert')
               and exists (select 1 from public.events where entity_type = 'vehicles' and entity_id = _veh::text and action = 'update'
                             and new_data->>'status' = 'stock_vo' and old_data->>'status' = 'repris') then 'ok' else 'KO' end);

  -- Constats G8 / DMS (a trancher, contr. « ok » sur le constat)
  insert into _t(check_name, result) values
    ('A TRANCHER (constat) : reference ' || _num || ' (G8 : OCC + 7 chiffres, type d achat RACHAT)',
     case when _num not like 'OCC%' then 'ok' else 'KO' end);
end $s$;

select n, check_name, result from _t order by n;
