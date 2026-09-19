-- =====================================================================
-- MISSION 04 — CARTE 8 (complément) : « pas encore de moto » n'est pas à valider.
-- ADDITIVE : une fonction + un déclencheur BEFORE INSERT. À l'inscription ou à la
-- borne, « pas encore de moto » (kind = none) est enregistré sans statut, comme les
-- déclarations existantes du même genre ; toute autre déclaration arrive « a_valider ».
-- =====================================================================
create or replace function public.trg_declared_vehicle_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.kind = 'none' then new.status := null;
  elsif new.status is null and new.vehicle_id is null then new.status := 'a_valider';
  end if;
  return new;
end $fn$;
revoke all on function public.trg_declared_vehicle_status() from public, anon, authenticated;

drop trigger if exists trg_contact_declared_vehicles_status on public.contact_declared_vehicles;
create trigger trg_contact_declared_vehicles_status
  before insert on public.contact_declared_vehicles
  for each row execute function public.trg_declared_vehicle_status();
