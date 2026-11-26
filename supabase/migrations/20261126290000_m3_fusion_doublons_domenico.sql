-- M3 (Domenico, via Simon, 26/11/2026) : une même moto saisie deux fois avec un VIN presque identique.
-- Décision de Domenico (fichier « plaques en double ») : la fiche en vert est gardée, l'autre y est
-- réunie (mêmes règles que la réunion du 26/11 : historique, documents, OR, factures passent sur la
-- fiche gardée ; la fiche vidée est désactivée, sans VIN). Le VIN erroné reste dans l'historique
-- (event d'audit de la mise à jour). MAZE823 : les deux motos sont gardées (décision de Domenico).
-- La réunion tient compte de l'historique des plaques (créé après la réunion du matin).
create or replace function public._vehicle_merge_into(_keep uuid, _dup uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k public.vehicles;
  d public.vehicles;
  kj jsonb;
  dj jsonb;
  merged jsonb;
  certified text[];
  col text;
  sets text;
  fk record;
  n integer;
  moved jsonb := '{}'::jsonb;
begin
  select * into k from public.vehicles where id = _keep for update;
  select * into d from public.vehicles where id = _dup for update;
  if k.id is null or d.id is null then raise exception 'vehicle_merge_not_found'; end if;
  if k.company_id <> d.company_id or k.vin is distinct from d.vin or k.vin is null or _keep = _dup then
    raise exception 'vehicle_merge_mismatch';
  end if;
  kj := to_jsonb(k);
  dj := to_jsonb(d);

  -- 1) Valeurs de la fiche gardée : ses valeurs restent, ses vides sont remplis, et ce que le DCS a
  --    certifié sur l'autre fiche s'impose (règle R1 : donnée d'usine).
  select coalesce(array_agg(s.field), '{}') into certified
    from public.vehicle_field_status s where s.vehicle_id = _dup and s.status = 'certifie';
  merged := kj;
  for col in select jsonb_object_keys(dj) loop
    continue when col in ('id', 'company_id', 'vin', 'created_at', 'created_by', 'updated_at', 'notes', 'status',
                          'mileage', 'is_active', 'imported_from', 'legacy_state', 'purchase_price', 'cost_price',
                          'display_price', 'article_id');
    continue when jsonb_typeof(dj -> col) = 'null' or dj ->> col = '';
    if col = any(certified) or jsonb_typeof(kj -> col) = 'null' or kj ->> col = '' then
      merged := jsonb_set(merged, array[col], dj -> col);
    end if;
  end loop;
  -- La reprise en cours porte le statut, les prix et l'article ; le kilométrage le plus haut ; les deux notes.
  merged := merged || jsonb_build_object(
    'status', d.status,
    'mileage', greatest(k.mileage, d.mileage),
    'purchase_price', coalesce(d.purchase_price, k.purchase_price),
    'cost_price', coalesce(d.cost_price, k.cost_price),
    'display_price', coalesce(d.display_price, k.display_price),
    'article_id', coalesce(k.article_id, d.article_id),
    'notes', nullif(concat_ws(E'\n', nullif(k.notes, ''), nullif(d.notes, '')), ''));
  if k.article_id is null and d.article_id is not null then
    update public.vehicles set article_id = null where id = _dup;
  end if;

  -- 2) Ce qui ne peut exister qu'une fois par moto : la version la plus récente (fiche de reprise) gagne.
  delete from public.vehicle_field_status s where s.vehicle_id = _keep
     and s.field in (select x.field from public.vehicle_field_status x where x.vehicle_id = _dup);
  if exists (select 1 from public.vehicle_dcs_client c where c.vehicle_id = _dup) then
    delete from public.vehicle_dcs_client where vehicle_id = _keep;
  end if;
  delete from public.vehicle_bulletins b where b.vehicle_id = _dup and b.bulletin_id is not null
     and exists (select 1 from public.vehicle_bulletins x where x.vehicle_id = _keep and x.bulletin_id = b.bulletin_id);
  delete from public.vehicle_maintenance m where m.vehicle_id = _dup and m.ducati_event_id is not null
     and exists (select 1 from public.vehicle_maintenance x where x.vehicle_id = _keep and x.ducati_event_id = m.ducati_event_id);
  delete from public.shopify_vehicle_links l where l.vehicle_id = _dup
     and exists (select 1 from public.shopify_vehicle_links x where x.vehicle_id = _keep
                  and x.company_id = l.company_id and x.shopify_variant_id = l.shopify_variant_id);
  -- Le même client déjà propriétaire sur la fiche gardée ne reçoit pas une seconde ligne.
  delete from public.vehicle_owners o where o.vehicle_id = _dup
     and exists (select 1 from public.vehicle_owners x where x.vehicle_id = _keep and x.contact_id = o.contact_id);
  -- Historique des plaques : une seule plaque « en cours » par moto ; celle de la fiche réunie est close.
  update public.vehicle_plate_history h
     set is_current = false, to_date = coalesce(h.to_date, current_date),
         reason = coalesce(nullif(h.reason, ''), 'Fiche réunie dans ' || _keep)
   where h.vehicle_id = _dup and h.is_current
     and exists (select 1 from public.vehicle_plate_history x where x.vehicle_id = _keep and x.is_current);
  -- Échéances d'entretien : recalculées sur la fiche gardée (donnée dérivée).
  delete from public.vehicle_maintenance_due where vehicle_id = _dup;

  -- 3) Tout ce qui pointe vers la fiche en double passe sur la fiche gardée.
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.vehicles'::regclass and array_length(c.conkey, 1) = 1
       -- Registre des véhicules : une inscription ne se modifie jamais (B7). Elle garde son VIN et
       -- sa fiche d'origine, qui reste en base et renvoie à la fiche gardée.
       and c.conrelid <> 'public.vehicle_register'::regclass
  loop
    execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using _keep, _dup;
    get diagnostics n = row_count;
    if n > 0 then moved := moved || jsonb_build_object(fk.tbl || '.' || fk.col, n); end if;
  end loop;
  update public.attachments set entity_id = _keep where entity_type = 'vehicle' and entity_id = _dup;
  get diagnostics n = row_count;
  if n > 0 then moved := moved || jsonb_build_object('attachments', n); end if;
  update public.portal_uploads set entity_id = _keep where entity_id = _dup;
  update public.portal_doc_no_back set entity_id = _keep where entity_id = _dup;
  update public.notifications set entity_id = _keep::text where entity_id = _dup::text;

  -- 4) La fiche en double est vidée de son VIN et désactivée ; elle renvoie à la fiche gardée.
  update public.vehicles set
    vin = null, plate = null, is_active = false, to_complete = false,
    notes = 'Fiche réunie le ' || to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY')
            || ' dans la fiche ' || _keep || ' (même VIN ' || k.vin || ').'
  where id = _dup;

  -- 5) Fiche gardée : valeurs réunies.
  select string_agg(format('%I = r.%I', a.attname, a.attname), ', ') into sets
    from pg_attribute a
   where a.attrelid = 'public.vehicles'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attgenerated = '' and a.attname not in ('id', 'company_id', 'created_at', 'updated_at');
  execute format('update public.vehicles v set %s from jsonb_populate_record(null::public.vehicles, $1) r where v.id = $2', sets)
    using merged, _keep;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (k.company_id, auth.uid(), 'vehicle_merged', 'vehicles', _keep::text, 'system', kj,
          jsonb_build_object('merged_from', _dup, 'merged_row', dj, 'moved', moved)),
         (k.company_id, auth.uid(), 'vehicle_merged_into', 'vehicles', _dup::text, 'system', dj,
          jsonb_build_object('merged_into', _keep));
  return jsonb_build_object('keep', _keep, 'dup', _dup, 'vin', k.vin, 'moved', moved);
