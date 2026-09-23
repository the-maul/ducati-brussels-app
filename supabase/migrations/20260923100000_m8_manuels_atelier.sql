-- =====================================================================
-- Mission 07, carte 3 — « Lier nos documents d'entretien au modèle » (ATE014) :
-- manuels d'atelier Ducati (Workshop Service Manual) extraits du DM Ducati.
--
-- Source : C:\Users\simon\Desktop\ducati\manuels-extraits\ (extraction locale, accord Ducati) :
--   * entretien\<famille>\<modele>-<annee>.json : 469 modèles-années — programme d'entretien
--     concessionnaire (échéances km / mi / mois, opérations), liste des 1 000 km, programme client,
--     pré-livraison, ravitaillements, couples de serrage généraux, outils spéciaux, produits,
--     temps réels en UT (1 UT = 6 min) ;
--   * parcours\<id>.json : 3 336 procédures uniques (36 326 étapes) — texte, figures, outils,
--     produits, couples, avertissements.
--
-- Décision M-25 : tables `wsm_*` distinctes de `maintenance_*`.
--   `maintenance_*` vient des fiches PDF « Entretien Transparent » (59 plans, temps commerciaux) ;
--   `wsm_*` vient des manuels d'atelier (le geste technique, par modèle-année exact). Deux sources,
--   deux granularités, deux cycles de mise à jour : on ne les mélange pas, on les rapproche par le
--   modèle-année du catalogue (`ducati_catalog_model_years`).
--
-- Déduplication conservée : une procédure partagée par plusieurs modèles-années n'est stockée
-- qu'une fois (`wsm_procedures`, clé = identifiant de parcours de l'extraction) ; ses usages sont
-- dans `wsm_procedure_usages`. 3 336 procédures pour 22 741 usages.
--
-- Traçabilité : chaque valeur garde sa source — manuel (`manual_root`), chemin du DM (`dm_path`),
-- identifiant du module (`dm_id`), titre, code (WSM.xxx.xxx.xxxx), version et date de mise à jour.
--
-- Tables GLOBALES (sans company_id), comme le catalogue Ducati (M-19) et les plans (M-21) :
-- donnée de référence commune aux deux sociétés. Lecture : comptes de l'équipe
-- (`ducati_catalog_is_staff`). Écriture : uniquement par `wsm_ingest_*` (chargeur
-- tools/wsm-loader, clé de service ; ou administrateur). Une ligne `events` par appel du chargeur,
-- jamais par ligne.
--
-- Idempotent : empreinte de contenu par modèle-année (`wsm_manuals.content_hash`) et par procédure
-- (`wsm_procedures.content_hash`) ; les lignes filles ont une clé de contenu (`row_key`) calculée
-- par le chargeur. Relancer ne crée aucun doublon.
--
-- Images : les 105 436 fichiers (52 Go) ne sont pas dans le dépôt ni en base. `wsm_images` tient
-- l'inventaire des 26 402 images citées par les procédures et l'état de leur envoi dans le bucket
-- Supabase Storage `wsm-images` (lecture authentifiée), rempli par tools/wsm-loader/images.mjs.
--
-- Additif uniquement. Aucune donnée écrite par la migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Manuels : un par modèle-année
-- ---------------------------------------------------------------------
create table if not exists public.wsm_manuals (
  id                text primary key,            -- identifiant modèle-année du DM Ducati (myId, ex. « 406 »)
  family            text not null,               -- famille telle qu'imprimée (DESERT X, MONSTER…)
  supermodel        text,
  model             text not null,
  model_year        integer not null,
  manual_root       text,                        -- racine du manuel dans le DM
  section           text,                        -- section d'entretien du manuel
  dm_family_id      text,
  dm_supermodel_id  text,
  dm_model_id       text,
  nodes_count       integer,                     -- nœuds du manuel (indicatif d'exhaustivité)
  services_count    integer not null default 0,
  operations_count  integer not null default 0,
  procedures_count  integer not null default 0,  -- procédures citées (dédupliquées globalement)
  times_count       integer not null default 0,
  gaps              jsonb not null default '[]'::jsonb,   -- ce que l'extraction n'a pas trouvé
  source_file       text,                        -- chemin relatif dans l'extraction
  extracted_at      timestamptz,                 -- date de génération de l'extraction
  content_hash      text not null,
  loaded_at         timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_wsm_manuals_family on public.wsm_manuals(family, model_year);
create index if not exists idx_wsm_manuals_year on public.wsm_manuals(model_year);

comment on table public.wsm_manuals is 'Manuel d''atelier Ducati d''un modèle-année (mission 07, carte 3). Donnée de référence globale, écrite par wsm_ingest_manual.';
comment on column public.wsm_manuals.id is 'Identifiant modèle-année du DM Ducati (myId). Souvent, mais pas toujours, égal à ducati_catalog_model_years.id : le rattachement passe par wsm_manual_catalog_links.';

-- Rattachement manuel ↔ modèle-année du catalogue (même principe que maintenance_plan_catalog_links).
create table if not exists public.wsm_manual_catalog_links (
  id             uuid primary key default gen_random_uuid(),
  manual_id      text not null references public.wsm_manuals(id) on delete cascade,
  model_year_id  text not null references public.ducati_catalog_model_years(id) on delete cascade,
  status         text not null check (status in ('lie', 'a_valider', 'rejete')),
  origin         text not null default 'id_ecatalog'
                 check (origin in ('id_ecatalog', 'nom_annee', 'manuel')),
  reason         text,
  proposed_at    timestamptz not null default now(),
  decided_by     uuid references auth.users(id) on delete set null,
  decided_at     timestamptz,
  unique (manual_id, model_year_id)
);
create index if not exists idx_wsm_links_model_year on public.wsm_manual_catalog_links(model_year_id);
create index if not exists idx_wsm_links_status on public.wsm_manual_catalog_links(status);

comment on table public.wsm_manual_catalog_links is 'Manuel d''atelier ↔ modèle-année du catalogue Ducati. lie / a_valider / rejete ; origine id_ecatalog (identifiant identique), nom_annee (nom + millésime) ou manuel (décidé à l''écran).';

-- ---------------------------------------------------------------------
-- 2. Programme d'entretien officiel : échéances et opérations
-- ---------------------------------------------------------------------
create table if not exists public.wsm_services (
  id            uuid primary key default gen_random_uuid(),
  manual_id     text not null references public.wsm_manuals(id) on delete cascade,
  code          text not null,                   -- clé stable : nom d'échéance normalisé
  name          text not null,                   -- nom tel qu'imprimé (Oil Service, Desmo Service…)
  km            integer,
  mi            integer,
  months        integer,
  first_service boolean not null default false,  -- première échéance (1 000 km)
  definition    text,                            -- définition imprimée de l'échéance
  text          text,
  first_reached boolean not null default true,   -- décision M-16 : le premier atteint (km ou mois)
  sort          integer not null default 0,
  unique (manual_id, code)
);
create index if not exists idx_wsm_services_manual on public.wsm_services(manual_id);

comment on table public.wsm_services is 'Échéance du programme d''entretien officiel d''un manuel (1 000 km, Oil Service, Desmo Service / Valve Check, Annual Service…).';

create table if not exists public.wsm_operations (
  id                 uuid primary key default gen_random_uuid(),
  manual_id          text not null references public.wsm_manuals(id) on delete cascade,
  row_key            text not null,              -- clé de contenu calculée par le chargeur
  scope              text not null default 'concessionnaire'
                     check (scope in ('concessionnaire', 'client', 'liste_1000', 'graissage')),
  n                  integer,
  label              text not null,
  group_label        text,
  service_codes      text[] not null default '{}',  -- échéances où l'opération est due
  periodicity_km     integer,
  periodicity_months integer,
  sort               integer not null default 0,
  unique (manual_id, row_key)
);
create index if not exists idx_wsm_operations_manual on public.wsm_operations(manual_id, scope, sort);
create index if not exists idx_wsm_operations_services on public.wsm_operations using gin (service_codes);

comment on table public.wsm_operations is 'Opération du programme d''entretien : concessionnaire, client, liste des 1 000 km ou points de graissage. service_codes = échéances concernées (wsm_services.code).';

-- ---------------------------------------------------------------------
-- 3. Procédures dédupliquées, leurs usages et leurs étapes
-- ---------------------------------------------------------------------
create table if not exists public.wsm_procedures (
  id                 text primary key,           -- identifiant de parcours de l'extraction (20 hex)
  title              text not null,
  roles              text[] not null default '{}',  -- procedure, procedure-annexe, liee, prelivraison
  source_manual_root text,
  source_dm_path     text,
  source_dm_id       text,
  source_title       text,
  source_code        text,                       -- code Ducati (WSM.160.004.0207)
  source_version     text,
  source_updated_at  date,                       -- date de mise à jour du module dans le DM
  intervention       jsonb,                      -- opération et échéances d'entretien rattachées
  tools              jsonb not null default '[]'::jsonb,    -- outils spécifiques
  products           jsonb not null default '[]'::jsonb,
  warnings           jsonb not null default '[]'::jsonb,    -- avertissements généraux
  intro_figures      jsonb not null default '[]'::jsonb,
  times              jsonb not null default '[]'::jsonb,
  steps_count        integer not null default 0,
  figures_count      integer not null default 0,
  torques_count      integer not null default 0,
  usages_count       integer not null default 0, -- modèles-années qui partagent cette procédure
  content_hash       text not null,
  loaded_at          timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_wsm_procedures_title on public.wsm_procedures(title);
create index if not exists idx_wsm_procedures_code on public.wsm_procedures(source_code);

comment on table public.wsm_procedures is 'Procédure d''atelier, stockée une seule fois même si plusieurs modèles-années la partagent (mission 07, carte 3). Ses usages sont dans wsm_procedure_usages.';

create table if not exists public.wsm_procedure_usages (
  procedure_id      text not null references public.wsm_procedures(id) on delete cascade,
  manual_id         text not null references public.wsm_manuals(id) on delete cascade,
  role              text not null default 'procedure',
  operation         text,                        -- opération d'entretien du programme, si citée
  dm_path           text,                        -- chemin du module POUR CE modèle-année
  dm_id             text,
  version           text,
  source_updated_at date,
  sort              integer not null default 0,
  primary key (procedure_id, manual_id, role)
);
create index if not exists idx_wsm_usages_manual on public.wsm_procedure_usages(manual_id, role, sort);

comment on table public.wsm_procedure_usages is 'Usage d''une procédure par un modèle-année, avec le chemin du DM propre à ce modèle-année (la procédure elle-même n''est stockée qu''une fois).';

create table if not exists public.wsm_procedure_steps (
  id           uuid primary key default gen_random_uuid(),
  procedure_id text not null references public.wsm_procedures(id) on delete cascade,
  n            integer not null,
  phase        text,
  sub_phase    text,
  text         text,
  sub_steps    jsonb not null default '[]'::jsonb,
  figures      jsonb not null default '[]'::jsonb,   -- {src, zoom, local, localMiniature}
  tools        jsonb not null default '[]'::jsonb,
  products     jsonb not null default '[]'::jsonb,
  torques      jsonb not null default '[]'::jsonb,
  marks        jsonb not null default '[]'::jsonb,   -- repères de la figure
  warnings     jsonb not null default '[]'::jsonb,
  symbols      jsonb not null default '[]'::jsonb,
  tables       jsonb not null default '[]'::jsonb,
  videos       jsonb not null default '[]'::jsonb,
  links        jsonb not null default '[]'::jsonb,
  unique (procedure_id, n)
);
create index if not exists idx_wsm_steps_procedure on public.wsm_procedure_steps(procedure_id, n);

comment on table public.wsm_procedure_steps is 'Étape d''une procédure d''atelier : texte, figures (chemins d''images), outils, produits, couples, avertissements.';

create table if not exists public.wsm_procedure_torques (
  id           uuid primary key default gen_random_uuid(),
  procedure_id text not null references public.wsm_procedures(id) on delete cascade,
  row_key      text not null,
  step_n       integer,
  value_nm     numeric(8,2),
  min_nm       numeric(8,2),
  max_nm       numeric(8,2),
  tolerance    text,
  marks        text[] not null default '{}',
  text         text,
  sort         integer not null default 0,
  unique (procedure_id, row_key)
);
create index if not exists idx_wsm_torques_procedure on public.wsm_procedure_torques(procedure_id, sort);

comment on table public.wsm_procedure_torques is 'Couple de serrage cité par une étape de procédure (valeur, mini, maxi, repères, texte imprimé).';

-- Procédures rattachées à une échéance d'entretien pour un modèle-année donné.
create table if not exists public.wsm_service_procedures (
  id           uuid primary key default gen_random_uuid(),
  manual_id    text not null references public.wsm_manuals(id) on delete cascade,
  service_code text not null,
  procedure_id text not null references public.wsm_procedures(id) on delete cascade,
  operation    text,
  sort         integer not null default 0,
  unique (manual_id, service_code, procedure_id)
);
create index if not exists idx_wsm_service_procs_manual on public.wsm_service_procedures(manual_id, service_code, sort);

comment on table public.wsm_service_procedures is 'Procédure à exécuter pour une échéance d''entretien d''un modèle-année (programme officiel).';

-- ---------------------------------------------------------------------
-- 4. Annexes du manuel : couples généraux, outils, produits, ravitaillements, temps
-- ---------------------------------------------------------------------
-- Les lignes de ces tableaux sont lues en bloc (un tableau entier à l'écran) : on les garde en
-- jsonb sur la ligne du tableau plutôt qu'en 150 356 lignes filles — même information, requête
-- en une lecture d'index.
create table if not exists public.wsm_torque_tables (
  id                 uuid primary key default gen_random_uuid(),
  manual_id          text not null references public.wsm_manuals(id) on delete cascade,
  row_key            text not null,
  title              text not null,
  source_manual_root text,
  source_dm_path     text,
  source_dm_id       text,
  source_code        text,
  source_version     text,
  source_updated_at  date,
  lines_count        integer not null default 0,
  lines              jsonb not null default '[]'::jsonb,
  sort               integer not null default 0,
  unique (manual_id, row_key)
);
create index if not exists idx_wsm_torque_tables_manual on public.wsm_torque_tables(manual_id, sort);

comment on table public.wsm_torque_tables is 'Tableau de couples de serrage généraux d''un manuel (moteur, cadre…) ; lignes en jsonb, lues en bloc.';

create table if not exists public.wsm_tool_sets (
  id                 uuid primary key default gen_random_uuid(),
  manual_id          text not null references public.wsm_manuals(id) on delete cascade,
  row_key            text not null,
  title              text not null,
  source_manual_root text,
  source_dm_path     text,
  source_dm_id       text,
  source_code        text,
  source_version     text,
  source_updated_at  date,
  tools_count        integer not null default 0,
  tools              jsonb not null default '[]'::jsonb,
  sort               integer not null default 0,
  unique (manual_id, row_key)
);
create index if not exists idx_wsm_tool_sets_manual on public.wsm_tool_sets(manual_id, sort);

comment on table public.wsm_tool_sets is 'Jeu d''outils spéciaux d''un manuel (équipement spécifique moteur, cadre…).';

create table if not exists public.wsm_fluid_tables (
  id                 uuid primary key default gen_random_uuid(),
  manual_id          text not null references public.wsm_manuals(id) on delete cascade,
  row_key            text not null,
  title              text,
  source_manual_root text,
  source_dm_path     text,
  source_dm_id       text,
  source_code        text,
  source_version     text,
  source_updated_at  date,
  lines_count        integer not null default 0,
  lines              jsonb not null default '[]'::jsonb,   -- produit, usage, quantité
  warnings           jsonb not null default '[]'::jsonb,
  notes              jsonb not null default '[]'::jsonb,
  sort               integer not null default 0,
  unique (manual_id, row_key)
);
create index if not exists idx_wsm_fluids_manual on public.wsm_fluid_tables(manual_id, sort);

comment on table public.wsm_fluid_tables is 'Ravitaillements et lubrifiants d''un manuel : produits, usages et quantités.';

create table if not exists public.wsm_product_tables (
  id                 uuid primary key default gen_random_uuid(),
  manual_id          text not null references public.wsm_manuals(id) on delete cascade,
  row_key            text not null,
  title              text,
  source_manual_root text,
  source_dm_path     text,
  source_dm_id       text,
  source_code        text,
  source_version     text,
  source_updated_at  date,
  products_count     integer not null default 0,
  products           jsonb not null default '[]'::jsonb,
  sort               integer not null default 0,
  unique (manual_id, row_key)
);
create index if not exists idx_wsm_products_manual on public.wsm_product_tables(manual_id, sort);

comment on table public.wsm_product_tables is 'Caractéristiques des produits (graisses, huiles, freins-filets…) citées par un manuel.';

-- Temps réels du manuel, en unités de travail (1 UT = 6 min).
create table if not exists public.wsm_times (
  id                 uuid primary key default gen_random_uuid(),
  manual_id          text not null references public.wsm_manuals(id) on delete cascade,
  row_key            text not null,
  label              text not null,              -- intitulé imprimé (OIL SERVICE 1000…)
  service_code       text,                       -- échéance rapprochée, si reconnue
  time_text          text,                       -- « 1h:06min (11 UT) »
  minutes            integer,
  ut                 integer,                    -- unités de travail (1 UT = 6 min)
  values_doc         text[] not null default '{}',
  source_manual_root text,
  source_dm_path     text,
  source_dm_id       text,
  source_code        text,
  source_version     text,
  source_updated_at  date,
  sort               integer not null default 0,
  unique (manual_id, row_key)
);
create index if not exists idx_wsm_times_manual on public.wsm_times(manual_id, sort);
create index if not exists idx_wsm_times_service on public.wsm_times(manual_id, service_code);

comment on table public.wsm_times is 'Temps réel du manuel d''atelier, en UT (1 UT = 6 min) et en minutes. Différent de maintenance_service_times, qui vient des posters « Entretien Transparent ».';

-- ---------------------------------------------------------------------
-- 5. Images : inventaire et envoi dans Supabase Storage
-- ---------------------------------------------------------------------
-- Les fichiers eux-mêmes restent hors du dépôt (105 436 images, 52 Go). Seules les 26 402 images
-- citées par les procédures sont inventoriées ici ; l'envoi dans le bucket « wsm-images » est fait
-- par tools/wsm-loader/images.mjs, reprise possible (uploaded_at non nul = déjà envoyée).
create table if not exists public.wsm_images (
  path          text primary key,                -- chemin local dans l'extraction (images/edocdmimages/…)
  kind          text not null default 'figure'
                check (kind in ('figure', 'miniature')),
  storage_path  text,                            -- objet dans le bucket wsm-images
  bytes         bigint,
  sha256        text,
  uploaded_at   timestamptz,
  used_count    integer not null default 0,      -- étapes qui la citent
  updated_at    timestamptz not null default now()
);
create index if not exists idx_wsm_images_pending on public.wsm_images(path) where uploaded_at is null;

comment on table public.wsm_images is 'Inventaire des images citées par les procédures d''atelier et état de leur envoi dans le bucket Supabase Storage « wsm-images » (lecture authentifiée). Les fichiers ne sont jamais dans le dépôt.';

-- ---------------------------------------------------------------------
-- 6. RLS : lecture équipe, aucune écriture directe
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['wsm_manuals', 'wsm_manual_catalog_links', 'wsm_services', 'wsm_operations',
    'wsm_procedures', 'wsm_procedure_usages', 'wsm_procedure_steps', 'wsm_procedure_torques',
    'wsm_service_procedures', 'wsm_torque_tables', 'wsm_tool_sets', 'wsm_fluid_tables',
    'wsm_product_tables', 'wsm_times', 'wsm_images']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.ducati_catalog_is_staff()))', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. Qui peut écrire / rattacher
-- ---------------------------------------------------------------------
-- Écriture des données de référence : chargeur (clé de service) ou administrateur.
create or replace function public._wsm_can_write()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (auth.uid() is not null and exists (
            select 1 from public.user_roles ur
             where ur.user_id = auth.uid() and ur.role = 'admin' and public.is_admin(ur.company_id)));
$$;
revoke all on function public._wsm_can_write() from public, anon, authenticated;

-- Rattachement manuel ↔ catalogue : administrateur ou chef d'atelier de la société.
create or replace function public._wsm_can_link(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (_company is not null and (public.is_admin(_company) or public.has_role(_company, 'chef_atelier')));
$$;
revoke all on function public._wsm_can_link(uuid) from public, anon, authenticated;

-- Lecture : tout compte de l'équipe (ou la clé de service).
create or replace function public._wsm_can_read()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.ducati_catalog_is_staff() or coalesce(auth.role(), '') = 'service_role';
$$;
revoke all on function public._wsm_can_read() from public, anon, authenticated;
