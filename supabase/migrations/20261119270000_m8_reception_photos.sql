-- =====================================================================
-- M8 — Parcours mecanicien, lot C (19/11/2026) : PHOTOS ET COMMENTAIRES DE RECEPTION. ATE002 B8.
--
-- Demande du client (19/11) : « on ouvre le rdv et d'un bouton ca lance la pointeuse, ca change le
-- statut de l'or, on doit prendre des photos et mettre des commentaires sur la moto ».
--
-- B8 « reception (observations/photos) → OR transmis atelier » : a la reception (OR ne du RDV, ou
-- « Demarrer »), le mecanicien fait une SERIE DE PHOTOS GUIDEE, chaque photo peut porter un
-- commentaire, plus un commentaire general sur l'etat de la moto.
--
--  1. Reglage atelier `workshop_planning_settings.reception_photo_slots` : la serie par defaut
--     (code, obligatoire, libelle pour une photo ajoutee par l'atelier). Vide = serie d'usine :
--     avant, arriere, gauche, droite, compteur (km), plaque / VIN. Les photos de degats (libres,
--     en nombre) existent toujours en plus (code reserve `degat`). Ecriture par
--     `workshop_reception_settings_set` (droits des reglages atelier, tracee).
--  2. UN SEUL STOCKAGE : le fichier est dans la GED de l'OR (bucket `ged`, table `attachments`,
--     dossier « Réception »), comme le check-up et le dossier accident. Cette migration ne cree
--     AUCUN stockage : `repair_order_reception_photos` ne fait que ranger la photo dans la serie
--     (case, commentaire, qui, quand) et la rattacher a la MOTO (historique de la fiche moto).
--     Supprimer la piece de la GED retire la photo de la serie (cle etrangere en cascade, tracee).
--  3. `repair_order_receptions` : une ligne par OR, commentaire general, etat (en cours /
--     terminee / « Plus tard ») et photos obligatoires manquantes au moment de l'enregistrement.
--     Une photo obligatoire manquante n'empeche JAMAIS de continuer : elle est signalee.
--  4. Ecritures uniquement par fonctions (regles + trace `events` en une transaction) :
--     repair_order_reception_photo_add / _comment / _remove, repair_order_reception_save.
--     Memes droits que l'OR (can_write_table repair_orders) ; lecture : memes droits que l'OR.
--
-- RLS : politiques ecrites dans le style rls_* (rls_writable_companies, migration 20261119230000) :
-- pas besoin de relancer rls_perf_rewrite_all().
-- Additive, rejouable (if not exists, create or replace, drop ... if exists). Aucune donnee existante
-- modifiee. NON APPLIQUEE (Simon applique en bloc). Essai a blanc : supabase/tests/m8_reception_photos.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Reglage : la serie de photos de la reception
-- ---------------------------------------------------------------------
alter table public.workshop_planning_settings
  add column if not exists reception_photo_slots jsonb;
comment on column public.workshop_planning_settings.reception_photo_slots is
  'Lot C parcours mecanicien : serie de photos de reception [{code, required, label?}] dans l''ordre de prise. NULL = serie d''usine (workshop_reception_default_slots). Les photos de degats (code degat) sont toujours possibles en plus.';

create or replace function public.workshop_reception_default_slots()
returns jsonb language sql immutable as $$
  select '[{"code":"face_avant","required":true},{"code":"face_arriere","required":true},{"code":"cote_gauche","required":true},{"code":"cote_droit","required":true},{"code":"compteur","required":true},{"code":"plaque_vin","required":true}]'::jsonb;
$$;
grant execute on function public.workshop_reception_default_slots() to authenticated;

-- La serie de la societe (reglage, sinon serie d'usine).
create or replace function public.workshop_reception_slots(_company uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select s.reception_photo_slots from public.workshop_planning_settings s
      where s.company_id = _company and jsonb_typeof(s.reception_photo_slots) = 'array'),
    public.workshop_reception_default_slots());
$$;
revoke all on function public.workshop_reception_slots(uuid) from public, anon;
grant execute on function public.workshop_reception_slots(uuid) to authenticated;

