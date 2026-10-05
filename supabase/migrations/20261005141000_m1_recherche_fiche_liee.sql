-- =====================================================================
-- M1 — La recherche de contacts trouve aussi une fiche par le nom de sa FICHE LIÉE,
-- et l'écran peut afficher la fiche liée sous la ligne du contact.
-- Retour de Simon du 05/10 : « dans la fiche contact, si je cherche un contact,
-- il faut voir la fiche liée en dessous en plus clair ». Chercher « AGM FISC » doit
-- remonter la personne liée, et chercher la personne doit remonter « AGM FISC ».
--
-- Performance (8 141 contacts, 5 liens aujourd'hui) : le « haystack » des fiches liées
-- est calculé UNE fois sur `contact_links` (CTE `link_hay`, coût en O(liens)) puis joint
-- par hachage sur les contacts — pas une sous-requête corrélée par contact. Le coût ne
-- grandit donc qu'avec le nombre de liaisons, jamais avec les 8 141 fiches.
--
-- Non destructif : `create or replace` sur les deux fonctions de recherche
-- (signatures inchangées), plus une fonction de lecture nouvelle.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Nom d'affichage normalisé d'un contact (accents et casse retirés).
--    Utilisé pour le haystack des fiches liées.
-- ---------------------------------------------------------------------
create or replace function public._contact_link_haystack_part(c public.contacts)
returns text
language sql
stable
set search_path = public, extensions, pg_temp
as $fn$
  select lower(unaccent(concat_ws(' ', c.last_name, c.first_name, c.company_name, c.code, c.legacy_code)));
$fn$;
revoke execute on function public._contact_link_haystack_part(public.contacts) from public, anon;
grant execute on function public._contact_link_haystack_part(public.contacts) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Recherche paginée — même filtre qu'avant, plus les noms des fiches liées.
-- ---------------------------------------------------------------------
create or replace function public.contacts_search(
  _company uuid,
  _q       text,
  _type    text,
  _limit   int,
  _offset  int,
  _sort    text default 'name'
)
returns setof public.contacts
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $fn$
  with link_hay as (
    select x.cid, string_agg(x.h, ' ') as h
    from (
      select l.contact_a as cid, public._contact_link_haystack_part(b) as h
        from public.contact_links l join public.contacts b on b.id = l.contact_b
       where l.company_id = _company
      union all
      select l.contact_b, public._contact_link_haystack_part(a)
        from public.contact_links l join public.contacts a on a.id = l.contact_a
       where l.company_id = _company
    ) x
    group by x.cid
  )
  select c.* from public.contacts c
  left join link_hay lh on lh.cid = c.id
  where c.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and (_type is null or _type = '' or c.type::text = _type)
    and (coalesce(_q,'') = '' or not exists (
      select 1 from unnest(string_to_array(regexp_replace(lower(unaccent(_q)), '\s+', ' ', 'g'), ' ')) tok
      where tok <> ''
        and public._contact_haystack(c) not like '%' || tok || '%'
        -- Un mot peut aussi être trouvé sur la FICHE LIÉE (nom, prénom, société, code).
        and coalesce(lh.h, '') not like '%' || tok || '%'
    ))
  order by
    case when _sort = 'recent' then c.created_at end desc nulls last,
    case when _sort = 'recent' then null else c.last_name end asc nulls last,
    case when _sort = 'recent' then null else c.company_name end asc nulls last
  limit greatest(_limit, 0) offset greatest(_offset, 0);
$fn$;
grant execute on function public.contacts_search(uuid, text, text, int, int, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Comptage — même filtre, sinon la pagination mentirait sur le total.
-- ---------------------------------------------------------------------
create or replace function public.contacts_search_count(_company uuid, _q text, _type text)
returns bigint
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $fn$
  with link_hay as (
    select x.cid, string_agg(x.h, ' ') as h
    from (
      select l.contact_a as cid, public._contact_link_haystack_part(b) as h
        from public.contact_links l join public.contacts b on b.id = l.contact_b
       where l.company_id = _company
      union all
      select l.contact_b, public._contact_link_haystack_part(a)
        from public.contact_links l join public.contacts a on a.id = l.contact_a
       where l.company_id = _company
    ) x
    group by x.cid
  )
  select count(*) from public.contacts c
  left join link_hay lh on lh.cid = c.id
  where c.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and (_type is null or _type = '' or c.type::text = _type)
    and (coalesce(_q,'') = '' or not exists (
      select 1 from unnest(string_to_array(regexp_replace(lower(unaccent(_q)), '\s+', ' ', 'g'), ' ')) tok
      where tok <> ''
        and public._contact_haystack(c) not like '%' || tok || '%'
        and coalesce(lh.h, '') not like '%' || tok || '%'
    ));
$fn$;
grant execute on function public.contacts_search_count(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Fiches liées d'un lot de contacts (la page affichée, 25 à 200 lignes).
--    Une seule requête pour toute la page : pas un appel par ligne.
--    `is_name_source` = cette fiche liée est la source du prénom/nom (migration
--    20261005140000) : l'écran peut l'annoncer sans refaire le calcul.
-- ---------------------------------------------------------------------
create or replace function public.contacts_linked_brief(_ids uuid[])
returns table (
  contact_id     uuid,
  linked_id      uuid,
  linked_name    text,
  linked_type    text,
  is_name_source boolean
)
language sql
stable
set search_path = public, pg_temp
as $fn$
  select p.cid,
         o.id,
         coalesce(nullif(btrim(o.company_name), ''),
                  nullif(btrim(concat_ws(' ', o.first_name, o.last_name)), ''),
                  '—'),
         o.type::text,
         -- coalesce : NULL = o.id vaudrait NULL, l'ecran veut un booleen franc.
         coalesce(public.contact_name_source_id(p.cid) = o.id, false)
  from (
    select l.contact_a as cid, l.contact_b as oid from public.contact_links l
     where l.contact_a = any(_ids)
    union all
    select l.contact_b, l.contact_a from public.contact_links l
     where l.contact_b = any(_ids)
  ) p
  join public.contacts o on o.id = p.oid
  order by 1, 3;
$fn$;
revoke execute on function public.contacts_linked_brief(uuid[]) from public, anon;
grant execute on function public.contacts_linked_brief(uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
