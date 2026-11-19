-- =====================================================================
-- Rattrapage G8 (19/11/2026) -- essai a blanc du lot « forfaits G8 ».
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119140000_m8_forfaits_g8_structure.sql \
--      supabase/migrations/20261119141000_m8_forfaits_g8_donnees_italbike.sql \
--      supabase/migrations/20261119142000_m8_forfaits_g8_prix.sql \
--      supabase/migrations/20261119143000_m8_taux_mo_garantie_g8.sql \
--      supabase/tests/m8_forfaits_g8.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Scenario (ITALBIKE STORE) : articles forfait et 37 forfaits G8 ; prix par price_changes ; kits
-- d'essai (sans dependre des kits reels) : huile sans quantite -> forfait G8 de la famille moteur,
-- filtre introuvable -> filtre G8, huile de fourche en flacons, kit de vidange vide rempli, kit
-- vide d'une famille sans forfait G8 (V4) -> lignes standard seulement ; versions ; rejouable ;
-- un kit avec pieces passe avant un kit vide ; droits. Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

insert into _ctx values ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33');

-- ------------------------------------------------------------ 1. articles et forfaits
insert into _t(check_name, result)
select 'articles forfait : CONTRI et controles en F, MO en T, MOTO 4XT et CHAIN CLEANER en A',
       case when (select string_agg(a.reference || '=' || a.mgmt_type::text, ',' order by a.reference)
                    from public.articles a
                   where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
                     and a.reference in ('CONTRI', 'CONTROLE DES FREINS', 'MO', 'MOTO 4XT TECH EN FUT', 'CHAIN CLEANER'))
                 = 'CHAIN CLEANER=A,CONTRI=F,CONTROLE DES FREINS=F,MO=T,MOTO 4XT TECH EN FUT=A'
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select '37 forfaits G8 : type N, mode « nomenclature », aucune reference manquante',
       case when (select count(*) from public.articles a
                   where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.mgmt_type = 'N'
                     and a.kit_billing_mode = 'nomenclature'
                     and a.reference in (select distinct code from public._g8_forfaits_catalog())) = 37
             and jsonb_array_length(public._g8_forfaits_install('3d9f0f13-a691-4d07-ad58-34590df86e33') -> 'missing') = 0
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'ENTRETIEN ANNUEL 2 SOUPAPES : 14 lignes dans l''ordre G8 (huile 3,10 en premier, MO 1,80 h)',
       case when (select count(*) from public.article_kit_items k join public.articles p on p.id = k.kit_id
                   where p.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and p.reference = 'ENTRETIENANNUEL2SOUPAPES') = 14
             and (select c.reference || ':' || k.quantity from public.article_kit_items k
                    join public.articles p on p.id = k.kit_id join public.articles c on c.id = k.component_id
                   where p.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and p.reference = 'ENTRETIENANNUEL2SOUPAPES'
                   order by k.sort_order limit 1) = 'MOTO 4XT TECH EN FUT:3.100'
             and (select k.quantity from public.article_kit_items k
                    join public.articles p on p.id = k.kit_id join public.articles c on c.id = k.component_id
                   where p.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and p.reference = 'ENTRETIENANNUEL2SOUPAPES'
                     and c.reference = 'MO') = 1.8
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 2. prix (circuit trace)
insert into _t(check_name, result)
select 'prix : CONTRI 3,90 TTC, trace dans price_changes (origine import:g8_vraie_base) ; 44440035A non touche',
       case when (select a.sale_price_ttc from public.articles a where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.reference = 'CONTRI') = 3.90
             and exists (select 1 from public.price_changes pc join public.articles a on a.id = pc.article_id
                          where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.reference = 'CONTRI'
                            and pc.origin = 'import:g8_vraie_base' and pc.new_sale_ttc = 3.90)
             and not exists (select 1 from public.price_changes pc join public.articles a on a.id = pc.article_id
                              where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.reference = '44440035A'
                                and pc.origin = 'import:g8_vraie_base')
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'prix rejouables : un second passage ne change rien',
       case when (public._g8_prices_apply('3d9f0f13-a691-4d07-ad58-34590df86e33',
                    '[{"reference":"CONTRI","ht":3.22,"ttc":3.90}]'::jsonb, 'import:g8_vraie_base', false) ->> 'changed')::int = 0
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'taux MO garantie : 46,94 precharge aligne sur 83,00 (MO GARANTIE DWE)',
       case when (select (v.extra ->> 'hourly_rate_ht')::numeric from public.reference_values v
                   where v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and v.table_key = 'workshop_warranty' and v.code = 'mo') in (83.00)
            then 'ok' else 'KO (valeur saisie par le client ?)' end;

