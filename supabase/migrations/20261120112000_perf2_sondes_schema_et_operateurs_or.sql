-- =====================================================================
-- Perf 2 (20/11/2026) -- Sondes de schema groupees + liste des operateurs d'OR.
--
-- 1. `schema_probe(_checks)` : une fiche OR ouvrait 10 a 12 « sondes » (une requete chacune,
--    `select colonne limit 1`) pour savoir si une migration est posee. L'application les regroupe
--    maintenant en UN appel (src/lib/schema-probe.ts). Reponse : les `table.colonne` presentes
--    dans le schema public ET lisibles par l'utilisateur (has_column_privilege), soit exactement
--    les cas ou `select colonne limit 1` reussit (la RLS filtre des lignes, elle ne fait pas
--    echouer la requete). SECURITY INVOKER : les droits sont ceux de l'appelant. Ne lit que le
--    catalogue, aucune donnee.
-- 2. `or_operators(_company)` : le filtre « operateur » de la liste des OR lisait les 1 000
--    derniers OR (colonne operator) pour en tirer quelques noms. Meme resultat, calcule en base :
--    les memes 1 000 derniers OR (tri created_at desc), operateurs distincts. SECURITY INVOKER :
--    la RLS de repair_orders s'applique comme pour la lecture d'origine.
-- Essai : supabase/tests/perf2_sondes_et_operateurs.sql.
-- =====================================================================

create or replace function public.schema_probe(_checks text[])
returns text[]
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(c order by c), '{}'::text[])
    from (
      select distinct c
        from unnest(coalesce(_checks, '{}'::text[])) c
       where c ~ '^[a-z0-9_]+\.[a-z0-9_]+$'
         -- CASE : has_column_privilege leve une erreur sur une colonne absente, on ne l'appelle
         -- qu'une fois la colonne trouvee dans le catalogue.
         and case when exists (
                select 1 from pg_attribute a
                 where a.attrelid = to_regclass('public.' || split_part(c, '.', 1))
                   and a.attname = split_part(c, '.', 2)
                   and a.attnum > 0 and not a.attisdropped)
              then has_column_privilege(to_regclass('public.' || split_part(c, '.', 1)), split_part(c, '.', 2), 'SELECT')
              else false end
    ) s;
$$;

revoke all on function public.schema_probe(text[]) from public, anon;
grant execute on function public.schema_probe(text[]) to authenticated, service_role;

comment on function public.schema_probe(text[]) is
  'Sondes de schema groupees : renvoie les table.colonne (schema public) presentes et lisibles par l''appelant (perf 2, 20/11/2026).';

create or replace function public.or_operators(_company uuid)
returns text[]
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct btrim(r.operator)) filter (where btrim(r.operator) <> ''), '{}'::text[])
    from (select ro.operator
            from public.repair_orders ro
           where ro.company_id = _company and ro.operator is not null
           order by ro.created_at desc
           limit 1000) r;
$$;

revoke all on function public.or_operators(uuid) from public, anon;
grant execute on function public.or_operators(uuid) to authenticated, service_role;

comment on function public.or_operators(uuid) is
  'Operateurs distincts des 1 000 derniers OR de la societe (filtre de la liste des OR), RLS de l''appelant (perf 2, 20/11/2026).';
