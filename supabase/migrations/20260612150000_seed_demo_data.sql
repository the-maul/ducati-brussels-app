-- =====================================================================
-- SEED — Données de démonstration (règle 8 CLAUDE.md) : par société,
-- ~20 clients, 300 articles (tous types A–R/T), 12 véhicules, 5 OR.
-- Stock via stock_moves (append-only B7), PAMP posé à la création (entrée initiale).
-- IDEMPOTENT : gardes par marqueur (réf 'SEED-%', notes 'SEED', vin 'SEEDVIN%').
-- =====================================================================
do $$
declare
  co        record;
  i         int;
  _type     text;
  _types    text[]  := array['A','M','F','N','V','O','P','D','R','T'];
  _brands   text[]  := array['Ducati','Rizoma','Termignoni','Shoei','Dainese','Akrapovic','Pirelli','Michelin'];
  _nouns    text[]  := array['Filtre à huile','Plaquette de frein','Kit chaîne','Casque','Blouson','Échappement','Pneu AV','Pneu AR','Levier','Rétroviseur','Sabot moteur','Protection','Disque de frein','Bougie','Courroie'];
  _models   text[]  := array['Panigale V4','Monster 937','Multistrada V4','Streetfighter V4','Diavel V4','Scrambler 800','Hypermotard 950','DesertX','SuperSport 950','Monster 821','Panigale V2','Multistrada 950'];
  _pa       numeric; _pvht numeric; _pvttc numeric; _ref text; _art uuid; _vat numeric;
  _firstnames text[] := array['Lucas','Emma','Hugo','Léa','Noah','Chloé','Louis','Jade','Gabriel','Alice','Adam','Lina','Raphaël','Manon','Arthur','Inès'];
  _lastnames  text[] := array['Dupont','Janssens','Peeters','Maes','Wouters','De Smet','Dubois','Lambert','Claes','Goossens','Willems','Mertens','Lemaire','Simon','Martin','Dumont'];
  _contact  uuid; _firstContact uuid; _veh uuid; _firstVeh uuid;
  _or uuid; _statuses text[] := array['a_faire','en_cours','pret','a_faire','en_cours'];
