-- =====================================================================
-- M3 (Simon, 26/11/2026) : « ok lie le ».
-- Suite de 20261126190000_m3_motard_proprietaire_au_lieu_banque : la Multistrada 1260 S
-- ZDMAC02FAJB004796 (facture G8 20190234 du 05/04/2019, adressée à CBC Banque sans nom de client)
-- passe à FRITS PIERRE (code 2115). Indice : sa plaque MBAM758 est reprise sur sa moto suivante
-- (Multistrada V4 S, factures 2023-2026 à son nom). Validé par Simon le 26/11/2026.
--   * la ligne « CBC Banque propriétaire » est close (to_date = 05/04/2019, is_current = false), rien
--     n'est supprimé ;
--   * FRITS PIERRE devient propriétaire actuel au 05/04/2019 ;
--   * CBC Banque reste l'organisme payeur (financing_contact_id) ;
--   * trace dans `events` (vehicle_owner_attached), mêmes étapes que vehicle_attach_owner
--     (qui exige un utilisateur connecté), origin = 'migration'.
-- Aucun contact n'est créé.
-- =====================================================================

do $$
declare
  _vehicle constant uuid := 'd460a1d1-1635-473c-8374-7e6dc047a57e';
  _owner_row constant uuid := '25786dc9-8b20-4266-9f52-362c0d392cb0';
  _bank constant uuid := '066a52c8-efce-4955-ad6f-864e220509ce';
  _client constant uuid := 'c3eb4356-af13-49cc-9b27-f94083c34c9c';
  _from constant date := date '2019-04-05';
  _prev jsonb;
begin
  perform 1 from public.vehicles v
   where v.id = _vehicle and v.vin = 'ZDMAC02FAJB004796'
     and v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
     for update;
  if not found then raise exception 'moto introuvable : ZDMAC02FAJB004796'; end if;
  if not exists (select 1 from public.vehicle_owners vo
                  where vo.id = _owner_row and vo.vehicle_id = _vehicle and vo.contact_id = _bank and vo.is_current) then
    raise exception 'CBC Banque n''est plus propriétaire actuelle : ZDMAC02FAJB004796';
  end if;
  if not exists (select 1 from public.contacts c
                  where c.id = _client and c.code = '2115' and c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33') then
    raise exception 'client FRITS PIERRE (2115) introuvable';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('owner_id', vo.id, 'contact_id', vo.contact_id,
                                               'from_date', vo.from_date)), '[]'::jsonb)
    into _prev
    from public.vehicle_owners vo where vo.vehicle_id = _vehicle and vo.is_current;

  update public.vehicle_owners vo
     set is_current = false, to_date = greatest(vo.from_date, _from)
   where vo.vehicle_id = _vehicle and vo.is_current;

  insert into public.vehicle_owners (vehicle_id, contact_id, from_date, is_current)
  values (_vehicle, _client, _from, true);

  update public.vehicles
     set financing_contact_id = _bank
   where id = _vehicle and financing_contact_id is null;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', null, 'vehicle_owner_attached', 'vehicles', _vehicle::text, 'migration',
          jsonb_build_object('current_owners', _prev),
          jsonb_build_object('contact_id', _client, 'from_date', _from,
                             'reason', 'plaque MBAM758 reprise sur sa moto suivante, validé par Simon 26/11',
                             'facture_g8', '20190234',
                             'financing_contact_id', _bank,
                             'migration', '20261126210000_m3_frits_pierre_multistrada'));
end $$;
