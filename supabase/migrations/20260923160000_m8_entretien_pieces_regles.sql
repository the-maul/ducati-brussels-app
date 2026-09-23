-- =====================================================================
-- Mission 07 — carte 2, partie 1 : relier un entretien aux pièces
--
-- Demande de Simon (23/09) : « relier les entretiens au pièces.. on doit pouvoir
-- aussi créer une picking list a partir de ce qui a été prévu comme entretien.
-- et pouvoir commander depuis l'or ou la picking list (en choisissant le type
-- de commande). »
--
-- Ce lot pose la DÉDUCTION : pour un modèle-année du catalogue Ducati et une
-- échéance d'entretien (Oil Service, Desmo Service…), quelles pièces il faut.
-- Rien n'est inventé : on part des libellés d'opérations des manuels d'atelier
-- (wsm_operations + wsm_service_procedures), on en déduit un BESOIN par famille
-- de pièce, puis on cherche la référence dans les vues éclatées du catalogue
-- Ducati DE CE modèle-année, et donc l'article du DMS (ducati_catalog_article_links).
-- Les consommables (huile moteur, liquide de refroidissement, liquide de frein,
-- huile de fourche) viennent des tableaux de ravitaillements (wsm_fluid_tables)
-- avec leur quantité et leur spécification.
--
-- Trois jeux de règles, en table (donc corrigeables sans migration) :
--   maintenance_part_families      : les familles de pièces d'entretien ;
--   maintenance_part_need_rules    : libellé d'opération  -> besoin ;
--   maintenance_part_catalog_rules : besoin -> référence dans le catalogue ;
--   maintenance_fluid_rules        : besoin -> ligne du tableau de ravitaillements.
--
-- Données de référence GLOBALES, sans company_id, comme maintenance_* (M-21),
-- ducati_catalog_* (M-19) et wsm_* (M-26) : elles décrivent les manuels Ducati,
-- pas la concession. Ce que la concession édite, c'est le KIT (migration
-- 20260923161000), qui porte company_id et RLS.
--
-- Stock : AUCUN mouvement. Aucune écriture dans les tables existantes.
--
-- Additif : 4 tables de règles + leur contenu, 3 fonctions de lecture.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Les familles de pièces d'entretien
-- ---------------------------------------------------------------------
create table if not exists public.maintenance_part_families (
  code        text primary key,
  label       text not null,                       -- libellé FR affiché à l'atelier
  kind        text not null check (kind in ('piece', 'consommable')),
  optional    boolean not null default false,      -- absent du catalogue = non applicable
  unit        text,                                -- pour les consommables : l, cm3…
  sort        integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- Libellé d'opération du manuel -> besoin. `pattern` est une expression
-- régulière POSIX appliquée au libellé en minuscules.
create table if not exists public.maintenance_part_need_rules (
  id          uuid primary key default gen_random_uuid(),
  family_code text not null references public.maintenance_part_families(code) on delete cascade,
  pattern     text not null,
  note        text,
  sort        integer not null default 0,
  unique (family_code, pattern)
);

-- Besoin -> référence du catalogue Ducati. On cherche dans les lignes des vues
-- éclatées du modèle-année : `include_re` sur la désignation de la ligne,
-- `exclude_re` pour écarter les faux amis (couvercle, outil, câble…),
-- `drawing_re` pour restreindre à certaines vues (ex. « POMPE A EAU »).
create table if not exists public.maintenance_part_catalog_rules (
  id          uuid primary key default gen_random_uuid(),
  family_code text not null references public.maintenance_part_families(code) on delete cascade,
  include_re  text not null,
  exclude_re  text,
  drawing_re  text,
  drawing_exclude_re text,   -- vues à écarter (une « FILTRE A AIR » de la vue
                             -- DISTRIBUTION est un reniflard, pas le filtre à air)
  -- vrai : plusieurs références trouvées = plusieurs pièces à prendre (2 courroies) ;
  -- faux : plusieurs références = variantes, l'atelier choisit.
  take_all    boolean not null default false,
  sort        integer not null default 0,
  unique (family_code, include_re)
);

-- Besoin -> ligne du tableau de ravitaillements du manuel (quantité + produit).
create table if not exists public.maintenance_fluid_rules (
  id          uuid primary key default gen_random_uuid(),
  family_code text not null references public.maintenance_part_families(code) on delete cascade,
  element_re  text not null,
  sort        integer not null default 0,
  unique (family_code, element_re)
);

alter table public.maintenance_part_families      enable row level security;
alter table public.maintenance_part_need_rules    enable row level security;
alter table public.maintenance_part_catalog_rules enable row level security;
alter table public.maintenance_fluid_rules        enable row level security;

do $$ begin
  create policy mpf_read  on public.maintenance_part_families      for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mpnr_read on public.maintenance_part_need_rules    for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mpcr_read on public.maintenance_part_catalog_rules for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mfr_read  on public.maintenance_fluid_rules        for select to authenticated using (true);
exception when duplicate_object then null; end $$;

revoke insert, update, delete on public.maintenance_part_families      from anon, authenticated;
revoke insert, update, delete on public.maintenance_part_need_rules    from anon, authenticated;
revoke insert, update, delete on public.maintenance_part_catalog_rules from anon, authenticated;
revoke insert, update, delete on public.maintenance_fluid_rules        from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Le contenu des règles (mesuré sur les 461 manuels chargés, 23/09)
-- ---------------------------------------------------------------------
insert into public.maintenance_part_families (code, label, kind, optional, unit, sort) values
  ('filtre_huile',            'Filtre à huile',               'piece',       false, null, 10),
  ('bouchon_vidange',         'Bouchon de vidange',           'piece',       true,  null, 20),
  ('crepine_huile',           'Crépine de filtration',        'piece',       true,  null, 30),
  ('huile_moteur',            'Huile moteur',                 'consommable', false, 'l',  40),
  ('filtre_air',              'Filtre à air',                 'piece',       false, null, 50),
  ('bougie',                  'Bougies',                      'piece',       false, null, 60),
  ('joint_bougie',            'Joints de bougie',             'piece',       true,  null, 70),
  ('courroie_distribution',   'Courroies de distribution',    'piece',       false, null, 80),
  ('courroie_pompe_eau',      'Courroie de pompe à eau',      'piece',       false, null, 90),
  ('joint_pompe_eau',         'Joints de pompe à eau',        'piece',       false, null, 100),
  ('liquide_refroidissement', 'Liquide de refroidissement',   'consommable', false, 'l',  110),
  ('liquide_frein',           'Liquide de frein et embrayage','consommable', false, 'l',  120),
  ('huile_fourche',           'Huile de fourche',             'consommable', false, 'cm3',130)
on conflict (code) do update set label = excluded.label, kind = excluded.kind,
  optional = excluded.optional, unit = excluded.unit, sort = excluded.sort, updated_at = now();

insert into public.maintenance_part_need_rules (family_code, pattern, note) values
  ('filtre_huile',            '(vidang\w*\s+(de\s+l|d)''huile\s+moteur|huile moteur\s*-\s*vidange).*(filtre|cartouche)|remplacement du filtre (à|a) huile', 'vidange moteur avec filtre'),
  ('bouchon_vidange',         '(vidang\w*\s+(de\s+l|d)''huile\s+moteur|huile moteur\s*-\s*vidange)', 'joint / bouchon de carter à chaque vidange'),
  ('crepine_huile',           'remplacement de l''ensemble crépine|crépine de filtration', null),
  ('huile_moteur',            '(vidang\w*\s+(de\s+l|d)''huile\s+moteur|huile moteur\s*-\s*vidange)', null),
  ('filtre_air',              'remplacement du filtre (à|a) air|filtre (à|a) air\s*-\s*remplacement', null),
  ('bougie',                  'remplacement (de\s+la\s+bougie|des\s+bougies)|bougie[^-]*-\s*remplacement', null),
  ('joint_bougie',            'remplacement (de\s+la\s+bougie|des\s+bougies)', 'seulement si le modèle en a un'),
  ('courroie_distribution',   'remplacement (des |de la )?courroies? (de (la )?)?distribution', 'moteurs à courroie seulement'),
  ('courroie_pompe_eau',      'remplacement (de la )?courroie (de la )?pompe (à|a) eau', null),
  ('joint_pompe_eau',         'remplacement.{0,40}(élément d''étanchéité|joint).{0,30}pompe (à|a) eau|pompe (à|a) eau\s*-\s*remplacement (du|des) joint', null),
  ('liquide_refroidissement', 'vidange du liquide de refroidissement|liquide de refroidissement\s*-\s*vidange', null),
  ('liquide_frein',           'vidange (du |de l''huile |liquide )?(des |de )?(liquide )?(des |de )?freins|liquide de freins et d''embrayage\s*-\s*vidange|remplacement du liquide de frein|remplacement d''huile de freins', null),
  ('huile_fourche',           'vidange de l''huile de (la )?fourche', null)
on conflict (family_code, pattern) do nothing;

insert into public.maintenance_part_catalog_rules
  (family_code, include_re, exclude_re, drawing_re, drawing_exclude_re, take_all) values
  ('filtre_huile',          '^FILTRE A HUILE$', null, null, null, false),
  ('bouchon_vidange',       '^BOUCHON VIDANGE', null, null, null, false),
  ('crepine_huile',         '(CREPINE|CRÉPINE|FILTRE A HUILE A FILET)', '(OUTIL|SUPPORT)', null, null, false),
  ('filtre_air',            '^FILTRE A AIR$', null, null, 'DISTRIBUTION', false),
  ('bougie',                '^BOUGIE( |$)', '(CABLE|CABLAGE|GUIDE|JOINT|CAPUCHON|CLE |OUTIL|PROTECTION)', null, null, false),
  ('joint_bougie',          '^JOINT,? BOUGIE', null, null, null, false),
  ('courroie_distribution', 'COURROIE', '(COUVERCLE|TENDEUR|POULIE|SELLE|KIT MISE EN TENSION|GALET|PROTECTION|CARTER|POMPE)', null, null, true),
  ('courroie_pompe_eau',    'COURROIE', '(COUVERCLE|TENDEUR|POULIE|SELLE|KIT MISE)', 'POMPE (A|À) EAU', null, true),
  ('joint_pompe_eau',       '(^JOINT|BAGUE|ETANCH)', '(OUTIL)', 'POMPE (A|À) EAU', null, true)
on conflict (family_code, include_re) do nothing;

insert into public.maintenance_fluid_rules (family_code, element_re) values
  ('huile_moteur',            '(graissage|lubrification|carter moteur)'),
  ('liquide_refroidissement', '(refroidissement)'),
  ('liquide_frein',           '(frein)'),
  ('huile_fourche',           '(fourche)')
on conflict (family_code, element_re) do nothing;

-- ---------------------------------------------------------------------
-- 3. Source unifiée des libellés d'opération par (manuel, échéance)
--    Deux sources indépendantes : la grille d'entretien (wsm_operations, colonne
--    de l'échéance) et les procédures rattachées à l'échéance
--    (wsm_service_procedures.operation). L'union rattrape les manuels dont la
--    grille n'est pas balisée par échéance.
-- ---------------------------------------------------------------------
create or replace view public.wsm_service_operation_labels as
  select o.manual_id, c.code as service_code, lower(o.label) as label, 'grille'::text as source
    from public.wsm_operations o
    cross join lateral unnest(o.service_codes) c(code)
   where o.scope = 'concessionnaire'
  union
  select sp.manual_id, sp.service_code, lower(sp.operation), 'procedure'
    from public.wsm_service_procedures sp
   where sp.operation is not null and btrim(sp.operation) <> '';

grant select on public.wsm_service_operation_labels to authenticated;

-- ---------------------------------------------------------------------
-- 4. La déduction : pièces nécessaires pour un modèle-année et une échéance
--
--    confiance :
--      'sur'         — une seule référence trouvée dans le catalogue de ce
--                      modèle-année (ou le produit + la quantité du manuel) ;
--      'a_confirmer' — plusieurs références possibles, ou aucune alors que
--                      l'opération l'exige : l'atelier tranche. JAMAIS d'invention.
--      'non_applicable' — famille optionnelle absente du catalogue (ex. joint de
--                      bougie sur un modèle qui n'en a pas) : la ligne n'est pas
--                      proposée, elle est seulement visible en diagnostic.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_deduce_parts(
  _model_year_id text,
  _service_code  text default null
) returns table(
  service_code   text,
  family_code    text,
  family_label   text,
  kind           text,
  optional       boolean,
  references_    text[],
  quantity       numeric,
  unit           text,
  article_id     uuid,
  article_ref    text,
  designation    text,
  fluid_product  text,
  fluid_spec     text,
  confidence     text,
  matched_labels text[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with links as (
    select l.manual_id
      from public.wsm_manual_catalog_links l
     where l.model_year_id = _model_year_id and l.status = 'lie'
  ),
  needs as (
    select so.service_code as sc, f.code as fc, f.label as fl, f.kind as fk,
           f.optional as fo, f.unit as fu, f.sort as fs,
           array_agg(distinct so.label) as labels
      from links
      join public.wsm_service_operation_labels so on so.manual_id = links.manual_id
      join public.maintenance_part_need_rules r on so.label ~ r.pattern
      join public.maintenance_part_families f on f.code = r.family_code
     where _service_code is null or so.service_code = _service_code
     group by 1, 2, 3, 4, 5, 6, 7
  ),
  -- lignes du catalogue de CE modèle-année qui répondent à une famille
  cat as (
    select distinct n.fc, d.id as drawing_id, dl.position, dl.reference,
           greatest(coalesce(dl.quantity, 1), 1) as q, dl.description
      from (select distinct fc from needs) n
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
    select cat.fc, cat.reference, sum(cat.q) as qty,
           (array_agg(cat.description))[1] as descr
      from cat group by cat.fc, cat.reference
  ),
  -- Deux familles se comportent différemment quand plusieurs références sortent :
  --   take_all = vrai  → il faut TOUTES les pièces (2 courroies, 2 joints de pompe
  --                      à eau) : une ligne de kit par référence ;
  --   take_all = faux  → ce sont des variantes (plusieurs filtres à air selon la
  --                      version) : une seule est la bonne, l'atelier tranche.
  cat_mode as (
    select rc.family_code as fc, bool_or(rc.take_all) as take_all
      from public.maintenance_part_catalog_rules rc group by rc.family_code
  ),
  cat_agg as (
    select b.fc, array[b.reference] as refs, b.qty, 1 as nrefs, b.descr
      from cat_by_ref b join cat_mode m on m.fc = b.fc and m.take_all
    union all
    select b.fc, array_agg(b.reference order by b.reference), sum(b.qty),
           count(*)::bigint, (array_agg(b.descr order by b.reference))[1]
      from cat_by_ref b join cat_mode m on m.fc = b.fc and not m.take_all
     group by b.fc
  ),
  -- tableaux de ravitaillements du manuel
  fluid as (
    select distinct on (n.fc)
           n.fc,
           ln ->> 'element'        as element,
           ln ->> 'specification'  as spec,
           coalesce((select string_agg(p, ', ') from jsonb_array_elements_text(coalesce(ln -> 'produits', '[]'::jsonb)) p), '') as produits,
           -- quantité de référence : le volume sans condition s'il existe
           -- (« 3,8 litres »), sinon le premier volume conditionné
           -- (« Quantité d'huile pour tube GCHE : 524 cm3 »).
           (select (qt ->> 'valeur')::numeric
              from jsonb_array_elements(coalesce(ln -> 'quantites', '[]'::jsonb)) qt
             where qt ->> 'type' = 'volume'
             order by ((qt ->> 'condition') is null) desc
             limit 1) as val,
           (select qt ->> 'unite'
              from jsonb_array_elements(coalesce(ln -> 'quantites', '[]'::jsonb)) qt
             where qt ->> 'type' = 'volume'
             order by ((qt ->> 'condition') is null) desc
             limit 1) as unite
      from (select distinct fc from needs) n
      join public.maintenance_fluid_rules rf on rf.family_code = n.fc
      join links on true
      join public.wsm_fluid_tables ft on ft.manual_id = links.manual_id
      cross join lateral jsonb_array_elements(ft.lines) ln
     where lower(ln ->> 'element') ~ rf.element_re
     order by n.fc,
              (exists (select 1 from jsonb_array_elements(coalesce(ln -> 'quantites', '[]'::jsonb)) q2
                        where q2 ->> 'type' = 'volume')) desc,
              ft.sort
  )
  select n.sc, n.fc, n.fl, n.fk, n.fo,
         case when n.fk = 'piece' then ca.refs else null end,
         case when n.fk = 'piece' then ca.qty else f.val end,
         case when n.fk = 'piece' then null else coalesce(f.unite, n.fu) end,
         al.article_id,
         ca.refs[1],
         case when n.fk = 'piece' then coalesce(a.designation, ca.descr, n.fl) else n.fl end,
         nullif(f.produits, ''),
         f.spec,
         case
           -- un consommable est « sûr » dès que le manuel donne le produit ou la
           -- spécification ; certains (liquide de frein DOT 4) n'ont jamais de
           -- quantité chiffrée dans les tableaux Ducati : la quantité reste à
           -- fixer par l'atelier, le produit lui est connu.
           when n.fk = 'consommable' then
             case when f.fc is null then 'a_confirmer'
                  when f.val is null and nullif(f.produits, '') is null and f.spec is null then 'a_confirmer'
                  else 'sur' end
           when ca.fc is null then case when n.fo then 'non_applicable' else 'a_confirmer' end
           when ca.nrefs > 1 then 'a_confirmer'
           when al.article_id is null then 'a_confirmer'
           else 'sur'
         end,
         n.labels
    from needs n
    left join cat_agg ca on ca.fc = n.fc
    left join fluid f on f.fc = n.fc
    left join lateral (
      select acl.article_id from public.ducati_catalog_article_links acl
       where ca.refs is not null and acl.catalog_reference = ca.refs[1] limit 1) al on true
    left join public.articles a on a.id = al.article_id
   order by n.sc, n.fs, ca.refs[1];
end $$;

revoke all on function public.maintenance_deduce_parts(text, text) from public, anon;
grant execute on function public.maintenance_deduce_parts(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Signature de famille moteur
--    M-20 : « un kit de pièces par famille de moteur et par entretien ».
--    La famille de moteur n'existe nulle part en base ; on la calcule à partir
--    de ce qui la caractérise vraiment pour l'entretien : filtre à huile,
--    bougie et courroie de distribution du modèle-année. Deux modèles-années
--    qui partagent ces références partagent le même moteur (vérifié à la main
--    sur Monster 821 / Monster 937 / Panigale V4 S).
-- ---------------------------------------------------------------------
create or replace function public.maintenance_engine_family_key(_model_year_id text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    md5((select string_agg(x.reference, ',' order by x.reference)
           from (select distinct dl.reference
                   from public.maintenance_part_catalog_rules rc
                   join public.ducati_catalog_model_year_drawings myd on myd.model_year_id = _model_year_id
                   join public.ducati_catalog_drawings d on d.id = myd.drawing_id
                   join public.ducati_catalog_drawing_lines dl on dl.drawing_id = d.id
                  where rc.family_code in ('filtre_huile', 'bougie', 'courroie_distribution')
                    and upper(d.description) !~ 'OUTILS SPECIAUX'
                    and upper(dl.description) ~ rc.include_re
                    and (rc.exclude_re is null or upper(dl.description) !~ rc.exclude_re)
                    and (rc.drawing_exclude_re is null or upper(d.description) !~ rc.drawing_exclude_re)) x)),
    'inconnu');
$$;

revoke all on function public.maintenance_engine_family_key(text) from public, anon;
grant execute on function public.maintenance_engine_family_key(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Mesure de couverture (écran de vérification, pas de calcul métier)
--    Appel par lots : _limit modèles-années à partir de _offset, pour rester
--    sous le statement_timeout de 8 s.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_parts_coverage(
  _limit integer default 40,
  _offset integer default 0
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with my as (
    select distinct l.model_year_id
      from public.wsm_manual_catalog_links l
     where l.status = 'lie'
       and exists (select 1 from public.ducati_catalog_model_year_drawings d
                    where d.model_year_id = l.model_year_id)
     order by 1
     limit greatest(coalesce(_limit, 40), 1) offset greatest(coalesce(_offset, 0), 0)
  ), p as (
    select my.model_year_id, x.*
      from my cross join lateral public.maintenance_deduce_parts(my.model_year_id, null) x
  )
  select jsonb_build_object(
    'model_years',   (select count(*) from my),
    'model_years_with_parts', (select count(distinct model_year_id) from p),
    'services',      (select count(distinct model_year_id || '|' || service_code) from p),
    'needs',         (select count(*) from p),
    'needs_firm',    (select count(*) from p where not optional),
    'resolved_firm', (select count(*) from p where not optional and confidence = 'sur'),
    'to_confirm',    (select count(*) from p where not optional and confidence = 'a_confirmer'),
    'optional_resolved', (select count(*) from p where optional and confidence = 'sur'),
    'by_family',     (select jsonb_object_agg(family_code, jsonb_build_object(
                        'needs', n, 'resolved', r))
                        from (select family_code, count(*) n,
                                     count(*) filter (where confidence = 'sur') r
                                from p group by 1) z)
  );
$$;

revoke all on function public.maintenance_parts_coverage(integer, integer) from public, anon;
grant execute on function public.maintenance_parts_coverage(integer, integer) to authenticated;

notify pgrst, 'reload schema';
