-- =====================================================================
-- M3 — Le champ "Marquage (gravage)" est retire du formulaire vehicule.
-- On rapatrie l'information existante (vehicles.marking) dans le champ
-- "Origine" (vehicles.origin) lorsque celui-ci est vide, afin de ne perdre
-- aucune donnee. Idempotent : ne reecrit pas une origine deja renseignee.
-- La colonne marking est conservee (non destructif) ; elle n'est plus saisie.
-- =====================================================================

update public.vehicles
set origin = marking
where marking is not null
  and btrim(marking) <> ''
  and (origin is null or btrim(origin) = '');
