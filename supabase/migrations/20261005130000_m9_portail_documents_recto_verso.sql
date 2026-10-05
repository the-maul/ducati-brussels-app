-- =====================================================================
-- MISSION 01 / M09 — ESPACE CLIENT : DOCUMENTS RECTO-VERSO, SUPPRESSION,
-- LIMITE DE TAILLE, PLUSIEURS « AUTRES DOCUMENTS », MOTO DÉJÀ ENREGISTRÉE.
--
-- Retour de Simon du 05/10 (carte « Espace client : mes motos, entretiens et
-- factures »), 7 points. Migration ADDITIVE et non destructive :
--
--  1. CARTE D'IDENTITÉ : deux nouveaux types de dépôt `carte_identite` et
--     `carte_identite_verso`, rangés sur la fiche du client comme le permis.
--  2. RECTO ET VERSO POUR TOUS : types `*_verso` ajoutés pour la carte grise,
--     l'assurance, le COC et le contrôle technique. Un document n'est complet
--     que si les deux faces sont déposées, OU si le client a cliqué
--     « pas de verso » (table `portal_doc_no_back`) : on ne bloque jamais un
--     client dont le document n'a réellement qu'une face.
--  3. MOTO « EN ATTENTE DE VALIDATION » alors que la fiche DMS est complète.
--     CAUSE : `declared_vehicles_pending` ne rapproche une déclaration d'une
--     moto existante que par VIN ou par plaque. Les déclarations venues du
--     questionnaire d'inscription (`source = 'web'`) n'ont NI VIN NI plaque :
--     aucun rapprochement possible, la déclaration restait « à valider » même
--     quand la moto était déjà au nom du client dans le parc. De plus le modèle
--     du parc porte la couleur (« STREETFIGHTER V2 S | RED ») : une comparaison
--     brute du modèle échouait aussi.
--     CORRECTIF : `vehicle_model_normalize` (majuscules, on coupe à « | », on ne
--     garde que lettres et chiffres) + `_declared_vehicle_owned_match` qui ne
--     regarde QUE les motos DÉJÀ au nom du client (vehicle_owners.is_current) —
--     jamais la moto d'un autre client — et rapproche par VIN, par plaque, ou
--     par marque + modèle normalisé (+ année quand elle est connue).
--     `_declared_vehicle_autoresolve` passe alors la déclaration en
--     « rattachee », recopie la carte grise déposée sur la moto et trace dans
--     events (origine `system`). Déclenché : à l'insertion d'une déclaration,
--     et dès qu'un lien de propriété est créé (la fiche DMS est complétée
--     APRÈS la déclaration — c'est le cas rencontré). Rattrapage des lignes
--     existantes à la fin de cette migration.
--  4. VOIR ET SUPPRIMER SES DOCUMENTS : `portal_delete_upload` marque le dépôt
--     supprimé (`deleted_at`, `deleted_by`), retire l'entrée de la GED du
--     personnel (`attachments`) et trace dans events. Le fichier lui-même est
--     retiré du stockage par le navigateur juste après, autorisé par la
--     nouvelle politique `ged_portal_delete` (prédicat
--     `portal_can_delete_object`, fenêtre d'une heure après le marquage).
--     Si cet effacement échoue, le dépôt reste marqué supprimé : plus personne
--     ne le voit ni ne peut le relire (le prédicat de lecture exclut les
--     dépôts supprimés).
--  5. FICHIERS TROP LOURDS : limite ramenée de 15 Mo à 10 Mo dans
--     `portal_prepare_upload`, `portal_complete_upload` et
--     `portal_prepare_declaration_upload`. Le navigateur réduit les images à
--     1 200 px avant l'envoi et annonce la limite AVANT de choisir le fichier.
--     Le bucket « ged » n'a aucune limite propre (storage.buckets.file_size_limit
--     est NULL) : la limite réelle est celle du projet. C'est donc la base qui
--     fait foi ici.
--  6. PLUSIEURS « AUTRES DOCUMENTS » : colonne `label` sur portal_uploads +
--     `portal_set_upload_label` (libellé saisi par le client). Le type `autre`
--     accepte autant de fichiers que voulu, chacun avec son libellé.
--  7. MINIATURES : rien à faire en base — le portail affiche l'image réduite
--     via une URL signée. Pour un PDF, une icône de type de fichier (pas de
--     dépendance pdf.js dans le projet : la première page n'est pas « faisable
--     simplement »).
--
-- SÉCURITÉ : aucune nouvelle table ouverte au client. Tout passe par des
-- fonctions `portal_*` SECURITY DEFINER qui retrouvent le client par
-- `_portal_ctx()` (contact_accounts.user_id = auth.uid()) ; aucun identifiant
-- venu du navigateur n'est cru sur parole.
--
-- À VÉRIFIER AVANT D'APPLIQUER (dérive code/base) : les fonctions redéfinies
-- ici le sont à partir de leur dernière version du dépôt —
-- `portal_prepare_upload`, `portal_profile` et `portal_home` depuis
-- 20260921160000, `portal_vehicles`, `portal_vehicle`, `portal_complete_upload`,
-- `portal_can_read_object` et `_portal_last_upload` depuis 20260919120000,
-- `portal_prepare_declaration_upload` et `trg_notify_team_vehicle_declared`
-- depuis 20260919302000. Si la base contient une version plus récente
-- (`pg_get_functiondef`), reporter la différence avant d'appliquer.
-- =====================================================================

