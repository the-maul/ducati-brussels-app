-- =====================================================================
-- M8 — Frais de devis atelier (mission 02, process-commandes-pieces §1.4 et §4 point 8).
-- Quand un devis de pièces vient de l'atelier : accident = 125 € HTVA fixe ;
-- diagnostic = tarif horaire de l'atelier, 4 h maximum, sans nouveau devis.
-- Paramètres par société dans reference_values (table_key = 'workshop_quote_fee'),
-- modifiables dans Paramètres → Tables → Frais de devis atelier.
-- hourly_rate_ht = 0 : le DMS reprend le prix de vente de l'article « MO » (main-d'œuvre, type T).
-- Additif uniquement : valeurs par défaut, aucune donnée existante modifiée.
-- Les nouvelles sociétés les reçoivent via create_company (copie des référentiels).
-- =====================================================================
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, d.table_key, d.code, d.label, d.sort_order, d.extra::jsonb
from public.companies c
cross join (values
  ('workshop_quote_fee', 'accident',   'Frais de devis accident',            1, '{"amount_ht":125,"vat_rate":21}'),
  ('workshop_quote_fee', 'diagnostic', 'Diagnostic au tarif horaire atelier', 2, '{"hourly_rate_ht":0,"max_hours":4,"vat_rate":21}')
) as d(table_key, code, label, sort_order, extra)
on conflict (company_id, table_key, code) do nothing;