create or replace function public.workshop_reception_settings_set(_company uuid, _slots jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _old jsonb; _out jsonb := '[]'::jsonb; e jsonb; _code text; _label text; _seen text[] := '{}';
begin
  if not public.can_write_table(_company, 'workshop_planning_settings') then
    raise exception 'Accès refusé : réglages de l''atelier.' using errcode = '42501';
  end if;
  if _slots is null then
    _out := null;  -- retour a la serie d'usine
  else
    if jsonb_typeof(_slots) <> 'array' then
      raise exception 'Série de photos : liste attendue.' using errcode = '22023';
    end if;
    if jsonb_array_length(_slots) > 20 then
      raise exception 'Série de photos : 20 photos au plus.' using errcode = '22023';
    end if;
    for e in select value from jsonb_array_elements(_slots) loop
      _code := lower(btrim(coalesce(e->>'code', '')));
      _label := nullif(btrim(coalesce(e->>'label', '')), '');
      if _code !~ '^[a-z0-9_]{1,40}$' or _code = 'degat' then
        raise exception 'Série de photos : code invalide « % » (lettres, chiffres, _ ; « degat » est réservé).', _code using errcode = '22023';
      end if;
      if _code = any(_seen) then
        raise exception 'Série de photos : le code « % » est en double.', _code using errcode = '22023';
      end if;
      if _label is not null and length(_label) > 60 then
        raise exception 'Série de photos : libellé trop long (60 caractères).' using errcode = '22023';
      end if;
      if _label is null and not exists (select 1 from jsonb_array_elements(public.workshop_reception_default_slots()) d where d->>'code' = _code) then
        raise exception 'Série de photos : la photo « % » ajoutée par l''atelier doit avoir un libellé.', _code using errcode = '22023';
      end if;
      _seen := _seen || _code;
      _out := _out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'code', _code, 'required', coalesce((e->>'required')::boolean, true), 'label', _label)));
    end loop;
  end if;
  select s.reception_photo_slots into _old from public.workshop_planning_settings s where s.company_id = _company;
  insert into public.workshop_planning_settings (company_id, reception_photo_slots)
  values (_company, _out)
  on conflict (company_id) do update set reception_photo_slots = excluded.reception_photo_slots, updated_at = now();
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'workshop_reception_settings_changed', 'workshop_planning_settings', _company::text, 'screen',
          jsonb_build_object('reception_photo_slots', _old), jsonb_build_object('reception_photo_slots', _out));
  return public.workshop_reception_slots(_company);