-- ------------------------------------------------ 1. Types de dépôt
-- Reconstruite avec les types en place + carte d'identité + les faces verso.
do $do$
declare _c record;
begin
  for _c in
    select conname from pg_constraint
     where conrelid = 'public.portal_uploads'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.portal_uploads drop constraint %I', _c.conname);
  end loop;
  alter table public.portal_uploads add constraint portal_uploads_kind_check
    check (kind in ('avatar',
                    'permis', 'permis_verso',
                    'carte_identite', 'carte_identite_verso',
                    'vehicle_photo',
                    'carte_grise', 'carte_grise_verso',
                    'assurance', 'assurance_verso',
                    'coc', 'coc_verso',
                    'controle_technique', 'controle_technique_verso',
                    'autre'));
end $do$;
comment on column public.portal_uploads.kind is
  'Type de dépôt. Chaque document a une face recto (`permis`, `carte_identite`, '
  '`carte_grise`, `assurance`, `coc`, `controle_technique`) et sa face verso `*_verso` '
  '(retour Simon 05/10). `autre` : plusieurs fichiers possibles, chacun avec son `label`.';

-- ------------------------------------------------ 2. Libellé et suppression
alter table public.portal_uploads add column if not exists label text;
alter table public.portal_uploads add column if not exists deleted_at timestamptz;
alter table public.portal_uploads add column if not exists deleted_by uuid
  references auth.users(id) on delete set null;

comment on column public.portal_uploads.label is
  'Libellé saisi par le client (type `autre` : « facture d''origine », « notice »…).';
comment on column public.portal_uploads.deleted_at is
  'Dépôt supprimé par le client depuis son espace : plus visible, plus lisible, '
  'fichier retiré du stockage. La ligne et l''événement restent pour la traçabilité.';

-- Les dépôts vivants d'un client, par type : index utile aux fonctions ci-dessous.
create index if not exists idx_portal_uploads_live
  on public.portal_uploads (contact_id, entity_type, entity_id, kind, completed_at desc)
  where completed_at is not null and deleted_at is null;

-- ------------------------------------------------ 3. « Pas de verso »
-- Un document qui n'a réellement qu'une face (vieille carte grise, attestation
-- d'assurance d'une page…) : le client le déclare, l'étape est alors complète.
create table if not exists public.portal_doc_no_back (
  company_id  uuid not null references public.companies(id) on delete restrict,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  entity_type text not null check (entity_type in ('contact', 'vehicle')),
  entity_id   uuid not null,
  kind        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  primary key (contact_id, entity_type, entity_id, kind)
);
comment on table public.portal_doc_no_back is
  'Retour Simon 05/10 : « ce document n''a pas de verso », déclaré par le client dans '
  'son espace. Évite de bloquer une étape du profil sur une face qui n''existe pas.';
alter table public.portal_doc_no_back enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'portal_doc_no_back' and policyname = 'portal_doc_no_back_member_read') then
    create policy portal_doc_no_back_member_read on public.portal_doc_no_back
      for select to authenticated using (public.is_member(company_id));
  end if;
end $do$;

-- ------------------------------------------------ 4. Aides internes
-- Dernier fichier VIVANT d'un type donné (les dépôts supprimés sont ignorés).
create or replace function public._portal_last_upload(_contact uuid, _entity uuid, _kind text)
returns text language sql stable security definer set search_path = public, pg_temp as $fn$
  select pu.storage_path from public.portal_uploads pu
  where pu.contact_id = _contact and pu.entity_id = _entity and pu.kind = _kind
    and pu.completed_at is not null and pu.deleted_at is null
  order by pu.completed_at desc limit 1;
$fn$;
revoke all on function public._portal_last_upload(uuid, uuid, text) from public, anon, authenticated;

-- Tous les dépôts vivants d'une entité du client, avec ce qu'il faut pour les
-- afficher (miniature), les ouvrir et les supprimer.
create or replace function public._portal_files(_contact uuid, _entity_type text, _entity uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pu.id, 'kind', pu.kind, 'file_name', pu.file_name, 'label', pu.label,
      'content_type', pu.content_type, 'path', pu.storage_path,
      'size_bytes', pu.size_bytes, 'created_at', pu.completed_at)
      order by pu.completed_at desc), '[]'::jsonb)
  from public.portal_uploads pu
  where pu.contact_id = _contact and pu.entity_type = _entity_type and pu.entity_id = _entity
    and pu.completed_at is not null and pu.deleted_at is null;
$fn$;
revoke all on function public._portal_files(uuid, text, uuid) from public, anon, authenticated;

