-- =====================================================================
-- Rattrapage G8 (19/11/2026) — lot « forfaits G8 » : STRUCTURE (aucune donnee ecrite ici).
-- « Un G8 upgrade » : tout ce que G8 met dans un entretien doit exister dans le DMS.
--
-- 1. Les articles « forfait » de G8 (CONTRI, PETITES FOURNITURES, APPAREIL DE DIAGNOTI = DDS,
--    les controles a 0 €, PRISE EN CHARGE) et les produits / liquides / filtre absents (PRODUITS
--    NETTOYAGE MOT, MOTO 4XT TECH EN FUT au litre, HUILE DE FREIN DOT 5, HUILE DE FOURCHE ELF,
--    FILTRE A HUILE 1199). Types de gestion (B1) : F pour les lignes de service non physiques (ni
--    stock, ni preparation, ni commande, ni reservation) ; A pour ce qui est stocke ; T pour la
--    main-d'oeuvre : la ligne MO_ATELIER des forfaits G8 (supprimee de la vraie base G8, 0 €)
--    pointe vers l'article MO du DMS, sans prix force (taux horaire de l'atelier a l'insertion).
--    Crees a 0 € : les PRIX passent par un bloc separe (20261119142000) et par price_changes.
-- 2. Les 37 nomenclatures G8 reprises telles quelles avec le mecanisme EXISTANT des forfaits
--    d'article : article parent de type N, `kit_billing_mode = 'nomenclature'` (prix = somme des
--    lignes, comme G8 : la colonne « prix forfait TTC » de G8 est vide partout), composants dans
--    `article_kit_items` (+ `sort_order` pour garder l'ordre de la fiche G8). Pas de second systeme.
-- 3. Liquides des kits d'entretien : le reglage existant `maintenance_fluid_articles` (liquide ->
--    article) recoit l'unite de vente, la contenance et l'arrondi ; une table de profils moteur
--    (`maintenance_engine_profiles`) donne la quantite d'huile des forfaits G8 par famille moteur
--    quand la source ne la donne pas, le filtre et le joint de vidange.
-- 4. Lignes ajoutees par defaut a chaque kit (`maintenance_kit_default_lines`) : DDS, controles,
--    tension et graissage, petites fournitures, CONTRI.
-- Le generateur de kits applique 3 et 4 aux kits qu'il cree ; `maintenance_kits_complete` fait le
-- rattrapage des kits existants (versionne dans maintenance_kit_versions, trace dans events).
-- Les lignes de service (type F / T) ne vont ni en preparation (picking), ni en reservation, ni en
-- commande : `_workshop_service_kit_items` les ignore, la preparation ignore les lignes F/T de l'OR.
--
-- Choix du kit d'un modele-annee (`_workshop_kit_for`) : un kit qui contient des pieces passe avant
-- un kit vide du meme type (avant, un kit vide au code exact gagnait : le RDV ne reservait rien).
--
-- Additif, rejouable. Redefinit (meme signature) : _maintenance_kit_put, _workshop_kit_for,
-- _workshop_service_kit_items, picking_open_for_repair_order, maintenance_kit_item_save,
-- maintenance_fluid_article_set.
-- Donnees : 20261119141000 (ITALBIKE STORE) ; prix : 20261119142000 (formation, a confirmer).
-- Miroir TS : src/modules/workshop/forfaits/g8-catalog.ts, src/modules/workshop/kits/fluid-rules.ts
-- (tests/forfaits-g8.test.ts). Essai a blanc : supabase/tests/m8_forfaits_g8.sql.
-- =====================================================================

do $$ begin
  if to_regprocedure('public._workshop_service_kit_items(uuid, text, text)') is null
     or to_regprocedure('public._maintenance_kit_put(uuid, text, text, text, text, text, text, integer, text, jsonb, text)') is null then
    raise exception 'Appliquer d''abord 20261103200000 (generation des kits) et 20261103270000 (reservation atelier).';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Lignes de kit : type « forfait » (ligne de service F/T) et origine « defaut »
-- ---------------------------------------------------------------------
alter table public.maintenance_kit_items drop constraint if exists maintenance_kit_items_kind_check;
alter table public.maintenance_kit_items
  add constraint maintenance_kit_items_kind_check check (kind in ('piece', 'consommable', 'forfait'));
alter table public.maintenance_kit_items drop constraint if exists maintenance_kit_items_origin_check;
alter table public.maintenance_kit_items
  add constraint maintenance_kit_items_origin_check check (origin in ('deduit', 'ajoute', 'defaut'));

comment on column public.maintenance_kit_items.kind is
  'piece (A/N/M) | consommable (liquide) | forfait (ligne de service G8 : type F ou T, ni stock ni preparation).';

-- Ordre des lignes d'un forfait d'article (fiche G8).
alter table public.article_kit_items add column if not exists sort_order integer not null default 0;

-- ---------------------------------------------------------------------
-- 2. Liquide -> article : unite de vente, contenance d'une unite, arrondi a l'unite
-- ---------------------------------------------------------------------
alter table public.maintenance_fluid_articles add column if not exists sale_unit text;
alter table public.maintenance_fluid_articles add column if not exists liters_per_unit numeric(10,3);
alter table public.maintenance_fluid_articles add column if not exists whole_units boolean not null default false;
alter table public.maintenance_fluid_articles drop constraint if exists maintenance_fluid_articles_lpu_check;
alter table public.maintenance_fluid_articles
  add constraint maintenance_fluid_articles_lpu_check check (liters_per_unit is null or liters_per_unit > 0);
comment on column public.maintenance_fluid_articles.liters_per_unit is
  'Contenance d''une unite de vente en litres (1 = vendu au litre ; 0,5 = flacon de 50 cl). Null = quantite reprise telle quelle.';
comment on column public.maintenance_fluid_articles.whole_units is
  'Vrai : quantite arrondie a l''unite superieure (flacons).';

-- ---------------------------------------------------------------------
-- 3. Profils moteur : quantite d'huile, filtre et joint de vidange des forfaits G8
-- ---------------------------------------------------------------------
create table if not exists public.maintenance_engine_profiles (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  code              text not null,
  label             text not null,
  priority          integer not null default 100,
  match_pattern     text not null,
  exclude_pattern   text,
  year_from         integer,
  year_to           integer,
  oil_article_id    uuid references public.articles(id) on delete set null,   -- null = article du reglage « huile moteur »
  oil_quantity      numeric(10,3) check (oil_quantity is null or oil_quantity > 0),
  filter_article_id uuid references public.articles(id) on delete set null,
  washer_article_id uuid references public.articles(id) on delete set null,
  g8_forfait        text,
  is_active         boolean not null default true,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id) on delete set null,
  unique (company_id, code)
);
comment on table public.maintenance_engine_profiles is
  'Par famille moteur (motif lu sur le libelle du kit et les modeles du catalogue) : quantite d''huile, filtre et joint de vidange repris des forfaits G8.';

create table if not exists public.maintenance_kit_default_lines (
  company_id uuid not null references public.companies(id) on delete cascade,
  article_id uuid not null references public.articles(id) on delete cascade,
  quantity   numeric(12,3) not null default 1 check (quantity > 0),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (company_id, article_id)
);
comment on table public.maintenance_kit_default_lines is
  'Lignes ajoutees a chaque kit d''entretien (comme G8 : DDS, controles, petites fournitures, CONTRI).';

