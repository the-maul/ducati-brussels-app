-- M1 — La liste des contacts doit être triée sur le nom AFFICHÉ.
-- Avant : ORDER BY last_name puis company_name. Une société dont la fiche
-- porte aussi un nom de personne (le contact sur place) se classait sur ce nom
-- de personne alors que la liste affiche la raison sociale → ordre
-- incompréhensible pour l'utilisateur.
-- Après : on trie sur le libellé affiché (même règle que contactDisplayName),
-- sans accents, sans casse et sans ponctuation de tête.

-- Libellé de tri = libellé affiché dans la liste (cf. contactDisplayName).
create or replace function public.contact_sort_label(c public.contacts)
returns text
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select nullif(
    regexp_replace(
      lower(unaccent(coalesce(
        case when c.type::text = 'particulier'
             then nullif(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '')
        end,
        nullif(btrim(coalesce(c.company_name,'')), ''),
        nullif(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''),
        ''
      ))),
      '^[^a-z0-9]+', ''
    ), ''
  );
$$;

create or replace function public.contacts_search(
  _company uuid,
  _q text,
  _type text,
  _limit integer,
  _offset integer,
  _sort text default 'name'
)
returns setof public.contacts
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
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
    case when _sort = 'recent' then null else public.contact_sort_label(c) end asc nulls last,
    c.id
  limit greatest(_limit, 0) offset greatest(_offset, 0);
$$;
