-- =====================================================================
-- M1 — Tri de la liste des contacts par date d'arrivée.
-- Réf. docs/plan-nouveau-client.md (retour client du 14/09).
--
-- `contacts_search` triait uniquement par nom. Avec la création automatique de
-- prospects depuis les mails, il faut pouvoir voir les DERNIERS ARRIVÉS en tête :
-- sinon une nouvelle fiche apparaît au milieu de 8 000 autres, à sa place
-- alphabétique, et personne ne la voit.
--
-- Paramètre `_sort` : 'name' (défaut, comportement inchangé) ou 'recent'.
-- L'ancienne signature à 5 arguments est supprimée : `create or replace` avec un
-- argument de plus créerait une SECONDE fonction, et PostgREST ne saurait plus
-- laquelle appeler. Les appels existants passent par des arguments nommés et
-- continuent de fonctionner grâce à la valeur par défaut.
-- =====================================================================

drop function if exists public.contacts_search(uuid, text, text, int, int);

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
  select c.* from public.contacts c
  where c.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and (_type is null or _type = '' or c.type::text = _type)
    and (coalesce(_q,'') = '' or not exists (
      select 1 from unnest(string_to_array(regexp_replace(lower(unaccent(_q)), '\s+', ' ', 'g'), ' ')) tok
      where tok <> '' and public._contact_haystack(c) not like '%' || tok || '%'
    ))
  order by
    -- Chaque clé n'est active que pour son mode : l'autre vaut NULL et ne
    -- départage rien. Types distincts, donc des clés de tri distinctes.
    case when _sort = 'recent' then c.created_at end desc nulls last,
    case when _sort = 'recent' then null else c.last_name end asc nulls last,
    case when _sort = 'recent' then null else c.company_name end asc nulls last
  limit greatest(_limit, 0) offset greatest(_offset, 0);
$fn$;
grant execute on function public.contacts_search(uuid, text, text, int, int, text) to authenticated, service_role;

create index if not exists idx_contacts_company_created
  on public.contacts(company_id, created_at desc);
