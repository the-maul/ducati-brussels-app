-- =====================================================================
-- M1 — Le nom de la fiche PRO est repris de sa fiche PRIVÉE liée.
-- Retour de Simon du 05/10 : « si je lie un compte privé à un compte pro, les
-- champs prénom et nom du compte pro se mettent à jour avec les infos du privé
-- et les champs deviennent grisés (sauf si je délie la fiche privée) ».
--
-- Choix : DÉCLENCHEUR EN BASE, pas seulement l'écran. La personne physique est la
-- source unique du prénom/nom ; si la règle ne vivait que dans le formulaire, un
-- import, une action groupée, la fusion de doublons ou l'espace client pourraient
-- réécrire le nom du pro en silence. Ici la base garantit l'invariant.
--
-- Règle (3 déclencheurs) :
--   1. `contacts` BEFORE UPDATE OF first_name, last_name — si la fiche est verrouillée
--      (pro + exactement UNE fiche privée liée nommée), le prénom/nom repris est
--      réimposé : les champs sont réellement non modifiables, écran ou pas.
--   2. `contacts` AFTER UPDATE — si le nom d'une fiche PRIVÉE change, les fiches pro
--      liées sont mises à jour (source unique) et une ligne `events` est écrite.
--   3. `contact_links` AFTER INSERT / DELETE — reprise à la liaison, libération à la
--      déliaison, trace `events` dans les deux cas.
--
-- Non verrouillé (et donc modifiable, l'écran le dit) :
--   - fiche non pro (particulier, employé) ;
--   - PLUSIEURS fiches privées liées (un couple, une société à deux gérants) ;
--   - la fiche privée liée n'a ni nom ni prénom (on ne vide jamais le nom du pro).
-- La déliaison ne remet pas l'ancien nom : elle rend simplement les champs modifiables.
--
-- Non destructif : aucune colonne supprimée, aucune donnée effacée.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fiche privée source du nom, ou NULL si la fiche n'est pas verrouillée.
--    Une seule définition, partagée par les déclencheurs ET par l'écran
--    (RPC `contact_name_source_id`) : l'écran ne peut pas diverger de la base.
-- ---------------------------------------------------------------------
create or replace function public.contact_name_source(_contact uuid)
returns public.contacts
language sql
stable
set search_path = public, pg_temp
as $fn$
  with priv as (
    select p.*
    from public.contact_links l
    join public.contacts p
      on p.id = case when l.contact_a = _contact then l.contact_b else l.contact_a end
    where (l.contact_a = _contact or l.contact_b = _contact)
      and p.type = 'particulier'
      -- Une fiche privée sans nom ni prénom n'est pas une source : sinon lier une
      -- fiche vierge viderait le nom du pro.
      and coalesce(nullif(btrim(p.last_name), ''), nullif(btrim(p.first_name), '')) is not null
  )
  select p.*
  from priv p
  where (select c.type from public.contacts c where c.id = _contact)
        in ('professionnel', 'fournisseur', 'banque_leasing')
    -- Plusieurs fiches privées liées : pas de source unique, on laisse modifiable.
    and (select count(*) from priv) = 1;
$fn$;
revoke execute on function public.contact_name_source(uuid) from public, anon;
grant execute on function public.contact_name_source(uuid) to authenticated, service_role;

-- Version légère pour l'écran : l'id de la fiche privée source (ou NULL).
create or replace function public.contact_name_source_id(_contact uuid)
returns uuid
language sql
stable
set search_path = public, pg_temp
as $fn$
  select (public.contact_name_source(_contact)).id;
$fn$;
revoke execute on function public.contact_name_source_id(uuid) from public, anon;
grant execute on function public.contact_name_source_id(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Déclencheur 1 — prénom/nom non modifiables sur une fiche verrouillée.
--    `WHEN` sur le changement de nom : aucun surcoût sur les autres mises à jour.
-- ---------------------------------------------------------------------
create or replace function public._contacts_force_linked_name()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  _src public.contacts;
begin
  _src := public.contact_name_source(new.id);
  if _src.id is not null then
    new.first_name := _src.first_name;
    new.last_name  := _src.last_name;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_contacts_force_linked_name on public.contacts;
create trigger trg_contacts_force_linked_name
  before update of first_name, last_name on public.contacts
  for each row
  when (old.first_name is distinct from new.first_name
        or old.last_name is distinct from new.last_name)
  execute function public._contacts_force_linked_name();

-- ---------------------------------------------------------------------
-- 3. Reprise du nom sur une fiche pro (et trace). Idempotent : ne touche rien
--    si le nom est déjà celui de la fiche privée.
-- ---------------------------------------------------------------------
create or replace function public._contact_apply_linked_name(_contact uuid, _reason text)
returns void
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  _src public.contacts;
  _me  public.contacts;
begin
  select * into _me from public.contacts where id = _contact;
  if _me.id is null then return; end if;
  _src := public.contact_name_source(_contact);
  if _src.id is null then return; end if;
  if _me.first_name is not distinct from _src.first_name
     and _me.last_name is not distinct from _src.last_name then
    return;
  end if;

  -- Le BEFORE trigger réimposera les mêmes valeurs : écriture volontairement explicite
  -- pour que la ligne `events` ci-dessous dise d'où vient le nom.
  update public.contacts
     set first_name = _src.first_name,
         last_name  = _src.last_name
   where id = _contact;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (
    _me.company_id, auth.uid(), 'contact_linked_name_applied', 'contacts', _contact::text, 'system',
    jsonb_build_object('first_name', _me.first_name, 'last_name', _me.last_name),
    jsonb_build_object(
      'first_name', _src.first_name, 'last_name', _src.last_name,
      'source_contact_id', _src.id, 'source_code', _src.code, 'reason', _reason
    )
  );
end;
$fn$;
-- `authenticated` doit garder l'exécution : les déclencheurs ci-dessous sont
-- SECURITY INVOKER et tournent donc sous le rôle de l'utilisateur connecté.
revoke execute on function public._contact_apply_linked_name(uuid, text) from public, anon;
grant execute on function public._contact_apply_linked_name(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Déclencheur 2 — le nom change sur la fiche PRIVÉE → les fiches pro liées suivent.
--    Garde sur `type = 'particulier'` : une fiche pro ne propage rien, donc pas de
--    récursion entre les deux déclencheurs.
-- ---------------------------------------------------------------------
create or replace function public._contacts_propagate_name_to_links()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  _other uuid;
begin
  if new.type <> 'particulier' then return null; end if;
  for _other in
    select case when l.contact_a = new.id then l.contact_b else l.contact_a end
    from public.contact_links l
    where l.contact_a = new.id or l.contact_b = new.id
  loop
    perform public._contact_apply_linked_name(_other, 'source_renamed');
  end loop;
  return null;
end;
$fn$;

drop trigger if exists trg_contacts_propagate_name_to_links on public.contacts;
create trigger trg_contacts_propagate_name_to_links
  after update of first_name, last_name on public.contacts
  for each row
  when (old.first_name is distinct from new.first_name
        or old.last_name is distinct from new.last_name)
  execute function public._contacts_propagate_name_to_links();

-- ---------------------------------------------------------------------
-- 5. Déclencheur 3 — liaison / déliaison : reprise du nom + trace `events`.
-- ---------------------------------------------------------------------
create or replace function public._contact_links_after_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  _a       uuid;
  _b       uuid;
  _company uuid;
  _link    uuid;
  _added   boolean := (tg_op = 'INSERT');
begin
  -- OLD / NEW ne sont pas lisibles indifféremment (OLD n'est pas affecté sur INSERT,
  -- NEW ne l'est pas sur DELETE) : on recopie dans des variables avant toute logique.
  if _added then
    _a := new.contact_a; _b := new.contact_b; _company := new.company_id; _link := new.id;
  else
    _a := old.contact_a; _b := old.contact_b; _company := old.company_id; _link := old.id;
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  select _company, auth.uid(),
         case when _added then 'contact_link_created' else 'contact_link_removed' end,
         'contacts', e.id::text, 'screen',
         case when _added then null
              else jsonb_build_object('linked_contact_id', e.other, 'link_id', _link) end,
         case when _added then jsonb_build_object('linked_contact_id', e.other, 'link_id', _link)
              else null end
  from (values (_a, _b), (_b, _a)) as e(id, other);

  -- Les deux extrémités sont réévaluées : lier peut verrouiller le pro, délier peut
  -- faire passer un pro de « deux fiches privées » à « une seule » et donc le verrouiller.
  perform public._contact_apply_linked_name(_a, case when _added then 'linked' else 'unlinked' end);
  perform public._contact_apply_linked_name(_b, case when _added then 'linked' else 'unlinked' end);
  return null;
end;
$fn$;

drop trigger if exists trg_contact_links_after_change on public.contact_links;
create trigger trg_contact_links_after_change
  after insert or delete on public.contact_links
  for each row execute function public._contact_links_after_change();

-- ---------------------------------------------------------------------
-- 6. Reprise sur l'existant (mesuré avant pose : 8 141 fiches, 5 liens,
--    9 fiches liées, 4 paires privé ↔ société, 4 fiches pro à renommer).
-- ---------------------------------------------------------------------
do $$
declare
  _id uuid;
begin
  for _id in
    select distinct x.id from (
      select contact_a as id from public.contact_links
      union all select contact_b from public.contact_links
    ) x
  loop
    perform public._contact_apply_linked_name(_id, 'backfill');
  end loop;
end $$;

notify pgrst, 'reload schema';