end $$;
revoke all on function public.workshop_reception_settings_set(uuid, jsonb) from public, anon;
grant execute on function public.workshop_reception_settings_set(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Reception de l'OR (commentaire general, etat) et photos de la serie
-- ---------------------------------------------------------------------
create table if not exists public.repair_order_receptions (
  id               uuid not null default gen_random_uuid() unique,
  or_id            uuid primary key references public.repair_orders(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete restrict,
  vehicle_id       uuid references public.vehicles(id) on delete set null,
  general_comment  text,
  status           text not null default 'en_cours',
  missing_required text[] not null default '{}',
  completed_at     timestamptz,
  completed_by     uuid references auth.users(id) on delete set null,
  postponed_at     timestamptz,
  postponed_by     uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint repair_order_receptions_status_chk check (status in ('en_cours', 'complete', 'plus_tard'))
);
comment on table public.repair_order_receptions is
  'Lot C parcours mecanicien : reception de l''OR (B8). Commentaire general sur l''etat de la moto, etat de la serie de photos : en_cours / complete (terminee, meme incomplete) / plus_tard (« Plus tard »), photos obligatoires manquantes au dernier enregistrement. Ecriture : repair_order_reception_save.';
create index if not exists idx_ror_receptions_vehicle on public.repair_order_receptions(vehicle_id);
create index if not exists idx_ror_receptions_company on public.repair_order_receptions(company_id);

create table if not exists public.repair_order_reception_photos (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  or_id         uuid not null references public.repair_orders(id) on delete cascade,
  vehicle_id    uuid references public.vehicles(id) on delete set null,
  slot_code     text not null,
  attachment_id uuid not null references public.attachments(id) on delete cascade,
  storage_path  text not null,
  comment       text,
  taken_by      uuid references auth.users(id) on delete set null,
  taken_by_name text,
  taken_at      timestamptz not null default now(),
  sort_order    integer not null default 0,
  constraint repair_order_reception_photos_slot_chk check (slot_code ~ '^[a-z0-9_]{1,40}$')
);
comment on table public.repair_order_reception_photos is
  'Lot C parcours mecanicien : photo de reception rangee dans la serie (slot_code ; degat = photo libre de degat). Le fichier est la piece de la GED de l''OR (attachments, bucket ged) : aucun second stockage. vehicle_id = historique de la fiche moto.';
create unique index if not exists uq_ror_photo_slot on public.repair_order_reception_photos(or_id, slot_code) where slot_code <> 'degat';
create index if not exists idx_ror_photos_or on public.repair_order_reception_photos(or_id, sort_order);
create index if not exists idx_ror_photos_vehicle on public.repair_order_reception_photos(vehicle_id, taken_at desc);
create index if not exists idx_ror_photos_company on public.repair_order_reception_photos(company_id);
create index if not exists idx_ror_photos_attachment on public.repair_order_reception_photos(attachment_id);

-- Trace generique (couvre aussi la suppression en cascade depuis la GED).
drop trigger if exists trg_ror_photos_audit on public.repair_order_reception_photos;
create trigger trg_ror_photos_audit after insert or update or delete on public.repair_order_reception_photos
  for each row execute function public.audit_row();
drop trigger if exists trg_ror_receptions_audit on public.repair_order_receptions;
create trigger trg_ror_receptions_audit after insert or update or delete on public.repair_order_receptions
  for each row execute function public.audit_row();

-- RLS : lecture avec les droits de l'OR ; ecriture seulement par les fonctions ci-dessous.
alter table public.repair_order_receptions enable row level security;
alter table public.repair_order_reception_photos enable row level security;
drop policy if exists ror_receptions_select on public.repair_order_receptions;
create policy ror_receptions_select on public.repair_order_receptions for select to authenticated
  using (COALESCE((company_id IN (SELECT public.rls_writable_companies('repair_orders'::text))), false));
drop policy if exists ror_photos_select on public.repair_order_reception_photos;
create policy ror_photos_select on public.repair_order_reception_photos for select to authenticated
  using (COALESCE((company_id IN (SELECT public.rls_writable_companies('repair_orders'::text))), false));
revoke insert, update, delete on public.repair_order_receptions from anon, authenticated;
revoke insert, update, delete on public.repair_order_reception_photos from anon, authenticated;
grant select on public.repair_order_receptions to authenticated;
grant select on public.repair_order_reception_photos to authenticated;

-- ---------------------------------------------------------------------
-- 3. Aides
-- ---------------------------------------------------------------------
-- L'OR, ses droits et son etat (interne).
create or replace function public._ror_reception_or(_or uuid)
returns public.repair_orders language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.repair_orders%rowtype;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002'; end if;
  if not public.can_write_table(r.company_id, 'repair_orders') then
    raise exception 'Acces refuse.' using errcode = '42501';
  end if;
  return r;
end $$;
revoke all on function public._ror_reception_or(uuid) from public, anon, authenticated;

-- Photos obligatoires de la serie encore manquantes pour cet OR (codes, dans l'ordre de la serie).
create or replace function public.repair_order_reception_missing(_or uuid)
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(s.value->>'code' order by s.ordinality), '{}')
    from public.repair_orders o
    cross join lateral jsonb_array_elements(public.workshop_reception_slots(o.company_id)) with ordinality s
   where o.id = _or
     and public.can_write_table(o.company_id, 'repair_orders')
     and coalesce((s.value->>'required')::boolean, true)
     and not exists (select 1 from public.repair_order_reception_photos p where p.or_id = o.id and p.slot_code = s.value->>'code');
$$;
revoke all on function public.repair_order_reception_missing(uuid) from public, anon;
grant execute on function public.repair_order_reception_missing(uuid) to authenticated;

-- Nom affiche de l'utilisateur courant.
create or replace function public._current_user_name()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(p.full_name), ''), p.email) from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public._current_user_name() from public, anon, authenticated;

