-- =====================================================================
-- MISSION 04 — CARTE 3 : « Un seul numéro mobile, utilisé pour les SMS ».
-- Migration STRICTEMENT ADDITIVE (trois fonctions, aucune donnée modifiée ici).
--
-- Dans la reprise G8, beaucoup de fiches ont leur GSM dans « téléphone » et un
-- « mobile » vide (G8 obligeait à recopier téléphone → portable pour les SMS).
-- On ne corrige PAS en masse : l'écran Clients → « Mobiles à compléter » liste
-- ces fiches et l'employé clique « Utiliser comme mobile » fiche par fiche.
--
--  - contact_be_gsm(text) : GSM belge (04xx / +324xx / 00324xx, formatage libre)
--    au format +324xxxxxxxx, sinon NULL. Même règle que belgianGsmFromPhone
--    (src/lib/contact-normalize.ts).
--  - contacts_phone_gsm_candidates(_company, _limit, _offset) : fiches actives de
--    la société sans mobile dont le téléphone est un GSM belge (+ total).
--  - contact_use_phone_as_mobile(_id) : recopie ce GSM dans `mobile` (le téléphone
--    reste en place) et écrit une ligne `events` action 'phone_to_mobile'. Refuse
--    si la fiche a déjà un mobile ou si le téléphone n'est pas un GSM belge.
-- =====================================================================

create or replace function public.contact_be_gsm(_p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case when n ~ '^4[0-9]{8}$' then '+32' || n end
  from (
    select regexp_replace(
             case
               when s like '+%' and d like '32%' then substr(d, 3)
               when d like '0032%' then substr(d, 5)
               when d like '0%' then substr(d, 2)
               else null
             end, '^0', '') as n
    from (select btrim(coalesce(_p, '')) as s, regexp_replace(coalesce(_p, ''), '\D', '', 'g') as d) x
  ) y;
$fn$;
comment on function public.contact_be_gsm(text) is
  'Mission 04 carte 3 : GSM belge trouvé dans un numéro (format libre) → +324xxxxxxxx, sinon NULL.';
revoke all on function public.contact_be_gsm(text) from public, anon;
grant execute on function public.contact_be_gsm(text) to authenticated, service_role;

create or replace function public.contacts_phone_gsm_candidates(
  _company uuid, _limit int default 50, _offset int default 0
)
returns table (
  id uuid, code text, type public.contact_type, first_name text, last_name text,
  company_name text, city text, phone text, proposed_mobile text, total bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.is_member(_company) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with cand as (
    select c.id, c.code, c.type, c.first_name, c.last_name, c.company_name, c.city, c.phone,
           public.contact_be_gsm(c.phone) as proposed
      from public.contacts c
     where c.company_id = _company
       and c.is_active
       and nullif(btrim(coalesce(c.mobile, '')), '') is null
       and c.phone is not null
  )
  select cand.id, cand.code, cand.type, cand.first_name, cand.last_name, cand.company_name, cand.city,
         cand.phone, cand.proposed, count(*) over ()
    from cand
   where cand.proposed is not null
   order by cand.last_name nulls last, cand.first_name nulls last, cand.company_name nulls last, cand.id
   limit greatest(1, least(coalesce(_limit, 50), 200)) offset greatest(0, coalesce(_offset, 0));
end $fn$;
comment on function public.contacts_phone_gsm_candidates(uuid, int, int) is
  'Mission 04 carte 3 : fiches sans mobile dont le téléphone est un GSM belge (liste proposée, pas de correction en masse).';
revoke all on function public.contacts_phone_gsm_candidates(uuid, int, int) from public, anon;
grant execute on function public.contacts_phone_gsm_candidates(uuid, int, int) to authenticated;

create or replace function public.contact_use_phone_as_mobile(_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  _c record;
  _gsm text;
begin
  select id, company_id, phone, mobile into _c from public.contacts where id = _id for update;
  if _c.id is null then raise exception 'PHONE_TO_MOBILE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_member(_c.company_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(_c.mobile, '')), '') is not null then
    raise exception 'PHONE_TO_MOBILE_ALREADY_SET' using errcode = '23514';
  end if;
  _gsm := public.contact_be_gsm(_c.phone);
  if _gsm is null then raise exception 'PHONE_TO_MOBILE_NOT_GSM' using errcode = '23514'; end if;

  update public.contacts set mobile = _gsm where id = _id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_c.company_id, auth.uid(), 'phone_to_mobile', 'contacts', _id::text, 'screen',
          jsonb_build_object('phone', _c.phone, 'mobile', _c.mobile),
          jsonb_build_object('phone', _c.phone, 'mobile', _gsm));
  return _gsm;
end $fn$;
comment on function public.contact_use_phone_as_mobile(uuid) is
  'Mission 04 carte 3 : recopie le GSM belge du téléphone dans le mobile d''une fiche (clic de l''employé), tracé dans events.';
revoke all on function public.contact_use_phone_as_mobile(uuid) from public, anon;
grant execute on function public.contact_use_phone_as_mobile(uuid) to authenticated;
