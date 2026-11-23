-- M3 (Domenico et Simon, 23/11/2026) : le type de garantie devient une liste ; CarGarantie se précise
-- par une formule (EverRed 12, 24 ou 36 mois, EverRed Plus 12 mois). Les valeurs existantes ne changent pas.
alter table public.vehicles add column if not exists warranty_plan text;
comment on column public.vehicles.warranty_plan is 'Formule de la garantie CarGarantie ; vide pour les autres types de garantie.';
