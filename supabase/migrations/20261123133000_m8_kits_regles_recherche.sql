-- =====================================================================
-- M8 — ATE014 (23/11/2026) : LES KITS NE DOIVENT PROPOSER QUE LA BONNE PIECE, EN BONNE QUANTITE.
--
-- Trois regles de deduction corrigees. Cette migration NE TOUCHE AUCUN KIT : elle change seulement
-- ce que la deduction proposera ensuite. Les kits existants passent par les propositions validees
-- (migration suivante, maintenance_kit_proposals).
--
--  1. Courroie de distribution : uniquement sur un dessin de distribution. Plus de sangle de batterie
--     ou de selle, de courroie de roue arriere, de courroie de pompe ni de calibre de tension.
--     Le filtre passe par `drawing_re`, que `maintenance_engine_family_key` ne lit pas : la cle de
--     famille moteur des kits existants reste donc identique.
--  2. Joint de pompe a eau : un circlip (« BAGUE ELASTIQUE ARRET ») n'est pas un joint.
--  3. Quantites :
--       - un dessin present deux fois au catalogue (meme code, meme nom) ne compte qu'une fois ;
--         deux vues differentes (culasse verticale + horizontale) continuent de s'additionner ;
--       - huile moteur : volume « revision avec filtre », jamais « moteur a sec ». Si le manuel ne
--         donne que le volume a sec, la quantite reste vide (a completer).
--  4. Une operation « (uniquement XDiavel) » d'un manuel commun ne cree un besoin que sur XDiavel.
--
-- Rejouable. Retour arriere : restaurer les deux regles et la version precedente de la fonction
-- (migration 20261103200000 et suivantes).
-- =====================================================================

update public.maintenance_part_catalog_rules
   set drawing_re = 'DISTRIBUTION'
 where family_code = 'courroie_distribution'
   and drawing_re is distinct from 'DISTRIBUTION';

update public.maintenance_part_catalog_rules
   set exclude_re = '(OUTIL|BAGUE ELASTIQUE|ARRET)'
 where family_code = 'joint_pompe_eau'
   and exclude_re is distinct from '(OUTIL|BAGUE ELASTIQUE|ARRET)';

-- Le volume a retenir sur une ligne de ravitaillement du manuel.
create or replace function public._maintenance_fluid_service_volume(_quantites jsonb, _family text)
returns table(val numeric, unite text)
language sql
immutable
set search_path = public, pg_temp
as $$
  select (qt.value ->> 'valeur')::numeric, qt.value ->> 'unite'
    from jsonb_array_elements(coalesce(_quantites, '[]'::jsonb)) with ordinality as qt(value, ord)
   where qt.value ->> 'type' = 'volume'
     and (_family is distinct from 'huile_moteur'
          or lower(coalesce(qt.value ->> 'condition', '')) !~ '\msec\M')
   order by case
              when _family = 'huile_moteur'
               and lower(coalesce(qt.value ->> 'condition', '')) ~ '(r[ée]vision|remplacement|vidange|filtre)' then 0
              when qt.value ->> 'condition' is null then 1
              else 2
            end,
            qt.ord
   limit 1;
$$;