begin
  for co in select id, code from public.companies loop

    ----------------------------------------------------------------------
    -- ARTICLES (300) + stock
    ----------------------------------------------------------------------
    if (select count(*) from public.articles where company_id = co.id and reference like 'SEED-%') = 0 then
      for i in 1..300 loop
        _type := _types[(i % 10) + 1];
        _pa   := 10 + (i % 290);
        _pvht := round(_pa * 1.8, 2);
        _pvttc:= round(_pvht * 1.21, 2);
        _vat  := 21;
        _ref  := 'SEED-' || _type || '-' || lpad(i::text, 4, '0');
        insert into public.articles (company_id, reference, designation, brand, mgmt_type, category_path,
            bin_location, purchase_price, pamp, sale_price_ht, sale_price_ttc, coefficient, vat_rate,
            stock_min, stock_max, publishable, is_active)
        values (co.id, _ref,
            _brands[(i % 8) + 1] || ' ' || _nouns[(i % 15) + 1],
            _brands[(i % 8) + 1], _type::public.article_mgmt_type,
            'Rayon ' || ((i % 5) + 1) || '/Sous-rayon ' || ((i % 3) + 1),
            'C' || lpad(((i % 40) + 1)::text, 2, '0'),
            _pa, case when _type in ('A') then _pa else 0 end, _pvht, _pvttc, 1.8, _vat,
            2, 20, (_type = 'A' and i % 4 = 0), true)
        on conflict (company_id, reference) do nothing
        returning id into _art;

        -- Stock initial (entrée valorisée) pour les types qui portent du stock.
        if _art is not null then
          if _type = 'A' then
            insert into public.stock_moves (company_id, article_id, move_type, qty_delta, is_reservation, unit_cost, bin_location, origin, ref, note)
            values (co.id, _art, 'entree', (i % 20) + 1, false, _pa, 'C' || lpad(((i % 40) + 1)::text, 2, '0'), 'import', 'SEED', 'Stock initial démo');
          elsif _type in ('V','O','P','D') then
            insert into public.stock_moves (company_id, article_id, move_type, qty_delta, is_reservation, unit_cost, origin, ref, note)
            values (co.id, _art, 'entree', 1, false, _pa, 'import', 'SEED', 'Véhicule en stock démo');
          end if;
        end if;
      end loop;
    end if;

    ----------------------------------------------------------------------
    -- CONTACTS (20) — particuliers / pros / fournisseurs
    ----------------------------------------------------------------------
    if (select count(*) from public.contacts where company_id = co.id and notes = 'SEED') = 0 then
      _firstContact := null;
      for i in 1..20 loop
        insert into public.contacts (company_id, type, civility, first_name, last_name, company_name,
            email, phone, address, zip, city, country, vat_number, credit_limit, segment, is_account, notes)
        values (co.id,
            (case when i <= 14 then 'particulier' when i <= 18 then 'professionnel' else 'fournisseur' end)::public.contact_type,
            case when i % 2 = 0 then 'M' else 'Mme' end,
            _firstnames[(i % 16) + 1],
            _lastnames[(i % 16) + 1],
            case when i > 14 then (case when i <= 18 then 'Garage ' else 'Fourn. ' end) || _lastnames[(i % 16) + 1] || ' SRL' else null end,
            'client' || i || '.' || co.code || '@demo.be',
            '+32 4' || lpad((70000000 + i)::text, 8, '0'),
            (100 + i) || ' rue de la Moto', lpad((1000 + i * 10)::text, 4, '0'), 'Bruxelles', 'BE',
            case when i > 14 then 'BE0' || lpad((600000000 + i)::text, 9, '0') else null end,
            case when i > 14 then 10000 else 0 end,
            (case when i % 7 = 0 then 'vip' else 'standard' end)::public.customer_segment,
            (i > 14), 'SEED')
        returning id into _contact;
        if _firstContact is null then _firstContact := _contact; end if;
      end loop;
    else
      select id into _firstContact from public.contacts where company_id = co.id and notes = 'SEED' order by created_at limit 1;
    end if;

    ----------------------------------------------------------------------
    -- VÉHICULES (12)
    ----------------------------------------------------------------------
    if (select count(*) from public.vehicles where company_id = co.id and vin like 'SEEDVIN%') = 0 then
      _firstVeh := null;
      for i in 1..12 loop
        insert into public.vehicles (company_id, vin, brand, model, plate, color, displacement, power_kw,
            first_registration_date, mileage, next_inspection_date)
        values (co.id,
            'SEEDVIN' || upper(co.code) || lpad(i::text, 6, '0'),
            'Ducati', _models[(i % 12) + 1],
            '1-' || chr(65 + (i % 26)) || chr(65 + ((i + 3) % 26)) || chr(65 + ((i + 7) % 26)) || '-' || lpad((100 + i)::text, 3, '0'),
            (array['Rouge','Noir','Blanc','Gris'])[(i % 4) + 1],
            (array[821,937,950,1103,1158])[(i % 5) + 1], 80 + i,
            (current_date - ((i * 90) || ' days')::interval)::date, i * 2500,
            (current_date + ((365 - i * 10) || ' days')::interval)::date)
        returning id into _veh;
        if _firstVeh is null then _firstVeh := _veh; end if;
      end loop;
    else
      select id into _firstVeh from public.vehicles where company_id = co.id and vin like 'SEEDVIN%' order by created_at limit 1;
    end if;

    ----------------------------------------------------------------------
    -- ORDRES DE RÉPARATION (5)
    ----------------------------------------------------------------------
    if (select count(*) from public.repair_orders where company_id = co.id and number like 'OR-SEED%') = 0 then
      for i in 1..5 loop
        insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, operator,
            repair_type, work_description, reception_notes, status, total_ht, total_vat, total_ttc)
        values (co.id, 'OR-SEED-' || lpad(i::text, 3, '0'), _firstContact, _firstVeh, 10000 + i * 1500,
            'Mécano démo', 'ENTRETIEN', 'Révision ' || (i * 10000) || ' km', 'RAS à la réception',
            _statuses[i], 200, 42, 242)
        returning id into _or;
        insert into public.repair_order_lines (or_id, kind, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order) values
          (_or, 'mo', 'Main d''œuvre atelier', 2, 50, 21, 100, 121, 0),
          (_or, 'piece', 'Filtre + huile', 1, 100, 21, 100, 121, 1);
      end loop;
    end if;

    -- Comptes auxiliaires comptables pour les contacts seedés (M12).
    perform public.generate_auxiliary_accounts(co.id);

  end loop;
end $$;
