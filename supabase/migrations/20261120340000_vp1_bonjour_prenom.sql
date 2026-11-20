-- =====================================================================
-- VP1 — « Bonjour Jean » (décision du client, 20/11/2026 : « tout comme G8 »). CON001 CRM009
--
-- Depuis Q67 (20261120154000 / 155000) les nom et prénom des fiches sont en MAJUSCULES (et
-- civilité + nom + prénom sont obligatoires pour un particulier : déjà en base, rien à refaire ici).
-- Les mails et SMS qui saluent le client doivent rester polis : « Bonjour Jean »,
-- « Bonjour Jean-Pierre », « Bonjour Anne Marie », jamais « Bonjour JEAN ».
--
-- 1. public.name_title_case(text) : casse titre d'un nom de personne — minuscules, puis majuscule en
--    début de mot et après une espace, un trait d'union ou une apostrophe (D'Artagnan, Jean-Pierre).
--    Accents gardés. Une raison sociale n'est jamais transformée.
-- 2. Fonctions qui mettent un prénom / nom dans un message, redéfinies (même signature, corps de
--    production, seule la mise en casse change) :
--      - followup_render                : relances d'entretien ({prenom}, {nom}) ;
--      - _sms_base_vars                 : SMS Brevo « moto prête » et rappel de RDV ({prenom}, {nom}) ;
--      - _cron_appointment_reminders, _cron_invoice_reminders : mails « Bonjour <nom> » ;
--      - _campaign_render               : campagnes ({prenom}, {nom}) — initcap remplacé (apostrophe).
--    Les modèles remplis à l'écran (dictionnaire i18n, mail-i18n des fonctions) suivent la même
--    règle : src/lib/person-name.ts et supabase/functions/_shared/person-name.ts.
--
-- Additive, rejouable. Essai à blanc : supabase/tests/vp1_bonjour_prenom.sql. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '5s';

