-- =====================================================================
-- LOT 1 — Correctif : messages RELAYÉS (formulaire du site, Shopify, transfert).
-- Réf. docs/plan-nouveau-client.md
--
-- Constaté en production le 14/09 sur le premier vrai prospect créé : la demande
-- venait du formulaire de contact Shopify, donc l'expéditeur technique était
-- `mailer@shopify.com`. L'analyse avait parfaitement lu le corps (nom, téléphone,
-- intérêt), mais la fiche a été créée avec l'adresse du relais.
--
-- Deux conséquences, la seconde étant la grave :
--   1. on ne peut pas répondre au client, l'adresse n'est pas la sienne ;
--   2. la notification Shopify SUIVANTE s'est rattachée à cette même fiche, parce
--      que `ingest_email` a trouvé une fiche portant `mailer@shopify.com`. À terme
--      tous les clients du formulaire se seraient empilés sur une seule fiche.
--
-- La fonction lit désormais `contact_email` et `sender_is_relay` produits par
-- l'analyse. L'adresse de l'expéditeur reste celle du journal (`from_address`) et
-- sert toujours à l'idempotence, mais elle n'est plus jamais posée sur la fiche
-- quand le message est relayé.
-- =====================================================================

create or replace function public.create_prospect_from_email(
  _company     uuid,
  _email       text,
  _subject     text,
  _body        text,
  _received    timestamptz,
  _external_id text,
  _extract     jsonb
)
returns table(contact_id uuid, lead_id uuid, communication_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  _cid    uuid;
  _lid    uuid;
  _commid uuid;
  _existing_comm uuid;
  _is_pro boolean := coalesce((_extract->>'is_professional')::boolean, false);
  _relay  boolean := coalesce((_extract->>'sender_is_relay')::boolean, false);
  _cmail  text := nullif(btrim(coalesce(_extract->>'contact_email', '')), '');
  _first  text := nullif(btrim(coalesce(_extract->>'first_name', '')), '');
  _last   text := nullif(btrim(coalesce(_extract->>'last_name', '')), '');
  _co     text := nullif(btrim(coalesce(_extract->>'company_name', '')), '');
  _phone  text := nullif(btrim(coalesce(_extract->>'phone', '')), '');
  _fiche_email text;
  _label  text;
begin
  if _email is null or btrim(_email) = '' then
    raise exception 'create_prospect_from_email: adresse e-mail de l''expediteur manquante';
  end if;

  -- Adresse portee par la FICHE. Sur un message relaye, l'expediteur technique est
  -- volontairement ecarte : mieux vaut une fiche sans adresse qu'une fiche qui
  -- capturerait toutes les notifications suivantes.
  _fiche_email := coalesce(_cmail, case when _relay then null else _email end);

  -- Idempotence : ce message a-t-il deja ete traite ?
  select c.id, c.contact_id into _existing_comm, _cid
    from public.communications c
   where c.company_id = _company and c.external_id = _external_id
   limit 1;
  if _existing_comm is not null then
    select l.id into _lid from public.leads l where l.contact_id = _cid order by l.created_at limit 1;
    return query select _cid, _lid, _existing_comm, false;
    return;
  end if;

  -- Garde-fou : une fiche porte-t-elle deja l'adresse REELLE du demandeur ?
  if _fiche_email is not null then
    select id into _cid from public.contacts
     where company_id = _company
       and (lower(email) = lower(_fiche_email) or lower(email_pro) = lower(_fiche_email))
     order by created_at limit 1;
  end if;

  if _cid is null then
    insert into public.contacts (
      company_id, type, status, origin, is_active,
      first_name, last_name, company_name, email, email_pro, mobile, notes
    ) values (
      _company,
      case when _is_pro then 'professionnel'::contact_type else 'particulier'::contact_type end,
      'prospect'::contact_status,
      'mail',
      true,
      _first,
      _last,
      _co,
      case when _is_pro then null else _fiche_email end,
      case when _is_pro then _fiche_email else null end,
      _phone,
      nullif(btrim(coalesce(_extract->>'request_summary', '')), '')
    )
    returning id into _cid;

    -- Rapprochements proposes (jamais appliques : decision D3).
    -- Pas de `on conflict (contact_id, ...)` : contact_id est AUSSI une colonne de
    -- sortie de cette fonction, donc une variable PL/pgSQL, et Postgres refuse
    -- l'ambiguite (42702). Un garde `not exists` qualifie fait le meme travail.
    insert into public.contact_merge_candidates (company_id, contact_id, candidate_id, reason)
    select _company, _cid, m.contact_id, m.reason
      from public.contacts_match_candidates(
             _company, _fiche_email,
             nullif(btrim(coalesce(_first,'') || ' ' || coalesce(_last,'')), ''),
             _co, _phone, _cid) m
     where not exists (
             select 1 from public.contact_merge_candidates x
              where x.contact_id = _cid and x.candidate_id = m.contact_id);
  end if;

  -- Journal du mail : from_address reste l'expediteur reel du message.
  insert into public.communications (
    company_id, contact_id, channel, direction, subject, body,
    occurred_at, external_id, from_address
  ) values (
    _company, _cid, 'email', 'in', _subject, _body,
    coalesce(_received, now()), _external_id, _email
  )
  returning id into _commid;

  -- Tache CRM : un lead a traiter.
  _label := coalesce(
    nullif(btrim(coalesce(_co, '')), ''),
    nullif(btrim(coalesce(_first, '') || ' ' || coalesce(_last, '')), ''),
    _fiche_email,
    _email);

  insert into public.leads (
    company_id, contact_id, name, email, phone,
    vehicle_interest, source, stage, notes
  ) values (
    _company, _cid, _label, _fiche_email, _phone,
    nullif(btrim(coalesce(_extract->>'interest', '')), ''),
    'mail',
    'nouveau',
    nullif(btrim(coalesce(_extract->>'request_summary', '')), '')
  )
  returning id into _lid;

  return query select _cid, _lid, _commid, true;
end $fn$;
revoke execute on function public.create_prospect_from_email(uuid, text, text, text, timestamptz, text, jsonb) from public, anon;
grant  execute on function public.create_prospect_from_email(uuid, text, text, text, timestamptz, text, jsonb) to service_role;