alter table public.maintenance_engine_profiles   enable row level security;
alter table public.maintenance_kit_default_lines enable row level security;
do $$ begin
  create policy mep_read on public.maintenance_engine_profiles for select to authenticated using (public.is_member(company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mkdl_read on public.maintenance_kit_default_lines for select to authenticated using (public.is_member(company_id));
exception when duplicate_object then null; end $$;
revoke insert, update, delete on public.maintenance_engine_profiles   from anon, authenticated;
revoke insert, update, delete on public.maintenance_kit_default_lines from anon, authenticated;
do $$ begin
  create trigger trg_maintenance_engine_profiles_audit after insert or update or delete on public.maintenance_engine_profiles
    for each row execute function public.audit_row();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_maintenance_kit_default_lines_audit after insert or update or delete on public.maintenance_kit_default_lines
    for each row execute function public.audit_row();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_maintenance_fluid_articles_audit after insert or update or delete on public.maintenance_fluid_articles
    for each row execute function public.audit_row();
exception when duplicate_object then null; end $$;

-- Qui regle les kits : administrateur, chef d'atelier, magasinier (meme regle que le remplacement
-- de reference dans les kits) ; le script de l'agence (service_role) et les migrations (sans jwt).
create or replace function public._maintenance_kit_may_configure(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select _company is not null and (
    auth.uid() is null and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
    or public.is_admin(_company) or public.has_role(_company, 'chef_atelier') or public.has_role(_company, 'magasinier'));
$$;
revoke all on function public._maintenance_kit_may_configure(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Catalogues G8 (copie de src/modules/workshop/forfaits/g8-catalog.ts, verifiee par test)
-- ---------------------------------------------------------------------
create or replace function public._g8_service_catalog()
returns table(reference text, designation text, mgmt_type text, brand text, measure_unit text, sort integer)
language sql immutable as $$
  select v.reference::text, v.designation::text, v.mgmt_type::text, v.brand::text, v.measure_unit::text, v.sort::integer from (values
    ('CONTRI', 'CONTRIBUTIONS ENVIRONNEMENTALES', 'F', 'RECUPEL', null, 1),
    ('PETITES FOURNITURES', 'PETITES FOURNITURES', 'F', null, null, 2),
    ('APPAREIL DE DIAGNOTI', 'APPAREIL DE DIAGNOSTIC DDS', 'F', null, null, 3),
    ('PRISE EN CHARGE', 'PRISE EN CHARGE VEHICULE', 'F', null, null, 4),
    ('PRODUITS NETTOYAGE MOT', 'PRODUITS NETTOYAGE MOTO (MAXI POWER)', 'A', 'CANDICAR', null, 5),
    ('CONTROLE BATTERIE', 'CONTROLE CHARGE BATTERIE', 'F', null, null, 6),
    ('CONTROLE DES FREINS', 'CONTROLE DES FREINS', 'F', null, null, 7),
    ('CONTROLE DES NIVEAUX', 'CONTROLE DES NIVEAUX', 'F', null, null, 8),
    ('CONTROLE ECLAIRAGE', 'CONTROLE ECLAIRAGE', 'F', null, null, 9),
    ('CONTROLE ET USURE PN', 'CONTROLE ET USURE DES PNEUS', 'F', null, null, 10),
    ('TENSION DE COURROIES', 'CONTROLE DES COURROIES', 'F', null, null, 11),
    ('TENSION ET GRAISSAGE', 'TENSION ET GRAISSAGE DE CHAINE', 'F', null, null, 12),
    ('REGLAGE SOUPAPES', 'REGLAGE SOUPAPES', 'F', null, null, 13),
    ('TEST MOTO', 'TEST MOTO', 'F', null, null, 14),
    ('MO', 'Main d''oeuvre atelier (taux horaire)', 'T', null, 'h', 15),
    ('MOTO 4XT TECH EN FUT', 'HUILE MOTEUR MOTO 4XT TECH EN FUT (AU LITRE)', 'A', 'TOTAL', 'L', 16),
    ('MOTO 4 ROAD 15W50', 'MOTO 4 ROAD 15W50', 'A', 'TOTAL', 'L', 17),
    ('HUILE DE FREIN DOT 5', 'HUILE DE FREIN DOT 5.1', 'A', 'TOTAL', null, 18),
    ('HUILE DE FOURCHE ELF', 'HUILE DE FOURCHE ELF', 'A', 'TOTAL', null, 19),
    ('COOLELF CLASSIC -26°', 'COOLELF CLASSIC -26°', 'A', 'TOTAL', 'L', 20),
    ('FILTRE A HUILE 1199', 'FILTRE A HUILE 1199 PANIGALE', 'A', 'DUCATI', null, 21),
    ('CHAIN CLEANER', 'CHAIN CLEANER', 'A', null, null, 22)
  ) v(reference, designation, mgmt_type, brand, measure_unit, sort);
$$;

create or replace function public._g8_forfaits_catalog()
returns table(code text, designation text, forfait_no integer, line_no integer, reference text, quantity numeric)
language sql immutable as $$
  select v.code::text, v.designation::text, v.forfait_no::integer, v.line_no::integer, v.reference::text, v.quantity::numeric from (values
    ('CONTROLE', 'CONTROLE', 1, 1, 'TENSION ET GRAISSAGE', 1),
    ('CONTROLE', 'CONTROLE', 1, 2, 'CONTROLE DES NIVEAUX', 1),
    ('CONTROLE', 'CONTROLE', 1, 3, 'CONTROLE ET USURE PN', 1),
    ('CONTROLE', 'CONTROLE', 1, 4, 'CONTROLE ECLAIRAGE', 1),
    ('CONTROLE', 'CONTROLE', 1, 5, 'CONTROLE DES FREINS', 1),
    ('CONTROLE', 'CONTROLE', 1, 6, 'CONTROLE BATTERIE', 1),
    ('CONTROLEMOTO', 'CONTROLE MOTO', 2, 1, 'CONTRI', 1),
    ('CONTROLEMOTO', 'CONTROLE MOTO', 2, 2, 'APPAREIL DE DIAGNOTI', 1),
    ('CONTROLEMOTO', 'CONTROLE MOTO', 2, 3, 'CONTROLE DES NIVEAUX', 1),
    ('CONTROLEMOTO', 'CONTROLE MOTO', 2, 4, 'CONTROLE ET USURE PN', 1),
    ('CONTROLEMOTO', 'CONTROLE MOTO', 2, 5, 'TENSION ET GRAISSAGE', 1),
    ('CONTROLEMOTO', 'CONTROLE MOTO', 2, 6, 'CONTROLE ECLAIRAGE', 1),
    ('CONTROLEMOTO', 'CONTROLE MOTO', 2, 7, 'CONTROLE DES FREINS', 1),
    ('CONTROLEMOTO', 'CONTROLE MOTO', 2, 8, 'CONTROLE BATTERIE', 1),
    ('CONTROLEMOTO', 'CONTROLE MOTO', 2, 9, 'PETITES FOURNITURES', 1),
    ('CONTROLEMOTOCOMPLET', 'CONTROLE MOTO COMPLET', 3, 1, 'PETITES FOURNITURES', 1),
    ('CONTROLEMOTOCOMPLET', 'CONTROLE MOTO COMPLET', 3, 2, 'CONTRI', 1),
    ('CONTROLEMOTOCOMPLET', 'CONTROLE MOTO COMPLET', 3, 3, 'CONTROLE ET USURE PN', 1),
    ('CONTROLEMOTOCOMPLET', 'CONTROLE MOTO COMPLET', 3, 4, 'CONTROLE BATTERIE', 1),
    ('CONTROLEMOTOCOMPLET', 'CONTROLE MOTO COMPLET', 3, 5, 'CONTROLE DES NIVEAUX', 1),
    ('CONTROLEMOTOCOMPLET', 'CONTROLE MOTO COMPLET', 3, 6, 'TENSION DE COURROIES', 1),
    ('CONTROLEMOTOCOMPLET', 'CONTROLE MOTO COMPLET', 3, 7, 'CONTROLE DES FREINS', 1),
    ('CONTROLEMOTOCOMPLET', 'CONTROLE MOTO COMPLET', 3, 8, 'TENSION ET GRAISSAGE', 1),
    ('CONTROLEMOTOCOMPLET', 'CONTROLE MOTO COMPLET', 3, 9, 'REGLAGE SOUPAPES', 1),
    ('CONTROLEMOTOCOMPLET', 'CONTROLE MOTO COMPLET', 3, 10, 'CONTROLE ECLAIRAGE', 1),
    ('CONTROLEMOTOCOMPLET', 'CONTROLE MOTO COMPLET', 3, 11, 'APPAREIL DE DIAGNOTI', 1),
    ('DIVERS', 'DIVERS', 4, 1, 'PETITES FOURNITURES', 1),
    ('DIVERS', 'DIVERS', 4, 2, 'CONTRI', 1),
    ('ENT1200201424000KM', 'ENT 1200 2014 24000KM', 5, 1, '78811211A', 2),
    ('ENT1200201424000KM', 'ENT 1200 2014 24000KM', 5, 2, '81140012B', 2),
    ('ENT1200201424000KM', 'ENT 1200 2014 24000KM', 5, 3, '42610201A', 1),
    ('ENT1200201424000KM', 'ENT 1200 2014 24000KM', 5, 4, '67040381A', 4),
    ('ENT1200201424000KM', 'ENT 1200 2014 24000KM', 5, 5, '66910011E', 16),
    ('ENT1200201424000KM', 'ENT 1200 2014 24000KM', 5, 6, '88650511A', 8),
    ('ENT1200201424000KM', 'ENT 1200 2014 24000KM', 5, 7, '78810931A', 2),
    ('ENT1200201424000KM', 'ENT 1200 2014 24000KM', 5, 8, '73740252A', 2),
    ('ENTRETIENANNUEL1199PANIGALE', 'ENTRETIEN ANNUEL 1199 PANIGALE', 6, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('ENTRETIENANNUEL1199PANIGALE', 'ENTRETIEN ANNUEL 1199 PANIGALE', 6, 2, 'FILTRE A HUILE 1199', 1),
    ('ENTRETIENANNUEL1199PANIGALE', 'ENTRETIEN ANNUEL 1199 PANIGALE', 6, 3, 'APPAREIL DE DIAGNOTI', 1),
    ('ENTRETIENANNUEL1199PANIGALE', 'ENTRETIEN ANNUEL 1199 PANIGALE', 6, 4, 'CONTROLE BATTERIE', 1),
    ('ENTRETIENANNUEL1199PANIGALE', 'ENTRETIEN ANNUEL 1199 PANIGALE', 6, 5, 'CONTROLE DES FREINS', 1),
    ('ENTRETIENANNUEL1199PANIGALE', 'ENTRETIEN ANNUEL 1199 PANIGALE', 6, 6, 'CONTROLE ECLAIRAGE', 1),
    ('ENTRETIENANNUEL1199PANIGALE', 'ENTRETIEN ANNUEL 1199 PANIGALE', 6, 7, 'CONTROLE ET USURE PN', 1),
    ('ENTRETIENANNUEL1199PANIGALE', 'ENTRETIEN ANNUEL 1199 PANIGALE', 6, 8, 'CONTROLE DES NIVEAUX', 1),
    ('ENTRETIENANNUEL1199PANIGALE', 'ENTRETIEN ANNUEL 1199 PANIGALE', 6, 9, 'TENSION ET GRAISSAGE', 1),
    ('ENTRETIENANNUEL1199PANIGALE', 'ENTRETIEN ANNUEL 1199 PANIGALE', 6, 10, 'MO', 2),
    ('ENTRETIENANNUEL1199PANIGALE', 'ENTRETIEN ANNUEL 1199 PANIGALE', 6, 11, 'PETITES FOURNITURES', 1),
    ('ENTRETIENANNUEL1199PANIGALE', 'ENTRETIEN ANNUEL 1199 PANIGALE', 6, 12, 'CONTRI', 1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 1, 'MOTO 4XT TECH EN FUT', 3.1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 2, '44440035A', 1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 3, '85250261A', 1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 4, 'APPAREIL DE DIAGNOTI', 1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 5, 'CONTROLE DES FREINS', 1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 6, 'CONTROLE ECLAIRAGE', 1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 7, 'CONTROLE ET USURE PN', 1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 8, 'CONTROLE DES NIVEAUX', 1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 9, 'CONTROLE BATTERIE', 1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 10, 'TENSION DE COURROIES', 1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 11, 'TENSION ET GRAISSAGE', 1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 12, 'MO', 1.8),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 13, 'PETITES FOURNITURES', 1),
    ('ENTRETIENANNUEL2SOUPAPES', 'ENTRETIEN ANNUEL 2 SOUPAPES', 7, 14, 'CONTRI', 1),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 2, '44440035A', 1),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 3, '85250261A', 1),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 4, 'APPAREIL DE DIAGNOTI', 1),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 5, 'CONTROLE DES FREINS', 1),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 6, 'CONTROLE ECLAIRAGE', 1),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 7, 'CONTROLE ET USURE PN', 1),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 8, 'CONTROLE DES NIVEAUX', 1),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 9, 'CONTROLE BATTERIE', 1),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 10, 'TENSION DE COURROIES', 1),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 11, 'TENSION ET GRAISSAGE', 1),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 12, 'MO', 2),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 13, 'PETITES FOURNITURES', 1),
    ('ENTRETIENANNUEL4SOUPAPES', 'ENTRETIEN ANNUEL 4 SOUPAPES', 8, 14, 'CONTRI', 1),
    ('M696/M796/M110036000KM', 'M696/M796/M1100 36000KM', 9, 1, 'HUILE DE FREIN DOT 5', 1),
    ('M696/M796/M110036000KM', 'M696/M796/M1100 36000KM', 9, 2, 'HUILE DE FOURCHE ELF', 2),
    ('M696/M796/M110036000KM', 'M696/M796/M1100 36000KM', 9, 3, 'MO', 0.7),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 1, 'MOTO 4XT TECH EN FUT', 3.1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 2, '44440035A', 1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 3, '22032083A', 1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 4, '42610091A', 1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 5, '42510022A', 1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 6, '67090081A', 2),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 7, '73710021A', 2),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 8, 'HUILE DE FREIN DOT 5', 1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 9, 'HUILE DE FOURCHE ELF', 2),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 10, 'TENSION DE COURROIES', 1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 11, 'TENSION ET GRAISSAGE', 1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 12, 'CONTROLE DES FREINS', 1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 13, 'CONTROLE ECLAIRAGE', 1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 14, 'CONTROLE ET USURE PN', 1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 15, 'CONTROLE DES NIVEAUX', 1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 16, 'CONTROLE BATTERIE', 1),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 17, 'PETITES FOURNITURES', 2),
    ('MO600COUPONC', 'MO 600 COUPON C', 10, 18, 'CONTRI', 2),
    ('MTS12002010/2012', 'MTS 1200 2010/2012', 11, 1, 'MOTO 4 ROAD 15W50', 4),
    ('MTS12002010/2012', 'MTS 1200 2010/2012', 11, 2, '44440035A', 1),
    ('MTS12002010/2012', 'MTS 1200 2010/2012', 11, 3, '85250261A', 1),
    ('MTS12002010/2012', 'MTS 1200 2010/2012', 11, 4, '73740251A', 2),
    ('MTS12002010/2012', 'MTS 1200 2010/2012', 11, 5, '78810941A', 2),
    ('MTS12002010/2012', 'MTS 1200 2010/2012', 11, 6, '66910011E', 16),
    ('MTS12002010/2012', 'MTS 1200 2010/2012', 11, 7, '42610201A', 1),
    ('MTS12002010/2012', 'MTS 1200 2010/2012', 11, 8, '67040451A', 2),
    ('MTS12002010/2012', 'MTS 1200 2010/2012', 11, 9, '78810931A', 2),
    ('MTS12002010/2012', 'MTS 1200 2010/2012', 11, 10, '88650511A', 8),
    ('OILSERVICE1000KMPANIGALE', 'OIL SERVICE 1000KM PANIGALE', 12, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICE1000KMPANIGALE', 'OIL SERVICE 1000KM PANIGALE', 12, 2, 'FILTRE A HUILE 1199', 1),
    ('OILSERVICE1000KMPANIGALE', 'OIL SERVICE 1000KM PANIGALE', 12, 3, '85250541A', 1),
    ('OILSERVICE1000KMPANIGALE', 'OIL SERVICE 1000KM PANIGALE', 12, 4, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICE1000KMPANIGALE', 'OIL SERVICE 1000KM PANIGALE', 12, 5, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICE1000KMPANIGALE', 'OIL SERVICE 1000KM PANIGALE', 12, 6, 'CONTROLE BATTERIE', 1),
    ('OILSERVICE1000KMPANIGALE', 'OIL SERVICE 1000KM PANIGALE', 12, 7, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICE1000KMPANIGALE', 'OIL SERVICE 1000KM PANIGALE', 12, 8, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICE1000KMPANIGALE', 'OIL SERVICE 1000KM PANIGALE', 12, 9, 'CONTROLE DES FREINS', 1),
    ('OILSERVICE1000KMPANIGALE', 'OIL SERVICE 1000KM PANIGALE', 12, 10, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICE1000KMPANIGALE', 'OIL SERVICE 1000KM PANIGALE', 12, 11, 'PETITES FOURNITURES', 1),
    ('OILSERVICE1000KMPANIGALE', 'OIL SERVICE 1000KM PANIGALE', 12, 12, 'CONTRI', 1),
    ('OILSERVICE119912000KM', 'OIL SERVICE 1199 12000KM', 13, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICE119912000KM', 'OIL SERVICE 1199 12000KM', 13, 2, 'FILTRE A HUILE 1199', 1),
    ('OILSERVICE119912000KM', 'OIL SERVICE 1199 12000KM', 13, 3, '85250541A', 1),
    ('OILSERVICE119912000KM', 'OIL SERVICE 1199 12000KM', 13, 4, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICE119912000KM', 'OIL SERVICE 1199 12000KM', 13, 5, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICE119912000KM', 'OIL SERVICE 1199 12000KM', 13, 6, 'CONTROLE BATTERIE', 1),
    ('OILSERVICE119912000KM', 'OIL SERVICE 1199 12000KM', 13, 7, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICE119912000KM', 'OIL SERVICE 1199 12000KM', 13, 8, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICE119912000KM', 'OIL SERVICE 1199 12000KM', 13, 9, 'CONTROLE DES FREINS', 1),
    ('OILSERVICE119912000KM', 'OIL SERVICE 1199 12000KM', 13, 10, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICE119912000KM', 'OIL SERVICE 1199 12000KM', 13, 11, 'PETITES FOURNITURES', 1),
    ('OILSERVICE119912000KM', 'OIL SERVICE 1199 12000KM', 13, 12, 'CONTRI', 1),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 2, 'FILTRE A HUILE 1199', 1),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 3, '42610341B', 1),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 4, '89420112B', 1),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 5, '67040451A', 2),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 6, 'REGLAGE SOUPAPES', 1),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 7, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 8, 'CONTROLE DES FREINS', 1),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 9, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 10, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 11, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 12, 'CONTROLE BATTERIE', 1),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 13, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 14, 'PETITES FOURNITURES', 2),
    ('OILSERVICE119924000KM', 'OIL SERVICE 1199 24000KM', 14, 15, 'CONTRI', 2),
    ('OILSERVICE2SOUPAPES', 'OIL SERVICE 2 SOUPAPES', 15, 1, 'MOTO 4XT TECH EN FUT', 3.1),
    ('OILSERVICE2SOUPAPES', 'OIL SERVICE 2 SOUPAPES', 15, 2, '44440035A', 1),
    ('OILSERVICE2SOUPAPES', 'OIL SERVICE 2 SOUPAPES', 15, 3, '85250261A', 1),
    ('OILSERVICE2SOUPAPES', 'OIL SERVICE 2 SOUPAPES', 15, 4, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICE2SOUPAPES', 'OIL SERVICE 2 SOUPAPES', 15, 5, 'CONTROLE DES FREINS', 1),
    ('OILSERVICE2SOUPAPES', 'OIL SERVICE 2 SOUPAPES', 15, 6, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICE2SOUPAPES', 'OIL SERVICE 2 SOUPAPES', 15, 7, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICE2SOUPAPES', 'OIL SERVICE 2 SOUPAPES', 15, 8, 'CONTROLE BATTERIE', 1),
    ('OILSERVICE2SOUPAPES', 'OIL SERVICE 2 SOUPAPES', 15, 9, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICE2SOUPAPES', 'OIL SERVICE 2 SOUPAPES', 15, 10, 'MO', 1),
    ('OILSERVICE2SOUPAPES', 'OIL SERVICE 2 SOUPAPES', 15, 11, 'PETITES FOURNITURES', 1),
    ('OILSERVICE2SOUPAPES', 'OIL SERVICE 2 SOUPAPES', 15, 12, 'CONTRI', 1),
    ('OILSERVICE4SOUPAPES', 'OIL SERVICE 4 SOUPAPES', 16, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICE4SOUPAPES', 'OIL SERVICE 4 SOUPAPES', 16, 2, '44440035A', 1),
    ('OILSERVICE4SOUPAPES', 'OIL SERVICE 4 SOUPAPES', 16, 3, '85250261A', 1),
    ('OILSERVICE4SOUPAPES', 'OIL SERVICE 4 SOUPAPES', 16, 4, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICE4SOUPAPES', 'OIL SERVICE 4 SOUPAPES', 16, 5, 'CONTROLE DES FREINS', 1),
    ('OILSERVICE4SOUPAPES', 'OIL SERVICE 4 SOUPAPES', 16, 6, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICE4SOUPAPES', 'OIL SERVICE 4 SOUPAPES', 16, 7, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICE4SOUPAPES', 'OIL SERVICE 4 SOUPAPES', 16, 8, 'CONTROLE BATTERIE', 1),
    ('OILSERVICE4SOUPAPES', 'OIL SERVICE 4 SOUPAPES', 16, 9, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICE4SOUPAPES', 'OIL SERVICE 4 SOUPAPES', 16, 10, 'MO', 1.2),
    ('OILSERVICE4SOUPAPES', 'OIL SERVICE 4 SOUPAPES', 16, 11, 'PETITES FOURNITURES', 1),
    ('OILSERVICE4SOUPAPES', 'OIL SERVICE 4 SOUPAPES', 16, 12, 'CONTRI', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 2, '44440035A', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 3, '22032083A', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 4, '42620161A', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 5, '42620171A', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 6, '42540101A', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 7, '67090161B', 2),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 8, '74140931A', 2),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 9, '73740124A', 2),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 10, 'COOLELF CLASSIC -26°', 3),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 11, 'HUILE DE FOURCHE ELF', 2),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 12, 'HUILE DE FREIN DOT 5', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 13, 'REGLAGE SOUPAPES', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 14, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 15, 'CONTROLE DES FREINS', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 16, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 17, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 18, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 19, 'CONTROLE BATTERIE', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 20, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 21, 'PETITES FOURNITURES', 2),
    ('OILSERVICE749/99920000KM', 'OIL SERVICE 749/999 20000KM', 17, 22, 'CONTRI', 2),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 2, '44440035A', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 3, '22032083A', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 4, '42620161A', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 5, '42620171A', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 6, '42540101A', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 7, '67090161B', 2),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 8, '74140931A', 2),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 9, 'REGLAGE SOUPAPES', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 10, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 11, 'CONTROLE DES FREINS', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 12, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 13, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 14, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 15, 'CONTROLE BATTERIE', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 16, 'TENSION DE COURROIES', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 17, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 18, 'PETITES FOURNITURES', 1),
    ('OILSERVICE99910000KM', 'OIL SERVICE 999 10000KM', 18, 19, 'CONTRI', 1),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 2, '44440035A', 1),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 3, '85250261A', 1),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 4, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 5, 'CONTROLE DES FREINS', 1),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 6, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 7, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 8, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 9, 'CONTROLE BATTERIE', 1),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 10, 'TENSION DE COURROIES', 1),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 11, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 12, 'PETITES FOURNITURES', 1),
    ('OILSERVICEDIAVEL12000KM', 'OIL SERVICE DIAVEL 12000KM', 19, 13, 'CONTRI', 1),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 2, '44440035A', 1),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 3, '73740251A', 2),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 4, '42610201A', 1),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 5, '85250261A', 1),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 6, '67040451A', 2),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 7, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 8, 'CONTROLE DES FREINS', 1),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 9, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 10, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 11, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 12, 'CONTROLE BATTERIE', 1),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 13, 'TENSION DE COURROIES', 1),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 14, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 15, 'PETITES FOURNITURES', 2),
    ('OILSERVICEDIAVEL24000KM', 'OIL SERVICE DIAVEL 24000KM', 20, 16, 'CONTRI', 2),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 2, '44440035A', 1),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 3, '85250261A', 1),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 4, 'HUILE DE FREIN DOT 5', 1),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 5, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 6, 'CONTROLE DES FREINS', 1),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 7, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 8, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 9, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 10, 'CONTROLE BATTERIE', 1),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 11, 'TENSION DE COURROIES', 1),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 12, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 13, 'PETITES FOURNITURES', 1),
    ('OILSERVICEDIAVEL36000KM', 'OIL SERVICE DIAVEL 36000KM', 21, 14, 'CONTRI', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 1, 'MOTO 4XT TECH EN FUT', 3.1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 2, '44440035A', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 3, '85250261A', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 4, 'REGLAGE SOUPAPES', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 5, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 6, 'CONTROLE DES FREINS', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 7, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 8, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 9, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 10, 'CONTROLE BATTERIE', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 11, 'TENSION DE COURROIES', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 12, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 13, 'PETITES FOURNITURES', 1),
    ('OILSERVICEM110012000', 'OIL SERVICE M1100 12000', 22, 14, 'CONTRI', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 1, 'MOTO 4XT TECH EN FUT', 3.1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 2, '44440035A', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 3, '67040351A', 2),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 4, '73740211A', 2),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 5, '42610191A', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 6, '85250261A', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 7, 'REGLAGE SOUPAPES', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 8, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 9, 'CONTROLE DES FREINS', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 10, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 11, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 12, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 13, 'CONTROLE BATTERIE', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 14, 'TENSION DE COURROIES', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 15, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 16, 'PETITES FOURNITURES', 2),
    ('OILSERVICEM110024000', 'OIL SERVICE M1100 24000', 23, 17, 'CONTRI', 2),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 1, 'MOTO 4XT TECH EN FUT', 3.1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 2, '44440035A', 1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 3, '85250261A', 1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 4, 'REGLAGE SOUPAPES', 1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 5, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 6, 'CONTROLE DES FREINS', 1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 7, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 8, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 9, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 10, 'CONTROLE BATTERIE', 1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 11, 'TENSION DE COURROIES', 1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 12, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 13, 'PETITES FOURNITURES', 1),
    ('OILSERVICEM69612000', 'OIL SERVICE M696 12000', 24, 14, 'CONTRI', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 1, 'MOTO 4XT TECH EN FUT', 3.1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 2, '44440035A', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 3, '85250261A', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 4, '67040351A', 2),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 5, '42610191A', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 6, '73740242A', 2),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 7, 'REGLAGE SOUPAPES', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 8, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 9, 'CONTROLE DES FREINS', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 10, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 11, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 12, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 13, 'CONTROLE BATTERIE', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 14, 'TENSION DE COURROIES', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 15, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 16, 'PETITES FOURNITURES', 2),
    ('OILSERVICEM69624000', 'OIL SERVICE M696 24000', 25, 17, 'CONTRI', 2),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 1, 'MOTO 4XT TECH EN FUT', 3.1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 2, '44440035A', 1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 3, '85250261A', 1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 4, 'REGLAGE SOUPAPES', 1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 5, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 6, 'CONTROLE DES FREINS', 1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 7, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 8, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 9, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 10, 'CONTROLE BATTERIE', 1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 11, 'TENSION DE COURROIES', 1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 12, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 13, 'PETITES FOURNITURES', 1),
    ('OILSERVICEM79612000', 'OIL SERVICE M796 12000', 26, 14, 'CONTRI', 1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 1, 'MOTO 4XT TECH EN FUT', 3.1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 2, '44440035A', 1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 3, '85250261A', 1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 4, '67040351A', 2),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 5, '42610191A', 1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 6, '73740242A', 2),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 7, 'REGLAGE SOUPAPES', 1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 8, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 9, 'CONTROLE DES FREINS', 1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 10, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 11, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 12, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 13, 'CONTROLE BATTERIE', 1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 14, 'TENSION DE COURROIES', 1),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 15, 'PETITES FOURNITURES', 2),
    ('OILSERVICEM79624000', 'OIL SERVICE M796 24000', 27, 16, 'CONTRI', 2),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 2, '44440035A', 1),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 3, '85250261A', 1),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 4, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 5, 'CONTROLE DES FREINS', 1),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 6, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 7, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 8, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 9, 'CONTROLE BATTERIE', 1),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 10, 'TENSION DE COURROIES', 1),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 11, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 12, 'PETITES FOURNITURES', 1),
    ('OILSERVICEMTS120012000KM', 'OIL SERVICE MTS1200 12000KM', 28, 13, 'CONTRI', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 2, '44440035A', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 3, '85250261A', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 4, '42610201A', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 5, '67040451A', 2),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 6, '73740251A', 2),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 7, 'REGLAGE SOUPAPES', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 8, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 9, 'CONTROLE DES FREINS', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 10, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 11, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 12, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 13, 'CONTROLE BATTERIE', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 14, 'TENSION DE COURROIES', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 15, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 16, 'PETITES FOURNITURES', 2),
    ('OILSERVICEMTS120024000KM', 'OIL SERVICE MTS1200 24000KM', 29, 17, 'CONTRI', 2),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 2, '44440035A', 1),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 3, '85250261A', 1),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 4, 'HUILE DE FREIN DOT 5', 1),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 5, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 6, 'CONTROLE DES FREINS', 1),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 7, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 8, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 9, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 10, 'CONTROLE BATTERIE', 1),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 11, 'TENSION DE COURROIES', 1),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 12, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 13, 'PETITES FOURNITURES', 1),
    ('OILSERVICEMTS120036000KM', 'OIL SERVICE MTS1200 36000KM', 30, 14, 'CONTRI', 1),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 2, '44440035A', 1),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 3, '85250261A', 1),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 4, '67040381A', 2),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 5, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 6, 'CONTROLE DES FREINS', 1),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 7, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 8, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 9, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 10, 'CONTROLE BATTERIE', 1),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 11, 'TENSION DE COURROIES', 1),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 12, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 13, 'PETITES FOURNITURES', 1),
    ('OILSERVICESTREET84812000KM', 'OIL SERVICE STREET 848 12000KM', 31, 14, 'CONTRI', 1),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 2, '44440035A', 1),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 3, '85250261A', 1),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 4, '42610201A', 1),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 5, '67040381A', 2),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 6, '73740251A', 2),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 7, 'REGLAGE SOUPAPES', 1),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 8, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 9, 'CONTROLE DES FREINS', 1),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 10, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 11, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 12, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 13, 'CONTROLE BATTERIE', 1),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 14, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 15, 'PETITES FOURNITURES', 2),
    ('OILSERVICESTREET84824000KM', 'OIL SERVICE STREET 848 24000KM', 32, 16, 'CONTRI', 2),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 2, '44440035A', 1),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 3, '85250261A', 1),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 4, '67040381A', 2),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 5, 'HUILE DE FREIN DOT 5', 1),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 6, 'APPAREIL DE DIAGNOTI', 1),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 7, 'CONTROLE DES FREINS', 1),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 8, 'CONTROLE ECLAIRAGE', 1),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 9, 'CONTROLE ET USURE PN', 1),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 10, 'CONTROLE DES NIVEAUX', 1),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 11, 'CONTROLE BATTERIE', 1),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 12, 'TENSION DE COURROIES', 1),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 13, 'TENSION ET GRAISSAGE', 1),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 14, 'PETITES FOURNITURES', 1),
    ('OILSERVICESTRRET84836000KM', 'OIL SERVICE STREET 848 36000KM', 33, 15, 'CONTRI', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 2, '44440035A', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 3, '85250261A', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 4, 'REGLAGE SOUPAPES', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 5, 'APPAREIL DE DIAGNOTI', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 6, 'CONTROLE DES FREINS', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 7, 'CONTROLE ECLAIRAGE', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 8, 'CONTROLE ET USURE PN', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 9, 'CONTROLE DES NIVEAUX', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 10, 'CONTROLE BATTERIE', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 11, 'TENSION DE COURROIES', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 12, 'TENSION ET GRAISSAGE', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 13, 'PETITES FOURNITURES', 1),
    ('SERVICE848/1098/119812000KM', 'SERVICE 848/1098/1198 12000KM', 34, 14, 'CONTRI', 1),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 2, '44440035A', 1),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 3, '85250261A', 1),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 4, '42610201A', 1),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 5, '67040381A', 2),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 6, '73740251A', 2),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 7, 'REGLAGE SOUPAPES', 1),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 8, 'APPAREIL DE DIAGNOTI', 1),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 9, 'CONTROLE DES FREINS', 1),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 10, 'CONTROLE ECLAIRAGE', 1),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 11, 'CONTROLE ET USURE PN', 1),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 12, 'CONTROLE DES NIVEAUX', 1),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 13, 'CONTROLE BATTERIE', 1),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 14, 'TENSION ET GRAISSAGE', 1),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 15, 'PETITES FOURNITURES', 2),
    ('SERVICE848/1098/119824000KM', 'SERVICE 848/1098/1198 24000KM', 35, 16, 'CONTRI', 2),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 1, 'MOTO 4XT TECH EN FUT', 3.4),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 2, '44440035A', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 3, '85250261A', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 4, 'HUILE DE FREIN DOT 5', 2),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 5, 'HUILE DE FOURCHE ELF', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 6, 'REGLAGE SOUPAPES', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 7, 'APPAREIL DE DIAGNOTI', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 8, 'CONTROLE DES FREINS', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 9, 'CONTROLE ECLAIRAGE', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 10, 'CONTROLE ET USURE PN', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 11, 'CONTROLE DES NIVEAUX', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 12, 'CONTROLE BATTERIE', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 13, 'TENSION DE COURROIES', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 14, 'TENSION ET GRAISSAGE', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 15, 'PETITES FOURNITURES', 1),
    ('SERVICE848/1098/119836000KM', 'SERVICE 848/1098/1198 36000KM', 36, 16, 'CONTRI', 1),
    ('DDS', 'DDS - PRISE EN CHARGE ET DIAGNOSTIC', 37, 1, 'PRISE EN CHARGE', 1),
    ('DDS', 'DDS - PRISE EN CHARGE ET DIAGNOSTIC', 37, 2, 'PETITES FOURNITURES', 1),
    ('DDS', 'DDS - PRISE EN CHARGE ET DIAGNOSTIC', 37, 3, 'PRODUITS NETTOYAGE MOT', 1),
    ('DDS', 'DDS - PRISE EN CHARGE ET DIAGNOSTIC', 37, 4, 'CHAIN CLEANER', 1),
    ('DDS', 'DDS - PRISE EN CHARGE ET DIAGNOSTIC', 37, 5, 'CONTRI', 2),
    ('DDS', 'DDS - PRISE EN CHARGE ET DIAGNOSTIC', 37, 6, 'APPAREIL DE DIAGNOTI', 1)
  ) v(code, designation, forfait_no, line_no, reference, quantity);
