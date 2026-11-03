-- =====================================================================
-- M10 — RELANCES : SEULES LES ECHEANCES FIABLES DECLENCHENT UN MAIL (CRM012, decision M-87)
-- Constat du 03/11/2026 en production (essai a blanc apres l'import DCS et le recalcul des
-- echeances, 3 364 motos : 2 642 « plan », 223 « dcs_extract », 1 « invoice_g8 ») : `followups_plan`
-- creerait 1 604 relances d'entretien dont 1 470 sur la source « plan » (437 dues aujourd'hui).
-- Or « plan » = ESTIMATION depuis la mise en circulation (6 mois puis tous les 12 mois, fenetre de
-- 180 jours, regle M-73 : « a filtrer dans les relances ») : ce n'est pas une echeance connue.
-- Envoyer « votre entretien est du » a 1 470 clients sur une estimation grossiere n'est pas
-- acceptable.
--
-- REGLE (M-87) : une relance d'entretien automatique ne part que sur une echeance FIABLE. Les
-- sources retenues sont un reglage par societe, `followup_settings.sources`, par defaut
-- or_dms, invoice_g8, client, dcs_extract — SANS « plan ». Un administrateur peut cocher « plan »
-- en connaissance de cause (bandeau de CRM → Relances).
--
-- CE QUE FAIT CETTE MIGRATION
--   1. `followup_settings.sources text[]` (defaut sans « plan », valeurs controlees).
--   2. `followups.source` : la source de l'echeance au moment de la planification (badge de l'ecran),
--      remplie pour les relances existantes depuis `vehicle_maintenance_due`.
--   3. `followup_settings_get` renvoie aussi `sources` ; `followup_settings_set` accepte un tableau
--      (`_sources` null = inchange), trace `events`.
--   4. `followups_plan` ne cree / n'actualise une relance d'entretien que si la source de l'echeance
--      courante est retenue ; les relances encore planifiees dont la source n'est plus retenue
--      passent `annulee` avec le motif `source_non_retenue` (idempotent : deja annulee = rien).
--      Nouvelle colonne de retour `excluded` (echeances ecartees par la source).
--   5. `followups_list` renvoie `source`.
--   6. Les relances deja planifiees en base dont la source n'est pas retenue sont annulees ici aussi
--      (`source_non_retenue`), pour ne pas attendre la planification de 6 h.
--
-- Interventions reportees : pas de source (date fixee au comptoir), pas concernees.
--
-- NON APPLIQUEE. Essai a blanc (begin; / rollback;) :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f <fichier.sql>
-- Application (par le client) :
--   npx supabase@2.117.0 db push --linked --project-ref ujmrosbgkvgvwfnuryna
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Le reglage : les sources d'echeance retenues pour les relances
-- ---------------------------------------------------------------------
alter table public.followup_settings
  add column if not exists sources text[] not null
  default array['or_dms', 'invoice_g8', 'client', 'dcs_extract']::text[];
alter table public.followup_settings drop constraint if exists followup_settings_sources_check;
alter table public.followup_settings add constraint followup_settings_sources_check
  check (sources <@ array['or_dms', 'invoice_g8', 'client', 'dcs_extract', 'plan']::text[]);
comment on column public.followup_settings.sources is
  'CRM012 (M-87) : sources d echeance (vehicle_maintenance_due.source) qui declenchent une relance d entretien. '
  'Defaut sans « plan » : le plan est une estimation depuis la mise en circulation, pas une echeance connue.';

-- ---------------------------------------------------------------------
-- 2. La source de l'echeance sur la relance
-- ---------------------------------------------------------------------
alter table public.followups add column if not exists source text;
alter table public.followups drop constraint if exists followups_source_check;
alter table public.followups add constraint followups_source_check
  check (source is null or source in ('or_dms', 'invoice_g8', 'client', 'dcs_extract', 'plan'));
