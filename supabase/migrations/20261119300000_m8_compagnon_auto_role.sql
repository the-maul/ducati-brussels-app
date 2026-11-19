-- =====================================================================
-- M8 / M0 — Fiche compagnon automatique pour les roles atelier (19/11/2026). ATE010 B11
--
-- Retour du client : « je me suis ajoute le role mecanicien a mon compte admin et je ne me vois
-- pas apparaitre dans les compagnons a selectionner ». Le role (user_roles) ne creait aucune
-- fiche dans workshop_mechanics, d'ou vient la liste des compagnons (planning, Mon atelier,
-- operateur de l'OR). Desormais, dans chaque societe :
--   1. un compte qui recoit le role `mecanicien` ou `chef_atelier` a sa fiche compagnon, creee si
--      aucune n'existe pour ce compte : nom = full_name du profil, sinon l'e-mail ; visible au
--      planning ; horaires = ceux des autres mecaniciens actifs (jour par jour, l'horaire le plus
--      courant), a defaut mardi -> samedi 09:00-12:30 / 13:30-18:00 ;
--   2. une fiche du meme nom (sans accents, casse ni espaces doubles) qui n'a pas de compte est
--      RELIEE a ce compte au lieu d'en creer une seconde ; une fiche deja reliee mais inactive est
--      reactivee ;
--   3. le compte qui perd le dernier de ces deux roles (ou qui est supprime) voit sa fiche passer INACTIVE (jamais
--      supprimee : les pointages, les RDV et les OR la citent) ;
--   4. rattrapage : les comptes qui ont deja l'un de ces roles sans fiche en recoivent une.
--
-- Garde-fou existant workshop_mechanics_guard (le compte relie doit appartenir a la societe) :
-- il ne se verifie plus qu'a la creation ou quand le compte relie CHANGE. Sinon, retirer le
-- dernier role d'un compte (ou supprimer le compte) echouait en voulant desactiver sa fiche.
-- Lier une fiche a un compte etranger a la societe reste refuse.
--
-- Fonctions SECURITY DEFINER (search_path fixe), declenchees par le trigger de user_roles :
-- aucune politique nouvelle, aucun droit d'ecran change ; l'ecriture de user_roles reste celle
-- de user_roles_admin. EXECUTE retire a public / anon / authenticated (appel interne seulement).
-- Trace : workshop_mechanics et workshop_mechanic_hours gardent leur trigger audit_row (events).
-- Additive et rejouable. Essai a blanc : supabase/tests/m8_compagnon_auto_role.sql.
-- NON APPLIQUEE.
-- =====================================================================
set local lock_timeout = '15s';

-- ---------------------------------------------------------------------------------------------
-- Garde-fou : appartenance a la societe verifiee a la creation et au changement de compte relie.
-- ---------------------------------------------------------------------------------------------
create or replace function public.workshop_mechanics_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.user_id is not null
     and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id or new.company_id is distinct from old.company_id)
     and not exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.company_id = new.company_id) then
    raise exception 'Le membre lie au compagnon n''appartient pas a la societe.' using errcode = '23514';
  end if;
  -- Compte supprime (cle etrangere ON DELETE SET NULL) : la fiche reste, inactive.
  if tg_op = 'UPDATE' and old.user_id is not null and new.user_id is null
     and not exists (select 1 from auth.users u where u.id = old.user_id) then
    new.is_active := false;
  end if;
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception 'Le nom du compagnon est obligatoire.' using errcode = '23514';
  end if;
  return new;
end $function$;

-- Nom compare sans accents, casse ni espaces doubles (miroir de normName() du lot F).
create or replace function public.workshop_mechanic_norm_name(_name text)
returns text
language sql
immutable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select lower(btrim(regexp_replace(translate(coalesce(_name, ''),
    'àâäáãåçèéêëìíîïñòóôöõùúûüýÿÀÂÄÁÃÅÇÈÉÊËÌÍÎÏÑÒÓÔÖÕÙÚÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'), '\s+', ' ', 'g')));
$function$;

-- ---------------------------------------------------------------------------------------------
-- Horaires par defaut d'une nouvelle fiche : jour par jour, l'horaire le plus courant des autres
-- mecaniciens actifs de la societe (un jour n'est repris que si au moins la moitie d'entre eux y
-- travaillent) ; aucun horaire connu : mardi -> samedi 09:00-12:30 / 13:30-18:00.
-- ---------------------------------------------------------------------------------------------
create or replace function public.workshop_mechanic_default_hours(_company uuid, _except uuid)
returns table (weekday smallint, am_start time, am_end time, pm_start time, pm_end time)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare _ref int;
begin
  select count(distinct h.mechanic_id) into _ref
  from public.workshop_mechanic_hours h
  join public.workshop_mechanics m on m.id = h.mechanic_id
  where m.company_id = _company and m.is_active and m.id <> coalesce(_except, '00000000-0000-0000-0000-000000000000'::uuid);

  if coalesce(_ref, 0) = 0 then
    return query
      select d::smallint, '09:00'::time, '12:30'::time, '13:30'::time, '18:00'::time
      from generate_series(2, 6) d;
    return;
  end if;

  return query
    select x.weekday, x.am_start, x.am_end, x.pm_start, x.pm_end
    from (
      select distinct on (h.weekday) h.weekday, h.am_start, h.am_end, h.pm_start, h.pm_end, count(*) as c
      from public.workshop_mechanic_hours h
      join public.workshop_mechanics m on m.id = h.mechanic_id
      where m.company_id = _company and m.is_active and m.id <> coalesce(_except, '00000000-0000-0000-0000-000000000000'::uuid)
      group by h.weekday, h.am_start, h.am_end, h.pm_start, h.pm_end
      order by h.weekday, count(*) desc, h.am_start nulls last
    ) x
    join lateral (
      select count(distinct h2.mechanic_id) as n
      from public.workshop_mechanic_hours h2
      join public.workshop_mechanics m2 on m2.id = h2.mechanic_id
      where m2.company_id = _company and m2.is_active and h2.weekday = x.weekday
        and m2.id <> coalesce(_except, '00000000-0000-0000-0000-000000000000'::uuid)
    ) w on true
    where w.n * 2 >= _ref
    order by x.weekday;
