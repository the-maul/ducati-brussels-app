-- =====================================================================
-- M6 — Opérateur au comptoir comme G8 (décision du client Q63, 20/11/2026). PDV001 VEN016
--
-- G8 demande l'OPÉRATEUR (le vendeur qui fait la vente) à chaque ticket / facture / vente, dans
-- la liste des opérateurs de la société (Fichiers › Opérateurs : code, nom, type, désactivé), et
-- imprime son NOM. Le DMS signait avec l'utilisateur connecté et imprimait son e-mail
-- (« simon@themaul.be ») quand le profil n'avait pas de nom.
--
-- 1. Référentiel « Opérateurs (vendeurs) » : table de paramètres existante reference_values,
--    table_key = 'sales_operator' (Paramètres → Tables, administrateurs) : code, nom (label),
--    actif (G8 « Fiche désactivée »), extra.kind (vendeur / atelier / chef_atelier / retrocession),
--    extra.email = compte DMS lié (facultatif). Pas de nouvelle table : RLS de reference_values
--    (lecture membres, écriture administrateurs, déjà en style rls_*_companies()).
-- 2. documents.operator_id (nouvelle colonne, facultative) = l'opérateur choisi. Le déclencheur
--    trg_documents_operator (remplacé) :
--      - opérateur choisi : il doit être un opérateur ACTIF de la société du document ; le nom
--        imprimé (documents.operator) est celui du référentiel, operator_user_id = son compte lié,
--        à défaut l'utilisateur connecté ;
--      - rien de choisi : l'opérateur lié à l'utilisateur connecté s'il existe (défaut G8), sinon
--        le nom du profil — JAMAIS un e-mail (profil sans nom : partie avant « @ », en majuscules) ;
--      - documents repris (imported_from) ou écrits par le serveur (auth.uid() vide) : inchangé ;
--      - à la modification : l'opérateur se change tant que le document est un brouillon
--        (G8 « Changer opérateur »), jamais après validation ; operator_user_id reste figé sauf
--        si l'opérateur choisi change.
-- 3. Statistiques par opérateur : inchangées, elles lisent documents.operator (le nom).
-- 4. Remplissage du référentiel (une fois, pour chaque société) :
--      - les opérateurs G8 repris (texte operator des documents importés ; pour une société de
--        test, ceux de sa société source) : ACTIFS s'ils ont vendu dans les 12 mois avant le
--        dernier document repris, sinon désactivés ; ADMINISTRATEUR et INTERNET désactivés ;
--      - chaque nom G8 est relié au compte de la société dont le nom complet est le même (sans
--        accents ni casse), sinon dont le prénom (1er mot) est le même, sinon dont l'e-mail
--        commence par ce nom — seulement si un seul compte correspond ;
--      - les comptes de la société qui ont un vrai nom (pas un e-mail) et ne sont reliés à aucun
--        nom G8 reçoivent leur ligne (type d'après leurs rôles).
--    Rejouable : rien n'est créé si la société a déjà des opérateurs.
-- 5. Rattrapage : les documents dont l'opérateur est un e-mail affichent le nom (opérateur relié
--    au compte, sinon nom du profil, sinon partie avant « @ »). Une ligne events de synthèse par
--    société (le déclencheur audit_row trace aussi chaque document : une dizaine en production).
--
-- Additive, rejouable. Essai à blanc : supabase/tests/m6_operateur_comptoir_g8.sql. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------
-- 1. Colonne du document
-- ---------------------------------------------------------------------------------------------
alter table public.documents
  add column if not exists operator_id uuid references public.reference_values(id) on delete set null;
comment on column public.documents.operator_id is
  'Opérateur choisi (Q63, G8) : ligne reference_values table_key = sales_operator. Le nom imprimé est dans operator.';
