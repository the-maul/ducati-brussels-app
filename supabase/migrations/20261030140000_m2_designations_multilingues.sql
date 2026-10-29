-- M2 — Designations d'articles en quatre langues (FR, NL, EN, IT) — I18N002.
--
-- Decision client du 30/10/2026 (carte CRM « Traduire l'application et les
-- donnees en FR, NL, EN, IT ») : « quand une donnee rentre elle doit etre
-- traduite ». L'original fournisseur est garde tel quel, l'equipe voit sa langue
-- (FR pour Italbike), le client recevra plus tard ses documents dans la sienne.
--
-- Sur l'article :
--   designation            : reste la colonne affichee par l'application = la version FR ;
--   designation_source     : le libelle d'origine, tel que recu (tarif, catalogue, site, saisie) ;
--   designation_source_lang: langue de l'original (fr / nl / en / it / ? quand indeterminee) ;
--   designation_i18n       : les quatre versions {"fr":..,"nl":..,"en":..,"it":..} ;
--   designation_translated_at : date de la derniere traduction ; NULL = a (re)traduire.
--
-- La memoire de traduction (translation_memory) est independante de la societe :
-- un libelle deja traduit ne repart jamais vers Claude. Lecture pour tout
-- utilisateur connecte, ecriture reservee au role de service (Edge Function
-- translate-designations, script tools/migration/traduire_designations.py).
--
-- Rien n'est ecrit par cette migration : les 93 782 articles existants gardent
-- leur designation actuelle et designation_translated_at a NULL ; le script de
-- reprise les traite par lots de 50.

-- 1. Colonnes sur l'article.
alter table public.articles add column if not exists designation_source text;
alter table public.articles add column if not exists designation_source_lang text;
alter table public.articles add column if not exists designation_i18n jsonb not null default '{}'::jsonb;
alter table public.articles add column if not exists designation_translated_at timestamptz;

comment on column public.articles.designation is
  'Libelle affiche par l''application : la version francaise (designation_i18n ->> ''fr'').';
comment on column public.articles.designation_source is
  'Libelle d''origine tel que recu du fournisseur, du catalogue, du site ou de la saisie. Jamais reecrit par une traduction.';
comment on column public.articles.designation_source_lang is
  'Langue du libelle d''origine : fr, nl, en, it, ou ? quand elle n''a pas pu etre determinee.';
comment on column public.articles.designation_i18n is
  'Les quatre versions du libelle : {"fr": ..., "nl": ..., "en": ..., "it": ...}. Vide tant que l''article n''est pas traduit.';
comment on column public.articles.designation_translated_at is
  'Date de la derniere traduction. NULL = a traduire (relance possible par le script ou depuis la fiche).';

alter table public.articles drop constraint if exists articles_designation_source_lang_ck;
alter table public.articles add constraint articles_designation_source_lang_ck
  check (designation_source_lang is null or designation_source_lang in ('fr', 'nl', 'en', 'it', '?'));

-- Les articles restant a traduire se trouvent en une lecture (script de reprise, relance).
create index if not exists idx_articles_designation_a_traduire
  on public.articles (company_id, created_at desc)
  where designation_translated_at is null;

-- 2. Memoire de traduction, commune a toutes les societes.
create table if not exists public.translation_memory (
  id           uuid primary key default gen_random_uuid(),
  -- Le texte d'origine, tel que recu (espaces reduits), et sa langue.
  source_text  text not null,
  source_lang  text not null,
  -- La langue cible et la traduction.
  target_lang  text not null,
  target_text  text not null,
  -- Qui a produit la traduction : glossaire (mecanique), claude (IA), manuel (correction humaine).
  engine       text not null default 'claude',
  created_at   timestamptz not null default now(),
  constraint translation_memory_unique unique (source_text, source_lang, target_lang),
  constraint translation_memory_source_lang_ck check (source_lang in ('fr', 'nl', 'en', 'it')),
  constraint translation_memory_target_lang_ck check (target_lang in ('fr', 'nl', 'en', 'it')),
  constraint translation_memory_engine_ck check (engine in ('glossaire', 'claude', 'manuel')),
  constraint translation_memory_text_ck check (length(source_text) between 1 and 500 and length(target_text) between 1 and 500)
);

comment on table public.translation_memory is
  'Memoire de traduction des libelles (pieces, accessoires, vetements). Independante de la societe. Un texte deja present ne repart pas vers Claude.';
comment on column public.translation_memory.engine is
  'glossaire = dictionnaire mecanique, claude = API Claude (Edge Function translate-designations), manuel = correction humaine.';

create index if not exists idx_translation_memory_source on public.translation_memory (source_text);

alter table public.translation_memory enable row level security;

-- Lecture : tout utilisateur connecte (le contenu n'est pas confidentiel : des noms de pieces).
drop policy if exists "translation_memory_lecture" on public.translation_memory;
create policy "translation_memory_lecture" on public.translation_memory
  for select to authenticated using (true);

-- Ecriture : aucune policy pour les utilisateurs -> seul le role de service (qui
-- contourne la RLS) ecrit : Edge Function et script de reprise.
revoke insert, update, delete on public.translation_memory from anon, authenticated;
grant select on public.translation_memory to authenticated;
grant all on public.translation_memory to service_role;
