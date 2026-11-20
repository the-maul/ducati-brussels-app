-- =====================================================================
-- VP8 (décision du client, 20/11/2026, comme G8) — Champs obligatoires : OR = opérateur, client,
-- n° de série (moto) ; cession = type, opérateur, n° de série. Migration 20261120344000.
-- Société de test ItalTest, administrateur simon@themaul.be, transaction annulée (rt.py).
-- Contrôles :
--   1. OR créé à l'écran sans client ni moto : refusé, message FR, hint repair_order_required,
--      detail contact,vehicle ;
--   2. OR avec moto (propriétaire connu) sans client ni opérateur (cas RDV → OR sans compagnon) :
--      accepté, client = propriétaire actuel, opérateur = l'utilisateur connecté (nom, pas e-mail) ;
--   3. OR avec moto sans propriétaire et sans client : refusé (contact) ;
--   4. OR comme le planning (client, moto, km, opérateur = nom du compagnon) : accepté tel quel ;
--   5. modification : retirer le client ou la moto d'un OR est refusé ;
--   6. ancien OR sans client (repris) : se modifie toujours (pas de blocage rétroactif) ;
--   7. écriture serveur (sans utilisateur) : pas bloquée ;
--   8. cession 01 Cession VO sans moto : refusée (hint cession_required, detail vehicle) ;
--   9. cession 03 Besoin atelier sans moto : acceptée, opérateur posé d'office ;
--  10. cession sans type : refusée ; réglage requires_vehicle posé pour 01 / 02 seulement.
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- Données d'essai et écriture serveur (propriétaire, sans utilisateur connecté).
do $s$
declare _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08'; _tag text := to_char(clock_timestamp(), 'HH24MISSUS');
  _v1 uuid; _v2 uuid; _own uuid; _old uuid; _srv uuid;
