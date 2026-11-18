-- =====================================================================
-- Rattrapage G8 (19/11/2026) — lot « forfaits G8 » : TAUX DE MAIN-D'OEUVRE GARANTIE.
--
-- La migration 20261118130000 a PRECHARGE 46,94 € HT (MO_ATELIER GARANTIE de la base de FORMATION)
-- dans Parametres -> Tables -> Garantie atelier (reference_values, workshop_warranty / mo). La vraie
-- base G8 facture la garantie 83,00 € HT (« MO GARANTIE DWE », facturee a Ducati West Europe).
-- On aligne UNIQUEMENT si la valeur est encore celle du prechargement (46,94) : une valeur saisie
-- par le client n'est jamais ecrasee. Trace : declencheur audit_row de reference_values + events.
--
-- Non modifies (listes dans le rapport) : le taux horaire atelier (« Frais de devis atelier »,
-- DIAGNOSTIC, 90,00 € HT) a ete SAISI le 05/10 (prechargement d'origine : 0) ; l'article MO
-- (type T, 0 €) n'est pas un taux : sans prix, une ligne de MO prend le taux de l'atelier.
-- =====================================================================
do $$
declare r record;
begin
  for r in
    select v.* from public.reference_values v
     where v.table_key = 'workshop_warranty' and v.code = 'mo'
       and (v.extra ->> 'hourly_rate_ht')::numeric = 46.94
  loop
    update public.reference_values
       set extra = extra || jsonb_build_object('hourly_rate_ht', 83.00, 'source', 'G8 vraie base : MO GARANTIE DWE')
     where id = r.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (r.company_id, null, 'workshop_warranty_rate_g8', 'reference_values', r.id::text, 'migration',
            jsonb_build_object('hourly_rate_ht', 46.94),
            jsonb_build_object('hourly_rate_ht', 83.00, 'source', 'G8 vraie base : MO GARANTIE DWE'));
  end loop;
end $$;
