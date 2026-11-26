-- M1 (Simon, 26/11/2026 : « oui ») : suppression des données de test de septembre sur ITALBIKE —
-- 7 fiches clients de test (codes 9232, 9233, 9242 à 9246, inscriptions/borne faites par l'équipe),
-- leurs 5 motos déclarées « à valider », leurs RDV, prospects, échanges et pièces jointes.
-- Le 23/11, la fiche de test 9233 avait été attachée comme propriétaire d'une vraie moto
-- (Multistrada 1200 S Touring, fiche 5d26c9a6…) : on rend la moto à son propriétaire réel (fiche 1699).
-- Les comptes de connexion eux-mêmes (auth) ne sont pas touchés.
do $$
declare
  test_ids uuid[] := array[
    'ff101890-3fb5-4b3e-8c0f-f16d8b929da4', '0b41117e-e3db-4ee0-9ebe-8a32af7e6e28',
    'e89b34d1-0fc7-47c0-91ab-93b64856cdfc', '3a2e3458-f98b-4751-95c5-fce6fc8e7222',
    'e2d99f00-0441-4e5b-95d8-718122dad605', 'a4cb3544-89e5-4092-9548-815c484dd13e',
    '98e5f263-5b22-4d23-9b86-32b162362f45']::uuid[];
  n integer;
begin
  select count(*) into n from public.contacts
   where id = any(test_ids) and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
     and code in ('9232','9233','9242','9243','9244','9245','9246');
  if n <> 7 then raise exception 'fiches de test introuvables (%)', n; end if;

  -- La vraie moto retrouve son propriétaire.
  delete from public.vehicle_owners where id = 'a43c8c3f-0686-405d-9b71-d5c43d372124' and contact_id = any(test_ids);
  update public.vehicle_owners set to_date = null, is_current = true
   where id = 'dfbce603-7e24-46d0-bea4-9ce7ddbd80df'
     and not exists (select 1 from public.vehicle_owners x where x.vehicle_id = '5d26c9a6-2dd8-4748-83e7-589ec433c3c3' and x.is_current);

  delete from public.contact_declared_vehicles where contact_id = any(test_ids);
  delete from public.workshop_appointments where contact_id = any(test_ids) and vehicle_id is null;
  delete from public.leads where contact_id = any(test_ids);
  delete from public.attachments where entity_type in ('contact', 'client') and entity_id = any(test_ids);
  delete from public.contacts where id = any(test_ids);
end $$;
