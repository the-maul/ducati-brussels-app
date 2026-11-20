-- =====================================================================
-- Perf 2 (20/11/2026) -- essai a blanc de 20261120111000_perf2_recherche_clients_trigramme.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise :
--   PRE_SQL=supabase/migrations/20261120111000_perf2_recherche_clients_trigramme.sql python rt.py perf2_recherche_clients_equivalence.sql
-- Verifie que la recherche de clients donne EXACTEMENT les memes fiches qu'avant :
--   1. index trigramme pose ; _contact_haystack_txt(...) = _contact_haystack(c) pour TOUTES les fiches ;
--   2. pour ~50 recherches tirees des vraies donnees (noms, villes, codes, e-mails, telephones,
--      mots trouves seulement sur une fiche liee, plusieurs mots, accents, majuscules, 1-2 lettres,
--      caracteres speciaux, vide), chaque societe, tri « nom » et « recent » :
--      contacts_search (nouvelle) = version d'origine (texte du 05/10, reproduit ici), meme ordre ;
--   3. contacts_search_count = version d'origine ;
--   4. filtre de type + pagination identiques ; membre connecte : meme resultat ; inconnu : rien.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

-- ------------------------------------------------------------ versions d'origine (prod au 20/11)
create function pg_temp.cs_orig(_company uuid, _q text, _type text, _limit integer, _offset integer, _sort text default 'name')
returns setof public.contacts language sql stable
set search_path = public, extensions, pg_temp as $f$
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
        and coalesce(lh.h, '') not like '%' || tok || '%'
    ))
  order by
    case when _sort = 'recent' then c.created_at end desc nulls last,
    case when _sort = 'recent' then null else public.contact_sort_label(c) end asc nulls last,
    c.id
  limit greatest(_limit, 0) offset greatest(_offset, 0);
$f$;

create function pg_temp.csc_orig(_company uuid, _q text, _type text)
returns bigint language sql stable
set search_path = public, extensions, pg_temp as $f$
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
$f$;

-- ------------------------------------------------------------ 1. index et texte identique
insert into _t(check_name, result)
select '1a index trigramme pose', case when count(*) = 1 then 'ok' else 'KO' end
  from pg_indexes where schemaname = 'public' and indexname = 'idx_contacts_haystack_trgm';

insert into _t(check_name, result)
select '1b texte indexe = _contact_haystack pour toutes les fiches (' || count(*) || ')',
  case when count(*) filter (where public._contact_haystack_txt(c.last_name, c.first_name, c.company_name, c.city, c.email,
         c.email_pro, c.vat_number, c.legacy_code, c.code, c.phone, c.mobile) is distinct from public._contact_haystack(c)) = 0
       then 'ok' else 'KO' end
  from public.contacts c;

-- ------------------------------------------------------------ 2-3. recherches
create temp table _q(q text) on commit drop;
insert into _q values (''), (null), ('ma'), ('a'), ('  '), ('dup'), ('jean dupont'), ('MARTIN'), ('éric'), ('%'), ('_a_'),
  ('0475'), ('@gmail'), ('be0'), ('bruxelles'), ('zzzzqqq'), ('de la');
insert into _q select distinct lower(last_name) from (select last_name from public.contacts where length(last_name) >= 3 order by md5(id::text) limit 8) s;
insert into _q select distinct lower(city) from (select city from public.contacts where length(city) >= 3 order by md5(id::text) limit 4) s;
insert into _q select distinct code from (select code from public.contacts where length(code) >= 3 order by md5(id::text) limit 3) s;
insert into _q select distinct split_part(email, '@', 1) from (select email from public.contacts where email like '%@%' order by md5(id::text) limit 3) s;
insert into _q select distinct right(regexp_replace(mobile, '\D', '', 'g'), 4) from (select mobile from public.contacts where mobile is not null order by md5(id::text) limit 2) s;
insert into _q select distinct lower(first_name) || ' ' || lower(last_name) from (select first_name, last_name from public.contacts where length(first_name) >= 3 and length(last_name) >= 2 order by md5(id::text) limit 4) s;
-- mots presents sur une fiche liee
insert into _q select distinct lower(b.last_name) from public.contact_links l join public.contacts b on b.id = l.contact_b where length(b.last_name) >= 3 limit 4;
insert into _q select distinct lower(b.code) from public.contact_links l join public.contacts b on b.id = l.contact_a where length(b.code) >= 3 limit 2;

do $s$ declare co record; qq record; bad int := 0; badc int := 0; n int := 0; typ text; srt text;
begin
  for co in select id from public.companies loop
    for qq in select q from _q loop
      foreach srt in array case when qq.q in ('', 'dup', 'ma', 'jean dupont', 'bruxelles', '0475') then array['name', 'recent'] else array['name'] end loop
        n := n + 1;
        if array(select id from public.contacts_search(co.id, qq.q, null, 100000, 0, srt))
           is distinct from array(select id from pg_temp.cs_orig(co.id, qq.q, null, 100000, 0, srt)) then
          bad := bad + 1;
        end if;
      end loop;
      if public.contacts_search_count(co.id, qq.q, null) is distinct from pg_temp.csc_orig(co.id, qq.q, null) then badc := badc + 1; end if;
    end loop;
  end loop;
  insert into _t(check_name, result) values ('2 contacts_search = origine (' || n || ' cas, meme ordre)', case when bad = 0 and n > 0 then 'ok' else 'KO ' || bad end);
  insert into _t(check_name, result) values ('3 contacts_search_count = origine', case when badc = 0 then 'ok' else 'KO ' || badc end);

  bad := 0; n := 0;
  for co in select id from public.companies loop
    foreach typ in array array['particulier', 'professionnel', 'fournisseur'] loop
      for qq in select q from _q where q in ('', 'dup', 'ma', 'bruxelles') loop
        n := n + 1;
        if array(select id from public.contacts_search(co.id, qq.q, typ, 25, 25, 'name'))
           is distinct from array(select id from pg_temp.cs_orig(co.id, qq.q, typ, 25, 25, 'name'))
        or public.contacts_search_count(co.id, qq.q, typ) is distinct from pg_temp.csc_orig(co.id, qq.q, typ) then bad := bad + 1; end if;
      end loop;
    end loop;
  end loop;
  insert into _t(check_name, result) values ('4a type + pagination = origine (' || n || ' cas)', case when bad = 0 and n > 0 then 'ok' else 'KO ' || bad end);
end $s$;

do $s$ declare _u uuid; _c uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; a uuid[]; b uuid[]; begin
  select ur.user_id into _u from public.user_roles ur where ur.company_id = _c limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  a := array(select id from public.contacts_search(_c, 'dup', null, 50, 0, 'name'));
  b := array(select id from pg_temp.cs_orig(_c, 'dup', null, 50, 0, 'name'));
  insert into _t(check_name, result) values ('4b membre connecte : meme resultat (' || coalesce(array_length(a, 1), 0) || ' fiches)',
    case when a is not distinct from b then 'ok' else 'KO' end);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-00000000abcd', 'role', 'authenticated')::text, true);
  a := array(select id from public.contacts_search(_c, 'dup', null, 50, 0, 'name'));
  insert into _t(check_name, result) values ('4c inconnu connecte : aucune fiche', case when coalesce(array_length(a, 1), 0) = 0 then 'ok' else 'KO' end);
  perform set_config('request.jwt.claims', '', true);
end $s$;