create or replace function public._ror_reception_touch(r public.repair_orders)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.repair_order_receptions (or_id, company_id, vehicle_id)
  values (r.id, r.company_id, r.vehicle_id)
  on conflict (or_id) do update set vehicle_id = coalesce(excluded.vehicle_id, public.repair_order_receptions.vehicle_id), updated_at = now();
end $$;
revoke all on function public._ror_reception_touch(public.repair_orders) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Ecritures
-- ---------------------------------------------------------------------
-- Range une photo deja deposee dans la GED de l'OR dans la serie (case `_slot`, ou `degat`).
-- Une photo de case deja prise est REMPLACEE : la reponse donne la piece de GED remplacee, que
-- l'ecran retire de la GED (meme chemin de suppression que la GED).
create or replace function public.repair_order_reception_photo_add(
  _or uuid, _attachment uuid, _slot text, _comment text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.repair_orders%rowtype;
  a public.attachments%rowtype;
  _code text := lower(btrim(coalesce(_slot, '')));
  _old public.repair_order_reception_photos%rowtype;
  _id uuid; _sort integer;
begin
  r := public._ror_reception_or(_or);
  if r.status in ('facture', 'annule') then
    raise exception 'OR % : reception close (statut %).', coalesce(r.number, r.id::text), r.status using errcode = '23514';
  end if;
  select * into a from public.attachments where id = _attachment;
  if not found or a.company_id <> r.company_id or a.entity_type <> 'repair_order' or a.entity_id <> r.id then
    raise exception 'Photo : la piece doit etre dans la GED de cet OR.' using errcode = '22023';
  end if;
  if coalesce(a.content_type, '') <> '' and a.content_type not like 'image/%' then
    raise exception 'Photo : la piece n''est pas une image.' using errcode = '22023';
  end if;
  if _code <> 'degat' and not exists (
    select 1 from jsonb_array_elements(public.workshop_reception_slots(r.company_id)) s where s->>'code' = _code
  ) then
    raise exception 'Photo : case « % » absente de la serie de reception.', _code using errcode = '22023';
  end if;

  perform public._ror_reception_touch(r);

  if _code <> 'degat' then
    select * into _old from public.repair_order_reception_photos where or_id = r.id and slot_code = _code for update;
    if found then delete from public.repair_order_reception_photos where id = _old.id; end if;
  end if;
  select coalesce(max(sort_order), 0) + 1 into _sort from public.repair_order_reception_photos where or_id = r.id;

  insert into public.repair_order_reception_photos
    (company_id, or_id, vehicle_id, slot_code, attachment_id, storage_path, comment, taken_by, taken_by_name, sort_order)
  values (r.company_id, r.id, r.vehicle_id, _code, a.id, a.storage_path, nullif(btrim(coalesce(_comment, '')), ''),
          auth.uid(), public._current_user_name(), coalesce(_old.sort_order, _sort))
  returning id into _id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), case when _old.id is null then 'repair_order_reception_photo_added' else 'repair_order_reception_photo_replaced' end,
          'repair_orders', r.id::text, 'screen',
          case when _old.id is not null then jsonb_build_object('photo_id', _old.id, 'attachment_id', _old.attachment_id) end,
          jsonb_build_object('photo_id', _id, 'slot', _code, 'attachment_id', a.id, 'vehicle_id', r.vehicle_id));

  return jsonb_build_object('photo_id', _id, 'replaced_attachment_id', _old.attachment_id,
                            'missing', to_jsonb(public.repair_order_reception_missing(r.id)));
end $$;
revoke all on function public.repair_order_reception_photo_add(uuid, uuid, text, text) from public, anon;
grant execute on function public.repair_order_reception_photo_add(uuid, uuid, text, text) to authenticated;

create or replace function public.repair_order_reception_photo_comment(_photo uuid, _comment text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.repair_order_reception_photos%rowtype; r public.repair_orders%rowtype; _new text := nullif(btrim(coalesce(_comment, '')), '');
begin
  select * into p from public.repair_order_reception_photos where id = _photo for update;
  if not found then raise exception 'Photo introuvable.' using errcode = 'P0002'; end if;
  r := public._ror_reception_or(p.or_id);
  if p.comment is not distinct from _new then return jsonb_build_object('photo_id', p.id, 'changed', false); end if;
  update public.repair_order_reception_photos set comment = _new where id = p.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'repair_order_reception_photo_commented', 'repair_orders', r.id::text, 'screen',
          jsonb_build_object('photo_id', p.id, 'comment', p.comment), jsonb_build_object('photo_id', p.id, 'comment', _new));
  return jsonb_build_object('photo_id', p.id, 'changed', true);
