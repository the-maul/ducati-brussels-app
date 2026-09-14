-- =====================================================================
-- LOT 1 — Canal d'arrivée distinct + capture plus complète.
-- Réf. docs/plan-nouveau-client.md (retours client du 14/09).
--
-- 1. CANAL. Une demande passée par le formulaire du site arrive techniquement
--    par mail, mais ce n'est pas le même canal : c'est le site web. On le
--    distingue via `sender_is_relay` produit par l'analyse.
--      relayé  → `contacts.origin = 'web'`  et `leads.source = 'WEB'`
--      direct  → `contacts.origin = 'mail'` et `leads.source = 'MAIL'`
--    Le filtre du CRM compare `upper(source)` : les deux canaux deviennent donc
--    des colonnes visibles du pipeline, à côté de REP, VN, VO…
--
-- 2. CAPTURE. Le formulaire du site envoie des champs structurés (pays, nom,
--    prénom, téléphone, e-mail, n° de châssis, message). On ne retenait que le
--    nom, le téléphone et l'intérêt. On pose désormais aussi ville, code postal,
--    pays, et la référence de moto ou de châssis citée.
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
  _vat    text := nullif(btrim(coalesce(_extract->>'vat_number', '')), '');
  _phone  text := nullif(btrim(coalesce(_extract->>'phone', '')), '');
  _city   text := nullif(btrim(coalesce(_extract->>'city', '')), '');
  _zip    text := nullif(btrim(coalesce(_extract->>'zip', '')), '');
  _country text := nullif(btrim(coalesce(_extract->>'country', '')), '');
  _vref   text := nullif(btrim(coalesce(_extract->>'vehicle_ref', '')), '');
  _interest text := nullif(btrim(coalesce(_extract->>'interest', '')), '');
  _summary  text := nullif(btrim(coalesce(_extract->>'request_summary', '')), '');
  _channel text;
  _fiche_email text;
  _label  text;
  _notes  text;
begin
  if _email is null or btrim(_email) = '' then
    raise exception 'create_prospect_from_email: adresse e-mail de l''expediteur manquante';
  end if;

  -- Canal d'arrivée : relayé = le site, direct = le mail.
  _channel := case when _relay then 'web' else 'mail' end;

  -- Adresse portée par la FICHE. Sur un message relayé, l'expéditeur technique est
  -- volontairement écarté : mieux vaut une fiche sans adresse qu'une fiche qui
  -- capturerait toutes les notifications suivantes du relais.
  _fiche_email := coalesce(_cmail, case when _relay then null else _email end);

  -- Idempotence : ce message a-t-il déjà été traité ?
  select c.id, c.contact_id into _existing_comm, _cid
    from public.communications c
   where c.company_id = _company and c.external_id = _external_id
   limit 1;
  if _existing_comm is not null then
    select l.id into _lid from public.leads l where l.contact_id = _cid order by l.created_at limit 1;
    return query select _cid, _lid, _existing_comm, false;
    return;
  end if;

  -- Une fiche porte-t-elle déjà l'adresse RÉELLE du demandeur ?
  if _fiche_email is not null then
    select id into _cid from public.contacts
     where company_id = _company
       and (lower(email) = lower(_fiche_email) or lower(email_pro) = lower(_fiche_email))
     order by created_at limit 1;
  end if;

  if _cid is null then
    insert into public.contacts (
      company_id, type, status, origin, is_active,
      first_name, last_name, company_name, vat_number,
      email, email_pro, mobile, city, zip, country, notes
    ) values (
      _company,
      case when _is_pro then 'professionnel'::contact_type else 'particulier'::contact_type end,
      'prospect'::contact_status,
      _channel,
      true,
      _first, _last, _co, _vat,
      case when _is_pro then null else _fiche_email end,
      case when _is_pro then _fiche_email else null end,
      _phone, _city, _zip, _country,
      _summary
    )
    returning id into _cid;

    -- Rapprochements proposés (jamais appliqués : décision D3).
    -- Pas de `on conflict (contact_id, ...)` : contact_id est AUSSI une colonne de
    -- sortie de cette fonction, donc une variable PL/pgSQL, et Postgres refuse
    -- l'ambiguïté (42702). Un garde `not exists` qualifié fait le même travail.
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

  -- Journal du mail : from_address reste l'expéditeur réel du message.
  insert into public.communications (
    company_id, contact_id, channel, direction, subject, body,
    occurred_at, external_id, from_address
  ) values (
    _company, _cid, 'email', 'in', _subject, _body,
    coalesce(_received, now()), _external_id, _email
  )
  returning id into _commid;

  -- Tâche CRM : tout ce que le mail contenait, pour que le vendeur n'ait pas à
  -- rouvrir le message pour savoir quoi faire.
  _label := coalesce(
    nullif(btrim(coalesce(_co, '')), ''),
    nullif(btrim(coalesce(_first, '') || ' ' || coalesce(_last, '')), ''),
    _fiche_email, _email);

  _notes := concat_ws(E'\n',
    _summary,
    case when _vref is not null then 'Moto / châssis cité : ' || _vref end,
    case when _vat is not null then 'TVA : ' || _vat end,
    case when _city is not null or _zip is not null then 'Localité : ' || concat_ws(' ', _zip, _city) end,
    'Reçu le ' || to_char(coalesce(_received, now()), 'DD/MM/YYYY à HH24:MI')
      || ' par ' || case when _relay then 'le formulaire du site' else 'e-mail direct' end
      || ' (' || _email || ')');

  insert into public.leads (
    company_id, contact_id, name, email, phone,
    vehicle_interest, source, stage, notes
  ) values (
    _company, _cid, _label, _fiche_email, _phone,
    coalesce(_interest, _vref),
    upper(_channel),
    'nouveau',
    _notes
  )
  returning id into _lid;

  return query select _cid, _lid, _commid, true;
end $fn$;
revoke execute on function public.create_prospect_from_email(uuid, text, text, text, timestamptz, text, jsonb) from public, anon;
grant  execute on function public.create_prospect_from_email(uuid, text, text, text, timestamptz, text, jsonb) to service_role;