begin
  insert into public.contacts (company_id, type, status, civility, first_name, last_name, country)
  values (_co, 'particulier', 'client', 'M', 'JEAN', 'PROPRIO VP8', 'BE') returning id into _own;
  insert into public.vehicles (company_id, vin, brand, model, status) values (_co, 'ZDMVP8A' || _tag, 'DUCATI', 'MONSTER VP8', 'livre') returning id into _v1;
  insert into public.vehicle_owners (vehicle_id, contact_id, from_date, is_current) values (_v1, _own, current_date, true);
  insert into public.vehicles (company_id, vin, brand, model, status) values (_co, 'ZDMVP8B' || _tag, 'DUCATI', 'SCRAMBLER VP8', 'livre') returning id into _v2;
  insert into public.repair_orders (company_id, number, vehicle_id, mileage, status) values (_co, 'ESSAI-VP8-ANCIEN', _v1, 1000, 'a_faire') returning id into _old;
  begin
    insert into public.repair_orders (company_id, number, status) values (_co, 'ESSAI-VP8-SRV', 'a_faire') returning id into _srv;
    insert into _t(check_name, result) values ('ecriture serveur (sans utilisateur, import) : OR sans client ni moto pas bloque', 'ok');
  exception when others then insert into _t(check_name, result) values ('ecriture serveur (sans utilisateur, import) : OR sans client ni moto pas bloque', 'KO ' || sqlerrm); end;
  perform set_config('test.v1', _v1::text, true); perform set_config('test.v2', _v2::text, true);
  perform set_config('test.own', _own::text, true); perform set_config('test.old', _old::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _v1 uuid := current_setting('test.v1')::uuid; _v2 uuid := current_setting('test.v2')::uuid;
  _own uuid := current_setting('test.own')::uuid; _old uuid := current_setting('test.old')::uuid;
  _or uuid; _or2 uuid; _ces uuid; _msg text; _hint text; _det text; r record;
begin
  -- 1. ni client ni moto
  begin
    insert into public.repair_orders (company_id, number, status) values (_co, 'ESSAI-VP8-1', 'a_faire');
    insert into _t(check_name, result) values ('OR sans client ni moto : refuse', 'KO accepte');
  exception when others then
    get stacked diagnostics _msg = message_text, _hint = pg_exception_hint, _det = pg_exception_detail;
    insert into _t(check_name, result) values ('OR sans client ni moto : refuse, message FR, hint repair_order_required, detail contact,vehicle',
      case when _hint = 'repair_order_required' and _det = 'contact,vehicle' and _msg = 'OR : compléter Client, N° de série (moto).' then 'ok'
           else 'KO ' || _msg || ' / ' || coalesce(_hint, '') || ' / ' || coalesce(_det, '') end);
  end;

  -- 2. moto avec propriétaire, sans client ni opérateur
  insert into public.repair_orders (company_id, number, vehicle_id, mileage, status) values (_co, 'ESSAI-VP8-2', _v1, 12000, 'a_faire') returning id into _or;
  select * into r from public.repair_orders where id = _or;
  insert into _t(check_name, result) values
    ('OR avec moto sans client ni operateur : client = proprietaire actuel, operateur = utilisateur connecte (' || coalesce(r.operator, 'null') || ')',
     case when r.contact_id = _own and r.operator_id = auth.uid() and coalesce(r.operator, '') <> '' and r.operator not like '%@%' then 'ok' else 'KO' end);

  -- 3. moto sans propriétaire, sans client
  begin
    insert into public.repair_orders (company_id, number, vehicle_id, mileage, status) values (_co, 'ESSAI-VP8-3', _v2, 500, 'a_faire');
    insert into _t(check_name, result) values ('OR avec moto sans proprietaire et sans client : refuse', 'KO accepte');
  exception when others then
    get stacked diagnostics _det = pg_exception_detail;
    insert into _t(check_name, result) values ('OR avec moto sans proprietaire et sans client : refuse (client)', case when _det = 'contact' then 'ok' else 'KO ' || coalesce(_det, sqlerrm) end);
  end;

  -- 4. comme le planning (RDV → OR) : compagnon en texte
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, operator, status)
  values (_co, 'ESSAI-VP8-4', _own, _v2, 800, 'John', 'a_faire') returning id into _or2;
  insert into _t(check_name, result) values ('OR comme le planning (client, moto, km, compagnon en texte) : accepte tel quel',
    case when (select operator from public.repair_orders where id = _or2) = 'John'
              and (select operator_id from public.repair_orders where id = _or2) is null then 'ok' else 'KO' end);

  -- 5. retirer le client / la moto
  begin
    update public.repair_orders set contact_id = null where id = _or;
    insert into _t(check_name, result) values ('modification : retirer le client est refuse', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('modification : retirer le client est refuse', case when sqlerrm like 'OR : compléter Client%' then 'ok' else 'KO ' || sqlerrm end); end;
  begin
    update public.repair_orders set vehicle_id = null, mileage = null where id = _or2;
    insert into _t(check_name, result) values ('modification : retirer la moto est refuse', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('modification : retirer la moto est refuse', case when sqlerrm like 'OR : compléter N° de série%' then 'ok' else 'KO ' || sqlerrm end); end;

  -- 6. ancien OR sans client : l'écran réenregistre l'en-tête (contact_id null, même moto)
  begin
    update public.repair_orders set contact_id = null, vehicle_id = _v1, work_description = 'Essai VP8' where id = _old;
    insert into _t(check_name, result) values ('ancien OR sans client : se modifie toujours (pas de blocage retroactif)', 'ok');
  exception when others then insert into _t(check_name, result) values ('ancien OR sans client : se modifie toujours (pas de blocage retroactif)', 'KO ' || sqlerrm); end;

  -- 8. cession VO sans moto
  begin
    perform public.open_internal_cession(_co, '01', null, null, null, 'Essai VP8', null);
    insert into _t(check_name, result) values ('cession 01 Cession VO sans moto : refusee', 'KO acceptee');
  exception when others then
    get stacked diagnostics _msg = message_text, _hint = pg_exception_hint, _det = pg_exception_detail;
    insert into _t(check_name, result) values ('cession 01 Cession VO sans moto : refusee (hint cession_required, detail vehicle)',
      case when _hint = 'cession_required' and _det = 'vehicle' then 'ok' else 'KO ' || _msg end);
  end;

  -- 9. cession besoin atelier sans moto
  _ces := public.open_internal_cession(_co, '03', null, null, null, 'Fournitures atelier VP8', null);
  insert into _t(check_name, result) values ('cession 03 Besoin atelier sans moto : acceptee, operateur pose d''office',
    case when (select operator_id from public.internal_cessions where id = _ces) = auth.uid()
              and coalesce((select operator_name from public.internal_cessions where id = _ces), '') <> '' then 'ok' else 'KO' end);

  -- 10. sans type ; réglage par type
  begin
    perform public.open_internal_cession(_co, '', _v1, null, null, 'Essai VP8', null);
    insert into _t(check_name, result) values ('cession sans type : refusee', 'KO acceptee');
  exception when others then
    get stacked diagnostics _det = pg_exception_detail;
    insert into _t(check_name, result) values ('cession sans type : refusee', case when _det like '%type%' then 'ok' else 'KO ' || sqlerrm end);
  end;
  insert into _t(check_name, result) values ('reglage requires_vehicle : oui pour 01 et 02, non pour les autres types',
    case when not exists (select 1 from public.reference_values rv where rv.company_id = _co and rv.table_key = 'cession_type'
                           and coalesce((rv.extra->>'requires_vehicle')::boolean, false) <> (rv.code in ('01', '02'))) then 'ok' else 'KO' end);
end $s$;

select n, check_name, result from _t order by n;
