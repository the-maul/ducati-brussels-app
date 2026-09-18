-- =====================================================================
-- MISSION 04 — CARTE 1 : « Créer une fiche client rapide au comptoir ».
-- Migration STRICTEMENT ADDITIVE (deux fonctions nouvelles, aucune donnée modifiée).
--
-- Avant de créer une fiche, le comptoir cherche si l'e-mail OU le mobile saisi
-- existe déjà dans la société (règle D3 : on propose d'ouvrir la fiche existante,
-- jamais de fusion automatique).
--
--  - contact_phone_key(text) : clé de comparaison d'un numéro, quel que soit son
--    format (« 0475/87.04.44 », « +32 475 870444 », « 0032475870444 » → 32475870444).
--  - contacts_find_by_email_or_mobile(_company, _email, _mobile, _exclude) :
--    fiches de la société dont l'e-mail (sans casse ni espaces) est le même, ou dont
--    le mobile, le mobile 2 ou le téléphone a la même clé. SECURITY INVOKER : la RLS
--    de `contacts` s'applique (membres de la société seulement).
-- =====================================================================

create or replace function public.contact_phone_key(_p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case
    when length(d) < 8 then null
    when s like '+%' then regexp_replace(d, '^320', '32')
    when d like '00%' then regexp_replace(substr(d, 3), '^320', '32')
    when d like '0%' then '32' || substr(d, 2)
    else d
  end
  from (select btrim(coalesce(_p, '')) as s, regexp_replace(coalesce(_p, ''), '\D', '', 'g') as d) x;
$fn$;
comment on function public.contact_phone_key(text) is
  'Mission 04 : clé de comparaison d''un numéro de téléphone (chiffres, indicatif 32 pour un numéro belge en 0).';
revoke all on function public.contact_phone_key(text) from public, anon;
grant execute on function public.contact_phone_key(text) to authenticated, service_role;

create or replace function public.contacts_find_by_email_or_mobile(
  _company uuid, _email text, _mobile text, _exclude uuid default null
)
returns setof public.contacts
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  with probe as (
    select nullif(lower(btrim(coalesce(_email, ''))), '') as e,
           public.contact_phone_key(_mobile) as k
  )
  select c.*
    from public.contacts c, probe p
   where c.company_id = _company
     and (_exclude is null or c.id <> _exclude)
     and (
          (p.e is not null and lower(btrim(c.email)) = p.e)
       or (p.k is not null and p.k in (
             public.contact_phone_key(c.mobile),
             public.contact_phone_key(c.gsm),
             public.contact_phone_key(c.phone)))
     )
   order by c.is_active desc, c.updated_at desc nulls last
   limit 10;
$fn$;
comment on function public.contacts_find_by_email_or_mobile(uuid, text, text, uuid) is
  'Mission 04 carte 1 : fiches existantes ayant le même e-mail ou le même numéro (alerte doublon avant création, règle D3).';
revoke all on function public.contacts_find_by_email_or_mobile(uuid, text, text, uuid) from public, anon;
grant execute on function public.contacts_find_by_email_or_mobile(uuid, text, text, uuid) to authenticated;
