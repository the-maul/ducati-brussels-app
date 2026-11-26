-- M1 (Simon, 26/11/2026) : la Panigale V2 S ZDM3H00AATB004664 reste au nom de la société AM CARS CLEANING
-- (facturation professionnelle) ; son pilote privé, Anthony Gonzalez, est enregistré chez Ducati.
-- Les deux fiches sont liées (pro <-> privé), comme le fait l'écran « Fiches liées ».
insert into public.contact_links (company_id, contact_a, contact_b)
select '3d9f0f13-a691-4d07-ad58-34590df86e33', '7bae2b7f-1696-4816-be5c-6744ba2aa2b0', '4971f215-6bed-4d1c-b950-ede1870656b4'
 where not exists (
   select 1 from public.contact_links l
    where (l.contact_a = '7bae2b7f-1696-4816-be5c-6744ba2aa2b0' and l.contact_b = '4971f215-6bed-4d1c-b950-ede1870656b4')
       or (l.contact_b = '7bae2b7f-1696-4816-be5c-6744ba2aa2b0' and l.contact_a = '4971f215-6bed-4d1c-b950-ede1870656b4'));
