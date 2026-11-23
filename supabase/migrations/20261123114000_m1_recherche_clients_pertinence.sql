-- =====================================================================
-- M1 — Retour de Simon et Domenico (23/11/2026) : LA RECHERCHE DE CLIENTS MET LE BON CLIENT EN PREMIER.
-- CON001 (recherche accent-insensible, par mots).
--
-- Avant : les fiches trouvees etaient triees par ordre alphabetique puis coupees a 6 ou 8 lignes.
-- « des » faisait passer MODESTO ou une adresse e-mail avant DESOUTER.
--
-- Cette fonction NE CHANGE PAS ce qui est trouve : elle reprend exactement les fiches de
-- contacts_search (memes droits, memes mots, fiches liees comprises) et les classe :
--   0. nom complet ou societe exacts
--   1. tous les mots sont entiers dans le nom, le prenom ou le premier mot de la societe
--   2. ils commencent ces mots, et le nom de famille commence par le premier mot cherche
--   3. ils commencent ces mots
--   4. ils commencent un autre mot de la societe (« LA MAISON DES TRAITEURS » pour « des »)
--   5. ils sont ailleurs dans le nom
--   6. trouve ailleurs (ville, e-mail, telephone, code, fiche liee)
-- A rang egal : ordre alphabetique habituel.
--
-- Additive : aucune fonction existante n'est modifiee. Rejouable.
-- Essai a blanc : supabase/tests/m1_recherche_clients_pertinence.sql.
-- =====================================================================

create or replace function public.contacts_search_best(
  _company uuid, _q text, _type text default '', _limit integer default 8, _offset integer default 0
)
returns setof public.contacts
language sql stable security invoker
set search_path = public, extensions, pg_temp
as $$
  with q as (
    select array_remove(string_to_array(regexp_replace(lower(unaccent(btrim(coalesce(_q, '')))), '\s+', ' ', 'g'), ' '), '') as toks,
           regexp_replace(lower(unaccent(btrim(coalesce(_q, '')))), '\s+', ' ', 'g') as full_q
  ),
  found as (
    select c as row_data, c.id,
           public.contact_sort_label(c) as label,
           btrim(lower(unaccent(coalesce(c.last_name, '')))) as last_n,
           btrim(lower(unaccent(coalesce(c.first_name, '')))) as first_n,
           btrim(lower(unaccent(concat_ws(' ', c.last_name, c.first_name)))) as name_lf,
           btrim(lower(unaccent(concat_ws(' ', c.first_name, c.last_name)))) as name_fl,
           btrim(lower(unaccent(coalesce(c.company_name, '')))) as company,
           lower(unaccent(concat_ws(' ', c.last_name, c.first_name, c.company_name))) as name_all
      from public.contacts_search(_company, _q, _type, 20000, 0, 'name') c
  ),
  scored as (
    select f.*,
           case
             when q.full_q <> '' and (f.name_lf = q.full_q or f.name_fl = q.full_q or f.company = q.full_q) then 0
             -- Un mot court (de, des, la, van) ne compte qu'en tete : « JARDINS DES 4 SAISONS » ne passe pas devant DESOUTER.
             when not exists (select 1 from unnest(q.toks) t
                               where not (t = any (case when length(t) >= 4 then w.head else w.firsts end))) then 1
             when not exists (select 1 from unnest(q.toks) t
                               where not exists (select 1 from unnest(case when length(t) >= 4 then w.head else w.firsts end) x
                                                  where starts_with(x, t))) then
               case when cardinality(q.toks) > 0 and starts_with(f.last_n, q.toks[1]) then 2 else 3 end
             when not exists (select 1 from unnest(q.toks) t
                               where not exists (select 1 from unnest(w.words) x where starts_with(x, t))) then 4
             when not exists (select 1 from unnest(q.toks) t where position(t in f.name_all) = 0) then 5
             else 6
           end as rank_no
      from found f
      cross join q
      cross join lateral (
        select regexp_split_to_array(f.name_all, '[^a-z0-9]+') as words,
               regexp_split_to_array(btrim(concat_ws(' ', f.name_lf, split_part(f.company, ' ', 1))), '[^a-z0-9]+') as head,
               array[split_part(f.last_n, ' ', 1), split_part(f.first_n, ' ', 1), split_part(f.company, ' ', 1)] as firsts
      ) w
  )
  select (s.row_data).*
    from scored s
   order by s.rank_no, s.label asc nulls last, s.id
   limit greatest(_limit, 0) offset greatest(_offset, 0);
$$;

revoke all on function public.contacts_search_best(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.contacts_search_best(uuid, text, text, integer, integer) to authenticated;