comment on column public.followups.source is
  'CRM012 : source de l echeance d entretien au moment de la planification (or_dms, invoice_g8, client, dcs_extract, plan). Null pour une intervention reportee ou une relance manuelle.';

-- Relances d'entretien deja en base : on relit la source de l'echeance courante de la moto.
update public.followups f
   set source = d.source
  from (
    select distinct on (x.vehicle_id) x.vehicle_id, x.source
      from public.vehicle_maintenance_due x
     where x.is_current
     order by x.vehicle_id, x.due_date nulls last
  ) d
 where f.kind = 'entretien' and f.source is null and d.vehicle_id = f.vehicle_id;

-- ---------------------------------------------------------------------
-- 3. Lire et changer le reglage (le type de retour change : drop puis create)
-- ---------------------------------------------------------------------
drop function if exists public.followup_settings_get(uuid);
create or replace function public.followup_settings_get(_company uuid)
returns table(mode text, test_recipient text, sources text[], updated_at timestamptz, updated_by uuid)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(s.mode, 'arrete') as mode, s.test_recipient,
         coalesce(s.sources, array['or_dms', 'invoice_g8', 'client', 'dcs_extract']::text[]) as sources,
         s.updated_at, s.updated_by
    from (select 1) x
    left join public.followup_settings s on s.company_id = _company
   where auth.uid() is null or public.is_member(_company);
$fn$;
comment on function public.followup_settings_get(uuid) is
  'CRM011 / CRM012 : mode effectif des relances (arrete sans ligne) et sources d echeance retenues (defaut sans plan). Membre, ou cle de service.';
revoke all on function public.followup_settings_get(uuid) from public, anon;
grant execute on function public.followup_settings_get(uuid) to authenticated, service_role;

-- L'ancienne signature a 3 parametres est remplacee (avec des valeurs par defaut, les deux
-- cohabiteraient de facon ambigue pour PostgREST). `_sources` null = inchange.
drop function if exists public.followup_settings_set(uuid, text, text);
create or replace function public.followup_settings_set(
  _company uuid, _mode text, _test_recipient text default null, _sources text[] default null)
returns public.followup_settings
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  old_s  public.followup_settings%rowtype;
  new_s  public.followup_settings%rowtype;
  _rec   text;
  _src   text[];
  _old_src text[];
  _bad   text;
begin
  if not public.is_admin(_company) then
    raise exception 'followup_settings_set: reserve aux administrateurs' using errcode = '42501';
  end if;
  if _mode not in ('arrete', 'test', 'actif') then
    raise exception 'followup_settings_set: mode inconnu %', _mode using errcode = '22023';
  end if;
  _rec := nullif(lower(btrim(coalesce(_test_recipient, ''))), '');
  if _rec is not null and _rec !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$' then
    raise exception 'followup_settings_set: adresse de test invalide' using errcode = '22023';
  end if;
  if _mode = 'test' and _rec is null then
    raise exception 'followup_settings_set: le mode test exige une adresse de test' using errcode = '22023';
  end if;
  select * into old_s from public.followup_settings where company_id = _company;
  _old_src := coalesce(old_s.sources, array['or_dms', 'invoice_g8', 'client', 'dcs_extract']::text[]);
  if _sources is null then
    _src := _old_src;
  else
    -- Nettoyage : doublons retires, ordre de confiance conserve, valeurs inconnues refusees.
    select array_agg(v order by o), min(case when v not in ('or_dms', 'invoice_g8', 'client', 'dcs_extract', 'plan') then v end)
      into _src, _bad
      from (select distinct on (lower(btrim(e))) lower(btrim(e)) as v,
                   array_position(array['or_dms', 'invoice_g8', 'client', 'dcs_extract', 'plan'], lower(btrim(e))) as o
              from unnest(_sources) e where btrim(coalesce(e, '')) <> '') u;
    if _bad is not null then
      raise exception 'followup_settings_set: source inconnue %', _bad using errcode = '22023';
    end if;
    _src := coalesce(_src, '{}'::text[]);
  end if;
  insert into public.followup_settings (company_id, mode, test_recipient, sources, updated_at, updated_by)
  values (_company, _mode, _rec, _src, now(), auth.uid())
  on conflict (company_id) do update
    set mode = excluded.mode, test_recipient = excluded.test_recipient, sources = excluded.sources,
        updated_at = now(), updated_by = auth.uid()
  returning * into new_s;
  if coalesce(old_s.mode, 'arrete') is distinct from _mode or old_s.test_recipient is distinct from _rec
     or _old_src is distinct from _src then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'followup_settings_mode', 'followup_settings', _company::text, 'screen',
            jsonb_build_object('mode', coalesce(old_s.mode, 'arrete'), 'test_recipient', old_s.test_recipient, 'sources', to_jsonb(_old_src)),
            jsonb_build_object('mode', _mode, 'test_recipient', _rec, 'sources', to_jsonb(_src)));
  end if;
  return new_s;
