-- =====================================================================
-- M10 — RELANCES D'ENTRETIEN AUTOMATIQUES PAR MAIL, ET RAPPEL AU COMMERCIAL A J+5 (CRM010)
-- Decision client du 30/10/2026 (validee par Simon, decision M-72) :
--   « Ce n'est pas l'atelier qui va avoir une liste de rendez-vous hypothetiques : c'est une
--     partie Marketing qui prepare les differentes relances automatiques par mail. Apres un mail
--     envoye, s'il n'y a pas de reponse, ca tombe a J+5 dans le CRM commercial comme personne
--     a rappeler. »
--
-- CE QUE FAIT CETTE MIGRATION
--   1. `followups` : une relance = un client + une moto + un objet (entretien du, intervention
--      reportee), une date d'envoi, un statut :
--        planifiee → envoyee → (repondue | a_rappeler) → close ; annulee a tout moment.
--   2. `followup_templates` : le texte du mail, par societe, par kind et par langue (FR/NL/EN/IT),
--      modifiable a l'ecran ; variables {prenom} {nom} {moto} {date} {objet} {km} {lien_rdv}.
--   3. `followups_plan(_company)` : construit / actualise les relances a partir de
--        - `vehicles_maintenance_upcoming(_company, 200)` (lot « dates d'entretien ») :
--          send_at = date due − 15 jours ;
--        - `deferred_interventions` (lot « check-up atelier ») : send_at = date fixee au comptoir.
--      Ces deux objets sont livres par d'autres lots, dans un ordre inconnu : la fonction tolere
--      leur absence (`to_regprocedure` / `to_regclass`) et ne cree alors rien.
--   4. `followup_render(_id, _origin)` : objet et corps du mail dans la LANGUE DU CLIENT
--      (`contacts.locale`, decision M-71), variables remplies, lien « Prendre rendez-vous » vers
--      l'espace client avec le jeton de la relance.
--   5. Envoi : par la fonction Edge `followups-send` (Outlook / Microsoft Graph, decision D4 :
--      jamais Resend). `appointment-reminders` enfile vers `notifications`, que
--      `dispatch-notifications` marque `skipped` faute de cle Resend : on ne reproduit pas cette
--      impasse. `followup_mark_sent` / `followup_mark_error` sont appelees par la fonction.
--   6. Reponse du client :
--        - un rendez-vous atelier cree apres l'envoi pour la moto (ou le client) → `close`
--          (declencheur sur `workshop_appointments`) ; la tache CRM eventuelle est terminee ;
--        - un mail entrant du client dans les 5 jours (releve Outlook → `communications`) →
--          `repondue` (declencheur sur `communications`) ;
--        - le lien du mail (`followup_answer_by_token`) → `repondue`.
--   7. `followups_j5(_company)` : relance `envoyee` depuis 5 jours sans reponse ni RDV →
--      `a_rappeler` + carte CRM commerciale (reliee a la carte ouverte du client s'il en a une,
--      sinon creee, source ATELIER) + tache « Rappeler {client} — {moto} : {objet} » confiee au
--      responsable par defaut des nouvelles demandes (reglage existant `default_assignee`).
--   8. pg_cron : `followups-plan` (planifier + J+5) a 6 h, `followups-send` (Edge) a 6 h 15,
--      avec l'en-tete x-cron-secret lu dans le coffre Vault (meme principe que S5).
--
-- RLS : lecture et ecriture `is_member` (la grille d'ecran limite /crm a vendeur, marketing, admin).
-- Audit : `audit_row` sur les deux tables + une ligne `events` par action metier.
--
-- NON APPLIQUEE. Essai a blanc :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f <fichier.sql>
--   (le fichier d'essai entoure cette migration de begin; / rollback;)
-- Application (par le client) :
--   npx supabase@2.117.0 db push --linked --project-ref ujmrosbgkvgvwfnuryna
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Les relances
-- ---------------------------------------------------------------------
create table if not exists public.followups (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  kind          text not null check (kind in ('entretien', 'intervention_reportee', 'manuel')),
  vehicle_id    uuid references public.vehicles(id) on delete set null,
  contact_id    uuid references public.contacts(id) on delete set null,
  -- Ligne d'origine : vehicle_id (entretien : la prochaine echeance de la moto) ou
  -- deferred_interventions.id (intervention reportee).
  source_id     uuid,
  label         text,                       -- l'objet : « Desmo Service 24 000 km », « Pneu arriere »
  due_date      date,                       -- date due (entretien) ou date fixee au comptoir
  send_at       date not null,              -- date d'envoi prevue
  status        text not null default 'planifiee'
                check (status in ('planifiee', 'envoyee', 'repondue', 'a_rappeler', 'close', 'annulee')),
  channel       text not null default 'email',
  to_email      text,
  locale        text not null default 'fr' check (locale in ('fr', 'nl', 'en', 'it')),
  template_key  text,                       -- kind/locale du modele utilise a l'envoi
  token         uuid not null default gen_random_uuid() unique,
  sent_at       timestamptz,
  answered_at   timestamptz,
  answered_how  text check (answered_how is null or answered_how in ('rdv', 'mail', 'lien', 'manuel')),
  closed_at     timestamptz,
  crm_card_id   uuid references public.leads(id) on delete set null,
  crm_task_id   uuid references public.lead_tasks(id) on delete set null,
  mail_subject  text,                       -- ce qui est parti (copie)
  mail_body     text,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.followups is
  'Relances marketing (entretien du, intervention reportee) : un mail planifie, envoye, puis J+5 sans reponse → carte CRM a rappeler (M10, decision M-72).';

-- Une seule relance VIVANTE par (societe, kind, ligne d'origine). Les relances closes ou annulees
-- restent en historique : la moto peut etre relancee au cycle suivant.
create unique index if not exists uq_followups_source
  on public.followups(company_id, kind, source_id)
  where source_id is not null and status not in ('close', 'annulee');
create index if not exists idx_followups_company_status on public.followups(company_id, status, send_at);
create index if not exists idx_followups_contact on public.followups(contact_id);
create index if not exists idx_followups_vehicle on public.followups(vehicle_id);

drop trigger if exists trg_followups_updated on public.followups;
create trigger trg_followups_updated before update on public.followups
  for each row execute function public.set_updated_at();
drop trigger if exists trg_followups_audit on public.followups;
create trigger trg_followups_audit after insert or update or delete on public.followups
  for each row execute function public.audit_row();

alter table public.followups enable row level security;
drop policy if exists followups_select on public.followups;
create policy followups_select on public.followups for select to authenticated
  using (public.is_member(company_id));
drop policy if exists followups_write on public.followups;
create policy followups_write on public.followups for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- 2. Les modeles de mail (par societe, par kind, par langue)
-- ---------------------------------------------------------------------
create table if not exists public.followup_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  kind        text not null check (kind in ('entretien', 'intervention_reportee')),
  locale      text not null check (locale in ('fr', 'nl', 'en', 'it')),
  subject     text not null,
  body        text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  unique (company_id, kind, locale)
);
comment on table public.followup_templates is
  'Texte des mails de relance, par societe, par kind et par langue du client. Variables : {prenom} {nom} {moto} {date} {objet} {km} {lien_rdv}.';

drop trigger if exists trg_followup_templates_updated on public.followup_templates;
create trigger trg_followup_templates_updated before update on public.followup_templates
  for each row execute function public.set_updated_at();
drop trigger if exists trg_followup_templates_audit on public.followup_templates;
create trigger trg_followup_templates_audit after insert or update or delete on public.followup_templates
  for each row execute function public.audit_row();

alter table public.followup_templates enable row level security;
drop policy if exists followup_templates_select on public.followup_templates;
create policy followup_templates_select on public.followup_templates for select to authenticated
  using (public.is_member(company_id));
drop policy if exists followup_templates_write on public.followup_templates;
create policy followup_templates_write on public.followup_templates for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Textes par defaut (FR de reference, NL, EN, IT). Jamais ecrases : `on conflict do nothing`,
-- la societe garde ses modifications.
create or replace function public.followup_templates_seed(_company uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _n int;
begin
  insert into public.followup_templates (company_id, kind, locale, subject, body) values
  (_company, 'entretien', 'fr',
   'Votre {moto} : entretien {objet} a prevoir',
   $t$Bonjour {prenom},

L'entretien {objet} de votre {moto} est a prevoir pour le {date}.

Pour garder votre Ducati en pleine forme et preserver sa garantie, nous vous proposons de fixer des maintenant un rendez-vous a l'atelier :
{lien_rdv}

Vous pouvez aussi repondre a ce message ou nous appeler : nous trouverons ensemble le meilleur moment.

A bientot,$t$),
  (_company, 'entretien', 'nl',
   'Uw {moto}: onderhoud {objet} in te plannen',
   $t$Beste {prenom},

Het onderhoud {objet} van uw {moto} is te voorzien tegen {date}.

Om uw Ducati in topvorm te houden en uw garantie te behouden, stellen wij voor nu al een afspraak in de werkplaats vast te leggen:
{lien_rdv}

U kunt ook op dit bericht antwoorden of ons bellen: samen vinden we het beste moment.

Tot binnenkort,$t$),
  (_company, 'entretien', 'en',
   'Your {moto}: {objet} service due soon',
   $t$Hello {prenom},

The {objet} service of your {moto} is due around {date}.

To keep your Ducati in top shape and protect its warranty, we suggest booking a workshop appointment now:
{lien_rdv}

You can also reply to this message or call us: we will find the best moment together.

See you soon,$t$),
  (_company, 'entretien', 'it',
   'La sua {moto}: tagliando {objet} da programmare',
   $t$Buongiorno {prenom},

Il tagliando {objet} della sua {moto} e da prevedere per il {date}.

Per mantenere la sua Ducati in piena forma e preservare la garanzia, le proponiamo di fissare fin da ora un appuntamento in officina:
{lien_rdv}

Puo anche rispondere a questo messaggio o chiamarci: troveremo insieme il momento migliore.

A presto,$t$),
  (_company, 'intervention_reportee', 'fr',
   'Votre {moto} : {objet}, et si on la planifiait ?',
   $t$Bonjour {prenom},

Lors de votre dernier passage a l'atelier, vous aviez prefere reporter : {objet}.
Nous avions note d'en reparler vers le {date} : c'est le moment.

Prenez rendez-vous en un clic :
{lien_rdv}

Ou repondez simplement a ce message : nous vous proposerons un creneau.

A bientot,$t$),
  (_company, 'intervention_reportee', 'nl',
   'Uw {moto}: {objet}, plannen we het in?',
   $t$Beste {prenom},

Bij uw laatste bezoek aan de werkplaats verkoos u uit te stellen: {objet}.
We hadden genoteerd er rond {date} op terug te komen: het is zover.

Maak in een klik een afspraak:
{lien_rdv}

Of antwoord gewoon op dit bericht: wij stellen u een moment voor.

Tot binnenkort,$t$),
  (_company, 'intervention_reportee', 'en',
   'Your {moto}: {objet}, shall we schedule it?',
   $t$Hello {prenom},

During your last workshop visit you preferred to postpone: {objet}.
We had noted to come back to it around {date}: now is the time.

Book an appointment in one click:
{lien_rdv}

Or simply reply to this message: we will suggest a slot.

See you soon,$t$),
  (_company, 'intervention_reportee', 'it',
   'La sua {moto}: {objet}, la programmiamo?',
   $t$Buongiorno {prenom},

Durante la sua ultima visita in officina aveva preferito rinviare: {objet}.
Avevamo annotato di riparlarne verso il {date}: e il momento.

Prenoti un appuntamento con un clic:
{lien_rdv}

Oppure risponda semplicemente a questo messaggio: le proporremo un orario.

A presto,$t$)
  on conflict (company_id, kind, locale) do nothing;
  get diagnostics _n = row_count;
  return _n;
end $fn$;
revoke all on function public.followup_templates_seed(uuid) from public, anon;
grant execute on function public.followup_templates_seed(uuid) to authenticated, service_role;

-- Prechargement pour les societes existantes.
select public.followup_templates_seed(c.id) from public.companies c;

-- ---------------------------------------------------------------------
-- 3. Planifier : entretiens dus (−15 j) et interventions reportees (date fixee)
-- ---------------------------------------------------------------------
create or replace function public.followups_plan(_company uuid)
returns table(planned integer, updated integer, cancelled integer)
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  r        record;
  _new     int := 0;
  _upd     int := 0;
  _can     int := 0;
  _c       int := 0;
  _seen    uuid[] := '{}';
  _fid     uuid;
  _status  text;
  _label   text;
  _send    date;
  _email   text;
  _loc     text;
  _cid     uuid;
  _vid     uuid;
begin
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'followups_plan: acces refuse' using errcode = '42501';
  end if;
  perform public.followup_templates_seed(_company);

  -- A. Entretiens dus (lot « dates d'entretien »). Absent → rien.
  if to_regprocedure('public.vehicles_maintenance_upcoming(uuid,integer)') is not null then
    for r in execute
      'select vehicle_id, model_label, contact_id, email, locale, kind, due_date, due_km '
      'from public.vehicles_maintenance_upcoming($1, 200)' using _company
    loop
      continue when r.vehicle_id is null or r.due_date is null or coalesce(r.email, '') = '';
      -- Trop en retard (plus d'un mois) : ce n'est plus une relance, c'est au commercial.
      continue when r.due_date < current_date - 30;
      _vid   := r.vehicle_id::uuid;
      _label := coalesce(nullif(btrim(r.kind::text), ''), 'Entretien')
                || case when r.due_km is not null then ' ' || r.due_km::text || ' km' else '' end;
      _send  := greatest(r.due_date::date - 15, current_date);   -- 15 jours avant la date due
      _loc   := case when r.locale::text in ('fr', 'nl', 'en', 'it') then r.locale::text else 'fr' end;
      _seen  := _seen || _vid;

      select f.id, f.status into _fid, _status from public.followups f
       where f.company_id = _company and f.kind = 'entretien' and f.source_id = _vid
         and f.status not in ('close', 'annulee') limit 1;
      if _fid is null then
        insert into public.followups (company_id, kind, vehicle_id, contact_id, source_id, label,
                                      due_date, send_at, to_email, locale)
        values (_company, 'entretien', _vid, r.contact_id::uuid, _vid, _label,
                r.due_date::date, _send, lower(btrim(r.email)), _loc);
        _new := _new + 1;
      elsif _status = 'planifiee' then
        update public.followups f
           set label = _label, due_date = r.due_date::date, send_at = _send,
               to_email = lower(btrim(r.email)), locale = _loc, contact_id = r.contact_id::uuid
         where f.id = _fid
           and (f.label is distinct from _label or f.due_date is distinct from r.due_date::date
                or f.send_at <> _send or f.to_email is distinct from lower(btrim(r.email))
                or f.locale <> _loc or f.contact_id is distinct from r.contact_id::uuid);
        get diagnostics _c = row_count;
        _upd := _upd + _c;
      end if;
    end loop;
    -- Plus d'entretien du pour cette moto (entretien fait, moto vendue…) : la relance non
    -- encore envoyee est annulee ; une relance deja partie suit son cours (reponse ou J+5).
    update public.followups f
       set status = 'annulee', closed_at = now(), last_error = 'plus d''entretien du a la planification'
     where f.company_id = _company and f.kind = 'entretien' and f.status = 'planifiee'
       and not (f.source_id = any(_seen));
    get diagnostics _c = row_count;
    _can := _can + _c;
  end if;

  -- B. Interventions reportees (lot « check-up atelier »). Absente → rien.
  if to_regclass('public.deferred_interventions') is not null then
    _seen := '{}';
    for r in execute
      'select d.id, d.vehicle_id, d.contact_id, d.label, d.planned_date '
      'from public.deferred_interventions d '
      'where d.company_id = $1 and d.status = ''planifie'' and d.planned_date is not null' using _company
    loop
      continue when r.planned_date < current_date - 30;
      _cid := r.contact_id::uuid;
      select lower(btrim(c.email)), coalesce(to_jsonb(c)->>'locale', 'fr') into _email, _loc
        from public.contacts c where c.id = _cid;
      continue when coalesce(_email, '') = '';
      _loc   := case when _loc in ('fr', 'nl', 'en', 'it') then _loc else 'fr' end;
      _label := coalesce(nullif(btrim(r.label::text), ''), 'Intervention reportee');
      _send  := greatest(r.planned_date::date, current_date);          -- a la date fixee au comptoir
      _seen  := _seen || r.id::uuid;

      select f.id, f.status into _fid, _status from public.followups f
       where f.company_id = _company and f.kind = 'intervention_reportee' and f.source_id = r.id::uuid
         and f.status not in ('close', 'annulee') limit 1;
      if _fid is null then
        insert into public.followups (company_id, kind, vehicle_id, contact_id, source_id, label,
                                      due_date, send_at, to_email, locale)
        values (_company, 'intervention_reportee', r.vehicle_id::uuid, _cid, r.id::uuid, _label,
                r.planned_date::date, _send, _email, _loc);
        _new := _new + 1;
      elsif _status = 'planifiee' then
        update public.followups f
           set label = _label, due_date = r.planned_date::date, send_at = _send, to_email = _email, locale = _loc
         where f.id = _fid
           and (f.label is distinct from _label or f.due_date is distinct from r.planned_date::date
                or f.send_at <> _send or f.to_email is distinct from _email or f.locale <> _loc);
        get diagnostics _c = row_count;
        _upd := _upd + _c;
      end if;
    end loop;
    update public.followups f
       set status = 'annulee', closed_at = now(), last_error = 'intervention plus planifiee'
     where f.company_id = _company and f.kind = 'intervention_reportee' and f.status = 'planifiee'
       and not (f.source_id = any(_seen));
    get diagnostics _c = row_count;
    _can := _can + _c;
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, auth.uid(), 'followups_planned', 'followups', null,
          case when auth.uid() is null then 'system' else 'screen' end,
          jsonb_build_object('planned', _new, 'updated', _upd, 'cancelled', _can));
  return query select _new, _upd, _can;
end $fn$;
revoke all on function public.followups_plan(uuid) from public, anon;
grant execute on function public.followups_plan(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Le mail d'une relance, dans la langue du client, variables remplies
-- ---------------------------------------------------------------------
create or replace function public.followup_render(_id uuid, _origin text default null)
returns table(subject text, body text, to_email text, locale text, link text, template_key text)
language plpgsql security definer set search_path = public, pg_temp as $fn$
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

  select coalesce(nullif(btrim(c.first_name), ''), nullif(btrim(c.company_name), '')),
         coalesce(nullif(btrim(c.last_name), ''), '')
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
end $fn$;
revoke all on function public.followup_render(uuid, text) from public, anon;
grant execute on function public.followup_render(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Envoi : appele par la fonction Edge `followups-send` (cle de service) ou par un membre
-- ---------------------------------------------------------------------
create or replace function public.followup_mark_sent(_id uuid, _subject text, _body text, _mailbox text default null, _template_key text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare f public.followups%rowtype;
begin
  select * into f from public.followups where id = _id for update;
  if not found then raise exception 'followup_mark_sent: relance introuvable' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.is_member(f.company_id) then
    raise exception 'followup_mark_sent: acces refuse' using errcode = '42501';
  end if;
  if f.status <> 'planifiee' then
    raise exception 'followup_mark_sent: statut % (attendu planifiee)', f.status using errcode = '22023';
  end if;
  update public.followups
     set status = 'envoyee', sent_at = now(), mail_subject = _subject, mail_body = _body,
         template_key = coalesce(_template_key, template_key), last_error = null
   where id = _id;
  -- L'echange apparait dans l'historique du client (la releve Outlook ne lit pas forcement
  -- la boite d'envoi dans les 5 minutes ; et un doublon releve ensuite reste inoffensif).
  if f.contact_id is not null then
    insert into public.communications (company_id, contact_id, channel, direction, subject, body, occurred_at)
    values (f.company_id, f.contact_id, 'email', 'out', _subject, left(coalesce(_body, ''), 12000), now());
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (f.company_id, auth.uid(), 'followup_sent', 'followups', _id::text,
          case when auth.uid() is null then 'system' else 'screen' end,
          jsonb_build_object('to', f.to_email, 'from', _mailbox, 'subject', _subject, 'kind', f.kind, 'locale', f.locale));
end $fn$;
revoke all on function public.followup_mark_sent(uuid, text, text, text, text) from public, anon;
grant execute on function public.followup_mark_sent(uuid, text, text, text, text) to authenticated, service_role;

create or replace function public.followup_mark_error(_id uuid, _error text)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare f public.followups%rowtype;
begin
  select * into f from public.followups where id = _id;
  if not found then return; end if;
  if auth.uid() is not null and not public.is_member(f.company_id) then
    raise exception 'followup_mark_error: acces refuse' using errcode = '42501';
  end if;
  update public.followups set last_error = left(coalesce(_error, ''), 500) where id = _id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (f.company_id, auth.uid(), 'followup_send_failed', 'followups', _id::text,
          case when auth.uid() is null then 'system' else 'screen' end, jsonb_build_object('error', left(coalesce(_error, ''), 500)));
end $fn$;
revoke all on function public.followup_mark_error(uuid, text) from public, anon;
grant execute on function public.followup_mark_error(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Actions de l'ecran : decaler, annuler, marquer repondue, clore
-- ---------------------------------------------------------------------
create or replace function public.followup_set(_id uuid, _action text, _date date default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $fn$
declare f public.followups%rowtype; _to text;
begin
  select * into f from public.followups where id = _id for update;
  if not found then raise exception 'followup_set: relance introuvable' using errcode = 'P0002'; end if;
  if not public.is_member(f.company_id) then
    raise exception 'followup_set: acces refuse' using errcode = '42501';
  end if;
  if _action = 'postpone' then
    if f.status <> 'planifiee' then raise exception 'followup_set: seule une relance planifiee se decale' using errcode = '22023'; end if;
    if _date is null or _date < current_date then raise exception 'followup_set: date invalide' using errcode = '22023'; end if;
    update public.followups set send_at = _date where id = _id;
    _to := 'planifiee';
  elsif _action = 'cancel' then
    if f.status in ('close', 'annulee') then raise exception 'followup_set: relance deja terminee' using errcode = '22023'; end if;
    update public.followups set status = 'annulee', closed_at = now() where id = _id;
    _to := 'annulee';
  elsif _action = 'answered' then
    if f.status not in ('envoyee', 'a_rappeler') then raise exception 'followup_set: la relance n''est pas en attente de reponse' using errcode = '22023'; end if;
    update public.followups set status = 'repondue', answered_at = coalesce(answered_at, now()), answered_how = 'manuel' where id = _id;
    _to := 'repondue';
  elsif _action = 'close' then
    if f.status in ('close', 'annulee') then raise exception 'followup_set: relance deja terminee' using errcode = '22023'; end if;
    update public.followups set status = 'close', closed_at = now() where id = _id;
    _to := 'close';
  else
    raise exception 'followup_set: action inconnue %', _action using errcode = '22023';
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (f.company_id, auth.uid(), 'followup_' || _action, 'followups', _id::text, 'screen',
          jsonb_build_object('status', f.status, 'send_at', f.send_at),
          jsonb_build_object('status', _to, 'send_at', coalesce(_date, f.send_at)));
  return _to;
end $fn$;
revoke all on function public.followup_set(uuid, text, date) from public, anon;
grant execute on function public.followup_set(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Reponse du client
-- ---------------------------------------------------------------------
-- 7a. Le lien du mail (espace client, formulaire de RDV) : jeton → repondue.
-- Appele par le client connecte a son espace, apres sa demande de rendez-vous. Le jeton seul
-- suffit (il n'est connu que du destinataire du mail) ; rien d'autre n'est revele.
create or replace function public.followup_answer_by_token(_token uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $fn$
declare f public.followups%rowtype;
begin
  if auth.uid() is null then return false; end if;
  select * into f from public.followups where token = _token for update;
  if not found then return false; end if;
  if f.status in ('planifiee', 'envoyee', 'a_rappeler') then
    update public.followups set status = 'repondue', answered_at = coalesce(answered_at, now()), answered_how = coalesce(answered_how, 'lien')
     where id = f.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
    values (f.company_id, auth.uid(), 'followup_answered', 'followups', f.id::text, 'api', jsonb_build_object('how', 'lien'));
    return true;
  end if;
  return f.status in ('repondue', 'close');
end $fn$;
revoke all on function public.followup_answer_by_token(uuid) from public, anon;
grant execute on function public.followup_answer_by_token(uuid) to authenticated;

-- 7b. Un rendez-vous pris (portail, comptoir, planning) ferme la relance de la moto — ou du
-- client quand l'un des deux n'a pas de moto renseignee. La tache CRM ouverte par J+5 est
-- terminee dans le meme geste : plus personne a rappeler.
create or replace function public.followups_on_appointment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare f record;
begin
  if new.status = 'annule' then return new; end if;
  for f in
    select x.id, x.crm_task_id, x.company_id from public.followups x
     where x.company_id = new.company_id
       and x.status in ('planifiee', 'envoyee', 'repondue', 'a_rappeler')
       and (
         (new.vehicle_id is not null and x.vehicle_id = new.vehicle_id)
         or (new.contact_id is not null and x.contact_id = new.contact_id and (x.vehicle_id is null or new.vehicle_id is null))
       )
  loop
    update public.followups
       set status = 'close', closed_at = now(), answered_at = coalesce(answered_at, now()), answered_how = coalesce(answered_how, 'rdv')
     where id = f.id;
    if f.crm_task_id is not null then
      update public.lead_tasks set done_at = now() where id = f.crm_task_id and done_at is null;
    end if;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
    values (f.company_id, auth.uid(), 'followup_closed_by_appointment', 'followups', f.id::text, 'system',
            jsonb_build_object('appointment_id', new.id));
  end loop;
  return new;
end $fn$;
drop trigger if exists trg_followups_appointment on public.workshop_appointments;
create trigger trg_followups_appointment after insert on public.workshop_appointments
  for each row execute function public.followups_on_appointment();

-- 7c. Un mail du client recu par la releve Outlook dans les 5 jours → repondue.
create or replace function public.followups_on_inbound_mail()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.direction <> 'in' or new.channel <> 'email' or new.contact_id is null then return new; end if;
  update public.followups x
     set status = 'repondue', answered_at = coalesce(x.answered_at, new.occurred_at), answered_how = coalesce(x.answered_how, 'mail')
   where x.company_id = new.company_id and x.contact_id = new.contact_id and x.status = 'envoyee'
     and x.sent_at <= new.occurred_at and new.occurred_at <= x.sent_at + interval '5 days';
  return new;
end $fn$;
drop trigger if exists trg_followups_inbound_mail on public.communications;
create trigger trg_followups_inbound_mail after insert on public.communications
  for each row execute function public.followups_on_inbound_mail();

-- ---------------------------------------------------------------------
-- 8. J+5 : envoyee depuis 5 jours, ni reponse ni rendez-vous → a rappeler + carte CRM
-- ---------------------------------------------------------------------
create or replace function public.followups_j5(_company uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  f       record;
  _n      int := 0;
  _name   text;
  _email  text;
  _phone  text;
  _moto   text;
  _lid    uuid;
  _tid    uuid;
  _owner  uuid;
  _title  text;
  _note   text;
begin
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'followups_j5: acces refuse' using errcode = '42501';
  end if;
  for f in
    select x.* from public.followups x
     where x.company_id = _company and x.status = 'envoyee' and x.answered_at is null
       and x.sent_at <= now() - interval '5 days'
     order by x.sent_at
  loop
    -- Un rendez-vous pris depuis l'envoi (filet : le declencheur 7b l'a normalement deja ferme).
    if exists (
      select 1 from public.workshop_appointments a
       where a.company_id = _company and a.created_at > f.sent_at and a.status <> 'annule'
         and ((f.vehicle_id is not null and a.vehicle_id = f.vehicle_id)
              or (f.contact_id is not null and a.contact_id = f.contact_id and (a.vehicle_id is null or f.vehicle_id is null)))
    ) then
      update public.followups set status = 'close', closed_at = now(), answered_at = now(), answered_how = 'rdv' where id = f.id;
      continue;
    end if;

    select coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), f.to_email),
           c.email, coalesce(c.mobile, c.phone)
      into _name, _email, _phone
      from public.contacts c where c.id = f.contact_id;
    _name := coalesce(_name, f.to_email, 'Client');
    select nullif(btrim(concat_ws(' ', v.brand, v.model)), '') into _moto from public.vehicles v where v.id = f.vehicle_id;
    _moto  := coalesce(_moto, 'moto');
    _title := 'Rappeler ' || _name || ' — ' || _moto || ' : ' || coalesce(f.label, 'relance');
    _note  := to_char(now(), 'DD/MM/YYYY') || ' — Relance « ' || coalesce(f.label, '') || ' » envoyee le '
              || to_char(f.sent_at, 'DD/MM/YYYY') || ' sans reponse ni rendez-vous (Relances, J+5).';

    -- Jamais deux cartes pour un meme client dans le CRM commercial (D3).
    _lid := null;
    if f.contact_id is not null then
      select l.id into _lid from public.leads l
       where l.company_id = _company and l.contact_id = f.contact_id and l.pipeline = 'commercial'
         and l.archived_at is null and l.stage not in ('gagne', 'perdu')
       order by l.created_at limit 1;
    end if;
    if _lid is null then
      insert into public.leads (company_id, pipeline, contact_id, name, email, phone, vehicle_interest, source, stage, notes)
      values (_company, 'commercial', f.contact_id, _name, coalesce(_email, f.to_email), _phone, _moto, 'ATELIER', 'nouveau', _note)
      returning id into _lid;
    else
      update public.leads set notes = concat_ws(E'\n\n', nullif(notes, ''), _note) where id = _lid;
    end if;

    -- La tache : au responsable par defaut des nouvelles demandes ; une seule ouverte par carte.
    _tid := null;
    _owner := public.default_assignee(_company);
    if _owner is not null and not exists (select 1 from public.lead_tasks t where t.lead_id = _lid and t.done_at is null) then
      insert into public.lead_tasks (company_id, lead_id, title, due_at, assigned_to)
      values (_company, _lid, _title, now(), _owner)
      returning id into _tid;
    end if;

    update public.followups set status = 'a_rappeler', crm_card_id = _lid, crm_task_id = _tid where id = f.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
    values (_company, auth.uid(), 'followup_to_call', 'followups', f.id::text,
            case when auth.uid() is null then 'system' else 'screen' end,
            jsonb_build_object('lead_id', _lid, 'task_id', _tid, 'title', _title));
    _n := _n + 1;
  end loop;
  return _n;
end $fn$;
revoke all on function public.followups_j5(uuid) from public, anon;
grant execute on function public.followups_j5(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. La liste de l'ecran (noms, motos et carte en une requete)
-- ---------------------------------------------------------------------
create or replace function public.followups_list(_company uuid)
returns table(
  id uuid, kind text, status text, label text, due_date date, send_at date, sent_at timestamptz,
  answered_at timestamptz, answered_how text, closed_at timestamptz, channel text, to_email text, locale text,
  contact_id uuid, contact_name text, vehicle_id uuid, vehicle_label text, source_id uuid,
  crm_card_id uuid, crm_task_id uuid, last_error text, token uuid, created_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select f.id, f.kind, f.status, f.label, f.due_date, f.send_at, f.sent_at,
         f.answered_at, f.answered_how, f.closed_at, f.channel, f.to_email, f.locale,
         f.contact_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), f.to_email) as contact_name,
         f.vehicle_id,
         nullif(btrim(concat_ws(' ', v.brand, v.model)), '')
           || case when nullif(btrim(v.plate), '') is not null then ' (' || btrim(v.plate) || ')' else '' end as vehicle_label,
         f.source_id, f.crm_card_id, f.crm_task_id, f.last_error, f.token, f.created_at
    from public.followups f
    left join public.contacts c on c.id = f.contact_id
    left join public.vehicles v on v.id = f.vehicle_id
   where f.company_id = _company and public.is_member(_company)
   order by case f.status when 'planifiee' then 0 when 'envoyee' then 1 when 'a_rappeler' then 2 when 'repondue' then 3 else 4 end,
            coalesce(f.send_at, current_date), f.created_at desc
   limit 1000;
$fn$;
revoke all on function public.followups_list(uuid) from public, anon;
grant execute on function public.followups_list(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Tache quotidienne (toutes les societes) : planifier, puis J+5. L'envoi est fait par
--     la fonction Edge `followups-send` (tache pg_cron separee, 15 minutes plus tard).
-- ---------------------------------------------------------------------
create or replace function public.followups_daily()
returns table(company_id uuid, planned integer, updated integer, cancelled integer, to_call integer)
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare c record; p record; _j int;
begin
  if auth.uid() is not null then
    raise exception 'followups_daily: reservee a la tache planifiee' using errcode = '42501';
  end if;
  for c in select x.id from public.companies x order by x.created_at loop
    select * into p from public.followups_plan(c.id);
    _j := public.followups_j5(c.id);
    company_id := c.id; planned := p.planned; updated := p.updated; cancelled := p.cancelled; to_call := _j;
    return next;
  end loop;
end $fn$;
revoke all on function public.followups_daily() from public, anon, authenticated;
grant execute on function public.followups_daily() to service_role;

do $$
begin
  perform cron.schedule('followups-plan', '0 6 * * *', $cron$ select public.followups_daily(); $cron$);
  perform cron.schedule('followups-send', '15 6 * * *', $cron$
    select net.http_post(
      'https://ujmrosbgkvgvwfnuryna.supabase.co/functions/v1/followups-send',
      '{}'::jsonb, '{}'::jsonb,
      jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ));
  $cron$);
exception when others then
  raise notice 'pg_cron followups scheduling skipped: %', sqlerrm;
end $$;
