-- =====================================================================
-- VP1 (décision du client, 20/11/2026, comme G8) — Fiche client en MAJUSCULES (Q67, déjà en base)
-- et « Bonjour Jean » dans les mails / SMS. Migration 20261120340000. ItalTest, simon@themaul.be,
-- transaction annulée (rt.py).
-- Contrôles :
--   1. name_title_case : JEAN → Jean, JEAN-PIERRE → Jean-Pierre, ANNE MARIE → Anne Marie,
--      D'ARTAGNAN → D'Artagnan, accents gardés ;
--   2. fiche particulier créée à l'écran en minuscules : enregistrée en MAJUSCULES (Q67) ;
--      sans civilité / prénom : refusée (Q67) ;
--   3. SMS Brevo (_sms_base_vars) : {prenom} = Jean-Pierre, {nom} = Dupont ; société : raison sociale ;
--   4. relance d'entretien (followup_render) : « Bonjour Jean-Pierre, » ;
--   5. campagne (_campaign_render) : {prenom} {nom} en casse titre ;
--   6. les mails de rappel (RDV, facture) utilisent name_title_case (définition en base).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

insert into _t(check_name, result) values
  ('casse titre : JEAN, JEAN-PIERRE, ANNE MARIE, D''ARTAGNAN, ÉLODIE',
   case when public.name_title_case('JEAN') = 'Jean' and public.name_title_case('JEAN-PIERRE') = 'Jean-Pierre'
             and public.name_title_case('ANNE MARIE') = 'Anne Marie' and public.name_title_case('D''ARTAGNAN') = 'D''Artagnan'
             and public.name_title_case('ÉLODIE') = 'Élodie' and public.name_title_case(null) is null then 'ok' else 'KO' end),
  ('mails de rappel RDV / facture : name_title_case dans la definition en base',
   case when pg_get_functiondef('public._cron_appointment_reminders()'::regprocedure) like '%name_title_case%'
             and pg_get_functiondef('public._cron_invoice_reminders()'::regprocedure) like '%name_title_case%' then 'ok' else 'KO' end);

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _c uuid; _s uuid; _v uuid; _f uuid; r record; _vars jsonb; _txt text;
begin
  insert into public.contacts (company_id, type, status, civility, first_name, last_name, email, locale, country)
  values (_co, 'particulier', 'client', 'M', 'jean-pierre', 'dupont', 'jp.vp1@example.invalid', 'fr', 'BE') returning id into _c;
  select first_name, last_name into r from public.contacts where id = _c;
  insert into _t(check_name, result) values ('fiche creee a l''ecran : nom et prenom en MAJUSCULES',
    case when r.first_name = 'JEAN-PIERRE' and r.last_name = 'DUPONT' then 'ok' else 'KO ' || r.first_name end);
  begin
    insert into public.contacts (company_id, type, status, last_name, country) values (_co, 'particulier', 'prospect', 'SANSPRENOM', 'BE');
    insert into _t(check_name, result) values ('particulier sans civilite ni prenom : refuse', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('particulier sans civilite ni prenom : refuse', case when sqlerrm like 'Fiche client : compléter%' then 'ok' else 'KO ' || sqlerrm end); end;

  insert into public.contacts (company_id, type, status, company_name, country) values (_co, 'professionnel', 'client', 'MOTO SPRL VP1', 'BE') returning id into _s;
  perform set_config('test.c', _c::text, true); perform set_config('test.s', _s::text, true);
end $s$;

-- Fonctions serveur (SMS, relances, campagnes : appelées par les tâches et les fonctions, pas par l'écran).
reset role;
do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _c uuid := current_setting('test.c')::uuid; _s uuid := current_setting('test.s')::uuid; _f uuid; r public.contacts; _vars jsonb; _txt text;
begin
  _vars := public._sms_base_vars(_co, _c, 'fr');
  insert into _t(check_name, result) values ('SMS : {prenom} = Jean-Pierre, {nom} = Dupont',
    case when _vars->>'prenom' = 'Jean-Pierre' and _vars->>'nom' = 'Dupont' then 'ok' else 'KO ' || _vars::text end);
  insert into _t(check_name, result) values ('SMS a une societe : raison sociale telle quelle',
    case when public._sms_base_vars(_co, _s, 'fr')->>'prenom' = 'MOTO SPRL VP1' then 'ok' else 'KO' end);

  -- Relance d'entretien (modèle FR de la société)
  insert into public.followups (company_id, contact_id, kind, status, send_at, locale, to_email, label)
  select _co, _c, t.kind, 'planifiee', now(), 'fr', 'jp.vp1@example.invalid', 'Essai VP1'
    from public.followup_templates t where t.company_id = _co and t.locale = 'fr' and t.body like 'Bonjour {prenom}%' limit 1
  returning id into _f;
  if _f is null then
    insert into _t(check_name, result) values ('relance : modele « Bonjour {prenom} » de la societe', 'KO aucun modele');
  else
    select body into _txt from public.followup_render(_f, null);
    insert into _t(check_name, result) values ('relance d''entretien : « Bonjour Jean-Pierre, »',
      case when _txt like 'Bonjour Jean-Pierre,%' then 'ok' else 'KO ' || left(_txt, 40) end);
  end if;

  select * into r from public.contacts where id = _c;
  insert into _t(check_name, result) values ('campagne : {prenom} {nom} = Jean-Pierre Dupont',
    case when public._campaign_render('Bonjour {prenom} {nom}', r) = 'Bonjour Jean-Pierre Dupont' then 'ok' else 'KO ' || public._campaign_render('Bonjour {prenom} {nom}', r) end);
end $s$;

select n, check_name, result from _t order by n;