$$;

create or replace function public._g8_default_kit_lines_catalog()
returns table(reference text, quantity numeric, sort integer)
language sql immutable as $$
  select v.reference::text, v.quantity::numeric, v.sort::integer from (values
    ('APPAREIL DE DIAGNOTI', 1, 1),
    ('CONTROLE DES FREINS', 1, 2),
    ('CONTROLE ECLAIRAGE', 1, 3),
    ('CONTROLE ET USURE PN', 1, 4),
    ('CONTROLE DES NIVEAUX', 1, 5),
    ('CONTROLE BATTERIE', 1, 6),
    ('TENSION DE COURROIES', 1, 7),
    ('TENSION ET GRAISSAGE', 1, 8),
    ('PETITES FOURNITURES', 1, 9),
    ('CONTRI', 1, 10)
  ) v(reference, quantity, sort);
$$;

create or replace function public._g8_fluid_articles_catalog()
returns table(family_code text, reference text, sale_unit text, liters_per_unit numeric, whole_units boolean)
language sql immutable as $$
  select v.family_code::text, v.reference::text, v.sale_unit::text, v.liters_per_unit::numeric, v.whole_units::boolean from (values
    ('huile_moteur', 'MOTO 4XT TECH EN FUT', 'l', 1, false),
    ('huile_fourche', 'HUILE DE FOURCHE ELF', 'flacon', 0.5, true),
    ('liquide_frein', 'HUILE DE FREIN DOT 5', 'flacon', 0.5, true),
    ('liquide_refroidissement', 'COOLELF CLASSIC -26°', 'l', 1, false)
  ) v(family_code, reference, sale_unit, liters_per_unit, whole_units);
