-- =====================================================================
-- M1 — Recherche contacts robuste : insensible aux ACCENTS et à la CASSE, par MOTS
-- (chaque mot tapé doit apparaître quelque part dans nom/prénom/société/ville/email/
-- TVA/code/tél, dans n'importe quel ordre). Remplace l'ilike par phrase exacte.
-- =====================================================================
create extension if not exists unaccent;

-- Haystack normalisé d'un contact (concat des champs cherchables, sans accent, minuscule).
create or replace function public._contact_haystack(c public.contacts)
returns text language sql stable set search_path = public, extensions, pg_temp as $$
  select lower(unaccent(concat_ws(' ',
    c.last_name, c.first_name, c.company_name, c.city, c.email, c.email_pro,
    c.vat_number, c.legacy_code, c.phone, c.mobile)));
$$;

-- Recherche paginée (setof contacts).
create or replace function public.contacts_search(_company uuid, _q text, _type text, _limit int, _offset int)
returns setof public.contacts language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select c.* from public.contacts c
  where c.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and (_type is null or _type = '' or c.type::text = _type)
    and (coalesce(_q,'') = '' or not exists (
      select 1 from unnest(string_to_array(regexp_replace(lower(unaccent(_q)), '\s+', ' ', 'g'), ' ')) tok
      where tok <> '' and public._contact_haystack(c) not like '%' || tok || '%'
    ))
  order by c.last_name asc nulls last, c.company_name asc nulls last
  limit greatest(_limit, 0) offset greatest(_offset, 0);
$$;
grant execute on function public.contacts_search(uuid, text, text, int, int) to authenticated, service_role;

-- Compte total (même filtre) pour la pagination.
create or replace function public.contacts_search_count(_company uuid, _q text, _type text)
returns bigint language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select count(*) from public.contacts c
  where c.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and (_type is null or _type = '' or c.type::text = _type)
    and (coalesce(_q,'') = '' or not exists (
      select 1 from unnest(string_to_array(regexp_replace(lower(unaccent(_q)), '\s+', ' ', 'g'), ' ')) tok
      where tok <> '' and public._contact_haystack(c) not like '%' || tok || '%'
    ));
$$;
grant execute on function public.contacts_search_count(uuid, text, text) to authenticated, service_role;