-- Types pour lesquels le client a déclaré « pas de verso ».
create or replace function public._portal_no_back(_contact uuid, _entity_type text, _entity uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(jsonb_agg(nb.kind order by nb.kind), '[]'::jsonb)
  from public.portal_doc_no_back nb
  where nb.contact_id = _contact and nb.entity_type = _entity_type and nb.entity_id = _entity;
$fn$;
revoke all on function public._portal_no_back(uuid, text, uuid) from public, anon, authenticated;

-- Un document recto-verso est-il complet ? recto déposé ET (verso déposé OU « pas de verso »).
create or replace function public._portal_doc_complete(
  _contact uuid, _entity_type text, _entity uuid, _kind text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select public._portal_last_upload(_contact, _entity, _kind) is not null
     and (public._portal_last_upload(_contact, _entity, _kind || '_verso') is not null
          or exists (select 1 from public.portal_doc_no_back nb
                      where nb.contact_id = _contact and nb.entity_type = _entity_type
                        and nb.entity_id = _entity and nb.kind = _kind));
$fn$;
revoke all on function public._portal_doc_complete(uuid, text, uuid, text) from public, anon, authenticated;

-- ------------------------------------------------ 5. Dépôt : nouveaux types, 10 Mo
create or replace function public.portal_prepare_upload(
  p_kind text, p_vehicle_id uuid, p_file_name text, p_content_type text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  _ctx record; _id uuid := gen_random_uuid(); _entity_type text; _entity uuid; _ext text; _path text; _recent int;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;

  if p_kind in ('avatar', 'permis', 'permis_verso', 'carte_identite', 'carte_identite_verso') then
    _entity_type := 'contact'; _entity := _ctx.contact_id;
  elsif p_kind in ('vehicle_photo', 'carte_grise', 'carte_grise_verso', 'assurance', 'assurance_verso',
                   'coc', 'coc_verso', 'controle_technique', 'controle_technique_verso', 'autre') then
    if p_vehicle_id is null or not public._portal_owns_vehicle(_ctx.contact_id, _ctx.company_id, p_vehicle_id) then
      raise exception 'portal: vehicle not found' using errcode = 'P0002';
    end if;
    _entity_type := 'vehicle'; _entity := p_vehicle_id;
  else
    raise exception 'portal: invalid kind' using errcode = '22023';
  end if;

  _ext := case lower(coalesce(p_content_type, ''))
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'image/heic' then 'heic' when 'image/heif' then 'heif' when 'application/pdf' then 'pdf' end;
  if _ext is null then raise exception 'portal: file type not allowed' using errcode = '22023'; end if;
  if p_kind in ('avatar', 'vehicle_photo') and _ext = 'pdf' then
    raise exception 'portal: a photo is expected' using errcode = '22023';
  end if;
  -- Retour Simon 05/10 : 10 Mo au maximum (un PDF de 15 Mo passait).
  if p_size is null or p_size <= 0 or p_size > 10 * 1024 * 1024 then
    raise exception 'portal: file too large' using errcode = '22023';
  end if;
  select count(*) into _recent from public.portal_uploads
  where user_id = auth.uid() and created_at > now() - interval '24 hours';
  if _recent >= 40 then raise exception 'portal: too many uploads' using errcode = '54000'; end if;

  _path := _ctx.company_id::text || '/' || _entity_type || '/' || _entity::text || '/portail_' || _id::text || '.' || _ext;
  insert into public.portal_uploads (id, company_id, contact_id, user_id, entity_type, entity_id, kind,
    storage_path, file_name, content_type, size_bytes)
  values (_id, _ctx.company_id, _ctx.contact_id, auth.uid(), _entity_type, _entity, p_kind, _path,
    left(coalesce(nullif(trim(p_file_name), ''), p_kind || '.' || _ext), 150), lower(p_content_type), p_size);
  return jsonb_build_object('upload_id', _id, 'path', _path);
end $fn$;

-- Même limite à l'indexation (le fichier réellement reçu fait foi).
create or replace function public.portal_complete_upload(p_upload_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _ctx record; _u record; _meta jsonb; _att uuid; _size bigint; _mime text;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select * into _u from public.portal_uploads
  where id = p_upload_id and user_id = auth.uid() and contact_id = _ctx.contact_id and company_id = _ctx.company_id;
  if _u.id is null then raise exception 'portal: upload not found' using errcode = 'P0002'; end if;
  if _u.deleted_at is not null then raise exception 'portal: upload not found' using errcode = 'P0002'; end if;
  if _u.completed_at is not null then return jsonb_build_object('attachment_id', _u.attachment_id, 'path', _u.storage_path); end if;

  select o.metadata into _meta from storage.objects o where o.bucket_id = 'ged' and o.name = _u.storage_path;
  if _meta is null then raise exception 'portal: file not received' using errcode = 'P0002'; end if;
  _size := nullif(_meta->>'size', '')::bigint;
  _mime := lower(coalesce(_meta->>'mimetype', ''));
  if _size is null or _size > 10 * 1024 * 1024 then raise exception 'portal: file too large' using errcode = '22023'; end if;
  if _mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf') then
    raise exception 'portal: file type not allowed' using errcode = '22023';
  end if;

  insert into public.attachments (company_id, entity_type, entity_id, file_name, storage_path, content_type,
    size_bytes, note, uploaded_by, folder)
  values (_u.company_id, _u.entity_type, _u.entity_id, _u.file_name, _u.storage_path, _mime,
    _size, 'portail:' || _u.kind, auth.uid(), 'Portail client')
  returning id into _att;
  update public.portal_uploads set completed_at = now(), attachment_id = _att, size_bytes = _size, content_type = _mime
  where id = _u.id;
  return jsonb_build_object('attachment_id', _att, 'path', _u.storage_path);
end $fn$;

-- Libellé d'un « autre document », saisi par le client (point 6).
create or replace function public.portal_set_upload_label(p_upload_id uuid, p_label text)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _ctx record; _n int;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  update public.portal_uploads
     set label = left(nullif(btrim(coalesce(p_label, '')), ''), 120)
   where id = p_upload_id and contact_id = _ctx.contact_id and company_id = _ctx.company_id
     and deleted_at is null;
  get diagnostics _n = row_count;
  if _n = 0 then raise exception 'portal: upload not found' using errcode = 'P0002'; end if;
end $fn$;

-- « Ce document n'a pas de verso » (point 2). p_kind est le type RECTO.
create or replace function public.portal_set_doc_no_back(
  p_kind text, p_vehicle_id uuid, p_no_back boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _ctx record; _entity_type text; _entity uuid;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  if p_kind in ('permis', 'carte_identite') then
    _entity_type := 'contact'; _entity := _ctx.contact_id;
  elsif p_kind in ('carte_grise', 'assurance', 'coc', 'controle_technique') then
    if p_vehicle_id is null or not public._portal_owns_vehicle(_ctx.contact_id, _ctx.company_id, p_vehicle_id) then
      raise exception 'portal: vehicle not found' using errcode = 'P0002';
    end if;
    _entity_type := 'vehicle'; _entity := p_vehicle_id;
  else
    raise exception 'portal: invalid kind' using errcode = '22023';
  end if;

  if coalesce(p_no_back, false) then
    insert into public.portal_doc_no_back (company_id, contact_id, entity_type, entity_id, kind, created_by)
    values (_ctx.company_id, _ctx.contact_id, _entity_type, _entity, p_kind, auth.uid())
    on conflict (contact_id, entity_type, entity_id, kind) do nothing;
  else
    delete from public.portal_doc_no_back
     where contact_id = _ctx.contact_id and entity_type = _entity_type
       and entity_id = _entity and kind = p_kind;
  end if;
end $fn$;

-- Suppression d'un document par le client (point 4).
-- La ligne reste (deleted_at / deleted_by) et l'événement est tracé ; l'entrée de
-- la GED du personnel est retirée (le fichier n'existe plus, un lien mort serait pire).
-- Le navigateur efface ensuite l'objet du stockage (politique ged_portal_delete).
create or replace function public.portal_delete_upload(p_upload_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _ctx record; _u record;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select * into _u from public.portal_uploads
   where id = p_upload_id and contact_id = _ctx.contact_id and company_id = _ctx.company_id
     and deleted_at is null
   for update;
  if _u.id is null then raise exception 'portal: upload not found' using errcode = 'P0002'; end if;
  -- Une moto vendue n'est plus la sienne : il ne peut plus toucher à ses documents.
  if _u.entity_type = 'vehicle'
     and not public._portal_owns_vehicle(_ctx.contact_id, _ctx.company_id, _u.entity_id) then
    raise exception 'portal: vehicle not found' using errcode = 'P0002';
  end if;

  delete from public.attachments a where a.storage_path = _u.storage_path and a.company_id = _u.company_id;
  update public.portal_uploads set deleted_at = now(), deleted_by = auth.uid(), attachment_id = null
   where id = _u.id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_u.company_id, auth.uid(), 'portal_upload_deleted', _u.entity_type, _u.entity_id::text, 'portal',
          jsonb_build_object('upload_id', _u.id, 'kind', _u.kind, 'file_name', _u.file_name,
                             'label', _u.label, 'storage_path', _u.storage_path, 'size_bytes', _u.size_bytes),
          jsonb_build_object('deleted', true));
  return jsonb_build_object('path', _u.storage_path);
end $fn$;

-- ------------------------------------------------ 6. Lectures du portail
create or replace function public.portal_profile()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare _ctx record; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select jsonb_build_object(
    'civility', c.civility, 'first_name', c.first_name, 'last_name', c.last_name,
    'email', c.email, 'mobile', c.mobile, 'phone', c.phone,
    'address', c.address, 'street_number', c.street_number, 'address_complement', c.address_complement,
    'zip', c.zip, 'city', c.city, 'country', c.country, 'birth_date', c.birth_date,
    'birth_place', c.birth_place,
    'is_pro', c.type = 'professionnel', 'company_name', c.company_name, 'vat_number', c.vat_number,
    'vies_valid', c.vies_valid, 'iban', c.iban, 'bic', c.bic,
    'contact_preference', c.contact_preference,
    'marketing_opt_out', c.marketing_opt_out, 'license_number', c.license_number,
    'dealer', co.name,
    'avatar_path', public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'avatar'),
    'license_path', public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'permis'),
    'license_back_path', public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'permis_verso'),
    'id_card_path', public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'carte_identite'),
    'id_card_back_path', public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'carte_identite_verso'),
    -- Tous ses dépôts vivants (miniature, ouverture, suppression) et ses « pas de verso ».
    'files', public._portal_files(_ctx.contact_id, 'contact', _ctx.contact_id),
    'no_back', public._portal_no_back(_ctx.contact_id, 'contact', _ctx.contact_id))
  into _r
  from public.contacts c join public.companies co on co.id = c.company_id
  where c.id = _ctx.contact_id and c.company_id = _ctx.company_id;
  return _r;
end $fn$;

create or replace function public.portal_vehicles()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare _ctx record; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'brand', v.brand, 'model', v.model, 'vin', v.vin, 'plate', v.plate,
      'model_year', v.model_year, 'color', v.color, 'mileage', v.mileage,
      'photo_path', public._portal_last_upload(_ctx.contact_id, v.id, 'vehicle_photo'),
      -- Complet = les deux faces (ou « pas de verso » déclaré par le client).
      'has_registration', public._portal_doc_complete(_ctx.contact_id, 'vehicle', v.id, 'carte_grise'),
      'has_insurance', public._portal_doc_complete(_ctx.contact_id, 'vehicle', v.id, 'assurance')
    ) order by vo.from_date desc, v.model), '[]'::jsonb)
  into _r
  from public.vehicle_owners vo
  join public.vehicles v on v.id = vo.vehicle_id
  where vo.contact_id = _ctx.contact_id and vo.is_current and v.company_id = _ctx.company_id;
  return _r;
