-- =====================================================================
-- M8 — Decision du client Q49 (18/11/2026) : l'OR cree depuis un RDV d'entretien recoit TOUTES les
-- lignes du kit d'entretien choisi. ATE013 ATE015.
--
-- Pieces, liquides, DDS, controles, petites fournitures, CONTRI, MO (au taux du client, Q48) : la
-- lecture des kits existante `_workshop_service_kit_items` (reservation, picking) ecarte les lignes
-- de service G8 (kind « forfait ») car ce ne sont pas des pieces a reserver ; l'OR, lui, doit les
-- avoir toutes. `workshop_service_kit_lines` lit LES MEMES kits (meme choix du kit, meme fusion
-- « annuel + huile » : une piece une seule fois, la plus grande quantite, liquides rattaches) en
-- gardant toutes les lignes. L'ecran les transforme en lignes d'OR avec la fonction d'insertion de
-- kit existante (src/modules/workshop/kits/insert-rules.ts, kitInsertLines) au moment de « Valider
-- RDV et saisie OR ».
-- Reservation : aucune nouvelle. Les pieces reservees au RDV restent reservees, la reservation
-- suit l'OR (_workshop_reservations_follow_or, inchange) ; la facture de l'OR la consomme
-- (B7 : la somme des mouvements de reservation revient a 0). L'atelier peut ensuite retirer /
-- modifier chaque ligne ; « Inserer un kit » reste disponible (l'ecran previent d'un doublon).
-- Lecture seule, rejouable. Essai a blanc : supabase/tests/m8_taux_et_kit_rdv.sql.
-- =====================================================================
create or replace function public.workshop_service_kit_lines(_vehicle uuid, _service text)
returns table(kit_item_id uuid, kit_id uuid, article_id uuid, reference text, designation text,
              quantity numeric, unit text, kind text, sort_order integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
      from unnest(public.workshop_service_kit_codes(_service)) with ordinality as c(code, ord)
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
  )
  select m.iid, m.kid, m.aid, m.ref, m.designation, m.quantity, m.unit, m.kind, m.sort_order
    from merged m
   order by m.ord, case m.kind when 'piece' then 1 when 'consommable' then 2 else 3 end, m.sort_order, m.designation;
end $$;
revoke all on function public.workshop_service_kit_lines(uuid, text) from public, anon;
grant execute on function public.workshop_service_kit_lines(uuid, text) to authenticated;
