-- =====================================================================
-- M1 — Mise en MAJUSCULES des fiches existantes (décision du client Q67, 20/11/2026). CON001
--
-- Toutes les sociétés (ITALBIKE STORE et ItalTest, environ 16 000 fiches) : seules les colonnes
-- last_name (nom), first_name (prénom) et company_name (raison sociale) passent en majuscules,
-- accents gardés (é → É, upper() de PostgreSQL en UTF-8). Rien d'autre n'est touché ; seules les
-- fiches dont une de ces valeurs change sont écrites (≈ 150 par société mesurées le 20/11).
--
-- Trace :
--   - archive datée public.contacts_names_archive_20261120 : l'ancienne valeur des trois colonnes
--     de chaque fiche modifiée (RLS : lecture par les administrateurs de la société) ;
--   - UNE ligne events de synthèse par société (« contacts_names_uppercase » : nombre de fiches,
--     table d'archive). Pas une ligne par fiche : l'audit ligne à ligne (audit_row) et la
--     recopie vers les fiches liées sont coupés le temps de la mise à jour
--     (session_replication_role = replica, transaction locale), la recopie étant inutile
--     puisque toutes les fiches passent en majuscules dans la même opération.
-- Les fiches sans civilité ou sans prénom ne sont pas touchées ni bloquées : la règle
-- (20261120154000) ne s'applique qu'à la création et à la modification depuis l'écran.
--
-- Retour en arrière (si besoin) :
--   update public.contacts c set first_name = a.first_name, last_name = a.last_name, company_name = a.company_name
--     from public.contacts_names_archive_20261120 a where a.contact_id = c.id;
--
-- lock_timeout court, une société à la fois (verrous de ligne seulement, aucun verrou de table
-- exclusif). Rejouable : une fiche déjà en majuscules n'est plus écrite, l'archive garde la
-- première ancienne valeur. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create table if not exists public.contacts_names_archive_20261120 (
  contact_id   uuid primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  first_name   text,
  last_name    text,
  company_name text,
  archived_at  timestamptz not null default now()
);
comment on table public.contacts_names_archive_20261120 is
  'Q67 (20/11/2026) : nom, prénom et raison sociale AVANT la mise en majuscules des fiches existantes (retour en arrière possible).';
alter table public.contacts_names_archive_20261120 enable row level security;
revoke all on public.contacts_names_archive_20261120 from anon, authenticated;
grant select on public.contacts_names_archive_20261120 to authenticated;
drop policy if exists contacts_names_archive_select on public.contacts_names_archive_20261120;
create policy contacts_names_archive_select on public.contacts_names_archive_20261120
  for select to authenticated
  using (coalesce((company_id in (select public.rls_admin_companies())), false));

do $up$
declare
  c record;
  n_arch int;
  n_upd int;
begin
  for c in select co.id from public.companies co order by co.id loop
    insert into public.contacts_names_archive_20261120 (contact_id, company_id, first_name, last_name, company_name)
    select ct.id, ct.company_id, ct.first_name, ct.last_name, ct.company_name
      from public.contacts ct
     where ct.company_id = c.id
       and (ct.first_name is distinct from upper(ct.first_name)
         or ct.last_name is distinct from upper(ct.last_name)
         or ct.company_name is distinct from upper(ct.company_name))
    on conflict (contact_id) do nothing;
    get diagnostics n_arch = row_count;

    set local session_replication_role = replica;
    update public.contacts ct
       set first_name = upper(ct.first_name), last_name = upper(ct.last_name), company_name = upper(ct.company_name)
     where ct.company_id = c.id
       and (ct.first_name is distinct from upper(ct.first_name)
         or ct.last_name is distinct from upper(ct.last_name)
         or ct.company_name is distinct from upper(ct.company_name));
    get diagnostics n_upd = row_count;
    set local session_replication_role = origin;

    if n_upd > 0 or n_arch > 0 then
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (c.id, null, 'contacts_names_uppercase', 'company', c.id::text, 'migration',
              jsonb_build_object('archive_table', 'contacts_names_archive_20261120'),
              jsonb_build_object('contacts_updated', n_upd, 'archived', n_arch,
                                 'columns', jsonb_build_array('last_name', 'first_name', 'company_name'),
                                 'migration', '20261120155000'));
    end if;
  end loop;
end $up$;

-- Lot ItalTest (société de test) : l'archive est classée « non copiée » dans l'inventaire de la
-- copie (_tc_skip), sinon elle ressortirait « à classer ». Même procédé que 20261119220000 §9.
do $tc$
declare _d text;
begin
  if to_regprocedure('public._tc_skip()') is null then return; end if;
  _d := pg_get_functiondef('public._tc_skip()'::regprocedure);
  if position('''contacts_names_archive_20261120''' in _d) > 0 then return; end if;
  _d := regexp_replace(_d, '\)\s*\$function\$\s*$',
    E'),\n    (''contacts_names_archive_20261120'', ''Archive Q67 : noms avant la mise en majuscules (retour en arriere), jamais copiee'')\n$function$\n');
  if position('''contacts_names_archive_20261120''' in _d) = 0 then
    raise notice 'Q67 : _tc_skip non complete (forme inattendue)';
    return;
  end if;
  execute _d;
end $tc$;
