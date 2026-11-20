-- =====================================================================
-- Correctif lot-verif-parcours (20/11/2026) — parcours G8 n° 3 (reprise) et n° 14 (moto neuve).
--
-- QUOI : quand une moto ENTRE en stock et est inscrite au registre des véhicules (livre de police :
--        reprise validée, châssis neuf reçu, dépôt-vente, inscription manuelle), son numéro
--        d'ordre (AAAA-0001) est recopié sur la fiche moto (vehicles.police_book_number) si la fiche
--        n'en a pas encore.
-- POURQUOI : G8 attribue le n° de livre de police AUTOMATIQUEMENT à la reprise (« Fiche de reprise »,
--        onglet Produit fini) et l'affiche sur la fiche produit fini (bloc Stock) et dans la recherche
--        parc. Le DMS inscrivait bien la moto au registre (20261103190000, ligne code 4 / VN) mais
--        laissait le champ « N° livre de police » de la fiche moto vide (seul le dépôt-vente le
--        recopiait, 20261118270000) : le numéro n'était visible que dans l'écran du registre.
-- RÈGLES : append-only respecté (le registre n'est pas touché ; la fiche moto n'est complétée que si
--        le champ est vide, jamais écrasée) ; lignes de reprise d'historique (is_backfill) et lignes
--        d'atelier (source « or ») ignorées ; trace events par le déclencheur d'audit de vehicles.
-- Idempotente (create or replace / drop trigger if exists). Aucune donnée existante modifiée.
-- Essais : supabase/tests/parcours_g8_03_reprise_moto_particulier.sql,
--          supabase/tests/parcours_g8_14_moto_neuve_chassis.sql (PRE_SQL).
-- =====================================================================
create or replace function public._vehicle_register_fill_police_book()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.vehicle_id is not null and not new.is_backfill and not new.is_void and new.rectifies_id is null
     and new.source in ('reprise', 'reception', 'depot', 'manuel') then
    update public.vehicles
       set police_book_number = new.year::text || '-' || lpad(new.seq::text, 4, '0')
     where id = new.vehicle_id
       and nullif(btrim(coalesce(police_book_number, '')), '') is null;
  end if;
  return null;
end $$;
revoke all on function public._vehicle_register_fill_police_book() from public, anon, authenticated;

drop trigger if exists trg_vehicle_register_fill_police_book on public.vehicle_register;
create trigger trg_vehicle_register_fill_police_book
  after insert on public.vehicle_register
  for each row execute function public._vehicle_register_fill_police_book();

comment on function public._vehicle_register_fill_police_book() is
  'Parcours G8 3 / 14 : n° de livre de police (registre des vehicules AAAA-0001) recopie sur la fiche moto a l entree en stock, si vide.';