end $fn$;

create or replace function public.portal_vehicle(p_vehicle_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare _ctx record; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  -- Même réponse qu'il s'agisse d'une moto inexistante ou de celle d'un autre client.
  if p_vehicle_id is null or not public._portal_owns_vehicle(_ctx.contact_id, _ctx.company_id, p_vehicle_id) then
    raise exception 'portal: vehicle not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    -- Liste blanche : ni prix d'achat, ni coût de revient, ni notes internes.
    'id', v.id, 'brand', v.brand, 'model', v.model, 'vin', v.vin, 'plate', v.plate,
    'model_year', v.model_year, 'color', v.color, 'mileage', v.mileage,
    'displacement', v.displacement, 'power_kw', v.power_kw, 'power_cv', v.power_cv,
    'is_restricted', v.is_restricted, 'first_registration_date', v.first_registration_date,
    'next_inspection_date', v.next_inspection_date, 'warranty_start', v.warranty_start,
    'warranty_end', v.warranty_end,
    'photo_path', public._portal_last_upload(_ctx.contact_id, v.id, 'vehicle_photo'),
    -- Réparations : seulement les OR de CE client sur cette moto (pas ceux d'un ancien propriétaire).
    'repairs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ro.id, 'number', ro.number, 'date', ro.created_at, 'status', ro.status,
        'work_description', ro.work_description, 'mileage', ro.mileage,
        'invoice_document_id', ro.invoice_document_id) order by ro.created_at desc)
      from public.repair_orders ro
      where ro.vehicle_id = v.id and ro.contact_id = _ctx.contact_id
        and ro.company_id = _ctx.company_id and ro.status <> 'annule'), '[]'::jsonb),
    -- Entretiens constructeur (My Ducati) : propres à la moto, sans donnée personnelle.
    'maintenance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', m.kind, 'service_type', m.service_type, 'state', m.state, 'km', m.km,
        'event_date', m.event_date, 'due_date', m.due_date, 'dealer', m.dealer)
        order by coalesce(m.event_date, m.due_date) desc nulls last)
      from public.vehicle_maintenance m
      where m.vehicle_id = v.id and m.company_id = _ctx.company_id), '[]'::jsonb),
    -- Documents et photos : uniquement ceux déposés par le client, non supprimés.
    'files', public._portal_files(_ctx.contact_id, 'vehicle', v.id),
    'no_back', public._portal_no_back(_ctx.contact_id, 'vehicle', v.id),
    -- Factures liées à cette moto.
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'doc_type', d.doc_type, 'number', coalesce(d.number, d.legacy_number),
        'issue_date', d.issue_date, 'total_ttc', d.total_ttc) order by d.issue_date desc)
      from public.documents d
      where d.vehicle_id = v.id and d.contact_id = _ctx.contact_id and d.company_id = _ctx.company_id
        and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee')), '[]'::jsonb)
  ) into _r
  from public.vehicles v where v.id = p_vehicle_id and v.company_id = _ctx.company_id;
  return _r;
