-- =====================================================================
-- M8 / M3 — Le km relevé sur l'OR met à jour la fiche moto, comme G8 (décision du client Q64,
-- 20/11/2026). ATE001 VEH002
--
-- G8 : le kilométrage saisi à la réception de l'OR devient le kilométrage du parc ; un km
-- INFÉRIEUR au dernier relevé est bloqué (« Kilométrage inférieur ») sauf si l'on coche
-- « Forcer l'enregistrement du kilométrage inférieur ».
-- Le DMS gardait le km sur l'OR seulement (la fiche restait à l'ancien km).
--
-- Pas de second historique : l'historique des relevés reste celui de la fiche moto
-- (vehicleMileageReadings = km des OR non annulés + km de la fiche + entretien + km déclaré,
-- décision Q42 / lot « OR de base »). L'OR EST le relevé ; la fiche prend le plus grand.
--
-- 1. trg_repair_orders_mileage_lower (BEFORE INSERT / UPDATE OF mileage, vehicle_id) : un km
--    inférieur au dernier relevé est refusé, sauf « Forcer » = repair_orders.mileage_ack_previous
--    renseigné (le relevé dépassé, déjà posé par l'écran depuis le 18/11) et supérieur au km saisi.
--    Dernier relevé (serveur) : km de la fiche moto et km des autres OR non annulés de la moto ;
--    pour un OR déjà enregistré dont la moto ne change pas, seuls les OR créés AVANT lui comptent
--    (la fiche a pu être mise à jour par lui-même ou par un OR plus récent). Contrôle des écrans
--    seulement (auth.uid() renseigné), comme Q42 : imports et fonctions serveur non contrôlés.
--    Message FR clair ; hint « mileage_lower » et le relevé dans detail (l'écran traduit).
-- 2. trg_repair_orders_mileage_to_vehicle (AFTER INSERT / UPDATE OF mileage, vehicle_id, status) :
--    km de l'OR > km de la fiche → la fiche prend le km de l'OR (même société, OR non annulé).
--    Correction à la baisse du km d'un OR dont la valeur était celle de la fiche (faute de frappe)
--    → la fiche reprend le plus grand relevé restant (cet OR corrigé, les autres OR).
--    Trace : une ligne events « vehicle_mileage_from_or » (ancien / nouveau km, OR), en plus de
--    l'audit de la fiche (audit_row).
--
-- Additive, rejouable. Essai à blanc : supabase/tests/m8_km_or_vers_fiche_moto.sql. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '5s';

-- Dernier relevé connu (serveur) d'une moto, hors OR _exclude ; _before : seuls les OR créés avant.
create or replace function public._vehicle_last_mileage(_vehicle uuid, _exclude uuid, _before timestamptz, _with_vehicle boolean)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(greatest(
           coalesce(case when _with_vehicle then (select v.mileage from public.vehicles v where v.id = _vehicle) end, 0),
           coalesce((select max(r.mileage) from public.repair_orders r
                      where r.vehicle_id = _vehicle and r.status is distinct from 'annule' and r.mileage is not null
                        and (_exclude is null or r.id <> _exclude)
                        and (_before is null or r.created_at < _before)), 0)), 0)
$$;
revoke all on function public._vehicle_last_mileage(uuid, uuid, timestamptz, boolean) from public, anon, authenticated;

-- 1. Km inférieur : bloqué sauf « Forcer ».
create or replace function public.repair_orders_mileage_lower()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  last_km integer;
  same_vehicle boolean;
begin
  if auth.uid() is null then return new; end if;            -- imports, fonctions serveur
  if new.vehicle_id is null or new.mileage is null then return new; end if;
  if new.status = 'annule' then return new; end if;
  if tg_op = 'UPDATE' and new.mileage is not distinct from old.mileage and new.vehicle_id is not distinct from old.vehicle_id then
    return new;
  end if;
  same_vehicle := tg_op = 'UPDATE' and new.vehicle_id is not distinct from old.vehicle_id;
  last_km := public._vehicle_last_mileage(new.vehicle_id, new.id,
                                          case when same_vehicle then old.created_at end,
                                          not same_vehicle);
  if last_km is not null and new.mileage < last_km
     and not (new.mileage_ack_previous is not null and new.mileage_ack_previous > new.mileage) then
    raise exception 'Kilométrage inférieur : % km saisis, dernier relevé % km. Corrigez le km ou cochez « Forcer l''enregistrement du kilométrage inférieur ».',
      new.mileage, last_km
      using errcode = '23514', hint = 'mileage_lower', detail = last_km::text;
  end if;
  return new;
end $$;
revoke all on function public.repair_orders_mileage_lower() from public, anon, authenticated;
drop trigger if exists trg_repair_orders_mileage_lower on public.repair_orders;
create trigger trg_repair_orders_mileage_lower before insert or update of mileage, vehicle_id on public.repair_orders
  for each row execute function public.repair_orders_mileage_lower();

-- 2. Km de l'OR → fiche moto.
create or replace function public.repair_orders_mileage_to_vehicle()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  target integer;
begin
  if new.vehicle_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.mileage is not distinct from old.mileage
     and new.vehicle_id is not distinct from old.vehicle_id and new.status is not distinct from old.status then
    return new;
  end if;
  select id, company_id, mileage into v from public.vehicles where id = new.vehicle_id for update;
  if not found or v.company_id is distinct from new.company_id then return new; end if;

  target := null;
  if new.mileage is not null and new.status is distinct from 'annule' and new.mileage > coalesce(v.mileage, 0) then
    target := new.mileage;                                   -- relevé plus grand : la fiche suit
  elsif tg_op = 'UPDATE' and new.vehicle_id is not distinct from old.vehicle_id
        and old.mileage is not null and v.mileage = old.mileage
        and (new.mileage is null or new.mileage < old.mileage or new.status = 'annule') then
    -- La fiche portait le km de cet OR, qui baisse (faute de frappe) ou est annulé :
    -- elle reprend le plus grand relevé restant.
    target := nullif(greatest(
                coalesce(case when new.status is distinct from 'annule' then new.mileage end, 0),
                coalesce((select max(r.mileage) from public.repair_orders r
                           where r.vehicle_id = new.vehicle_id and r.id <> new.id
                             and r.status is distinct from 'annule' and r.mileage is not null), 0)), 0);
    if target is null or target >= v.mileage then target := null; end if;
  end if;
  if target is null or target is not distinct from v.mileage then return new; end if;

  update public.vehicles set mileage = target, mileage_qualif = coalesce(mileage_qualif, 'reel') where id = v.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (v.company_id, auth.uid(), 'vehicle_mileage_from_or', 'vehicle', v.id::text, 'repair_order',
          jsonb_build_object('mileage', v.mileage),
          jsonb_build_object('mileage', target, 'repair_order_id', new.id, 'repair_order', new.number));
  return new;
end $$;
revoke all on function public.repair_orders_mileage_to_vehicle() from public, anon, authenticated;
drop trigger if exists trg_repair_orders_mileage_to_vehicle on public.repair_orders;
create trigger trg_repair_orders_mileage_to_vehicle after insert or update of mileage, vehicle_id, status on public.repair_orders
  for each row execute function public.repair_orders_mileage_to_vehicle();
