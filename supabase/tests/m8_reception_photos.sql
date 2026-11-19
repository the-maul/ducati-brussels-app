-- =====================================================================
-- Parcours mecanicien, lot C (19/11/2026) — essai a blanc de 20261119270000_m8_reception_photos.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119270000_m8_reception_photos.sql \
--      supabase/tests/m8_reception_photos.sql; echo "rollback;") > t.sql
-- Joue un administrateur d'ITALBIKE STORE (claims JWT simulees). Scenario :
--   serie d'usine (6 photos obligatoires) ; photo rangee dans la serie = rattachee a l'OR ET a la
--   moto, avec commentaire ; photo de case reprise = remplacee (une seule par case) ; photos de
--   degats en nombre ; piece d'un autre OR / case inconnue refusees ; « Plus tard » et « Terminer »
--   ne bloquent jamais, les obligatoires manquantes restent signalees ; commentaire general ;
--   historique de la fiche moto ; retrait trace ; suppression dans la GED = retrait de la serie ;
--   reglage de la serie (photo ajoutee, libelle obligatoire, code invalide, retour usine) ;
--   pas d'ecriture directe dans les tables.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _c uuid; _v uuid; _or uuid; _or2 uuid; i int; _a uuid;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values (_co, 'particulier', 'TEST', 'RECEPTION PHOTOS', 'BE') returning id into _c;
  insert into public.vehicles (company_id, brand, model, status, notes)
  values (_co, 'DUCATI', 'ESSAI RECEPTION', 'vendu', 'ESSAI A BLANC') returning id into _v;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values (_co, 'ESSAI-REC-1', _c, _v, 1000, 'a_faire') returning id into _or;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values (_co, 'ESSAI-REC-2', _c, _v, 1000, 'a_faire') returning id into _or2;
  -- Pieces de GED deja deposees (le fichier lui-meme n'est pas utile a l'essai).
  for i in 1..6 loop
    insert into public.attachments (company_id, entity_type, entity_id, file_name, storage_path, content_type, size_bytes, folder)
    values (_co, 'repair_order', _or, 'photo' || i || '.jpg', _co || '/repair_order/' || _or || '/' || i || '_photo.jpg', 'image/jpeg', 1000, 'Réception')
    returning id into _a;
    perform set_config('test.a' || i, _a::text, true);
  end loop;
  insert into public.attachments (company_id, entity_type, entity_id, file_name, storage_path, content_type, size_bytes)
  values (_co, 'repair_order', _or2, 'autre.jpg', _co || '/repair_order/' || _or2 || '/autre.jpg', 'image/jpeg', 1000) returning id into _a;
  perform set_config('test.other', _a::text, true);
  perform set_config('test.v', _v::text, true);
  perform set_config('test.or', _or::text, true);
  -- Serie d'usine pour l'essai (la societe peut en avoir une a elle).
  update public.workshop_planning_settings set reception_photo_slots = null where company_id = _co;
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _v uuid := current_setting('test.v')::uuid;
  _or uuid := current_setting('test.or')::uuid;
  _a1 uuid := current_setting('test.a1')::uuid; _a2 uuid := current_setting('test.a2')::uuid;
  _a3 uuid := current_setting('test.a3')::uuid; _a4 uuid := current_setting('test.a4')::uuid;
  _a5 uuid := current_setting('test.a5')::uuid; _a6 uuid := current_setting('test.a6')::uuid;
  _other uuid := current_setting('test.other')::uuid;
  _res jsonb; _p1 uuid; _err text; _n int; _slots jsonb;
