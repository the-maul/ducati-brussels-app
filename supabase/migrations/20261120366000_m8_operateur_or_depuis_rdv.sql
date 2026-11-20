-- =====================================================================
-- M8 — L'OR ne depuis un RDV prend le COMPTE du compagnon (constat du 20/11/2026, revue UX n° 6). ATE001b
--
-- Constat : OR TESTOR-2026-00001 (ItalTest), ne du RDV de John : operateur « John (saisi a la main) ».
-- Cause : la fiche compagnon « John » (workshop_mechanics) n'est reliee a AUCUN compte (user_id
-- vide, comme Livio et Luis, dans les deux societes). L'ecran du planning passe deja le compte
-- quand la fiche en a un (planning/api.ts, createOrFromPlanningAppointment) ; sans compte, l'OR ne
-- peut garder que le nom. Et si la fiche est reliee plus tard (role mecanicien donne au compte,
-- 20261119300000), les OR deja ouverts restaient au nom seul.
--
-- La base garantit desormais le lien, quel que soit l'ecran qui ouvre l'OR :
--   1. RDV relie a un OR (insert ou changement de or_id) : si l'OR n'a pas d'operateur-compte et
--      que le compagnon du RDV a un compte membre de la societe, l'OR prend ce compte (et son nom) ;
--   2. fiche compagnon reliee a un compte (user_id pose ou change) : les OR OUVERTS de ses RDV, et
--      ceux qui portent son nom en texte sans compte, prennent ce compte ;
--   3. rattrapage des OR ouverts deja nes d'un RDV dont le compagnon a un compte.
-- Jamais d'ecrasement d'un operateur-compte deja choisi ; OR factures / annules intouches.
-- Trace : chaque OR modifie passe par audit_row (events), comme une modification a l'ecran.
-- Fonctions SECURITY DEFINER (search_path fixe), EXECUTE retire : appel par trigger seulement.
-- Additive et rejouable. Essai a blanc : supabase/tests/m8_operateur_or_depuis_rdv.sql.
-- =====================================================================
set local lock_timeout = '15s';

-- Le compte d'un compagnon, s'il est membre de la societe (sinon null : le garde-fou refuserait).
create or replace function public._workshop_mechanic_account(_mechanic uuid, _company uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.user_id
    from public.workshop_mechanics m
   where m.id = _mechanic and m.user_id is not null
     and exists (select 1 from public.user_roles ur where ur.user_id = m.user_id and ur.company_id = _company)
$$;
revoke all on function public._workshop_mechanic_account(uuid, uuid) from public, anon, authenticated;

-- Normalisation des noms (sans accents, casse ni espaces doubles), comme 20261119300000.
create or replace function public._workshop_name_key(_s text)
returns text
language sql immutable set search_path = public, pg_temp as $$
  select lower(regexp_replace(btrim(translate(coalesce(_s, ''),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '\s+', ' ', 'g'))
$$;
revoke all on function public._workshop_name_key(text) from public, anon;

-- 1. RDV -> OR
create or replace function public.workshop_appointments_operator_to_or()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare _uid uuid; _name text;
begin
  if new.or_id is null or new.mechanic_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.or_id is not distinct from old.or_id
     and new.mechanic_id is not distinct from old.mechanic_id then
    return new;
  end if;
  _uid := public._workshop_mechanic_account(new.mechanic_id, new.company_id);
  if _uid is null then return new; end if;
  select m.name into _name from public.workshop_mechanics m where m.id = new.mechanic_id;
  update public.repair_orders r
     set operator_id = _uid,
         operator = coalesce(nullif(btrim(r.operator), ''), _name)
   where r.id = new.or_id and r.company_id = new.company_id
     and r.operator_id is null
     and r.status not in ('facture', 'annule');
  return new;
end $$;
revoke all on function public.workshop_appointments_operator_to_or() from public, anon, authenticated;

drop trigger if exists trg_appointments_operator_to_or on public.workshop_appointments;
create trigger trg_appointments_operator_to_or
  after insert or update of or_id, mechanic_id on public.workshop_appointments
  for each row execute function public.workshop_appointments_operator_to_or();

-- 2. Fiche compagnon reliee a un compte -> ses OR ouverts
create or replace function public.workshop_mechanics_account_to_ors()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare _uid uuid;
begin
  if new.user_id is null or (tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id) then
    return new;
  end if;
  _uid := public._workshop_mechanic_account(new.id, new.company_id);
  if _uid is null then return new; end if;
  update public.repair_orders r
     set operator_id = _uid
   where r.company_id = new.company_id
     and r.operator_id is null
     and r.status not in ('facture', 'annule')
     and (exists (select 1 from public.workshop_appointments a
                   where a.or_id = r.id and a.mechanic_id = new.id)
          or (nullif(btrim(r.operator), '') is not null
              and public._workshop_name_key(r.operator) = public._workshop_name_key(new.name)));
  return new;
end $$;
revoke all on function public.workshop_mechanics_account_to_ors() from public, anon, authenticated;

drop trigger if exists trg_workshop_mechanics_account_to_ors on public.workshop_mechanics;
create trigger trg_workshop_mechanics_account_to_ors
  after insert or update of user_id on public.workshop_mechanics
  for each row execute function public.workshop_mechanics_account_to_ors();

-- 3. Rattrapage : OR ouverts nes d'un RDV dont le compagnon a un compte
update public.repair_orders r
   set operator_id = x.uid,
       operator = coalesce(nullif(btrim(r.operator), ''), x.name)
  from (select distinct on (a.or_id) a.or_id, m.name,
               public._workshop_mechanic_account(a.mechanic_id, a.company_id) as uid
          from public.workshop_appointments a
          join public.workshop_mechanics m on m.id = a.mechanic_id
         where a.or_id is not null
         order by a.or_id, a.updated_at desc) x
 where r.id = x.or_id and x.uid is not null
   and r.operator_id is null
   and r.status not in ('facture', 'annule');

comment on function public.workshop_appointments_operator_to_or() is
  'RDV relie a un OR : l''OR sans operateur-compte prend le compte du compagnon du RDV (constat du 20/11/2026).';
comment on function public.workshop_mechanics_account_to_ors() is
  'Fiche compagnon reliee a un compte : ses OR ouverts (par RDV ou par nom) prennent ce compte (constat du 20/11/2026).';
