-- =====================================================================
-- M3 (Simon, 26/11/2026) VEH001 : suite de 20261126190000 (le motard devient propriétaire au lieu de la banque).
-- Pour ces 11 motos, le financement en cours de l'historique (vehicle_financings) reçoit le client
-- financé = le nouveau propriétaire actuel (celui nommé « CLIENT : » sur la facture de vente G8).
-- Seulement si le client financé est encore vide et que le propriétaire n'est pas une banque.
-- =====================================================================
update public.vehicle_financings x
   set client_contact_id = o.contact_id
  from public.vehicles v
  join public.vehicle_owners o on o.vehicle_id = v.id and o.is_current
  join public.contacts c on c.id = o.contact_id and c.type <> 'banque_leasing'
 where x.vehicle_id = v.id
   and x.is_current
   and x.client_contact_id is null
   and v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
   and upper(v.vin) in ('ZDM1K00AANB002369', 'ZDM1M00AAMB002306', 'ZDM3000AATB004451', 'ZDM3D06AARB007055',
                        'ZDM3H00AATB004664', 'ZDM8A01BGSB002040', 'ZDMBB00AALB005718', 'ZDM3G02BGRB005628',
                        'ZDM1003PPSB005735', 'ZDM5G01BGSB000619', 'ZDM1007BGTB009279');
