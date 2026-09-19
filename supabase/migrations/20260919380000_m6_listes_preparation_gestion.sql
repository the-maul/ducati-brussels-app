-- =====================================================================
-- Mission 02 — carte « picking list » (complément mission 05, carte 6)
--
-- Retour de Simon : « on ne sait pas supprimer une picking list… on ne sait
-- quasi rien faire ». Une seule notion : la liste de préparation d'un document.
--
-- Ce lot ajoute la gestion des listes :
--   - picking_overview      : toutes les listes (document, client, moto, vendeur,
--                             avancement, emplacement, statut, document modifié ?) ;
--   - picking_cancel        : suppression réelle SEULEMENT si rien n'a été préparé
--                             ni monté ; sinon annulation avec motif (B7 : tracée,
--                             jamais de suppression silencieuse) ;
--   - picking_reopen        : rouvrir une liste annulée ou terminée ;
--   - picking_regenerate    : reprendre le document (ajoute les nouvelles lignes,
--                             signale les lignes retirées, garde les états saisis) ;
--   - picking_finish        : terminer (toutes les lignes préparées ou montées).
-- Les écritures existantes (étape, emplacement, ouverture) refusent désormais une
-- liste annulée ; le statut d'une liste ignore les lignes retirées du document.
--
-- Stock : AUCUN mouvement (inchangé). Toute écriture reste tracée dans events
-- (trigger audit_row) + un événement lisible par action (motif, résultat).
--
-- Additif : 6 colonnes, statut « annulee » ajouté (contrainte élargie), droits
-- d'écriture directe retirés (tout passe par les fonctions), 1 fonction interne,
-- 5 nouvelles fonctions, 3 fonctions redéfinies (même signature).
-- =====================================================================

-- 1. Colonnes
alter table public.picking_lists
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancel_reason text,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references auth.users(id) on delete set null;

-- Ligne retirée du document depuis la création de la liste (signalée, jamais supprimée)
alter table public.picking_list_items
  add column if not exists removed_at timestamptz;

-- 2. Statut « annulee » (contrainte élargie : les valeurs existantes restent valides)
alter table public.picking_lists drop constraint if exists picking_lists_status_check;
alter table public.picking_lists
  add constraint picking_lists_status_check check (status in ('en_cours', 'pret', 'livre', 'annulee'));

-- 3. Plus d'écriture directe depuis l'application : suppression, annulation, étapes,
--    emplacement passent par les fonctions ci-dessous (règles + trace).
revoke insert, update, delete on public.picking_lists from anon, authenticated;
revoke insert, update, delete on public.picking_list_items from anon, authenticated;

