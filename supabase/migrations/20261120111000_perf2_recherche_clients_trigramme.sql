-- =====================================================================
-- Perf 2 (20/11/2026) -- Recherche de clients : index trigramme (pg_trgm).
--
-- Mesure avant (prod, admin ITALBIKE, EXPLAIN ANALYZE) : contacts_search « martin » 148 ms,
-- « dup » 148 ms, « jean dupont » 148 ms ; contacts_search_count « martin » 144 ms. Cause : le
-- texte de recherche (`_contact_haystack`, unaccent sur 11 colonnes) est recalcule pour chacune
-- des ~8 200 fiches de la societe a chaque frappe (13 us par fiche).
--
-- Apres : un index GIN trigramme sur ce meme texte. La recherche garde EXACTEMENT sa regle
-- (chaque mot doit se trouver sur la fiche ou sur une fiche liee) ; on ajoute seulement un
-- pre-filtre logiquement redondant : le mot le plus long (3 lettres et plus) doit se trouver
-- sur la fiche OU sur une fiche liee -- condition deja exigee par la regle. Le resultat est
-- donc identique (essai supabase/tests/perf2_recherche_clients_equivalence.sql), mais
-- l'index trouve les candidats sans relire toutes les fiches. Mots de 1-2 lettres : pas de
-- pre-filtre (le trigramme ne sait pas les chercher), comportement et duree inchanges.
--
-- `_contact_haystack_txt` = meme texte que `_contact_haystack(c)` (memes colonnes, meme ordre,
-- meme dictionnaire unaccent, nomme explicitement pour pouvoir etre IMMUTABLE et indexe).
-- Aucune donnee modifiee, aucun droit modifie (memes GRANT, SECURITY DEFINER et garde
-- is_member inchanges). A appliquer a un moment calme : l'index se construit en quelques
-- secondes (14 500 fiches) et bloque les ecritures sur contacts le temps de la construction.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

create or replace function public._contact_haystack_txt(
  _last_name text, _first_name text, _company_name text, _city text, _email text, _email_pro text,
  _vat_number text, _legacy_code text, _code text, _phone text, _mobile text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(public.unaccent('public.unaccent'::regdictionary, concat_ws(' ',
    _last_name, _first_name, _company_name, _city, _email, _email_pro,
    _vat_number, _legacy_code, _code, _phone, _mobile)));
$$;

revoke all on function public._contact_haystack_txt(text, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public._contact_haystack_txt(text, text, text, text, text, text, text, text, text, text, text) to authenticated, service_role;

create index if not exists idx_contacts_haystack_trgm on public.contacts using gin (
  public._contact_haystack_txt(last_name, first_name, company_name, city, email, email_pro,
                               vat_number, legacy_code, code, phone, mobile) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- contacts_search / contacts_search_count : meme signature, meme regle. Sans mot de 3 lettres,
-- c'est la requete d'origine mot pour mot ; avec, la meme requete + le pre-filtre indexe.
-- (plpgsql : deux requetes distinctes, pour que l'index soit choisi dans la seconde.)
-- ---------------------------------------------------------------------
create or replace function public.contacts_search(_company uuid, _q text, _type text, _limit integer, _offset integer, _sort text default 'name'::text)
returns setof public.contacts
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $function$
declare _t text;
begin
  -- Mot le plus long (3 lettres et plus) de la recherche ; aucun : requete d'origine telle quelle.
  select tok into _t
    from unnest(string_to_array(regexp_replace(lower(unaccent(_q)), '\s+', ' ', 'g'), ' ')) tok
   where length(tok) >= 3
   order by length(tok) desc, tok
   limit 1;
  if _t is null then
    return query
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
          -- Un mot peut aussi etre trouve sur la FICHE LIEE (nom, prenom, societe, code).
          and coalesce(lh.h, '') not like '%' || tok || '%'
      ))
    order by
      case when _sort = 'recent' then c.created_at end desc nulls last,
      case when _sort = 'recent' then null else public.contact_sort_label(c) end asc nulls last,
      c.id
    limit greatest(_limit, 0) offset greatest(_offset, 0);
  else
    return query
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
          -- Un mot peut aussi etre trouve sur la FICHE LIEE (nom, prenom, societe, code).
          and coalesce(lh.h, '') not like '%' || tok || '%'
      ))
      -- Pre-filtre (redondant avec la regle ci-dessus, donc meme resultat) : le mot _t est sur
      -- la fiche (index trigramme) ou sur une fiche liee.
      and c.id in (
        select x.id from public.contacts x
         where x.company_id = _company
           and public._contact_haystack_txt(x.last_name, x.first_name, x.company_name, x.city, x.email, x.email_pro,
                                            x.vat_number, x.legacy_code, x.code, x.phone, x.mobile) like '%' || _t || '%'
        union
        select h.cid from link_hay h where h.h like '%' || _t || '%'
      )
    order by
      case when _sort = 'recent' then c.created_at end desc nulls last,
      case when _sort = 'recent' then null else public.contact_sort_label(c) end asc nulls last,
      c.id
    limit greatest(_limit, 0) offset greatest(_offset, 0);
  end if;
end
$function$;

create or replace function public.contacts_search_count(_company uuid, _q text, _type text)
returns bigint
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $function$
declare _t text; _n bigint;
begin
  -- Mot le plus long (3 lettres et plus) de la recherche ; aucun : requete d'origine telle quelle.
  select tok into _t
    from unnest(string_to_array(regexp_replace(lower(unaccent(_q)), '\s+', ' ', 'g'), ' ')) tok
   where length(tok) >= 3
   order by length(tok) desc, tok
   limit 1;
  if _t is null then
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
    select count(*) into _n from public.contacts c
    left join link_hay lh on lh.cid = c.id
    where c.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and (_type is null or _type = '' or c.type::text = _type)
      and (coalesce(_q,'') = '' or not exists (
        select 1 from unnest(string_to_array(regexp_replace(lower(unaccent(_q)), '\s+', ' ', 'g'), ' ')) tok
        where tok <> ''
          and public._contact_haystack(c) not like '%' || tok || '%'
          -- Un mot peut aussi etre trouve sur la FICHE LIEE (nom, prenom, societe, code).
          and coalesce(lh.h, '') not like '%' || tok || '%'
      ));
  else
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
    select count(*) into _n from public.contacts c
    left join link_hay lh on lh.cid = c.id
    where c.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and (_type is null or _type = '' or c.type::text = _type)
      and (coalesce(_q,'') = '' or not exists (
        select 1 from unnest(string_to_array(regexp_replace(lower(unaccent(_q)), '\s+', ' ', 'g'), ' ')) tok
        where tok <> ''
          and public._contact_haystack(c) not like '%' || tok || '%'
          -- Un mot peut aussi etre trouve sur la FICHE LIEE (nom, prenom, societe, code).
          and coalesce(lh.h, '') not like '%' || tok || '%'
      ))
      -- Pre-filtre (redondant avec la regle ci-dessus, donc meme resultat) : le mot _t est sur
      -- la fiche (index trigramme) ou sur une fiche liee.
      and c.id in (
        select x.id from public.contacts x
         where x.company_id = _company
           and public._contact_haystack_txt(x.last_name, x.first_name, x.company_name, x.city, x.email, x.email_pro,
                                            x.vat_number, x.legacy_code, x.code, x.phone, x.mobile) like '%' || _t || '%'
        union
        select h.cid from link_hay h where h.h like '%' || _t || '%'
      );
  end if;
  return _n;
end
$function$;

-- Statistiques de l'expression indexee : sans elles, le planificateur ignore l'index.
analyze public.contacts;
