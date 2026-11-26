-- =====================================================================
-- M3 (Simon, 26/11/2026) : « oui vérifie si on a les clients dans la db ».
-- Règle validée : le PROPRIÉTAIRE d'une moto est le motard ; la banque / le leasing est celui qui paie
-- (vehicles.financing_contact_id). Dans G8, l'organisme était souvent saisi comme client de la facture.
-- Chez ITALBIKE, 19 motos avaient encore une banque (ou ES Finance) comme propriétaire actuel.
-- Pour 11 d'entre elles, la facture de vente G8 nomme le vrai client après « CLIENT : » (ou avec son
-- numéro de TVA), et ce client existe une seule fois dans les contacts, sous le même nom (même code
-- client G8 sur ses autres factures). Ces 11 motos passent à leur client :
--   * la ligne « banque propriétaire » est close (to_date = date de la facture de vente, is_current = false),
--     rien n'est supprimé ;
--   * le client devient propriétaire actuel à la date de la facture de vente financée ;
--   * la banque reste (ou est mise) sur la moto comme organisme payeur (financing_contact_id) ;
--   * chaque changement est tracé dans `events` (vehicle_owner_attached), comme le fait
--     vehicle_attach_owner. Cette fonction exige un utilisateur connecté (is_member) : la migration
--     reprend donc ses étapes exactes, avec origin = 'migration'.
-- Les 8 autres motos (facture sans nom de client, ou indice indirect seulement) ne sont pas touchées.
-- Aucun contact n'est créé.
-- =====================================================================

do $$
declare
  r record;
  _prev jsonb;
  _done integer := 0;