create or replace function public.name_title_case(_s text)
returns text language plpgsql immutable parallel safe set search_path = public, pg_temp as $fn$
declare r text := ''; ch text; up boolean := true; i int;
begin
  if _s is null then return null; end if;
  for i in 1 .. char_length(_s) loop
    ch := substr(_s, i, 1);
    r := r || case when up then upper(ch) else lower(ch) end;
    up := ch in (' ', '-', '''', '’', E'\t');
  end loop;
  return btrim(r);
end $fn$;
comment on function public.name_title_case(text) is
  'VP1 (20/11/2026) : casse titre d''un prénom / nom pour saluer le client (JEAN-PIERRE → Jean-Pierre, D''ARTAGNAN → D''Artagnan).';
grant execute on function public.name_title_case(text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.followup_render(_id uuid, _origin text DEFAULT NULL::text)
 RETURNS TABLE(subject text, body text, to_email text, locale text, link text, template_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  f        public.followups%rowtype;
  t        public.followup_templates%rowtype;
  _prenom  text;
  _nom     text;
  _moto    text;
  _date    text;
  _km      text;
  _link    text;
  _base    text;
  _subj    text;
  _body    text;
  _key     text;
begin
  select * into f from public.followups where id = _id;
  if not found then raise exception 'followup_render: relance introuvable' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.is_member(f.company_id) then
    raise exception 'followup_render: acces refuse' using errcode = '42501';
  end if;

  select coalesce(public.name_title_case(nullif(btrim(c.first_name), '')), nullif(btrim(c.company_name), '')),
         coalesce(public.name_title_case(nullif(btrim(c.last_name), '')), '')
    into _prenom, _nom
    from public.contacts c where c.id = f.contact_id;
  select nullif(btrim(concat_ws(' ', v.brand, v.model)), '')
         || case when nullif(btrim(v.plate), '') is not null then ' (' || btrim(v.plate) || ')' else '' end
    into _moto
    from public.vehicles v where v.id = f.vehicle_id;
  _moto := coalesce(_moto, case f.locale when 'nl' then 'motor' when 'en' then 'motorcycle' when 'it' then 'moto' else 'moto' end);
  _date := coalesce(to_char(f.due_date, 'DD/MM/YYYY'), to_char(f.send_at, 'DD/MM/YYYY'));
  _km   := coalesce(substring(f.label from '(\d[\d ]*) km'), '');

  -- Lien « Prendre rendez-vous » : espace client, formulaire ouvert, moto preselectionnee,
  -- jeton de la relance (la demande de RDV marque la relance repondue).
  _base := nullif(regexp_replace(coalesce(_origin, ''), '/+$', ''), '');
  if _base is null then
    select nullif(rv.extra->>'url', '') into _base from public.reference_values rv
     where rv.company_id = f.company_id and rv.table_key = 'followups' and rv.code = 'client_app_url' and rv.is_active;
  end if;
  _link := coalesce(_base, '') || '/mon-espace/rendez-vous?nouveau=1'
           || case when f.vehicle_id is not null then '&moto=' || f.vehicle_id::text else '' end
           || '&relance=' || f.token::text;

  if f.kind = 'manuel' then
    _subj := coalesce(f.mail_subject, f.label, '');
    _body := coalesce(f.mail_body, '');
    _key  := 'manuel';
  else
    select * into t from public.followup_templates x
     where x.company_id = f.company_id and x.kind = f.kind and x.locale = f.locale;
    if not found then
      select * into t from public.followup_templates x
       where x.company_id = f.company_id and x.kind = f.kind and x.locale = 'fr';
    end if;
    if not found then raise exception 'followup_render: aucun modele pour %', f.kind using errcode = 'P0002'; end if;
    _subj := t.subject;
    _body := t.body;
    _key  := t.kind || '/' || t.locale;
  end if;

  _subj := replace(replace(replace(replace(replace(replace(replace(_subj,
             '{prenom}', coalesce(_prenom, '')), '{nom}', _nom), '{moto}', _moto), '{date}', _date),
             '{objet}', coalesce(f.label, '')), '{km}', _km), '{lien_rdv}', _link);
  _body := replace(replace(replace(replace(replace(replace(replace(_body,
             '{prenom}', coalesce(_prenom, '')), '{nom}', _nom), '{moto}', _moto), '{date}', _date),
             '{objet}', coalesce(f.label, '')), '{km}', _km), '{lien_rdv}', _link);
  -- « Bonjour , » quand le prenom manque → « Bonjour, ».
  _subj := regexp_replace(_subj, '\s+,', ',', 'g');
  _body := regexp_replace(_body, '[ \t]+,', ',', 'g');

  return query select _subj, _body, f.to_email, f.locale, _link, _key;
end $function$;

CREATE OR REPLACE FUNCTION public._sms_base_vars(_company uuid, _contact uuid, _locale text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'prenom', coalesce(public.name_title_case(nullif(btrim(c.first_name), '')), nullif(btrim(c.company_name), ''), public.name_title_case(nullif(btrim(c.last_name), '')), ''),
    'nom', coalesce(public.name_title_case(nullif(btrim(c.last_name), '')), nullif(btrim(c.company_name), ''), ''),
    'horaires', coalesce(nullif(btrim(s.opening_hours), ''), public._sms_fallback('horaires', _locale)),
    'societe', coalesce(nullif(btrim(s.signature), ''), co.name, ''))
  from public.companies co
  left join public.contacts c on c.id = _contact
  left join public.sms_settings s on s.company_id = co.id
  where co.id = _company;
$function$;

CREATE OR REPLACE FUNCTION public._cron_appointment_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare a record; _n int := 0;
begin
  for a in
    select ap.id, ap.company_id, ap.starts_at, c.email,
           coalesce(nullif(btrim(c.company_name), ''), nullif(public.name_title_case(trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))), ''), '') as name
    from public.workshop_appointments ap join public.contacts c on c.id = ap.contact_id
    where ap.status = 'prevu'
      and (ap.starts_at at time zone 'Europe/Brussels')::date = ((now() at time zone 'Europe/Brussels')::date + 1)
  loop
    if coalesce(a.email,'') <> '' then
      perform public.enqueue_notification(a.company_id, 'email', a.email, 'Rappel de rendez-vous atelier',
        'Bonjour ' || a.name || ', nous vous rappelons votre rendez-vous atelier le '
          || to_char(a.starts_at at time zone 'Europe/Brussels', 'DD/MM/YYYY à HH24:MI') || '.',
        'appointment_reminder', 'appointment', a.id::text);
      _n := _n + 1;
    end if;
  end loop;
  return _n;
end $function$;

CREATE OR REPLACE FUNCTION public._cron_invoice_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d record; _n int := 0;
begin
  for d in
    select doc.id, doc.number, doc.company_id, doc.total_ttc - doc.paid_amount as due, c.email,
           coalesce(nullif(btrim(c.company_name), ''), nullif(public.name_title_case(trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))), ''), '') as name
    from public.documents doc join public.contacts c on c.id = doc.contact_id
    where doc.doc_type = 'FAC' and doc.status not in ('annulee','converti')
      and doc.total_ttc - doc.paid_amount > 0.005 and doc.due_date < current_date and coalesce(c.email,'') <> ''
  loop
    if public.enqueue_notification(d.company_id, 'email', d.email,
        'Relance facture ' || coalesce(d.number,''),
        'Bonjour ' || d.name || ', votre facture ' || coalesce(d.number,'') || ' d''un montant de ' ||
        to_char(d.due, 'FM999G999D00') || ' EUR est échue. Merci de procéder au règlement.',
        'invoice_reminder', 'document', d.id::text) is not null then
      _n := _n + 1;
    end if;
  end loop;
  return _n;
end $function$;

CREATE OR REPLACE FUNCTION public._campaign_render(_t text, _c contacts)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select replace(replace(replace(replace(replace(coalesce(_t, ''),
           '{civilite}', coalesce(case _c.civility when 'Monsieur' then 'M.' when 'Madame' then 'Mme' when 'Mx' then 'Mx' else '' end, '')),
           '{prenom}', coalesce(public.name_title_case(_c.first_name), '')),
           '{nom}', coalesce(public.name_title_case(_c.last_name), '')),
           '{societe}', coalesce(_c.company_name, '')),
           '{code}', coalesce(_c.code, ''));
$function$;
