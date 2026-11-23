-- =====================================================================
-- Reconnaissance VIN : lecture fiable de l'année, « unique » réservé aux cas sûrs.
--
-- 1. `_vin_year` : le 10e caractère revient tous les 30 ans (V = 1997 ou 2027). On garde le cycle
--    le plus proche des années catalogue connues pour ce motif. Sans indice : la dernière année
--    non future ; le code de l'année suivante n'est plausible qu'à partir de juillet (mesuré sur
--    les dates de production DCS), et dans ce cas les deux cycles restent possibles → null.
-- 2. `_vin_identify_core` : `unique` exige désormais que le n° de série tombe dans la plage déjà
--    vue pour ce modèle-année (validation croisée : 97,5 % exact dans la plage, 82,1 % hors plage).
--    Le déclencheur `_vehicles_catalog_from_vin`, qui ne rattache que sur `unique`, n'attribue donc
--    plus seul un modèle-année douteux à une nouvelle moto.
--
-- Aucune fiche existante n'est modifiée : seules deux fonctions sont créées ou remplacées.
-- Mêmes règles que `vinYear` et `rankPatternCandidates` (src/lib/vin-identify.ts).
-- =====================================================================

create or replace function public._vin_year(_code text, _known integer[] default null, _at timestamptz default now())
returns integer
language plpgsql stable set search_path = public, pg_temp as $$
declare
  c text := upper(coalesce(_code, ''));
  local_at timestamp := _at at time zone 'Europe/Brussels';
  ref_year integer := extract(year from local_at)::integer;
  ref_month integer := extract(month from local_at)::integer;
  pos integer; base integer; latest integer; y integer; gap integer; best integer; best_gap integer;
begin
  if length(c) <> 1 then return null; end if;
  pos := position(c in 'ABCDEFGHJKLMNPRSTVWXY');
  base := case when pos > 0 then 1979 + pos when c ~ '^[1-9]$' then 2000 + c::integer end;
  if base is null then return null; end if;
  latest := base;
  while latest + 30 <= ref_year + 1 loop latest := latest + 30; end loop;

  if coalesce(cardinality(_known), 0) > 0 then
    -- From the most recent cycle down: on a tie the most recent one wins.
    y := latest;
    while y >= base loop
      select min(abs(k - y)) into gap from unnest(_known) as k;
      if gap is not null and (best_gap is null or gap < best_gap) then best := y; best_gap := gap; end if;
      y := y - 30;
    end loop;
    if best is not null then return best; end if;
  end if;

  if latest <= ref_year then return latest; end if;
  if ref_month >= 7 then return null; end if;
  if latest - 30 >= base then return latest - 30; end if;
  return null;
end $$;
revoke all on function public._vin_year(text, integer[], timestamptz) from public, anon, authenticated;