$$;

create or replace function public._g8_engine_profiles_catalog()
returns table(code text, label text, priority integer, match_pattern text, exclude_pattern text,
              year_from integer, year_to integer, oil_reference text, oil_quantity numeric,
              filter_reference text, washer_reference text, g8_forfait text)
language sql immutable as $$
  select v.code::text, v.label::text, v.priority::integer, v.match_pattern::text, v.exclude_pattern::text, v.year_from::integer, v.year_to::integer, v.oil_reference::text, v.oil_quantity::numeric, v.filter_reference::text, v.washer_reference::text, v.g8_forfait::text from (values
    ('panigale_1199', 'Panigale 1199 / 1299 / 899 / 959 (Superquadro)', 10, '(1199|1299|899|959)[^|]*PANIGALE|PANIGALE[^|]*(1199|1299|899|959)', 'V4|DESMOSEDICI', null, null, null, 3.4, 'FILTRE A HUILE 1199', '85250541A', 'OIL SERVICE 1199 12000KM'),
    ('mts1200_2010_2012', 'Multistrada 1200 2010 a 2012', 20, 'MULTISTRADA > 1200', 'V4|DESMOSEDICI', 2010, 2012, 'MOTO 4 ROAD 15W50', 4, '44440035A', '85250261A', 'MTS 1200 2010/2012'),
    ('superbike_749_999', '748 / 749 / 916 / 996 / 998 / 999', 25, '(^|[^0-9])(748|749|916|996|998|999)([^0-9]|$)', 'V4|DESMOSEDICI', null, null, null, 3.4, '44440035A', '22032083A', 'OIL SERVICE 749/999 20000KM'),
    ('quatre_soupapes', '4 soupapes / Testastretta (Diavel, Multistrada 1200, 848/1098/1198, Hypermotard 821/939/950...)', 30, 'DIAVEL|MULTISTRADA > (1200|1260|950|MULTISTRADA V2)|STREETFIGHTER|HYPERSTRADA|DESERT X|PANIGALE|(^|[^0-9])(848|1098|1198|821|939|937|950|955|1200|1260)([^0-9]|$)|(^|[^A-Z0-9])(ST3|ST4|S4R|S4RS|S4)([^A-Z0-9]|$)|MONSTER (PLUS|SP|SENNA)|(^|[^A-Z0-9])V2([^A-Z0-9]|$)', 'V4|DESMOSEDICI', null, null, null, 3.4, '44440035A', '85250261A', 'OIL SERVICE 4 SOUPAPES'),
    ('deux_soupapes', '2 soupapes (Monster M696/M796/M1100, SS, 1000 SS, Scrambler a air...)', 40, '(^|[^0-9])(250|350|400|450|600|620|659|695|696|750|796|797|800|803|900|907|1000|1100)([^0-9]|$)|SCRAMBLER|SPORTCLASSIC|GT1000|ST2|MH900|S2R|SIXTY2|ICON|SUPERSPORT|MONSTER|HYPERMOTARD|MULTISTRADA', 'V4|DESMOSEDICI|698|MONO', null, null, null, 3.1, '44440035A', '85250261A', 'OIL SERVICE 2 SOUPAPES')
  ) v(code, label, priority, match_pattern, exclude_pattern, year_from, year_to, oil_reference, oil_quantity,
      filter_reference, washer_reference, g8_forfait);
$$;

revoke all on function public._g8_service_catalog() from public, anon;
revoke all on function public._g8_forfaits_catalog() from public, anon;
revoke all on function public._g8_default_kit_lines_catalog() from public, anon;
revoke all on function public._g8_fluid_articles_catalog() from public, anon;
revoke all on function public._g8_engine_profiles_catalog() from public, anon;