-- ------------------------------------------------------------ 3. kits d'essai
-- A : « 1000 SS » annuel + huile : huile sans quantite, filtre introuvable, huile de fourche 521 cc.
with k as (
  insert into public.maintenance_kits (company_id, engine_family_key, engine_family_label, service_code, service_label,
                                       content_hash, service_kind, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'essai_fg8_a', '1000 SS', 'oil', 'Entretien annuel + huile', 'essai-fg8-a', 'oil', 'plan')
  returning id)
insert into _ctx select 'kit_a', id::text from k;
insert into public.maintenance_kit_items (company_id, kit_id, family_code, designation, quantity, unit, kind, confidence, origin, note, provenance, sort_order)
values
  ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'kit_a'), 'huile_moteur', 'Huile moteur', 1, 'l',
   'consommable', 'a_confirmer', 'deduit', 'Quantite non donnee par la source : a lire dans le manuel ou a ajuster.', '{"besoin":"plan"}', 1),
  ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'kit_a'), 'filtre_huile', 'Filtre a huile', 1, null,
   'piece', 'absent', 'deduit', null, '{"besoin":"plan"}', 2),
  ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'kit_a'), 'huile_fourche', 'Huile de fourche', 521, 'cc',
   'consommable', 'a_confirmer', 'deduit', null, '{"besoin":"manuel","quantite":"manuel"}', 3);
-- B : « 696 » annuel + huile, VIDE.
with k as (
  insert into public.maintenance_kits (company_id, engine_family_key, engine_family_label, service_code, service_label,
                                       content_hash, service_kind, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'essai_fg8_b', '696', 'oil', 'Entretien annuel + huile', 'essai-fg8-b', 'oil', 'plan')
  returning id)
insert into _ctx select 'kit_b', id::text from k;
-- C : « PANIGALE V4 » annuel, VIDE (aucun forfait G8 pour les V4).
with k as (
  insert into public.maintenance_kits (company_id, engine_family_key, engine_family_label, service_code, service_label,
                                       content_hash, service_kind, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'essai_fg8_c', 'PANIGALE V4', 'oil', 'Entretien annuel + huile', 'essai-fg8-c', 'oil', 'plan')
  returning id)
insert into _ctx select 'kit_c', id::text from k;
insert into _ctx select 'v_a', version::text from public.maintenance_kits where id = (select v::uuid from _ctx where k = 'kit_a');

insert into _ctx select 'run1', public._maintenance_kit_complete((select v::uuid from _ctx where k = 'kit_a'), true)::text;
insert into _ctx select 'run_b', public._maintenance_kit_complete((select v::uuid from _ctx where k = 'kit_b'), true)::text;
insert into _ctx select 'run_c', public._maintenance_kit_complete((select v::uuid from _ctx where k = 'kit_c'), true)::text;

