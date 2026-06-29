-- M3 — Décodeur VIN Ducati : table de référence VDS -> modèle/specs.
-- Donnée de RÉFÉRENCE universelle (encodage VIN Ducati), non sensible et non liée
-- à une société -> pas de company_id (exception assumée à la règle 2). RLS = lecture
-- pour tout utilisateur authentifié ; écriture réservée aux fonctions security definer.
create table if not exists public.ducati_vds (
  vds text primary key,                  -- positions 4-9 du VIN
  model text,
  displacement_cc integer,
  power_cv integer,
  euro text,
  samples integer not null default 1,
  source text not null default 'seed',   -- 'seed' (factures) | 'learned' (saisie véhicule)
  updated_at timestamptz not null default now()
);
alter table public.ducati_vds enable row level security;
drop policy if exists ducati_vds_read on public.ducati_vds;
create policy ducati_vds_read on public.ducati_vds for select to authenticated using (true);

-- Apprentissage idempotent : enrichit/affine un code VDS depuis un VIN + specs.
-- Ne JAMAIS écraser une valeur connue par du vide (coalesce) ; incrémente le compteur.
create or replace function public.learn_ducati_vds(_vin text, _model text, _cc integer, _cv integer, _euro text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v text;
begin
  if _vin is null or upper(_vin) !~ '^ZDM[A-Z0-9]{14}$' then return; end if;
  v := upper(substring(_vin from 4 for 6));
  insert into public.ducati_vds(vds, model, displacement_cc, power_cv, euro, samples, source, updated_at)
  values (v, nullif(btrim(_model), ''), _cc, _cv, nullif(btrim(_euro), ''), 1, 'learned', now())
  on conflict (vds) do update set
    samples = ducati_vds.samples + 1,
    model = coalesce(ducati_vds.model, excluded.model),
    displacement_cc = coalesce(ducati_vds.displacement_cc, excluded.displacement_cc),
    power_cv = coalesce(ducati_vds.power_cv, excluded.power_cv),
    euro = coalesce(ducati_vds.euro, excluded.euro),
    updated_at = now();
end; $$;
grant execute on function public.learn_ducati_vds(text, text, integer, integer, text) to authenticated;

-- Trigger : chaque moto Ducati enregistrée (VIN + modèle) enrichit la table de référence.
create or replace function public.tg_learn_ducati_vds() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if NEW.vin is not null and upper(NEW.vin) ~ '^ZDM[A-Z0-9]{14}$' and NEW.model is not null then
    perform public.learn_ducati_vds(NEW.vin, NEW.model, NEW.displacement::integer, NEW.power_cv::integer, NEW.antipollution);
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_learn_ducati_vds on public.vehicles;
create trigger trg_learn_ducati_vds
  after insert or update of vin, model on public.vehicles
  for each row execute function public.tg_learn_ducati_vds();
