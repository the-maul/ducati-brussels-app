-- M3 (Simon, 26/11/2026) : « CA Auto bank est une banque ». Ses 2 motos (Diavel for Bentley,
-- Panigale V4 S) reçoivent le lien de financement. Aucun propriétaire n'est modifié.
update public.contacts
   set type = 'banque_leasing'
 where id = '31d07e88-99bb-4cb5-9a27-3d22b9d9db77'
   and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
   and type = 'professionnel';

update public.vehicles
   set financing_contact_id = '31d07e88-99bb-4cb5-9a27-3d22b9d9db77'
 where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
   and financing_contact_id is null
   and id in ('071acea2-1806-4e51-a5b4-8a448cfdce9c', '48e89399-0f3d-4a93-b78e-683732dc89e2');
