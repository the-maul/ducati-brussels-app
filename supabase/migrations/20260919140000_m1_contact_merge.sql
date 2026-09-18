-- M1 — Fusion de fiches clients : une seule fonction SQL, transactionnelle.
--
-- Remplace la fusion faite côté navigateur (mergeContacts dans src/modules/contacts/api.ts),
-- qui réassignait contact_id table par table, en oubliait une dizaine (pièces jointes GED,
-- fiches liées, compte client, cartes CRM, commandes pièces, fournisseurs d'articles...),
-- n'était pas transactionnelle (fiche archivée même après un échec partiel) et était
-- ouverte à tout membre de la société.
--
-- Règles (décisions F-9, F-10, D3 de docs/bible/decisions.md) :
--   * réservée aux ADMINISTRATEURS de la société ;
--   * les deux fiches doivent appartenir à la même société ; jamais une fiche avec elle-même ;
--   * TOUTES les références de la fiche absorbée passent sur la fiche gardée ; un filet de
--     sécurité parcourt les clés étrangères réelles vers contacts et REFUSE la fusion s'il
--     en reste une (table ajoutée plus tard et non gérée ici) : tout ou rien ;
--   * les champs VIDES de la fiche gardée sont complétés par l'absorbée, jamais écrasés ;
--   * trace dans events (qui, quand, quelles fiches, ce qui a été déplacé ou dédoublonné) ;
--   * la fiche absorbée est ARCHIVÉE, pas supprimée (règle 4 : l'audit prime).
--
-- Codes d'erreur renvoyés (traduits côté écran, dictionnaire i18n) :
--   MERGE_SAME_CONTACT, MERGE_NOT_FOUND, MERGE_FORBIDDEN, MERGE_OTHER_COMPANY,
--   MERGE_BOTH_ACCOUNTS, MERGE_BOTH_OPENING_BALANCE, MERGE_UNHANDLED_REFERENCE.
--
-- Uniquement des create or replace function : aucune table touchée par cette migration.

-- ─────────────────────────────────────────────────────────────────────────────
-- Inventaire des références vers une fiche (interne : appelé par les deux fonctions
-- ci-dessous, qui font les contrôles de droits). Une clé par table.colonne.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.contact_merge_refs(_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'documents',                  (select count(*) from public.documents where contact_id = _id),
    'vehicle_owners',             (select count(*) from public.vehicle_owners where contact_id = _id),
    'communications',             (select count(*) from public.communications where contact_id = _id),
    'attachments',                (select count(*) from public.attachments where entity_type = 'contact' and entity_id = _id),
    'repair_orders',              (select count(*) from public.repair_orders where contact_id = _id),
    'workshop_appointments',      (select count(*) from public.workshop_appointments where contact_id = _id),
    'leads',                      (select count(*) from public.leads where contact_id = _id),
    'sepa_mandates',              (select count(*) from public.sepa_mandates where contact_id = _id),
    'delivery_addresses',         (select count(*) from public.delivery_addresses where contact_id = _id),
    'contact_subcontacts',        (select count(*) from public.contact_subcontacts where contact_id = _id),
    'client_price_rules',         (select count(*) from public.client_price_rules where contact_id = _id),
    'customer_price_rules',       (select count(*) from public.customer_price_rules where contact_id = _id),
    'consignments',               (select count(*) from public.consignments where depositor_id = _id),
    'purchase_orders',            (select count(*) from public.purchase_orders where supplier_id = _id),
    'articles_main_supplier',     (select count(*) from public.articles where main_supplier_id = _id),
    'articles_reprise_supplier',  (select count(*) from public.articles where reprise_supplier_id = _id),
    'article_suppliers',          (select count(*) from public.article_suppliers where supplier_id = _id),
    'part_orders',                (select count(*) from public.part_orders where contact_id = _id),
    'part_order_lines',           (select count(*) from public.part_order_lines where supplier_id = _id),
    'excel_order_lines',          (select count(*) from public.excel_order_lines where contact_id = _id),
    'contact_links',              (select count(*) from public.contact_links where contact_a = _id or contact_b = _id),
    'contact_invitations',        (select count(*) from public.contact_invitations where contact_id = _id),
    'contact_merge_candidates',   (select count(*) from public.contact_merge_candidates where contact_id = _id or candidate_id = _id),
    'contact_accounts',           (select count(*) from public.contact_accounts where contact_id = _id),
    'contact_declared_vehicles',  (select count(*) from public.contact_declared_vehicles where contact_id = _id),
    'portal_uploads',             (select count(*) from public.portal_uploads where contact_id = _id or (entity_type = 'contact' and entity_id = _id)),
    'notifications',              (select count(*) from public.notifications where entity_type in ('contact', 'contacts') and entity_id = _id::text)
  );
$$;

revoke all on function public.contact_merge_refs(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Aperçu avant fusion : ce qui sera rapatrié, et ce qui bloquerait.
-- Mêmes gardes que la fusion (admin, même société, deux fiches distinctes).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.contact_merge_preview(_keep uuid, _absorb uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  _k public.contacts%rowtype;
  _a public.contacts%rowtype;
  _blockers text[] := '{}';
begin
  if _keep is null or _absorb is null then
    raise exception 'MERGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if _keep = _absorb then
    raise exception 'MERGE_SAME_CONTACT' using errcode = '22023';
  end if;
  select * into _k from public.contacts where id = _keep;
  select * into _a from public.contacts where id = _absorb;
  if _k.id is null or _a.id is null then
    raise exception 'MERGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_admin(_k.company_id) then
    raise exception 'MERGE_FORBIDDEN' using errcode = '42501';
  end if;
  if _a.company_id <> _k.company_id then
    raise exception 'MERGE_OTHER_COMPANY' using errcode = '42501';
  end if;

  if exists (select 1 from public.contact_accounts where contact_id = _keep)
     and exists (select 1 from public.contact_accounts where contact_id = _absorb) then
    _blockers := _blockers || 'MERGE_BOTH_ACCOUNTS';
  end if;
  if _k.opening_balance <> 0 and _a.opening_balance <> 0 then
    _blockers := _blockers || 'MERGE_BOTH_OPENING_BALANCE';
  end if;

  return jsonb_build_object(
    'kept_id', _keep,
    'absorbed_id', _absorb,
    'counts', public.contact_merge_refs(_absorb),
    'blockers', to_jsonb(_blockers)
  );
end;
$$;

revoke all on function public.contact_merge_preview(uuid, uuid) from public, anon;
grant execute on function public.contact_merge_preview(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- La fusion. Tout ou rien : la moindre exception annule l'ensemble.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.contact_merge(_keep uuid, _absorb uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _k       public.contacts%rowtype;
  _a       public.contacts%rowtype;
  _after   public.contacts%rowtype;
  _uid     uuid := auth.uid();
  _moved   jsonb := '{}'::jsonb;
  _removed jsonb := '[]'::jsonb;   -- lignes en double supprimées, contenu complet conservé ici
  _archived_leads jsonb := '[]'::jsonb;
  _before  jsonb;
  _n       bigint;
  _r       record;
  _sets    text;
  _left    text;
  _extra   text;
  _stamp   text := to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY');
  _kl      uuid;
begin
  -- 1. Gardes ------------------------------------------------------------------
  if _keep is null or _absorb is null then
    raise exception 'MERGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if _keep = _absorb then
    raise exception 'MERGE_SAME_CONTACT' using errcode = '22023';
  end if;

  -- Verrou des deux fiches, dans un ordre stable (pas d'interblocage entre deux fusions).
  perform 1 from public.contacts where id in (_keep, _absorb) order by id for update;
  select * into _k from public.contacts where id = _keep;
  select * into _a from public.contacts where id = _absorb;
  if _k.id is null or _a.id is null then
    raise exception 'MERGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_admin(_k.company_id) then
    raise exception 'MERGE_FORBIDDEN' using errcode = '42501',
      hint = 'La fusion de fiches est réservée aux administrateurs (décision F-9).';
  end if;
  if _a.company_id <> _k.company_id then
    raise exception 'MERGE_OTHER_COMPANY' using errcode = '42501',
      hint = 'Les deux fiches doivent appartenir à la même société.';
  end if;

  -- Conflits qu'on ne tranche pas à la place de l'utilisateur.
  if exists (select 1 from public.contact_accounts where contact_id = _keep)
     and exists (select 1 from public.contact_accounts where contact_id = _absorb) then
    raise exception 'MERGE_BOTH_ACCOUNTS' using errcode = '23505',
      hint = 'Les deux fiches ont chacune un compte client (application) : un seul compte par fiche.';
  end if;
  if _k.opening_balance <> 0 and _a.opening_balance <> 0 then
    raise exception 'MERGE_BOTH_OPENING_BALANCE' using errcode = '23514',
      hint = 'Les deux fiches ont un solde d''ouverture G8 : à régler par la comptabilité avant de fusionner.';
  end if;

  -- 2. Déplacements simples (aucune contrainte d'unicité en jeu) ------------------
  for _r in
    select * from (values
      ('documents', 'contact_id'),
      ('repair_orders', 'contact_id'),
      ('workshop_appointments', 'contact_id'),
      ('communications', 'contact_id'),
      ('sepa_mandates', 'contact_id'),
      ('delivery_addresses', 'contact_id'),
      ('contact_subcontacts', 'contact_id'),
      ('client_price_rules', 'contact_id'),
      ('customer_price_rules', 'contact_id'),
      ('consignments', 'depositor_id'),
      ('purchase_orders', 'supplier_id'),
      ('articles', 'main_supplier_id'),
      ('articles', 'reprise_supplier_id'),
      ('part_orders', 'contact_id'),
      ('part_order_lines', 'supplier_id'),
      ('excel_order_lines', 'contact_id'),
      ('contact_invitations', 'contact_id'),
      ('contact_declared_vehicles', 'contact_id'),
      ('contact_accounts', 'contact_id'),   -- au plus un compte des deux côtés (vérifié plus haut)
      ('portal_uploads', 'contact_id')
    ) v(t, c)
  loop
    execute format('update public.%I set %I = $1 where %I = $2', _r.t, _r.c, _r.c)
      using _keep, _absorb;
    get diagnostics _n = row_count;
    if _n > 0 then
      _moved := _moved || jsonb_build_object(_r.t || '.' || _r.c, _n);
    end if;
  end loop;

  -- Références polymorphes (sans clé étrangère) : pièces jointes GED, dépôts du portail,
  -- notifications.
  update public.attachments set entity_id = _keep
   where entity_type = 'contact' and entity_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('attachments', _n); end if;

  update public.portal_uploads set entity_id = _keep
   where entity_type = 'contact' and entity_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('portal_uploads.entity_id', _n); end if;

  update public.notifications set entity_id = _keep::text
   where entity_type in ('contact', 'contacts') and entity_id = _absorb::text;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('notifications', _n); end if;

  -- 3. Déplacements avec gestion des doublons -------------------------------------

  -- 3a. Fournisseurs d'articles : unique (article_id, supplier_id).
  with d as (
    delete from public.article_suppliers s
     where s.supplier_id = _absorb
       and exists (select 1 from public.article_suppliers k
                    where k.supplier_id = _keep and k.article_id = s.article_id)
    returning jsonb_build_object('table', 'article_suppliers', 'row', to_jsonb(s)) j
  )
  select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
  update public.article_suppliers set supplier_id = _keep where supplier_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('article_suppliers', _n); end if;

  -- 3b. Propriétaires de motos : si les deux fiches possèdent la même moto sur la même
  --     période (ou toutes deux actuellement), on garde la ligne de la fiche gardée en
  --     reprenant la date de début la plus ancienne ; la ligne en double est supprimée
  --     (contenu conservé dans la trace).
  for _r in
    select a.id as aid, k.id as kid, a.from_date as afd
      from public.vehicle_owners a
      join public.vehicle_owners k
        on k.vehicle_id = a.vehicle_id and k.contact_id = _keep
       and ((a.is_current and k.is_current)
            or (a.from_date = k.from_date and a.to_date is not distinct from k.to_date))
     where a.contact_id = _absorb
  loop
    if exists (select 1 from public.vehicle_owners where id = _r.aid) then
      update public.vehicle_owners set from_date = least(from_date, _r.afd) where id = _r.kid;
      with d as (
        delete from public.vehicle_owners v where v.id = _r.aid
        returning jsonb_build_object('table', 'vehicle_owners', 'row', to_jsonb(v)) j
      )
      select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
    end if;
  end loop;
  update public.vehicle_owners set contact_id = _keep where contact_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('vehicle_owners', _n); end if;

  -- 3c. Fiches liées (pro ↔ privé) : paire unique non ordonnée. Le lien entre les deux
  --     fiches fusionnées disparaît (il deviendrait un lien d'une fiche avec elle-même),
  --     comme un lien que la fiche gardée a déjà.
  with d as (
    delete from public.contact_links l
     where (l.contact_a = _absorb or l.contact_b = _absorb)
       and (
         l.contact_a = _keep or l.contact_b = _keep
         or exists (
           select 1 from public.contact_links k
            where (k.contact_a = _keep or k.contact_b = _keep)
              and (case when k.contact_a = _keep then k.contact_b else k.contact_a end)
                = (case when l.contact_a = _absorb then l.contact_b else l.contact_a end)
         )
       )
    returning jsonb_build_object('table', 'contact_links', 'row', to_jsonb(l)) j
  )
  select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
  update public.contact_links set contact_a = _keep where contact_a = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('contact_links.contact_a', _n); end if;
  update public.contact_links set contact_b = _keep where contact_b = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('contact_links.contact_b', _n); end if;

  -- 3d. Rapprochements proposés : la proposition entre les deux fiches est résolue par
  --     la fusion elle-même ; les autres suivent la fiche gardée sans créer de doublon
  --     (unique contact_id, candidate_id).
  with d as (
    delete from public.contact_merge_candidates m
     where (m.contact_id = _absorb or m.candidate_id = _absorb)
       and (
         m.contact_id = _keep or m.candidate_id = _keep
         or (m.contact_id = _absorb and exists (
               select 1 from public.contact_merge_candidates x
                where x.contact_id = _keep and x.candidate_id = m.candidate_id))
         or (m.candidate_id = _absorb and exists (
               select 1 from public.contact_merge_candidates x
                where x.candidate_id = _keep and x.contact_id = m.contact_id))
       )
    returning jsonb_build_object('table', 'contact_merge_candidates', 'row', to_jsonb(m)) j
  )
  select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
  update public.contact_merge_candidates set contact_id = _keep where contact_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('contact_merge_candidates.contact_id', _n); end if;
  update public.contact_merge_candidates set candidate_id = _keep where candidate_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('contact_merge_candidates.candidate_id', _n); end if;

  -- 3e. Cartes CRM : une seule carte ouverte par fiche et par pipeline. Si la fiche gardée
  --     a déjà une carte ouverte, la carte ouverte de l'absorbée est ARCHIVÉE (comme le
  --     bouton Archiver de l'écran CRM) ; sa tâche en cours passe sur la carte gardée si
  --     celle-ci n'en a pas. Toutes les cartes (et leur historique) suivent la fiche gardée.
  for _r in
    select l.id, l.pipeline
      from public.leads l
     where l.contact_id = _absorb
       and l.archived_at is null
       and l.stage not in ('gagne', 'perdu')
  loop
    select k.id into _kl
      from public.leads k
     where k.contact_id = _keep
       and k.pipeline = _r.pipeline
       and k.archived_at is null
       and k.stage not in ('gagne', 'perdu')
     order by k.created_at
     limit 1;
    if _kl is not null then
      update public.lead_tasks t set lead_id = _kl
       where t.lead_id = _r.id and t.done_at is null
         and not exists (select 1 from public.lead_tasks o where o.lead_id = _kl and o.done_at is null);
      update public.leads
         set archived_at = now(),
             archived_by = _uid,
             archived_reason = 'Fusion de fiches : doublon de la carte ouverte de la fiche '
                               || coalesce(_k.code, _keep::text)
       where id = _r.id;
      _archived_leads := _archived_leads || to_jsonb(_r.id);
    end if;
  end loop;
  update public.leads set contact_id = _keep where contact_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('leads', _n); end if;

  -- 4. Filet de sécurité : plus AUCUNE référence vers la fiche absorbée. Parcourt les vraies
  --    clés étrangères (une table ajoutée demain sera vue ici) + les références polymorphes.
  for _r in
    select con.conrelid::regclass::text as t, att.attname as c
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f' and con.confrelid = 'public.contacts'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', _r.t, _r.c) into _n using _absorb;
    if _n > 0 then _left := concat_ws(', ', _left, _r.t || '.' || _r.c || ' (' || _n || ')'); end if;
  end loop;
  if exists (select 1 from public.attachments where entity_type = 'contact' and entity_id = _absorb) then
    _left := concat_ws(', ', _left, 'attachments');
  end if;
  if exists (select 1 from public.portal_uploads where entity_type = 'contact' and entity_id = _absorb) then
    _left := concat_ws(', ', _left, 'portal_uploads.entity_id');
  end if;
  if _left is not null then
    raise exception 'MERGE_UNHANDLED_REFERENCE: %', _left using errcode = 'P0001',
      hint = 'Une table référence encore la fiche absorbée : la fusion est annulée en entier.';
  end if;

  -- 5. Compléter la fiche gardée (jamais d'écrasement) ------------------------------
  -- Colonnes facultatives : prises à l'absorbée seulement si vides côté gardée. Liste
  -- lue dans le schéma, pour qu'une colonne ajoutée plus tard soit complétée aussi.
  select string_agg(
           case when c.data_type = 'text'
                then format('%1$I = case when nullif(btrim(k.%1$I), %2$L) is null then a.%1$I else k.%1$I end', c.column_name, '')
                else format('%1$I = coalesce(k.%1$I, a.%1$I)', c.column_name)
           end, ', ' order by c.ordinal_position)
    into _sets
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'contacts'
     and c.is_nullable = 'YES'
     and c.data_type <> 'ARRAY'
     and c.column_name not in ('id', 'company_id', 'code', 'created_at', 'updated_at', 'created_by', 'notes');
  if _sets is not null then
    execute format('update public.contacts k set %s from public.contacts a where k.id = $1 and a.id = $2', _sets)
      using _keep, _absorb;
  end if;

  -- Coordonnées différentes des deux côtés : celles de l'absorbée sont recopiées dans les
  -- notes de la fiche gardée, pour ne rien perdre de joignable.
  select string_agg(label || ' : ' || av, E'\n')
    into _extra
    from (values
      ('E-mail', _k.email, _a.email),
      ('E-mail pro', _k.email_pro, _a.email_pro),
      ('Téléphone', _k.phone, _a.phone),
      ('Mobile', _k.mobile, _a.mobile),
      ('GSM', _k.gsm, _a.gsm),
      ('Téléphone pro', _k.phone_pro, _a.phone_pro),
      ('Mobile pro', _k.mobile_pro, _a.mobile_pro),
      ('Adresse',
        nullif(btrim(concat_ws(' ', _k.address, _k.street_number, _k.zip, _k.city)), ''),
        nullif(btrim(concat_ws(' ', _a.address, _a.street_number, _a.zip, _a.city)), ''))
    ) v(label, kv, av)
   where nullif(btrim(kv), '') is not null
     and nullif(btrim(av), '') is not null
     and lower(btrim(kv)) <> lower(btrim(av));

  update public.contacts set
    interests = (select coalesce(array_agg(distinct x), '{}') from unnest(_k.interests || _a.interests) x),
    model_interests = (select coalesce(array_agg(distinct x), '{}')
                         from unnest(coalesce(_k.model_interests, '{}') || coalesce(_a.model_interests, '{}')) x),
    -- Drapeaux de vigilance et opt-out : un drapeau posé d'un côté n'est jamais perdu.
    is_vip            = _k.is_vip or _a.is_vip,
    is_blocked        = _k.is_blocked or _a.is_blocked,
    is_watch          = _k.is_watch or _a.is_watch,
    marketing_opt_out = _k.marketing_opt_out or _a.marketing_opt_out,
    -- Valeurs par défaut considérées comme « vides ».
    status          = case when _k.status = 'prospect' then _a.status else _k.status end,
    segment         = case when _k.segment = 'standard' then _a.segment else _k.segment end,
    credit_limit    = case when _k.credit_limit = 0 then _a.credit_limit else _k.credit_limit end,
    opening_balance = case when _k.opening_balance = 0 then _a.opening_balance else _k.opening_balance end,
    -- La personne est active si l'une des deux fiches l'était.
    is_active       = _k.is_active or _a.is_active,
    notes = nullif(concat_ws(E'\n\n',
              nullif(btrim(_k.notes), ''),
              case when nullif(btrim(_a.notes), '') is not null or _extra is not null then
                'Fusion avec la fiche ' || coalesce(_a.code, _absorb::text) || ' le ' || _stamp || E' :\n'
                || concat_ws(E'\n', nullif(btrim(_a.notes), ''), _extra)
              end), '')
  where id = _keep;

  -- 6. Archiver la fiche absorbée ----------------------------------------------------
  -- Ses e-mails sont retirés (ils vivent sur la fiche gardée et dans la trace) : sinon la
  -- relève mail et l'inscription, qui cherchent une fiche par e-mail sans regarder
  -- is_active, pourraient rattacher un nouveau message à la fiche archivée.
  update public.contacts set
    is_active = false,
    email = null,
    email_pro = null,
    notes = concat_ws(E'\n\n', nullif(btrim(notes), ''),
              'Fiche fusionnée le ' || _stamp || ' dans la fiche ' || coalesce(_k.code, _keep::text)
              || '. Toutes ses données y ont été déplacées.')
  where id = _absorb;

  -- 7. Trace (events, append-only) ------------------------------------------------
  select * into _after from public.contacts where id = _keep;
  _before := jsonb_build_object('kept', to_jsonb(_k), 'absorbed', to_jsonb(_a));

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (
    _k.company_id, _uid, 'merge', 'contacts', _keep::text, 'screen',
    _before,
    jsonb_build_object(
      'kept_id', _keep, 'kept_code', _k.code,
      'absorbed_id', _absorb, 'absorbed_code', _a.code,
      'moved', _moved,
      'removed_duplicates', _removed,
      'archived_leads', _archived_leads,
      'kept_after', to_jsonb(_after)
    )
  );
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (
    _k.company_id, _uid, 'merged_into', 'contacts', _absorb::text, 'screen',
    to_jsonb(_a),
    jsonb_build_object('kept_id', _keep, 'kept_code', _k.code, 'moved', _moved)
  );

  return jsonb_build_object(
    'kept_id', _keep,
    'absorbed_id', _absorb,
    'moved', _moved,
    'removed_duplicates', jsonb_array_length(_removed),
    'archived_leads', jsonb_array_length(_archived_leads)
  );
end;
$$;

revoke all on function public.contact_merge(uuid, uuid) from public, anon;
grant execute on function public.contact_merge(uuid, uuid) to authenticated;

comment on function public.contact_merge(uuid, uuid) is
  'M1 — Fusionne la fiche _absorb dans _keep (admin, même société). Tout ou rien ; trace dans events ; fiche absorbée archivée.';
