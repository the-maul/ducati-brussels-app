-- =====================================================================
-- Mission 07 - carte 2, suite (03/11/2026) : la generation des kits pour tout le parc
--
-- Constat du 03/11 : 0 kit en base alors que 59 plans d'entretien, 461 manuels
-- d'atelier (370 modeles-annees relies) et le catalogue complet (2 399
-- modeles-annees avec vues eclatees) sont charges : la generation du 23/09 n'a
-- jamais ete lancee, et elle ne servait que les 370 modeles-annees a manuel.
-- Le popup « pieces manquantes » (M-82) n'avait donc rien a proposer.
--
-- Decisions de Simon (03/11) :
--   M-90 « deux references pour le meme besoin sur la meme moto : on garde les
--        deux ». Pas de dedoublonnage : une ligne de kit PAR reference, chacune
--        avec sa quantite et son article, marquee « plusieurs references dans le
--        catalogue » (`catalog_refs`, niveau `a_confirmer`). Ce niveau NE BLOQUE
--        PLUS l'usage : le kit propose tout, l'atelier retire ce qu'il ne veut pas.
--        Un besoin sans AUCUNE reference sort au niveau `absent` : signale,
--        jamais propose a la commande.
--   M-91 les entretiens reels sont surtout « entretien annuel » (Annual Service)
--        et « entretien annuel + huile » (Oil Service), plus le 1er entretien
--        1 000 km. Chaque modele-annee recoit AU MINIMUM ces kits.
--   M-92 les kits viennent des manuels d'atelier et des plans Ducati :
--        source du BESOIN (quoi remplacer), dans cet ordre :
--          1. le manuel d'atelier du modele-annee (operations de l'echeance,
--             produits et quantites des ravitaillements) ;
--          2. sinon le plan d'entretien Ducati rattache (operations du poster) ;
--          3. sinon la regle « annuel + huile = vidange moteur et filtre ».
--        La REFERENCE et sa quantite viennent toujours des vues eclatees du
--        catalogue Ducati DU modele-annee. Chaque ligne garde sa provenance.
--
-- Trois niveaux sur une ligne de kit : `sur` / `a_confirmer` / `absent`.
--
-- Et aussi :
--   . `maintenance_kit_generate_all(_company, _batch, _offset, _max_batches)` :
--     tout le parc en une fonction, par lots, idempotente ;
--   . M-41 : un kit corrige par l'atelier n'est jamais reecrit ; il garde ses
--     modeles-annees. Un kit NON corrige dont la proposition change perd les
--     modeles-annees qui ont une nouvelle proposition et passe en `archive`
--     quand il n'en sert plus aucun (version + 1, photo « archive ») ;
--   . `maintenance_kit_for_model_year` (meme signature) retrouve le kit par le
--     TYPE d'entretien quand le code du plan (« oil », « annual ») n'est pas
--     celui du manuel (« oil_service », « 15000_km ») ;
--   . l'article du DMS est cherche dans LA societe du kit (avant : n'importe
--     laquelle des deux societes).
--
-- Rien n'est invente. Aucun mouvement de stock. Additif, rejouable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Lignes de kit : trois niveaux, references trouvees, provenance
-- ---------------------------------------------------------------------
alter table public.maintenance_kit_items drop constraint if exists maintenance_kit_items_confidence_check;
alter table public.maintenance_kit_items
  add constraint maintenance_kit_items_confidence_check
  check (confidence in ('sur', 'a_confirmer', 'absent'));
alter table public.maintenance_kit_items add column if not exists catalog_refs text[];
alter table public.maintenance_kit_items add column if not exists provenance jsonb;

comment on column public.maintenance_kit_items.catalog_refs is
  'References du catalogue trouvees pour ce besoin sur le modele-annee ; plus d''une = « plusieurs references dans le catalogue » (M-90), chacune a sa ligne.';
comment on column public.maintenance_kit_items.provenance is
  'D''ou vient la ligne : {besoin: manuel|plan|regle, echeance, operations[], reference: catalogue, quantite: catalogue|manuel, produit: manuel, repris_de}.';

-- ---------------------------------------------------------------------
-- 2. Le TYPE d'une echeance : first_1000 / oil (annuel + huile) / annual
--    (annuel) / desmo. Les plans disent « first_1000 », « oil », « annual »,
--    « desmo » ; les manuels « oil_service_1000 », « oil_service »,
--    « 15000_km », « annual_service », « temporel », « desmo_service »… ;
--    l'extract DCS « Annual Service », « Oil Service », « Oil Service 1000km/600mi ».
-- ---------------------------------------------------------------------
create or replace function public.maintenance_service_kind(
  _code text, _km integer default null, _months integer default null, _first_service boolean default null)
returns text
language sql
immutable
as $$
  select case
    when coalesce(_first_service, false) or _km = 1000
      or lower(coalesce(_code, '')) ~ '(^|[^0-9])1[_ ]?000([^0-9]|$)'
      or lower(coalesce(_code, '')) ~ '(first|premier|1er)'                     then 'first_1000'
    when lower(coalesce(_code, '')) ~ '(desmo|valve|soupape)'                  then 'desmo'
    when lower(coalesce(_code, '')) ~ '(oil|huile)'                            then 'oil'
    when lower(coalesce(_code, '')) ~ '(annual|annuel|temporel|12_?mois)'      then 'annual'
    when _months is not null and _km is null                                   then 'annual'
    when _km between 10000 and 15000                                           then 'oil'
    when _km between 20000 and 30000                                           then 'desmo'
    when _km in (36000, 45000)                                                 then 'oil'
    when _km in (48000, 60000)                                                 then 'desmo'
    else null end;
