-- =====================================================================
-- MISSION 04 — CARTE 2 : « Moderniser la liste des civilités ».
-- Migration STRICTEMENT ADDITIVE : une colonne, des valeurs de référence
-- ajoutées, une COPIE de valeurs. Rien n'est supprimé ni écrasé.
--
-- G8 mélangeait dans « civilité » MR, MME et des formes de société (SA, SPRL,
-- SCRL, ASBL, BV…). Désormais :
--  - civilité (contacts.civility) = celle de la personne : M. / Mme / Mx ;
--  - forme juridique (contacts.legal_form, NOUVELLE colonne) = pour les pros,
--    choisie dans la table de référence `civility` de Paramètres (lignes marquées
--    « Professionnel »).
--
-- 1. Colonne `legal_form`.
-- 2. Les formes juridiques présentes dans le fichier G8 mais absentes de la table
--    de référence y sont AJOUTÉES (marquées professionnelles), pour que chaque
--    fiche reprise retrouve sa valeur dans la liste. Aucune ligne existante modifiée.
-- 3. Pour chaque fiche dont `civility` contient une forme juridique (tout ce qui
--    n'est pas une civilité de personne), la valeur est COPIÉE dans `legal_form`
--    (seulement si `legal_form` est vide). `civility` n'est pas touchée.
--    La trace est écrite par le déclencheur d'audit existant (trg_contacts_audit).
-- =====================================================================

-- 1. Colonne
alter table public.contacts add column if not exists legal_form text;
comment on column public.contacts.legal_form is
  'Mission 04 : forme juridique d''un professionnel (SRL, SA, ASBL…), valeurs de la table de référence civility (extra.professional = true). Séparée de la civilité de la personne.';

-- 2. Formes juridiques de la reprise G8 ajoutées à la table de référence
--    (société par société, seulement là où la table civility existe déjà).
with forms(code, label, sort_order) as (
  values
    ('SC',         'SC — Société coopérative',              16),
    ('SNC',        'SNC — Société en nom collectif',        17),
    ('SCOMM',      'SComm — Société en commandite',         18),
    ('SCS',        'SCS — Société en commandite simple',    19),
    ('SCOM',       'SCOM — Société en commandite (G8)',     20),
    ('SCRI',       'SCRI — Coopérative à resp. illimitée',  21),
    ('SPRLU',      'SPRLU — SPRL unipersonnelle',           22),
    ('NV',         'NV — Naamloze vennootschap',            23),
    ('CV',         'CV — Coöperatieve vennootschap',        24),
    ('VOF',        'VOF — Vennootschap onder firma',        25),
    ('VZW',        'VZW — Vereniging zonder winstoogmerk',  26),
    ('BVBA',       'BVBA — oude vorm',                      27),
    ('CVOA',       'CVOA — Coöp. vennootschap (oude vorm)', 28),
    ('SC (VOF)',   'SC (VOF) — reprise G8',                 29),
    ('CS',         'CS — reprise G8',                       30),
    ('SARL',       'SARL — France / Luxembourg',            31),
    ('SAS',        'SAS — France',                          32),
    ('SL',         'SL — Espagne',                          33),
    ('LDA',        'LDA — Portugal',                        34),
    ('UNIPESSOAL', 'Unipessoal — Portugal',                 35),
    ('SRLS',       'SRLS — Italie',                         36),
    ('INDEPENDANT','Indépendant (personne physique)',       37)
)
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select co.company_id, 'civility', f.code, f.label, f.sort_order, true, jsonb_build_object('professional', true)
  from forms f
  cross join (select distinct company_id from public.reference_values where table_key = 'civility') co
on conflict (company_id, table_key, code) do nothing;

-- 3. Copie de la forme juridique (civility → legal_form), sans rien effacer.
update public.contacts c
   set legal_form = btrim(c.civility)
 where c.legal_form is null
   and nullif(btrim(c.civility), '') is not null
   and upper(btrim(c.civility)) not in (
     'MR', 'M', 'M.', 'MONSIEUR', 'MME', 'MME.', 'MADAME', 'MLLE', 'MADEMOISELLE', 'MX', 'AUTRE', 'DR', 'ME'
   );
