-- M3 (Simon, 23/11/2026) : le propriétaire est le motard ; la banque ou le leasing est celui qui paie.
-- Dans G8, l'organisme était saisi comme client de la facture de la moto. On reprend ce lien pour les
-- 51 motos dont la facture va à un organisme certain et n'a pas été annulée, sauf si la moto a été
-- revendue ensuite. Aucun propriétaire n'est modifié ici : le motard vient du DCS, sur clic.
-- Les sociétés au nom ambigu (AKC, ES, ATR Finances) ne sont pas touchées.
update public.contacts c
   set type = 'banque_leasing'
 where c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
   and c.type = 'professionnel'
   and upper(coalesce(nullif(c.company_name, ''), c.last_name)) in (
     'ALPHA CREDIT', 'ALPHACREDIT / ALPHALEASE', 'ING EQUIPMENT LEASE BELGIUM', 'CBC BANQUE', 'KBC BANK', 'KBC BANK SA',
     'KBC LEASE BELGIUM', 'AB LEASE', 'KEN LEASE', 'EXECUTIVE CAR LEASE & RENTING', 'VAN BREDA');

update public.vehicles v
   set financing_contact_id = x.bank
  from (values
    ('0108b15f-56c9-4eb6-b39a-174518e282de'::uuid, '066a52c8-efce-4955-ad6f-864e220509ce'::uuid),
    ('017ed3ad-a0e0-4502-a496-63ab5f5d7189'::uuid, '606e49b6-fcb4-493c-b3aa-21e0cb1c8448'::uuid),
    ('0abcf299-a4b2-410d-81c7-aef5b0da0b08'::uuid, '2ce76edc-569b-4b37-8ac6-904d95a5ee71'::uuid),
    ('104e8846-1b4a-4c1d-bed3-5cf8a7277c52'::uuid, '3d9eb412-9f5d-4e31-8561-baaa37b01cee'::uuid),
    ('1649029e-8778-4920-8130-586ce8a9796e'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('17e24510-4ba6-49d0-8263-d4a8147e96e3'::uuid, 'd95491e3-d4cc-44e4-98e2-831e4467d2f9'::uuid),
    ('237d729c-f992-406b-9d16-12749a8fb746'::uuid, '0c7d3ac9-79a0-44a1-98b5-a6006339b4b9'::uuid),
    ('272a87f4-5fcc-4119-8c9b-91c56b265b22'::uuid, '71d114fa-e0a5-4bea-a652-283b5d7d82f6'::uuid),
    ('2a681c07-8479-46b7-be92-270c41520372'::uuid, '066a52c8-efce-4955-ad6f-864e220509ce'::uuid),
    ('2b8006f5-5ebc-4f02-97ef-198a539e2805'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('3fa2bad8-bf2c-4100-aff5-af6681a7291c'::uuid, '6d7f2556-ca56-49b7-8926-3a9bfaad3dc9'::uuid),
    ('4392a305-abb0-49c6-84b3-2c052fbee18c'::uuid, 'f15f1990-b010-44e1-bf69-48bee60e7a56'::uuid),
    ('447ed689-01dd-4a41-a7fa-268ac68e0865'::uuid, '3d9eb412-9f5d-4e31-8561-baaa37b01cee'::uuid),
    ('547e4094-6ebd-4082-acd4-96da98816798'::uuid, '606e49b6-fcb4-493c-b3aa-21e0cb1c8448'::uuid),
    ('55a3d4fb-101a-4c85-abb7-039aef3d5daa'::uuid, '606e49b6-fcb4-493c-b3aa-21e0cb1c8448'::uuid),
    ('573e214a-4ad4-4b7b-bc97-803b67141114'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('5a498477-2743-4949-9b0f-0605e1fb8bda'::uuid, '606e49b6-fcb4-493c-b3aa-21e0cb1c8448'::uuid),
    ('606cffbc-cfd3-445c-9529-87ed2709cbf3'::uuid, '606e49b6-fcb4-493c-b3aa-21e0cb1c8448'::uuid),
    ('62c2e456-fbad-4b8e-935d-36bbefb57e4e'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('62d935a0-db3f-4d9d-a050-65bf505f5d14'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('644b2e53-74f9-4784-9283-a94aab7e43b7'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('647c0119-6274-4bd0-9dd6-8f6218d20c78'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('67d333c5-a1d2-48cc-b62a-c2b1467c7fd6'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('6d98b6a3-8d28-4bc4-8f0a-db12036b85ad'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('72f0e4a5-5de7-4675-8b4a-be2ac82dd706'::uuid, '066a52c8-efce-4955-ad6f-864e220509ce'::uuid),
    ('739c3b01-95ca-4505-9479-8c2604d69d89'::uuid, '606e49b6-fcb4-493c-b3aa-21e0cb1c8448'::uuid),
    ('7ff94cae-162e-481c-acca-ce0eac3abadf'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('82a9f6ff-fac1-4257-b3f6-41fb4aa9ca58'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('86c633cb-891d-4145-b610-bbe431c23373'::uuid, '3d9eb412-9f5d-4e31-8561-baaa37b01cee'::uuid),
    ('88797379-d288-4558-9bbf-1692c9566eeb'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('9563b236-f6d7-4546-8edf-96fdc16eb55d'::uuid, '3d9eb412-9f5d-4e31-8561-baaa37b01cee'::uuid),
    ('96502db5-404c-4bf3-be40-3fd6ac4fdd94'::uuid, '606e49b6-fcb4-493c-b3aa-21e0cb1c8448'::uuid),
    ('9c57fc7e-4fbe-4e82-85d9-901c5f4b62a3'::uuid, '606e49b6-fcb4-493c-b3aa-21e0cb1c8448'::uuid),
    ('9f038fd9-484f-4a68-a9ad-a218adabedbd'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('a8304823-d104-460b-a3dd-2d5c854474f7'::uuid, '606e49b6-fcb4-493c-b3aa-21e0cb1c8448'::uuid),
    ('b04285a8-b165-443f-810b-81c56fdfecf1'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('b2eaa501-b880-4513-9442-3e096d6583e6'::uuid, '6d7f2556-ca56-49b7-8926-3a9bfaad3dc9'::uuid),
    ('b400477d-72e4-4cca-ae43-15575a182937'::uuid, '71d114fa-e0a5-4bea-a652-283b5d7d82f6'::uuid),
    ('bc6cad41-6ab7-40e9-9925-46478b2d0816'::uuid, '71d114fa-e0a5-4bea-a652-283b5d7d82f6'::uuid),
    ('c537004b-18e7-4838-bfbb-da0ec1096306'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('c550a495-0147-4f7e-bf5f-66c2c866842d'::uuid, '066a52c8-efce-4955-ad6f-864e220509ce'::uuid),
    ('c56dea77-1daf-4fb1-a824-df1a9f58d541'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('cbaa3f64-93cb-4a1a-a925-50d04de8b36f'::uuid, '3d9eb412-9f5d-4e31-8561-baaa37b01cee'::uuid),
    ('d0abb6ec-6ff9-4b65-ac53-3ebba4235858'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('d460a1d1-1635-473c-8374-7e6dc047a57e'::uuid, '066a52c8-efce-4955-ad6f-864e220509ce'::uuid),
    ('e59ac2bb-a3a9-418a-b349-0ef8cb0823c9'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('e6ca8c4b-d553-4efb-b4ab-88a76498e3a9'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('e9e36bdc-bece-48a4-8544-25b48f7f51a4'::uuid, '3d9eb412-9f5d-4e31-8561-baaa37b01cee'::uuid),
    ('f05ddc37-d977-4cc0-9a5d-ad3795dc32cb'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('f7165878-6f82-45ce-ad43-d4ae7c677421'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid),
    ('fd270198-01ae-4ca4-aec4-a4ce80fae847'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid)
  ) as x(vehicle, bank)
 where v.id = x.vehicle and v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and v.financing_contact_id is null;

-- Quand le motard remplace une banque comme propriétaire, la banque reste sur la moto comme organisme payeur.
create or replace function public._vehicle_owner_bank_to_financing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_current and not new.is_current
     and exists (select 1 from public.contacts c where c.id = old.contact_id and c.type = 'banque_leasing') then
    update public.vehicles set financing_contact_id = old.contact_id
     where id = old.vehicle_id and financing_contact_id is null;
  end if;
  return null;
end $$;
revoke all on function public._vehicle_owner_bank_to_financing() from public, anon, authenticated;

drop trigger if exists trg_vehicle_owner_bank_to_financing on public.vehicle_owners;
create trigger trg_vehicle_owner_bank_to_financing
  after update of is_current on public.vehicle_owners
  for each row execute function public._vehicle_owner_bank_to_financing();
