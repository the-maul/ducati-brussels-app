-- M8 (retour de Domenico, 23/11/2026) : le RDV n'a plus qu'un champ « Motif », le type s'en déduit.
-- Les deux types qui n'avaient pas de motif équivalent deviennent des motifs, pour ne perdre aucun choix.
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active)
select c.company_id, 'workshop_reason', v.code, v.label, v.sort_order, true
  from (select distinct company_id from public.reference_values where table_key = 'workshop_reason') c
 cross join (values
   ('preparation', 'Préparation / livraison moto', 102),
   ('carrosserie', 'Carrosserie / accessoires', 104)
 ) as v(code, label, sort_order)
on conflict (company_id, table_key, code) do nothing;
