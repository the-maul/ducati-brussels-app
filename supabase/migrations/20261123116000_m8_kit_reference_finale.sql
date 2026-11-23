-- =====================================================================
-- M8 — Retour de Domenico (23/11/2026) : LE KIT D'ENTRETIEN PREND LA DERNIERE REFERENCE.
-- ATE013 B8. Exemple : 44440035A (epuisee) -> 44440037A -> 44440038A -> 44440039A -> 44440031C.
--
-- Avant : le RDV reservait l'ancienne reference, impossible a commander. Maintenant le kit suit la
-- chaine de remplacement (article_final_replacement) au moment de la lecture.
--  - les kits enregistres ne sont pas reecrits ;
--  - la nouvelle reference doit etre active, de la meme societe et du meme type de gestion ; sinon
--    la ligne garde sa reference d'origine ;
--  - si deux lignes menent a la meme reference finale, elles n'en font qu'une (regle existante).
--
-- Rejouable. Essai a blanc : supabase/tests/m8_kit_reference_finale.sql.
-- =====================================================================
create or replace function public._workshop_service_kit_items(_company uuid, _model_year text, _service text)
returns table(kit_item_id uuid, kit_id uuid, service_kind text, family_code text, article_id uuid, reference text,
              designation text, quantity numeric, unit text, kind text, confidence text, sort_order integer)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with kits as (
    select c.code, c.ord, public._workshop_kit_for(_company, _model_year, c.code) as kid
      from unnest(public._workshop_service_kit_codes_for(_company, _model_year, _service)) with ordinality as c(code, ord)
     where _company is not null and _model_year is not null
  ), base as (
    select i.id as iid, k.kid, k.code, k.ord, i.family_code as fam,
           coalesce(i.article_id, fa.article_id) as raw_aid,
           coalesce(nullif(btrim(i.reference), ''), a.reference) as raw_ref,
           nullif(upper(btrim(coalesce(i.reference, ''))), '') as key_ref,
           i.designation as raw_des, i.quantity as qty, i.unit as un, i.kind as knd, i.confidence as conf,
           i.sort_order as so, a.mgmt_type::text as mgmt
      from kits k
      join public.maintenance_kit_items i on i.kit_id = k.kid
      left join public.maintenance_fluid_articles fa
             on i.article_id is null and fa.company_id = _company and fa.family_code = i.family_code
      left join public.articles a on a.id = coalesce(i.article_id, fa.article_id)
     where k.kid is not null
       and i.kind <> 'forfait'           -- ligne de service G8 (F / T) : pas une piece
  ), items as (
    select b.iid, b.kid, b.code, b.ord, b.fam,
           coalesce(f.id, b.raw_aid) as aid,
           case when f.id is not null then f.reference else b.raw_ref end as ref,
           case when f.id is not null then coalesce(f.designation, b.raw_des) else b.raw_des end as des,
           b.qty, b.un, b.knd, b.conf, b.so,
           coalesce(coalesce(f.id, b.raw_aid)::text, b.key_ref, 'fam:' || b.fam, 'des:' || lower(btrim(b.raw_des))) as dkey
      from base b
      left join lateral (
        select n.id, n.reference, n.designation
          from public.articles n
         where b.raw_aid is not null
           and n.id = public.article_final_replacement(b.raw_aid)
           and n.id <> b.raw_aid
           and n.company_id = _company
           and coalesce(n.is_active, true)
           and n.mgmt_type::text = b.mgmt
      ) f on true
  )
  select distinct on (items.dkey)
         items.iid, items.kid, items.code, items.fam, items.aid, items.ref, items.des,
         items.qty, items.un, items.knd, items.conf, items.so
    from items
   order by items.dkey, items.qty desc, items.ord;
$$;
