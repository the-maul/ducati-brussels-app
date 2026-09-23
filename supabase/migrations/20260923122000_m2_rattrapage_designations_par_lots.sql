-- =====================================================================
-- Rattrapage des désignations : ne reprendre que ce qui a vraiment quelque chose à compléter.
--
-- Constat du 23/09 (chargement réel) : la fonction prenait 500 articles « candidats » par lot, mais
-- beaucoup n'avaient rien à compléter (ni taille, ni couleur, ni version, ni catégorie chez Ducati).
-- Ces articles revenaient à chaque lot, le compteur retombait à 0 et la boucle s'arrêtait : seuls
-- 208 articles sur ~5 700 avaient été complétés.
--
-- Correctif : le lot ne contient plus que des articles dont au moins un champ va changer, et une
-- seule ligne par article (une référence peut appartenir à plusieurs produits Ducati).
-- Même signature, même garde-fous (article de librairie, marque Ducati, jamais retouché à l'écran ;
-- ni prix ni stock touchés ; relançable). Rien n'est écrit par la migration.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.ducati_products_repair_designations(_company uuid, _limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n int := 0;
begin
  if not public._article_links_can_write(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  with cand as (
    -- une seule ligne par article (une même référence peut appartenir à plusieurs produits Ducati)
    select distinct on (a.id) a.id, a.designation,
           btrim(concat_ws(' — ', coalesce(nullif(btrim(v.name), ''), pr.name, v.sku),
                           nullif(concat_ws(' / ', nullif(btrim(regexp_replace(v.size, '\s+', ' ', 'g')), ''), nullif(btrim(regexp_replace(v.color, '\s+', ' ', 'g')), ''),
                                            nullif(btrim(regexp_replace(v.attributes ->> 'version', '\s+', ' ', 'g')), '')), ''))) as designation_new,
           nullif(btrim(regexp_replace(v.size, '\s+', ' ', 'g')), '') as size_new, nullif(btrim(regexp_replace(v.color, '\s+', ' ', 'g')), '') as color_new,
           nullif(concat_ws(' · ', nullif(pr.category_label, ''), nullif(pr.gender, ''),
                            case when v.collection_year is not null then 'collection ' || v.collection_year end,
                            case when coalesce(array_length(pr.family_codes, 1), 0) > 0
                                 then array_to_string(pr.family_codes, ', ') end,
                            case when v.attributes ->> 'partStatus' = 'F' then 'hors production (Ducati)' end), '') as note_new
      from public.articles a
      join public.article_links l on l.company_id = a.company_id and l.article_id = a.id
       and l.target_kind = 'ducati_product' and l.status = 'lie'
      join public.ducati_catalog_product_variants v on v.sku_norm = l.target_ref
      join public.ducati_catalog_products pr on pr.code = v.product_code
     where a.company_id = _company and a.is_library and a.brand = 'Ducati'
       and a.size is null and a.color is null and a.note is null
       -- il faut qu'il y ait quelque chose à compléter, sinon le même lot revient sans fin
       and (nullif(btrim(regexp_replace(v.size, '\s+', ' ', 'g')), '') is not null or nullif(btrim(regexp_replace(v.color, '\s+', ' ', 'g')), '') is not null
            or nullif(btrim(regexp_replace(v.attributes ->> 'version', '\s+', ' ', 'g')), '') is not null
            or nullif(pr.category_label, '') is not null or nullif(pr.gender, '') is not null
            or v.collection_year is not null or coalesce(array_length(pr.family_codes, 1), 0) > 0
            or v.attributes ->> 'partStatus' = 'F')
       -- désignation encore celle du catalogue (jamais retouchée à l'écran)
       and a.designation = coalesce(nullif(btrim(v.name), ''), pr.name, v.sku)
     order by a.id, pr.code
     limit greatest(coalesce(_limit, 5000), 1)
  ), up as (
    update public.articles a
       set designation = c.designation_new, size = c.size_new, color = c.color_new, note = c.note_new
      from cand c
     where a.id = c.id
       and (c.designation_new, c.size_new, c.color_new, c.note_new) is distinct from (a.designation, a.size, a.color, a.note)
    returning a.id)
  select count(*) into n from up;

  if n > 0 then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'article_catalog_details', 'articles', _company::text,
            case when auth.uid() is null then 'system' else 'import' end, null,
            jsonb_build_object('completes', n));
  end if;
  return jsonb_build_object('completes', n);
end $function$;
