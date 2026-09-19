-- =====================================================================
-- Mission 05 — carte 6 « Liste de préparation en un clic, sur tablette »
--
-- Domenico (vidéo G8, 5:26 et 5:53) : générer la pick list en un clic, sans
-- rentrer dans le document, et l'avoir sur tablette : disponible, commandé,
-- préparé, monté ; où c'est dans le stock et où c'est quand c'est préparé.
--
-- Ce lot réutilise les tables existantes picking_lists / picking_list_items
-- (migration 20260726120000) et ajoute :
--   - une seule liste de préparation par document (index unique) ;
--   - sur chaque ligne : le lien vers la ligne du document, l'étape de
--     préparation (commandé → préparé → monté) avec qui / quand ;
--   - la trace de toute écriture dans events (trigger audit_row existant) ;
--   - picking_open_for_document : crée ou rouvre la liste d'un document
--     (lignes article seulement : pas de texte, ligne vide ni main-d'œuvre) ;
--   - picking_set_step / picking_set_location : seules écritures de l'écran
--     tablette ;
--   - picking_detail : lignes avec casiers et triple stock.
--
-- Stock : AUCUN mouvement. Changer d'étape ne réserve ni ne sort rien ; les
-- règles de stock restent celles des documents (RES/BL réservent, FAC sort).
-- « Disponible » / « En commande » sont calculés, pas saisis.
--
-- Additif : 5 colonnes, 1 index, 2 triggers d'audit, 4 fonctions.
-- =====================================================================

-- 1. Colonnes de préparation sur les lignes
alter table public.picking_list_items
  add column if not exists document_line_id uuid references public.document_lines(id) on delete set null,
  add column if not exists prep_step text,
  add column if not exists prep_step_at timestamptz,
  add column if not exists prep_step_by uuid references auth.users(id) on delete set null,
  add column if not exists sort_order int not null default 0;

do $$ begin
  alter table public.picking_list_items
    add constraint picking_list_items_prep_step_chk check (prep_step is null or prep_step in ('commande', 'prepare', 'monte'));
exception when duplicate_object then null; end $$;

create index if not exists idx_picking_list_items_docline on public.picking_list_items(document_line_id);

-- 2. Une seule liste de préparation par document (le bouton « Préparer » la rouvre)
create unique index if not exists picking_lists_document_uniq
  on public.picking_lists(document_id) where document_id is not null;

-- 3. Trace de toute écriture (qui, quand, ancien → nouveau) dans events
drop trigger if exists trg_picking_lists_audit on public.picking_lists;
create trigger trg_picking_lists_audit after insert or update or delete on public.picking_lists
  for each row execute function public.audit_row();
drop trigger if exists trg_picking_list_items_audit on public.picking_list_items;
create trigger trg_picking_list_items_audit after insert or update or delete on public.picking_list_items
  for each row execute function public.audit_row();

-- 4. Créer ou rouvrir la liste de préparation d'un document
create or replace function public.picking_open_for_document(_document uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d   public.documents%rowtype;
  pid uuid;
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

  -- deux clics simultanés ne créent pas deux listes
  perform pg_advisory_xact_lock(hashtext('picking:' || _document::text));

  select id into pid from public.picking_lists where document_id = _document;
  if pid is null then
    insert into public.picking_lists (company_id, document_id, created_by)
    values (d.company_id, _document, auth.uid())
    returning id into pid;
  end if;

  -- Lignes à préparer : articles seulement (moto + options), pas de texte,
  -- de ligne vide ni de main-d'œuvre. Les lignes ajoutées au document depuis
  -- la dernière ouverture sont ajoutées ; rien n'est supprimé.
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
               -- listes créées avant ce lot (sans lien de ligne)
               or (i.document_line_id is null
                   and i.article_id is not distinct from l.article_id
                   and i.designation is not distinct from l.designation)));

  return pid;
end $$;