end $$;

revoke all on function public._vehicle_merge_into(uuid, uuid) from public, anon, authenticated;

do $$
declare
  p record;
begin
  for p in select * from (values
    ('82a8159a-f7d3-44cf-9b17-646d423b3a67'::uuid, 'd32bb44d-b589-40d8-8cc2-c853d1ee9333'::uuid),  -- 1MBV340
    ('e6e53b0f-f75a-47e2-8b75-ae303629a928'::uuid, '30eb1438-b8f0-4565-94c0-ff670752cd23'::uuid),  -- BI788M
    ('233c9720-bc7d-48d1-a466-ef01374afd0d'::uuid, '24389fd1-c012-47bd-8c41-5d7bdd73882e'::uuid),  -- MAYA594
    ('fa76f14c-cbdd-48bb-9877-41093f672053'::uuid, '8e543c85-38b4-4c07-8517-b1614f83ed74'::uuid),  -- MSD259 (fusion des 2)
    ('43d19cc5-1f46-4d7c-9d4f-5440889749f2'::uuid, '604a19ff-ffbd-4a0c-8812-b4aee40b32bd'::uuid)   -- WLR076
  ) as t(keep_id, dup_id)
  loop
    update public.vehicles d set vin = k.vin
      from public.vehicles k
     where d.id = p.dup_id and k.id = p.keep_id and d.company_id = k.company_id
       and d.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and d.is_active;
    if not found then raise exception 'fiche introuvable ou deja reunie : %', p.dup_id; end if;
    perform public._vehicle_merge_into(p.keep_id, p.dup_id);
  end loop;

  -- MBJC144 : la fiche de reprise déjà réunie ce matin (désactivée, sans VIN) garde encore la plaque.
  update public.vehicles set plate = null
   where id = '2a9b85c6-58e0-4997-b386-e0cd584bd580' and is_active = false and plate = 'MBJC144';
end $$;
