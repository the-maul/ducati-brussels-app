-- =====================================================================
-- Correctif lot-verif-parcours (20/11/2026) — parcours G8 n° 16 « Dépôt-vente : vente ».
--
-- QUOI : le déclencheur du registre des véhicules sur les dépôts-ventes
--        (_vehicle_register_on_consignment, migration 20261103190000) lisait la facture de vente
--        dans une variable `record` qui n'était remplie QUE s'il y avait une facture acquéreur.
-- POURQUOI : la vente d'un dépôt SANS facture acquéreur — exactement le parcours G8 testé
--        (« Règlement dépôt vente » = mouvement de caisse 02, réglage « buyer_invoice = non » ou case
--        décochée à l'écran) — échouait entièrement : « record "doc" is not assigned yet ». La
--        transaction de vente (consignment_sell) était annulée : ni moto vendue, ni encaissement.
-- CORRECTIF : même fonction, mêmes règles (sortie du registre à la date de la facture, sinon de la
--        vente, avec la facture ou le motif « facture à inscrire »), variables simples au lieu du
--        record. Aucune donnée touchée. Idempotente (create or replace).
-- Essai : supabase/tests/parcours_g8_16_depot_vente_vente.sql (partie B, PRE_SQL).
-- =====================================================================
create or replace function public._vehicle_register_on_consignment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _doc_number text; _doc_date date;
begin
  if tg_op = 'INSERT' then
    if new.vehicle_id is not null then
      perform public._vehicle_register_insert(new.company_id, coalesce(new.created_at::date, current_date), new.vehicle_id,
                                              null, null, new.depositor_id, '4', 'depot', new.id,
                                              'Depot-vente ' || coalesce(new.number, ''), false, null, 'screen');
    end if;
    return new;
  end if;
  if old.vehicle_id is null and new.vehicle_id is not null and new.status = 'en_depot' then
    perform public._vehicle_register_insert(new.company_id, coalesce(new.created_at::date, current_date), new.vehicle_id,
                                            null, null, new.depositor_id, '4', 'depot', new.id,
                                            'Depot-vente ' || coalesce(new.number, ''), false, null, 'screen');
  end if;
  if new.status = 'vendu' and old.status is distinct from 'vendu' then
    if new.sale_document_id is not null then
      select d.number, d.issue_date into _doc_number, _doc_date from public.documents d where d.id = new.sale_document_id;
    end if;
    perform public._vehicle_register_exit(new.company_id, 'depot', new.id, coalesce(_doc_date, new.sold_at::date, current_date),
                                          new.sale_document_id, _doc_number,
                                          case when new.sale_document_id is null then 'Depot-vente vendu : facture a inscrire' end, null, 'screen');
  elsif new.status = 'restitue' and old.status is distinct from 'restitue' then
    perform public._vehicle_register_exit(new.company_id, 'depot', new.id, current_date, null, null,
                                          'Restitution au deposant : aucune vente, aucun document', null, 'screen');
  end if;
  return new;
end $$;
revoke all on function public._vehicle_register_on_consignment() from public, anon, authenticated;