-- L'article d'une societe par sa reference (exacte, sinon sans casse ni espaces de bord).
create or replace function public._g8_article_by_ref(_company uuid, _ref text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select a.id from public.articles a
   where a.company_id = _company and upper(btrim(a.reference)) = upper(btrim(_ref))
   order by (a.reference = _ref) desc, a.is_active desc, a.created_at
   limit 1;
$$;
revoke all on function public._g8_article_by_ref(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Installation (interne, rejouable) : articles de service, forfaits, reglages
-- ---------------------------------------------------------------------
-- Articles « forfait » G8 manquants, crees a 0 € (prix : bloc separe). Un article deja present
-- (meme reference) est REUTILISE tel quel, jamais modifie.
create or replace function public._g8_service_articles_install(_company uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; created text[] := '{}'; reused text[] := '{}';
begin
  for c in select * from public._g8_service_catalog() order by sort loop
    if public._g8_article_by_ref(_company, c.reference) is not null then
      reused := reused || c.reference;
      continue;
    end if;
    insert into public.articles (company_id, reference, designation, mgmt_type, brand, measure_unit,
                                 vat_rate, sale_price_ttc, is_library, is_active, note)
    values (_company, c.reference, c.designation, c.mgmt_type::public.article_mgmt_type, c.brand, c.measure_unit,
            21, 0, false, true, 'Article forfait repris de G8 (rattrapage 19/11/2026).');
    created := created || c.reference;
  end loop;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'g8_service_articles_install', 'articles', _company::text, 'migration', null,
          jsonb_build_object('created', to_jsonb(created), 'reused', to_jsonb(reused)));
  return jsonb_build_object('created', to_jsonb(created), 'reused', to_jsonb(reused));
end $$;
revoke all on function public._g8_service_articles_install(uuid) from public, anon, authenticated;

-- Les 37 nomenclatures : article parent N (« nomenclature » = prix = somme des lignes) + composants.
-- Un composant absent de la societe n'est pas invente : il est liste (`missing`) ; rejouer apres
-- creation de l'article ajoute la ligne. Un forfait deja present garde ses lignes et quantites
-- (l'atelier a pu les corriger) : seules les lignes manquantes sont ajoutees.
create or replace function public._g8_forfaits_install(_company uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f record; l record; kid uuid; cid uuid; ex public.articles%rowtype;
  n_created int := 0; n_lines int := 0; missing jsonb := '[]'::jsonb; conflicts jsonb := '[]'::jsonb;
begin
  for f in select distinct on (code) code, designation, forfait_no from public._g8_forfaits_catalog() order by code, forfait_no loop
    kid := public._g8_article_by_ref(_company, f.code);
    if kid is null then
      insert into public.articles (company_id, reference, designation, mgmt_type, kit_billing_mode, vat_rate,
                                   sale_price_ttc, is_library, is_active, note)
      values (_company, f.code, f.designation, 'N', 'nomenclature', 21, 0, false, true,
              'Forfait (nomenclature) repris de G8 : prix = somme des lignes.')
      returning id into kid;
      n_created := n_created + 1;
    else
      select * into ex from public.articles where id = kid;
      if ex.mgmt_type::text <> 'N' then
        conflicts := conflicts || jsonb_build_object('forfait', f.code, 'mgmt_type', ex.mgmt_type::text);
        continue;
      end if;
    end if;
    for l in select * from public._g8_forfaits_catalog() x where x.code = f.code order by x.line_no loop
      cid := public._g8_article_by_ref(_company, l.reference);
      if cid is null then
        missing := missing || jsonb_build_object('forfait', f.code, 'reference', l.reference, 'quantity', l.quantity);
        continue;
      end if;
      insert into public.article_kit_items (kit_id, component_id, quantity, sort_order)
      values (kid, cid, l.quantity, l.line_no)
      on conflict (kit_id, component_id) do nothing;
      if found then n_lines := n_lines + 1; end if;
    end loop;
  end loop;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'g8_forfaits_install', 'articles', _company::text, 'migration', null,
          jsonb_build_object('forfaits_created', n_created, 'lines_added', n_lines, 'missing', missing, 'conflicts', conflicts));
  return jsonb_build_object('forfaits_created', n_created, 'lines_added', n_lines, 'missing', missing, 'conflicts', conflicts);
end $$;
revoke all on function public._g8_forfaits_install(uuid) from public, anon, authenticated;

-- Prix d'une liste d'articles, par le circuit trace (trigger trace_price_change -> price_changes,
-- origine posee). N'ecrit que si le prix change. `_to_confirm` : drapeau « a completer » sur
-- l'article (source prix_g8_a_confirmer) ; faux : le drapeau pose par ce circuit est leve.
create or replace function public._g8_prices_apply(_company uuid, _prices jsonb, _origin text, _to_confirm boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; aid uuid; a public.articles%rowtype; n_changed int := 0; n_same int := 0; missing text[] := '{}';
begin
  for p in select * from jsonb_to_recordset(coalesce(_prices, '[]'::jsonb)) as x(reference text, ht numeric, ttc numeric) loop
    aid := public._g8_article_by_ref(_company, p.reference);
    if aid is null then missing := missing || p.reference; continue; end if;
    select * into a from public.articles where id = aid;
    if a.sale_price_ttc is distinct from round(p.ttc, 2) or a.sale_price_ht is distinct from round(p.ht, 2) then
      perform set_config('app.price_change_origin', coalesce(nullif(_origin, ''), 'import:g8'), true);
      update public.articles set sale_price_ht = round(p.ht, 2), sale_price_ttc = round(p.ttc, 2) where id = aid;
      perform set_config('app.price_change_origin', '', true);
      n_changed := n_changed + 1;
    else
      n_same := n_same + 1;
    end if;
    if _to_confirm and not a.to_complete then
      update public.articles set to_complete = true, to_complete_source = 'prix_g8_a_confirmer' where id = aid;
    elsif not _to_confirm and a.to_complete and a.to_complete_source = 'prix_g8_a_confirmer' then
      update public.articles set to_complete = false, to_complete_source = null where id = aid;
    end if;
  end loop;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'g8_prices_apply', 'articles', _company::text, 'migration', null,
          jsonb_build_object('origin', _origin, 'to_confirm', _to_confirm, 'changed', n_changed, 'unchanged', n_same,
                             'missing', to_jsonb(missing)));
  return jsonb_build_object('changed', n_changed, 'unchanged', n_same, 'missing', to_jsonb(missing));
end $$;
revoke all on function public._g8_prices_apply(uuid, jsonb, text, boolean) from public, anon, authenticated;

-- Reglages par defaut d'une societe (seulement ce qui n'est pas deja regle).
create or replace function public._g8_kit_settings_install(_company uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n_fluids int; n_profiles int; n_defaults int := 0;
begin
  insert into public.maintenance_fluid_articles (company_id, family_code, article_id, sale_unit, liters_per_unit, whole_units)
  select _company, c.family_code, public._g8_article_by_ref(_company, c.reference), c.sale_unit, c.liters_per_unit, c.whole_units
    from public._g8_fluid_articles_catalog() c
   where public._g8_article_by_ref(_company, c.reference) is not null
     and exists (select 1 from public.maintenance_part_families f where f.code = c.family_code)
  on conflict (company_id, family_code) do nothing;
  get diagnostics n_fluids = row_count;

  insert into public.maintenance_engine_profiles (company_id, code, label, priority, match_pattern, exclude_pattern,
              year_from, year_to, oil_article_id, oil_quantity, filter_article_id, washer_article_id, g8_forfait)
  select _company, c.code, c.label, c.priority, c.match_pattern, c.exclude_pattern, c.year_from, c.year_to,
         case when c.oil_reference is null then null else public._g8_article_by_ref(_company, c.oil_reference) end,
         c.oil_quantity,
         public._g8_article_by_ref(_company, c.filter_reference),
         public._g8_article_by_ref(_company, c.washer_reference),
         c.g8_forfait
    from public._g8_engine_profiles_catalog() c
  on conflict (company_id, code) do nothing;
  get diagnostics n_profiles = row_count;

  -- Les lignes par defaut ne sont posees qu'une fois (liste vide) : ensuite, c'est le reglage de l'atelier.
  if not exists (select 1 from public.maintenance_kit_default_lines d where d.company_id = _company) then
    insert into public.maintenance_kit_default_lines (company_id, article_id, quantity, sort_order)
    select _company, public._g8_article_by_ref(_company, c.reference), c.quantity, c.sort
      from public._g8_default_kit_lines_catalog() c
     where public._g8_article_by_ref(_company, c.reference) is not null
    on conflict do nothing;
    get diagnostics n_defaults = row_count;
  end if;
  return jsonb_build_object('fluids', n_fluids, 'profiles', n_profiles, 'default_lines', n_defaults);
end $$;
revoke all on function public._g8_kit_settings_install(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Liquides : conversion de quantite (miroir convertFluidQuantity)
-- ---------------------------------------------------------------------
create or replace function public._maintenance_fluid_convert(
  _qty numeric, _unit text, _liters_per_unit numeric, _whole boolean)
returns table(liters numeric, quantity numeric, plausible boolean, corrected boolean)
language sql immutable as $$
  with f as (
    select case when lower(btrim(coalesce(_unit, ''))) in ('l', 'lt', 'litre', 'litres', 'dm3', 'dm³') then 1.0
                when lower(btrim(coalesce(_unit, ''))) in ('cc', 'cm3', 'cm³', 'ml') then 0.001 end as k
  ), v as (
    select case when f.k is null or _qty is null or _qty <= 0 then null
                when f.k = 1 and _qty >= 100 then _qty * 0.001
                else _qty * f.k end as l,
           coalesce(f.k = 1 and _qty >= 100, false) as fixed
      from f
  )
  select round(v.l, 6),
         case when v.l is null then null
              when coalesce(_liters_per_unit, 0) > 0 then
                case when _whole then ceil(round(v.l / _liters_per_unit, 6)) else round(v.l / _liters_per_unit, 2) end
              else case when _whole then ceil(round(v.l, 6)) else round(v.l, 2) end end,
         coalesce(v.l between 0.05 and 10, false),
         v.fixed
    from v;
$$;

-- Carte d'identite d'un kit : libelle de la famille moteur + « famille > sous-famille > modele » des
-- modeles-annees rattaches (catalogue Ducati), et les annees extremes.
create or replace function public._maintenance_kit_descriptor(_kit uuid)
returns table(descriptor text, min_year integer, max_year integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select k.engine_family_label
         || coalesce(' | ' || string_agg(distinct concat_ws(' > ', fa.description, sm.description, m.description), ' | '), ''),
         min(y.year)::int, max(y.year)::int
    from public.maintenance_kits k
    left join public.maintenance_kit_model_years my on my.kit_id = k.id
    left join public.ducati_catalog_model_years y on y.id = my.model_year_id
    left join public.ducati_catalog_models m on m.id = y.model_id
    left join public.ducati_catalog_families fa on fa.id = m.family_id
    left join public.ducati_catalog_supermodels sm on sm.id = m.supermodel_id
   where k.id = _kit
   group by k.engine_family_label;
$$;
revoke all on function public._maintenance_kit_descriptor(uuid) from public, anon;
grant execute on function public._maintenance_kit_descriptor(uuid) to authenticated;

-- Le profil moteur d'un kit (premier motif qui correspond, par priorite), ou null.
create or replace function public._maintenance_engine_profile_for(_kit uuid)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d record; cid uuid; pid uuid;
begin
  select company_id into cid from public.maintenance_kits where id = _kit;
  select * into d from public._maintenance_kit_descriptor(_kit);
  if cid is null or d.descriptor is null then return null; end if;
  select p.id into pid
    from public.maintenance_engine_profiles p
   where p.company_id = cid and p.is_active
     and d.descriptor ~* p.match_pattern
     and (p.exclude_pattern is null or d.descriptor !~* p.exclude_pattern)
     and (p.year_from is null or (d.min_year is not null and d.min_year >= p.year_from))
     and (p.year_to is null or (d.max_year is not null and d.max_year <= p.year_to))
   order by p.priority, p.code
   limit 1;
  return pid;
end $$;
revoke all on function public._maintenance_engine_profile_for(uuid) from public, anon, authenticated;

-- Nouvelle version d'un kit : version + 1 et photo complete (historique, jamais d'ecrasement).
create or replace function public._maintenance_kit_bump(_kit uuid, _reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.maintenance_kits set version = version + 1, updated_at = now() where id = _kit;
  perform public._maintenance_kit_snapshot(_kit, _reason);
end $$;
revoke all on function public._maintenance_kit_bump(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Completer UN kit (interne) : kit vide de vidange, liquides, filtre, lignes par defaut
-- ---------------------------------------------------------------------
-- a) Kit SANS AUCUNE ligne d'un entretien avec vidange (annuel + huile, 1er entretien) : huile,
--    filtre et joint de vidange de la famille moteur, comme les OIL SERVICE de G8.
create or replace function public._maintenance_kit_fill_empty(_kit uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.maintenance_kits%rowtype; p public.maintenance_engine_profiles%rowtype; pid uuid; n int := 0; a public.articles%rowtype;
begin
  select * into k from public.maintenance_kits where id = _kit;
  if not found or k.status <> 'actif' or k.edited_at is not null
     or coalesce(k.service_kind, '') not in ('oil', 'first_1000')
     or exists (select 1 from public.maintenance_kit_items i where i.kit_id = _kit) then
    return 0;
  end if;
  pid := public._maintenance_engine_profile_for(_kit);
  if pid is not null then select * into p from public.maintenance_engine_profiles where id = pid; end if;

  -- l'huile : article et quantite poses ensuite par le rattachement des liquides (profil)
  insert into public.maintenance_kit_items (company_id, kit_id, family_code, designation, quantity, unit, kind,
                                            confidence, origin, note, provenance, sort_order)
  values (k.company_id, _kit, 'huile_moteur', 'Huile moteur', 1, 'l', 'consommable', 'a_confirmer', 'deduit',
          case when pid is null then 'Kit vide : vidange ajoutee, famille moteur sans forfait G8 (quantite a confirmer).' end,
          jsonb_strip_nulls(jsonb_build_object('besoin', 'forfait_g8', 'echeance', k.service_code,
                                               'forfait_g8', p.g8_forfait, 'kit_vide', true)),
          40);
  n := n + 1;
  if p.filter_article_id is not null then
    select * into a from public.articles where id = p.filter_article_id;
    insert into public.maintenance_kit_items (company_id, kit_id, family_code, article_id, reference, designation, quantity,
                                              kind, confidence, origin, provenance, sort_order)
    values (k.company_id, _kit, 'filtre_huile', a.id, a.reference, coalesce(a.designation, 'Filtre a huile'), 1, 'piece', 'sur', 'deduit',
            jsonb_build_object('besoin', 'forfait_g8', 'echeance', k.service_code, 'reference', 'forfait_g8',
                               'forfait_g8', p.g8_forfait, 'kit_vide', true), 10);
    n := n + 1;
  end if;
  if p.washer_article_id is not null then
    select * into a from public.articles where id = p.washer_article_id;
    insert into public.maintenance_kit_items (company_id, kit_id, family_code, article_id, reference, designation, quantity,
                                              kind, confidence, origin, provenance, sort_order)
    values (k.company_id, _kit, null, a.id, a.reference, coalesce(a.designation, 'Joint de vidange'), 1, 'piece', 'sur', 'deduit',
            jsonb_build_object('besoin', 'forfait_g8', 'echeance', k.service_code, 'reference', 'forfait_g8',
                               'forfait_g8', p.g8_forfait, 'kit_vide', true), 20);
    n := n + 1;
  end if;
  return n;
end $$;
revoke all on function public._maintenance_kit_fill_empty(uuid) from public, anon, authenticated;

-- b) Liquides sans article -> l'article du reglage, quantite convertie dans son unite de vente.
--    Quantite non donnee par la source (huile moteur) -> celle du forfait G8 de la famille moteur.
--    Filtre a huile introuvable dans le catalogue -> celui du forfait G8 de la famille moteur.
--    La quantite et l'unite de la source restent dans la provenance.
create or replace function public._maintenance_kit_link_fluids(_kit uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k public.maintenance_kits%rowtype; r record; c record; p public.maintenance_engine_profiles%rowtype;
  pid uuid; looked boolean := false; n int := 0; nf int := 0;
  art uuid; q numeric; conf text; qsrc text; pq numeric; nt text; a public.articles%rowtype;
begin
  select * into k from public.maintenance_kits where id = _kit;
  if not found or k.status <> 'actif' then return 0; end if;

  for r in
    select i.*, fa.article_id as fa_article, fa.sale_unit, fa.liters_per_unit, fa.whole_units
      from public.maintenance_kit_items i
      join public.maintenance_fluid_articles fa on fa.company_id = i.company_id and fa.family_code = i.family_code
     where i.kit_id = _kit and i.kind = 'consommable' and i.article_id is null and i.confidence <> 'absent'
  loop
    if r.family_code = 'huile_moteur' and not looked then
      pid := public._maintenance_engine_profile_for(_kit); looked := true;
      if pid is not null then select * into p from public.maintenance_engine_profiles where id = pid; end if;
    end if;
    select * into c from public._maintenance_fluid_convert(r.quantity, r.unit, r.liters_per_unit, r.whole_units);
    art := r.fa_article; pq := null;
    if r.family_code = 'huile_moteur' and pid is not null then
      art := coalesce(p.oil_article_id, r.fa_article);
      if p.oil_quantity is not null then
        pq := case when coalesce(r.liters_per_unit, 0) > 0 then
                     case when r.whole_units then ceil(p.oil_quantity / r.liters_per_unit) else round(p.oil_quantity / r.liters_per_unit, 2) end
                   else p.oil_quantity end;
      end if;
    end if;
    nt := r.note;
    if coalesce(r.provenance ->> 'quantite', '') = 'manuel' and c.plausible and not c.corrected and coalesce(c.quantity, 0) > 0 then
      q := c.quantity; conf := 'sur'; qsrc := 'manuel';
    elsif coalesce(pq, 0) > 0 then
      q := pq; conf := 'sur'; qsrc := 'forfait_g8'; nt := null;
    else
      q := 1; conf := 'a_confirmer'; qsrc := null;
      if coalesce(r.provenance ->> 'quantite', '') = 'manuel' then
        nt := concat_ws(' ', nt, 'Quantite de la source a verifier : '
                        || trim(to_char(r.quantity, 'FM9999990.999')) || ' ' || coalesce(r.unit, '') || '.');
      end if;
    end if;
    select * into a from public.articles where id = art;
    update public.maintenance_kit_items
       set article_id = art,
           reference = a.reference,
           quantity = q,
           unit = coalesce(r.sale_unit, r.unit),
           confidence = conf,
           note = nt,
           provenance = coalesce(r.provenance, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
             'quantite', coalesce(qsrc, r.provenance ->> 'quantite'),
             'forfait_g8', case when qsrc = 'forfait_g8' or art is distinct from r.fa_article then p.g8_forfait end,
             'profil_moteur', case when pid is not null and r.family_code = 'huile_moteur' then p.label end,
             'liquide', jsonb_strip_nulls(jsonb_build_object(
               'article', 'reglage', 'quantite_source', r.quantity, 'unite_source', r.unit, 'litres', c.liters))))
     where id = r.id;
    n := n + 1;
  end loop;

  -- Filtre a huile sans reference dans le catalogue du modele : celui du forfait G8 de la famille.
  if exists (select 1 from public.maintenance_kit_items i
              where i.kit_id = _kit and i.family_code = 'filtre_huile' and i.article_id is null) then
    if not looked then
      pid := public._maintenance_engine_profile_for(_kit); looked := true;
      if pid is not null then select * into p from public.maintenance_engine_profiles where id = pid; end if;
    end if;
    if pid is not null and p.filter_article_id is not null then
      select * into a from public.articles where id = p.filter_article_id;
      update public.maintenance_kit_items i
         set article_id = a.id, reference = a.reference, confidence = 'sur',
             note = null,
             provenance = coalesce(i.provenance, '{}'::jsonb)
                          || jsonb_build_object('reference', 'forfait_g8', 'forfait_g8', p.g8_forfait, 'profil_moteur', p.label)
       where i.kit_id = _kit and i.family_code = 'filtre_huile' and i.article_id is null
         and not exists (select 1 from public.maintenance_kit_items x where x.kit_id = _kit and x.article_id = a.id);
      get diagnostics nf = row_count;
      n := n + nf;
    end if;
  end if;
  return n;
end $$;
revoke all on function public._maintenance_kit_link_fluids(uuid) from public, anon, authenticated;

-- c) Lignes par defaut (reglage) absentes du kit. Un kit corrige par l'atelier n'est pas retouche.
create or replace function public._maintenance_kit_add_default_lines(_kit uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.maintenance_kits%rowtype; n int;
begin
  select * into k from public.maintenance_kits where id = _kit;
  if not found or k.status <> 'actif' or k.edited_at is not null then return 0; end if;
  insert into public.maintenance_kit_items (company_id, kit_id, article_id, reference, designation, quantity, kind,
                                            confidence, origin, provenance, sort_order)
  select k.company_id, k.id, a.id, a.reference, a.designation, d.quantity,
         case when a.mgmt_type::text in ('F', 'T') then 'forfait' else 'piece' end,
         'sur', 'defaut', jsonb_build_object('besoin', 'defaut'), 1000 + d.sort_order
    from public.maintenance_kit_default_lines d
    join public.articles a on a.id = d.article_id and a.company_id = k.company_id and a.is_active
   where d.company_id = k.company_id
     and not exists (select 1 from public.maintenance_kit_items i where i.kit_id = k.id and i.article_id = d.article_id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public._maintenance_kit_add_default_lines(uuid) from public, anon, authenticated;

-- Les trois, dans l'ordre (vide -> liquides -> defaut), une seule nouvelle version si quelque chose change.
create or replace function public._maintenance_kit_complete(_kit uuid, _bump boolean, _reason text default 'rattrapage G8')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n_fill int; n_fluid int; n_def int;
begin
  n_fill  := public._maintenance_kit_fill_empty(_kit);
  n_fluid := public._maintenance_kit_link_fluids(_kit);
  n_def   := public._maintenance_kit_add_default_lines(_kit);
  if _bump and n_fill + n_fluid + n_def > 0 then
    perform public._maintenance_kit_bump(_kit, _reason);
  end if;
  return jsonb_build_object('filled', n_fill, 'fluids', n_fluid, 'defaults', n_def);
end $$;
revoke all on function public._maintenance_kit_complete(uuid, boolean, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Generateur : chaque kit cree recoit liquides, filtre G8, lignes par defaut (meme logique)
--    Redefinition de 20261103200000 ; seules differences : un consommable n'est plus rattache
--    « brut » a l'article du reglage (quantite non convertie) a l'insertion, puis
--    `_maintenance_kit_complete` avant la photo « generation ».
-- ---------------------------------------------------------------------
create or replace function public._maintenance_kit_put(_company uuid, _ekey text, _elabel text, _mid text, _sc text, _slabel text, _skind text, _skm integer, _src text, _lines jsonb, _repris_de text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
           case when x.kind = 'piece' then x.article_id else null end,   -- liquide : rattache ensuite (quantite convertie)
           x.article_ref,
           case when x.kind = 'piece' then x.references_ else null end,
           coalesce(x.designation, x.family_label, x.family_code),
           coalesce(nullif(x.quantity, 0), 1),
           x.unit,
           x.kind,
           case when x.confidence = 'absent' then 'absent'
                when x.confidence = 'sur' and x.kind = 'piece' then 'sur'
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
     where x.confidence <> 'non_applicable';

  end if;

  insert into public.maintenance_kit_model_years (kit_id, model_year_id)
  values (kid, _mid) on conflict do nothing;
  lnk := found;

  -- Kit cree : rattache au modele-annee (le profil moteur lit ses modeles), on le complete
  -- (liquides, filtre G8, lignes par defaut) puis on prend la photo « generation ».
  if st = 'created' then
    perform public._maintenance_kit_complete(kid, false);
    select count(*) filter (where i.confidence = 'sur'),
           count(*) filter (where cardinality(coalesce(i.catalog_refs, array[]::text[])) > 1),
           count(*) filter (where i.confidence = 'absent')
      into n_sur, n_multi, n_abs
      from public.maintenance_kit_items i where i.kit_id = kid;
    perform public._maintenance_kit_snapshot(kid, 'generation');
  end if;

  return jsonb_build_object('kit', kid, 'state', st, 'linked', lnk,
                            'sur', n_sur, 'multi', n_multi, 'absent', n_abs);
end $function$;
revoke all on function public._maintenance_kit_put(uuid, text, text, text, text, text, text, integer, text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. Les lignes de service (F / T) ne sont pas des pieces : ni preparation, ni reservation,
--    ni commande. Redefinitions de 20261103270000 (une condition ajoutee chacune).
-- ---------------------------------------------------------------------
-- Le kit d'un modele-annee pour un type d'entretien : un kit qui contient des pieces passe
-- AVANT un kit vide ou fait seulement de lignes de service (avant : le code exact gagnait meme
-- vide, et le rendez-vous ne reservait rien). Puis l'ordre d'origine (code exact, source...).
create or replace function public._workshop_kit_for(_company uuid, _model_year text, _kind text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select k.id
    from public.maintenance_kits k
    join public.maintenance_kit_model_years y on y.kit_id = k.id
   where k.company_id = _company and y.model_year_id = _model_year and k.status = 'actif'
     and coalesce(k.service_kind, public.maintenance_service_kind_of(k.service_code)) = _kind
   order by exists (select 1 from public.maintenance_kit_items i where i.kit_id = k.id and i.kind <> 'forfait') desc,
            (k.service_code = _kind) desc,
            case k.source when 'manuel' then 1 when 'plan' then 2 else 3 end,
            k.service_km nulls last, k.edited_at desc nulls last, k.version desc
   limit 1;
$$;
revoke all on function public._workshop_kit_for(uuid, text, text) from public, anon, authenticated;

create or replace function public._workshop_service_kit_items(_company uuid, _model_year text, _service text)
 RETURNS TABLE(kit_item_id uuid, kit_id uuid, service_kind text, family_code text, article_id uuid, reference text, designation text, quantity numeric, unit text, kind text, confidence text, sort_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with kits as (
    select c.code, c.ord, public._workshop_kit_for(_company, _model_year, c.code) as kid
      from unnest(public.workshop_service_kit_codes(_service)) with ordinality as c(code, ord)
     where _company is not null and _model_year is not null
  ), items as (
    select i.id as iid, k.kid, k.code, k.ord, i.family_code,
           coalesce(i.article_id, fa.article_id) as aid,
           coalesce(nullif(btrim(i.reference), ''), a.reference) as ref,
           i.designation, i.quantity, i.unit, i.kind, i.confidence, i.sort_order,
           coalesce(coalesce(i.article_id, fa.article_id)::text,
                    nullif(upper(btrim(coalesce(i.reference, ''))), ''),
                    'fam:' || i.family_code,
                    'des:' || lower(btrim(i.designation))) as dkey
      from kits k
      join public.maintenance_kit_items i on i.kit_id = k.kid
      left join public.maintenance_fluid_articles fa
             on i.article_id is null and fa.company_id = _company and fa.family_code = i.family_code
      left join public.articles a on a.id = coalesce(i.article_id, fa.article_id)
     where k.kid is not null
       and i.kind <> 'forfait'           -- ligne de service G8 (F / T) : pas une piece
  )
  select distinct on (items.dkey)
         items.iid, items.kid, items.code, items.family_code, items.aid, items.ref, items.designation,
         items.quantity, items.unit, items.kind, items.confidence, items.sort_order
    from items
   order by items.dkey, items.quantity desc, items.ord;
$function$;
revoke all on function public._workshop_service_kit_items(uuid, text, text) from public, anon, authenticated;

create or replace function public.picking_open_for_repair_order(_or uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r     public.repair_orders%rowtype;
  svc   record;
  pid   uuid;
  pst   text;
  _kind text;
  _kits uuid[];
  n_kit int := 0;
  n_or  int := 0;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then
    raise exception 'Ordre de réparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(r.company_id) then
    raise exception 'Accès refusé à la société %', r.company_id using errcode = '42501';
  end if;
  if r.status = 'annule' then
    raise exception 'OR annulé : rien à préparer.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('picking_or:' || _or::text));

  select * into svc from public._repair_order_service(_or);
  _kind := public._workshop_kind_of(svc.service_code);

  select id, status into pid, pst from public.picking_lists where repair_order_id = _or;
  if pid is null then
    insert into public.picking_lists (company_id, repair_order_id, service_label, created_by)
    values (r.company_id, _or, svc.service_label, auth.uid())
    returning id into pid;
    pst := 'en_cours';
  end if;
  if pst in ('annulee', 'livre') then
    return pid;
  end if;

  -- a) les pieces de l'entretien (kits reunis, M-109)
  if svc.model_year_id is not null and _kind is not null then
    insert into public.picking_list_items
      (company_id, picking_id, article_id, designation, reference, qty_ordered, qty_picked, status,
       origin, kit_item_id, unit, sort_order)
    select r.company_id, pid, k.article_id,
           k.designation || case when k.kind = 'consommable' and k.unit is not null
                                 then ' (' || trim(to_char(k.quantity, 'FM9999990.999')) || ' ' || k.unit || ')'
                                 else '' end,
           k.reference, k.quantity, 0, 'a_preparer',
           'kit', k.kit_item_id, k.unit, k.sort_order
      from public._workshop_service_kit_items(r.company_id, svc.model_year_id, _kind) k
     where not exists (select 1 from public.picking_list_items x
                        where x.picking_id = pid
                          and (x.kit_item_id = k.kit_item_id
                               or (k.article_id is not null and x.article_id = k.article_id and x.removed_at is null)));
    get diagnostics n_kit = row_count;
    select array_agg(distinct k.kit_id) into _kits
      from public._workshop_service_kit_items(r.company_id, svc.model_year_id, _kind) k;
  end if;

  -- b) les pieces ajoutees par le technicien : lignes « piece » de l'OR
  insert into public.picking_list_items
    (company_id, picking_id, article_id, designation, reference, qty_ordered, qty_picked, status,
     origin, sort_order)
  select r.company_id, pid, l.article_id, l.designation, a.reference, l.quantity, 0, 'a_preparer',
         'atelier', 1000 + l.sort_order
    from public.repair_order_lines l
    left join public.articles a on a.id = l.article_id
   where l.or_id = _or
     and l.kind = 'piece'
     and l.quantity > 0
     and coalesce(a.mgmt_type::text, '') not in ('F', 'T')   -- ligne de service / MO : rien a preparer
     and not exists (
       select 1 from public.picking_list_items x
        where x.picking_id = pid
          and ((l.article_id is not null and x.article_id is not distinct from l.article_id)
               or (l.article_id is null and x.designation is not distinct from l.designation)));
  get diagnostics n_or = row_count;

  perform public._picking_refresh_status(pid);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'picking_open_for_repair_order', 'picking_lists', pid::text, 'screen', null,
          jsonb_build_object('or_id', _or, 'or_number', r.number, 'kit_ids', _kits,
                             'service_code', svc.service_code, 'service_label', svc.service_label,
                             'lines_kit', n_kit, 'lines_workshop', n_or));
  return pid;
end $function$;
revoke all on function public.picking_open_for_repair_order(uuid) from public, anon;
grant execute on function public.picking_open_for_repair_order(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Edition d'un kit par l'atelier : on peut aussi y mettre une ligne de service (F) ou de la
--     main-d'oeuvre (T), comme dans un forfait G8. Redefinition de 20260923161000.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_kit_item_save(
  _kit uuid, _item uuid, _article uuid, _quantity numeric,
  _designation text default null, _note text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k   public.maintenance_kits%rowtype;
  a   public.articles%rowtype;
  rid uuid;
  old public.maintenance_kit_items%rowtype;
begin
  select * into k from public.maintenance_kits where id = _kit;
  if not found then raise exception 'Kit introuvable.' using errcode = 'P0002'; end if;
  if not public.is_member(k.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if k.status <> 'actif' then
    raise exception 'Ce kit est archivé.' using errcode = 'P0001';
  end if;
  if coalesce(_quantity, 0) <= 0 then
    raise exception 'La quantité doit être supérieure à zéro.' using errcode = 'P0001';
  end if;

  if _item is null then
    if _article is null then
      raise exception 'Choisissez une pièce.' using errcode = 'P0001';
    end if;
    select * into a from public.articles where id = _article and company_id = k.company_id;
    if not found then raise exception 'Pièce introuvable.' using errcode = 'P0002'; end if;
    if a.mgmt_type::text not in ('A', 'M', 'N', 'F', 'T') then
      raise exception 'Seules les pièces, les lignes de service et la main-d''oeuvre entrent dans un kit d''entretien.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.maintenance_kit_items i where i.kit_id = _kit and i.article_id = _article) then
      raise exception 'Cette pièce est déjà dans le kit.' using errcode = 'P0001';
    end if;
    insert into public.maintenance_kit_items
      (company_id, kit_id, article_id, reference, designation, quantity, kind, confidence, origin, note, sort_order)
    values (k.company_id, _kit, _article, a.reference,
            coalesce(nullif(btrim(_designation), ''), a.designation, a.reference),
            _quantity, case when a.mgmt_type::text in ('F', 'T') then 'forfait' else 'piece' end,
            'sur', 'ajoute', nullif(btrim(coalesce(_note, '')), ''),
            coalesce((select max(i.sort_order) + 1 from public.maintenance_kit_items i where i.kit_id = _kit), 1))
    returning id into rid;
  else
    select * into old from public.maintenance_kit_items where id = _item and kit_id = _kit;
    if not found then raise exception 'Ligne de kit introuvable.' using errcode = 'P0002'; end if;
    update public.maintenance_kit_items
       set quantity = _quantity,
           article_id = coalesce(_article, article_id),
           reference = case when _article is null then reference
                            else (select reference from public.articles where id = _article) end,
           designation = coalesce(nullif(btrim(_designation), ''), designation),
           note = coalesce(nullif(btrim(coalesce(_note, '')), ''), note),
           confidence = case when coalesce(_article, article_id) is null then 'a_confirmer' else 'sur' end
     where id = _item
     returning id into rid;
  end if;

  update public.maintenance_kits
     set version = version + 1, edited_at = now(), edited_by = auth.uid(), updated_at = now()
   where id = _kit;
  perform public._maintenance_kit_snapshot(_kit, case when _item is null then 'ajout' else 'modification' end);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (k.company_id, auth.uid(), case when _item is null then 'maintenance_kit_item_add' else 'maintenance_kit_item_update' end,
          'maintenance_kits', _kit::text, 'screen',
          case when _item is null then null else to_jsonb(old) end,
          jsonb_build_object('item_id', rid, 'article_id', _article, 'quantity', _quantity));
  return rid;
end $$;
revoke all on function public.maintenance_kit_item_save(uuid, uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.maintenance_kit_item_save(uuid, uuid, uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Reglages des kits (ecran Atelier -> Kits -> Reglages)
-- ---------------------------------------------------------------------
create or replace function public.maintenance_kit_settings(_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_edit', public._maintenance_kit_may_configure(_company),
    'fluids', coalesce((
      select jsonb_agg(jsonb_build_object(
               'family_code', f.code, 'family_label', f.label, 'family_unit', f.unit,
               'article_id', fa.article_id, 'reference', a.reference, 'designation', a.designation,
               'sale_unit', fa.sale_unit, 'liters_per_unit', fa.liters_per_unit, 'whole_units', coalesce(fa.whole_units, false),
               'unlinked', (select count(*) from public.maintenance_kit_items i join public.maintenance_kits k on k.id = i.kit_id
                             where k.company_id = _company and k.status = 'actif' and i.family_code = f.code and i.article_id is null))
             order by f.sort)
        from public.maintenance_part_families f
        left join public.maintenance_fluid_articles fa on fa.company_id = _company and fa.family_code = f.code
        left join public.articles a on a.id = fa.article_id
       where f.kind = 'consommable'), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'code', p.code, 'label', p.label, 'priority', p.priority,
               'match_pattern', p.match_pattern, 'exclude_pattern', p.exclude_pattern,
               'year_from', p.year_from, 'year_to', p.year_to,
               'oil_article_id', p.oil_article_id, 'oil_reference', oa.reference, 'oil_quantity', p.oil_quantity,
               'filter_article_id', p.filter_article_id, 'filter_reference', fa2.reference,
               'washer_article_id', p.washer_article_id, 'washer_reference', wa.reference,
               'g8_forfait', p.g8_forfait, 'is_active', p.is_active)
             order by p.priority, p.code)
        from public.maintenance_engine_profiles p
        left join public.articles oa on oa.id = p.oil_article_id
        left join public.articles fa2 on fa2.id = p.filter_article_id
        left join public.articles wa on wa.id = p.washer_article_id
       where p.company_id = _company), '[]'::jsonb),
    'defaults', coalesce((
      select jsonb_agg(jsonb_build_object(
               'article_id', d.article_id, 'reference', a.reference, 'designation', a.designation,
               'mgmt_type', a.mgmt_type::text, 'quantity', d.quantity, 'sort_order', d.sort_order,
               'sale_price_ttc', a.sale_price_ttc)
             order by d.sort_order, a.reference)
        from public.maintenance_kit_default_lines d
        join public.articles a on a.id = d.article_id
       where d.company_id = _company), '[]'::jsonb),
    'kits', (select count(*) from public.maintenance_kits k where k.company_id = _company and k.status = 'actif'),
    'empty_kits', (select count(*) from public.maintenance_kits k where k.company_id = _company and k.status = 'actif'
                     and not exists (select 1 from public.maintenance_kit_items i where i.kit_id = k.id)),
    'lines_without_article', (select count(*) from public.maintenance_kit_items i join public.maintenance_kits k on k.id = i.kit_id
                               where k.company_id = _company and k.status = 'actif' and i.article_id is null));
end $$;
revoke all on function public.maintenance_kit_settings(uuid) from public, anon;
grant execute on function public.maintenance_kit_settings(uuid) to authenticated;

-- Liquide -> article (et unite de vente). Ne touche pas aux kits : le rattrapage se lance ensuite
-- (maintenance_kits_complete, par lots), chaque kit modifie prend une nouvelle version.
create or replace function public.maintenance_fluid_mapping_save(
  _company uuid, _family text, _article uuid, _sale_unit text default null,
  _liters_per_unit numeric default null, _whole_units boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare old jsonb;
begin
  if not public._maintenance_kit_may_configure(_company) then
    raise exception 'Réservé à l''administrateur, au chef d''atelier et au magasinier.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.maintenance_part_families f where f.code = _family and f.kind = 'consommable') then
    raise exception 'Famille de consommable inconnue : %', coalesce(_family, '—') using errcode = 'P0001';
  end if;
  if _liters_per_unit is not null and _liters_per_unit <= 0 then
    raise exception 'La contenance doit être supérieure à zéro.' using errcode = 'P0001';
  end if;
  select to_jsonb(x) into old from public.maintenance_fluid_articles x where x.company_id = _company and x.family_code = _family;
  if _article is null then
    delete from public.maintenance_fluid_articles where company_id = _company and family_code = _family;
  else
    if not exists (select 1 from public.articles a where a.id = _article and a.company_id = _company) then
      raise exception 'Article introuvable.' using errcode = 'P0002';
    end if;
    insert into public.maintenance_fluid_articles (company_id, family_code, article_id, sale_unit, liters_per_unit, whole_units, updated_by)
    values (_company, _family, _article, nullif(btrim(coalesce(_sale_unit, '')), ''), _liters_per_unit, coalesce(_whole_units, false), auth.uid())
    on conflict (company_id, family_code) do update
      set article_id = excluded.article_id, sale_unit = excluded.sale_unit, liters_per_unit = excluded.liters_per_unit,
          whole_units = excluded.whole_units, updated_at = now(), updated_by = excluded.updated_by;
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'maintenance_fluid_mapping_save', 'maintenance_fluid_articles', _family, 'screen', old,
          jsonb_build_object('family_code', _family, 'article_id', _article, 'sale_unit', _sale_unit,
                             'liters_per_unit', _liters_per_unit, 'whole_units', _whole_units));
end $$;
revoke all on function public.maintenance_fluid_mapping_save(uuid, text, uuid, text, numeric, boolean) from public, anon;
grant execute on function public.maintenance_fluid_mapping_save(uuid, text, uuid, text, numeric, boolean) to authenticated;

-- Ancienne entree (meme signature) : garde l'unite deja reglee, puis rattache les lignes de cette
-- famille, kit par kit, en VERSIONNANT chaque kit (avant : mise a jour en bloc sans version).
create or replace function public.maintenance_fluid_article_set(_company uuid, _family text, _article uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare fa public.maintenance_fluid_articles%rowtype; kid uuid;
begin
  select * into fa from public.maintenance_fluid_articles where company_id = _company and family_code = _family;
  perform public.maintenance_fluid_mapping_save(_company, _family, _article, fa.sale_unit, fa.liters_per_unit, coalesce(fa.whole_units, false));
  if _article is not null then
    for kid in select distinct i.kit_id from public.maintenance_kit_items i join public.maintenance_kits k on k.id = i.kit_id
                where k.company_id = _company and k.status = 'actif' and i.family_code = _family and i.article_id is null loop
      if public._maintenance_kit_link_fluids(kid) > 0 then
        perform public._maintenance_kit_bump(kid, 'reglage liquide');
      end if;
    end loop;
  end if;
end $$;
revoke all on function public.maintenance_fluid_article_set(uuid, text, uuid) from public, anon;
grant execute on function public.maintenance_fluid_article_set(uuid, text, uuid) to authenticated;

-- Profil moteur (quantite d'huile G8 par famille moteur). Motifs verifies avant enregistrement.
create or replace function public.maintenance_engine_profile_save(
  _company uuid, _id uuid, _code text, _label text, _priority integer, _match_pattern text,
  _exclude_pattern text, _year_from integer, _year_to integer, _oil_article uuid, _oil_quantity numeric,
  _filter_article uuid, _washer_article uuid, _is_active boolean default true)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare rid uuid; old jsonb; dummy boolean;
begin
  if not public._maintenance_kit_may_configure(_company) then
    raise exception 'Réservé à l''administrateur, au chef d''atelier et au magasinier.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(_label, '')), '') is null or nullif(btrim(coalesce(_match_pattern, '')), '') is null then
    raise exception 'Le libellé et le motif sont obligatoires.' using errcode = 'P0001';
  end if;
  begin
    dummy := '' ~* _match_pattern;
    if nullif(btrim(coalesce(_exclude_pattern, '')), '') is not null then dummy := '' ~* _exclude_pattern; end if;
  exception when others then
    raise exception 'Motif invalide : %', sqlerrm using errcode = 'P0001';
  end;
  if _oil_quantity is not null and _oil_quantity <= 0 then
    raise exception 'La quantité d''huile doit être supérieure à zéro.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(array[_oil_article, _filter_article, _washer_article]) x(id)
              where x.id is not null and not exists (select 1 from public.articles a where a.id = x.id and a.company_id = _company)) then
    raise exception 'Article introuvable.' using errcode = 'P0002';
  end if;
  if _id is null then
    insert into public.maintenance_engine_profiles (company_id, code, label, priority, match_pattern, exclude_pattern,
                year_from, year_to, oil_article_id, oil_quantity, filter_article_id, washer_article_id, is_active, updated_by)
    values (_company, coalesce(nullif(btrim(coalesce(_code, '')), ''), 'profil_' || substr(md5(random()::text), 1, 8)),
            btrim(_label), coalesce(_priority, 100), _match_pattern, nullif(btrim(coalesce(_exclude_pattern, '')), ''),
            _year_from, _year_to, _oil_article, _oil_quantity, _filter_article, _washer_article, coalesce(_is_active, true), auth.uid())
    returning id into rid;
  else
    select to_jsonb(p) into old from public.maintenance_engine_profiles p where p.id = _id and p.company_id = _company;
    if old is null then raise exception 'Profil introuvable.' using errcode = 'P0002'; end if;
    update public.maintenance_engine_profiles
       set label = btrim(_label), priority = coalesce(_priority, priority), match_pattern = _match_pattern,
           exclude_pattern = nullif(btrim(coalesce(_exclude_pattern, '')), ''), year_from = _year_from, year_to = _year_to,
           oil_article_id = _oil_article, oil_quantity = _oil_quantity, filter_article_id = _filter_article,
           washer_article_id = _washer_article, is_active = coalesce(_is_active, true), updated_at = now(), updated_by = auth.uid()
     where id = _id
     returning id into rid;
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'maintenance_engine_profile_save', 'maintenance_engine_profiles', rid::text, 'screen', old,
          (select to_jsonb(p) from public.maintenance_engine_profiles p where p.id = rid));
  return rid;
end $$;
revoke all on function public.maintenance_engine_profile_save(uuid, uuid, text, text, integer, text, text, integer, integer, uuid, numeric, uuid, uuid, boolean) from public, anon;
grant execute on function public.maintenance_engine_profile_save(uuid, uuid, text, text, integer, text, text, integer, integer, uuid, numeric, uuid, uuid, boolean) to authenticated;

create or replace function public.maintenance_engine_profile_delete(_company uuid, _id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare old jsonb;
begin
  if not public._maintenance_kit_may_configure(_company) then
    raise exception 'Réservé à l''administrateur, au chef d''atelier et au magasinier.' using errcode = '42501';
  end if;
  select to_jsonb(p) into old from public.maintenance_engine_profiles p where p.id = _id and p.company_id = _company;
  delete from public.maintenance_engine_profiles where id = _id and company_id = _company;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'maintenance_engine_profile_delete', 'maintenance_engine_profiles', _id::text, 'screen', old, null);
end $$;
revoke all on function public.maintenance_engine_profile_delete(uuid, uuid) from public, anon;
grant execute on function public.maintenance_engine_profile_delete(uuid, uuid) to authenticated;

-- Lignes par defaut : ajout / quantite (_quantity) ou retrait (_quantity null).
create or replace function public.maintenance_kit_default_line_save(
  _company uuid, _article uuid, _quantity numeric, _sort_order integer default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare old jsonb; a public.articles%rowtype;
begin
  if not public._maintenance_kit_may_configure(_company) then
    raise exception 'Réservé à l''administrateur, au chef d''atelier et au magasinier.' using errcode = '42501';
  end if;
  select to_jsonb(d) into old from public.maintenance_kit_default_lines d where d.company_id = _company and d.article_id = _article;
  if _quantity is null then
    delete from public.maintenance_kit_default_lines where company_id = _company and article_id = _article;
  else
    if _quantity <= 0 then raise exception 'La quantité doit être supérieure à zéro.' using errcode = 'P0001'; end if;
    select * into a from public.articles where id = _article and company_id = _company;
    if not found then raise exception 'Article introuvable.' using errcode = 'P0002'; end if;
    if a.mgmt_type::text not in ('A', 'M', 'N', 'F', 'T') then
      raise exception 'Seules les pièces, les lignes de service et la main-d''oeuvre entrent dans un kit d''entretien.' using errcode = 'P0001';
    end if;
    insert into public.maintenance_kit_default_lines (company_id, article_id, quantity, sort_order, updated_by)
    values (_company, _article, _quantity,
            coalesce(_sort_order, (select coalesce(max(d.sort_order), 0) + 1 from public.maintenance_kit_default_lines d where d.company_id = _company)),
            auth.uid())
    on conflict (company_id, article_id) do update
      set quantity = excluded.quantity, sort_order = coalesce(_sort_order, public.maintenance_kit_default_lines.sort_order),
          updated_at = now(), updated_by = excluded.updated_by;
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'maintenance_kit_default_line_save', 'maintenance_kit_default_lines', _article::text, 'screen', old,
          case when _quantity is null then null else jsonb_build_object('article_id', _article, 'quantity', _quantity) end);
end $$;
revoke all on function public.maintenance_kit_default_line_save(uuid, uuid, numeric, integer) from public, anon;
grant execute on function public.maintenance_kit_default_line_save(uuid, uuid, numeric, integer) to authenticated;

-- Rattrapage des kits existants, par lots (delai serveur 8 s depuis l'ecran) :
--   _apply = false : apercu (kits vides, liquides rattachables, lignes par defaut manquantes) ;
--   _apply = true  : kits [offset, offset + limit[ completes, nouvelle version pour chaque kit change.
create or replace function public.maintenance_kits_complete(
  _company uuid, _apply boolean default false, _limit integer default 100, _offset integer default 0)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare kid uuid; r jsonb; seen int := 0; changed int := 0; n_fill int := 0; n_fluid int := 0; n_def int := 0; total int;
begin
  if not public._maintenance_kit_may_configure(_company) then
    raise exception 'Réservé à l''administrateur, au chef d''atelier et au magasinier.' using errcode = '42501';
  end if;
  select count(*) into total from public.maintenance_kits k where k.company_id = _company and k.status = 'actif';
  if not coalesce(_apply, false) then
    return jsonb_build_object(
      'kits', total,
      'empty_kits', (select count(*) from public.maintenance_kits k where k.company_id = _company and k.status = 'actif'
                       and not exists (select 1 from public.maintenance_kit_items i where i.kit_id = k.id)),
      'fluid_lines', (select count(*) from public.maintenance_kit_items i
                        join public.maintenance_kits k on k.id = i.kit_id and k.status = 'actif'
                        join public.maintenance_fluid_articles fa on fa.company_id = i.company_id and fa.family_code = i.family_code
                       where k.company_id = _company and i.kind = 'consommable' and i.article_id is null),
      'default_lines', (select count(*) from public.maintenance_kits k
                          join public.maintenance_kit_default_lines d on d.company_id = k.company_id
                         where k.company_id = _company and k.status = 'actif' and k.edited_at is null
                           and not exists (select 1 from public.maintenance_kit_items i where i.kit_id = k.id and i.article_id = d.article_id)),
      'done', true);
  end if;
  for kid in select k.id from public.maintenance_kits k where k.company_id = _company and k.status = 'actif'
              order by k.id limit greatest(coalesce(_limit, 100), 1) offset greatest(coalesce(_offset, 0), 0) loop
    seen := seen + 1;
    r := public._maintenance_kit_complete(kid, true, 'rattrapage G8');
    n_fill := n_fill + (r ->> 'filled')::int; n_fluid := n_fluid + (r ->> 'fluids')::int; n_def := n_def + (r ->> 'defaults')::int;
    if (r ->> 'filled')::int + (r ->> 'fluids')::int + (r ->> 'defaults')::int > 0 then changed := changed + 1; end if;
  end loop;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'maintenance_kits_complete', 'maintenance_kits', _company::text,
          case when auth.uid() is null then 'migration' else 'screen' end, null,
          jsonb_build_object('offset', _offset, 'kits', seen, 'kits_changed', changed,
                             'filled', n_fill, 'fluids', n_fluid, 'defaults', n_def));
  return jsonb_build_object('kits', seen, 'kits_changed', changed, 'filled', n_fill, 'fluids', n_fluid, 'defaults', n_def,
                            'total', total, 'next_offset', greatest(coalesce(_offset, 0), 0) + seen,
                            'done', seen < greatest(coalesce(_limit, 100), 1));
end $$;
revoke all on function public.maintenance_kits_complete(uuid, boolean, integer, integer) from public, anon;
grant execute on function public.maintenance_kits_complete(uuid, boolean, integer, integer) to authenticated;

-- Lignes de kit encore sans article (la liste « restees vides » : filtre introuvable, courroie...).
create or replace function public.maintenance_kits_unlinked(_company uuid)
returns table(kit_id uuid, engine_family_label text, service_label text, family_code text, designation text,
              confidence text, model_years integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select k.id, k.engine_family_label, k.service_label, i.family_code, i.designation, i.confidence,
         (select count(*)::int from public.maintenance_kit_model_years y where y.kit_id = k.id)
    from public.maintenance_kit_items i
    join public.maintenance_kits k on k.id = i.kit_id
   where k.company_id = _company and k.status = 'actif' and i.article_id is null
   order by i.family_code, k.engine_family_label, k.service_label;
end $$;
revoke all on function public.maintenance_kits_unlinked(uuid) from public, anon;
grant execute on function public.maintenance_kits_unlinked(uuid) to authenticated;

-- Pour une autre societe (concession) : articles forfait G8, 37 forfaits, reglages des kits.
-- Sans prix (bloc separe) ni rattrapage des kits (bouton de l'ecran Kits). Administrateur.
create or replace function public.workshop_g8_install(_company uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_admin(_company) then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'articles', public._g8_service_articles_install(_company),
    'forfaits', public._g8_forfaits_install(_company),
    'settings', public._g8_kit_settings_install(_company));
end $$;
revoke all on function public.workshop_g8_install(uuid) from public, anon;
grant execute on function public.workshop_g8_install(uuid) to authenticated;

notify pgrst, 'reload schema';