end $fn$;

-- Accueil : le permis et la carte d'identité comptent recto ET verso (ou « pas de verso »).
create or replace function public.portal_home()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  _ctx record; _c record; _steps jsonb := '[]'::jsonb; _v record; _done int := 0; _total int := 0;
  _next jsonb; _pending int; _nv int; _ni int;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select * into _c from public.contacts where id = _ctx.contact_id;

  _steps := _steps || jsonb_build_object('key', 'coordonnees', 'done',
    coalesce(_c.mobile, _c.phone) is not null and _c.address is not null and _c.zip is not null and _c.city is not null);
  _steps := _steps || jsonb_build_object('key', 'avatar', 'done',
    public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'avatar') is not null);
  _steps := _steps || jsonb_build_object('key', 'preferences', 'done', _c.contact_preference is not null);
  _steps := _steps || jsonb_build_object('key', 'permis', 'done',
    public._portal_doc_complete(_ctx.contact_id, 'contact', _ctx.contact_id, 'permis'));
  -- Retour Simon 05/10 : la carte d'identité, au même rang que le permis.
  _steps := _steps || jsonb_build_object('key', 'carte_identite', 'done',
    public._portal_doc_complete(_ctx.contact_id, 'contact', _ctx.contact_id, 'carte_identite'));
  if _c.type = 'professionnel' then
    _steps := _steps || jsonb_build_object('key', 'societe', 'done', _c.company_name is not null and _c.vat_number is not null);
  end if;
  for _v in
    select v.id, public._portal_vehicle_label(v.id) as label
    from public.vehicle_owners vo join public.vehicles v on v.id = vo.vehicle_id
    where vo.contact_id = _ctx.contact_id and vo.is_current and v.company_id = _ctx.company_id
    order by vo.from_date desc limit 5
  loop
    _steps := _steps
      || jsonb_build_object('key', 'vehicle_photo', 'vehicle_id', _v.id, 'vehicle_label', _v.label, 'done',
           public._portal_last_upload(_ctx.contact_id, _v.id, 'vehicle_photo') is not null)
      || jsonb_build_object('key', 'carte_grise', 'vehicle_id', _v.id, 'vehicle_label', _v.label, 'done',
           public._portal_doc_complete(_ctx.contact_id, 'vehicle', _v.id, 'carte_grise'))
      || jsonb_build_object('key', 'assurance', 'vehicle_id', _v.id, 'vehicle_label', _v.label, 'done',
           public._portal_doc_complete(_ctx.contact_id, 'vehicle', _v.id, 'assurance'));
  end loop;
  select count(*), count(*) filter (where (s->>'done')::boolean) into _total, _done from jsonb_array_elements(_steps) s;

  select jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'status', a.status,
           'work_description', a.work_description,
           'vehicle_label', case when a.vehicle_id is not null then public._portal_vehicle_label(a.vehicle_id) end)
    into _next
  from public.workshop_appointments a
  where a.contact_id = _ctx.contact_id and a.company_id = _ctx.company_id
    and a.status in ('prevu', 'arrive', 'en_cours', 'demande') and a.starts_at >= now() - interval '12 hours'
  order by a.starts_at limit 1;
  select count(*) into _pending from public.workshop_appointments
  where contact_id = _ctx.contact_id and company_id = _ctx.company_id and status = 'demande';
  select count(*) into _nv from public.vehicle_owners vo join public.vehicles v on v.id = vo.vehicle_id
  where vo.contact_id = _ctx.contact_id and vo.is_current and v.company_id = _ctx.company_id;
  select count(*) into _ni from public.documents d
  where d.contact_id = _ctx.contact_id and d.company_id = _ctx.company_id
    and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee');

  return jsonb_build_object(
    'first_name', _c.first_name, 'last_name', _c.last_name, 'company_name', _c.company_name,
    'steps', _steps, 'steps_done', _done, 'steps_total', _total,
    'progress', case when _total = 0 then 100 else round(100.0 * _done / _total) end,
    'vehicles_count', _nv, 'invoices_count', _ni, 'pending_requests', _pending,
    'next_appointment', _next);
