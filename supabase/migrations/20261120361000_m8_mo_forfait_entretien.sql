-- =====================================================================
-- M8 — Main-d'oeuvre d'entretien = FORFAIT, comme G8 (lot parcours-fix, 20/11/2026).
--
-- Constat du test du 20/11 (OR TESTOR-2026-00001, Monster 696, « Entretien annuel + huile ») :
-- l'OR ne recevait AUCUNE ligne de main-d'oeuvre. Les kits d'entretien (2 206 kits, lignes par
-- defaut DDS / controles / petites fournitures / CONTRI) n'ont aucune ligne de type T ; la MO
-- (MO_ATELIER) n'existe que dans 6 des 37 nomenclatures G8 reprises le 19/11 :
--   ENTRETIEN ANNUEL 2 SOUPAPES 1,80 h · ENTRETIEN ANNUEL 4 SOUPAPES 2,00 h ·
--   ENTRETIEN ANNUEL 1199 PANIGALE 2,00 h · OIL SERVICE 2 SOUPAPES 1,00 h ·
--   OIL SERVICE 4 SOUPAPES 1,20 h · M696/M796/M1100 36000KM 0,70 h.
-- Decision du client (Simon, 20/11) : la MO d'entretien est un FORFAIT. On facture le temps
-- reference de l'entretien (heures du forfait G8, a defaut temps Ducati du plan), jamais plus ni
-- moins, quel que soit le pointage. Le controle du temps avant facture MONTRE l'ecart
-- pointe / forfait (productivite B11) sans changer la quantite facturee.
--
-- 1. Reglage par profil moteur : `maintenance_engine_profiles.labour_forfaits` (jsonb
--    { code d'entretien -> nomenclature G8 }). Valeurs posees ici (a valider par le client) :
--      entretien annuel         (annual) -> OIL SERVICE <profil>  (le forfait deja relie au profil)
--      entretien annuel + huile (oil)    -> ENTRETIEN ANNUEL <profil>
--    Les heures restent LUES dans la nomenclature (article_kit_items, composant de type T) : si
--    l'atelier change les heures du forfait, l'OR suit. Aucune heure en dur.
-- 2. `_workshop_service_labour` / `workshop_service_labour` : la ligne MO d'un entretien pour un
--    modele-annee (rien si un kit de l'entretien porte deja une MO).
-- 3. `workshop_service_kit_lines` (lignes du kit mises sur l'OR cree depuis le RDV) renvoie en plus
--    cette ligne MO. L'application la prix au taux atelier du client (109,74 HT, VIP 90 HT, Q48).
-- La reservation, la preparation et la commande ne lisent pas cette fonction (lignes F/T ignorees).
-- Additif, rejouable. Redefinit (meme signature) : workshop_service_kit_lines.
-- Essai a blanc : supabase/tests/m8_mo_forfait_entretien.sql.
-- =====================================================================

alter table public.maintenance_engine_profiles
  add column if not exists labour_forfaits jsonb not null default '{}'::jsonb;
comment on column public.maintenance_engine_profiles.labour_forfaits is
  'Main-d''oeuvre forfaitaire par entretien : { "annual" | "oil" | "first_1000" | "desmo" : designation ou reference de la nomenclature G8 dont la ligne de type T donne les heures }. Lot parcours-fix 20/11/2026.';

update public.maintenance_engine_profiles p
   set labour_forfaits = case p.code
         when 'deux_soupapes'   then '{"annual":"OIL SERVICE 2 SOUPAPES","oil":"ENTRETIEN ANNUEL 2 SOUPAPES"}'::jsonb
         when 'quatre_soupapes' then '{"annual":"OIL SERVICE 4 SOUPAPES","oil":"ENTRETIEN ANNUEL 4 SOUPAPES"}'::jsonb
         when 'panigale_1199'   then '{"oil":"ENTRETIEN ANNUEL 1199 PANIGALE"}'::jsonb
       end,
       updated_at = now()
 where p.labour_forfaits = '{}'::jsonb
   and p.code in ('deux_soupapes', 'quatre_soupapes', 'panigale_1199');

-- ---------------------------------------------------------------------
-- 2. MO forfaitaire d'un entretien pour un modele-annee
-- ---------------------------------------------------------------------
create or replace function public._workshop_service_labour(_company uuid, _model_year text, _service text)
returns table(article_id uuid, reference text, designation text, hours numeric, forfait text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _kits uuid[]; _prof uuid; _name text; _fid uuid; _fname text;
begin
  if _company is null or _model_year is null or _service is null then return; end if;
  select array_agg(k.kid order by k.ord) into _kits
    from (select c.ord, public._workshop_kit_for(_company, _model_year, c.code) as kid
            from unnest(public._workshop_service_kit_codes_for(_company, _model_year, _service)) with ordinality as c(code, ord)) k
   where k.kid is not null;
  if _kits is null then return; end if;
  -- un kit porte deja sa main-d'oeuvre : on ne double pas
  if exists (select 1 from public.maintenance_kit_items i join public.articles a on a.id = i.article_id
              where i.kit_id = any(_kits) and a.mgmt_type = 'T') then return; end if;
  select x.pid into _prof
    from unnest(_kits) with ordinality as u(kid, ord)
    cross join lateral (select public._maintenance_engine_profile_for(u.kid) as pid) x
   where x.pid is not null
   order by u.ord limit 1;
  if _prof is null then return; end if;
  select nullif(btrim(p.labour_forfaits ->> _service), '') into _name
    from public.maintenance_engine_profiles p where p.id = _prof and p.is_active;
  if _name is null then return; end if;
  select a.id, a.designation into _fid, _fname from public.articles a
   where a.company_id = _company and a.mgmt_type = 'N' and a.is_active
     and (upper(btrim(a.designation)) = upper(_name) or upper(a.reference) = upper(replace(_name, ' ', '')))
   order by (upper(btrim(a.designation)) = upper(_name)) desc, a.created_at
   limit 1;
  if _fid is null then return; end if;
  return query
  select (array_agg(c.id order by k.sort_order, c.reference))[1],
         (array_agg(c.reference order by k.sort_order, c.reference))[1],
         (array_agg(c.designation order by k.sort_order, c.reference))[1],
         sum(k.quantity), _fname
    from public.article_kit_items k join public.articles c on c.id = k.component_id
   where k.kit_id = _fid and c.mgmt_type = 'T'
  having sum(k.quantity) > 0;
end $$;
revoke all on function public._workshop_service_labour(uuid, text, text) from public, anon, authenticated;
comment on function public._workshop_service_labour(uuid, text, text) is
  'MO forfaitaire d''un entretien (heures de la nomenclature G8 du profil moteur, maintenance_engine_profiles.labour_forfaits). Vide si un kit de l''entretien porte deja une MO. Lot parcours-fix 20/11/2026.';

create or replace function public.workshop_service_labour(_vehicle uuid, _service text)
returns table(article_id uuid, reference text, designation text, hours numeric, forfait text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.vehicles%rowtype;
begin
  select * into v from public.vehicles where id = _vehicle;
  if not found or not public.is_member(v.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query select * from public._workshop_service_labour(v.company_id, v.ducati_model_year_id, _service);
end $$;
revoke all on function public.workshop_service_labour(uuid, text) from public, anon;
grant execute on function public.workshop_service_labour(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Lignes du kit vers l'OR : + la MO forfaitaire
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workshop_service_kit_lines(_vehicle uuid, _service text)
 RETURNS TABLE(kit_item_id uuid, kit_id uuid, article_id uuid, reference text, designation text, quantity numeric, unit text, kind text, sort_order integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v public.vehicles%rowtype;
begin
  select * into v from public.vehicles where id = _vehicle;
  if not found or not public.is_member(v.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if v.ducati_model_year_id is null or _service is null then return; end if;
  return query
  with kits as (
    select c.code, c.ord, public._workshop_kit_for(v.company_id, v.ducati_model_year_id, c.code) as kid
      from unnest(public._workshop_service_kit_codes_for(v.company_id, v.ducati_model_year_id, _service)) with ordinality as c(code, ord)
  ), items as (
    select i.id as iid, k.kid, k.ord,
           coalesce(i.article_id, fa.article_id) as aid,
           coalesce(nullif(btrim(i.reference), ''), a.reference) as ref,
           i.designation, i.quantity, i.unit, i.kind, i.sort_order,
           coalesce(coalesce(i.article_id, fa.article_id)::text,
                    nullif(upper(btrim(coalesce(i.reference, ''))), ''),
                    'fam:' || i.family_code,
                    'des:' || lower(btrim(i.designation))) as dkey
      from kits k
      join public.maintenance_kit_items i on i.kit_id = k.kid
      left join public.maintenance_fluid_articles fa
             on i.article_id is null and fa.company_id = v.company_id and fa.family_code = i.family_code
      left join public.articles a on a.id = coalesce(i.article_id, fa.article_id)
     where k.kid is not null
  ), merged as (
    select distinct on (items.dkey) items.*
      from items
     order by items.dkey, items.quantity desc nulls last, items.ord
  ), labour as (
    select null::uuid as iid, null::uuid as kid, 1000::bigint as ord, l.article_id as aid, l.reference as ref,
           l.designation, l.hours as quantity, 'h'::text as unit, 'forfait'::text as kind, 100000 as sort_order
      from public._workshop_service_labour(v.company_id, v.ducati_model_year_id, _service) l
  ), allx as (
    select m.iid, m.kid, m.ord::bigint as ord, m.aid, m.ref, m.designation, m.quantity, m.unit, m.kind, m.sort_order from merged m
    union all
    select l.iid, l.kid, l.ord, l.aid, l.ref, l.designation, l.quantity, l.unit, l.kind, l.sort_order from labour l
  )
  select x.iid, x.kid, x.aid, x.ref, x.designation, x.quantity, x.unit, x.kind, x.sort_order
    from allx x
   order by x.ord, case x.kind when 'piece' then 1 when 'consommable' then 2 else 3 end, x.sort_order, x.designation;
end $function$;
revoke all on function public.workshop_service_kit_lines(uuid, text) from public, anon;
grant execute on function public.workshop_service_kit_lines(uuid, text) to authenticated;