create or replace function public._maintenance_parts_for_needs(_model_year_id text, _needs jsonb, _fluid_manuals text[], _company uuid default null::uuid)
returns table(service_code text, family_code text, family_label text, kind text, optional boolean, references_ text[], quantity numeric, unit text, article_id uuid, article_ref text, designation text, fluid_product text, fluid_spec text, confidence text, matched_labels text[])
language plpgsql
stable security definer
set search_path = public, pg_temp
as $function$
begin
  return query
  with needs as (
    select x.sc, f.code as fc, f.label as fl, f.kind as fk,
           f.optional as fo, f.unit as fu, f.sort as fs, x.labels
      from jsonb_to_recordset(coalesce(_needs, '[]'::jsonb)) as x(sc text, fc text, labels text[])
      join public.maintenance_part_families f on f.code = x.fc
  ),
  -- un dessin en double au catalogue (meme code, meme nom, meme ligne) ne compte qu'une fois
  cat as (
    select distinct n.fc, coalesce(d.code, d.id::text) as drawing_key, upper(btrim(d.description)) as drawing_name,
           dl.position, dl.reference, greatest(coalesce(dl.quantity, 1), 1) as q, dl.description
      from (select distinct needs.fc from needs) n
      join public.maintenance_part_catalog_rules rc on rc.family_code = n.fc
      join public.ducati_catalog_model_year_drawings myd on myd.model_year_id = _model_year_id
      join public.ducati_catalog_drawings d on d.id = myd.drawing_id
      join public.ducati_catalog_drawing_lines dl on dl.drawing_id = d.id
     where upper(d.description) !~ 'OUTILS SPECIAUX'
       and upper(dl.description) ~ rc.include_re
       and (rc.exclude_re is null or upper(dl.description) !~ rc.exclude_re)
       and (rc.drawing_re is null or upper(d.description) ~ rc.drawing_re)
       and (rc.drawing_exclude_re is null or upper(d.description) !~ rc.drawing_exclude_re)
  ),
  cat_by_ref as (
    select cat.fc, cat.reference, sum(cat.q) as qty, (array_agg(cat.description))[1] as descr
      from cat group by cat.fc, cat.reference
  ),
  cat_mode as (
    select rc.family_code as fc, bool_or(rc.take_all) as take_all
      from public.maintenance_part_catalog_rules rc group by rc.family_code
  ),
  -- une ligne par reference, toujours ; `refs` = les references qui repondent au
  -- besoin (take_all : toutes necessaires, chacune est une piece a part entiere)
  cat_agg as (
    select b.fc, b.reference, b.qty, b.descr,
           case when m.take_all then array[b.reference]
                else array_agg(b.reference) over (partition by b.fc order by b.reference
                                                  rows between unbounded preceding and unbounded following) end as refs,
           case when m.take_all then 1::bigint else count(*) over (partition by b.fc) end as nrefs
      from cat_by_ref b join cat_mode m on m.fc = b.fc
  ),
  fluid as (
    select distinct on (n.fc)
           n.fc,
           ln ->> 'specification' as spec,
           coalesce((select string_agg(p, ', ') from jsonb_array_elements_text(coalesce(ln -> 'produits', '[]'::jsonb)) p), '') as produits,
           v.val,
           v.unite
      from (select distinct needs.fc from needs where needs.fk = 'consommable') n
      join public.maintenance_fluid_rules rf on rf.family_code = n.fc
      join public.wsm_fluid_tables ft on ft.manual_id = any(coalesce(_fluid_manuals, array[]::text[]))
      cross join lateral jsonb_array_elements(ft.lines) ln
      left join lateral public._maintenance_fluid_service_volume(ln -> 'quantites', n.fc) v on true
     where lower(ln ->> 'element') ~ rf.element_re
     order by n.fc, (v.val is not null) desc, ft.sort
  )
  select n.sc, n.fc, n.fl, n.fk, n.fo,
         case when n.fk = 'piece' then ca.refs else null end,
         case when n.fk = 'piece' then ca.qty::numeric else f.val end,
         case when n.fk = 'piece' then null else coalesce(f.unite, n.fu) end,
         al.aid,
         case when n.fk = 'piece' then ca.reference else null end,
         case when n.fk = 'piece' then coalesce(al.designation, ca.descr, n.fl) else n.fl end,
         nullif(f.produits, ''),
         f.spec,
         case
           when n.fk = 'consommable' then
             case when _fluid_manuals is null or cardinality(_fluid_manuals) = 0 then 'a_confirmer'
                  when f.fc is null then 'absent'
                  when f.val is null and nullif(f.produits, '') is null and f.spec is null then 'absent'
                  else 'sur' end
           when ca.fc is null then case when n.fo then 'non_applicable' else 'absent' end
           when ca.nrefs > 1 then 'a_confirmer'          -- plusieurs references : on les garde toutes (M-90)
           when al.aid is null then 'a_confirmer'        -- reference connue, article du DMS a designer
           else 'sur'
         end,
         n.labels
    from needs n
    left join cat_agg ca on ca.fc = n.fc and n.fk = 'piece'
    left join fluid f on f.fc = n.fc
    left join lateral (
      select a.id as aid, a.designation
        from public.articles a
       where n.fk = 'piece' and ca.reference is not null
         and (_company is null or a.company_id = _company)
         and upper(btrim(a.reference)) = upper(btrim(ca.reference))
       order by a.created_at
       limit 1) al on true
   order by n.sc, n.fs, ca.reference;
end $function$;

revoke all on function public._maintenance_fluid_service_volume(jsonb, text) from public, anon, authenticated;

-- « Remplacement des bougies (uniquement XDiavel) » : vrai si le manuel est celui d'un modele cite.
-- Une restriction qu'on ne sait pas lire (« uniquement version ... ») ne retire aucun besoin.
create or replace function public._maintenance_label_applies(_label text, _model text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  with m as (
    select (regexp_match(lower(coalesce(_label, '')), 'uniquement\s+([^)]*)'))[1] as scope,
           regexp_split_to_array(btrim(regexp_replace(lower(coalesce(_model, '')), '[^a-z0-9]+', ' ', 'g')), ' ') as words
  )
  select case
           when m.scope is null or m.scope ~ '(version|ducati|service|model)' then true
           else exists (
             select 1
               from regexp_split_to_table(m.scope, '\s*,\s*|\s+et\s+') as tok
              where btrim(tok) <> ''
                and regexp_split_to_array(btrim(regexp_replace(tok, '[^a-z0-9]+', ' ', 'g')), ' ') <@ m.words)
         end
    from m;
$$;

create or replace function public._maintenance_manual_needs(_model_year_id text, _service_code text default null::text)
returns jsonb
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('sc', z.sc, 'fc', z.fc, 'labels', z.labels)), '[]'::jsonb)
    from (
      select so.service_code as sc, r.family_code as fc, array_agg(distinct so.label) as labels
        from public.wsm_manual_catalog_links l
        join public.wsm_manuals wm on wm.id = l.manual_id
        join public.wsm_service_operation_labels so on so.manual_id = l.manual_id
        join public.maintenance_part_need_rules r on so.label ~ r.pattern
       where l.model_year_id = _model_year_id and l.status = 'lie'
         and (_service_code is null or so.service_code = _service_code)
         and public._maintenance_label_applies(so.label, wm.model)
       group by 1, 2) z;
$$;

revoke all on function public._maintenance_label_applies(text, text) from public, anon, authenticated;