revoke all on function public.picking_open_for_document(uuid) from public, anon;
grant execute on function public.picking_open_for_document(uuid) to authenticated;

-- 5. Étape d'une ligne : null (retour au calcul du stock) / commandé / préparé / monté
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
    raise exception 'Préparation déjà livrée : elle ne se modifie plus.' using errcode = '42501';
  end if;
  if i.prep_step is not distinct from _step then
    return;
  end if;

  -- Statut historique de la ligne tenu à jour (compteur « Prêts / Total » de la liste)
  update public.picking_list_items set
    prep_step    = _step,
    prep_step_at = now(),
    prep_step_by = auth.uid(),
    qty_picked   = case when _step in ('prepare', 'monte') then qty_ordered
                        when _step is null or _step = 'commande' then 0 else qty_picked end,
    status       = case when _step in ('prepare', 'monte') then 'pret'
                        when _step = 'commande' then 'a_recevoir'
                        else 'a_preparer' end
  where id = _item;

  -- Toutes les lignes préparées ou montées → la liste passe « Prête » ; sinon « En cours »
  update public.picking_lists l set status = x.st
    from (select case when bool_and(coalesce(prep_step in ('prepare', 'monte'), false)) then 'pret' else 'en_cours' end as st
            from public.picking_list_items where picking_id = p.id) x
   where l.id = p.id and l.status <> x.st and l.status <> 'livre';
end $$;

revoke all on function public.picking_set_step(uuid, text) from public, anon;
grant execute on function public.picking_set_step(uuid, text) to authenticated;

-- 6. Emplacement de préparation du client (texte libre ou casier)
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
  if char_length(coalesce(loc, '')) > 60 then
    raise exception 'Emplacement trop long (60 caractères au plus).' using errcode = 'P0001';
  end if;
  if p.location is distinct from loc then
    update public.picking_lists set location = loc where id = _picking;
  end if;
end $$;

revoke all on function public.picking_set_location(uuid, text) from public, anon;
grant execute on function public.picking_set_location(uuid, text) to authenticated;

-- 7. Lignes d'une liste avec casiers, triple stock et auteur de l'étape
create or replace function public.picking_detail(_picking uuid)
returns table (
  id uuid, picking_id uuid, article_id uuid, document_line_id uuid,
  reference text, designation text, qty_ordered numeric, qty_picked numeric, status text,
  prep_step text, prep_step_at timestamptz, prep_step_by_name text, sort_order int,
  mgmt_type text, bins text[],
  real_qty numeric, reserved_qty numeric, on_order_qty numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cid uuid;
begin
  select l.company_id into cid from public.picking_lists l where l.id = _picking;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select i.id, i.picking_id, i.article_id, i.document_line_id,
         coalesce(i.reference, a.reference), i.designation, i.qty_ordered, i.qty_picked, i.status,
         i.prep_step, i.prep_step_at,
         coalesce(nullif(btrim(pr.full_name), ''), pr.email),
         i.sort_order,
         a.mgmt_type::text,
         case when a.id is null then array[]::text[] else array(
           select distinct x.b from (
             select nullif(btrim(a.bin_location), '') as b
             union all select nullif(btrim(a.bin_location2), '')
             union all select nullif(btrim(ab.bin_location), '') from public.article_bins ab where ab.article_id = a.id
           ) x where x.b is not null order by x.b) end,
         st.real_qty, st.reserved_qty, oo.q
    from public.picking_list_items i
    left join public.articles a on a.id = i.article_id
    left join public.profiles pr on pr.id = i.prep_step_by
    left join lateral public.article_stock(i.article_id) st on a.id is not null
    left join lateral (select public._article_on_order_qty(i.article_id) as q) oo on a.id is not null
   where i.picking_id = _picking
   order by i.sort_order, i.created_at;
end $$;

revoke all on function public.picking_detail(uuid) from public, anon;
grant execute on function public.picking_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
