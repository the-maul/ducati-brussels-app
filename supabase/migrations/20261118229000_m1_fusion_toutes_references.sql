-- =====================================================================
-- M1 — Fusion de doublons : TOUTES les references rattachees (rattrapage G8 du 18/11/2026,
-- lot-g8-clients). G8 « Fusionner » : 2 fiches -> 1, documents, motos et historiques rattaches.
--
-- La fusion du 19/09 (20260919140000_m1_contact_merge.sql) deplacait une liste FIXE de tables.
-- Depuis, onze tables pointent vers un contact sans y etre (commandes pour un client, commandes
-- du site, reservations Shopify, « pas de verso » du portail, interventions reportees, relances,
-- paniers fournisseur, dossiers accident, reservations atelier...) : leur filet de securite
-- REFUSAIT donc toute fusion d'une fiche qui en avait (MERGE_UNHANDLED_REFERENCE).
--
-- Cette version (create or replace, aucune table touchee) :
--   * garde tout le traitement du 19/09 (meme ordre, memes regles, meme trace) ;
--   * traite explicitement les tables a contrainte d'unicite : portal_doc_no_back, groupes
--     (contact_group_members), vente groupement (contact_group_sales) ;
--   * deplace ensuite GENERIQUEMENT toute autre cle etrangere vers contacts (une table ajoutee
--     demain suit la fusion sans retoucher cette fonction) ; un conflit d'unicite annule tout
--     (MERGE_UNIQUE_CONFLICT, rien n'est modifie) ;
--   * laisse en place le registre des vehicules a moteur (vehicle_register, append-only, B7) :
--     une inscription legale garde le client du jour de l'inscription ; la fiche absorbee est
--     archivee, jamais supprimee, la reference reste donc valable ;
--   * contact_merge_refs compte aussi ces tables (recapitulatif avant fusion).
--
-- NE PAS APPLIQUER depuis un agent. A appliquer APRES 20261118190000 (lot regles client), 20261118220000, 221000 et 222000.
-- Essai a blanc : supabase/tests/m1_fusion_toutes_references.sql.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Inventaire des références vers une fiche (interne). Les tables sans clé explicite
-- ci-dessous sont comptées par le parcours générique des clés étrangères.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.contact_merge_refs(_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  _out jsonb;
  _r record;
  _n bigint;
  _k text;
begin
  select jsonb_build_object(
    'documents',                  (select count(*) from public.documents where contact_id = _id),
    'vehicle_owners',             (select count(*) from public.vehicle_owners where contact_id = _id),
    'communications',             (select count(*) from public.communications where contact_id = _id),
    'attachments',                (select count(*) from public.attachments where entity_type = 'contact' and entity_id = _id),
    'repair_orders',              (select count(*) from public.repair_orders where contact_id = _id),
    'workshop_appointments',      (select count(*) from public.workshop_appointments where contact_id = _id),
    'leads',                      (select count(*) from public.leads where contact_id = _id),
    'contact_links',              (select count(*) from public.contact_links where contact_a = _id or contact_b = _id),
    'contact_merge_candidates',   (select count(*) from public.contact_merge_candidates where contact_id = _id or candidate_id = _id),
    'portal_uploads',             (select count(*) from public.portal_uploads where contact_id = _id or (entity_type = 'contact' and entity_id = _id)),
    'notifications',              (select count(*) from public.notifications where entity_type in ('contact', 'contacts') and entity_id = _id::text)
  ) into _out;
  -- Toutes les autres clés étrangères vers contacts (le registre des véhicules ne bouge pas).
  for _r in
    select con.conrelid::regclass::text as t, att.attname::text as c
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f' and con.confrelid = 'public.contacts'::regclass
       and replace(con.conrelid::regclass::text, 'public.', '') not in ('documents', 'vehicle_owners', 'communications',
             'repair_orders', 'workshop_appointments', 'leads', 'contact_links', 'contact_merge_candidates',
             'portal_uploads', 'vehicle_register')
  loop
    execute format('select count(*) from %s where %I = $1', _r.t, _r.c) into _n using _id;
    if _n > 0 then
      _k := replace(_r.t, 'public.', '') || case when _r.c = 'contact_id' then '' else '.' || _r.c end;
      _out := _out || jsonb_build_object(_k, coalesce((_out ->> _k)::bigint, 0) + _n);
    end if;
  end loop;
  return _out;
end;
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
  _claims  text;
  _extra_docs jsonb;
  _sub     text;
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

  -- 2a. Documents de vente. Depuis le gel des documents validés (20261103150000, B7), changer le
  --     client d'un document validé est refusé pour un utilisateur ; la fusion de deux fiches de la
  --     MÊME personne doit pourtant les réunir. Le gel laisse passer les fonctions serveur
  --     (auth.uid() vide) : l'identité est donc mise de côté le temps de ce seul déplacement, puis
  --     rétablie. Numéros, dates et montants ne changent pas ; la trace de la fusion (events) garde
  --     l'auteur et la liste des documents déplacés.
  _claims := current_setting('request.jwt.claims', true);
  _sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  with m as (
    update public.documents set contact_id = _keep where contact_id = _absorb
    returning id, number
  )
  select count(*), jsonb_agg(jsonb_build_object('id', id, 'number', number)) into _n, _extra_docs from m;
  perform set_config('request.jwt.claims', coalesce(_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(_sub, ''), true);
  if _n > 0 then
    _moved := _moved || jsonb_build_object('documents.contact_id', _n, 'documents_list', _extra_docs);
  end if;

  -- 2. Déplacements simples (aucune contrainte d'unicité en jeu) ------------------
  for _r in
    select * from (values
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

  -- 3f. Tables à contrainte d'unicité ajoutées après le 19/09 (dédoublonnées, contenu gardé
  --     dans la trace), puis déplacées.
  if to_regclass('public.portal_doc_no_back') is not null then
    with d as (
      delete from public.portal_doc_no_back p
       where p.contact_id = _absorb
         and exists (select 1 from public.portal_doc_no_back k
                      where k.contact_id = _keep and k.kind = p.kind and k.entity_type = p.entity_type
                        and k.entity_id = case when p.entity_type = 'contact' and p.entity_id = _absorb then _keep else p.entity_id end)
      returning jsonb_build_object('table', 'portal_doc_no_back', 'row', to_jsonb(p)) j
    )
    select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
    update public.portal_doc_no_back
       set contact_id = _keep,
           entity_id = case when entity_type = 'contact' and entity_id = _absorb then _keep else entity_id end
     where contact_id = _absorb;
    get diagnostics _n = row_count;
    if _n > 0 then _moved := _moved || jsonb_build_object('portal_doc_no_back', _n); end if;
  end if;

  if to_regclass('public.contact_group_members') is not null then
    with d as (
      delete from public.contact_group_members g
       where g.contact_id = _absorb
         and exists (select 1 from public.contact_group_members k where k.contact_id = _keep and k.group_code = g.group_code)
      returning jsonb_build_object('table', 'contact_group_members', 'row', to_jsonb(g)) j
    )
    select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
    update public.contact_group_members set contact_id = _keep where contact_id = _absorb;
    get diagnostics _n = row_count;
    if _n > 0 then _moved := _moved || jsonb_build_object('contact_group_members', _n); end if;
  end if;

  if to_regclass('public.contact_group_sales') is not null then
    -- Le lien entre les deux fiches fusionnées disparaît (il deviendrait un lien d'une fiche
    -- avec elle-même), comme un associé que la fiche gardée a déjà.
    with d as (
      delete from public.contact_group_sales g
       where (g.contact_id = _absorb and (g.member_id = _keep
               or exists (select 1 from public.contact_group_sales k where k.contact_id = _keep and k.member_id = g.member_id)))
          or (g.member_id = _absorb and (g.contact_id = _keep
               or exists (select 1 from public.contact_group_sales k where k.member_id = _keep and k.contact_id = g.contact_id)))
      returning jsonb_build_object('table', 'contact_group_sales', 'row', to_jsonb(g)) j
    )
    select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
    update public.contact_group_sales set contact_id = _keep where contact_id = _absorb;
    get diagnostics _n = row_count;
    if _n > 0 then _moved := _moved || jsonb_build_object('contact_group_sales.contact_id', _n); end if;
    update public.contact_group_sales set member_id = _keep where member_id = _absorb;
    get diagnostics _n = row_count;
    if _n > 0 then _moved := _moved || jsonb_build_object('contact_group_sales.member_id', _n); end if;
  end if;

  -- 3g. Toute autre clé étrangère vers contacts (tables ajoutées après le 19/09, et celles de
  --     demain) : déplacement générique. Le registre des véhicules à moteur reste en place
  --     (append-only, inscription légale ; la fiche absorbée est archivée, pas supprimée).
  for _r in
    select con.conrelid::regclass::text as t, att.attname::text as c
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f' and con.confrelid = 'public.contacts'::regclass
       and con.conrelid::regclass::text not in ('vehicle_register', 'public.vehicle_register')
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', _r.t, _r.c, _r.c) using _keep, _absorb;
      get diagnostics _n = row_count;
    exception when unique_violation then
      raise exception 'MERGE_UNIQUE_CONFLICT: %', _r.t || '.' || _r.c using errcode = '23505',
        hint = 'Les deux fiches ont une ligne identique dans cette table : la fusion est annulée en entier.';
    end;
    if _n > 0 then
      _moved := _moved || jsonb_build_object(replace(_r.t, 'public.', '') || '.' || _r.c,
                                             coalesce((_moved ->> (replace(_r.t, 'public.', '') || '.' || _r.c))::bigint, 0) + _n);
    end if;
  end loop;

  -- 4. Filet de sécurité : plus AUCUNE référence vers la fiche absorbée. Parcourt les vraies
  --    clés étrangères (une table ajoutée demain sera vue ici) + les références polymorphes.
  for _r in
    select con.conrelid::regclass::text as t, att.attname as c
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f' and con.confrelid = 'public.contacts'::regclass
       and con.conrelid::regclass::text not in ('vehicle_register', 'public.vehicle_register')
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
  'M1 (18/11/2026) — Fusionne la fiche _absorb dans _keep (admin, même société). Toutes les cles etrangeres suivent (registre des vehicules excepte). Tout ou rien ; trace dans events ; fiche absorbée archivée.';

notify pgrst, 'reload schema';
