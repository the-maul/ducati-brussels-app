-- =====================================================================
-- M8 ATE015 — Liquide de frein et huile de fourche : flacon de 1 l par defaut (decision Q50, 19/11).
--
-- Le lot forfaits G8 avait suppose des flacons de 0,5 l (arrondi au flacon superieur). Le client
-- fixe 1 l par defaut, modifiable dans Atelier > Kits > Reglages des kits (liquide -> article).
--   1. Catalogue d'installation (_g8_fluid_articles_catalog) : 1 l pour fourche et frein.
--   2. Reglage des societes encore sur la valeur supposee (flacon 0,5 l) : passe a 1 l, trace.
--   3. Lignes de kits deja rattachees (quantite sure, litres connus) : quantite recalculee,
--      kit versionne (maintenance_kit_versions). Les lignes « a confirmer » restent a 1.
-- Idempotente.
-- =====================================================================

create or replace function public._g8_fluid_articles_catalog()
returns table(family_code text, reference text, sale_unit text, liters_per_unit numeric, whole_units boolean)
language sql immutable as $$
  select v.family_code::text, v.reference::text, v.sale_unit::text, v.liters_per_unit::numeric, v.whole_units::boolean from (values
    ('huile_moteur', 'MOTO 4XT TECH EN FUT', 'l', 1, false),
    ('huile_fourche', 'HUILE DE FOURCHE ELF', 'flacon', 1, true),
    ('liquide_frein', 'HUILE DE FREIN DOT 5', 'flacon', 1, true),
    ('liquide_refroidissement', 'COOLELF CLASSIC -26°', 'l', 1, false)
  ) v(family_code, reference, sale_unit, liters_per_unit, whole_units);
$$;

do $m$
declare r record; k uuid; n_map int := 0; n_lines int := 0; n_kits int := 0;
begin
  for r in
    select * from public.maintenance_fluid_articles
     where family_code in ('huile_fourche', 'liquide_frein') and liters_per_unit = 0.5 and whole_units
  loop
    update public.maintenance_fluid_articles set liters_per_unit = 1, updated_at = now() where company_id = r.company_id and family_code = r.family_code;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (r.company_id, null, 'maintenance_fluid_mapping_save', 'maintenance_fluid_articles', r.family_code,
            'migration 20261119144000 (Q50)', jsonb_build_object('liters_per_unit', 0.5),
            jsonb_build_object('liters_per_unit', 1));
    n_map := n_map + 1;
  end loop;

  for k in
    select distinct i.kit_id
      from public.maintenance_kit_items i
      join public.maintenance_fluid_articles fa on fa.company_id = i.company_id and fa.family_code = i.family_code
     where i.family_code in ('huile_fourche', 'liquide_frein') and i.confidence = 'sur'
       and fa.liters_per_unit > 0 and fa.whole_units
       and (i.provenance -> 'liquide' ->> 'litres') is not null
       and i.quantity <> ceil(round((i.provenance -> 'liquide' ->> 'litres')::numeric / fa.liters_per_unit, 6))
  loop
    update public.maintenance_kit_items i
       set quantity = ceil(round((i.provenance -> 'liquide' ->> 'litres')::numeric / fa.liters_per_unit, 6))
      from public.maintenance_fluid_articles fa
     where i.kit_id = k and fa.company_id = i.company_id and fa.family_code = i.family_code
       and i.family_code in ('huile_fourche', 'liquide_frein') and i.confidence = 'sur'
       and fa.liters_per_unit > 0 and fa.whole_units
       and (i.provenance -> 'liquide' ->> 'litres') is not null;
    get diagnostics n_lines = row_count;
    perform public._maintenance_kit_bump(k, 'flacon 1 l frein / fourche (Q50)');
    n_kits := n_kits + 1;
  end loop;
  raise notice 'Q50 : % reglage(s) passes a 1 l, % kit(s) recalcules', n_map, n_kits;
end $m$;