end $fn$;

-- ------------------------------------------------ 7. Déclaration de moto : 10 Mo
create or replace function public.portal_prepare_declaration_upload(
  p_declaration_id uuid, p_file_name text, p_content_type text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _ctx record; _id uuid := gen_random_uuid(); _ext text; _path text; _recent int;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  -- Même réponse qu'il s'agisse d'une déclaration inexistante ou de celle d'un autre client.
  if p_declaration_id is null or not exists (
       select 1 from public.contact_declared_vehicles d
        where d.id = p_declaration_id and d.contact_id = _ctx.contact_id
          and d.company_id = _ctx.company_id and d.status = 'a_valider') then
    raise exception 'portal: declaration not found' using errcode = 'P0002';
  end if;
  _ext := case lower(coalesce(p_content_type, ''))
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'image/heic' then 'heic' when 'image/heif' then 'heif' when 'application/pdf' then 'pdf' end;
  if _ext is null then raise exception 'portal: file type not allowed' using errcode = '22023'; end if;
  if p_size is null or p_size <= 0 or p_size > 10 * 1024 * 1024 then
    raise exception 'portal: file too large' using errcode = '22023';
  end if;
  select count(*) into _recent from public.portal_uploads
   where user_id = auth.uid() and created_at > now() - interval '24 hours';
  if _recent >= 40 then raise exception 'portal: too many uploads' using errcode = '54000'; end if;

  _path := _ctx.company_id::text || '/contact/' || _ctx.contact_id::text || '/portail_' || _id::text || '.' || _ext;
  insert into public.portal_uploads (id, company_id, contact_id, user_id, entity_type, entity_id, kind,
    storage_path, file_name, content_type, size_bytes)
  values (_id, _ctx.company_id, _ctx.contact_id, auth.uid(), 'contact', _ctx.contact_id, 'carte_grise', _path,
    left(coalesce(nullif(trim(p_file_name), ''), 'carte_grise.' || _ext), 150), lower(p_content_type), p_size);
  update public.contact_declared_vehicles set registration_upload_id = _id
   where id = p_declaration_id and contact_id = _ctx.contact_id and company_id = _ctx.company_id;
  return jsonb_build_object('upload_id', _id, 'path', _path);
end $fn$;

-- ------------------------------------------------ 8. Storage : lire / écrire / effacer
-- Lecture : un dépôt SUPPRIMÉ n'est plus lisible (reste de 20260919120000 inchangé).
create or replace function public.portal_can_read_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare _ctx record;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null or p_name is null then return false; end if;
  return exists (
      select 1 from public.portal_uploads pu
      where pu.storage_path = p_name and pu.contact_id = _ctx.contact_id and pu.company_id = _ctx.company_id
        and pu.deleted_at is null
        and (
          -- dépôt en cours (moins d'une heure) : nécessaire à l'envoi lui-même
          (pu.completed_at is null and pu.user_id = auth.uid() and pu.created_at > now() - interval '1 hour')
          or (pu.completed_at is not null and (
                (pu.entity_type = 'contact' and pu.entity_id = _ctx.contact_id)
             or (pu.entity_type = 'vehicle' and public._portal_owns_vehicle(_ctx.contact_id, _ctx.company_id, pu.entity_id))))
        ))
    or exists (
      select 1 from public.attachments a
      join public.documents d on d.id = a.entity_id
      where a.storage_path = p_name and a.entity_type = 'document' and a.company_id = _ctx.company_id
        and d.company_id = _ctx.company_id and d.contact_id = _ctx.contact_id
        and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee')
        and d.imported_from is not null and a.content_type = 'application/pdf' and a.folder is null);
end $fn$;

-- Effacement : uniquement un dépôt que LA BASE vient de marquer supprimé pour ce
-- client (portal_delete_upload), dans l'heure. Le navigateur ne choisit rien.
create or replace function public.portal_can_delete_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare _ctx record;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null or p_name is null then return false; end if;
  return exists (
    select 1 from public.portal_uploads pu
    where pu.storage_path = p_name and pu.contact_id = _ctx.contact_id
      and pu.company_id = _ctx.company_id
      and pu.deleted_at is not null and pu.deleted_at > now() - interval '1 hour');
end $fn$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'ged_portal_delete') then
    create policy ged_portal_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'ged' and public.portal_can_delete_object(name));
  end if;
end $do$;

-- ------------------------------------------------ 9. Point 3 : moto déjà enregistrée
-- Modèle comparable : majuscules, on coupe la couleur après « | », lettres et chiffres.
create or replace function public.vehicle_model_normalize(_model text)
returns text language sql immutable set search_path = public, pg_temp as $fn$
  select nullif(upper(regexp_replace(split_part(coalesce(_model, ''), '|', 1), '[^A-Za-z0-9]', '', 'g')), '');