end $$;
revoke all on function public.repair_order_reception_photo_comment(uuid, text) from public, anon;
grant execute on function public.repair_order_reception_photo_comment(uuid, text) to authenticated;

-- Retire la photo de la serie ; la reponse donne la piece de GED a retirer (meme suppression que la GED).
create or replace function public.repair_order_reception_photo_remove(_photo uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.repair_order_reception_photos%rowtype; r public.repair_orders%rowtype;
begin
  select * into p from public.repair_order_reception_photos where id = _photo for update;
  if not found then return jsonb_build_object('status', 'none'); end if;
  r := public._ror_reception_or(p.or_id);
  delete from public.repair_order_reception_photos where id = p.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'repair_order_reception_photo_removed', 'repair_orders', r.id::text, 'screen',
          jsonb_build_object('photo_id', p.id, 'slot', p.slot_code, 'attachment_id', p.attachment_id, 'comment', p.comment), null);
  return jsonb_build_object('status', 'removed', 'attachment_id', p.attachment_id,
                            'missing', to_jsonb(public.repair_order_reception_missing(r.id)));
end $$;
revoke all on function public.repair_order_reception_photo_remove(uuid) from public, anon;
grant execute on function public.repair_order_reception_photo_remove(uuid) to authenticated;

-- Commentaire general + etat : 'save' (enregistrer), 'complete' (terminer la reception, meme avec
-- des photos obligatoires manquantes : elles restent signalees), 'later' (« Plus tard »).
create or replace function public.repair_order_reception_save(_or uuid, _comment text default null, _action text default 'save')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.repair_orders%rowtype; old public.repair_order_receptions%rowtype; n public.repair_order_receptions%rowtype;
  _missing text[]; _act text := coalesce(nullif(btrim(coalesce(_action, '')), ''), 'save');
begin
  if _act not in ('save', 'complete', 'later') then
    raise exception 'Reception : action inconnue (%).', _act using errcode = '22023';
  end if;
  r := public._ror_reception_or(_or);
  if r.status in ('facture', 'annule') then
    raise exception 'OR % : reception close (statut %).', coalesce(r.number, r.id::text), r.status using errcode = '23514';
  end if;
  perform public._ror_reception_touch(r);
  select * into old from public.repair_order_receptions where or_id = r.id for update;
  _missing := public.repair_order_reception_missing(r.id);
  update public.repair_order_receptions
     set general_comment = case when _comment is null then general_comment else nullif(btrim(_comment), '') end,
         missing_required = _missing,
         status = case _act when 'complete' then 'complete' when 'later' then 'plus_tard' else status end,
         completed_at = case when _act = 'complete' then now() else completed_at end,
         completed_by = case when _act = 'complete' then auth.uid() else completed_by end,
         postponed_at = case when _act = 'later' then now() else postponed_at end,
         postponed_by = case when _act = 'later' then auth.uid() else postponed_by end,
         updated_at = now()
   where or_id = r.id
  returning * into n;
  if _act <> 'save' or old.general_comment is distinct from n.general_comment then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (r.company_id, auth.uid(),
            case _act when 'complete' then 'repair_order_reception_completed' when 'later' then 'repair_order_reception_postponed' else 'repair_order_reception_commented' end,
            'repair_orders', r.id::text, 'screen',
            jsonb_build_object('status', old.status, 'general_comment', old.general_comment),
            jsonb_build_object('status', n.status, 'general_comment', n.general_comment, 'missing_required', to_jsonb(_missing)));
  end if;
  return jsonb_build_object('status', n.status, 'missing', to_jsonb(_missing));
end $$;
revoke all on function public.repair_order_reception_save(uuid, text, text) from public, anon;
grant execute on function public.repair_order_reception_save(uuid, text, text) to authenticated;