$$;

-- Code d'echeance -> type, corrigeable sans migration (prioritaire sur la fonction).
create table if not exists public.maintenance_service_aliases (
  plan_code text primary key,
  kind      text not null check (kind in ('first_1000', 'oil', 'annual', 'desmo'))
);
alter table public.maintenance_service_aliases enable row level security;
do $$ begin
  create policy msa_read on public.maintenance_service_aliases for select to authenticated using (true);
exception when duplicate_object then null; end $$;
revoke insert, update, delete on public.maintenance_service_aliases from anon, authenticated;

insert into public.maintenance_service_aliases (plan_code, kind) values
  ('first_1000', 'first_1000'), ('oil', 'oil'), ('annual', 'annual'),
  ('desmo', 'desmo'), ('desmo_complet', 'desmo'), ('desmo_partiel', 'desmo'),
  ('desmo_plus_annual', 'desmo'), ('desmo_plus_oil', 'desmo'), ('desmo_plus_annual_ou_oil', 'desmo'),
  ('annual_service', 'annual'), ('oil_service', 'oil'), ('oil_service_1000km_600mi', 'first_1000'),
  ('temporel', 'annual')
on conflict (plan_code) do update set kind = excluded.kind;

create or replace function public.maintenance_service_kind_of(_code text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((select a.kind from public.maintenance_service_aliases a where a.plan_code = lower(_code)),
                  public.maintenance_service_kind(_code));
$$;

-- Le type porte par le kit, sa source et son km (pour choisir le premier).
alter table public.maintenance_kits add column if not exists service_kind text;
alter table public.maintenance_kits add column if not exists source text;
alter table public.maintenance_kits add column if not exists service_km integer;
alter table public.maintenance_kits drop constraint if exists maintenance_kits_service_kind_check;
alter table public.maintenance_kits add constraint maintenance_kits_service_kind_check
  check (service_kind is null or service_kind in ('first_1000', 'oil', 'annual', 'desmo'));
alter table public.maintenance_kits drop constraint if exists maintenance_kits_source_check;
alter table public.maintenance_kits add constraint maintenance_kits_source_check
  check (source is null or source in ('manuel', 'plan', 'catalogue'));
create index if not exists maintenance_kits_kind_idx on public.maintenance_kits (company_id, service_kind);

-- ---------------------------------------------------------------------
-- 3. Qui peut lancer la generation : un membre de la societe, ou le script de
--    l'agence (cle service_role, hors ecran). Jamais anon.
-- ---------------------------------------------------------------------
create or replace function public._maintenance_kit_may_generate(_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select _company is not null and (
    public.is_member(_company)
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
  );
$$;
revoke all on function public._maintenance_kit_may_generate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Du besoin a la piece : pour une liste de besoins (echeance, famille,
--    operations), les references des vues eclatees du modele-annee.
--    UNE LIGNE PAR REFERENCE (M-90) ; `references_` = toutes celles du besoin.
--    `_fluid_manuals` : manuels dont on lit les ravitaillements ; null = pas de
--    manuel (le produit et la quantite restent a designer : `a_confirmer`).
-- ---------------------------------------------------------------------
create or replace function public._maintenance_parts_for_needs(
  _model_year_id text,
  _needs         jsonb,
  _fluid_manuals text[],
  _company       uuid default null
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
  with needs as (
    select x.sc, f.code as fc, f.label as fl, f.kind as fk,
           f.optional as fo, f.unit as fu, f.sort as fs, x.labels
      from jsonb_to_recordset(coalesce(_needs, '[]'::jsonb)) as x(sc text, fc text, labels text[])
      join public.maintenance_part_families f on f.code = x.fc
  ),
  cat as (
    select distinct n.fc, d.id as drawing_id, dl.position, dl.reference,
           greatest(coalesce(dl.quantity, 1), 1) as q, dl.description
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
           (select (qt ->> 'valeur')::numeric
              from jsonb_array_elements(coalesce(ln -> 'quantites', '[]'::jsonb)) qt
             where qt ->> 'type' = 'volume'
             order by ((qt ->> 'condition') is null) desc limit 1) as val,
           (select qt ->> 'unite'
              from jsonb_array_elements(coalesce(ln -> 'quantites', '[]'::jsonb)) qt
             where qt ->> 'type' = 'volume'
             order by ((qt ->> 'condition') is null) desc limit 1) as unite
      from (select distinct needs.fc from needs where needs.fk = 'consommable') n
      join public.maintenance_fluid_rules rf on rf.family_code = n.fc
      join public.wsm_fluid_tables ft on ft.manual_id = any(coalesce(_fluid_manuals, array[]::text[]))
      cross join lateral jsonb_array_elements(ft.lines) ln
     where lower(ln ->> 'element') ~ rf.element_re
     order by n.fc,
              (exists (select 1 from jsonb_array_elements(coalesce(ln -> 'quantites', '[]'::jsonb)) q2
                        where q2 ->> 'type' = 'volume')) desc,
              ft.sort
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
end $$;
revoke all on function public._maintenance_parts_for_needs(text, jsonb, text[], uuid) from public, anon, authenticated;

-- Besoins lus dans le MANUEL d'atelier (grille + procedures de l'echeance).
create or replace function public._maintenance_manual_needs(_model_year_id text, _service_code text default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('sc', z.sc, 'fc', z.fc, 'labels', z.labels)), '[]'::jsonb)
    from (
      select so.service_code as sc, r.family_code as fc, array_agg(distinct so.label) as labels
        from public.wsm_manual_catalog_links l
        join public.wsm_service_operation_labels so on so.manual_id = l.manual_id
        join public.maintenance_part_need_rules r on so.label ~ r.pattern
       where l.model_year_id = _model_year_id and l.status = 'lie'
         and (_service_code is null or so.service_code = _service_code)
       group by 1, 2) z;
$$;
revoke all on function public._maintenance_manual_needs(text, text) from public, anon, authenticated;

-- Besoins lus dans le PLAN Ducati (poster). Dans la colonne « annuel », une
-- operation a periodicite propre (courroies 60 mois, liquide de frein 24 mois,
-- fourche 36 mois, huile 24 mois sur les modeles recents) n'est PAS de chaque
-- entretien annuel : elle reste sur le plan, hors du kit annuel.
create or replace function public._maintenance_plan_needs(_plan_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('sc', z.sc, 'fc', z.fc, 'labels', z.labels)), '[]'::jsonb)
    from (
      select ps.code as sc, r.family_code as fc, array_agg(distinct lower(o.text)) as labels
        from public.maintenance_plan_services ps
        join public.maintenance_service_operations o on o.service_id = ps.id
        join public.maintenance_part_need_rules r on lower(o.text) ~ r.pattern
       where ps.plan_id = _plan_id
         and public.maintenance_service_kind_of(ps.code) is not null
         and (public.maintenance_service_kind_of(ps.code) <> 'annual'
              or o.periodicity_months is null or o.periodicity_months <= 12)
       group by 1, 2) z;
$$;
revoke all on function public._maintenance_plan_needs(text) from public, anon, authenticated;

-- La deduction du 23/09, meme signature : besoins du manuel -> pieces.
create or replace function public.maintenance_deduce_parts(
  _model_year_id text,
  _service_code  text default null
) returns table(
  service_code text, family_code text, family_label text, kind text, optional boolean,
  references_ text[], quantity numeric, unit text, article_id uuid, article_ref text,
  designation text, fluid_product text, fluid_spec text, confidence text, matched_labels text[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public._maintenance_parts_for_needs(
    _model_year_id,
    public._maintenance_manual_needs(_model_year_id, _service_code),
    array(select l.manual_id from public.wsm_manual_catalog_links l
           where l.model_year_id = _model_year_id and l.status = 'lie'),
    null);
$$;
revoke all on function public.maintenance_deduce_parts(text, text) from public, anon;
grant execute on function public.maintenance_deduce_parts(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Photo de version : avec les references trouvees et la provenance
-- ---------------------------------------------------------------------
create or replace function public._maintenance_kit_snapshot(_kit uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare k public.maintenance_kits%rowtype;
begin
  select * into k from public.maintenance_kits where id = _kit;
  if not found then return; end if;
  insert into public.maintenance_kit_versions (company_id, kit_id, version, items, reason, changed_by)
  select k.company_id, k.id, k.version,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'family_code', i.family_code, 'article_id', i.article_id, 'reference', i.reference,
                     'catalog_refs', i.catalog_refs, 'provenance', i.provenance,
                     'designation', i.designation, 'quantity', i.quantity, 'unit', i.unit,
                     'kind', i.kind, 'confidence', i.confidence, 'origin', i.origin, 'note', i.note)
                   order by i.sort_order)
                    from public.maintenance_kit_items i where i.kit_id = k.id), '[]'::jsonb),
         _reason, auth.uid()
  on conflict (kit_id, version) do update set items = excluded.items, reason = excluded.reason,
       changed_at = now(), changed_by = excluded.changed_by;
end $$;
revoke all on function public._maintenance_kit_snapshot(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Poser UN kit (famille de moteur x echeance) et y rattacher le modele-annee.
--    Ordre (M-41) : 1) un kit corrige par l'atelier pour cette famille et cette
--    echeance gagne, son contenu n'est pas touche ; 2) sinon un kit au meme
--    contenu (meme source) est reutilise ; 3) sinon il est cree.
--    Retour : {kit, created, reused, skipped, linked, sur, multi, absent}.
-- ---------------------------------------------------------------------
create or replace function public._maintenance_kit_put(
  _company uuid, _ekey text, _elabel text, _mid text,
  _sc text, _slabel text, _skind text, _skm integer, _src text,
  _lines jsonb, _repris_de text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  kid     uuid;
  chash   text;
  st      text := 'created';
  n_sur   int := 0;
  n_multi int := 0;
  n_abs   int := 0;
  lnk     boolean;
begin
  chash := md5(_src || '|' || coalesce((
    select string_agg(coalesce(x.family_code, '') || '#' || coalesce(x.article_ref, '') || '#'
                      || coalesce(x.quantity::text, '') || '#' || coalesce(x.confidence, ''), ','
                      order by x.family_code, x.article_ref)
      from jsonb_to_recordset(coalesce(_lines, '[]'::jsonb)) as x(family_code text, article_ref text, quantity numeric, confidence text)), ''));

  select k.id into kid
    from public.maintenance_kits k
   where k.company_id = _company and k.engine_family_key = _ekey
     and k.service_code = _sc and k.status = 'actif' and k.edited_at is not null
   order by k.edited_at desc, k.version desc limit 1;
  if kid is not null then
    st := 'skipped';
  else
    select k.id into kid
      from public.maintenance_kits k
     where k.company_id = _company and k.engine_family_key = _ekey
       and k.service_code = _sc and k.content_hash = chash and k.status = 'actif';
    if kid is not null then st := 'reused'; end if;
  end if;

  if kid is null then
    insert into public.maintenance_kits (company_id, engine_family_key, engine_family_label,
                                         service_code, service_label, service_kind, source, service_km, content_hash)
    values (_company, _ekey, _elabel, _sc, _slabel, _skind, _src, _skm, chash)
    returning id into kid;

    insert into public.maintenance_kit_items
      (company_id, kit_id, family_code, article_id, reference, catalog_refs, designation, quantity, unit,
       kind, confidence, origin, fluid_product, fluid_spec, note, provenance, sort_order)
    select _company, kid,
           x.family_code,
           case when x.kind = 'piece' then x.article_id else fa.article_id end,
           x.article_ref,
           case when x.kind = 'piece' then x.references_ else null end,
           coalesce(x.designation, x.family_label, x.family_code),
           coalesce(nullif(x.quantity, 0), 1),
           x.unit,
           x.kind,
           case when x.confidence = 'absent' then 'absent'
                when x.confidence = 'sur' and (x.kind = 'piece' or fa.article_id is not null) then 'sur'
                else 'a_confirmer' end,
           'deduit',
           x.fluid_product, x.fluid_spec,
           case when x.kind = 'consommable' and x.quantity is null and x.confidence <> 'absent'
                then 'Quantite non donnee par la source : a lire dans le manuel ou a ajuster.' else null end,
           -- d'ou vient la ligne : le besoin (manuel / plan / regle), la piece du
           -- catalogue, la quantite (catalogue ou ravitaillements du manuel)
           jsonb_strip_nulls(jsonb_build_object(
             'besoin', case _src when 'manuel' then 'manuel' when 'plan' then 'plan' else 'regle' end,
             'echeance', coalesce(_repris_de, x.service_code),
             'operations', to_jsonb(coalesce(x.matched_labels, array[]::text[])),
             'reference', case when x.kind = 'piece' and x.article_ref is not null then 'catalogue' end,
             'quantite', case when x.kind = 'piece' and x.article_ref is not null then 'catalogue'
                              when x.kind = 'consommable' and x.quantity is not null then 'manuel' end,
             'produit', case when x.kind = 'consommable' and (x.fluid_product is not null or x.fluid_spec is not null) then 'manuel' end,
             'repris_de', _repris_de)),
           row_number() over (order by coalesce(f.sort, 999), x.article_ref)
      from jsonb_to_recordset(coalesce(_lines, '[]'::jsonb)) as x(
             service_code text, family_code text, family_label text, kind text, optional boolean,
             references_ text[], quantity numeric, unit text, article_id uuid, article_ref text,
             designation text, fluid_product text, fluid_spec text, confidence text, matched_labels text[])
      left join public.maintenance_part_families f on f.code = x.family_code
      left join public.maintenance_fluid_articles fa
             on fa.company_id = _company and fa.family_code = x.family_code
     where x.confidence <> 'non_applicable';

    select count(*) filter (where i.confidence = 'sur'),
           count(*) filter (where cardinality(coalesce(i.catalog_refs, array[]::text[])) > 1),
           count(*) filter (where i.confidence = 'absent')
      into n_sur, n_multi, n_abs
      from public.maintenance_kit_items i where i.kit_id = kid;

    perform public._maintenance_kit_snapshot(kid, 'generation');
  end if;

  insert into public.maintenance_kit_model_years (kit_id, model_year_id)
  values (kid, _mid) on conflict do nothing;
  lnk := found;

  return jsonb_build_object('kit', kid, 'state', st, 'linked', lnk,
                            'sur', n_sur, 'multi', n_multi, 'absent', n_abs);
end $$;
revoke all on function public._maintenance_kit_put(uuid, text, text, text, text, text, text, integer, text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Generation par lots (meme signature). Parc = modeles-annees du catalogue
--    qui ont des vues eclatees (2 399 le 03/11), dans l'ordre de leur id.
--    Pour chacun : famille de moteur, source (manuel > plan > regle), un kit
--    par echeance de la source, et AU MINIMUM « annuel + huile » et « annuel »
--    (+ « 1 000 km » si la source le prevoit).
-- ---------------------------------------------------------------------
create or replace function public.maintenance_kit_generate(
  _company    uuid,
  _limit      integer default 10,
  _offset     integer default 0,
  _model_year text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  my       record;
  svc      record;
  ekey     text;
  elabel   text;
  src      text;
  manuals  text[];
  pid      text;
  lines    jsonb;
  slines   jsonb;
  oil_lines jsonb;
  oil_name text;
  ann_lines jsonb;
  ann_name text;
  r        jsonb;
  kids     uuid[];
  kinds    text[];
  n        integer;
  t0       timestamptz := clock_timestamp();
  created  int := 0;
  reused   int := 0;
  linked   int := 0;
  skipped  int := 0;      -- kits corriges par l'atelier : contenu respecte, rattachement seulement
  unknown  int := 0;      -- modeles-annees sans famille de moteur (ni filtre, ni bougie, ni courroie)
  unlinked int := 0;      -- rattachements retires d'anciens kits non corriges
  archived int := 0;
  n_sur    int := 0;
  n_multi  int := 0;      -- lignes « plusieurs references dans le catalogue »
  n_absent int := 0;
  s_manuel int := 0;
  s_plan   int := 0;
  s_regle  int := 0;
  w_manual int := 0;      -- modeles-annees qui ont un manuel d'atelier relie
  seen     int := 0;
  total    int;
  lim      int := least(greatest(coalesce(_limit, 10), 1), 500);
  off      int := greatest(coalesce(_offset, 0), 0);
  res      jsonb;
begin
  if not public._maintenance_kit_may_generate(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select count(*) into total
    from public.ducati_catalog_model_years y
   where (_model_year is null or y.id = _model_year)
     and exists (select 1 from public.ducati_catalog_model_year_drawings d where d.model_year_id = y.id);

  for my in
    select y.id as mid,
           coalesce((select max(m.supermodel) from public.wsm_manual_catalog_links l
                       join public.wsm_manuals m on m.id = l.manual_id
                      where l.model_year_id = y.id and l.status = 'lie'),
                    nullif(btrim(cm.description), ''), y.id) as smodel
      from public.ducati_catalog_model_years y
      left join public.ducati_catalog_models cm on cm.id = y.model_id
     where (_model_year is null or y.id = _model_year)
       and exists (select 1 from public.ducati_catalog_model_year_drawings d where d.model_year_id = y.id)
     order by y.id
     limit lim offset off
  loop
    seen := seen + 1;
    manuals := array(select l.manual_id from public.wsm_manual_catalog_links l
                      where l.model_year_id = my.mid and l.status = 'lie' order by l.manual_id);
    if cardinality(manuals) > 0 then w_manual := w_manual + 1; end if;

    ekey := public.maintenance_engine_family_key(my.mid);
    if ekey = 'inconnu' then
      unknown := unknown + 1;
      continue;
    end if;
    elabel := my.smodel;
    kids := array[]::uuid[];
    kinds := array[]::text[];
    oil_lines := null;
    oil_name := null;
    ann_lines := null;
    ann_name := null;

    -- la source du besoin : manuel, sinon plan rattache, sinon regle
    src := null;
    lines := '[]'::jsonb;
    if cardinality(manuals) > 0 then
      select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into lines
        from public._maintenance_parts_for_needs(my.mid, public._maintenance_manual_needs(my.mid, null), manuals, _company) p
       where p.confidence <> 'non_applicable';
      if jsonb_array_length(lines) > 0 then src := 'manuel'; end if;
    end if;
    if src is null then
      select pl.plan_id into pid
        from public.maintenance_plan_catalog_links pl
        join public.maintenance_plans mp on mp.id = pl.plan_id
       where pl.model_year_id = my.mid and pl.status = 'lie'
       order by (mp.usage = 'route') desc, mp.year_from desc nulls last, mp.id
       limit 1;
      if pid is not null then
        select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into lines
          from public._maintenance_parts_for_needs(my.mid, public._maintenance_plan_needs(pid), null, _company) p
         where p.confidence <> 'non_applicable';
        if jsonb_array_length(lines) > 0 then src := 'plan'; end if;
      end if;
    end if;
    if src is null then
      src := 'catalogue';
      -- regle (M-91) : « entretien annuel + huile » = vidange moteur et filtre
      select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into lines
        from public._maintenance_parts_for_needs(my.mid,
               jsonb_build_array(
                 jsonb_build_object('sc', 'oil', 'fc', 'filtre_huile',    'labels', array['regle : vidange de l''huile moteur et remplacement du filtre']),
                 jsonb_build_object('sc', 'oil', 'fc', 'bouchon_vidange', 'labels', array['regle : vidange de l''huile moteur et remplacement du filtre']),
                 jsonb_build_object('sc', 'oil', 'fc', 'huile_moteur',    'labels', array['regle : vidange de l''huile moteur et remplacement du filtre'])),
               null, _company) p
       where p.confidence <> 'non_applicable';
    end if;
    if src = 'manuel' then s_manuel := s_manuel + 1;
    elsif src = 'plan' then s_plan := s_plan + 1;
    else s_regle := s_regle + 1; end if;

    -- les echeances de la source, la plus courte d'abord
    for svc in
      with s as (
        select ws.code as sc, max(ws.name) as name, max(ws.km)::int as km,
               public.maintenance_service_kind(ws.code, max(ws.km)::int, max(ws.months)::int, bool_or(ws.first_service)) as kind,
               max(ws.months)::int as months
          from public.wsm_services ws
         where src = 'manuel' and ws.manual_id = any(manuals)
         group by ws.code
        union all
        select ps.code, max(ps.name), null::int, public.maintenance_service_kind_of(ps.code), null::int
          from public.maintenance_plan_services ps
         where src = 'plan' and ps.plan_id = pid and public.maintenance_service_kind_of(ps.code) is not null
         group by ps.code
        union all
        select 'oil', 'Entretien annuel + huile', null::int, 'oil', 12 where src = 'catalogue'
      )
      select s.*,
             coalesce((select jsonb_agg(e) from jsonb_array_elements(lines) e where e ->> 'service_code' = s.sc), '[]'::jsonb) as l
        from s
       order by coalesce(s.km, case s.kind when 'first_1000' then 1000 when 'annual' then 1 when 'oil' then 2 else 99999 end), s.sc
    loop
      slines := svc.l;
      -- une echeance sans piece n'a de kit que si c'est un entretien de base
      continue when jsonb_array_length(slines) = 0 and coalesce(svc.kind, '') not in ('first_1000', 'oil', 'annual');
      -- deux colonnes de meme type sans piece (ex. 45 000 km vide) : une suffit
      continue when jsonb_array_length(slines) = 0 and svc.kind = any(kinds);
      r := public._maintenance_kit_put(_company, ekey, elabel, my.mid, svc.sc, coalesce(svc.name, svc.sc),
                                       svc.kind, svc.km, src, slines, null);
      kids := kids || (r ->> 'kit')::uuid;
      if svc.kind is not null then kinds := kinds || svc.kind; end if;
      if svc.kind = 'oil' and oil_lines is null and jsonb_array_length(slines) > 0
         and coalesce(svc.months, 12) <= 12 then
        oil_lines := slines; oil_name := coalesce(svc.name, svc.sc);
      end if;
      -- un « Annual Service » qui contient deja la vidange (ex. Streetfighter V4 SP2)
      if svc.kind = 'annual' and ann_lines is null
         and exists (select 1 from jsonb_array_elements(slines) e where e ->> 'family_code' = 'huile_moteur') then
        ann_lines := slines; ann_name := coalesce(svc.name, svc.sc);
      end if;
      if r ->> 'state' = 'created' then created := created + 1; elsif r ->> 'state' = 'reused' then reused := reused + 1; else skipped := skipped + 1; end if;
      if (r ->> 'linked')::boolean then linked := linked + 1; end if;
      n_sur := n_sur + (r ->> 'sur')::int; n_multi := n_multi + (r ->> 'multi')::int; n_absent := n_absent + (r ->> 'absent')::int;
    end loop;

    -- au minimum « annuel + huile ». La source a un entretien annuel qui contient
    -- deja la vidange : c'est lui, repris tel quel (on ne double pas l'huile).
    if not ('oil' = any(kinds)) and ann_lines is not null then
      r := public._maintenance_kit_put(_company, ekey, elabel, my.mid, 'oil', 'Entretien annuel + huile',
                                       'oil', null, src, ann_lines, ann_name);
      kids := kids || (r ->> 'kit')::uuid; kinds := kinds || 'oil'::text;
      if r ->> 'state' = 'created' then created := created + 1; elsif r ->> 'state' = 'reused' then reused := reused + 1; else skipped := skipped + 1; end if;
      if (r ->> 'linked')::boolean then linked := linked + 1; end if;
      n_sur := n_sur + (r ->> 'sur')::int; n_multi := n_multi + (r ->> 'multi')::int; n_absent := n_absent + (r ->> 'absent')::int;
    end if;
    -- sinon, a defaut d'echeance huile dans la source, la regle « vidange + filtre »
    if not ('oil' = any(kinds)) then
      select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into slines
        from public._maintenance_parts_for_needs(my.mid,
               jsonb_build_array(
                 jsonb_build_object('sc', 'oil', 'fc', 'filtre_huile',    'labels', array['regle : vidange de l''huile moteur et remplacement du filtre']),
                 jsonb_build_object('sc', 'oil', 'fc', 'bouchon_vidange', 'labels', array['regle : vidange de l''huile moteur et remplacement du filtre']),
                 jsonb_build_object('sc', 'oil', 'fc', 'huile_moteur',    'labels', array['regle : vidange de l''huile moteur et remplacement du filtre'])),
               case when src = 'manuel' then manuals else null end, _company) p
       where p.confidence <> 'non_applicable';
      r := public._maintenance_kit_put(_company, ekey, elabel, my.mid, 'oil', 'Entretien annuel + huile',
                                       'oil', null, 'catalogue', slines, null);
      kids := kids || (r ->> 'kit')::uuid; kinds := kinds || 'oil'::text;
      if oil_lines is null then oil_lines := slines; oil_name := 'Entretien annuel + huile'; end if;
      if r ->> 'state' = 'created' then created := created + 1; elsif r ->> 'state' = 'reused' then reused := reused + 1; else skipped := skipped + 1; end if;
      if (r ->> 'linked')::boolean then linked := linked + 1; end if;
      n_sur := n_sur + (r ->> 'sur')::int; n_multi := n_multi + (r ->> 'multi')::int; n_absent := n_absent + (r ->> 'absent')::int;
    end if;

    -- au minimum « annuel » : a defaut d'echeance annuelle dans le MANUEL, la
    -- colonne huile « ou 12 mois » en tient lieu (grille kilometrique, M-30) ;
    -- sinon (plan ou regle sans colonne annuelle) un kit vide, a completer par l'atelier
    if not ('annual' = any(kinds)) then
      r := public._maintenance_kit_put(_company, ekey, elabel, my.mid, 'annual', 'Entretien annuel', 'annual', null,
                                       src,
                                       case when src = 'manuel' then coalesce(oil_lines, '[]'::jsonb) else '[]'::jsonb end,
                                       case when src = 'manuel' and oil_lines is not null then oil_name else null end);
      kids := kids || (r ->> 'kit')::uuid; kinds := kinds || 'annual'::text;
      if r ->> 'state' = 'created' then created := created + 1; elsif r ->> 'state' = 'reused' then reused := reused + 1; else skipped := skipped + 1; end if;
      if (r ->> 'linked')::boolean then linked := linked + 1; end if;
      n_sur := n_sur + (r ->> 'sur')::int; n_multi := n_multi + (r ->> 'multi')::int; n_absent := n_absent + (r ->> 'absent')::int;
    end if;

    -- le modele-annee quitte les anciens kits NON corriges qui ne sont plus sa proposition
    delete from public.maintenance_kit_model_years y
     using public.maintenance_kits k
     where y.model_year_id = my.mid and not (y.kit_id = any(kids))
       and k.id = y.kit_id and k.company_id = _company
       and k.status = 'actif' and k.edited_at is null;
    get diagnostics n = row_count;
    unlinked := unlinked + n;
  end loop;

  -- un kit non corrige qui ne sert plus aucun modele-annee est archive (photo + version)
  if unlinked > 0 then
    for svc in
      select k.id from public.maintenance_kits k
       where k.company_id = _company and k.status = 'actif' and k.edited_at is null
         and not exists (select 1 from public.maintenance_kit_model_years y where y.kit_id = k.id)
    loop
      update public.maintenance_kits set status = 'archive', version = version + 1, updated_at = now() where id = svc.id;
      perform public._maintenance_kit_snapshot(svc.id, 'archive');
      archived := archived + 1;
    end loop;
  end if;

  res := jsonb_build_object(
    'model_years', seen, 'total_model_years', total, 'created', created, 'reused', reused,
    'linked', linked, 'skipped', skipped, 'unknown_family', unknown, 'unlinked', unlinked,
    'archived', archived, 'items_sur', n_sur, 'items_multi_ref', n_multi, 'items_absent', n_absent,
    'source_manuel', s_manuel, 'source_plan', s_plan, 'source_regle', s_regle, 'with_manual', w_manual,
    'offset', off, 'limit', lim,
    'next_offset', off + seen,
    'done', seen < lim or off + seen >= total,
    'elapsed_ms', round(extract(epoch from clock_timestamp() - t0) * 1000));

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'maintenance_kit_generate', 'maintenance_kits', _company::text,
          case when auth.uid() is null then 'script' else 'screen' end, null, res);

  return res;
end $$;

revoke all on function public.maintenance_kit_generate(uuid, integer, integer, text) from public, anon;
grant execute on function public.maintenance_kit_generate(uuid, integer, integer, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Tout le parc en une fonction, par lots. Depuis l'editeur SQL / psql
--    (`set statement_timeout = 0;` avant). Depuis l'ecran ou PostgREST (8 s),
--    passer `_max_batches` : la reponse donne `next_offset` et `done`.
--    Idempotente : relancer ne recree rien, ne touche aucun kit corrige.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_kit_generate_all(
  _company     uuid,
  _batch       integer default 25,
  _offset      integer default 0,
  _max_batches integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      jsonb;
  off    int := greatest(coalesce(_offset, 0), 0);
  b      int := greatest(coalesce(_batch, 25), 1);
  nb     int := 0;
  t0     timestamptz := clock_timestamp();
  tot    jsonb := jsonb_build_object('model_years', 0, 'created', 0, 'reused', 0, 'linked', 0, 'skipped', 0,
                                     'unknown_family', 0, 'unlinked', 0, 'archived', 0,
                                     'items_sur', 0, 'items_multi_ref', 0, 'items_absent', 0,
                                     'source_manuel', 0, 'source_plan', 0, 'source_regle', 0, 'with_manual', 0);
  k      text;
  done_  boolean := false;
begin
  if not public._maintenance_kit_may_generate(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  loop
    r := public.maintenance_kit_generate(_company, b, off, null);
    nb := nb + 1;
    for k in select jsonb_object_keys(tot) loop
      tot := jsonb_set(tot, array[k], to_jsonb((tot ->> k)::int + coalesce((r ->> k)::int, 0)));
    end loop;
    raise notice 'kits lot % : offset % -> % modeles-annees, % crees, % reutilises, % rattaches (% ms)',
      nb, off, r ->> 'model_years', r ->> 'created', r ->> 'reused', r ->> 'linked', r ->> 'elapsed_ms';
    off := (r ->> 'next_offset')::int;
    done_ := (r ->> 'done')::boolean;
    exit when done_ or (_max_batches is not null and nb >= _max_batches);
  end loop;

  tot := tot || jsonb_build_object(
    'total_model_years', r -> 'total_model_years', 'batches', nb, 'batch', b,
    'next_offset', off, 'done', done_,
    'elapsed_ms', round(extract(epoch from clock_timestamp() - t0) * 1000));

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'maintenance_kit_generate_all', 'maintenance_kits', _company::text,
          case when auth.uid() is null then 'script' else 'screen' end, null, tot);
  return tot;
end $$;

revoke all on function public.maintenance_kit_generate_all(uuid, integer, integer, integer) from public, anon;
grant execute on function public.maintenance_kit_generate_all(uuid, integer, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. Lectures : la liste compte les lignes a plusieurs references et les
--    absentes, et donne type et source ; le detail donne les references
--    trouvees et la provenance. (Type de retour modifie : drop + create.)
-- ---------------------------------------------------------------------
drop function if exists public.maintenance_kits_list(uuid, text);
create function public.maintenance_kits_list(_company uuid, _search text default null)
returns table(
  id uuid, engine_family_key text, engine_family_label text, service_code text, service_label text,
  version integer, status text, edited_at timestamptz, edited_by_name text,
  items_count integer, to_confirm_count integer, model_years_count integer, updated_at timestamptz,
  multi_ref_count integer, absent_count integer, service_kind text, source text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select k.id, k.engine_family_key, k.engine_family_label, k.service_code, k.service_label,
         k.version, k.status, k.edited_at,
         coalesce(nullif(btrim(p.full_name), ''), p.email),
         (select count(*)::int from public.maintenance_kit_items i where i.kit_id = k.id),
         (select count(*)::int from public.maintenance_kit_items i where i.kit_id = k.id and i.confidence = 'a_confirmer'),
         (select count(*)::int from public.maintenance_kit_model_years y where y.kit_id = k.id),
         k.updated_at,
         (select count(*)::int from public.maintenance_kit_items i where i.kit_id = k.id and cardinality(coalesce(i.catalog_refs, array[]::text[])) > 1),
         (select count(*)::int from public.maintenance_kit_items i where i.kit_id = k.id and i.confidence = 'absent'),
         k.service_kind, k.source
    from public.maintenance_kits k
    left join public.profiles p on p.id = k.edited_by
   where k.company_id = _company and k.status = 'actif'
     and (_search is null or btrim(_search) = ''
          or k.engine_family_label ilike '%' || btrim(_search) || '%'
          or k.service_label ilike '%' || btrim(_search) || '%')
   order by k.engine_family_label, coalesce(k.service_km, case k.service_kind when 'first_1000' then 1000 when 'annual' then 1 when 'oil' then 2 else 99999 end), k.service_label
   limit 2000;
end $$;

revoke all on function public.maintenance_kits_list(uuid, text) from public, anon;
grant execute on function public.maintenance_kits_list(uuid, text) to authenticated;

drop function if exists public.maintenance_kit_detail(uuid);
create function public.maintenance_kit_detail(_kit uuid)
returns table(
  id uuid, kit_id uuid, family_code text, article_id uuid, reference text, designation text,
  quantity numeric, unit text, kind text, confidence text, origin text,
  fluid_product text, fluid_spec text, note text, sort_order integer,
  mgmt_type text, bins text[], real_qty numeric, reserved_qty numeric, on_order_qty numeric,
  catalog_refs text[], provenance jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare cid uuid;
begin
  select k.company_id into cid from public.maintenance_kits k where k.id = _kit;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select i.id, i.kit_id, i.family_code, i.article_id,
         coalesce(i.reference, a.reference), i.designation,
         i.quantity, i.unit, i.kind, i.confidence, i.origin,
         i.fluid_product, i.fluid_spec, i.note, i.sort_order,
         a.mgmt_type::text,
         case when a.id is null then array[]::text[] else array(
           select distinct x.b from (
             select nullif(btrim(a.bin_location), '') as b
             union all select nullif(btrim(a.bin_location2), '')
             union all select nullif(btrim(ab.bin_location), '') from public.article_bins ab where ab.article_id = a.id
           ) x where x.b is not null order by x.b) end,
         st.real_qty, st.reserved_qty,
         case when a.id is null then 0 else public.article_on_order_for(a.id, null, null) end,
         coalesce(i.catalog_refs, array[]::text[]),
         i.provenance
    from public.maintenance_kit_items i
    left join public.articles a on a.id = i.article_id
    left join lateral public.article_stock(i.article_id) st on a.id is not null
   where i.kit_id = _kit
   order by i.sort_order, i.designation;
end $$;

revoke all on function public.maintenance_kit_detail(uuid) from public, anon;
grant execute on function public.maintenance_kit_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Le kit d'un modele-annee pour une echeance : MEME SIGNATURE (popup
--     « pieces manquantes », picking, commande depuis l'OR). Le code exact
--     d'abord ; sinon le meme TYPE (« oil » du plan = « oil_service » ou
--     « 15000_km » du manuel), la source la plus riche, le plus petit km ;
--     un kit corrige gagne a egalite.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_kit_for_model_year(
  _company uuid, _model_year_id text, _service_code text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select k.id
    from public.maintenance_kits k
    join public.maintenance_kit_model_years y on y.kit_id = k.id
   where k.company_id = _company and public.is_member(k.company_id)
     and y.model_year_id = _model_year_id
     and k.status = 'actif'
     and (k.service_code = _service_code
          or (k.service_kind is not null and k.service_kind = public.maintenance_service_kind_of(_service_code)))
   order by (k.service_code = _service_code) desc,
            case k.source when 'manuel' then 1 when 'plan' then 2 else 3 end,
            k.service_km nulls last,
            k.edited_at desc nulls last, k.version desc
   limit 1;
$$;

revoke all on function public.maintenance_kit_for_model_year(uuid, text, text) from public, anon;
grant execute on function public.maintenance_kit_for_model_year(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Couverture (manuels) : lignes par niveau et lignes a plusieurs references
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
    'needs',         (select count(distinct (model_year_id, service_code, family_code)) from p),
    'lines',         (select count(*) from p where confidence <> 'non_applicable'),
    'needs_firm',    (select count(distinct (model_year_id, service_code, family_code)) from p where not optional),
    'resolved_firm', (select count(distinct (model_year_id, service_code, family_code)) from p where not optional and confidence = 'sur'),
    'to_confirm',    (select count(*) from p where not optional and confidence = 'a_confirmer'),
    'multi_ref',     (select count(*) from p where cardinality(coalesce(references_, array[]::text[])) > 1),
    'absent',        (select count(*) from p where confidence = 'absent'),
    'optional_resolved', (select count(*) from p where optional and confidence = 'sur'),
    'by_family',     (select jsonb_object_agg(family_code, jsonb_build_object(
                        'needs', n, 'resolved', r, 'multi_ref', m, 'absent', ab))
                        from (select family_code, count(*) n,
                                     count(*) filter (where confidence = 'sur') r,
                                     count(*) filter (where cardinality(coalesce(references_, array[]::text[])) > 1) m,
                                     count(*) filter (where confidence = 'absent') ab
                                from p group by 1) z)
  );
$$;

revoke all on function public.maintenance_parts_coverage(integer, integer) from public, anon;
grant execute on function public.maintenance_parts_coverage(integer, integer) to authenticated;

notify pgrst, 'reload schema';
