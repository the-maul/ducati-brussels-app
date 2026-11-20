-- =====================================================================
-- Parcours G8 n° 20 (docs/g8-inventaire/parcours.md) : RDV atelier -> OR, joue dans ItalTest.
-- G8 : Planning > Nouveau RDV en attente (« sans affectation ») > client > moto > travaux > km
--      obligatoire > (pas d'OR) > glisser le RDV sur Jeremy mercredi 10:00 > Reception atelier > temps
--      prevu 2 h (obligatoire) > « Valider RDV et saisie OR » -> OR 5000017 (moto, km, mecanicien repris) ;
--      charge du jour 2 h / 24 h = 8,33 %.
-- Decisions : Q42 (km obligatoire au RDV des qu'une moto est choisie), Q43 (OR « a faire », RDV
-- « receptionne »), Q48 (taux 109,74 HT, tarif VIP 90,00 HT), Q49 (kit du RDV d'entretien recopie sur l'OR).
-- DMS (src/modules/workshop/planning/api.ts, kits/kit-from-appointment.ts, write-api.ts) :
--   createPlanningAppointment (unassigned, sans compagnon ni temps prevu, motif « entretien_annuel ») ;
--   listWaitingAppointments ; assignAppointment (glisser : compagnon + creneau) ; setPlannedMinutes(120) ;
--   charge du jour = dayLoad (planning/rules.ts : capacite des compagnons visibles - blocages, temps
--   prevu des RDV places) ; createOrFromPlanningAppointment : workshop_service_kit_lines(moto, 'annual')
--   -> lignes du kit (kitInsertLines, mode detail, titre en ligne texte) -> createRepairOrder (« a_faire »,
--   operateur = compagnon, operator_id = membre lie, km et motif du RDV) -> update du RDV (or_id, « arrive »).
-- Donnees d'essai : client au tarif VIP, moto d'un modele-annee qui a un kit d'entretien annuel.
-- Le RDV est place un mercredi dans 3 semaines au moins, 10:00, sur le compagnon Domenico Desouter.
-- Controles : Q42 RDV avec moto sans km refuse ; RDV en attente (sans compagnon) dans la liste d'attente ;
-- glisse : compagnon + nom recopie ; OR refuse sans temps prevu ; charge du jour (formule G8) ; Q49 lignes
-- du kit lues (pieces + lignes de service) et reservation au RDV ; OR « a faire » (n° suivant, client,
-- moto, km du RDV, compagnon, membre lie, motif, lignes du kit dont petites fournitures 10,56 HT) ;
-- Q43 RDV « receptionne » ; reservations qui suivent l'OR ; Q48 tarif VIP (MO nette 90) et taux 109,74 ;
-- statut du RDV qui suit l'OR (« en cours » au demarrage).
-- Lancement : TESTS_DIR=... python rt.py parcours_g8_20_rdv_atelier_or.sql (transaction annulee).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. donnees d'essai (proprietaire)
do $s$
declare _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08'; _c uuid; _v uuid; _my text;
begin
  -- Modele-annee qui a un kit d'entretien annuel avec des pieces (lu, jamais d'id en dur).
  select my.model_year_id into _my
    from public.maintenance_kits k join public.maintenance_kit_model_years my on my.kit_id = k.id
   where k.company_id = _co and k.service_kind = 'annual'
     and exists (select 1 from public.maintenance_kit_items i where i.kit_id = k.id and i.kind = 'piece')
   order by my.model_year_id limit 1;
  insert into public.contacts (company_id, type, first_name, last_name, country, mobile, price_list_id)
  values (_co, 'particulier', 'TEST', 'PARCOURS 20 RDV', 'BE', '+32470000020', (select id from public.price_lists where company_id = _co and code = 'VIP'))
  returning id into _c;
  insert into public.vehicles (company_id, vin, plate, brand, model, status, holder_contact_id, ducati_model_year_id, notes)
  values (_co, 'ZDMESSAIP20' || to_char(clock_timestamp(), 'HH24MISS'), '1-ESS-020', 'DUCATI', 'ESSAI P20 SCRAMBLER', 'vendu', _c, _my, 'ESSAI A BLANC')
  returning id into _v;
  perform set_config('test.c', _c::text, true);
  perform set_config('test.v', _v::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _c uuid := current_setting('test.c')::uuid;
  _v uuid := current_setting('test.v')::uuid;
  _m record; _day date; _at timestamptz; _rdv uuid; _a record; _err text; _cap numeric; _planned numeric; _slot int; _pct numeric;
  _kit int; _lines jsonb; _seq record; _exp bigint; _num text; _or uuid; _o record; _nres int; _mo uuid;
begin
  select * into _m from public.workshop_mechanics where company_id = _co and name = 'Domenico Desouter' and is_active limit 1;
  _day := current_date + 21 + ((3 - extract(isodow from current_date + 21)::int + 7) % 7);   -- un mercredi, dans 3 semaines ou plus
  _at := (_day + time '10:00') at time zone 'Europe/Brussels';

  -- ------------------------------------------------------------ 1. RDV en attente (Q42 km obligatoire)
  begin
    insert into public.workshop_appointments (company_id, status, unassigned, mechanic_id, mechanic_name, starts_at, planned_minutes, contact_id, vehicle_id,
                                              mileage, work_description, notify_sms, reason_code)
    values (_co, 'prevu', true, null, null, _at, null, _c, _v, null, 'Entretien annuel', false, 'entretien_annuel');
    insert into _t(check_name, result) values ('Q42 RDV avec moto sans kilometrage : refuse', 'KO accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('Q42 RDV avec moto sans kilometrage : refuse', case when _err like 'Kilometrage obligatoire%' then 'ok' else 'KO ' || _err end);
  end;
  insert into public.workshop_appointments (company_id, status, unassigned, mechanic_id, mechanic_name, appointment_type, starts_at, planned_minutes,
                                            contact_id, vehicle_id, mileage, work_description, reception_notes, notify_sms, reason_code)
  values (_co, 'prevu', true, null, null, 'entretien', _at, null, _c, _v, 31000, 'Entretien annuel', null, false, 'entretien_annuel')
  returning id into _rdv;
  select * into _a from public.workshop_appointments where id = _rdv;
  insert into _t(check_name, result) values ('RDV en attente : sans compagnon ni temps prevu, km 31 000, dans la liste d''attente',
    case when _a.unassigned and _a.mechanic_id is null and _a.planned_minutes is null and _a.mileage = 31000 and _a.or_id is null
          and exists (select 1 from public.workshop_appointments where company_id = _co and (unassigned or status = 'demande') and id = _rdv) then 'ok' else 'KO' end);
  select count(*) into _nres from public.stock_reservations where appointment_id = _rdv and status = 'active';
  insert into _t(check_name, result) values ('RDV d''entretien : pieces du kit reservees des le RDV (' || _nres || ' ligne(s))',
    case when _nres > 0 then 'ok' else 'KO' end);

  -- ------------------------------------------------------------ 2. glisser sur le compagnon, temps prevu
  update public.workshop_appointments set mechanic_id = _m.id, starts_at = _at, unassigned = false where id = _rdv;
  insert into _t(check_name, result) values ('glisse sur ' || _m.name || ' le ' || to_char(_day, 'DD/MM') || ' 10:00 : compagnon et nom recopie',
    case when (select mechanic_id = _m.id and mechanic_name = _m.name and not unassigned from public.workshop_appointments where id = _rdv) then 'ok' else 'KO' end);
  -- « Valider RDV et saisie OR » sans temps prevu : refuse (G8 « Veuillez saisir le temps prevu »).
  begin
    insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status) values (_co, 'ESSAI-P20-SANS-TEMPS', _c, _v, 31000, 'a_faire') returning id into _or;
    update public.workshop_appointments set or_id = _or where id = _rdv;
    insert into _t(check_name, result) values ('OR refuse sans temps prevu sur le RDV', 'KO accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('OR refuse sans temps prevu sur le RDV', case when _err like 'Temps prevu obligatoire%' then 'ok' else 'KO ' || _err end);
  end;
  update public.workshop_appointments set planned_minutes = 120 where id = _rdv;

  -- Charge du jour (dayLoad) : capacite des compagnons visibles et actifs - blocages, RDV places du jour.
  select slot_minutes into _slot from public.workshop_planning_settings where company_id = _co;
  select coalesce(sum(extract(epoch from (coalesce(h.am_end - h.am_start, interval '0') + coalesce(h.pm_end - h.pm_start, interval '0'))) / 60), 0) into _cap
    from public.workshop_mechanics m join public.workshop_mechanic_hours h on h.mechanic_id = m.id and h.weekday = 3
   where m.company_id = _co and m.is_active and m.visible_in_planning;
  select coalesce(sum(case when coalesce(planned_minutes, 0) > 0 then planned_minutes else _slot end), 0) into _planned
    from public.workshop_appointments
   where company_id = _co and status not in ('annule', 'demande') and not coalesce(unassigned, false)
     and (starts_at at time zone 'Europe/Brussels')::date = _day;
  _pct := round(_planned / nullif(_cap, 0) * 100, 2);
  insert into _t(check_name, result) values ('charge du ' || to_char(_day, 'DD/MM') || ' : ' || _planned || ' min / ' || round(_cap) || ' min = ' || coalesce(_pct::text, '?') || ' % (G8 : 2 h / 24 h = 8,33 %, 3 compagnons)',
    case when _planned >= 120 and _cap > 0 and not exists (select 1 from public.workshop_calendar_blocks b where b.company_id = _co
                   and b.starts_at < (_day + 1)::timestamptz and b.ends_at > _day::timestamptz) then 'ok' else 'KO' end);

  -- ------------------------------------------------------------ 3. « Valider RDV et saisie OR » (kit Q49)
  select count(*) into _kit from public.workshop_service_kit_lines(_v, 'annual');
  select jsonb_build_array(jsonb_build_object('kind', 'texte', 'article_id', null, 'designation', 'Kit d''entretien Entretien annuel (depuis le RDV)',
                                              'quantity', 0, 'unit_price_ht', 0, 'vat_rate', 21, 'discount_pct', 0, 'is_warranty', false, 'line_ht', 0, 'line_ttc', 0))
         || coalesce(jsonb_agg(jsonb_build_object(
              'kind', case when a.id is null then 'texte' when a.mgmt_type = 'T' then 'mo' else 'piece' end,
              'article_id', a.id, 'designation', coalesce(a.designation, k.designation),
              'quantity', case when a.id is null then 0 else k.quantity end,
              'unit_price_ht', case when a.id is null then 0 else coalesce(a.sale_price_ht, 0) end,
              'vat_rate', coalesce(a.vat_rate, 21), 'discount_pct', 0, 'is_warranty', false,
              'line_ht', case when a.id is null then 0 else round(k.quantity * coalesce(a.sale_price_ht, 0), 2) end,
              'line_ttc', case when a.id is null then 0 else round(k.quantity * coalesce(a.sale_price_ht, 0) * (1 + coalesce(a.vat_rate, 21) / 100), 2) end)
            order by k.sort_order), '[]'::jsonb)
    into _lines
    from public.workshop_service_kit_lines(_v, 'annual') k left join public.articles a on a.id = k.article_id;
  insert into _t(check_name, result) values ('Q49 kit d''entretien annuel de la moto : ' || _kit || ' lignes (pieces, liquides, DDS, controles, petites fournitures, CONTRI)',
    case when _kit >= 10 and exists (select 1 from public.workshop_service_kit_lines(_v, 'annual') k join public.articles a on a.id = k.article_id
                                      where a.reference = 'PETITES FOURNITURES') then 'ok' else 'KO ' || _kit end);

  select * into _seq from public.document_sequences where company_id = _co and doc_type = 'OR';
  _exp := case when _seq.reset_yearly and _seq.current_year is distinct from public._numbering_year() then 1 else _seq.next_value end;
  _num := public.next_document_number(_co, 'OR');
  select * into _a from public.workshop_appointments where id = _rdv;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, operator, repair_type, work_description, reception_notes,
                                    status, warranty_status, total_ht, total_vat, total_ttc, reason_code, operator_id)
  select _co, _num, _a.contact_id, _a.vehicle_id, _a.mileage, _m.name, null, _a.work_description, _a.reception_notes, 'a_faire', 'aucune',
         round(sum((l ->> 'line_ht')::numeric), 2), round(sum((l ->> 'line_ttc')::numeric) - sum((l ->> 'line_ht')::numeric), 2), round(sum((l ->> 'line_ttc')::numeric), 2),
         _a.reason_code, _m.user_id
    from jsonb_array_elements(_lines) l
  returning id into _or;
  perform public.repair_order_write_lines(_or, _lines);
  update public.workshop_appointments set or_id = _or, status = 'arrive' where id = _rdv;

  select * into _o from public.repair_orders where id = _or;
  insert into _t(check_name, result) values ('OR ' || _num || ' (suivant de la serie OR) : client, moto, km du RDV, travaux, motif',
    case when right(_num, _seq.padding) = lpad(_exp::text, _seq.padding, '0') and _o.contact_id = _c and _o.vehicle_id = _v and _o.mileage = 31000
          and _o.work_description = 'Entretien annuel' and _o.reason_code = 'entretien_annuel' then 'ok' else 'KO ' || row_to_json(_o)::text end);
  insert into _t(check_name, result) values ('Q43 OR « a faire », RDV « receptionne » (arrive) et relie a l''OR',
    case when _o.status = 'a_faire' and (select status = 'arrive' and or_id = _or from public.workshop_appointments where id = _rdv) then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('compagnon repris : operateur ' || coalesce(_o.operator, 'null') || ', membre lie',
    case when _o.operator = _m.name and _o.operator_id is not distinct from _m.user_id then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('Q49 lignes du kit sur l''OR (titre + ' || _kit || '), petites fournitures 10,56 HT (12,78 TTC, Q41)',
    case when (select count(*) from public.repair_order_lines where or_id = _or) = _kit + 1
          and exists (select 1 from public.repair_order_lines l join public.articles a on a.id = l.article_id
                       where l.or_id = _or and a.reference = 'PETITES FOURNITURES' and l.unit_price_ht = 10.56) then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('reservations du RDV : elles suivent l''OR, aucune reservation en double',
    case when not exists (select 1 from public.stock_reservations where appointment_id = _rdv and status = 'active' and repair_order_id is distinct from _or)
          and (select count(*) from public.stock_reservations where status = 'active' and (appointment_id = _rdv or repair_order_id = _or)) = _nres then 'ok' else 'KO' end);

  -- ------------------------------------------------------------ 4. taux (Q48) et suite du cycle
  select id into _mo from public.articles where company_id = _co and reference = 'MO' and mgmt_type = 'T' limit 1;
  insert into _t(check_name, result) values ('Q48 taux atelier 109,74 HT ; client VIP : regle « prix net 90,00 » sur l''article MO (moteur de tarifs)',
    case when public.maintenance_hourly_rate_ht(_co) = 109.74
          and exists (select 1 from public.contacts c join public.price_list_rules r on r.price_list_id = c.price_list_id
                       where c.id = _c and r.scope = 'reference' and r.article_id = _mo and r.kind = 'net' and (r.tiers -> 0 ->> 'value')::numeric = 90)
         then 'ok' else 'KO' end);
  perform public.repair_order_start(_or);
  insert into _t(check_name, result) values ('« Demarrer » l''OR : OR « en cours », RDV « travaux commences »',
    case when (select status from public.repair_orders where id = _or) = 'en_cours'
          and (select status from public.workshop_appointments where id = _rdv) = 'en_cours' then 'ok' else 'KO' end);
  insert into _t(check_name, result) values ('audit : RDV trace dans events (creation, glisser, OR)',
    case when (select count(*) from public.events where entity_type = 'workshop_appointments' and entity_id = _rdv::text) >= 3 then 'ok' else 'KO' end);
end $s$;

reset role;
select n, check_name, result from _t order by n;
