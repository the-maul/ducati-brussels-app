-- M1 — Face « privée » d'un contact (en plus de la face société/pro).
-- Un pro peut avoir des coordonnées privées distinctes (la personne) : adresse, tél, e-mail
-- privés. Vides par défaut. L'identité (civilité/nom/naissance/permis) existe déjà.
-- + Rattachement de chaque moto au compte « pro » ou « privé » du client (recoupement Ducati).
alter table public.contacts
  add column if not exists private_address            text,
  add column if not exists private_address_complement text,
  add column if not exists private_zip                text,
  add column if not exists private_city               text,
  add column if not exists private_country            text,
  add column if not exists private_phone              text,
  add column if not exists private_mobile             text,
  add column if not exists private_email              text;

alter table public.vehicle_owners
  add column if not exists owner_kind text
    check (owner_kind is null or owner_kind in ('pro', 'prive'));   -- compte du client auquel la moto est rattachée

notify pgrst, 'reload schema';
