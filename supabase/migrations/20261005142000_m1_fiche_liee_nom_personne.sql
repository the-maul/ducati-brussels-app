-- M01 — La ligne de la fiche liée montre le NOM DE LA PERSONNE pour un particulier
-- (retour de Simon du 05/10 : « AGM FISC apparait et Fonteio Michael en léger grisé »).
-- Avant, `company_name` primait même sur un particulier et la ligne affichait « FONTEIO ».

create or replace function public.contacts_linked_brief(_ids uuid[])
returns table (contact_id uuid, linked_id uuid, linked_name text, linked_type text, is_name_source boolean)
language sql stable set search_path = public, pg_temp as $fn$
  with p as (
    select l.contact_a as cid, l.contact_b as oid from public.contact_links l where l.contact_a = any(_ids)
    union all
    select l.contact_b, l.contact_a from public.contact_links l where l.contact_b = any(_ids)
  )
  select p.cid,
         o.id,
         -- Nom lisible : pour un particulier on montre d'abord la personne (Simon, 05/10),
         -- pour une société la raison sociale.
         case when o.type = 'particulier'
              then coalesce(nullif(btrim(concat_ws(' ', o.first_name, o.last_name)), ''),
                            nullif(btrim(o.company_name), ''), '—')
              else coalesce(nullif(btrim(o.company_name), ''),
                            nullif(btrim(concat_ws(' ', o.first_name, o.last_name)), ''), '—')
         end,
         o.type::text,
         (o.type = 'particulier')
    from p join public.contacts o on o.id = p.oid
   where public.is_member(o.company_id) and o.is_active
   order by 3;
$fn$;
revoke all on function public.contacts_linked_brief(uuid[]) from public, anon;
grant execute on function public.contacts_linked_brief(uuid[]) to authenticated;
