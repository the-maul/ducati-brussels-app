-- M3 (Simon, 26/11/2026) : « c'est belfius, ing, alphacrédit, europabank, .. » — Europabank est une
-- banque, comme celles reliées le 23/11. Ses 4 motos reçoivent le lien de financement (facture G8
-- adressée à Europabank). Aucun propriétaire n'est modifié ; AKC, ES et ATR Finances restent des clients.
-- CA Auto Bank attend la réponse de Simon.
update public.contacts
   set type = 'banque_leasing'
 where id = '7a3e77fb-b188-4ed8-8984-2306234b6fdb'
   and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
   and type = 'professionnel';

update public.vehicles
   set financing_contact_id = '7a3e77fb-b188-4ed8-8984-2306234b6fdb'
 where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
   and financing_contact_id is null
   and id in ('211f3da6-546f-4e5a-821e-702d839a7b4e', '0f6473e5-df56-47a9-8698-2e4c55311468',
              '8c409c6f-341f-46a8-a5ff-6e6d5b085564', '2381493b-2e2d-41d2-bb16-7b31b9244798');
