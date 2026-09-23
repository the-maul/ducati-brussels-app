-- =====================================================================
-- Missions 03 + 06 — Rapprochement : on corrige la CAUSE des 10 250 « à valider »
--
-- Quatre corrections dans article_links_refresh (le détail des causes est en tête de la
-- migration 20260923140000) :
--   1. « sku_ambigu » n'est posé que si plusieurs produits du site portent vraiment le SKU ;
--   2. une référence du catalogue Ducati = UN article (M-25) : plus de candidat sur une
--      référence déjà reliée à un autre article (c'était 10 111 candidats sur 10 250) ;
--   3. une variante du site déjà reliée ne reçoit plus de candidat concurrent, même quand
--      l'article relié est « remplacé par » un autre ;
--   4. le rapprochement appelle article_links_autoresolve() à la fin : chaque passage décide
--      ce qui peut l'être et ne laisse plus de file à trier à la main ;
--   5. une moto du site n'est plus proposée à un article pièce (M-25) : deux motos neuves
--      (DESERTX, PANIGALEV4R) remontaient parce que leur SKU est aussi une référence d'article.
-- Les décisions automatiques (details->>'auto_rule') ne sont jamais redescendues en
-- « à valider », et une décision humaine reste intouchable.
--
-- Additif : aucune table, aucune colonne. Une seule fonction remplacée.
-- =====================================================================

-- 3. Rapprochement relançable ------------------------------------------
create or replace function public.article_links_refresh(_company uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t0 timestamptz := clock_timestamp();
  n_new int := 0; n_changed int := 0; n_removed int := 0;
  st jsonb;
  auto jsonb := '{}'::jsonb; -- compte rendu de la décision automatique (faisceau d'indices)
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
           coalesce(p.product_title, '') ~* '^\s*\(?\s*cop(ie|y)' as is_copy,
           count(*) filter (where coalesce(btrim(p.sku), '') <> '')
             over (partition by upper(btrim(coalesce(p.sku, '')))) as n_same
      from public.shopify_products p
     where p.company_id = _company and p.removed_at is null
       -- (23/09) une moto du site n'est pas un article pièce (M-25) : jamais de candidat dessus
       and not public._shopify_is_moto(p.product_type, p.sku, p.price)
       -- pièce d'occasion (SKU « …OCC », « occasion » dans le titre) : jamais sur l'article de la pièce neuve
       -- (stock et prix différents) ; proposée à la création d'un article à part (aperçu, §9)
       and coalesce(public.ducati_catalog_norm_ref(p.sku), '') !~ 'OCC'
       and coalesce(p.product_title, '') || ' ' || coalesce(p.variant_title, '') !~* '(\mocc\M|\mocc\.|occasion)'
       and not exists (select 1 from public.shopify_links l          -- « ignoré » : pas d'article à relier
                        where l.company_id = _company and l.shopify_variant_id = p.shopify_variant_id
                          and l.status = 'ignore');

  -- E1. SKU = référence à la ponctuation près ; « sku_ambigu » UNIQUEMENT si plusieurs produits
  --     du site portent réellement ce SKU (avant le 23/09 la méthode était posée dès que
  --     SKU = référence, et sa phrase « plusieurs produits portent ce SKU » était fausse sur 23 cas
  --     sur 23 : c'est ce qui laissait l'étalon de Simon en « à valider »).
  insert into _al_want
  select a.id, 'shopify_variant', v.v, 'a_valider',
         case when upper(btrim(a.reference)) = v.sku_u and v.n_same > 1 then 'sku_ambigu'
              else 'sku_normalise' end,
         90,
         case when upper(btrim(a.reference)) = v.sku_u and v.n_same > 1
              then 'SKU « ' || v.sku || ' » = référence de l''article, mais ' || v.n_same
                   || ' produits du site portent ce SKU'
              when upper(btrim(a.reference)) = v.sku_u
              then 'SKU « ' || v.sku || ' » = référence de l''article'
              else 'SKU « ' || v.sku || ' » = référence « ' || a.reference || ' » sans tirets, points ni espaces' end,
         jsonb_build_object('sku', v.sku, 'produits_meme_sku', v.n_same)
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
  -- Une référence du catalogue = UN article (M-25) : pas de candidat sur une référence déjà
  -- reliée à un autre article. C'était la cause des 10 111 candidats du 23/09, tous posés sur
  -- une référence que l'article de remplacement ou l'article de même référence portait déjà.
  delete from _al_want w using public.article_links l
   where w.status = 'a_valider' and w.target_kind <> 'shopify_variant'
     and l.company_id = _company and l.target_kind = w.target_kind and l.target_ref = w.target_ref
     and l.status = 'lie' and l.article_id <> w.article_id;
  delete from _al_want w using _al_want x
   where w.status = 'a_valider' and w.target_kind <> 'shopify_variant'
     and x.status = 'lie' and x.target_kind = w.target_kind and x.target_ref = w.target_ref
     and x.article_id <> w.article_id;
  -- Ducati relié automatiquement : jamais par-dessus un lien choisi par une personne
  delete from _al_want w using public.article_links l
   where w.status = 'lie'
     and l.company_id = _company and l.article_id = w.article_id and l.target_kind = w.target_kind
     and l.status = 'lie' and l.target_ref <> w.target_ref and not l.is_auto;
  -- Shopify : variante déjà reliée (sauf à un article remplacé : on propose l'article actuel) ;
  --           article déjà relié à une autre variante (on ne pourrait pas accepter)
  -- (23/09) une variante déjà reliée ne reçoit plus de candidat concurrent, même si l'article
  -- relié est « remplacé par » un autre : le produit du site porte l'ancienne référence, il reste
  -- sur l'article de cette référence ; le remplacement est porté par le champ « remplacée par ».
  delete from _al_want w
   where w.target_kind = 'shopify_variant'
     and (exists (select 1 from public.article_links l
                   where l.company_id = _company and l.target_kind = 'shopify_variant' and l.target_ref = w.target_ref
                     and l.status = 'lie')
       or exists (select 1 from public.shopify_links sl
                   where sl.company_id = _company and sl.shopify_variant_id = w.target_ref
                     and sl.status in ('auto_exact', 'valide') and sl.article_id is not null)
       or exists (select 1 from public.article_links l
                   where l.company_id = _company and l.target_kind = 'shopify_variant' and l.article_id = w.article_id
                     and l.status = 'lie' and l.target_ref <> w.target_ref));

  tm := tm || jsonb_build_object('F', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  -- G. Liens automatiques qui ne tiennent plus (référence modifiée, article désactivé…) : retirés
  with d as (
    delete from public.article_links l
     where l.company_id = _company and l.is_auto and l.decided_by is null and l.status in ('lie', 'a_valider')
       and not (l.details ? 'auto_rule')                                  -- décision du faisceau : gardée
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
      and not (l.details ? 'auto_rule')
      and not (l.target_kind = 'shopify_variant' and l.status = 'lie')
      and (l.status, l.method, l.score, l.reason, l.details)
          is distinct from (excluded.status, excluded.method, excluded.score, excluded.reason, excluded.details)
    returning (xmax = 0) as inserted)
  select count(*) filter (where inserted), count(*) filter (where not inserted) into n_new, n_changed from u;

  if n_new + n_removed > 1000 then analyze public.article_links; end if;

  -- Décision automatique dans la foulée : le rapprochement ne laisse plus de file à trier.
  auto := public.article_links_autoresolve(_company);

  st := public._article_links_stats(_company) || jsonb_build_object('autoresolve', auto) || jsonb_build_object(
          'new', n_new, 'changed', n_changed, 'removed', n_removed,
          'duration_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int, 'steps_ms', tm);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'article_links_refresh', 'article_links', _company::text,
          case when auth.uid() is null then 'system' else 'screen' end, null, st);
  return st;
end $$;
