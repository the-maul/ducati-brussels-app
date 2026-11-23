-- =====================================================================
-- Chantier C1 (23/11/2026) — essai a blanc de 20261123100000_m8_dossier_atelier.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base).
-- Parcours complet : RDV (temps prevu) → OR « a faire » (temps recopie) → piece manquante →
-- « Attente pieces » automatique → piece couverte → retour « a faire » → un « Attente pieces » manuel
-- n'est pas touche → pointage → pret → facture → remise de la moto, annulation de la remise.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _admin uuid; _c uuid; _v uuid; _a uuid; _a2 uuid; _or uuid; _or2 uuid; _art uuid; _res uuid; _st text; _rdv text;
  _n int; _j jsonb; _err text;
begin
  select ur.user_id into _admin from public.user_roles ur where ur.company_id = _co and ur.role = 'admin' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', _admin, 'role', 'authenticated')::text, true);

  insert into public.contacts (company_id, type, first_name, last_name, country)
  values (_co, 'particulier', 'TEST', 'DOSSIER C1', 'BE') returning id into _c;
  insert into public.vehicles (company_id, brand, model, status, notes, maintenance_usage)
  values (_co, 'DUCATI', 'ESSAI DOSSIER', 'vendu', 'ESSAI A BLANC', 'route') returning id into _v;
  select a.id into _art from public.articles a where a.company_id = _co and a.mgmt_type = 'A' limit 1;

  insert into public.workshop_appointments (company_id, contact_id, vehicle_id, mileage, starts_at, planned_minutes, status, unassigned)
  values (_co, _c, _v, 12000, now() + interval '1 hour', 90, 'prevu', true) returning id into _a;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, operator, status)
  values (_co, 'ESSAI-C1-1', _c, _v, 12000, 'ESSAI', 'a_faire') returning id into _or;

  -- 1. Temps prevu
  update public.workshop_appointments set or_id = _or, status = 'arrive' where id = _a;
  insert into _t(check_name, result) select 'temps prevu du RDV recopie sur l''OR', case when planned_minutes = 90 then 'ok' else 'KO ' || coalesce(planned_minutes::text, 'null') end from public.repair_orders where id = _or;
  update public.workshop_appointments set planned_minutes = 120 where id = _a;
  insert into _t(check_name, result) select 'temps prevu suit le RDV', case when planned_minutes = 120 then 'ok' else 'KO' end from public.repair_orders where id = _or;
  insert into _t(check_name, result) select 'l''OR nait a faire, RDV receptionne', case when r.status = 'a_faire' and a.status = 'arrive' then 'ok' else 'KO ' || r.status || '/' || a.status end from public.repair_orders r, public.workshop_appointments a where r.id = _or and a.id = _a;

  -- 2. Piece manquante → Attente pieces
  insert into public.stock_reservations (company_id, repair_order_id, article_id, qty_needed, qty_reserved, status)
  values (_co, _or, _art, 2, 0, 'active') returning id into _res;
  select status into _st from public.repair_orders where id = _or;
  insert into _t(check_name, result) values ('Q43 : avant la fin de l''entree, l''OR reste a faire', case when _st = 'a_faire' then 'ok' else 'KO ' || _st end);
  insert into public.repair_order_receptions (company_id, or_id, status) values (_co, _or, 'plus_tard');
  select status into _st from public.repair_orders where id = _or;
  select status into _rdv from public.workshop_appointments where id = _a;
  insert into _t(check_name, result) values ('piece manquante : OR en attente pieces', case when _st = 'attente_pieces' then 'ok' else 'KO ' || _st end);
  insert into _t(check_name, result) values ('le RDV suit (attente)', case when _rdv = 'attente' then 'ok' else 'KO ' || _rdv end);
  insert into _t(check_name, result) select 'trace dans events', case when count(*) = 1 then 'ok' else 'KO ' || count(*) end from public.events where entity_type = 'repair_orders' and entity_id = _or::text and action = 'workshop_or_parts_wait_auto';

  -- 3. Piece couverte → retour a faire
  update public.stock_reservations set qty_reserved = 2 where id = _res;
  select status into _st from public.repair_orders where id = _or;
  insert into _t(check_name, result) values ('piece couverte : retour a faire', case when _st = 'a_faire' then 'ok' else 'KO ' || _st end);

  -- 4. Attente pieces manuel : jamais change
  update public.repair_orders set status = 'attente_pieces' where id = _or;
  update public.stock_reservations set qty_reserved = 1 where id = _res;
  update public.stock_reservations set qty_reserved = 2 where id = _res;
  select status into _st from public.repair_orders where id = _or;
  insert into _t(check_name, result) values ('attente pieces manuel conserve', case when _st = 'attente_pieces' then 'ok' else 'KO ' || _st end);
  update public.repair_orders set status = 'a_faire' where id = _or;

  -- 5. OR deja pointe : statut inchange
  insert into public.workshop_time_entries (company_id, or_id, kind, mechanic_id, mechanic_name, started_at, ended_at, minutes)
  values (_co, _or, 'travail', _admin, 'ESSAI', now() - interval '30 minutes', now(), 30);
  update public.stock_reservations set qty_reserved = 0 where id = _res;
  select status into _st from public.repair_orders where id = _or;
  insert into _t(check_name, result) values ('OR deja pointe : pas de passage automatique', case when _st = 'en_cours' then 'ok' else 'KO ' || _st end);
  update public.stock_reservations set qty_reserved = 2 where id = _res;

  -- 6. Remise de la moto
  begin
    perform public.repair_order_handover_set(_or, null);
    _err := 'aucune erreur';
  exception when others then _err := sqlstate; end;
  insert into _t(check_name, result) values ('remise refusee avant facture', case when _err = '23514' then 'ok' else 'KO ' || _err end);

  update public.repair_orders set status = 'pret' where id = _or;
  update public.repair_orders set status = 'facture' where id = _or;
  _j := public.repair_order_handover_set(_or, 'Cles remises');
  insert into _t(check_name, result) values ('remise enregistree', case when _j->>'status' = 'done' then 'ok' else 'KO ' || _j::text end);
  _j := public.repair_order_handover_set(_or, null);
  insert into _t(check_name, result) values ('remise idempotente', case when _j->>'status' = 'already' then 'ok' else 'KO ' || _j::text end);
  insert into _t(check_name, result) select 'remise tracee', case when count(*) = 1 then 'ok' else 'KO' end from public.events where entity_id = _or::text and action = 'workshop_or_handed_over';
  _j := public.repair_order_handover_undo(_or);
  select count(*) into _n from public.repair_order_handovers where or_id = _or;
  insert into _t(check_name, result) values ('remise annulee', case when _j->>'status' = 'undone' and _n = 0 then 'ok' else 'KO' end);
  insert into _t(check_name, result) select 'annulation tracee', case when count(*) = 1 then 'ok' else 'KO' end from public.events where entity_id = _or::text and action = 'workshop_or_handover_undone';

  -- 6 bis. RDV dont la piece manque : l'OR relie au RDV passe en attente pieces, sans perdre la reservation
  insert into public.workshop_appointments (company_id, contact_id, vehicle_id, mileage, starts_at, planned_minutes, status, unassigned)
  values (_co, _c, _v, 12000, now() + interval '2 hours', 45, 'prevu', true) returning id into _a2;
  insert into public.stock_reservations (company_id, appointment_id, article_id, qty_needed, qty_reserved, status)
  values (_co, _a2, _art, 1, 0, 'active');
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, operator, status)
  values (_co, 'ESSAI-C1-2', _c, _v, 12000, 'ESSAI', 'a_faire') returning id into _or2;
  update public.workshop_appointments set or_id = _or2, status = 'arrive' where id = _a2;
  select status into _st from public.repair_orders where id = _or2;
  insert into _t(check_name, result) values ('RDV avec piece manquante : l''OR nait a faire (Q43)', case when _st = 'a_faire' then 'ok' else 'KO ' || _st end);
  select status into _rdv from public.workshop_appointments where id = _a2;
  insert into _t(check_name, result) values ('RDV receptionne (Q43)', case when _rdv = 'arrive' then 'ok' else 'KO ' || _rdv end);
  insert into public.repair_order_receptions (company_id, or_id, status) values (_co, _or2, 'complete');
  select status into _st from public.repair_orders where id = _or2;
  insert into _t(check_name, result) values ('entree terminee, piece manquante : attente pieces', case when _st = 'attente_pieces' then 'ok' else 'KO ' || _st end);
  insert into _t(check_name, result) select 'la reservation suit l''OR', case when count(*) = 1 then 'ok' else 'KO ' || count(*) end from public.stock_reservations where repair_order_id = _or2 and status = 'active';
  insert into _t(check_name, result) select 'temps prevu recopie', case when planned_minutes = 45 then 'ok' else 'KO' end from public.repair_orders where id = _or2;

  -- 7. Reprise de l'historique
  insert into _t(check_name, result)
  select 'OR factures deja sortis', case when count(*) = 0 then 'ok' else 'KO ' || count(*) end
    from public.repair_orders r
   where r.status = 'facture' and r.id <> _or
     and r.id <> _or2
     and not exists (select 1 from public.repair_order_handovers h where h.or_id = r.id);
end $s$;

-- 8. Pas d'ecriture directe
set local role authenticated;
do $s$
declare _err text;
begin
  begin
    insert into public.repair_order_handovers (or_id, company_id) values (gen_random_uuid(), '3d9f0f13-a691-4d07-ad58-34590df86e33');
    _err := 'insert accepte';
  exception when others then _err := sqlstate; end;
  insert into _t(check_name, result) values ('pas d''ecriture directe', case when _err = '42501' then 'ok' else 'KO ' || _err end);
end $s$;
reset role;