end $fn$;
comment on function public.followup_settings_set(uuid, text, text, text[]) is
  'CRM011 / CRM012 : changer l interrupteur des relances et les sources retenues (administrateurs). _sources null = inchange. Trace events.';
revoke all on function public.followup_settings_set(uuid, text, text, text[]) from public, anon;
grant execute on function public.followup_settings_set(uuid, text, text, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Planifier : seules les echeances dont la source est retenue (le type de retour change)
-- ---------------------------------------------------------------------
drop function if exists public.followups_plan(uuid);
create or replace function public.followups_plan(_company uuid)
returns table(planned integer, updated integer, cancelled integer, excluded integer)
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  r        record;
  _new     int := 0;
  _upd     int := 0;
  _can     int := 0;
  _exc     int := 0;
  _c       int := 0;
  _seen    uuid[] := '{}';
  _skipped uuid[] := '{}';
  _sources text[];
  _fid     uuid;
  _status  text;
  _label   text;
  _send    date;
  _email   text;
  _loc     text;
  _cid     uuid;
  _vid     uuid;
  _src     text;
begin
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'followups_plan: acces refuse' using errcode = '42501';
  end if;
  perform public.followup_templates_seed(_company);

  -- CRM012 : les sources d'echeance retenues (defaut sans « plan »).
  select coalesce(s.sources, array['or_dms', 'invoice_g8', 'client', 'dcs_extract']::text[]) into _sources
    from (select 1) x left join public.followup_settings s on s.company_id = _company;
  _sources := coalesce(_sources, array['or_dms', 'invoice_g8', 'client', 'dcs_extract']::text[]);

  -- A. Entretiens dus (lot « dates d'entretien »). Absent → rien.
  if to_regprocedure('public.vehicles_maintenance_upcoming(uuid,integer)') is not null then
    for r in execute
      'select vehicle_id, model_label, contact_id, email, locale, kind, due_date, due_km, source '
      'from public.vehicles_maintenance_upcoming($1, 200)' using _company
    loop
      continue when r.vehicle_id is null or r.due_date is null or coalesce(r.email, '') = '';
      -- Trop en retard (plus d'un mois) : ce n'est plus une relance, c'est au commercial.
      continue when r.due_date < current_date - 30;
      _vid := r.vehicle_id::uuid;
      _src := nullif(btrim(coalesce(r.source::text, '')), '');
      -- Source non retenue (M-87 : « plan » = estimation) : pas de relance, et celle qui serait
      -- encore planifiee est annulee plus bas (source_non_retenue).
      if _src is not null and not (_src = any(_sources)) then
        _skipped := _skipped || _vid;
        continue;
      end if;
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
                                      due_date, send_at, to_email, locale, source)
        values (_company, 'entretien', _vid, r.contact_id::uuid, _vid, _label,
                r.due_date::date, _send, lower(btrim(r.email)), _loc, _src);
        _new := _new + 1;
      elsif _status = 'planifiee' then
        update public.followups f
           set label = _label, due_date = r.due_date::date, send_at = _send,
               to_email = lower(btrim(r.email)), locale = _loc, contact_id = r.contact_id::uuid, source = _src
         where f.id = _fid
           and (f.label is distinct from _label or f.due_date is distinct from r.due_date::date
                or f.send_at <> _send or f.to_email is distinct from lower(btrim(r.email))
                or f.locale <> _loc or f.contact_id is distinct from r.contact_id::uuid
                or f.source is distinct from _src);
        get diagnostics _c = row_count;
        _upd := _upd + _c;
      end if;
    end loop;
    _exc := coalesce(array_length(_skipped, 1), 0);
    -- Source non retenue : la relance non encore envoyee est annulee avec son motif (idempotent :
    -- une relance deja annulee n'est plus `planifiee`). Une relance deja partie suit son cours.
    update public.followups f
       set status = 'annulee', closed_at = now(), last_error = 'source_non_retenue'
     where f.company_id = _company and f.kind = 'entretien' and f.status = 'planifiee'
       and (f.source_id = any(_skipped)
            or (f.source is not null and not (f.source = any(_sources))));
    get diagnostics _c = row_count;
    _can := _can + _c;
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
          jsonb_build_object('planned', _new, 'updated', _upd, 'cancelled', _can, 'excluded', _exc, 'sources', to_jsonb(_sources)));
  return query select _new, _upd, _can, _exc;
end $fn$;
comment on function public.followups_plan(uuid) is
  'M10 : planifie les relances (entretiens dus a -15 j, interventions reportees). CRM012 : une relance d entretien seulement si la source de l echeance est dans followup_settings.sources (defaut sans plan) ; sinon annulee source_non_retenue. excluded = echeances ecartees.';
revoke all on function public.followups_plan(uuid) from public, anon;
grant execute on function public.followups_plan(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. La liste de l'ecran : + source (le type de retour change : drop puis create)
-- ---------------------------------------------------------------------
drop function if exists public.followups_list(uuid);
create or replace function public.followups_list(_company uuid)
returns table(
  id uuid, kind text, status text, label text, due_date date, send_at date, sent_at timestamptz,
  answered_at timestamptz, answered_how text, closed_at timestamptz, channel text, to_email text, locale text,
  contact_id uuid, contact_name text, vehicle_id uuid, vehicle_label text, source_id uuid,
  crm_card_id uuid, crm_task_id uuid, last_error text, token uuid, created_at timestamptz,
  is_test boolean, sent_to text, source text
)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select f.id, f.kind, f.status, f.label, f.due_date, f.send_at, f.sent_at,
         f.answered_at, f.answered_how, f.closed_at, f.channel, f.to_email, f.locale,
         f.contact_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), f.to_email) as contact_name,
         f.vehicle_id,
         nullif(btrim(concat_ws(' ', v.brand, v.model)), '')
           || case when nullif(btrim(v.plate), '') is not null then ' (' || btrim(v.plate) || ')' else '' end as vehicle_label,
         f.source_id, f.crm_card_id, f.crm_task_id, f.last_error, f.token, f.created_at,
         f.is_test, f.sent_to, f.source
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
-- 6. Relances deja planifiees dont la source n'est pas retenue : annulees tout de suite
--    (idempotent : une relance annulee n'est plus `planifiee`).
-- ---------------------------------------------------------------------
update public.followups f
   set status = 'annulee', closed_at = now(), last_error = 'source_non_retenue'
  from (select c.id as company_id,
               coalesce(s.sources, array['or_dms', 'invoice_g8', 'client', 'dcs_extract']::text[]) as sources
          from public.companies c left join public.followup_settings s on s.company_id = c.id) cs
 where f.company_id = cs.company_id and f.kind = 'entretien' and f.status = 'planifiee'
   and f.source is not null and not (f.source = any(cs.sources));
