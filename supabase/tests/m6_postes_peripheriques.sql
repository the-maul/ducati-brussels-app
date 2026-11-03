-- =====================================================================
-- PDV030 (03/11/2026) — essai a blanc de la migration 20261103250000_m6_postes_peripheriques.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261103250000_m6_postes_peripheriques.sql \
--      supabase/tests/m6_postes_peripheriques.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Joue le role d un administrateur (claims JWT simulees) dans ITALBIKE STORE :
--   poste « Caisse essai » + imprimante Epson ePOS + tiroir via l imprimante + reglage societe ;
--   refus : connexion etrangere au role, deux appareils pour un role, appareil d une autre societe,
--   code de caisse invalide, action de trace inconnue ; trace device_event et audit dans events.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _other uuid;
  _ws uuid; _ws2 uuid; _dev uuid; _n int; _ok boolean; _msg text; _cfg jsonb;
begin
  insert into _t(check_name, result) values
    ('admin de la societe', case when public.is_admin(_co) then 'ok' else 'FAIL (le compte simule n est pas admin)' end);

  -- ------------------------------------------------ poste + appareils
  insert into public.workstations (company_id, name, kind, register_code)
  values (_co, 'Caisse essai', 'caisse', 'CAISSE-9') returning id into _ws;
  insert into _t(check_name, result) values ('poste cree', case when _ws is not null then 'ok' else 'FAIL' end);

  insert into public.workstation_devices (company_id, workstation_id, role, connection, label, config)
  values (_co, _ws, 'receipt_printer', 'epson_epos', 'Epson TM-m30III',
          '{"host":"192.168.1.50","https":true,"deviceId":"local_printer","paperWidth":80,"drawerViaPrinter":true}')
  returning id into _dev;
  insert into public.workstation_devices (company_id, workstation_id, role, connection)
  values (_co, _ws, 'cash_drawer', 'via_receipt_printer');
  insert into public.workstation_devices (company_id, workstation_id, role, connection)
  values (_co, _ws, 'scanner', 'hid_keyboard');
  select count(*) into _n from public.workstation_devices where workstation_id = _ws;
  insert into _t(check_name, result) values ('3 appareils sur le poste', case when _n = 3 then 'ok' else 'FAIL ' || _n end);

  select config into _cfg from public.workstation_devices where id = _dev;
  insert into _t(check_name, result) values ('config jsonb relue (IP, HTTPS, 80 mm)',
    case when _cfg->>'host' = '192.168.1.50' and (_cfg->>'https')::boolean and (_cfg->>'paperWidth')::int = 80 then 'ok' else 'FAIL ' || _cfg::text end);

  -- upsert = remplacement de l appareil du role (meme cle poste + role)
  insert into public.workstation_devices (company_id, workstation_id, role, connection, config)
  values (_co, _ws, 'receipt_printer', 'browser', '{"paperWidth":58}')
  on conflict (workstation_id, role) do update set connection = excluded.connection, config = excluded.config;
  select count(*) into _n from public.workstation_devices where workstation_id = _ws and role = 'receipt_printer' and connection = 'browser';
  insert into _t(check_name, result) values ('upsert : un seul appareil par role, remplace', case when _n = 1 then 'ok' else 'FAIL ' || _n end);

  -- ------------------------------------------------ refus
  _ok := false;
  begin
    insert into public.workstation_devices (company_id, workstation_id, role, connection) values (_co, _ws, 'label_printer', 'epson_epos');
  exception when check_violation then _ok := true; end;
  insert into _t(check_name, result) values ('refus : Epson ePOS pour une imprimante d etiquettes', case when _ok then 'ok' else 'FAIL' end);

  _ok := false;
  begin
    insert into public.workstation_devices (company_id, workstation_id, role, connection) values (_co, _ws, 'scanner', 'camera');
  exception when unique_violation then _ok := true; end;
  insert into _t(check_name, result) values ('refus : deux douchettes sur le meme poste', case when _ok then 'ok' else 'FAIL' end);

  _ok := false;
  begin
    insert into public.workstations (company_id, name, register_code) values (_co, 'Caisse code faux', 'caisse 1');
  exception when check_violation then _ok := true; end;
  insert into _t(check_name, result) values ('refus : code de caisse invalide (minuscules, espace)', case when _ok then 'ok' else 'FAIL' end);

  _ok := false;
  begin
    insert into public.workstations (company_id, name) values (_co, 'Caisse essai');
  exception when unique_violation then _ok := true; end;
  insert into _t(check_name, result) values ('refus : deux postes du meme nom', case when _ok then 'ok' else 'FAIL' end);

  select id into _other from public.companies where id <> _co limit 1;
  if _other is null then
    insert into _t(check_name, result) values ('refus : appareil d une autre societe (sans objet : une seule societe)', 'ok');
  else
    _ok := false;
    begin
      insert into public.workstation_devices (company_id, workstation_id, role, connection) values (_other, _ws, 'scale', 'web_serial');
    exception when others then _ok := true; end;
    insert into _t(check_name, result) values ('refus : appareil d une autre societe sur ce poste', case when _ok then 'ok' else 'FAIL' end);
  end if;

  -- ------------------------------------------------ reglage societe
  insert into public.company_device_settings (company_id, receipt_width_mm, auto_print_receipt, open_drawer_on_cash, receipt_footer)
  values (_co, 80, true, true, 'Echange sous 15 jours avec le ticket.')
  on conflict (company_id) do update set receipt_width_mm = excluded.receipt_width_mm, auto_print_receipt = excluded.auto_print_receipt;
  select count(*) into _n from public.company_device_settings where company_id = _co and auto_print_receipt;
  insert into _t(check_name, result) values ('reglage societe enregistre', case when _n = 1 then 'ok' else 'FAIL' end);

  _ok := false;
  begin
    update public.company_device_settings set receipt_width_mm = 76 where company_id = _co;
  exception when check_violation then _ok := true; end;
  insert into _t(check_name, result) values ('refus : largeur 76 mm', case when _ok then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ trace et audit
  perform public.device_event(_co, 'drawer_opened', _ws, '{"reason":"cash_payment"}'::jsonb);
  select count(*) into _n from public.events
   where company_id = _co and action = 'drawer_opened' and entity_type = 'workstation' and entity_id = _ws::text
     and new_data->>'workstation_name' = 'Caisse essai' and new_data->>'reason' = 'cash_payment';
  insert into _t(check_name, result) values ('trace : tiroir ouvert (poste, motif, auteur)', case when _n = 1 then 'ok' else 'FAIL ' || _n end);

  _ok := false;
  begin
    perform public.device_event(_co, 'drop_table', _ws, '{}'::jsonb);
  exception when others then _ok := true; _msg := sqlerrm; end;
  insert into _t(check_name, result) values ('refus : action de trace inconnue', case when _ok then 'ok' else 'FAIL' end);

  insert into public.workstations (company_id, name) values (_co, 'Autre poste') returning id into _ws2;
  select count(*) into _n from public.events where entity_type = 'workstations' and entity_id = _ws2::text and action = 'insert';
  insert into _t(check_name, result) values ('audit : creation du poste dans events', case when _n = 1 then 'ok' else 'FAIL ' || _n end);

  -- ------------------------------------------------ suppression d un poste = ses appareils
  delete from public.workstations where id = _ws;
  select count(*) into _n from public.workstation_devices where workstation_id = _ws;
  insert into _t(check_name, result) values ('suppression du poste : appareils supprimes', case when _n = 0 then 'ok' else 'FAIL ' || _n end);
end $s$;

select n, check_name, result from _t order by n;