begin
  for r in
    select x.* from (values
      -- vehicule, ligne banque propriétaire, banque, client, date facture, facture G8, VIN, nom lu sur la facture
      ('644b2e53-74f9-4784-9283-a94aab7e43b7'::uuid, '4cf18e86-f8f0-4a3e-8ab8-7c659a326e8c'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid, 'ff849ce7-c45e-4fac-99ca-79226e214d01'::uuid, date '2026-02-25', '26000157', 'ZDM1K00AANB002369', 'BUREAU D ETUDES PHOENIX'),
      ('2b8006f5-5ebc-4f02-97ef-198a539e2805'::uuid, 'a803822d-d9b1-4b54-805c-7a0eb1f95d4b'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid, 'ee19d6a2-bcc9-4f89-8624-1cf3757cb730'::uuid, date '2025-07-20', '25000976', 'ZDM1M00AAMB002306', 'M-ELION'),
      ('c537004b-18e7-4838-bfbb-da0ec1096306'::uuid, '47549368-238d-47c9-9d71-0b20385cb676'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid, '59e393c1-37a2-494a-8f23-cbe9eef274a9'::uuid, date '2026-06-10', '26000706', 'ZDM3000AATB004451', 'MB HYDRO'),
      ('b04285a8-b165-443f-810b-81c56fdfecf1'::uuid, 'f254a59d-a09c-4e15-aa84-b360b8596349'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid, '26364abf-07b4-4e79-abe8-ad8b42aceabd'::uuid, date '2025-02-22', '25000151', 'ZDM3D06AARB007055', 'BELGASTRO TVA BE0735.513.485'),
      ('67d333c5-a1d2-48cc-b62a-c2b1467c7fd6'::uuid, '918c79d0-3ac5-47c0-9868-14b61a54ea20'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid, '7bae2b7f-1696-4816-be5c-6744ba2aa2b0'::uuid, date '2026-06-06', '26000682', 'ZDM3H00AATB004664', 'AM CARS'),
      ('fd270198-01ae-4ca4-aec4-a4ce80fae847'::uuid, 'b177ce6c-085c-4c18-8a4c-0874977a645b'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid, 'f03aacfa-52eb-47eb-954b-d657ddc42646'::uuid, date '2026-02-24', '26000149', 'ZDM8A01BGSB002040', 'NMS DENTAL'),
      ('6d98b6a3-8d28-4bc4-8f0a-db12036b85ad'::uuid, '4135c492-c840-4dce-88f1-0e41e8b84051'::uuid, '13687e13-074d-4844-8357-3a01ff1c920b'::uuid, '84e8b7cc-8c98-4603-b8f6-413a528cab17'::uuid, date '2026-05-07', '26000494', 'ZDMBB00AALB005718', 'DI NANNO PIERRE'),
      ('071acea2-1806-4e51-a5b4-8a448cfdce9c'::uuid, 'c7aa39b6-5f9d-4216-9df6-ea14ba8661d0'::uuid, '31d07e88-99bb-4cb5-9a27-3d22b9d9db77'::uuid, '9256a789-6947-4206-8a2d-fad172f0ebe8'::uuid, date '2024-12-18', '24001545', 'ZDM3G02BGRB005628', 'AB MAISON MEDICALE TVA BE0776.701.071'),
      ('5fb8d74e-cef4-47f1-bd62-759e1a194022'::uuid, '757648e9-706f-48b6-bd5d-040a0aa02e0f'::uuid, '3609c8fa-1779-4be0-b60e-f8e66b08fe64'::uuid, '3002cece-a056-41b2-a01f-25e0a0b69a83'::uuid, date '2025-12-02', '25001550', 'ZDM1003PPSB005735', 'EURO CARPET SRL'),
      ('1a5cfbed-79c2-45c0-9a3c-35419a4b072f'::uuid, 'ca3fcb8d-d94c-4965-b152-36a5026577a6'::uuid, '3609c8fa-1779-4be0-b60e-f8e66b08fe64'::uuid, '61c36963-d2c5-4136-83ff-130311eac04b'::uuid, date '2026-03-21', '26000246', 'ZDM5G01BGSB000619', 'SALMON TRADING COMPANY'),
      ('5e636b5d-a573-4942-93d9-b09f2d2b9ce9'::uuid, '89fc96b8-7752-40e5-8b66-fbac872f90c0'::uuid, 'd95491e3-d4cc-44e4-98e2-831e4467d2f9'::uuid, 'e435e4e1-12c8-484c-acce-b06ced279706'::uuid, date '2026-05-15', '26000547', 'ZDM1007BGTB009279', 'PCB CONSTRUCT')
    ) as x(vehicle, owner_row, bank, client, sale_date, facture, vin, nom_facture)
  loop
    -- La moto doit être celle d'ITALBIKE, avec ce VIN, et la banque encore propriétaire actuelle.
    perform 1 from public.vehicles v
     where v.id = r.vehicle and v.vin = r.vin and v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
       for update;
    if not found then raise exception 'moto introuvable : %', r.vin; end if;
    if not exists (select 1 from public.vehicle_owners vo
                    where vo.id = r.owner_row and vo.vehicle_id = r.vehicle and vo.contact_id = r.bank and vo.is_current) then
      raise exception 'la banque n''est plus propriétaire actuelle : %', r.vin;
    end if;
    if not exists (select 1 from public.contacts c
                    where c.id = r.client and c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33') then
      raise exception 'client introuvable : %', r.vin;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('owner_id', vo.id, 'contact_id', vo.contact_id,
                                                 'from_date', vo.from_date)), '[]'::jsonb)
      into _prev
      from public.vehicle_owners vo where vo.vehicle_id = r.vehicle and vo.is_current;

    update public.vehicle_owners vo
       set is_current = false, to_date = greatest(vo.from_date, r.sale_date)
     where vo.vehicle_id = r.vehicle and vo.is_current;

    insert into public.vehicle_owners (vehicle_id, contact_id, from_date, is_current)
    values (r.vehicle, r.client, r.sale_date, true);

    update public.vehicles
       set financing_contact_id = r.bank
     where id = r.vehicle and financing_contact_id is null;

    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values ('3d9f0f13-a691-4d07-ad58-34590df86e33', null, 'vehicle_owner_attached', 'vehicles', r.vehicle::text, 'migration',
            jsonb_build_object('current_owners', _prev),
            jsonb_build_object('contact_id', r.client, 'from_date', r.sale_date,
                               'reason', 'motard_au_lieu_banque_g8',
                               'facture_g8', r.facture, 'client_sur_facture', r.nom_facture,
                               'financing_contact_id', r.bank,
                               'migration', '20261126190000_m3_motard_proprietaire_au_lieu_banque'));
    _done := _done + 1;
  end loop;

  if _done <> 11 then raise exception 'attendu 11 motos, traité %', _done; end if;
end $$;
