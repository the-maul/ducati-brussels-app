-- =====================================================================
-- Parcours G8 n° 15 (lot-verif-parcours, 20/11/2026) — Dépôt-vente : entrée.
-- G8 joué (parcours.md n° 15, 03-vehicules.md « Création d'un dépôt-vente ») : Fichiers › Parc ›
--   Création d'un dépôt vente → onglets Produit fini (n° de série) / Client (déposant) / Conditions
--   (prix demandé 6 000, prix de vente TTC 7 000, prix minimum de réserve, conditions) → Valider
--   → DEP2000001, n° livre de police automatique, + cession interne 5000014 ouverte d'office ;
--   type de gestion D : la moto N'ENTRE PAS en valorisation de stock.
-- Chemin DMS rejoué comme l'écran : Véhicules › Dépôt-vente › Nouveau dépôt
--   (consignment-entry-dialog.tsx → consignment-api.ts createConsignment = RPC consignment_create,
--   migration 20261118270000) ; liste des dépôts (listConsignmentsFull = SELECT consignments).
-- Société de test ItalTest, administrateur simon@themaul.be, transaction annulée (rt.py).
-- Contrôles :
--   1. n° DEP = suivant de la série DEP de la société (compteur +1) ;
--   2. fiche moto créée au statut « dépôt-vente », prix affiché 7 000, référence = n° DEP ;
--   3. prix demandé 6 000 / prix de vente 7 000 / minimum 6 500, conditions et mention légale par défaut ;
--   4. article de type D relié à la moto ;
--   5. stock réel 1, mouvement d'entrée SANS valeur, PAMP 0 (type D hors valorisation) ;
--   6. valeur du stock de la société inchangée ;
--   7. mouvement tracé : une seule entrée, origine moto_parc (article D de la fiche moto), référence DEP,
--      opérateur (B7) ;
--   8. déposant = propriétaire courant de la moto (B9) ;
--   9. registre des véhicules : entrée code 4, source dépôt ; n° livre de police sur la fiche de
--      dépôt et sur la fiche moto ;
--  10. check-list des documents remis conservée ;
--  11. trace events consignment_create ;
--  12. le dépôt figure dans la liste « en dépôt » ; recherche parc : famille « dépôt-vente » ;
--  13. garde-fous : entrée valorisée d'un article D refusée ; moto déjà en dépôt refusée ;
--      moto du stock de la concession (occasion en stock) refusée ; déposant obligatoire ;
--  14. À TRANCHER (constat, « ok » sur l'absence) : pas de cession interne ouverte d'office à
--      l'entrée du dépôt (G8 : cession 5000014) — voir rapport.
-- Chaque ligne du résultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _vin text := 'ZDMP15' || to_char(clock_timestamp(), 'HH24MISSUS');
  _dep uuid; _c uuid; _seq0 int; _seq1 int; _prefix text; _val0 numeric; _real numeric; _n int;
  _vo uuid; _voart uuid;
  cs record; v record; m record; r record;
begin
  insert into public.contacts (company_id, type, status, civility, first_name, last_name, zip, city, country)
  values (_co, 'particulier', 'prospect', 'MME', 'Anne', 'DEPOSANTE P15', '1050', 'Ixelles', 'BE') returning id into _dep;
  _val0 := public.stock_value_owned(_co);
  select next_value, prefix into _seq0, _prefix from public.document_sequences where company_id = _co and doc_type = 'DEP';

  -- Entree comme l'ecran (payload() de consignment-entry-dialog, moto nouvelle)
  _c := public.consignment_create(_co, jsonb_build_object(
    'depositor_id', _dep, 'depositor_kind', 'particulier',
    'vehicle', jsonb_build_object('vin', _vin, 'brand', 'Ducati', 'model', 'Multistrada 950', 'model_year', '2020',
                                  'plate', '2-P15-' || substr(_vin, 12, 3), 'mileage', '23000', 'color', 'Rouge', 'first_registration_date', '2020-05-01'),
    'agreed_price', 7000, 'asked_price', 6000, 'min_price', 6500, 'commission_mode', 'ecart', 'commission_pct', 10,
    'commission_amount', null, 'deposit_fee', 0, 'conditions', '', 'legal_mention', '', 'police_book_number', '',
    'checklist', jsonb_build_object('coc', true, 'registration', true, 'main_key', true, 'second_key', false),
    'entry_date', current_date::text, 'notes', 'Essai parcours 15'));
  select * into cs from public.consignments where id = _c;
  select * into v from public.vehicles where id = cs.vehicle_id;
  select next_value into _seq1 from public.document_sequences where company_id = _co and doc_type = 'DEP';

  insert into _t(check_name, result) values
    ('n° ' || cs.number || ' : suivant de la serie DEP (compteur +1)',
     case when cs.number like _prefix || '%' and _seq1 = _seq0 + 1 then 'ok' else 'KO ' || coalesce(cs.number, 'null') end),
    ('fiche moto : statut depot-vente, prix affiche 7 000, reference = n° DEP',
     case when v.status::text = 'depot_vente' and v.display_price = 7000 and v.reference = cs.number and upper(v.vin) = _vin then 'ok' else 'KO ' || v.status::text end),
    ('conditions : prix demande 6 000, PV 7 000, minimum 6 500, conditions et mention legale par defaut',
     case when cs.asked_price = 6000 and cs.agreed_price = 7000 and cs.min_price = 6500 and cs.status = 'en_depot'
               and cs.conditions like 'Le vehicule reste la propriete du deposant%' and cs.legal_mention is not null then 'ok' else 'KO' end),
    ('article de type D relie a la moto',
     case when (select mgmt_type::text from public.articles where id = cs.article_id) = 'D' and v.article_id = cs.article_id then 'ok' else 'KO' end);

  select coalesce(s.real_qty, 0) into _real from public.article_stock(cs.article_id) s;
  select * into m from public.stock_moves where article_id = cs.article_id order by occurred_at desc, id desc limit 1;
  select count(*) into _n from public.stock_moves where article_id = cs.article_id;
  insert into _t(check_name, result) values
    ('stock reel 1, entree sans valeur, PAMP 0 (type D hors valorisation)',
     case when _real = 1 and coalesce(m.unit_cost, 0) = 0 and coalesce((select pamp from public.articles where id = cs.article_id), 0) = 0 then 'ok' else 'KO ' || _real end),
    ('valeur du stock de la societe inchangee', case when public.stock_value_owned(_co) = _val0 then 'ok' else 'KO ' || _val0 || ' -> ' || public.stock_value_owned(_co) end),
    ('mouvement trace : entree +1, origine moto_parc (fiche moto D), ref DEP, operateur',
     case when m.move_type::text = 'entree' and m.qty_delta = 1 and m.origin in ('moto_parc', 'consignment') and m.ref = cs.number and m.operator_id = auth.uid() and _n = 1 then 'ok' else 'KO ' || coalesce(m.origin, '?') || ' x' || _n end),
    ('deposant proprietaire courant (B9)',
     case when exists (select 1 from public.vehicle_owners where vehicle_id = v.id and contact_id = _dep and is_current) then 'ok' else 'KO' end);

  select * into r from public.vehicle_register where vehicle_id = v.id and source = 'depot' order by created_at desc limit 1;
  insert into _t(check_name, result) values
    ('registre : entree code 4, source depot, deposant',
     case when r.nature_code = '4' and r.source_id = _c and r.contact_id = _dep then 'ok' else 'KO ' || coalesce(r.nature_code, 'aucune ligne') end),
    ('n° livre de police sur la fiche de depot et la fiche moto',
     case when cs.police_book_number = r.year || '-' || lpad(r.seq::text, 4, '0') and v.police_book_number = cs.police_book_number then 'ok'
          else 'KO ' || coalesce(cs.police_book_number, 'vide') || ' / ' || coalesce(v.police_book_number, 'vide') end),
    ('check-list des documents remis conservee', case when (cs.checklist->>'coc')::boolean and not (cs.checklist->>'second_key')::boolean then 'ok' else 'KO' end),
    ('trace events consignment_create',
     case when exists (select 1 from public.events where entity_type = 'consignments' and entity_id = _c::text and action = 'consignment_create') then 'ok' else 'KO' end);

  select count(*) into _n from public.consignments where company_id = _co and status = 'en_depot' and id = _c;
  insert into _t(check_name, result) values
    ('liste des depots « en depot » ; parc : famille depot-vente',
     case when _n = 1 and public.vehicle_parc_kind(v.status) = 'depot_vente' then 'ok' else 'KO' end);

  -- Garde-fous
  begin
    perform public.record_stock_move(cs.article_id, 'entree'::public.stock_move_type, 1, 100, false, null, 'screen', null, 'essai');
    insert into _t(check_name, result) values ('garde-fou : entree valorisee d un article D refusee', 'KO acceptee');
  exception when others then
    insert into _t(check_name, result) values ('garde-fou : entree valorisee d un article D refusee', case when sqlerrm like '%valorisation%' then 'ok' else 'KO ' || sqlerrm end);
  end;
  begin
    perform public.consignment_create(_co, jsonb_build_object('depositor_id', _dep, 'vehicle_id', v.id, 'agreed_price', 7000));
    insert into _t(check_name, result) values ('garde-fou : moto deja en depot refusee', 'KO acceptee');
  exception when others then
    insert into _t(check_name, result) values ('garde-fou : moto deja en depot refusee', 'ok');
  end;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, vat_rate)
  values (_co, 'ZZP15VO-' || substr(_vin, 7), 'Occasion en stock', 'O', 4000, 4000, 0) returning id into _voart;
  insert into public.vehicles (company_id, vin, brand, model, status, article_id, purchase_price)
  values (_co, _vin || 'X', 'Ducati', 'Scrambler', 'stock_vo', _voart, 4000) returning id into _vo;
  begin
    perform public.consignment_create(_co, jsonb_build_object('depositor_id', _dep, 'vehicle_id', _vo, 'agreed_price', 5000));
    insert into _t(check_name, result) values ('garde-fou : moto du stock de la concession refusee en depot', 'KO acceptee');
  exception when others then
    insert into _t(check_name, result) values ('garde-fou : moto du stock de la concession refusee en depot', case when sqlerrm like '%stock de la concession%' then 'ok' else 'KO ' || sqlerrm end);
  end;
  begin
    perform public.consignment_create(_co, jsonb_build_object('vehicle', jsonb_build_object('vin', _vin || 'Y'), 'agreed_price', 5000));
    insert into _t(check_name, result) values ('garde-fou : deposant obligatoire', 'KO acceptee');
  exception when others then
    insert into _t(check_name, result) values ('garde-fou : deposant obligatoire', 'ok');
  end;

  -- Constat a trancher : G8 ouvre une cession interne d'office a l'entree du depot (5000014)
  insert into _t(check_name, result) values
    ('A TRANCHER (constat) : pas de cession interne ouverte d office a l entree du depot (G8 : oui)',
     case when not exists (select 1 from public.internal_cessions where vehicle_id = v.id) then 'ok' else 'KO une cession existe : mettre a jour le rapport' end);
end $s$;

select n, check_name, result from _t order by n;
