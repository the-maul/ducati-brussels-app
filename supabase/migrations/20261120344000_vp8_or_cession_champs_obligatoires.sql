-- =====================================================================
-- VP8 — Champs obligatoires de l'OR et de la cession, comme G8 (décision du client, 20/11/2026 :
-- « tout comme G8 »). ATE017 ATE089 B8
--
-- G8 : un OR exige l'opérateur, le client et le n° de série (la moto) ; une cession exige le type,
-- l'opérateur et le n° de série. Le DMS acceptait un OR sans client ni moto (km exigé seulement si
-- une moto est choisie) et une cession VO sans moto.
--
-- OR — déclencheur trg_repair_orders_aa_required_g8 (BEFORE INSERT / UPDATE OF contact_id,
-- vehicle_id, operator, operator_id ; nommé pour passer AVANT le garde de l'opérateur et le km) :
--   - écritures d'un utilisateur connecté seulement (auth.uid() renseigné : écran, RDV → OR du
--     planning, copie d'OR, tablette atelier) ; les fonctions serveur et imports (sans utilisateur)
--     ne sont pas bloqués ;
--   - à la création, valeurs par défaut G8 avant le contrôle :
--       opérateur vide → l'utilisateur connecté (operator_id + son nom, jamais un e-mail) ;
--       client vide et moto choisie → le propriétaire actuel de la moto (vehicle_owners) ;
--   - contrôle : à la création, opérateur + client + moto obligatoires ; à la modification, on ne
--     peut plus RETIRER un client, une moto ou un opérateur déjà posés. Les OR existants incomplets
--     (6 OR sans client chez ITALBIKE STORE) ne sont pas bloqués rétroactivement : ils se modifient,
--     l'écran demande de compléter.
--   Message FR clair ; hint « repair_order_required », detail = champs manquants
--   (operator, contact, vehicle) : l'écran le traduit en FR / NL / EN / IT.
--
-- Cession — déclencheur trg_icession_aa_required_g8 (BEFORE INSERT / UPDATE OF cession_type,
-- vehicle_id, operator_id, operator_name) :
--   - opérateur vide à la création, utilisateur connecté → l'utilisateur connecté (les cessions
--     ouvertes d'office par la reprise et le dépôt-vente reçoivent aussi l'opérateur qui valide) ;
--   - cessions ouvertes à l'écran (origin = 'screen', utilisateur connecté) : type et opérateur
--     obligatoires ; moto (n° de série) obligatoire pour les types qui la demandent : réglage par
--     type (Paramètres → Tables → Types de cession, extra.requires_vehicle), posé à « oui » pour
--     01 Cession VO et 02 Cession VN / Démo ; les cessions sans moto (besoin atelier, geste
--     commercial, garantie…) restent possibles. Hint « cession_required », detail
--     (type, operator, vehicle).
--
-- Additive, rejouable. Essai à blanc : supabase/tests/vp8_champs_obligatoires.sql. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '5s';

