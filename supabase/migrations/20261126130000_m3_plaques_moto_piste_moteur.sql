-- M3 (décisions de Simon du 26/11/2026, suite au nettoyage 20261126110000), ITALBIKE STORE uniquement.
-- Rien d'autre n'est touché (autres colonnes, autres sociétés, société d'essai ItalTest).
-- Chaque fiche modifiée est tracée par le déclencheur d'audit (events, ancien/nouveau) + un event
-- récapitulatif « data_cleanup ».
--
-- 1) Nouveau champ « Moto piste » (vehicles.is_track_bike) : une moto piste n'a pas de plaque.
-- 2) Plaques laissées le 26/11 (texte avec tirets/espaces qui ne faisait pas 7 caractères) :
--    - 6 caractères (anciennes plaques, « MAI-202 ») et 8 caractères (plaques françaises,
--      « 378-NHR-75 ») : gardées sans tirets ni espaces, en majuscules (« MAI202 », « 378NHR75 ») ;
--    - « MOTO PISTE » : plaque vidée et case « Moto piste » cochée ;
--    - le reste (« M- » seul, 5 caractères, « / », textes qui ne sont pas des plaques) : plaque vidée.
--    Plaque personnalisée (plate_custom) : jamais touchée.
-- 3) Cylindrées : Simon accepte le numéro moteur gravé comme source. Les motos dont seule cette source
--    donne la cylindrée exacte (« numero_moteur_seul » du 26/11) la reçoivent. Les sources en désaccord
--    et les écarts de plus de 25 cm³ restent inchangés.

alter table public.vehicles add column if not exists is_track_bike boolean not null default false;
comment on column public.vehicles.is_track_bike is
  'Moto piste (Simon, 26/11/2026) : moto de circuit, sans plaque d''immatriculation ; filtre « Moto piste » de la liste des motos.';

drop table if exists _m3_plate2, _m3_disp2;
create temp table _m3_plate2 as
select v.id, v.vin, v.plate as old_plate, upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g')) as clean,
  case
    when upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g')) = 'MOTOPISTE' then 'moto_piste'
    when length(upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g'))) in (6, 8) then 'sans_tirets'
    else 'vider'
  end as action
  from public.vehicles v
 where v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
   and v.plate is not null
   and not coalesce(v.plate_custom, false)
   and v.plate <> upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g'))
   and upper(regexp_replace(v.plate, '[^A-Za-z0-9]', '', 'g')) !~ '^[A-Z0-9]{7}$';

create temp table _m3_disp2 as
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

update public.vehicles v set plate = p.clean
  from _m3_plate2 p where v.id = p.id and p.action = 'sans_tirets' and v.plate = p.old_plate;
update public.vehicles v set plate = null, is_track_bike = true
  from _m3_plate2 p where v.id = p.id and p.action = 'moto_piste' and v.plate = p.old_plate;
update public.vehicles v set plate = null
  from _m3_plate2 p where v.id = p.id and p.action = 'vider' and v.plate = p.old_plate;

update public.vehicles v set displacement = x.new_disp
  from _m3_disp2 x
 where v.id = x.id and x.verdict = 'numero_moteur_seul' and v.displacement = x.old_disp;

insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
select '3d9f0f13-a691-4d07-ad58-34590df86e33', null, 'data_cleanup', 'vehicles', '20261126130000_m3_plaques_moto_piste_moteur', 'import', null,
  jsonb_build_object(
    'rule', 'Décisions Simon 26/11 : plaques de 6 ou 8 caractères gardées sans tirets ; MOTO PISTE = plaque vide + Moto piste ; autres textes vidés ; cylindrée du numéro moteur gravé acceptée.',
    'plates', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'vin', vin, 'old', old_plate, 'action', action) order by action, old_plate), '[]'::jsonb) from _m3_plate2),
    'plates_count', (select coalesce(jsonb_object_agg(action, n), '{}'::jsonb) from (select action, count(*) n from _m3_plate2 group by 1) z),
    'displacement_fixed', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'vin', vin, 'old', old_disp, 'new', new_disp, 'source', source)), '[]'::jsonb)
                             from _m3_disp2 where verdict = 'numero_moteur_seul')
  );

drop table _m3_plate2, _m3_disp2;
