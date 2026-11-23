-- M8 (Domenico et Simon, 23/11/2026) : à l'entretien on change le joint du bouchon de vidange, pas le
-- bouchon. Le DMS proposait le bouchon entier, trouvé par son nom sur le dessin. Aucune source fiable
-- ne donne le joint de chaque moto : la ligne reste, sans référence, « à compléter ».
-- Chaque kit garde sa version précédente (maintenance_kit_versions).
do $mig$
declare r record;
begin
  update public.maintenance_part_families set label = 'Joint de bouchon de vidange', updated_at = now()
   where code = 'bouchon_vidange';
  update public.maintenance_part_catalog_rules set include_re = '^JOINT,? (DE )?BOUCHON (DE )?VIDANGE'
   where family_code = 'bouchon_vidange';

  for r in
    select distinct i.kit_id
      from public.maintenance_kit_items i join public.maintenance_kits k on k.id = i.kit_id
     where k.status = 'actif' and i.family_code = 'bouchon_vidange' and i.origin = 'deduit' and i.confidence <> 'absent'
  loop
    update public.maintenance_kit_items i
       set provenance = coalesce(i.provenance, '{}'::jsonb)
             || jsonb_build_object('reference', null, 'ancienne_reference', i.reference),
           article_id = null, reference = null, catalog_refs = null,
           designation = 'JOINT DE BOUCHON DE VIDANGE', confidence = 'absent',
           note = 'Référence à compléter : joint du bouchon de vidange.'
     where i.kit_id = r.kit_id and i.family_code = 'bouchon_vidange' and i.origin = 'deduit';
    update public.maintenance_kits
       set version = version + 1, edited_at = now(), updated_at = now()
     where id = r.kit_id;
    perform public._maintenance_kit_snapshot(r.kit_id, 'joint du bouchon de vidange a completer');
  end loop;
end $mig$;