$fn$;
comment on function public.vehicle_model_normalize(text) is
  'Modèle de moto comparable : « STREETFIGHTER V2 S | RED » et « Streetfighter V2 S » '
  'donnent la même valeur (la couleur du parc ne doit pas empêcher un rapprochement).';
revoke all on function public.vehicle_model_normalize(text) from public, anon;
grant execute on function public.vehicle_model_normalize(text) to authenticated, service_role;

-- La moto déclarée est-elle DÉJÀ au nom de ce client ? On ne regarde que ses
-- propres motos : jamais celle d'un autre client (c'est là toute la sûreté).
create or replace function public._declared_vehicle_owned_match(_d public.contact_declared_vehicles)
returns uuid language sql stable security definer set search_path = public, pg_temp as $fn$
  select v.id
    from public.vehicles v
    join public.vehicle_owners vo on vo.vehicle_id = v.id and vo.is_current and vo.contact_id = _d.contact_id
   where v.company_id = _d.company_id
     and (
       -- VIN identique
       (public.vin_normalize(_d.vin) is not null and public.vin_normalize(v.vin) = public.vin_normalize(_d.vin))
       -- plaque identique
       or (public.plate_normalize(_d.plate) is not null and public.plate_normalize(v.plate) = public.plate_normalize(_d.plate))
       -- marque + modèle (+ année si elle est connue des deux côtés) : le cas des
       -- déclarations du questionnaire d'inscription, sans VIN ni plaque.
       or (public.vehicle_model_normalize(_d.brand) is not null
           and public.vehicle_model_normalize(v.brand) = public.vehicle_model_normalize(_d.brand)
           and public.vehicle_model_normalize(_d.model) is not null
           and public.vehicle_model_normalize(v.model) = public.vehicle_model_normalize(_d.model)
           and (_d.model_year is null or v.model_year is null or v.model_year = _d.model_year))
     )
   order by (public.vin_normalize(_d.vin) is not null
             and public.vin_normalize(v.vin) = public.vin_normalize(_d.vin)) desc,
            (public.plate_normalize(_d.plate) is not null
             and public.plate_normalize(v.plate) = public.plate_normalize(_d.plate)) desc,
            v.created_at
   limit 1;
$fn$;
revoke all on function public._declared_vehicle_owned_match(public.contact_declared_vehicles)
  from public, anon, authenticated;

-- Déclaration « à valider » dont la moto est déjà sur la fiche : elle est validée
-- d'office (côté client : VALIDÉE ; côté équipe : plus dans la file).
create or replace function public._declared_vehicle_autoresolve(_declaration uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _d public.contact_declared_vehicles%rowtype; _v uuid;
begin
  select * into _d from public.contact_declared_vehicles where id = _declaration for update;
  if _d.id is null or _d.kind = 'none' or _d.status is distinct from 'a_valider' then return null; end if;
  _v := public._declared_vehicle_owned_match(_d);
  if _v is null then return null; end if;

  perform public._declared_vehicle_copy_scan(_d, _v);
  update public.contact_declared_vehicles
     set status = 'rattachee', vehicle_id = _v, reviewed_at = now(),
         review_note = coalesce(nullif(btrim(coalesce(review_note, '')), ''),
                                'Validée automatiquement : cette moto est déjà enregistrée au nom du client.')
   where id = _d.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_d.company_id, auth.uid(), 'vehicle_declaration_auto_attached', 'contact_declared_vehicles',
          _d.id::text, 'system',
          jsonb_build_object('status', 'a_valider'),
          jsonb_build_object('status', 'rattachee', 'vehicle_id', _v, 'contact_id', _d.contact_id,
                             'reason', 'vehicle already owned by contact'));
  return _v;
end $fn$;
revoke all on function public._declared_vehicle_autoresolve(uuid) from public, anon, authenticated;

-- Une validation faite à la main par l'équipe pose ce drapeau le temps de la
-- transaction : le déclencheur sur vehicle_owners ne refait pas le travail.
create or replace function public._declared_vehicle_lock(_declaration uuid)
returns public.contact_declared_vehicles
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _d public.contact_declared_vehicles%rowtype;
begin
  select * into _d from public.contact_declared_vehicles where id = _declaration for update;
  if _d.id is null then raise exception 'DECLARATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_member(_d.company_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if _d.status is distinct from 'a_valider' then
    raise exception 'DECLARATION_ALREADY_REVIEWED' using errcode = '23514';
  end if;
  perform set_config('ducati.declaration_review', 'on', true);
  return _d;
end $fn$;
revoke all on function public._declared_vehicle_lock(uuid) from public, anon, authenticated;

-- À l'insertion d'une déclaration : si la moto est déjà au nom du client, elle
-- n'entre pas dans la file. (La carte grise éventuelle n'est déposée qu'ensuite ;
-- elle est recopiée par le rattrapage ou par l'équipe.)
create or replace function public.trg_declared_vehicle_autoresolve()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _v uuid;
begin
  if new.kind = 'none' or new.status is distinct from 'a_valider' then return new; end if;
  begin
    _v := public._declared_vehicle_owned_match(new);
    if _v is not null then
      new.status := 'rattachee';
      new.vehicle_id := _v;
      new.reviewed_at := now();
      new.review_note := coalesce(nullif(btrim(coalesce(new.review_note, '')), ''),
        'Validée automatiquement : cette moto est déjà enregistrée au nom du client.');
    end if;
  exception when others then
    -- Jamais une déclaration refusée à cause du rapprochement automatique.
    raise warning 'trg_declared_vehicle_autoresolve: %', sqlerrm;
  end;
  return new;