create index if not exists idx_documents_operator_id on public.documents(operator_id) where operator_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 2. Fonctions utilitaires
-- ---------------------------------------------------------------------------------------------
-- Nom d'une personne sans jamais rendre un e-mail : nom du profil, sinon partie avant « @ » en majuscules.
create or replace function public.person_display_name(_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
           when nullif(btrim(p.full_name), '') is not null and position('@' in p.full_name) = 0 then btrim(p.full_name)
           when coalesce(nullif(btrim(p.email), ''), nullif(btrim(p.full_name), '')) is not null
             then upper(split_part(coalesce(nullif(btrim(p.email), ''), btrim(p.full_name)), '@', 1))
         end
    from public.profiles p where p.id = _user
$$;
revoke all on function public.person_display_name(uuid) from public, anon;
grant execute on function public.person_display_name(uuid) to authenticated, service_role;

-- Compte DMS relié à un opérateur (extra.email), parmi les membres de la société de l'opérateur.
create or replace function public.sales_operator_user(_operator uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select ur.user_id
    from public.reference_values rv
    join public.user_roles ur on ur.company_id = rv.company_id
    join public.profiles p on p.id = ur.user_id
   where rv.id = _operator and rv.table_key = 'sales_operator'
     and nullif(btrim(rv.extra->>'email'), '') is not null
     and lower(btrim(p.email)) = lower(btrim(rv.extra->>'email'))
   limit 1
$$;
revoke all on function public.sales_operator_user(uuid) from public, anon, authenticated;

-- Opérateur relié à un compte dans une société (le défaut G8 : l'utilisateur connecté s'il est opérateur).
create or replace function public.sales_operator_for_user(_company uuid, _user uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select rv.id
    from public.reference_values rv
    join public.profiles p on lower(btrim(p.email)) = lower(btrim(rv.extra->>'email'))
   where rv.company_id = _company and rv.table_key = 'sales_operator' and rv.is_active
     and p.id = _user
   order by rv.sort_order, rv.label
   limit 1
$$;
revoke all on function public.sales_operator_for_user(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Déclencheur de l'opérateur (remplace la version du 19/09)
-- ---------------------------------------------------------------------------------------------
create or replace function public.documents_set_operator()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  uid uuid := auth.uid();
  op  record;
  linked uuid;
begin
  if tg_op = 'UPDATE' then
    -- Fonctions serveur / migrations : rien n'est imposé.
    if uid is null then return new; end if;
    if new.operator_id is not distinct from old.operator_id then
      new.operator_user_id := old.operator_user_id;          -- figé après la création
      return new;
    end if;
    if old.status is distinct from 'brouillon' and old.imported_from is null then
      raise exception 'Le document % est validé : son opérateur ne change plus.', coalesce(old.number, old.id::text)
        using errcode = '23514', hint = 'operator_locked';
    end if;
    if new.operator_id is null then                           -- on ne retire pas l'opérateur
      new.operator_id := old.operator_id;
      new.operator_user_id := old.operator_user_id;
      return new;
    end if;
    select rv.id, rv.label into op from public.reference_values rv
     where rv.id = new.operator_id and rv.company_id = new.company_id and rv.table_key = 'sales_operator' and rv.is_active;
    if not found then
      raise exception 'Opérateur inconnu ou désactivé pour cette société.' using errcode = '23514', hint = 'operator_unknown';
    end if;
    linked := public.sales_operator_user(op.id);
    new.operator := op.label;
    new.operator_user_id := coalesce(linked, old.operator_user_id);
    return new;
  end if;

  -- INSERT : opérateur choisi à l'écran.
  if new.operator_id is not null then
    select rv.id, rv.label into op from public.reference_values rv
     where rv.id = new.operator_id and rv.company_id = new.company_id and rv.table_key = 'sales_operator' and rv.is_active;
    if not found then
      raise exception 'Opérateur inconnu ou désactivé pour cette société.' using errcode = '23514', hint = 'operator_unknown';
    end if;
    linked := public.sales_operator_user(op.id);
    new.operator := op.label;
    new.operator_user_id := coalesce(linked, uid, new.operator_user_id);
    return new;
  end if;

  -- Documents repris (G8, imports) ou écrits sans utilisateur (tâches planifiées) : texte gardé.
  if new.imported_from is not null or uid is null then
    return new;
  end if;

  -- Rien de choisi : l'opérateur relié à l'utilisateur connecté, sinon son nom (jamais l'e-mail).
  new.operator_id := public.sales_operator_for_user(new.company_id, uid);
  if new.operator_id is not null then
    select rv.label into new.operator from public.reference_values rv where rv.id = new.operator_id;
  else
    new.operator := coalesce(public.person_display_name(uid), new.operator);
  end if;
  new.operator_user_id := uid;
  return new;
end $function$;
revoke all on function public.documents_set_operator() from public, anon, authenticated;

drop trigger if exists trg_documents_operator on public.documents;
create trigger trg_documents_operator before insert or update of operator_user_id, operator_id on public.documents
  for each row execute function public.documents_set_operator();

-- ---------------------------------------------------------------------------------------------
-- 4. Remplissage du référentiel des opérateurs (sociétés qui n'en ont pas encore)
-- ---------------------------------------------------------------------------------------------
do $seed$
declare
  c record;
  src uuid;
  last_import date;
  g record;
  acc uuid;
  n_match int;
  kind text;
  ins int := 0;
  norm_name text;
begin
  for c in select co.id from public.companies co
            where not exists (select 1 from public.reference_values rv where rv.company_id = co.id and rv.table_key = 'sales_operator')
  loop
    -- Société de test : les opérateurs G8 de sa société source.
    src := c.id;
    if to_regclass('public.test_companies') is not null then
      execute 'select coalesce((select source_company_id from public.test_companies where company_id = $1), $1)' into src using c.id;
    end if;
    select max(d.issue_date) into last_import from public.documents d where d.company_id = src and d.imported_from is not null;

    -- Comptes de la société (nom normalisé, e-mail, rôles).
    create temp table if not exists _q63_acc (user_id uuid, email text, full_name text, nname text, nfirst text, nlocal text, roles text[]) on commit drop;
    truncate _q63_acc;
    insert into _q63_acc
    select p.id, p.email, p.full_name,
           lower(regexp_replace(translate(btrim(coalesce(p.full_name, '')), 'ÀÁÂÄÃÅàáâäãåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÖÕòóôöõÙÚÛÜùúûüÇçÑñ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'), '\s+', ' ', 'g')),
           lower(split_part(translate(btrim(coalesce(p.full_name, '')), 'ÀÁÂÄÃÅàáâäãåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÖÕòóôöõÙÚÛÜùúûüÇçÑñ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'), ' ', 1)),
           lower(split_part(coalesce(p.email, ''), '@', 1)),
           array_agg(distinct ur.role::text)
      from public.user_roles ur join public.profiles p on p.id = ur.user_id
     where ur.company_id = c.id
     group by p.id, p.email, p.full_name;

    create temp table if not exists _q63_linked (user_id uuid) on commit drop;
    truncate _q63_linked;

    -- Opérateurs G8 repris.
    for g in
      select upper(btrim(d.operator)) as name, max(d.issue_date) as last_at
        from public.documents d
       where d.company_id = src and d.imported_from is not null
         and nullif(btrim(d.operator), '') is not null and position('@' in d.operator) = 0
       group by upper(btrim(d.operator))
       order by 1
    loop
      norm_name := lower(translate(g.name, 'ÀÁÂÄÃÅÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑ', 'AAAAAAEEEEIIIIOOOOOUUUUCN'));
      acc := null;
      select count(*) into n_match from _q63_acc a where a.nname = norm_name and position('@' in coalesce(a.full_name, '')) = 0;
      if n_match = 1 then
        select a.user_id into acc from _q63_acc a where a.nname = norm_name and position('@' in coalesce(a.full_name, '')) = 0;
      else
        select count(*) into n_match from _q63_acc a where a.nfirst = norm_name and position('@' in coalesce(a.full_name, '')) = 0;
        if n_match = 1 then
          select a.user_id into acc from _q63_acc a where a.nfirst = norm_name and position('@' in coalesce(a.full_name, '')) = 0;
        else
          select count(*) into n_match from _q63_acc a where a.nlocal = norm_name;
          if n_match = 1 then select a.user_id into acc from _q63_acc a where a.nlocal = norm_name; end if;
        end if;
      end if;
      if acc is not null and exists (select 1 from _q63_linked l where l.user_id = acc) then acc := null; end if;
      if acc is not null then insert into _q63_linked values (acc); end if;

      kind := 'vendeur';
      if acc is not null then
        select case when a.roles && array['admin','vendeur','magasinier','comptable'] then 'vendeur'
                    when 'chef_atelier' = any(a.roles) then 'chef_atelier'
                    when 'mecanicien' = any(a.roles) then 'atelier' else 'vendeur' end
          into kind from _q63_acc a where a.user_id = acc;
      end if;

      insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
      values (c.id, 'sales_operator', left(g.name, 40), g.name, 0,
              g.name not in ('ADMINISTRATEUR', 'INTERNET') and last_import is not null and g.last_at >= last_import - interval '12 months',
              jsonb_strip_nulls(jsonb_build_object('kind', kind, 'email', (select a.email from _q63_acc a where a.user_id = acc), 'g8', true)))
      on conflict (company_id, table_key, code) do nothing;
      ins := ins + 1;
    end loop;

    -- Comptes avec un vrai nom, pas encore reliés.
    insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
    select c.id, 'sales_operator', left(upper(btrim(a.full_name)), 40), upper(btrim(a.full_name)), 0, true,
           jsonb_build_object('kind', case when a.roles && array['admin','vendeur','magasinier','comptable'] then 'vendeur'
                                            when 'chef_atelier' = any(a.roles) then 'chef_atelier'
                                            when 'mecanicien' = any(a.roles) then 'atelier' else 'vendeur' end,
                              'email', a.email)
      from _q63_acc a
     where nullif(btrim(a.full_name), '') is not null and position('@' in a.full_name) = 0
       and not exists (select 1 from _q63_linked l where l.user_id = a.user_id)
       and a.roles && array['admin','vendeur','magasinier','comptable','chef_atelier','mecanicien']
    on conflict (company_id, table_key, code) do nothing;
  end loop;
end $seed$;

-- ---------------------------------------------------------------------------------------------
-- 5. Rattrapage : plus d'e-mail comme opérateur sur les documents existants
-- ---------------------------------------------------------------------------------------------
do $fix$
declare c record; n int;
begin
  for c in
    select d.company_id, count(*) as n
      from public.documents d
     where position('@' in coalesce(d.operator, '')) > 0 and d.operator_user_id is not null
     group by d.company_id
  loop
    with target as (
      select d.id,
             coalesce((select rv.label from public.reference_values rv
                         join public.profiles p on lower(btrim(p.email)) = lower(btrim(rv.extra->>'email'))
                        where rv.company_id = d.company_id and rv.table_key = 'sales_operator' and p.id = d.operator_user_id
                        order by rv.is_active desc, rv.sort_order limit 1),
                       public.person_display_name(d.operator_user_id)) as name
        from public.documents d
       where d.company_id = c.company_id and position('@' in coalesce(d.operator, '')) > 0 and d.operator_user_id is not null
    )
    update public.documents d set operator = t.name
      from target t where t.id = d.id and t.name is not null and position('@' in t.name) = 0;
    get diagnostics n = row_count;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (c.company_id, null, 'documents_operator_name_fix', 'company', c.company_id::text, 'migration',
            jsonb_build_object('documents_with_email', c.n),
            jsonb_build_object('documents_renamed', n, 'migration', '20261120150000'));
  end loop;
end $fix$;
