-- M3 (retour de Domenico, 23/11/2026) : une plaque est en lettres et chiffres, 7 caractères minimum,
-- sauf si elle est marquée « personnalisée ». Les plaques existantes ne sont pas modifiées.
alter table public.vehicles add column if not exists plate_custom boolean not null default false;
comment on column public.vehicles.plate_custom is 'Plaque personnalisée : pas de contrôle de format ni de longueur à la saisie.';