insert into _t(check_name, result)
select 'kit 1000 SS : huile = MOTO 4XT x 3,10, « quantite reprise du forfait G8 », plus « a confirmer »',
       case when (select a.reference || ':' || i.quantity || ':' || i.confidence || ':' || (i.provenance ->> 'quantite')
                    from public.maintenance_kit_items i join public.articles a on a.id = i.article_id
                   where i.kit_id = (select v::uuid from _ctx where k = 'kit_a') and i.family_code = 'huile_moteur')
                 = 'MOTO 4XT TECH EN FUT:3.100:sur:forfait_g8'
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'kit 1000 SS : filtre introuvable -> 44440035A du forfait G8 ; fourche 521 cc -> 1 flacon de 1 l (Q50), 521 cc garde en provenance',
       case when (select a.reference from public.maintenance_kit_items i join public.articles a on a.id = i.article_id
                   where i.kit_id = (select v::uuid from _ctx where k = 'kit_a') and i.family_code = 'filtre_huile') = '44440035A'
             and (select i.quantity || ':' || i.unit || ':' || (i.provenance -> 'liquide' ->> 'quantite_source')
                    from public.maintenance_kit_items i
                   where i.kit_id = (select v::uuid from _ctx where k = 'kit_a') and i.family_code = 'huile_fourche') = '1.000:flacon:521.000'
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'kit 1000 SS : 10 lignes standard (DDS, controles, PF, CONTRI) en « forfait », une seule nouvelle version tracee',
       case when (select count(*) from public.maintenance_kit_items i
                   where i.kit_id = (select v::uuid from _ctx where k = 'kit_a') and i.origin = 'defaut' and i.kind = 'forfait') = 10
             and (select version from public.maintenance_kits where id = (select v::uuid from _ctx where k = 'kit_a'))
                 = (select v::int + 1 from _ctx where k = 'v_a')
             and exists (select 1 from public.maintenance_kit_versions v
                          where v.kit_id = (select v::uuid from _ctx where k = 'kit_a') and v.reason = 'rattrapage G8'
                            and jsonb_array_length(v.items) = 13)
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'kit 696 vide : huile 3,10 + filtre 44440035A + joint 85250261A + 10 lignes standard',
       case when (select string_agg(coalesce(a.reference, '?') || ':' || i.quantity, ',' order by i.sort_order)
                    from public.maintenance_kit_items i left join public.articles a on a.id = i.article_id
                   where i.kit_id = (select v::uuid from _ctx where k = 'kit_b') and i.origin <> 'defaut')
                 = '44440035A:1.000,85250261A:1.000,MOTO 4XT TECH EN FUT:3.100'
             and (select count(*) from public.maintenance_kit_items i where i.kit_id = (select v::uuid from _ctx where k = 'kit_b')) = 13
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'kit V4 vide : huile rattachee mais « quantite a verifier », pas de filtre invente, lignes standard',
       case when (select i.confidence || ':' || i.quantity from public.maintenance_kit_items i
                   where i.kit_id = (select v::uuid from _ctx where k = 'kit_c') and i.family_code = 'huile_moteur' and i.article_id is not null)
                 = 'a_confirmer:1.000'
             and not exists (select 1 from public.maintenance_kit_items i
                              where i.kit_id = (select v::uuid from _ctx where k = 'kit_c') and i.family_code = 'filtre_huile')
             and (select count(*) from public.maintenance_kit_items i where i.kit_id = (select v::uuid from _ctx where k = 'kit_c') and i.origin = 'defaut') = 10
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'rejouable : un second passage ne change rien (ni ligne, ni version)',
       case when public._maintenance_kit_complete((select v::uuid from _ctx where k = 'kit_a'), true)
                 = '{"filled": 0, "fluids": 0, "defaults": 0}'::jsonb
             and public._maintenance_kit_complete((select v::uuid from _ctx where k = 'kit_b'), true)
                 = '{"filled": 0, "fluids": 0, "defaults": 0}'::jsonb
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 4. choix du kit : pieces avant vide
insert into _ctx values ('my', 'essai-fg8-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
insert into public.ducati_catalog_model_years (id, model_id, code, year, name)
select (select v from _ctx where k = 'my'), my.model_id, 'ES', my.year, 'ESSAI FORFAITS G8 (transaction annulee)'
  from public.ducati_catalog_model_years my order by my.id limit 1;
with k as (
  insert into public.maintenance_kits (company_id, engine_family_key, engine_family_label, service_code, service_label,
                                       content_hash, service_kind, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'essai_fg8_d', 'ESSAI', 'annual', 'Entretien annuel', 'essai-fg8-d', 'annual', 'manuel')
  returning id)
insert into _ctx select 'kit_empty', id::text from k;
with k as (
  insert into public.maintenance_kits (company_id, engine_family_key, engine_family_label, service_code, service_label,
                                       content_hash, service_kind, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'essai_fg8_e', 'ESSAI', 'annual_service', 'Annual Service', 'essai-fg8-e', 'annual', 'catalogue')
  returning id)
insert into _ctx select 'kit_parts', id::text from k;
insert into public.maintenance_kit_items (company_id, kit_id, article_id, reference, designation, quantity, kind, confidence, origin, sort_order)
select '3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'kit_parts'), a.id, a.reference, a.designation, 1, 'piece', 'sur', 'deduit', 1
  from public.articles a where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.reference = '44440035A';
insert into public.maintenance_kit_model_years (kit_id, model_year_id)
select (select v::uuid from _ctx where k = x), (select v from _ctx where k = 'my') from unnest(array['kit_empty', 'kit_parts']) x;
insert into _ctx select 'dl_empty', public._maintenance_kit_add_default_lines((select v::uuid from _ctx where k = 'kit_empty'))::text;

insert into _t(check_name, result)
select 'choix du kit : le kit avec pieces gagne sur le kit au code exact qui n''a que des lignes standard',
       case when public._workshop_kit_for('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v from _ctx where k = 'my'), 'annual')
                 = (select v::uuid from _ctx where k = 'kit_parts')
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'les lignes de service ne sortent pas comme pieces de l''entretien (reservation, preparation)',
       case when not exists (select 1 from public._workshop_service_kit_items('3d9f0f13-a691-4d07-ad58-34590df86e33',
                                       (select v from _ctx where k = 'my'), 'annual') s where s.kind = 'forfait')
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 5. droits
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.maintenance_kits_complete('3d9f0f13-a691-4d07-ad58-34590df86e33', true, 1, 0);
  insert into _t(check_name, result) values ('droits : un inconnu ne lance pas le rattrapage', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('droits : un inconnu ne lance pas le rattrapage', 'ok');
end $$;
do $$ begin
  perform public.maintenance_kit_default_line_save('3d9f0f13-a691-4d07-ad58-34590df86e33',
    (select a.id from public.articles a where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.reference = 'TEST MOTO'), 1);
  insert into _t(check_name, result) values ('droits : un inconnu ne change pas les lignes par defaut', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('droits : un inconnu ne change pas les lignes par defaut', 'ok');
end $$;
reset role;

select n, check_name, result from _t order by n;
