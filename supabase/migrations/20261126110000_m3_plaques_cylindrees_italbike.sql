-- M3 (Simon, 26/11/2026) : nettoyage des plaques et des cylindrées arrondies, ITALBIKE STORE uniquement.
-- Rien d'autre n'est touché (autres colonnes, autres sociétés, société d'essai ItalTest).
-- Chaque fiche modifiée est tracée par le déclencheur d'audit (events, ancien/nouveau) ; un event
-- récapitulatif « data_cleanup » liste aussi ce qui n'a PAS été corrigé et pourquoi.
--
-- 1) Plaques : majuscules, lettres et chiffres seulement (« 1-ABC-123 » → « 1ABC123 »), si le résultat
--    fait exactement 7 caractères. Plaque personnalisée (plate_custom) : jamais touchée. Résultat de
--    longueur différente : laissé tel quel et listé.
-- 2) Cylindrées : seulement les motos Ducati dont la valeur est arrondie (multiple de 50) ou recopiée
--    du nom commercial (1199, 1260, 1299, 939…), et seulement avec une source pour CETTE moto :
--      - règle Simon : 1199/1200 → 1198 quand le modèle lié (ou le modèle de la fiche) est une 1199/1200 ;
--      - catalogue : cylindrée du modèle-année lié (ducati_vin_model_specs) ET code du numéro moteur
--        (ZDM937…, ZDM1262…) qui donnent la même valeur exacte ;
--      - catalogue seul : valeur exacte non contredite par le numéro moteur et qui n'est pas elle-même
--        le nom commercial d'un modèle Ducati (939, 959, 1098… sont des noms, pas des cylindrées sûres).
--    « Exacte » = ni multiple de 50, ni nombre du nom commercial du modèle. Écart maximum : 25 cm³.
--    Sources en désaccord, numéro moteur seul ou aucune source : rien n'est écrit (« à compléter »).

drop table if exists _m3_plate_fix, _m3_disp;
create temp table _m3_plate_fix as
select v.id, v.vin, v.plate as old_plate, upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g')) as new_plate,
       coalesce(v.plate_custom, false) as custom
  from public.vehicles v
 where v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
   and v.plate is not null
   and v.plate <> upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g'));

create temp table _m3_disp as
with names as (
  select distinct n from (
    select (regexp_matches(coalesce(description, ''), '(\d{3,4})', 'g'))[1]::numeric n from public.ducati_catalog_models
    union all select (regexp_matches(coalesce(name, ''), '(\d{3,4})', 'g'))[1]::numeric from public.ducati_catalog_model_years
    union all select (regexp_matches(coalesce(description, ''), '(\d{3,4})', 'g'))[1]::numeric from public.ducati_catalog_supermodels
  ) z
), v as (
  select v.id, v.vin, v.model, v.displacement d, s.displacement_cc spec, m.description mdesc,
         substring(upper(coalesce(v.engine_number, '')) from '^\s*(?:ZDM|DPT|ML0)\s*(\d{3,4})')::numeric ecode,
         array(select (regexp_matches(coalesce(m.description, '') || ' ' || coalesce(y.name, '') || ' '
                 || coalesce(sm.description, '') || ' ' || coalesce(v.model, ''), '(\d{3,4})', 'g'))[1]::numeric) nn
    from public.vehicles v
    left join public.ducati_catalog_model_years y on y.id = v.ducati_model_year_id
    left join public.ducati_catalog_models m on m.id = y.model_id
    left join public.ducati_catalog_supermodels sm on sm.id = m.supermodel_id
    left join public.ducati_vin_model_specs s on s.model_year_id = v.ducati_model_year_id
   where v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
     and upper(btrim(coalesce(v.brand, ''))) = 'DUCATI'
     and v.displacement is not null
), w as (
  select v.*,
    case when spec % 50 <> 0 and not (spec = any(nn)) then spec end s_ok,
    case when ecode % 50 <> 0 and not (ecode = any(nn)) then ecode end e_ok,
    case when d in (1199, 1200) and (1199 = any(nn) or 1200 = any(nn)) then 1198::numeric end r_ok
  from v
  where d % 50 = 0 or d = any(nn)
), c as (
  select w.*,
    (select count(distinct x) from unnest(array[s_ok, e_ok, r_ok]) x where x is not null) nsrc,
    (select min(x) from unnest(array[s_ok, e_ok, r_ok]) x) t
  from w
)
select c.id, c.vin, c.model, c.mdesc, c.d as old_disp, c.t as new_disp,
  concat_ws('+', case when s_ok is not null then 'catalogue' end, case when e_ok is not null then 'numero_moteur' end,
            case when r_ok is not null then 'regle_1198' end) as source,
  case
    when nsrc = 0 and d % 50 = 0 then 'arrondie_sans_source'
    when nsrc = 0 then 'nom_commercial_sans_source'
    when nsrc > 1 then 'sources_discordantes'
    when t = d then 'deja_exacte'
    when abs(t - d) > 25 then 'ecart_trop_grand'
    when ecode is not null and abs(ecode - t) > 60 then 'numero_moteur_contredit'
    when r_ok is not null then 'corriger'
    when s_ok is not null and e_ok is not null then 'corriger'
    when s_ok is not null and not (t in (select n from names)) then 'corriger'
    when s_ok is not null then 'catalogue_seul_nom_commercial'
    else 'numero_moteur_seul'
  end as verdict
from c;

update public.vehicles v
   set plate = f.new_plate
  from _m3_plate_fix f
 where v.id = f.id and not f.custom and f.new_plate ~ '^[A-Z0-9]{7}$';

update public.vehicles v
   set displacement = x.new_disp
  from _m3_disp x
 where v.id = x.id and x.verdict = 'corriger' and v.displacement = x.old_disp;

insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
select '3d9f0f13-a691-4d07-ad58-34590df86e33', null, 'data_cleanup', 'vehicles', '20261126110000_m3_plaques_cylindrees_italbike', 'import', null,
  jsonb_build_object(
    'rule', 'Plaques : majuscules, lettres et chiffres, 7 caractères (sauf personnalisée). Cylindrées arrondies : corrigées seulement avec une source pour la moto (règle 1199/1200 = 1198, catalogue Ducati du modèle-année, numéro moteur).',
    'plates_cleaned', (select count(*) from _m3_plate_fix where not custom and new_plate ~ '^[A-Z0-9]{7}$'),
    'plates_custom_untouched', (select count(*) from _m3_plate_fix where custom),
    'plates_left', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'vin', vin, 'plate', old_plate) order by old_plate), '[]'::jsonb)
                      from _m3_plate_fix where not custom and new_plate !~ '^[A-Z0-9]{7}$'),
    'displacement_fixed', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'vin', vin, 'old', old_disp, 'new', new_disp, 'source', source)), '[]'::jsonb)
                             from _m3_disp where verdict = 'corriger'),
    'displacement_left', (select coalesce(jsonb_object_agg(verdict, n), '{}'::jsonb)
                            from (select verdict, count(*) n from _m3_disp where verdict not in ('corriger', 'deja_exacte') group by 1) z)
  );

drop table _m3_plate_fix, _m3_disp;