create or replace function public._vin_identify_core(_vin text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v text := upper(regexp_replace(coalesce(_vin, ''), '[^A-Za-z0-9]', '', 'g'));
  yc text; vy integer; known integer[]; v_brand text; v_plant text; v_serial integer; k text;
  conf text := 'inconnu'; my_id text; ids text[] := '{}'; fam_id text; sm_id text;
  n_rows integer := 0; n_in integer := 0; top_samples integer := 0; total_samples integer := 0;
  cands jsonb := '[]'::jsonb; plans jsonb := '[]'::jsonb; n_draw integer;
  d_family text; d_supermodel text; d_model text; d_name text; d_code text; d_year integer;
  s_disp numeric; s_kw numeric; s_cv numeric; s_cyl integer; s_euro text;
begin
  if v !~ '^[A-HJ-NPR-Z0-9]{17}$' then
    return jsonb_build_object('vin', v, 'valid', false, 'ducati', false, 'confidence', 'inconnu',
                              'candidates', '[]'::jsonb, 'maintenance_plans', '[]'::jsonb);
  end if;

  -- Year (10th character, 30-year cycle): the cycle closest to the catalogue years known
  -- for this exact pattern, else this descriptor, else its first 6 characters.
  yc := substr(v, 10, 1);
  if left(v, 3) = 'ZDM' then
    select array_agg(y.year) into known
      from public.ducati_vin_patterns p
      join public.ducati_catalog_model_years y on y.id = p.model_year_id
     where p.pattern = left(v, 10) and p.samples > 0 and y.year is not null;
    if known is null then
      select array_agg(y.year) into known
        from public.ducati_vin_patterns p
        join public.ducati_catalog_model_years y on y.id = p.model_year_id
       where left(p.pattern, 9) = left(v, 9) and p.samples > 0 and y.year is not null;
    end if;
    if known is null then
      select array_agg(y.year) into known
        from public.ducati_vin_patterns p
        join public.ducati_catalog_model_years y on y.id = p.model_year_id
       where left(p.pattern, 6) = left(v, 6) and p.samples > 0 and y.year is not null;
    end if;
  end if;
  vy := public._vin_year(yc, known);
  v_brand := case left(v, 3)
    when 'ZDM' then 'DUCATI' when 'ZD4' then 'APRILIA' when 'ZAP' then 'PIAGGIO' when 'ZCG' then 'MV AGUSTA'
    when 'ZGU' then 'MOTO GUZZI' when 'JYA' then 'YAMAHA' when 'JH2' then 'HONDA' when 'JKA' then 'KAWASAKI'
    when 'JS1' then 'SUZUKI' when 'VTT' then 'SUZUKI' when 'WB1' then 'BMW' when 'VBK' then 'KTM'
    when 'SMT' then 'TRIUMPH' when '1HD' then 'HARLEY-DAVIDSON' when '5HD' then 'HARLEY-DAVIDSON'
    when 'ZDT' then 'BENELLI' end;
  v_plant := case when left(v, 3) = 'ZDM' and substr(v, 11, 1) = 'B' then 'Bologne (Italie)' end;
  v_serial := case when substr(v, 12) ~ '^[0-9]{6}$' then substr(v, 12)::integer end;
  k := left(v, 10);

  if left(v, 3) = 'ZDM' then
    -- 1. Motif exact : candidats classés (plage de série, écart, fréquence).
    with r as (
      select p.model_year_id, p.samples,
             case when v_serial is null then 0
                  when v_serial < p.serial_from then p.serial_from - v_serial
                  when v_serial > p.serial_to then v_serial - p.serial_to else 0 end as dist
        from public.ducati_vin_patterns p
        join public.ducati_catalog_model_years y on y.id = p.model_year_id
       where p.pattern = k and p.samples > 0
    )
    select coalesce(array_agg(model_year_id order by dist, samples desc, model_year_id), '{}'),
           count(*), count(*) filter (where dist = 0 and v_serial is not null),
           coalesce(max(samples), 0), coalesce(sum(samples), 0)
      into ids, n_rows, n_in, top_samples, total_samples
      from r;

    if n_rows > 0 then
      -- `unique` also requires the serial number to fall inside the range seen for this model-year.
      conf := case when n_rows = 1 and top_samples >= 5 and n_in = 1 then 'unique'
                   when n_rows = 1 then 'probable'
                   when n_in = 1 then 'probable'
                   else 'plusieurs' end;
      if conf <> 'plusieurs' then my_id := ids[1]; end if;
      select case when count(distinct m.family_id) = 1 then min(m.family_id) end,
             case when count(distinct m.supermodel_id) = 1 then min(m.supermodel_id) end
        into fam_id, sm_id
        from unnest(ids) as i(id)
        join public.ducati_catalog_model_years y on y.id = i.id
        join public.ducati_catalog_models m on m.id = y.model_id;
    else
      -- 2. Même descripteur (1-9) vu d'autres années : modèles projetés sur l'année du VIN.
      select count(*),
             case when count(distinct m.family_id) = 1 then min(m.family_id) end,
             case when count(distinct m.supermodel_id) = 1 then min(m.supermodel_id) end
        into n_rows, fam_id, sm_id
        from public.ducati_vin_patterns p
        join public.ducati_catalog_model_years y on y.id = p.model_year_id
        join public.ducati_catalog_models m on m.id = y.model_id
       where left(p.pattern, 9) = left(v, 9) and p.samples > 0;
      if n_rows > 0 then
        conf := case when sm_id is not null then 'modele' else 'famille' end;
        with mo as (
          select y.model_id, sum(p.samples) as n
            from public.ducati_vin_patterns p
            join public.ducati_catalog_model_years y on y.id = p.model_year_id
           where left(p.pattern, 9) = left(v, 9) and p.samples > 0
           group by y.model_id
        )
        select coalesce(array_agg(y.id order by mo.n desc, mo.model_id, y.year), '{}')
          into ids
          from mo
          join public.ducati_catalog_model_years y
            on y.model_id = mo.model_id and vy is not null and y.year in (vy, vy + 1);
        if conf = 'famille' and fam_id is null then conf := 'inconnu'; end if;
      else
        -- 3. Mêmes 6 premiers caractères : la famille seule.
        select case when count(distinct m.family_id) = 1 then min(m.family_id) end
          into fam_id
          from public.ducati_vin_patterns p
          join public.ducati_catalog_model_years y on y.id = p.model_year_id
          join public.ducati_catalog_models m on m.id = y.model_id
         where left(p.pattern, 6) = left(v, 6) and p.samples > 0;
        if fam_id is not null then conf := 'famille'; end if;
      end if;
    end if;
  end if;

  -- Candidats (12 au plus), avec nom, année, fréquence et nombre de vues éclatées.
  select coalesce(jsonb_agg(jsonb_build_object(
           'model_year_id', y.id, 'family', f.description, 'supermodel', s.description,
           'model', m.description, 'name', y.name, 'code', y.code, 'year', y.year,
           'samples', coalesce(p.samples, 0),
           'share', case when total_samples > 0 then round(coalesce(p.samples, 0)::numeric / total_samples, 3) else 0 end,
           'in_range', coalesce(v_serial between p.serial_from and p.serial_to, false),
           'drawings_count', (select count(*) from public.ducati_catalog_model_year_drawings d where d.model_year_id = y.id),
           'displacement_cc', sp.displacement_cc, 'power_kw', sp.power_kw, 'power_cv', sp.power_cv,
           'cylinders', sp.cylinders, 'euro', sp.euro
         ) order by i.ord), '[]'::jsonb)
    into cands
    from unnest(ids[1:12]) with ordinality as i(id, ord)
    join public.ducati_catalog_model_years y on y.id = i.id
    join public.ducati_catalog_models m on m.id = y.model_id
    join public.ducati_catalog_supermodels s on s.id = m.supermodel_id
    join public.ducati_catalog_families f on f.id = m.family_id
    left join public.ducati_vin_patterns p on p.pattern = k and p.model_year_id = y.id
    left join public.ducati_vin_model_specs sp on sp.model_year_id = y.id;

  -- Détail du modèle-année retenu, sinon ce qui est commun aux candidats.
  if my_id is not null then
    select f.description, s.description, m.description, y.name, y.code, y.year, f.id, s.id
      into d_family, d_supermodel, d_model, d_name, d_code, d_year, fam_id, sm_id
      from public.ducati_catalog_model_years y
      join public.ducati_catalog_models m on m.id = y.model_id
      join public.ducati_catalog_supermodels s on s.id = m.supermodel_id
      join public.ducati_catalog_families f on f.id = m.family_id
     where y.id = my_id;
    select displacement_cc, power_kw, power_cv, cylinders, euro
      into s_disp, s_kw, s_cv, s_cyl, s_euro
      from public.ducati_vin_model_specs where model_year_id = my_id;
    select count(*) into n_draw from public.ducati_catalog_model_year_drawings where model_year_id = my_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', pl.id, 'family', pl.family, 'model_text', pl.model_text,
                                                 'usage', pl.usage, 'year_from', pl.year_from, 'year_to', pl.year_to)
                              order by pl.usage, pl.id), '[]'::jsonb)
      into plans
      from public.maintenance_plan_catalog_links l
      join public.maintenance_plans pl on pl.id = l.plan_id
     where l.model_year_id = my_id and l.status = 'lie';
  else
    select description into d_family from public.ducati_catalog_families where id = fam_id;
    select description into d_supermodel from public.ducati_catalog_supermodels where id = sm_id;
    select case when count(distinct sp.displacement_cc) = 1 then min(sp.displacement_cc) end,
           case when count(distinct sp.power_kw) = 1 then min(sp.power_kw) end,
           case when count(distinct sp.power_cv) = 1 then min(sp.power_cv) end,
           case when count(distinct sp.cylinders) = 1 then min(sp.cylinders) end,
           case when count(distinct sp.euro) = 1 then min(sp.euro) end
      into s_disp, s_kw, s_cv, s_cyl, s_euro
      from unnest(ids) as i(id) join public.ducati_vin_model_specs sp on sp.model_year_id = i.id;
  end if;

  -- Repli : table VDS apprise des fiches (cylindrée, CV, norme) si rien d'autre.
  if left(v, 3) = 'ZDM' and (s_disp is null or s_cv is null or s_euro is null) then
    select coalesce(s_disp, max(dv.displacement_cc)), coalesce(s_cv, max(dv.power_cv)), coalesce(s_euro, max(dv.euro))
      into s_disp, s_cv, s_euro
      from public.ducati_vds dv where dv.vds = substr(v, 4, 6);
  end if;

  return jsonb_build_object(
    'vin', v, 'valid', true, 'ducati', left(v, 3) = 'ZDM', 'brand', v_brand,
    'vin_year', vy, 'plant', v_plant,
    'confidence', conf, 'model_year_id', my_id,
    'family_id', fam_id, 'family', d_family,
    'supermodel_id', sm_id, 'supermodel', d_supermodel,
    'model', d_model, 'name', d_name, 'code', d_code,
    'year', coalesce(d_year, vy),
    'displacement_cc', s_disp, 'power_kw', s_kw, 'power_cv', s_cv, 'cylinders', s_cyl, 'euro', s_euro,
    'drawings_count', n_draw, 'maintenance_plans', plans,
    'candidates', cands, 'candidates_total', coalesce(array_length(ids, 1), 0),
    'samples', total_samples
  );
end $$;
revoke all on function public._vin_identify_core(text) from public, anon, authenticated;
