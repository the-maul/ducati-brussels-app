-- M2 — Seed table d'arrondis (parité G8 : arrondi du PV à la tranche supérieure).
-- Stockée dans reference_values (table_key='rounding'). up_to=0 → tranche infinie.
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, 'rounding', d.code, d.label, d.sort_order, d.extra::jsonb
from public.companies c
cross join (values
  ('R1','PVTTC ≤ 50 €',1,'{"up_to":50,"step":0.05,"mode":"up"}'),
  ('R2','PVTTC > 50 €',2,'{"up_to":0,"step":0.5,"mode":"up"}')
) as d(code, label, sort_order, extra)
on conflict (company_id, table_key, code) do nothing;