begin
  -- ------------------------------------------------------------ serie d'usine
  _slots := public.workshop_reception_slots(_co);
  insert into _t(check_name, result) values ('serie d''usine : avant, arriere, gauche, droite, compteur, plaque / VIN, toutes obligatoires',
    case when (select array_agg(x->>'code' order by o) from jsonb_array_elements(_slots) with ordinality t(x, o))
              = array['face_avant','face_arriere','cote_gauche','cote_droit','compteur','plaque_vin']
          and not exists (select 1 from jsonb_array_elements(_slots) x where not (x->>'required')::boolean)
    then 'ok' else 'FAIL ' || _slots::text end);
  insert into _t(check_name, result) values ('OR sans photo : les 6 obligatoires manquent',
    case when cardinality(public.repair_order_reception_missing(_or)) = 6 then 'ok' else 'FAIL' end);

  -- ------------------------------------------------------------ photo rangee dans la serie
  _res := public.repair_order_reception_photo_add(_or, _a1, 'face_avant', 'Rayure sur le garde-boue');
  _p1 := (_res->>'photo_id')::uuid;
  insert into _t(check_name, result) values ('photo de la serie : rattachee a l''OR et a la moto, commentaire, qui, quand',
    case when exists (select 1 from public.repair_order_reception_photos p
                       where p.id = _p1 and p.or_id = _or and p.vehicle_id = _v and p.slot_code = 'face_avant'
                         and p.attachment_id = _a1 and p.comment = 'Rayure sur le garde-boue'
                         and p.taken_by = 'd9409378-a554-4cb2-97d6-e0b84aba204e' and p.taken_at is not null)
          and jsonb_array_length(_res->'missing') = 5
    then 'ok' else 'FAIL ' || _res::text end);
  insert into _t(check_name, result) values ('photo ajoutee : tracee (events)',
    case when exists (select 1 from public.events where entity_type = 'repair_orders' and entity_id = _or::text and action = 'repair_order_reception_photo_added')
    then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('la reception de l''OR existe, en cours',
    case when exists (select 1 from public.repair_order_receptions where or_id = _or and status = 'en_cours' and vehicle_id = _v) then 'ok' else 'FAIL' end);

  -- ------------------------------------------------------------ case reprise = remplacee
  _res := public.repair_order_reception_photo_add(_or, _a2, 'face_avant', null);
  insert into _t(check_name, result) values ('photo de case reprise : remplacee (une seule par case), ancienne piece rendue pour la GED',
    case when (select count(*) from public.repair_order_reception_photos where or_id = _or and slot_code = 'face_avant') = 1
          and (_res->>'replaced_attachment_id')::uuid = _a1
          and exists (select 1 from public.events where entity_id = _or::text and action = 'repair_order_reception_photo_replaced')
    then 'ok' else 'FAIL ' || _res::text end);

  -- ------------------------------------------------------------ degats
  perform public.repair_order_reception_photo_add(_or, _a3, 'degat', 'Choc carenage droit');
  perform public.repair_order_reception_photo_add(_or, _a4, 'degat', 'Retroviseur fendu');
  insert into _t(check_name, result) values ('photos de degats en plus, en nombre, avec commentaire',
    case when (select count(*) from public.repair_order_reception_photos where or_id = _or and slot_code = 'degat' and comment is not null) = 2
    then 'ok' else 'FAIL' end);

  -- ------------------------------------------------------------ refus
  begin
    perform public.repair_order_reception_photo_add(_or, _other, 'compteur', null);
    _err := 'aucune erreur';
  exception when others then _err := sqlerrm; end;
  insert into _t(check_name, result) values ('piece de GED d''un autre OR refusee',
    case when _err like '%GED de cet OR%' then 'ok' else 'FAIL ' || _err end);
  begin
    perform public.repair_order_reception_photo_add(_or, _a5, 'reservoir', null);
    _err := 'aucune erreur';
  exception when others then _err := sqlerrm; end;
  insert into _t(check_name, result) values ('case absente de la serie refusee',
    case when _err like '%absente de la serie%' then 'ok' else 'FAIL ' || _err end);

  -- ------------------------------------------------------------ commentaire d'une photo
  _res := public.repair_order_reception_photo_comment((select id from public.repair_order_reception_photos where or_id = _or and slot_code = 'face_avant'), 'Eclat de peinture');
  insert into _t(check_name, result) values ('commentaire d''une photo modifie et trace',
    case when (select comment from public.repair_order_reception_photos where or_id = _or and slot_code = 'face_avant') = 'Eclat de peinture'
          and exists (select 1 from public.events where entity_id = _or::text and action = 'repair_order_reception_photo_commented')
    then 'ok' else 'FAIL' end);

  -- ------------------------------------------------------------ Plus tard / Terminer : jamais bloquant
  _res := public.repair_order_reception_save(_or, 'Moto sale, pneu arriere use', 'later');
  insert into _t(check_name, result) values ('« Plus tard » : enregistre, ne bloque pas, manquantes signalees',
    case when _res->>'status' = 'plus_tard' and jsonb_array_length(_res->'missing') = 5
          and exists (select 1 from public.repair_order_receptions where or_id = _or and status = 'plus_tard'
                       and postponed_at is not null and general_comment = 'Moto sale, pneu arriere use' and cardinality(missing_required) = 5)
          and exists (select 1 from public.events where entity_id = _or::text and action = 'repair_order_reception_postponed')
    then 'ok' else 'FAIL ' || _res::text end);
  _res := public.repair_order_reception_save(_or, null, 'complete');
  insert into _t(check_name, result) values ('« Terminer » la reception meme incomplete : commentaire general garde, manquantes signalees',
    case when _res->>'status' = 'complete'
          and exists (select 1 from public.repair_order_receptions where or_id = _or and status = 'complete'
                       and completed_by = 'd9409378-a554-4cb2-97d6-e0b84aba204e' and general_comment = 'Moto sale, pneu arriere use'
                       and 'compteur' = any(missing_required))
    then 'ok' else 'FAIL ' || _res::text end);
  begin
    perform public.repair_order_reception_save(_or, null, 'supprimer');
    _err := 'aucune erreur';
  exception when others then _err := sqlerrm; end;
  insert into _t(check_name, result) values ('action de reception inconnue refusee',
    case when _err like '%action inconnue%' then 'ok' else 'FAIL ' || _err end);

  -- ------------------------------------------------------------ fiche moto (historique)
  insert into _t(check_name, result) values ('fiche moto : les photos de reception de ses OR (historique)',
    case when (select count(*) from public.repair_order_reception_photos p join public.repair_orders o on o.id = p.or_id
                where p.vehicle_id = _v and o.number = 'ESSAI-REC-1') = 3
    then 'ok' else 'FAIL' end);

  -- ------------------------------------------------------------ retrait / GED
  _res := public.repair_order_reception_photo_remove((select id from public.repair_order_reception_photos where or_id = _or and comment = 'Retroviseur fendu'));
  insert into _t(check_name, result) values ('retrait d''une photo : trace, piece de GED rendue pour suppression',
    case when _res->>'status' = 'removed' and (_res->>'attachment_id')::uuid = _a4
          and not exists (select 1 from public.repair_order_reception_photos where attachment_id = _a4)
          and exists (select 1 from public.events where entity_id = _or::text and action = 'repair_order_reception_photo_removed')
    then 'ok' else 'FAIL ' || _res::text end);
  delete from public.attachments where id = _a3;
  insert into _t(check_name, result) values ('piece supprimee de la GED : la photo quitte la serie (aucun second stockage)',
    case when not exists (select 1 from public.repair_order_reception_photos where attachment_id = _a3) then 'ok' else 'FAIL' end);

  -- ------------------------------------------------------------ ecriture directe interdite
  begin
    insert into public.repair_order_reception_photos (company_id, or_id, slot_code, attachment_id, storage_path)
    values (_co, _or, 'compteur', _a5, 'x');
    _err := 'aucune erreur';
  exception when others then _err := sqlerrm; end;
  insert into _t(check_name, result) values ('ecriture directe dans les photos refusee (fonctions seulement)',
    case when _err <> 'aucune erreur' then 'ok' else 'FAIL' end);
  begin
    update public.repair_order_receptions set status = 'complete' where or_id = _or;
    get diagnostics _n = row_count;
    _err := 'lignes ' || _n;
  exception when others then _err := 'refus'; end;
  insert into _t(check_name, result) values ('mise a jour directe de la reception refusee',
    case when _err in ('refus', 'lignes 0') then 'ok' else 'FAIL ' || _err end);

  -- ------------------------------------------------------------ reglage de la serie
  _slots := public.workshop_reception_settings_set(_co, '[{"code":"face_avant","required":true},{"code":"reservoir","label":"Réservoir","required":false}]'::jsonb);
  insert into _t(check_name, result) values ('reglage : serie de l''atelier (photo ajoutee facultative), trace',
    case when jsonb_array_length(_slots) = 2 and _slots->1->>'label' = 'Réservoir' and (_slots->1->>'required')::boolean = false
          and exists (select 1 from public.events where entity_id = _co::text and action = 'workshop_reception_settings_changed')
    then 'ok' else 'FAIL ' || _slots::text end);
  insert into _t(check_name, result) values ('reglage : seule l''obligatoire de la nouvelle serie compte (avant deja prise)',
    case when cardinality(public.repair_order_reception_missing(_or)) = 0 then 'ok' else 'FAIL' end);
  _res := public.repair_order_reception_photo_add(_or, _a5, 'reservoir', null);
  insert into _t(check_name, result) values ('reglage : la photo ajoutee par l''atelier se prend',
    case when _res ? 'photo_id' then 'ok' else 'FAIL ' || _res::text end);
  begin
    perform public.workshop_reception_settings_set(_co, '[{"code":"selle"}]'::jsonb);
    _err := 'aucune erreur';
  exception when others then _err := sqlerrm; end;
  insert into _t(check_name, result) values ('reglage : photo ajoutee sans libelle refusee',
    case when _err like '%libellé%' then 'ok' else 'FAIL ' || _err end);
  begin
    perform public.workshop_reception_settings_set(_co, '[{"code":"degat","label":"X"}]'::jsonb);
    _err := 'aucune erreur';
  exception when others then _err := sqlerrm; end;
  insert into _t(check_name, result) values ('reglage : code reserve « degat » refuse',
    case when _err like '%code invalide%' then 'ok' else 'FAIL ' || _err end);
  _slots := public.workshop_reception_settings_set(_co, null);
  insert into _t(check_name, result) values ('reglage : retour a la serie d''usine',
    case when jsonb_array_length(_slots) = 6 then 'ok' else 'FAIL ' || _slots::text end);
end $s$;

reset role;
select * from _t order by n;
