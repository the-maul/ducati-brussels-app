-- =====================================================================
-- Parcours G8 n° 14 (lot-verif-parcours, 20/11/2026) — Moto neuve (nouveau châssis sur un modèle).
-- G8 joué (parcours.md n° 14, 03-vehicules.md « Nouveau châssis ») : Fichiers › Parc ›
--   Ajout/Modif/Suppr produit fini → modèle DESERTX (4 châssis en stock) → Nouv. châssis →
--   n° de série seul exigé (VIN de 15 caractères accepté) → Valider → ZDMTESTCLAUDE02 ajouté,
--   stock réel du modèle 4 → 5 ; date d'entrée automatique ; n° de livre de police.
-- Chemin DMS rejoué comme l'écran : Pièces › fiche du modèle (article de type V, onglet Châssis,
--   model-chassis-panel.tsx NewChassisDialog → chassis-api.ts addModelChassis =
--   RPC vehicle_chassis_receive(_article, {vin, …}, PA du modèle, 'chassis_manuel')).
--   ItalTest ne contient AUCUN modèle à plusieurs châssis (les motos G8 ont été reprises « un
--   article par moto ») : l'essai crée donc le modèle DESERTX et ses 4 châssis en stock, comme dans
--   la base G8, puis joue le 5e.
-- Correctif du dépôt nécessaire (PRE_SQL) : 20261120120200 (n° livre de police sur la fiche moto).
-- Société de test ItalTest, administrateur simon@themaul.be, transaction annulée (rt.py).
-- Contrôles :
--   1. départ : modèle DESERTX, 4 châssis en stock, stock réel 4 ;
--   2. nouveau châssis : fiche moto « stock neuf » liée au modèle, référence / marque / modèle repris,
--      date d'entrée du jour, PA = PA du modèle, prix affiché = PV TTC du modèle ;
--   3. stock réel du modèle 4 → 5 (somme des mouvements, B4) ;
--   4. mouvement : entrée +1 au PA, origine chassis_manuel, référence = VIN, opérateur (B7) ;
--   5. historique : ancien stock 4 → nouveau stock 5 ;
--   6. PAMP du modèle recalculé sur l'entrée (B5) ;
--   7. 5 châssis listés sur le modèle, modèle sans « moto unique » (articles.vehicle_id vide) ;
--   8. registre des véhicules : entrée VN, source réception ;
--   9. n° livre de police recopié sur la fiche moto (correctif 20261120120200) ;
--  10. trace events « chassis_recu » ;
--  11. VIN de 15 caractères accepté (comme G8 sans l'option « contrôle 17 caractères ») ;
--  12. VIN déjà dans le parc refusé ;
--  13. n° de série obligatoire ;
--  14. un article qui n'est pas un modèle (type A) ne reçoit pas de châssis ;
--  15. contrôle de cohérence du parc : aucune anomalie sur le modèle (stock = châssis en stock).
-- Chaque ligne du résultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _tag text := to_char(clock_timestamp(), 'HH24MISSMS');
  _model uuid; _a uuid; _new uuid; _i int; _real0 numeric; _real1 numeric; _pamp0 numeric; _pamp1 numeric;
  _vin text := 'ZDMTESTP14' || substr(_tag, 1, 7);   -- 17 caracteres
  _vin15 text := 'ZDMP14' || substr(_tag, 1, 9);      -- 15 caracteres
  v record; a record; m record; d record; r record; _n int;
begin
  -- Modele DESERTX et ses 4 chassis en stock (etat de depart du parcours G8)
  insert into public.articles (company_id, reference, designation, brand, mgmt_type, purchase_price, pamp, sale_price_ttc, vat_rate, category_path)
  values (_co, 'DESERTX-P14-' || _tag, 'DESERT X', 'DUCATI', 'V', 12400, 0, 16590, 21, '01-01-09') returning id into _model;
  for _i in 1..4 loop
    perform public.vehicle_chassis_receive(_model, jsonb_build_object('vin', 'ZDMDEPARTP14' || _i || substr(_tag, 1, 4), 'color', 'BLANC'),
                                           12000 + _i * 100, 'reception', 'REC-ESSAI-P14', null);
  end loop;
  select coalesce(s.real_qty, 0) into _real0 from public.article_stock(_model) s;
  select pamp into _pamp0 from public.articles where id = _model;
  insert into _t(check_name, result) values
    ('depart : modele DESERTX, 4 chassis en stock, stock reel 4',
     case when _real0 = 4 and (select count(*) from public.vehicles where article_id = _model and status = 'stock_vn') = 4 then 'ok' else 'KO ' || _real0 end);

  -- Nouv. chassis (dialogue : VIN, PA du modele, PV TTC du modele)
  _new := public.vehicle_chassis_receive(_model,
            jsonb_build_object('vin', _vin, 'engine_number', null, 'color', 'GRIS', 'model_year', null,
                               'key_number', null, 'police_book_number', null, 'exposition_code', null, 'display_price', 16590),
            12400, 'chassis_manuel', null, null);
  select * into v from public.vehicles where id = _new;
  select * into a from public.articles where id = _model;
  insert into _t(check_name, result) values
    ('nouveau chassis : stock neuf, lie au modele, ref / marque / modele repris, entree du jour, PA 12 400, PV 16 590',
     case when v.status::text = 'stock_vn' and v.article_id = _model and v.reference = a.reference and v.brand = 'DUCATI'
               and v.model = 'DESERT X' and v.entry_date = current_date and v.purchase_price = 12400 and v.display_price = 16590
          then 'ok' else 'KO ' || v.status::text || ' ' || coalesce(v.model, '?') end);

  select coalesce(s.real_qty, 0) into _real1 from public.article_stock(_model) s;
  insert into _t(check_name, result) values ('stock reel du modele 4 -> 5', case when _real1 = 5 then 'ok' else 'KO ' || _real1 end);

  select * into m from public.stock_moves where article_id = _model order by occurred_at desc, id desc limit 1;
  insert into _t(check_name, result) values
    ('mouvement : entree +1 au PA, origine chassis_manuel, ref = VIN, operateur',
     case when m.move_type::text = 'entree' and m.qty_delta = 1 and m.unit_cost = 12400 and m.origin = 'chassis_manuel'
               and m.ref = _vin and m.operator_id = auth.uid() then 'ok' else 'KO ' || coalesce(m.origin, '?') || ' ' || coalesce(m.ref, '?') end);
  select * into d from public.article_moves_detail(_model) x where x.move_id = m.id;
  insert into _t(check_name, result) values
    ('historique : ancien stock 4 -> nouveau stock 5', case when d.real_before = 4 and d.real_after = 5 then 'ok' else 'KO ' || coalesce(d.real_before::text, '?') || '->' || coalesce(d.real_after::text, '?') end);

  _pamp1 := a.pamp;
  insert into _t(check_name, result) values
    ('PAMP recalcule sur l entree : (4 x ' || _pamp0 || ' + 12 400) / 5',
     case when abs(_pamp1 - round((_pamp0 * 4 + 12400) / 5, 3)) <= 0.01 then 'ok' else 'KO ' || _pamp0 || ' -> ' || _pamp1 end),
    ('5 chassis sur le modele, pas de « moto unique » sur le modele',
     case when (select count(*) from public.vehicles where article_id = _model) = 5 and a.vehicle_id is null then 'ok' else 'KO' end);

  select * into r from public.vehicle_register where vehicle_id = _new order by created_at desc limit 1;
  insert into _t(check_name, result) values
    ('registre : entree VN, source reception', case when r.nature_code = 'VN' and r.source = 'reception' and r.entered_at = current_date then 'ok' else 'KO ' || coalesce(r.nature_code, 'aucune ligne') end),
    ('n° livre de police sur la fiche moto', case when v.police_book_number = r.year || '-' || lpad(r.seq::text, 4, '0') then 'ok' else 'KO ' || coalesce(v.police_book_number, 'vide') end),
    ('trace events chassis_recu', case when exists (select 1 from public.events where entity_type = 'vehicles' and entity_id = _new::text and action = 'chassis_recu'
                                                     and new_data->>'vin' = _vin) then 'ok' else 'KO' end);

  -- VIN de 15 caracteres (G8 l'accepte sans l'option 17 caracteres)
  begin
    perform public.vehicle_chassis_receive(_model, jsonb_build_object('vin', _vin15), 12400, 'chassis_manuel', null, null);
    insert into _t(check_name, result) values ('VIN de 15 caracteres accepte (comme G8)', 'ok');
  exception when others then
    insert into _t(check_name, result) values ('VIN de 15 caracteres accepte (comme G8)', 'KO ' || sqlerrm);
  end;
  begin
    perform public.vehicle_chassis_receive(_model, jsonb_build_object('vin', lower(_vin)), 12400, 'chassis_manuel', null, null);
    insert into _t(check_name, result) values ('VIN deja dans le parc refuse', 'KO accepte');
  exception when others then
    insert into _t(check_name, result) values ('VIN deja dans le parc refuse', case when sqlerrm like 'VIN_EXISTS%' then 'ok' else 'KO ' || sqlerrm end);
  end;
  begin
    perform public.vehicle_chassis_receive(_model, jsonb_build_object('vin', '  '), 12400, 'chassis_manuel', null, null);
    insert into _t(check_name, result) values ('n° de serie obligatoire', 'KO accepte');
  exception when others then
    insert into _t(check_name, result) values ('n° de serie obligatoire', 'ok');
  end;
  insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate) values (_co, 'ZZP14A-' || _tag, 'PIECE', 'A', 21) returning id into _a;
  begin
    perform public.vehicle_chassis_receive(_a, jsonb_build_object('vin', 'ZDMP14ARTICLEA' || substr(_tag, 1, 3)), 0, 'chassis_manuel', null, null);
    insert into _t(check_name, result) values ('un article de type A ne recoit pas de chassis', 'KO accepte');
  exception when others then
    insert into _t(check_name, result) values ('un article de type A ne recoit pas de chassis', 'ok');
  end;

  select count(*) into _n from public.vehicles_parc_check(_co) x
   where x.vehicle_id in (select id from public.vehicles where article_id = _model) or x.model ilike '%' || a.reference || '%';
  insert into _t(check_name, result) values ('coherence du parc : aucune anomalie sur le modele', case when _n = 0 then 'ok' else 'KO ' || _n || ' anomalie(s)' end);
end $s$;

select n, check_name, result from _t order by n;
