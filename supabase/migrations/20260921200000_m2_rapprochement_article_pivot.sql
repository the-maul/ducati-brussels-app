-- =====================================================================
-- Missions 03 + 06 — « Article DMS = pivot » : un seul catalogue (Pièces & Accessoires)
--
-- Demande de Simon (21/09) : « tout est lié, on ne peut pas avoir 3 bases différentes ».
-- L'ARTICLE DU DMS est le pivot : il porte sa référence Ducati (pièce du catalogue, ou
-- accessoire / vêtement quand ce catalogue sera chargé) et son produit / variante Shopify.
--
-- article_links : UNE table de liens, une ligne par (article, cible) :
--   target_kind  ducati_part      → ducati_catalog_parts.reference_norm
--                ducati_product   → ducati_catalog_product_variants.sku_norm (accessoires / vêtements)
--                shopify_variant  → shopify_products.shopify_variant_id
--                g8               → article repris de G8 (import du 15/07/2026) : badge « G8 », jamais recalculé
--   status       lie        relié (automatique sûr, ou validé par une personne)
--                a_valider  candidat proposé par le rapprochement, avec sa raison et son score
--                rejete     refusé par une personne : JAMAIS recréé par le rapprochement
--   method       ref_exacte, occasion, prefixe_suffixe, revision, remplacement_dms, sku_exact, code_barres,
--                sku_normalise, sku_ambigu, code_barres_ref, ref_dans_titre, manuel, creation, creation_sans_sku,
--                import_g8
--   is_auto / decided_by / decided_at / decision_note : qui et quand ; chaque décision humaine
--                est tracée dans events (article_link_accept, article_link_reject, article_link_manual),
--                chaque rapprochement par une trace de synthèse (article_links_refresh).
--
-- Shopify : shopify_links reste la table utilisée par la synchronisation (stock, prix, commandes,
-- publication). Un déclencheur recopie chaque changement de shopify_links dans article_links
-- (source unique pour l'écran). Accepter / rejeter un candidat Shopify écrit shopify_links
-- (mêmes traces events que l'écran Produits Shopify). Règle W-6 inchangée : seules les
-- correspondances exactes et uniques sont reliées d'office (par la lecture Shopify existante).
--
-- Rapprochement relançable : article_links_refresh(société) — idempotent ; ne touche jamais une
-- décision humaine ni un lien rejeté ; supprime les liens AUTOMATIQUES qui ne tiennent plus
-- (référence changée, article désactivé), compte rendu dans events.
--
-- Additif / non destructif : 1 table, 3 index d'aide, 1 déclencheur, des fonctions.
-- Aucune écriture d'article, de stock ni de prix. Rien n'est écrit sur Shopify.
-- statement_timeout 8 s (authenticated) : chaque requête passe par un index.
-- =====================================================================

-- 0. Index d'aide ------------------------------------------------------
-- « même pièce, autre indice de révision » : référence Ducati sans ses 1 à 3 lettres finales
create index if not exists idx_dc_parts_ref_base
  on public.ducati_catalog_parts (regexp_replace(reference_norm, '[A-Z]{1,3}$', ''));
-- chaînes de remplacement du DMS
create index if not exists idx_articles_superseded_by on public.articles (superseded_by_id) where superseded_by_id is not null;

-- 1. Table des liens ---------------------------------------------------
create table if not exists public.article_links (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  article_id     uuid not null references public.articles(id) on delete cascade,
  target_kind    text not null check (target_kind in ('ducati_part', 'ducati_product', 'shopify_variant', 'g8')),
  target_ref     text not null,
  status         text not null check (status in ('lie', 'a_valider', 'rejete')),
  method         text not null,
  score          smallint not null default 0 check (score between 0 and 100),
  reason         text,
  details        jsonb not null default '{}'::jsonb,
  is_auto        boolean not null default true,
  decided_by     uuid references auth.users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, article_id, target_kind, target_ref)
);
comment on table public.article_links is
  'Article DMS = pivot : liens article ↔ catalogue Ducati (pièces, accessoires/vêtements) et article ↔ variante Shopify. lie / a_valider / rejete (jamais recréé). Écriture par fonctions uniquement.';

-- une variante Shopify n'est reliée qu'à un article ; un article n'a qu'un lien « lié » par sorte
create unique index if not exists uq_article_links_variant_lie
  on public.article_links (company_id, target_ref) where target_kind = 'shopify_variant' and status = 'lie';
create unique index if not exists uq_article_links_article_kind_lie
  on public.article_links (company_id, article_id, target_kind) where status = 'lie';
create index if not exists idx_article_links_article on public.article_links (article_id);
create index if not exists idx_article_links_review on public.article_links (company_id, status, target_kind, method, score desc);
create index if not exists idx_article_links_target on public.article_links (company_id, target_kind, target_ref);

alter table public.article_links enable row level security;
revoke all on public.article_links from anon;
revoke insert, update, delete on public.article_links from authenticated;
grant select on public.article_links to authenticated;
drop policy if exists article_links_select on public.article_links;
-- Lecture : membres de la société ; les liens Shopify comme l'écran Produits Shopify (admin + vendeur).
create policy article_links_select on public.article_links for select to authenticated
  using (public.is_member(company_id)
         and (target_kind <> 'shopify_variant' or public.is_admin(company_id) or public.has_role(company_id, 'vendeur')));

-- Droit d'écriture : administrateur de la société, clé de service, ou migration (postgres).
create or replace function public._article_links_can_write(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin(_company)
      or coalesce(auth.role(), '') = 'service_role'
      or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'));
$$;
revoke all on function public._article_links_can_write(uuid) from public, anon, authenticated;

-- 2. Shopify : shopify_links → article_links (déclencheur) -------------
create or replace function public._article_links_mirror_shopify()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := coalesce(new.company_id, old.company_id);
  v_variant text := coalesce(new.shopify_variant_id, old.shopify_variant_id);
  v_linked  boolean := tg_op <> 'DELETE' and new.status in ('auto_exact', 'valide') and new.article_id is not null;
  v_human   boolean := tg_op <> 'DELETE' and new.status in ('valide', 'ignore', 'a_valider');
  v_by      uuid := case when tg_op = 'DELETE' then null else new.decided_by end;
begin
  -- Liens « lié » de cette variante qui ne tiennent plus (variante déliée ou reliée à un autre article)
  if v_human then
    update public.article_links l
       set status = 'rejete', is_auto = false, decided_by = v_by, decided_at = now(), updated_at = now(),
           decision_note = coalesce(l.decision_note, case when new.status = 'ignore' then 'Ignoré dans Produits Shopify'
                                                         else 'Délié ou relié à un autre article dans Produits Shopify' end)
     where l.company_id = v_company and l.target_kind = 'shopify_variant' and l.target_ref = v_variant
       and l.status = 'lie' and (not v_linked or l.article_id <> new.article_id);
  else
    delete from public.article_links l
     where l.company_id = v_company and l.target_kind = 'shopify_variant' and l.target_ref = v_variant
       and l.status = 'lie' and l.is_auto and (not v_linked or l.article_id <> new.article_id);
    update public.article_links l set status = 'a_valider', updated_at = now()
     where l.company_id = v_company and l.target_kind = 'shopify_variant' and l.target_ref = v_variant
       and l.status = 'lie' and (not v_linked or l.article_id <> new.article_id);
  end if;

  if v_linked then
    -- l'article était relié à une autre variante : ce lien redevient « à valider » (cas rare)
    update public.article_links l set status = 'a_valider', updated_at = now(),
           decision_note = 'Article relié à une autre variante Shopify'
     where l.company_id = v_company and l.article_id = new.article_id and l.target_kind = 'shopify_variant'
       and l.status = 'lie' and l.target_ref <> v_variant;
    insert into public.article_links as l (company_id, article_id, target_kind, target_ref, status, method, score,
                                           reason, details, is_auto, decided_by, decided_at)
    values (v_company, new.article_id, 'shopify_variant', v_variant, 'lie',
            case when new.status = 'auto_exact' then case when new.match_via = 'barcode' then 'code_barres' else 'sku_exact' end
                 else 'manuel' end,
            100,
            case when new.status = 'auto_exact' then 'Correspondance exacte et unique (règle W-6)' else 'Relié par une personne' end,
            jsonb_build_object('shopify_status', new.status),
            new.status = 'auto_exact', new.decided_by, case when new.status = 'auto_exact' then null else new.decided_at end)
    on conflict (company_id, article_id, target_kind, target_ref) do update set
      status     = 'lie',
      method     = case when excluded.is_auto then excluded.method
                        when l.status in ('lie', 'a_valider') and not l.is_auto then l.method
                        when l.status = 'a_valider' then l.method
                        else excluded.method end,
      score      = greatest(l.score, excluded.score),
      reason     = case when l.status = 'a_valider' and not excluded.is_auto then l.reason else excluded.reason end,
      is_auto    = excluded.is_auto and l.is_auto,
      decided_by = coalesce(excluded.decided_by, l.decided_by),
      decided_at = coalesce(excluded.decided_at, l.decided_at),
      details    = l.details || excluded.details,
      updated_at = now()
    where (l.status, l.is_auto) is distinct from ('lie'::text, excluded.is_auto and l.is_auto);
  end if;
  return null;
end $$;
revoke all on function public._article_links_mirror_shopify() from public, anon, authenticated;

drop trigger if exists trg_article_links_mirror_shopify on public.shopify_links;
create trigger trg_article_links_mirror_shopify
  after insert or update of status, article_id or delete on public.shopify_links
  for each row execute function public._article_links_mirror_shopify();

-- Reprise des liaisons Shopify existantes (auto_exact / valide)
insert into public.article_links (company_id, article_id, target_kind, target_ref, status, method, score, reason,
                                  details, is_auto, decided_by, decided_at)
select l.company_id, l.article_id, 'shopify_variant', l.shopify_variant_id, 'lie',
       case when l.status = 'auto_exact' then case when l.match_via = 'barcode' then 'code_barres' else 'sku_exact' end else 'manuel' end,
       100,
       case when l.status = 'auto_exact' then 'Correspondance exacte et unique (règle W-6)' else 'Relié par une personne' end,
       jsonb_build_object('shopify_status', l.status),
       l.status = 'auto_exact', l.decided_by, case when l.status = 'auto_exact' then null else l.decided_at end
  from public.shopify_links l
  join public.articles a on a.id = l.article_id and a.company_id = l.company_id
 where l.status in ('auto_exact', 'valide') and l.article_id is not null
on conflict do nothing;

-- 3. Rapprochement relançable ------------------------------------------
create or replace function public.article_links_refresh(_company uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t0 timestamptz := clock_timestamp();
  n_new int := 0; n_changed int := 0; n_removed int := 0;
  st jsonb;
  tm jsonb := '{}'::jsonb;   -- durée de chaque étape (ms), pour le suivi
begin
  if not public._article_links_can_write(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  -- un seul rapprochement à la fois par société
  perform pg_advisory_xact_lock(hashtext('article_links_refresh:' || _company::text));

  drop table if exists pg_temp._al_art, pg_temp._al_want, pg_temp._al_var, pg_temp._al_tok, pg_temp._al_best;
  analyze public.article_links;   -- statistiques à jour (la table grossit d'un coup au premier passage)
  create temp table _al_art on commit drop as
    select a.id, a.reference, regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') as n, a.superseded_by_id
      from public.articles a
     where a.company_id = _company and a.is_active;
  create index on _al_art (n);
  analyze _al_art;

  create temp table _al_want (
    article_id uuid, target_kind text, target_ref text, status text, method text,
    score int, reason text, details jsonb
  ) on commit drop;

  -- A. Catalogue Ducati — référence identique (majuscules, sans espaces / points / tirets) : relié
  insert into _al_want
  select a.id, 'ducati_part', p.reference_norm, 'lie', 'ref_exacte', 100,
         'Même référence que le catalogue Ducati', jsonb_build_object('reference', p.reference)
    from _al_art a join public.ducati_catalog_parts p on p.reference_norm = a.n;

  insert into _al_want
  select distinct on (a.id, v.sku_norm) a.id, 'ducati_product', v.sku_norm, 'lie', 'ref_exacte', 100,
         'Même référence que le catalogue accessoires / vêtements Ducati',
         jsonb_build_object('reference', v.sku, 'product_code', v.product_code)
    from _al_art a join public.ducati_catalog_product_variants v on v.sku_norm = a.n
   order by a.id, v.sku_norm, v.product_code;

  tm := tm || jsonb_build_object('A', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  -- A2. Pièce d'occasion du DMS (« …OCC ») : c'est la pièce Ducati de même référence, vendue d'occasion
  insert into _al_want
  select a.id, 'ducati_part', p.reference_norm, 'lie', 'occasion', 95,
         'Pièce d''occasion de la référence Ducati ' || p.reference, jsonb_build_object('reference', p.reference)
    from _al_art a join public.ducati_catalog_parts p on p.reference_norm = regexp_replace(a.n, 'OCC$', '')
   where a.n ~ '[0-9][A-Z]*OCC$'
     and not exists (select 1 from public.ducati_catalog_parts q where q.reference_norm = a.n);

  -- B. Préfixe / suffixe connus (« /2 » des kits G8, « D- ») : à valider
  insert into _al_want
  select distinct on (a.id, p.reference_norm) a.id, 'ducati_part', p.reference_norm, 'a_valider', 'prefixe_suffixe', 40,
         'La référence du DMS « ' || a.reference || ' » est la référence Ducati ' || p.reference
           || ' avec un préfixe ou un suffixe (souvent un kit ou une version : à vérifier)',
         jsonb_build_object('reference', p.reference)
    from _al_art a
    cross join lateral (values (regexp_replace(upper(a.reference), '/[0-9]+$', '')),
                               (regexp_replace(upper(a.reference), '^(DUC|DU|D)[-_. ]', '')),
                               (regexp_replace(upper(a.reference), '[-_. ](DUC|D)$', ''))) x(r)
    join public.ducati_catalog_parts p on p.reference_norm = regexp_replace(x.r, '[^A-Z0-9]', '', 'g')
   where (a.reference ~ '/[0-9]+$' or upper(a.reference) ~ '^(DUC|DU|D)[-_. ]' or upper(a.reference) ~ '[-_. ](DUC|D)$')
     and p.reference_norm <> a.n
     and not exists (select 1 from public.ducati_catalog_parts q where q.reference_norm = a.n);

  tm := tm || jsonb_build_object('B', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  -- C. Même pièce, autre indice de révision (une seule référence Ducati possible ; hors notices 913…) : à valider
  insert into _al_want
  -- une lettre des deux côtés = indice de révision (50) ; deux ou trois lettres = souvent une couleur (35)
  select a.id, 'ducati_part', c.reference_norm, 'a_valider', 'revision',
         case when a.n ~ '[0-9][A-Z]$' and c.reference_norm ~ '[0-9][A-Z]$' then 50 else 35 end,
         'Même numéro de pièce, autre indice : ' || a.reference || ' (DMS) / ' || c.reference || ' (Ducati)'
           || case when a.n ~ '[0-9][A-Z]$' and c.reference_norm ~ '[0-9][A-Z]$' then ''
                   else ' — autre couleur ou finition possible' end,
         jsonb_build_object('reference', c.reference)
    from _al_art a
    cross join lateral (select regexp_replace(a.n, '[A-Z]{1,3}$', '') as b) bb
    cross join lateral (
      select p.reference_norm, p.reference, count(*) over () as cnt
        from public.ducati_catalog_parts p
       where regexp_replace(p.reference_norm, '[A-Z]{1,3}$', '') = bb.b and p.reference_norm ~ '[0-9][A-Z]{1,3}$'
       limit 2) c
   where a.n ~ '[0-9][A-Z]{1,3}$' and length(bb.b) >= 7 and bb.b !~ '^913' and c.cnt = 1
     and not exists (select 1 from public.ducati_catalog_parts q where q.reference_norm = a.n);

  tm := tm || jsonb_build_object('C', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  -- D. Remplacée dans le DMS (chaîne « remplacée par ») par une référence du catalogue : à valider
  insert into _al_want
  with recursive ch(start_id, cur_id, depth, path) as (
    select a.id, a.superseded_by_id, 1, array[a.id]
      from _al_art a
     where a.superseded_by_id is not null
       and not exists (select 1 from public.ducati_catalog_parts q where q.reference_norm = a.n)
    union all
    select ch.start_id, n.superseded_by_id, ch.depth + 1, ch.path || n.id
      from ch join public.articles n on n.id = ch.cur_id
     where ch.depth < 10 and n.superseded_by_id is not null and not (n.superseded_by_id = any (ch.path || n.id))
  )
  select distinct on (ch.start_id) ch.start_id, 'ducati_part', p.reference_norm, 'a_valider', 'remplacement_dms', 60,
         'Remplacée dans le DMS par ' || n.reference || ', présente dans le catalogue Ducati',
         jsonb_build_object('reference', p.reference, 'via_article_id', n.id, 'via_reference', n.reference, 'depth', ch.depth)
    from ch
    join public.articles n on n.id = ch.cur_id
    join public.ducati_catalog_parts p on p.reference_norm = regexp_replace(upper(n.reference), '[^A-Z0-9]', '', 'g')
   order by ch.start_id, ch.depth;

  tm := tm || jsonb_build_object('D', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  -- E. Shopify : candidats seulement (le relié d'office reste la règle W-6 de la lecture Shopify)
  create temp table _al_var on commit drop as
    select p.shopify_variant_id as v, p.sku, upper(btrim(coalesce(p.sku, ''))) as sku_u,
           public.ducati_catalog_norm_ref(p.sku) as sku_n,
           public.ducati_catalog_norm_ref(p.barcode) as bc_n,
           p.product_title, p.variant_title,
           coalesce(p.product_title, '') ~* '^\s*\(?\s*cop(ie|y)' as is_copy
      from public.shopify_products p
     where p.company_id = _company and p.removed_at is null
       -- pièce d'occasion (SKU « …OCC », « occasion » dans le titre) : jamais sur l'article de la pièce neuve
       -- (stock et prix différents) ; proposée à la création d'un article à part (aperçu, §9)
       and coalesce(public.ducati_catalog_norm_ref(p.sku), '') !~ 'OCC'
       and coalesce(p.product_title, '') || ' ' || coalesce(p.variant_title, '') !~* '(\mocc\M|\mocc\.|occasion)'
       and not exists (select 1 from public.shopify_links l          -- « ignoré » : pas d'article à relier
                        where l.company_id = _company and l.shopify_variant_id = p.shopify_variant_id
                          and l.status = 'ignore');

  -- E1. SKU = référence à la ponctuation près ; ou SKU identique mais porté par plusieurs variantes du site
  --     (la règle W-6 ne relie pas d'office : une personne choisit la bonne variante)
  insert into _al_want
  select a.id, 'shopify_variant', v.v, 'a_valider',
         case when upper(btrim(a.reference)) = v.sku_u then 'sku_ambigu' else 'sku_normalise' end, 90,
         case when upper(btrim(a.reference)) = v.sku_u
              then 'SKU « ' || v.sku || ' » = référence de l''article, mais plusieurs produits du site portent ce SKU'
              else 'SKU « ' || v.sku || ' » = référence « ' || a.reference || ' » sans tirets, points ni espaces' end,
         jsonb_build_object('sku', v.sku)
    from _al_var v join _al_art a on a.n = v.sku_n
   where v.sku_n is not null and length(v.sku_n) >= 5;

  -- E2. Code-barres Shopify = référence de l'article
  insert into _al_want
  select a.id, 'shopify_variant', v.v, 'a_valider', 'code_barres_ref', 85,
         'Code-barres Shopify « ' || v.bc_n || ' » = référence de l''article',
         jsonb_build_object('barcode', v.bc_n)
    from _al_var v join _al_art a on a.n = v.bc_n
   where v.bc_n is not null and length(v.bc_n) >= 5 and v.bc_n is distinct from v.sku_n;

  -- E3. Référence citée dans le titre du produit ou de la variante (hors pièces d'occasion « …OCC »)
  create index on _al_var (v);
  analyze _al_var;
  create temp table _al_tok on commit drop as
    select distinct v.v, tok
      from _al_var v
      cross join lateral regexp_split_to_table(upper(coalesce(v.product_title, '') || ' ' || coalesce(v.variant_title, '')), '[^A-Z0-9]+') tok
     where length(tok) between 7 and 12 and tok ~ '^[0-9]' and tok !~ 'OCC$';
  insert into _al_want
  select a.id, 'shopify_variant', v.v, 'a_valider', 'ref_dans_titre',
         case when v.is_copy then 60 else 80 end,
         'Référence « ' || a.reference || ' » citée dans le titre Shopify'
           || case when v.is_copy then ' (produit copié : vérifier)' else '' end,
         jsonb_build_object('token', t.tok, 'sku', v.sku)
    from _al_tok t join _al_var v on v.v = t.v join _al_art a on a.n = t.tok
   where t.tok is distinct from v.sku_n;

  -- E4. SKU ou titre = ancienne référence remplacée dans le DMS → article actuel de la chaîne
  insert into _al_want
  with recursive k(v, n) as (
    select v.v, v.sku_n from _al_var v where v.sku_n is not null and v.sku_n !~ 'OCC$'
    union select t.v, t.tok from _al_tok t
  ), ch(v, start_ref, cur_id, depth, path) as (
    select k.v, o.reference, o.superseded_by_id, 1, array[o.id]
      from k join public.articles o
        on o.company_id = _company and regexp_replace(upper(o.reference), '[^A-Z0-9]', '', 'g') = k.n
     where o.superseded_by_id is not null
    union all
    select ch.v, ch.start_ref, n.superseded_by_id, ch.depth + 1, ch.path || n.id
      from ch join public.articles n on n.id = ch.cur_id
     where ch.depth < 10 and n.superseded_by_id is not null and not (n.superseded_by_id = any (ch.path || n.id))
  )
  select distinct on (ch.v) a.id, 'shopify_variant', ch.v, 'a_valider', 'remplacement_dms', 70,
         'La référence « ' || ch.start_ref || ' » du produit est remplacée dans le DMS par ' || a.reference,
         jsonb_build_object('old_reference', ch.start_ref, 'depth', ch.depth)
    from ch join _al_art a on a.id = ch.cur_id
   where not exists (select 1 from public.articles x where x.id = ch.cur_id and x.superseded_by_id is not null)
   order by ch.v, ch.depth;

  tm := tm || jsonb_build_object('E', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  -- F. Nettoyage des candidats : meilleure raison par cible ; rien pour ce qui est déjà relié
  create temp table _al_best on commit drop as
    select distinct on (article_id, target_kind, target_ref) *
      from _al_want order by article_id, target_kind, target_ref, score desc, method;
  truncate _al_want;
  insert into _al_want select * from _al_best;
  create index on _al_want (article_id, target_kind, target_ref);
  create index on _al_want (target_kind, target_ref);
  analyze _al_want;
  -- Ducati : pas de candidat si l'article a déjà sa référence Ducati (automatique ou décidée)
  delete from _al_want w using _al_want x
   where w.status = 'a_valider' and w.target_kind <> 'shopify_variant'
     and x.article_id = w.article_id and x.target_kind = w.target_kind and x.status = 'lie';
  delete from _al_want w using public.article_links l
   where w.status = 'a_valider' and w.target_kind <> 'shopify_variant'
     and l.company_id = _company and l.article_id = w.article_id and l.target_kind = w.target_kind
     and l.status = 'lie' and l.target_ref <> w.target_ref;
  -- Ducati relié automatiquement : jamais par-dessus un lien choisi par une personne
  delete from _al_want w using public.article_links l
   where w.status = 'lie'
     and l.company_id = _company and l.article_id = w.article_id and l.target_kind = w.target_kind
     and l.status = 'lie' and l.target_ref <> w.target_ref and not l.is_auto;
  -- Shopify : variante déjà reliée (sauf à un article remplacé : on propose l'article actuel) ;
  --           article déjà relié à une autre variante (on ne pourrait pas accepter)
  delete from _al_want w
   where w.target_kind = 'shopify_variant'
     and (exists (select 1 from public.article_links l join public.articles la on la.id = l.article_id
                   where l.company_id = _company and l.target_kind = 'shopify_variant' and l.target_ref = w.target_ref
                     and l.status = 'lie' and (l.article_id = w.article_id or la.superseded_by_id is null))
       or exists (select 1 from public.article_links l
                   where l.company_id = _company and l.target_kind = 'shopify_variant' and l.article_id = w.article_id
                     and l.status = 'lie' and l.target_ref <> w.target_ref));

  tm := tm || jsonb_build_object('F', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  -- G. Liens automatiques qui ne tiennent plus (référence modifiée, article désactivé…) : retirés
  with d as (
    delete from public.article_links l
     where l.company_id = _company and l.is_auto and l.decided_by is null and l.status in ('lie', 'a_valider')
       and not (l.target_kind = 'shopify_variant' and l.status = 'lie')   -- gouverné par shopify_links
       and not exists (select 1 from _al_want w where w.article_id = l.article_id and w.target_kind = l.target_kind
                         and w.target_ref = l.target_ref)
    returning 1)
  select count(*) into n_removed from d;

  tm := tm || jsonb_build_object('G', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  -- H. Écriture : jamais par-dessus une décision humaine ni un lien rejeté
  with u as (
    insert into public.article_links as l (company_id, article_id, target_kind, target_ref, status, method, score, reason, details, is_auto)
    select _company, w.article_id, w.target_kind, w.target_ref, w.status, w.method, w.score, w.reason, w.details, true
      from _al_want w
    on conflict (company_id, article_id, target_kind, target_ref) do update set
      status = excluded.status, method = excluded.method, score = excluded.score, reason = excluded.reason,
      details = excluded.details, updated_at = now()
    where l.is_auto and l.decided_by is null and l.status <> 'rejete'
      and not (l.target_kind = 'shopify_variant' and l.status = 'lie')
      and (l.status, l.method, l.score, l.reason, l.details)
          is distinct from (excluded.status, excluded.method, excluded.score, excluded.reason, excluded.details)
    returning (xmax = 0) as inserted)
  select count(*) filter (where inserted), count(*) filter (where not inserted) into n_new, n_changed from u;

  if n_new + n_removed > 1000 then analyze public.article_links; end if;
  st := public._article_links_stats(_company) || jsonb_build_object(
          'new', n_new, 'changed', n_changed, 'removed', n_removed,
          'duration_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int, 'steps_ms', tm);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'article_links_refresh', 'article_links', _company::text,
          case when auth.uid() is null then 'system' else 'screen' end, null, st);
  return st;
end $$;

-- 4. Compteurs ---------------------------------------------------------
create or replace function public._article_links_stats(_company uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with act as (select a.id from public.articles a where a.company_id = _company and a.is_active),
  lk as (select l.article_id, l.target_kind, l.status, l.method from public.article_links l where l.company_id = _company),
  per as (
    select act.id,
           bool_or(lk.target_kind in ('ducati_part', 'ducati_product') and lk.status = 'lie') as d,
           bool_or(lk.target_kind = 'shopify_variant' and lk.status = 'lie') as s,
           bool_or(lk.target_kind = 'g8' and lk.status = 'lie') as g
      from act left join lk on lk.article_id = act.id
     group by act.id)
  select jsonb_build_object(
    'articles', (select count(*) from per),
    'ducati', (select count(*) from per where d),
    'shopify', (select count(*) from per where s),
    'both', (select count(*) from per where d and s),
    'none', (select count(*) from per where not coalesce(d, false) and not coalesce(s, false)),
    'g8', (select count(*) from per where g),
    'pending', (select count(*) from lk where status = 'a_valider'),
    'rejected', (select count(*) from lk where status = 'rejete'),
    'by_method', coalesce((select jsonb_object_agg(k, c) from (
        select target_kind || ':' || status || ':' || method as k, count(*) as c from lk group by 1) x), '{}'::jsonb),
    'shopify_variants', (select count(*) from public.shopify_products p where p.company_id = _company and p.removed_at is null),
    'shopify_variants_linked', (select count(*) from lk where target_kind = 'shopify_variant' and status = 'lie'),
    'ducati_parts', (select count(*) from public.ducati_catalog_parts));
$$;
revoke all on function public._article_links_stats(uuid) from public, anon, authenticated;

create or replace function public.article_links_counts(_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return public._article_links_stats(_company);
end $$;

-- 5. Liste « Rapprochements à valider » (paginée) -----------------------
create or replace function public.article_links_review(
  _company uuid, _kind text default null, _method text default null, _q text default null,
  _status text default 'a_valider', _limit integer default 50, _offset integer default 0)
returns table (
  id uuid, article_id uuid, article_reference text, article_designation text, article_sale_price_ttc numeric,
  target_kind text, target_ref text, target_label text, target_extra jsonb,
  status text, method text, score smallint, reason text, decided_at timestamptz, decision_note text,
  total_count bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  n integer := least(greatest(coalesce(_limit, 50), 1), 200);
  o integer := greatest(coalesce(_offset, 0), 0);
  k text := nullif(btrim(coalesce(_q, '')), '');
  shop_ok boolean := public.is_admin(_company) or public.has_role(_company, 'vendeur');
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select l.id, a.id, a.reference, a.designation, a.sale_price_ttc,
         l.target_kind, l.target_ref,
         coalesce(case l.target_kind
                    when 'ducati_part' then (select p.reference || ' — ' || coalesce(p.description, '') from public.ducati_catalog_parts p where p.reference_norm = l.target_ref)
                    when 'ducati_product' then (select v.sku || ' — ' || coalesce(v.name, pr.name, '') from public.ducati_catalog_product_variants v
                                                  join public.ducati_catalog_products pr on pr.code = v.product_code
                                                 where v.sku_norm = l.target_ref limit 1)
                    else (select coalesce(sp.product_title, '') || coalesce(' / ' || nullif(sp.variant_title, 'Default Title'), '')
                            from public.shopify_products sp where sp.company_id = _company and sp.shopify_variant_id = l.target_ref)
                  end, l.target_ref),
         case l.target_kind
           when 'ducati_part' then (select jsonb_build_object('price_ht', p.catalog_price_ht, 'replaced', p.replaced)
                                      from public.ducati_catalog_parts p where p.reference_norm = l.target_ref)
           when 'shopify_variant' then (select jsonb_build_object('sku', sp.sku, 'price', sp.price, 'qty', sp.inventory_quantity,
                                                                  'status', sp.status, 'image_url', sp.image_url)
                                          from public.shopify_products sp where sp.company_id = _company and sp.shopify_variant_id = l.target_ref)
           else '{}'::jsonb end,
         l.status, l.method, l.score, l.reason, l.decided_at, l.decision_note,
         count(*) over ()
    from public.article_links l
    join public.articles a on a.id = l.article_id
   where l.company_id = _company
     and l.status = coalesce(_status, 'a_valider')
     and l.target_kind <> 'g8'
     and (_kind is null or (_kind = 'ducati' and l.target_kind in ('ducati_part', 'ducati_product')) or l.target_kind = _kind)
     and (_method is null or l.method = _method)
     and (l.target_kind <> 'shopify_variant' or shop_ok)
     and (k is null or a.reference ilike '%' || k || '%' or a.designation ilike '%' || k || '%' or l.target_ref ilike '%' || k || '%')
   order by l.score desc, l.method, a.reference
   limit n offset o;
end $$;

-- 6. Décisions en masse (administrateurs) -------------------------------
create or replace function public.article_links_decide(_company uuid, _ids uuid[], _decision text, _note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  other uuid;
  n_ok int := 0;
  skipped jsonb := '[]'::jsonb;
  old_shop public.shopify_links%rowtype;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if _decision not in ('lie', 'rejete') then
    raise exception 'Décision inconnue : %', _decision using errcode = '22023';
  end if;
  if coalesce(array_length(_ids, 1), 0) > 500 then
    raise exception 'Au plus 500 liens par envoi.' using errcode = '22023';
  end if;

  for r in
    select l.* from public.article_links l
     where l.company_id = _company and l.id = any (_ids)
     order by l.score desc
     for update
  loop
    if r.status = _decision then continue; end if;

    if _decision = 'lie' then
      -- l'article a déjà un lien « lié » de cette sorte
      select l2.id into other from public.article_links l2
       where l2.company_id = _company and l2.article_id = r.article_id and l2.target_kind = r.target_kind
         and l2.status = 'lie' and l2.id <> r.id limit 1;
      if other is not null then
        skipped := skipped || jsonb_build_object('id', r.id, 'reason', 'article_deja_relie');
        continue;
      end if;
      if r.target_kind = 'shopify_variant' then
        if not exists (select 1 from public.shopify_products p where p.company_id = _company
                         and p.shopify_variant_id = r.target_ref and p.removed_at is null) then
          skipped := skipped || jsonb_build_object('id', r.id, 'reason', 'variante_absente');
          continue;
        end if;
        -- variante reliée à un autre article : seulement si cet article est remplacé (on passe à l'actuel)
        if exists (select 1 from public.article_links l2 join public.articles a2 on a2.id = l2.article_id
                    where l2.company_id = _company and l2.target_kind = 'shopify_variant' and l2.target_ref = r.target_ref
                      and l2.status = 'lie' and l2.article_id <> r.article_id and a2.superseded_by_id is null) then
          skipped := skipped || jsonb_build_object('id', r.id, 'reason', 'variante_deja_reliee');
          continue;
        end if;
      end if;

      if r.target_kind = 'shopify_variant' then
        -- la variante quitte l'article remplacé : son ancien lien est rejeté
        update public.article_links l2 set status = 'rejete', is_auto = false, decided_by = auth.uid(), decided_at = now(),
               decision_note = 'Article remplacé : relié à l''article actuel', updated_at = now()
         where l2.company_id = _company and l2.target_kind = 'shopify_variant' and l2.target_ref = r.target_ref
           and l2.status = 'lie' and l2.article_id <> r.article_id;
      end if;

      update public.article_links set status = 'lie', is_auto = false, decided_by = auth.uid(), decided_at = now(),
             decision_note = _note, updated_at = now()
       where id = r.id;

      if r.target_kind = 'shopify_variant' then
        select * into old_shop from public.shopify_links where company_id = _company and shopify_variant_id = r.target_ref;
        insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
        values (_company, r.target_ref, r.article_id, 'valide', null, auth.uid(), now())
        on conflict (company_id, shopify_variant_id) do update
          set article_id = excluded.article_id, status = 'valide', match_via = null,
              decided_by = excluded.decided_by, decided_at = now();
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_company, auth.uid(), 'shopify_link', 'shopify_links', r.target_ref, 'screen',
                case when old_shop.id is null then null else jsonb_build_object('status', old_shop.status, 'article_id', old_shop.article_id) end,
                jsonb_build_object('status', 'valide', 'article_id', r.article_id, 'via', 'rapprochement', 'method', r.method));
      end if;
    else
      update public.article_links set status = 'rejete', is_auto = false, decided_by = auth.uid(), decided_at = now(),
             decision_note = _note, updated_at = now()
       where id = r.id;
      -- un lien Shopify « relié » rejeté = variante déliée (elle ne sera plus reliée d'office)
      if r.target_kind = 'shopify_variant' and r.status = 'lie' then
        select * into old_shop from public.shopify_links where company_id = _company and shopify_variant_id = r.target_ref;
        if old_shop.id is not null and old_shop.article_id = r.article_id then
          update public.shopify_links set article_id = null, status = 'a_valider', match_via = null,
                 decided_by = auth.uid(), decided_at = now()
           where id = old_shop.id;
          insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
          values (_company, auth.uid(), 'shopify_unlink', 'shopify_links', r.target_ref, 'screen',
                  jsonb_build_object('status', old_shop.status, 'article_id', old_shop.article_id),
                  jsonb_build_object('status', 'a_valider', 'via', 'rapprochement'));
        end if;
      end if;
    end if;

    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), case when _decision = 'lie' then 'article_link_accept' else 'article_link_reject' end,
            'article_links', r.id::text, 'screen',
            jsonb_build_object('status', r.status, 'article_id', r.article_id, 'target_kind', r.target_kind,
                               'target_ref', r.target_ref, 'method', r.method, 'score', r.score),
            jsonb_build_object('status', _decision, 'note', _note));
    n_ok := n_ok + 1;
  end loop;
  return jsonb_build_object('done', n_ok, 'skipped', skipped);
end $$;

-- 7. Lien manuel vers le catalogue Ducati (administrateurs) --------------
create or replace function public.article_links_link_ducati(_company uuid, _article uuid, _reference text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k text := public.ducati_catalog_norm_ref(_reference);
  v_kind text;
  v_label text;
  v_id uuid;
  old_l public.article_links%rowtype;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.articles where id = _article and company_id = _company) then
    raise exception 'Article introuvable dans cette société.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.ducati_catalog_parts where reference_norm = k) then
    v_kind := 'ducati_part';
    select reference into v_label from public.ducati_catalog_parts where reference_norm = k;
  elsif exists (select 1 from public.ducati_catalog_product_variants where sku_norm = k) then
    v_kind := 'ducati_product';
    select sku into v_label from public.ducati_catalog_product_variants where sku_norm = k limit 1;
  else
    raise exception 'Référence % absente du catalogue Ducati.', coalesce(_reference, '') using errcode = 'P0002';
  end if;

  select * into old_l from public.article_links
   where company_id = _company and article_id = _article and target_kind = v_kind and status = 'lie' and target_ref <> k;
  if old_l.id is not null then
    update public.article_links set status = 'rejete', is_auto = false, decided_by = auth.uid(), decided_at = now(),
           decision_note = 'Remplacé par un lien manuel vers ' || v_label, updated_at = now()
     where id = old_l.id;
  end if;

  insert into public.article_links as l (company_id, article_id, target_kind, target_ref, status, method, score, reason,
                                         details, is_auto, decided_by, decided_at)
  values (_company, _article, v_kind, k, 'lie', 'manuel', 100, 'Relié par une personne',
          jsonb_build_object('reference', v_label), false, auth.uid(), now())
  on conflict (company_id, article_id, target_kind, target_ref) do update
    set status = 'lie', is_auto = false, decided_by = auth.uid(), decided_at = now(), updated_at = now()
  returning l.id into v_id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'article_link_manual', 'article_links', v_id::text, 'screen',
          case when old_l.id is null then null else jsonb_build_object('target_ref', old_l.target_ref, 'method', old_l.method) end,
          jsonb_build_object('article_id', _article, 'target_kind', v_kind, 'target_ref', k));
  return v_id;
end $$;

-- 8. Fiche article : ses liens, avec les informations Ducati et Shopify ---
create or replace function public.article_links_for_article(_company uuid, _article uuid)
returns table (
  id uuid, target_kind text, target_ref text, status text, method text, score smallint, reason text,
  is_auto boolean, decided_at timestamptz, decision_note text, info jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  shop_ok boolean := public.is_admin(_company) or public.has_role(_company, 'vendeur');
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select l.id, l.target_kind, l.target_ref, l.status, l.method, l.score, l.reason, l.is_auto, l.decided_at, l.decision_note,
         case l.target_kind
           when 'ducati_part' then (
             select jsonb_build_object(
                      'reference', p.reference, 'description', p.description,
                      'price_ht', p.catalog_price_ht, 'price_ttc', p.catalog_price_ttc, 'price_seen_at', p.price_seen_at,
                      'replaced', p.replaced, 'has_tempario', p.has_tempario,
                      'drawing', (select jsonb_build_object('id', d.id, 'code', d.code, 'description', d.description,
                                                            'thumbnail_url', d.thumbnail_url, 'image_url', coalesce(d.image_url, d.original_image_url))
                                    from public.ducati_catalog_drawing_lines dl
                                    join public.ducati_catalog_drawings d on d.id = dl.drawing_id
                                   where dl.reference_norm = p.reference_norm
                                   order by (d.image_url is null and d.thumbnail_url is null), dl.drawing_id
                                   limit 1))
               from public.ducati_catalog_parts p where p.reference_norm = l.target_ref)
           when 'ducati_product' then (
             select jsonb_build_object('reference', v.sku, 'description', coalesce(v.name, pr.name), 'kind', pr.kind,
                                       'size', v.size, 'color', v.color, 'price_ht', coalesce(v.price_ht, pr.price_ht),
                                       'price_ttc', coalesce(v.price_ttc, pr.price_ttc), 'image_url', pr.image_url,
                                       'models', (select jsonb_agg(m order by m.family, m.model, m.model_year desc) from (
                                                    select distinct pa.family, pa.model, pa.model_year
                                                      from public.ducati_catalog_product_applicabilities pa
                                                     where pa.sku_norm = l.target_ref and pa.is_europe
                                                     limit 120) m))
               from public.ducati_catalog_product_variants v join public.ducati_catalog_products pr on pr.code = v.product_code
              where v.sku_norm = l.target_ref limit 1)
           else (
             select jsonb_build_object('product_id', sp.shopify_product_id, 'title', sp.product_title,
                                       'variant_title', sp.variant_title, 'handle', sp.handle, 'status', sp.status,
                                       'sku', sp.sku, 'barcode', sp.barcode, 'price', sp.price,
                                       'qty', sp.inventory_quantity, 'image_url', sp.image_url, 'synced_at', sp.synced_at,
                                       'removed', sp.removed_at is not null)
               from public.shopify_products sp where sp.company_id = _company and sp.shopify_variant_id = l.target_ref)
         end
    from public.article_links l
   where l.company_id = _company and l.article_id = _article
     and (l.target_kind <> 'shopify_variant' or shop_ok)
   order by case l.status when 'lie' then 0 when 'a_valider' then 1 else 2 end, l.target_kind, l.score desc;
end $$;

-- 9. Création d'articles en masse : APERÇU seulement (rien n'est créé) ---
-- Pièces Ducati et variantes Shopify qui n'ont aucun article DMS (ni relié, ni candidat).
create or replace function public.article_links_creation_preview(_company uuid, _limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  n integer := least(greatest(coalesce(_limit, 50), 0), 500);
  res jsonb;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  with dc as (
    select p.reference_norm, p.reference, p.description, p.catalog_price_ht
      from public.ducati_catalog_parts p
     where not exists (select 1 from public.articles a where a.company_id = _company
                         and regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') = p.reference_norm)
       and not exists (select 1 from public.article_links l where l.company_id = _company
                         and l.target_kind = 'ducati_part' and l.target_ref = p.reference_norm and l.status in ('lie', 'a_valider'))
  ), sv as (
    select p.shopify_variant_id, p.sku, p.product_title, p.variant_title, p.price, p.status, p.product_type,
           public.ducati_catalog_norm_ref(p.sku) as sku_n
      from public.shopify_products p
     where p.company_id = _company and p.removed_at is null
       and not exists (select 1 from public.article_links l where l.company_id = _company and l.target_kind = 'shopify_variant'
                         and l.target_ref = p.shopify_variant_id and l.status in ('lie', 'a_valider'))
       and not exists (select 1 from public.shopify_links sl where sl.company_id = _company
                         and sl.shopify_variant_id = p.shopify_variant_id and sl.status = 'ignore')
  ), sc as (
    select sv.*,
           case
             when coalesce(sv.product_type, '') in ('Moto d''occasion', 'Moto neuve', 'Motorcycles & Scooters', 'Voiture occasion')
               or (sv.sku_n is null and coalesce(sv.price, 0) >= 1500) then 'moto'
             when sv.sku_n is null then 'sans_reference'
             when sv.sku_n ~ 'OCC$'
               or coalesce(sv.product_title, '') || ' ' || coalesce(sv.variant_title, '') ~* '(\mocc\M|\mocc\.|occasion)' then 'occasion'
             when exists (select 1 from public.articles a where a.company_id = _company
                            and regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') = sv.sku_n) then 'article_deja_relie_ailleurs'
             when exists (select 1 from public.ducati_catalog_parts q where q.reference_norm = sv.sku_n) then 'piece_ducati'
             when exists (select 1 from public.ducati_catalog_product_variants q where q.sku_norm = sv.sku_n) then 'accessoire_vetement_ducati'
             when sv.sku_n ~ '^98' then 'vetement_98'
             when sv.sku_n ~ '^9[67]' then 'accessoire_96_97'
             else 'autre_reference'
           end as family
      from sv
  )
  select jsonb_build_object(
    'ducati_parts_without_article', (select count(*) from dc),
    'ducati_parts_with_price', (select count(*) from dc where catalog_price_ht > 0),
    'ducati_sample', coalesce((select jsonb_agg(x) from (select reference, description, catalog_price_ht from dc order by reference limit n) x), '[]'::jsonb),
    'shopify_without_article', (select count(*) from sc),
    'shopify_by_family', coalesce((select jsonb_object_agg(family, c) from (select family, count(*) c from sc group by family) y), '{}'::jsonb),
    'shopify_proposed', (select count(*) from sc where family in ('piece_ducati', 'accessoire_vetement_ducati', 'vetement_98',
                                                                 'accessoire_96_97', 'occasion', 'autre_reference')),
    'shopify_sample', coalesce((select jsonb_agg(z) from (
        select sku, product_title, variant_title, price, status, family from sc
         where family not in ('moto', 'sans_reference', 'article_deja_relie_ailleurs')
         order by family, sku limit n) z), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- 10. Droits -------------------------------------------------------------
revoke all on function public.article_links_refresh(uuid) from public, anon;
grant execute on function public.article_links_refresh(uuid) to authenticated, service_role;
revoke all on function public.article_links_counts(uuid) from public, anon;
grant execute on function public.article_links_counts(uuid) to authenticated;
revoke all on function public.article_links_review(uuid, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.article_links_review(uuid, text, text, text, text, integer, integer) to authenticated;
revoke all on function public.article_links_decide(uuid, uuid[], text, text) from public, anon;
grant execute on function public.article_links_decide(uuid, uuid[], text, text) to authenticated;
revoke all on function public.article_links_link_ducati(uuid, uuid, text) from public, anon;
grant execute on function public.article_links_link_ducati(uuid, uuid, text) to authenticated;
revoke all on function public.article_links_for_article(uuid, uuid) from public, anon;
grant execute on function public.article_links_for_article(uuid, uuid) to authenticated;
revoke all on function public.article_links_creation_preview(uuid, integer) from public, anon;
grant execute on function public.article_links_creation_preview(uuid, integer) to authenticated;

-- 11. Premier rapprochement (à l'application de la migration) -------------
select public.article_links_refresh(c.id) from public.companies c;