end $function$;

-- ---------------------------------------------------------------------------------------------
-- Synchronise la fiche compagnon d'UN compte dans UNE societe avec ses roles atelier.
-- Renvoie l'id de la fiche (ou null si le compte n'a ni role atelier ni fiche).
-- ---------------------------------------------------------------------------------------------
create or replace function public.workshop_mechanic_sync(_user uuid, _company uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  _has boolean;
  _id uuid;
  _name text;
begin
  if _user is null or _company is null then return null; end if;

  _has := exists (select 1 from public.user_roles ur
                  where ur.user_id = _user and ur.company_id = _company and ur.role in ('mecanicien', 'chef_atelier'));

  select m.id into _id from public.workshop_mechanics m where m.company_id = _company and m.user_id = _user;

  if not _has then
    -- Role retire : la fiche reste (historique), elle passe inactive.
    if _id is not null then
      update public.workshop_mechanics set is_active = false where id = _id and is_active;
    end if;
    return _id;
  end if;

  if _id is not null then
    update public.workshop_mechanics set is_active = true where id = _id and not is_active;
    return _id;
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''), u.email, 'Mecanicien')
    into _name
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = _user;
  _name := coalesce(_name, 'Mecanicien');

  -- Une fiche du meme nom sans compte : on la relie (la plus ancienne, active d'abord).
  select m.id into _id
  from public.workshop_mechanics m
  where m.company_id = _company and m.user_id is null
    and public.workshop_mechanic_norm_name(m.name) = public.workshop_mechanic_norm_name(_name)
  order by m.is_active desc, m.created_at, m.id
  limit 1;

  if _id is not null then
    update public.workshop_mechanics set user_id = _user, is_active = true where id = _id;
    return _id;
  end if;

  insert into public.workshop_mechanics (company_id, user_id, name, visible_in_planning, is_active, sort_order)
  values (_company, _user, _name, true, true,
          coalesce((select max(m.sort_order) from public.workshop_mechanics m where m.company_id = _company), 0) + 10)
  on conflict (company_id, user_id) where user_id is not null do nothing
  returning id into _id;

  if _id is null then -- course : une autre transaction vient de la creer
    select m.id into _id from public.workshop_mechanics m where m.company_id = _company and m.user_id = _user;
    return _id;
  end if;

  insert into public.workshop_mechanic_hours (company_id, mechanic_id, weekday, am_start, am_end, pm_start, pm_end)
  select _company, _id, d.weekday, d.am_start, d.am_end, d.pm_start, d.pm_end
  from public.workshop_mechanic_default_hours(_company, _id) d
  on conflict (mechanic_id, weekday) do nothing;

  return _id;
end $function$;

-- ---------------------------------------------------------------------------------------------
-- Trigger de user_roles : ajout, retrait ou changement d'un role atelier.
-- ---------------------------------------------------------------------------------------------
create or replace function public.trg_user_roles_mechanic_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.role in ('mecanicien', 'chef_atelier') then
    perform public.workshop_mechanic_sync(old.user_id, old.company_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.role in ('mecanicien', 'chef_atelier') then
    perform public.workshop_mechanic_sync(new.user_id, new.company_id);
  end if;
  return null;
end $function$;

drop trigger if exists trg_user_roles_mechanic_sync on public.user_roles;
create trigger trg_user_roles_mechanic_sync
  after insert or update or delete on public.user_roles
  for each row execute function public.trg_user_roles_mechanic_sync();

revoke all on function public.workshop_mechanic_sync(uuid, uuid) from public, anon, authenticated;
revoke all on function public.workshop_mechanic_default_hours(uuid, uuid) from public, anon, authenticated;
revoke all on function public.trg_user_roles_mechanic_sync() from public, anon, authenticated;

comment on function public.workshop_mechanic_sync(uuid, uuid) is
  'Fiche compagnon d''un compte dans une societe selon ses roles atelier (mecanicien, chef_atelier) : creee ou reliee (meme nom sans compte), reactivee, ou rendue inactive si le role est retire (jamais supprimee). 19/11/2026.';

-- ---------------------------------------------------------------------------------------------
-- Rattrapage : comptes qui ont deja un role atelier sans fiche (ou avec une fiche inactive).
-- ---------------------------------------------------------------------------------------------
select public.workshop_mechanic_sync(r.user_id, r.company_id)
from (select distinct ur.user_id, ur.company_id from public.user_roles ur
      where ur.role in ('mecanicien', 'chef_atelier')) r
where not exists (select 1 from public.workshop_mechanics m
                  where m.company_id = r.company_id and m.user_id = r.user_id and m.is_active);