-- Nom à imprimer pour l'utilisateur connecté, comme au comptoir (Q63) : son opérateur G8 relié
-- (Paramètres → Tables → Opérateurs), sinon le nom du profil — jamais un e-mail.
create or replace function public._operator_display_name(_company uuid, _user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce((select nullif(btrim(rv.label), '') from public.reference_values rv
                    where rv.id = public.sales_operator_for_user(_company, _user)),
                  public.person_display_name(_user));
$fn$;
revoke all on function public._operator_display_name(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ OR
create or replace function public.repair_orders_required_g8()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare missing text[] := '{}'; _uid uuid := auth.uid();
begin
  if _uid is null then return new; end if;                    -- fonctions serveur, imports

  if tg_op = 'INSERT' then
    if new.operator_id is null and nullif(btrim(coalesce(new.operator, '')), '') is null
       and exists (select 1 from public.user_roles ur where ur.user_id = _uid and ur.company_id = new.company_id) then
      new.operator_id := _uid;
      new.operator := public._operator_display_name(new.company_id, _uid);
    end if;
    if new.contact_id is null and new.vehicle_id is not null then
      select o.contact_id into new.contact_id from public.vehicle_owners o
       where o.vehicle_id = new.vehicle_id and o.is_current and o.contact_id is not null
       order by o.from_date desc nulls last limit 1;
    end if;
    if new.operator_id is null and nullif(btrim(coalesce(new.operator, '')), '') is null then missing := missing || 'operator'::text; end if;
    if new.contact_id is null then missing := missing || 'contact'::text; end if;
    if new.vehicle_id is null then missing := missing || 'vehicle'::text; end if;
  else
    if new.operator_id is null and nullif(btrim(coalesce(new.operator, '')), '') is null
       and (old.operator_id is not null or nullif(btrim(coalesce(old.operator, '')), '') is not null) then
      missing := missing || 'operator'::text;
    end if;
    if new.contact_id is null and old.contact_id is not null then missing := missing || 'contact'::text; end if;
    if new.vehicle_id is null and old.vehicle_id is not null then missing := missing || 'vehicle'::text; end if;
  end if;

  if array_length(missing, 1) > 0 then
    raise exception 'OR : compléter %.',
      array_to_string(array(select case m when 'operator' then 'Opérateur' when 'contact' then 'Client'
                                          else 'N° de série (moto)' end from unnest(missing) m), ', ')
      using errcode = '23514', hint = 'repair_order_required', detail = array_to_string(missing, ',');
  end if;
  return new;
end $fn$;
revoke all on function public.repair_orders_required_g8() from public, anon, authenticated;

drop trigger if exists trg_repair_orders_aa_required_g8 on public.repair_orders;
create trigger trg_repair_orders_aa_required_g8
  before insert or update of contact_id, vehicle_id, operator, operator_id on public.repair_orders
  for each row execute function public.repair_orders_required_g8();

-- ------------------------------------------------------------------ Cession
-- Types qui demandent une moto (réglage modifiable, posé seulement s'il est absent).
update public.reference_values rv
   set extra = rv.extra || jsonb_build_object('requires_vehicle', rv.code in ('01', '02'))
 where rv.table_key = 'cession_type' and not (rv.extra ? 'requires_vehicle');

create or replace function public.internal_cessions_required_g8()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare missing text[] := '{}'; _uid uuid := auth.uid(); _needs boolean;
begin
  if _uid is null then return new; end if;

  if tg_op = 'INSERT' and new.operator_id is null and nullif(btrim(coalesce(new.operator_name, '')), '') is null
     and exists (select 1 from public.user_roles ur where ur.user_id = _uid and ur.company_id = new.company_id) then
    new.operator_id := _uid;
    new.operator_name := public._operator_display_name(new.company_id, _uid);
  end if;

  if coalesce(new.origin, 'screen') <> 'screen' then return new; end if;   -- ouvertes d'office (reprise, dépôt, garantie)

  if nullif(btrim(coalesce(new.cession_type, '')), '') is null then missing := missing || 'type'::text; end if;
  if new.operator_id is null and nullif(btrim(coalesce(new.operator_name, '')), '') is null
     and (tg_op = 'INSERT' or old.operator_id is not null or nullif(btrim(coalesce(old.operator_name, '')), '') is not null) then
    missing := missing || 'operator'::text;
  end if;
  select coalesce((rv.extra->>'requires_vehicle')::boolean, false) into _needs
    from public.reference_values rv
   where rv.company_id = new.company_id and rv.table_key = 'cession_type' and rv.code = new.cession_type limit 1;
  if coalesce(_needs, false) and new.vehicle_id is null
     and (tg_op = 'INSERT' or old.vehicle_id is not null or new.cession_type is distinct from old.cession_type) then
    missing := missing || 'vehicle'::text;
  end if;

  if array_length(missing, 1) > 0 then
    raise exception 'Cession : compléter %.',
      array_to_string(array(select case m when 'type' then 'Type de cession' when 'operator' then 'Opérateur'
                                          else 'N° de série (moto)' end from unnest(missing) m), ', ')
      using errcode = '23514', hint = 'cession_required', detail = array_to_string(missing, ',');
  end if;
  return new;
end $fn$;
revoke all on function public.internal_cessions_required_g8() from public, anon, authenticated;

drop trigger if exists trg_icession_aa_required_g8 on public.internal_cessions;
create trigger trg_icession_aa_required_g8
  before insert or update of cession_type, vehicle_id, operator_id, operator_name on public.internal_cessions
  for each row execute function public.internal_cessions_required_g8();
