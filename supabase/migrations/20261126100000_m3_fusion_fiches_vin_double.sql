-- M3 (Simon, 26/11/2026) : un VIN = une fiche. Des demandes de reprise ont créé une seconde fiche
-- pour des motos déjà connues (fiche G8). On réunit chaque paire dans la fiche la plus ancienne :
-- dossier REP, photos, OR, lecture DCS, vendeur, notes et kilométrage passent sur elle.
-- La fiche vidée n'est pas effacée : elle est désactivée, sans VIN, et renvoie à la fiche gardée.
-- Tout est tracé dans `events` (copie complète des deux fiches avant la réunion).

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
    vin = null, is_active = false, to_complete = false,
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

-- Les paires existantes (ITALBIKE STORE et la société d'essai) : la fiche la plus ancienne est gardée.
do $$
declare
  g record;
  dup uuid;
begin
  for g in
    select v.company_id, v.vin, (array_agg(v.id order by v.created_at, v.id))[1] as keep_id,
           (array_agg(v.id order by v.created_at, v.id))[2:] as dup_ids
      from public.vehicles v
     where v.company_id in ('3d9f0f13-a691-4d07-ad58-34590df86e33', '5593d97e-69ad-43dd-8237-4ab8aa4e5c08')
       and v.vin in ('WB10D5207K6A03038', 'ZDM1A02BGMB009261', 'ZDM1V00AANB003184',
                     'ZDM3K00AANB005633', 'ZDMB200AAFB011445', 'ZDMH801ABCB008389')
     group by v.company_id, v.vin
    having count(*) > 1
  loop
    foreach dup in array g.dup_ids loop
      perform public._vehicle_merge_into(g.keep_id, dup);
    end loop;
  end loop;
end $$;
