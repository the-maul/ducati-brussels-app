-- Correctif 19/11/2026 : reception d'un chassis (fiche du modele M3 et reception M4).
-- La variable locale « vin » de vehicle_chassis_receive (20261118140000) portait le meme nom que la
-- colonne vehicles.vin : le controle « VIN deja dans le parc » levait « column reference "vin" is
-- ambiguous » et AUCUN chassis ne pouvait etre recu. Meme fonction, variable renommee _vin.
-- Idempotent (create or replace), aucune donnee touchee.

create or replace function public.vehicle_chassis_receive(
  _article uuid, _chassis jsonb, _unit_cost numeric default null,
  _origin text default 'chassis_manuel', _ref text default null, _bin text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.articles;
  c record;
  _vin text;
  vid uuid;
  cost numeric;
begin
  select * into a from public.articles where id = _article;
  if a.id is null then raise exception 'Modele introuvable' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.is_member(a.company_id) then
    raise exception 'Acces refuse' using errcode = '42501';
  end if;
  if a.mgmt_type::text <> 'V' then
    raise exception 'Le modele % doit etre un article de type V (produit fini) pour recevoir des chassis (type actuel : %).',
      a.reference, a.mgmt_type using errcode = '22023';
  end if;

  select * into c from jsonb_to_record(coalesce(_chassis, '{}'::jsonb)) as x(
    vin text, brand text, model text, engine_number text, color text, model_year int, power_cv numeric,
    is_restricted boolean, energy text, antipollution text, first_registration_date date, mileage int,
    gps_tracker_id text, pin_tracker text, tpms_av text, tpms_ar text, warranty_end date, key_number text,
    police_book_number text, exposition_code text, display_price numeric);

  _vin := nullif(upper(regexp_replace(coalesce(c.vin, ''), '[^A-Za-z0-9]', '', 'g')), '');
  if _vin is null then
    raise exception 'Numero de chassis (VIN) obligatoire.' using errcode = '23502';
  end if;
  if exists (select 1 from public.vehicles w
              where w.company_id = a.company_id
                and upper(regexp_replace(coalesce(w.vin, ''), '[^A-Za-z0-9]', '', 'g')) = _vin) then
    raise exception 'VIN_EXISTS: le chassis % existe deja dans le parc.', _vin using errcode = '23505';
  end if;

  cost := coalesce(_unit_cost, a.purchase_price, 0);

  insert into public.vehicles (
    company_id, article_id, vin, reference, brand, model, engine_number, color, model_year, power_cv,
    is_restricted, energy, antipollution, first_registration_date, mileage, gps_tracker_id, pin_tracker,
    tpms_av, tpms_ar, warranty_end, key_number, police_book_number, exposition_code,
    purchase_price, cost_price, display_price, status, entry_date, created_by)
  values (
    a.company_id, a.id, _vin, a.reference, coalesce(nullif(btrim(c.brand), ''), a.brand),
    coalesce(nullif(btrim(c.model), ''), a.designation), nullif(btrim(c.engine_number), ''),
    nullif(btrim(c.color), ''), c.model_year, c.power_cv, coalesce(c.is_restricted, false),
    nullif(btrim(c.energy), ''), nullif(btrim(c.antipollution), ''), c.first_registration_date, c.mileage,
    nullif(btrim(c.gps_tracker_id), ''), nullif(btrim(c.pin_tracker), ''), nullif(btrim(c.tpms_av), ''),
    nullif(btrim(c.tpms_ar), ''), c.warranty_end, nullif(btrim(c.key_number), ''),
    nullif(btrim(c.police_book_number), ''), nullif(btrim(c.exposition_code), ''),
    cost, cost, coalesce(c.display_price, nullif(a.sale_price_ttc, 0)), 'stock_vn', current_date, auth.uid())
  returning id into vid;

  perform public.record_stock_move(
    a.id, 'entree'::public.stock_move_type, 1, cost, false, _bin,
    coalesce(nullif(btrim(_origin), ''), 'chassis_manuel'), coalesce(_ref, _vin), 'Chassis ' || _vin);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (a.company_id, auth.uid(), 'chassis_recu', 'vehicles', vid::text,
          case when _origin = 'reception' then 'reception' else 'screen' end, null,
          jsonb_build_object('article_id', a.id, 'modele', a.reference, 'vin', _vin, 'unit_cost', cost, 'ref', _ref));
  return vid;
end $$;
revoke all on function public.vehicle_chassis_receive(uuid, jsonb, numeric, text, text, text) from public, anon;
grant execute on function public.vehicle_chassis_receive(uuid, jsonb, numeric, text, text, text) to authenticated;