end $fn$;
revoke all on function public.trg_declared_vehicle_autoresolve() from public, anon, authenticated;

-- Nom choisi pour passer APRÈS trg_contact_declared_vehicles_status (ordre alphabétique).
drop trigger if exists trg_contact_declared_vehicles_zautoresolve on public.contact_declared_vehicles;
create trigger trg_contact_declared_vehicles_zautoresolve
  before insert on public.contact_declared_vehicles
  for each row execute function public.trg_declared_vehicle_autoresolve();

-- La cloche ne sonne que pour ce qui est réellement à valider.
create or replace function public.trg_notify_team_vehicle_declared()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _name text; _moto text;
begin
  -- kind = 'none' (status null) et déclaration déjà validée d'office : rien à signaler.
  if new.status is distinct from 'a_valider' then return new; end if;
  begin
    select nullif(btrim(coalesce(nullif(btrim(c.company_name), ''),
             concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))), '')
      into _name from public.contacts c where c.id = new.contact_id;
    _moto := nullif(btrim(concat_ws(' ', new.brand, new.model,
               case when new.model_year is not null then '(' || new.model_year || ')' end)), '');
    insert into public.team_notifications (company_id, kind, contact_id, title, origin)
    values (new.company_id, 'vehicle_declared', new.contact_id,
            left(coalesce(_name, '—') || coalesce(' — ' || _moto, ''), 200),
            case when new.source in ('web', 'comptoir') then new.source end);
  exception when others then
    -- Jamais une déclaration (ni une inscription) refusée à cause d'une alerte interne.
    raise warning 'trg_notify_team_vehicle_declared: %', sqlerrm;
  end;
  return new;
end $fn$;
revoke all on function public.trg_notify_team_vehicle_declared() from public, anon, authenticated;

-- La fiche DMS est souvent complétée APRÈS la déclaration (cas rencontré le 05/10) :
-- dès qu'une moto passe au nom d'un client, ses déclarations en attente sont revues.
create or replace function public.trg_vehicle_owner_autoresolve_declarations()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _d record;
begin
  if not coalesce(new.is_current, false) then return new; end if;
  -- Validation en cours par l'équipe : elle écrit elle-même le résultat.
  if coalesce(current_setting('ducati.declaration_review', true), '') = 'on' then return new; end if;
  begin
    for _d in
      select d.id from public.contact_declared_vehicles d
       where d.contact_id = new.contact_id and d.status = 'a_valider' and d.kind <> 'none'
    loop
      perform public._declared_vehicle_autoresolve(_d.id);
    end loop;
  exception when others then
    -- Jamais un rattachement de propriétaire refusé à cause de ce rattrapage.
    raise warning 'trg_vehicle_owner_autoresolve_declarations: %', sqlerrm;
  end;
  return new;
end $fn$;
revoke all on function public.trg_vehicle_owner_autoresolve_declarations() from public, anon, authenticated;

drop trigger if exists trg_vehicle_owners_autoresolve_declarations on public.vehicle_owners;
create trigger trg_vehicle_owners_autoresolve_declarations
  after insert or update of is_current, contact_id on public.vehicle_owners
  for each row execute function public.trg_vehicle_owner_autoresolve_declarations();

-- ------------------------------------------------ 10. Droits
revoke all on function public.portal_prepare_upload(text, uuid, text, text, bigint) from public, anon;
revoke all on function public.portal_complete_upload(uuid) from public, anon;
revoke all on function public.portal_set_upload_label(uuid, text) from public, anon;
revoke all on function public.portal_set_doc_no_back(text, uuid, boolean) from public, anon;
revoke all on function public.portal_delete_upload(uuid) from public, anon;
revoke all on function public.portal_profile() from public, anon;
revoke all on function public.portal_vehicles() from public, anon;
revoke all on function public.portal_vehicle(uuid) from public, anon;
revoke all on function public.portal_home() from public, anon;
revoke all on function public.portal_prepare_declaration_upload(uuid, text, text, bigint) from public, anon;
revoke all on function public.portal_can_read_object(text) from public, anon;
revoke all on function public.portal_can_delete_object(text) from public, anon;
grant execute on function public.portal_prepare_upload(text, uuid, text, text, bigint) to authenticated;
grant execute on function public.portal_complete_upload(uuid) to authenticated;
grant execute on function public.portal_set_upload_label(uuid, text) to authenticated;
grant execute on function public.portal_set_doc_no_back(text, uuid, boolean) to authenticated;
grant execute on function public.portal_delete_upload(uuid) to authenticated;
grant execute on function public.portal_profile() to authenticated;
grant execute on function public.portal_vehicles() to authenticated;
grant execute on function public.portal_vehicle(uuid) to authenticated;
grant execute on function public.portal_home() to authenticated;
grant execute on function public.portal_prepare_declaration_upload(uuid, text, text, bigint) to authenticated;
grant execute on function public.portal_can_read_object(text) to authenticated;
grant execute on function public.portal_can_delete_object(text) to authenticated;

-- ------------------------------------------------ 11. Rattrapage des déclarations
-- Les déclarations déjà en attente dont la moto est au nom du client sont validées.
do $do$
declare _d record; _n int := 0; _v uuid;
begin
  for _d in
    select id from public.contact_declared_vehicles
     where status = 'a_valider' and kind <> 'none'
     order by created_at
  loop
    _v := public._declared_vehicle_autoresolve(_d.id);
    if _v is not null then _n := _n + 1; end if;
  end loop;
  raise notice 'Déclarations validées d''office (moto déjà au nom du client) : %', _n;
end $do$;