-- 4. Statut en_cours / pret d'une liste active (lignes retirées ignorées) — interne
create or replace function public._picking_refresh_status(_picking uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.picking_lists l set status = x.st
    from (select case when count(*) > 0
                       and bool_and(coalesce(prep_step in ('prepare', 'monte'), false))
                      then 'pret' else 'en_cours' end as st
            from public.picking_list_items
           where picking_id = _picking and removed_at is null) x
   where l.id = _picking and l.status in ('en_cours', 'pret') and l.status <> x.st;
end $$;

revoke all on function public._picking_refresh_status(uuid) from public, anon, authenticated;

-- 5. Ouvrir la liste d'un document : une liste annulée ou terminée est rendue telle
--    quelle (l'écran propose « Rouvrir ») ; sinon les nouvelles lignes sont ajoutées.
create or replace function public.picking_open_for_document(_document uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d   public.documents%rowtype;
  pid uuid;
  pst text;
begin
  select * into d from public.documents where id = _document;
  if not found then
    raise exception 'Document introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(d.company_id) then
    raise exception 'Accès refusé à la société %', d.company_id using errcode = '42501';
  end if;
  if d.status = 'annulee' then
    raise exception 'Document annulé : rien à préparer.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('picking:' || _document::text));

  select id, status into pid, pst from public.picking_lists where document_id = _document;
  if pid is null then
    insert into public.picking_lists (company_id, document_id, created_by)
    values (d.company_id, _document, auth.uid())
    returning id into pid;
    pst := 'en_cours';
  end if;
  if pst in ('annulee', 'livre') then
    return pid;
  end if;

  insert into public.picking_list_items
    (company_id, picking_id, article_id, designation, reference, qty_ordered, qty_picked, status,
     document_line_id, sort_order)
  select d.company_id, pid, l.article_id, l.designation, l.reference, l.quantity, 0, 'a_preparer',
         l.id, l.sort_order
    from public.document_lines l
   where l.document_id = _document
     and coalesce(l.line_type, 'article') = 'article'
     and l.quantity > 0
     and not exists (
       select 1 from public.picking_list_items i
        where i.picking_id = pid
          and (i.document_line_id = l.id
               or (i.document_line_id is null
                   and i.article_id is not distinct from l.article_id
                   and i.designation is not distinct from l.designation)));

  perform public._picking_refresh_status(pid);
  return pid;
end $$;

revoke all on function public.picking_open_for_document(uuid) from public, anon;
grant execute on function public.picking_open_for_document(uuid) to authenticated;

-- 6. Étape d'une ligne (inchangée, + refus d'une liste annulée, statut sans lignes retirées)
create or replace function public.picking_set_step(_item uuid, _step text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  i public.picking_list_items%rowtype;
  p public.picking_lists%rowtype;
begin
  if _step is not null and _step not in ('commande', 'prepare', 'monte') then
    raise exception 'Étape inconnue : %', _step using errcode = 'P0001';
  end if;
  select * into i from public.picking_list_items where id = _item for update;
  if not found then
    raise exception 'Ligne introuvable.' using errcode = 'P0002';
  end if;
  select * into p from public.picking_lists where id = i.picking_id for update;
  if not public.is_member(p.company_id) then
    raise exception 'Accès refusé à la société %', p.company_id using errcode = '42501';
  end if;
  if p.status = 'livre' then
    raise exception 'Préparation terminée : rouvrez-la pour la modifier.' using errcode = '42501';
  end if;
  if p.status = 'annulee' then
    raise exception 'Préparation annulée : rouvrez-la pour la modifier.' using errcode = '42501';
  end if;
  if i.prep_step is not distinct from _step then
    return;
  end if;

  update public.picking_list_items set
    prep_step    = _step,
    prep_step_at = now(),
    prep_step_by = auth.uid(),
    qty_picked   = case when _step in ('prepare', 'monte') then qty_ordered else 0 end,
    status       = case when _step in ('prepare', 'monte') then 'pret'
                        when _step = 'commande' then 'a_recevoir'
                        else 'a_preparer' end
  where id = _item;

  perform public._picking_refresh_status(p.id);
end $$;

revoke all on function public.picking_set_step(uuid, text) from public, anon;
grant execute on function public.picking_set_step(uuid, text) to authenticated;

-- 7. Emplacement de préparation (inchangé, + refus d'une liste annulée)
create or replace function public.picking_set_location(_picking uuid, _location text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p   public.picking_lists%rowtype;
  loc text := nullif(btrim(coalesce(_location, '')), '');
begin
  select * into p from public.picking_lists where id = _picking for update;
  if not found then
    raise exception 'Liste de préparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(p.company_id) then
    raise exception 'Accès refusé à la société %', p.company_id using errcode = '42501';
  end if;
  if p.status = 'annulee' then
    raise exception 'Préparation annulée : rouvrez-la pour la modifier.' using errcode = '42501';
  end if;
  if char_length(coalesce(loc, '')) > 60 then
    raise exception 'Emplacement trop long (60 caractères au plus).' using errcode = 'P0001';
  end if;
  if p.location is distinct from loc then
    update public.picking_lists set location = loc where id = _picking;
  end if;
end $$;

revoke all on function public.picking_set_location(uuid, text) from public, anon;
grant execute on function public.picking_set_location(uuid, text) to authenticated;

-- 8. Annuler ou supprimer une liste
--    Rien de préparé ni de monté (et liste non terminée) → suppression réelle,
--    tracée (événement picking_delete + audit de chaque ligne) → 'deleted'.
--    Sinon → annulation avec motif obligatoire → 'cancelled'.
create or replace function public.picking_cancel(_picking uuid, _reason text default null)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p       public.picking_lists%rowtype;
  reason  text := nullif(btrim(coalesce(_reason, '')), '');
  started boolean;
  n_items int;
begin
  select * into p from public.picking_lists where id = _picking for update;
  if not found then
    raise exception 'Liste de préparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(p.company_id) then
    raise exception 'Accès refusé à la société %', p.company_id using errcode = '42501';
  end if;
  if p.status = 'annulee' then
    raise exception 'Cette liste est déjà annulée.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(reason, '')) > 300 then
    raise exception 'Motif trop long (300 caractères au plus).' using errcode = 'P0001';
  end if;

  select coalesce(bool_or(prep_step in ('prepare', 'monte') or qty_picked > 0), false), count(*)
    into started, n_items
    from public.picking_list_items where picking_id = _picking;

  if not started and p.status <> 'livre' then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (p.company_id, auth.uid(), 'picking_delete', 'picking_lists', p.id::text, 'screen',
            to_jsonb(p) || jsonb_build_object('items', n_items), jsonb_build_object('reason', reason));
    delete from public.picking_lists where id = _picking;   -- lignes : cascade, auditées
    return 'deleted';
  end if;

  if reason is null then
    raise exception 'Des lignes sont déjà préparées ou montées : indiquez le motif de l''annulation.' using errcode = 'P0001';
  end if;
  update public.picking_lists set
    status = 'annulee', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = reason
  where id = _picking;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (p.company_id, auth.uid(), 'picking_cancel', 'picking_lists', p.id::text, 'screen',
          jsonb_build_object('status', p.status), jsonb_build_object('status', 'annulee', 'reason', reason));
  return 'cancelled';
end $$;

revoke all on function public.picking_cancel(uuid, text) from public, anon;
grant execute on function public.picking_cancel(uuid, text) to authenticated;

-- 9. Rouvrir une liste annulée ou terminée (les étapes saisies sont gardées)
create or replace function public.picking_reopen(_picking uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.picking_lists%rowtype;
begin
  select * into p from public.picking_lists where id = _picking for update;
  if not found then
    raise exception 'Liste de préparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(p.company_id) then
    raise exception 'Accès refusé à la société %', p.company_id using errcode = '42501';
  end if;
  if p.status not in ('annulee', 'livre') then
    raise exception 'Cette liste est déjà ouverte.' using errcode = 'P0001';
  end if;
  update public.picking_lists set
    status = 'en_cours', cancelled_at = null, cancelled_by = null, cancel_reason = null,
    completed_at = null, completed_by = null
  where id = _picking;
  perform public._picking_refresh_status(_picking);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (p.company_id, auth.uid(), 'picking_reopen', 'picking_lists', p.id::text, 'screen',
          jsonb_build_object('status', p.status, 'cancel_reason', p.cancel_reason),
          jsonb_build_object('status', 'en_cours'));
end $$;

revoke all on function public.picking_reopen(uuid) from public, anon;
grant execute on function public.picking_reopen(uuid) to authenticated;

-- 10. Terminer : toutes les lignes (hors retirées) préparées ou montées
create or replace function public.picking_finish(_picking uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p       public.picking_lists%rowtype;
  n_total int;
  n_left  int;
begin
  select * into p from public.picking_lists where id = _picking for update;
  if not found then
    raise exception 'Liste de préparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(p.company_id) then
    raise exception 'Accès refusé à la société %', p.company_id using errcode = '42501';
  end if;
  if p.status not in ('en_cours', 'pret') then
    raise exception 'Seule une liste en cours ou prête peut être terminée.' using errcode = 'P0001';
  end if;
  select count(*), count(*) filter (where coalesce(prep_step, '') not in ('prepare', 'monte'))
    into n_total, n_left
    from public.picking_list_items where picking_id = _picking and removed_at is null;
  if n_total = 0 then
    raise exception 'Aucune ligne à préparer.' using errcode = 'P0001';
  end if;
  if n_left > 0 then
    raise exception '% ligne(s) pas encore préparée(s) ni montée(s).', n_left using errcode = 'P0001';
  end if;
  update public.picking_lists set status = 'livre', completed_at = now(), completed_by = auth.uid()
   where id = _picking;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (p.company_id, auth.uid(), 'picking_finish', 'picking_lists', p.id::text, 'screen',
          jsonb_build_object('status', p.status), jsonb_build_object('status', 'livre'));
end $$;

revoke all on function public.picking_finish(uuid) from public, anon;
grant execute on function public.picking_finish(uuid) to authenticated;

-- 11. Régénérer depuis le document
--     Pour chaque ligne de la liste : retrouve sa ligne de document (lien, sinon même
--     article + désignation) ; quantité mise à jour ; étape GARDÉE. Sans ligne de
--     document → « retirée » (signalée, pas supprimée). Lignes nouvelles du document
--     → ajoutées. Résultat : { added, removed, restored, qty_changed, removed_lines }.
create or replace function public.picking_regenerate(_picking uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p          public.picking_lists%rowtype;
  it         record;
  lid        uuid;
  lqty       numeric;
  used       uuid[] := array[]::uuid[];
  n_added    int := 0;
  n_removed  int := 0;
  n_restored int := 0;
  n_qty      int := 0;
  removed    jsonb := '[]'::jsonb;
begin
  select * into p from public.picking_lists where id = _picking for update;
  if not found then
    raise exception 'Liste de préparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(p.company_id) then
    raise exception 'Accès refusé à la société %', p.company_id using errcode = '42501';
  end if;
  if p.document_id is null then
    raise exception 'Cette liste n''est liée à aucun document.' using errcode = 'P0001';
  end if;
  if p.status not in ('en_cours', 'pret') then
    raise exception 'Rouvrez la liste avant de la régénérer.' using errcode = 'P0001';
  end if;

  for it in
    select * from public.picking_list_items where picking_id = _picking
     order by (document_line_id is null), sort_order, created_at
  loop
    lid := null;
    -- a) lien direct vers une ligne toujours présente
    if it.document_line_id is not null then
      select l.id, l.quantity into lid, lqty from public.document_lines l
       where l.id = it.document_line_id and l.document_id = p.document_id
         and coalesce(l.line_type, 'article') = 'article' and l.quantity > 0
         and not (l.id = any(used));
    end if;
    -- b) sinon même article + désignation, ligne pas encore prise
    if lid is null then
      select l.id, l.quantity into lid, lqty from public.document_lines l
       where l.document_id = p.document_id
         and coalesce(l.line_type, 'article') = 'article' and l.quantity > 0
         and l.article_id is not distinct from it.article_id
         and l.designation is not distinct from it.designation
         and not (l.id = any(used))
         and not exists (select 1 from public.picking_list_items o
                          where o.picking_id = _picking and o.id <> it.id and o.document_line_id = l.id)
       order by l.sort_order limit 1;
    end if;

    if lid is null then
      if it.removed_at is null then
        update public.picking_list_items set removed_at = now() where id = it.id;
        n_removed := n_removed + 1;
        removed := removed || jsonb_build_object('reference', it.reference, 'designation', it.designation,
                                                 'prep_step', it.prep_step);
      end if;
    else
      used := used || lid;
      if it.removed_at is not null then n_restored := n_restored + 1; end if;
      if it.qty_ordered is distinct from lqty then n_qty := n_qty + 1; end if;
      if it.removed_at is not null or it.document_line_id is distinct from lid or it.qty_ordered is distinct from lqty then
        update public.picking_list_items set
          removed_at = null,
          document_line_id = lid,
          qty_ordered = lqty,
          qty_picked = case when prep_step in ('prepare', 'monte') then lqty else qty_picked end
        where id = it.id;
      end if;
    end if;
  end loop;

  insert into public.picking_list_items
    (company_id, picking_id, article_id, designation, reference, qty_ordered, qty_picked, status,
     document_line_id, sort_order)
  select p.company_id, _picking, l.article_id, l.designation, l.reference, l.quantity, 0, 'a_preparer',
         l.id, l.sort_order
    from public.document_lines l
   where l.document_id = p.document_id
     and coalesce(l.line_type, 'article') = 'article'
     and l.quantity > 0
     and not (l.id = any(used));
  get diagnostics n_added = row_count;

  perform public._picking_refresh_status(_picking);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (p.company_id, auth.uid(), 'picking_regenerate', 'picking_lists', p.id::text, 'screen', null,
          jsonb_build_object('added', n_added, 'removed', n_removed, 'restored', n_restored,
                             'qty_changed', n_qty, 'removed_lines', removed));

  return jsonb_build_object('added', n_added, 'removed', n_removed, 'restored', n_restored,
                            'qty_changed', n_qty, 'removed_lines', removed);
end $$;

revoke all on function public.picking_regenerate(uuid) from public, anon;
grant execute on function public.picking_regenerate(uuid) to authenticated;

-- 12. Vue d'ensemble des listes (page « Listes de préparation » et en-tête de la tablette)
create or replace function public.picking_overview(_company uuid, _picking uuid default null)
returns table (
  id uuid, company_id uuid, document_id uuid, doc_type text, doc_number text, doc_status text,
  doc_issue_date date, contact_id uuid, client_name text, vehicle_label text,
  seller_name text, seller_user_id uuid,
  location text, status text, note text, created_at timestamptz, created_by_name text,
  cancelled_at timestamptz, cancelled_by_name text, cancel_reason text,
  completed_at timestamptz, completed_by_name text,
  lines_total int, lines_ordered int, lines_prepared int, lines_mounted int, lines_removed int,
  doc_changed boolean
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select pl.id, pl.company_id, pl.document_id, d.doc_type, d.number, d.status,
         d.issue_date, d.contact_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
         coalesce(
           nullif(btrim(concat_ws(' ', v.brand, v.model, case when v.vin is not null then '· ' || v.vin end)), ''),
           (select i.designation from public.picking_list_items i
              join public.articles a on a.id = i.article_id
             where i.picking_id = pl.id and i.removed_at is null and a.mgmt_type::text in ('V', 'O', 'P', 'D')
             order by i.sort_order limit 1)),
         coalesce(nullif(btrim(sp.full_name), ''), nullif(btrim(d.operator), ''), sp.email),
         d.operator_user_id,
         pl.location, pl.status, pl.note, pl.created_at,
         coalesce(nullif(btrim(cp.full_name), ''), cp.email),
         pl.cancelled_at, coalesce(nullif(btrim(xp.full_name), ''), xp.email), pl.cancel_reason,
         pl.completed_at, coalesce(nullif(btrim(fp.full_name), ''), fp.email),
         coalesce(s.total, 0), coalesce(s.ordered, 0), coalesce(s.prepared, 0), coalesce(s.mounted, 0),
         coalesce(s.removed, 0),
         (pl.document_id is not null and (
            exists (select 1 from public.document_lines l
                     where l.document_id = pl.document_id
                       and coalesce(l.line_type, 'article') = 'article' and l.quantity > 0
                       and not exists (select 1 from public.picking_list_items i
                                        where i.picking_id = pl.id and i.document_line_id = l.id))
            or exists (select 1 from public.picking_list_items i
                        where i.picking_id = pl.id and i.removed_at is null
                          and not exists (select 1 from public.document_lines l
                                           where l.id = i.document_line_id and l.document_id = pl.document_id
                                             and l.quantity = i.qty_ordered))))
    from public.picking_lists pl
    left join public.documents d on d.id = pl.document_id
    left join public.contacts c on c.id = d.contact_id
    left join public.vehicles v on v.id = d.vehicle_id
    left join public.profiles sp on sp.id = d.operator_user_id
    left join public.profiles cp on cp.id = pl.created_by
    left join public.profiles xp on xp.id = pl.cancelled_by
    left join public.profiles fp on fp.id = pl.completed_by
    left join lateral (
      select count(*) filter (where i.removed_at is null)::int as total,
             count(*) filter (where i.removed_at is null and i.prep_step = 'commande')::int as ordered,
             count(*) filter (where i.removed_at is null and i.prep_step in ('prepare', 'monte'))::int as prepared,
             count(*) filter (where i.removed_at is null and i.prep_step = 'monte')::int as mounted,
             count(*) filter (where i.removed_at is not null)::int as removed
        from public.picking_list_items i where i.picking_id = pl.id) s on true
   where pl.company_id = _company
     and (_picking is null or pl.id = _picking)
   order by pl.created_at desc;
end $$;

revoke all on function public.picking_overview(uuid, uuid) from public, anon;
grant execute on function public.picking_overview(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
