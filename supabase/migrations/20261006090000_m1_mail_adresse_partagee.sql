-- M1 — Adresse e-mail partagée (question Q14, tranchée par Simon le 05/10) :
-- un échange reçu sur une adresse portée par plusieurs fiches doit apparaître
-- sur TOUTES les fiches qui portent cette adresse, sans choix à faire.
-- Avant : l'échange n'allait que sur la fiche la plus ancienne et restait
-- invisible sur les autres.
--
-- Rien n'est déplacé en base : l'échange reste rattaché à la fiche sur
-- laquelle il est arrivé (traçabilité), c'est l'affichage qui réunit les
-- fiches qui partagent l'adresse.
--
-- Deux garde-fous, mesurés sur les données réelles :
--   * les adresses du garage lui-même (même domaine qu'une de ses boîtes)
--     sont posées en bouche-trou sur des dizaines de fiches sans rapport ;
--   * au-delà de 4 fiches, ce n'est plus un couple, une famille ou une
--     société : la plus chargée porte 21 fiches (john.ducati@hotmail.fr),
--     une autre 15 (desouter.d@ducatibxl.com).
-- Dans ces deux cas on ne regroupe pas : il n'y a aucune raison qu'un client
-- voie les échanges d'un autre.
-- Restent regroupées les 355 adresses réellement partagées (331 sur deux
-- fiches, 19 sur trois, 5 sur quatre).
--
-- Pas de SECURITY DEFINER : la fonction s'exécute avec les droits de
-- l'utilisateur, les règles d'accès aux fiches s'appliquent normalement.
create or replace function public.contacts_sharing_email(_contact uuid)
returns table (id uuid)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with me as (
    select c.id,
           c.company_id,
           lower(nullif(btrim(c.email), '')) as e1,
           lower(nullif(btrim(c.email_pro), '')) as e2
      from public.contacts c
     where c.id = _contact
  ),
  own as (
    select distinct lower(split_part(m.address, '@', 2)) as d
      from public.company_mailboxes m, me
     where m.company_id = me.company_id and m.address like '%@%'
  ),
  mails as (
    select x.e
      from (select e1 as e from me union select e2 from me) x
     where x.e is not null and x.e like '%@%'
       and lower(split_part(x.e, '@', 2)) not in (select d from own)
  ),
  shared as (
    select c.id, m.e
      from public.contacts c
      join me on c.company_id = me.company_id
      join mails m on lower(btrim(c.email)) = m.e or lower(btrim(c.email_pro)) = m.e
  ),
  keep as (
    select s.e from shared s group by s.e having count(distinct s.id) <= 4
  )
  select distinct s.id from shared s join keep k on k.e = s.e;
$$;

grant execute on function public.contacts_sharing_email(uuid) to authenticated, service_role;
