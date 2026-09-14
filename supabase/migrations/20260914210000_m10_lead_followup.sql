-- =====================================================================
-- M10 — Suivi d'une demande : qui a fait quoi, et quand.
-- Réf. docs/plan-nouveau-client.md (retours client du 14/09).
--
-- Tout est déjà tracé : `leads` porte un trigger d'audit qui écrit dans `events`
-- (qui, quoi, quand, ancien/nouveau). Il ne manquait que la lecture.
--
-- Pourquoi une fonction serveur plutôt qu'une simple requête depuis l'app :
-- `profiles` n'est lisible que pour SOI (`profiles_select_own`, `id = auth.uid()`).
-- Un utilisateur ne peut donc pas résoudre le nom de ses collègues, et une
-- jointure côté client renverrait un suivi anonyme. Plutôt que d'ouvrir les
-- profils de tout le personnel à tout le monde, on renvoie ici le suivi DÉJÀ
-- nominatif, en vérifiant l'appartenance à la société.
--
-- `events.entity_id` est du TEXTE, pas un uuid : d'où le cast.
-- =====================================================================

create or replace function public.lead_audit(_lead uuid)
returns table(
  occurred_at timestamptz,
  action      text,
  actor       text,
  changes     text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select e.occurred_at,
         e.action,
         -- actor_id nul = écriture faite par l'automatisation (service role).
         coalesce(nullif(btrim(p.full_name), ''), p.email, 'Automatisation') as actor,
         (
           select string_agg(
                    kv.key || ' : '
                    || coalesce(nullif(e.old_data->>kv.key, ''), '(vide)') || ' → '
                    || coalesce(nullif(e.new_data->>kv.key, ''), '(vide)'),
                    ', ' order by kv.key)
             from jsonb_each_text(coalesce(e.new_data, '{}'::jsonb)) kv
            where e.old_data is not null
              and kv.key in ('stage', 'due_at', 'name', 'email', 'phone', 'notes',
                             'vehicle_interest', 'estimated_value', 'assigned_to', 'source')
              and coalesce(e.old_data->>kv.key, '') is distinct from coalesce(e.new_data->>kv.key, '')
         ) as changes
    from public.events e
    join public.leads  l on l.id = _lead
    left join public.profiles p on p.id = e.actor_id
   where e.entity_type = 'leads'
     and e.entity_id = _lead::text
     -- Même garde que `contacts_search` : un appel serveur (service role, donc
     -- sans auth.uid) passe, un utilisateur connecté doit être membre.
     and (auth.uid() is null or public.is_member(l.company_id))
   order by e.occurred_at desc
   limit 100;
$fn$;
revoke execute on function public.lead_audit(uuid) from public, anon;
grant  execute on function public.lead_audit(uuid) to authenticated, service_role;

comment on function public.lead_audit(uuid) is
  'Suivi nominatif d''une demande : qui a fait quoi et quand. Contourne profiles_select_own sans exposer les profils.';
