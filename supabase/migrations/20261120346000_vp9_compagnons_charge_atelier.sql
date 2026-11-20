-- =====================================================================
-- VP9 — Planning : seuls les compagnons comptent dans la charge, comme G8 (décision du client,
-- 20/11/2026 : « tout comme G8 », case par personne). ATE002
--
-- G8 : charge du jour 2 h sur 24 h = 8,33 % (3 compagnons : John, Livio, Luis). Le DMS comptait
-- tous les compagnons visibles au planning (5 à 6, dont Domenico et Simon) : 2 h sur 40 h = 5 %.
--
-- 1. workshop_mechanics.counts_in_load (« Compte dans la charge atelier ») : réglage par personne
--    (Atelier › Planning › Réglages › Compagnons). Valeur par défaut, à la création comme pour
--    l'existant : OUI pour un compagnon sans compte DMS (compagnon G8) ou dont le compte est
--    mécanicien sans être administrateur ni chef d'atelier ; NON sinon (administrateur — Domenico,
--    Simon —, chef d'atelier, compte sans rôle atelier dans la société). Chez ITALBIKE STORE et
--    ItalTest : John, Livio, Luis = oui ; Domenico Desouter, Simon, Simon-atelier = non.
--    Une valeur choisie à l'écran est gardée telle quelle.
-- 2. La formule de charge (écran, src/modules/workshop/planning/rules.ts dayLoad) n'additionne
--    plus que la capacité des compagnons qui comptent, et le temps prévu des RDV qui leur sont
--    confiés (ou sans compagnon). Un compagnon qui ne compte pas reste visible au planning et
--    garde sa charge propre quand on filtre sur lui.
--
-- Additive, rejouable. Pas de nouvelle politique RLS (colonne d'une table déjà protégée).
-- Essai à blanc : supabase/tests/vp9_charge_compagnons.sql. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '5s';

alter table public.workshop_mechanics add column if not exists counts_in_load boolean;
comment on column public.workshop_mechanics.counts_in_load is
  'VP9 (20/11/2026, comme G8) : le compagnon compte dans la charge atelier du planning (capacité et temps prévu).';

create or replace function public.workshop_mechanic_counts_default(_company uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select case
    when _user is null then true
    else exists (select 1 from public.user_roles ur where ur.user_id = _user and ur.company_id = _company and ur.role::text = 'mecanicien')
         and not exists (select 1 from public.user_roles ur where ur.user_id = _user and ur.company_id = _company
                          and ur.role::text in ('admin', 'chef_atelier'))
  end;
$fn$;
revoke all on function public.workshop_mechanic_counts_default(uuid, uuid) from public, anon;
grant execute on function public.workshop_mechanic_counts_default(uuid, uuid) to authenticated, service_role;

-- Valeur par défaut posée à la création (et pour l'existant ci-dessous) ; un choix explicite est gardé.
create or replace function public._workshop_mechanics_counts_default()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.counts_in_load is null then
    new.counts_in_load := public.workshop_mechanic_counts_default(new.company_id, new.user_id);
  end if;
  return new;
end $fn$;
revoke all on function public._workshop_mechanics_counts_default() from public, anon, authenticated;
drop trigger if exists trg_workshop_mechanics_counts_default on public.workshop_mechanics;
create trigger trg_workshop_mechanics_counts_default before insert or update on public.workshop_mechanics
  for each row execute function public._workshop_mechanics_counts_default();

update public.workshop_mechanics m
   set counts_in_load = public.workshop_mechanic_counts_default(m.company_id, m.user_id)
 where m.counts_in_load is null;

alter table public.workshop_mechanics alter column counts_in_load set default null;
alter table public.workshop_mechanics alter column counts_in_load set not null;
