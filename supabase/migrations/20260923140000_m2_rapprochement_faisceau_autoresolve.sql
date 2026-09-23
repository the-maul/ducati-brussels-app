-- =====================================================================
-- Missions 03 + 06 — Rapprochement : décision automatique par faisceau d'indices
--
-- Demande de Simon (23/09, chat) : « pour les 10 250 rapprochements proposés, tu dois toi-même
-- les vérifier et accepter si c'est raisonnablement bon… il faut trouver un moyen de purifier
-- tous ces éléments sans validation humaine, c'est intenable. »
-- Étalon donné par Simon : article 46010383A « PROTECTION PIED DROIT » 176,78 € ↔ produit du site
-- « 46010383A - PROTECTION PIED DROIT », SKU 46010383A, 176,78 €, en ligne. Ce cas était « à
-- valider » : il doit être relié d'office.
--
-- CAUSES TROUVÉES (corrigées ici, pas seulement les lignes) :
--
--  1. La liaison d'office W-6 (« SKU exact et unique ») n'existait QUE dans la lecture Shopify
--     (fonction serveur shopify-sync-products). Les articles créés après la dernière lecture
--     (M-25, création des articles manquants le 23/09 ; dernière lecture le 21/09) ne pouvaient
--     donc jamais être reliés d'office : ils restaient « à valider » jusqu'à la prochaine lecture.
--     → La règle W-6 est maintenant AUSSI appliquée en base, relançable, par
--       article_links_autoresolve() : plus besoin d'attendre une lecture Shopify.
--
--  2. La méthode « sku_ambigu » était posée dès que SKU = référence, SANS vérifier qu'un autre
--     produit porte le même SKU. Sa phrase « plusieurs produits du site portent ce SKU » était
--     fausse sur les 23 cas en base (un seul produit à chaque fois). → l'étape E1 compte
--     désormais les produits qui portent le SKU : « sku_ambigu » n'est posé que si c'est vrai.
--
--  3. Une référence Ducati déjà reliée à un article était quand même reproposée à d'autres
--     articles (chaîne « remplacée par », indice de révision) : 10 111 candidats sur 10 250,
--     tous sur une référence DÉJÀ reliée. → l'étape F écarte ces candidats : une référence du
--     catalogue = un article (M-25).
--
--  4. Un produit du site dont le SKU est exactement la référence d'un article du DMS était
--     reproposé à l'article de remplacement (9 cas, tous déjà reliés par leur SKU). → écarté.
--
-- CE QUE FAIT article_links_autoresolve(société) — relançable, idempotente, appelée à la fin de
-- chaque article_links_refresh() :
--   R1. Shopify, SKU exact (W-6, rattrapage) : SKU = référence d'un seul article actif et un seul
--       produit du site porte ce SKU → relié d'office (shopify_links « auto_exact »).
--       SKU partagé : si UN SEUL produit est ACTIF (ni brouillon ni archivé), c'est lui (demande
--       de Simon) ; plusieurs produits actifs → laissé à une personne.
--   R2. Faisceau d'indices : la référence de l'article est le PREMIER mot du titre du produit,
--       la désignation se retrouve dans le titre (≥ 70 % des mots) OU le prix colle à 5 % près,
--       un seul candidat des deux côtés, aucun SKU concurrent → relié d'office.
--   R3. Produit du site sans SKU dont l'article « SHOP-… » a été créé depuis ce produit même :
--       relié d'office (le lien est vrai par construction). Si le même produit a aussi un
--       candidat sur un VRAI article (référence dans le titre), c'est le vrai article qui gagne :
--       l'article « SHOP-… » est désactivé et son stock d'origine est transféré par un mouvement.
--   R4. Rejets automatiques, avec la raison : candidats du catalogue Ducati dont la référence est
--       déjà reliée à un autre article, et candidats Shopify dont la variante est déjà reliée par
--       son SKU exact.
--
-- Jamais par-dessus une décision humaine (decided_by non nul, ou is_auto faux) ; un lien rejeté
-- n'est jamais recréé. Les décisions automatiques portent details->>'auto_rule' : le rapprochement
-- ne les redescend pas en « à valider ».
--
-- Aucune écriture de prix ni de stock, sauf le transfert de stock de R3 (mouvements uniquement).
-- Rien n'est écrit sur Shopify (la synchronisation est en mode « arrêté » ; la file existante
-- sert au jour où elle sera relancée).
-- =====================================================================

-- 0. Moyens de liaison Shopify : on nomme les nouveaux --------------------
-- « titre » (référence en tête du titre du produit), « creation » (article créé depuis ce
-- produit) et « sku_actif » (SKU partagé, seul produit actif) viennent s'ajouter à « sku »,
-- « barcode » et « moto_parc ». Additif : la contrainte s'élargit, rien n'est retiré.
alter table public.shopify_links drop constraint if exists shopify_links_match_via_check;
alter table public.shopify_links add constraint shopify_links_match_via_check
  check (match_via is null or match_via in ('sku', 'barcode', 'moto_parc', 'sku_actif', 'titre', 'creation'));

-- La lecture Shopify ne défait que les liaisons qu'elle sait refaire (SKU, code-barres) :
-- une liaison posée par le faisceau d'indices survit à la prochaine lecture du site.
create or replace function public._shopify_apply_auto_links(_company uuid, _links jsonb, _actor uuid, _run_started_at timestamptz, _stats jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n_removed int;
  n_new     int;
  n_dropped int;
begin
  -- Variantes absentes de la lecture complète : marquées retirées (jamais supprimées)
  update public.shopify_products set removed_at = now()
   where company_id = _company and removed_at is null and synced_at < _run_started_at;
  get diagnostics n_removed = row_count;

  drop table if exists pg_temp._want;
  create temp table _want on commit drop as
  select x.variant_id, x.article_id, x.via
    from jsonb_to_recordset(coalesce(_links, '[]'::jsonb)) as x(variant_id text, article_id uuid, via text)
    join public.shopify_products p on p.company_id = _company and p.shopify_variant_id = x.variant_id and p.removed_at is null
    join public.articles a on a.id = x.article_id and a.company_id = _company;

  -- Liaisons automatiques qui ne tiennent plus (SKU changé, variante retirée…)
  with d as (
    delete from public.shopify_links l
     where l.company_id = _company and l.status = 'auto_exact'
       -- (23/09) la lecture Shopify ne gouverne que ce qu'elle sait recalculer : SKU et code-barres.
       -- Les liaisons posées en base par le faisceau d'indices (titre, création, SKU partagé)
       -- ne sont pas effacées par une lecture qui ne les connaît pas.
       and coalesce(l.match_via, 'sku') in ('sku', 'barcode')
       and not exists (select 1 from _want w where w.variant_id = l.shopify_variant_id and w.article_id = l.article_id)
    returning l.shopify_variant_id, l.article_id, l.match_via
  ), ev as (
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    select _company, _actor, 'shopify_auto_unlink', 'shopify_links', d.shopify_variant_id, 'api',
           jsonb_build_object('status', 'auto_exact', 'article_id', d.article_id, 'via', d.match_via), null
      from d
    returning 1
  )
  select count(*) into n_dropped from ev;

  -- Nouvelles liaisons automatiques (jamais par-dessus une décision humaine)
  with i as (
    insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
    select _company, w.variant_id, w.article_id, 'auto_exact', w.via, null, now() from _want w
    on conflict (company_id, shopify_variant_id) do nothing
    returning shopify_variant_id, article_id, match_via
  ), ev as (
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    select _company, _actor, 'shopify_auto_link', 'shopify_links', i.shopify_variant_id, 'api', null,
           jsonb_build_object('status', 'auto_exact', 'article_id', i.article_id, 'via', i.match_via)
      from i
    returning 1
  )
  select count(*) into n_new from ev;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, _actor, 'shopify_sync', 'shopify_products', _company::text, 'api', null,
          coalesce(_stats, '{}'::jsonb) || jsonb_build_object('auto_linked_new', n_new, 'auto_unlinked', n_dropped, 'removed', n_removed));

  return jsonb_build_object('auto_linked_new', n_new, 'auto_unlinked', n_dropped, 'removed', n_removed);
end $$;
revoke all on function public._shopify_apply_auto_links(uuid, jsonb, uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public._shopify_apply_auto_links(uuid, jsonb, uuid, timestamptz, jsonb) to service_role;

-- 1. Outils de comparaison des désignations ----------------------------

-- Désignation « nue » : majuscules, sans accent, un seul espace entre les mots.
create or replace function public._al_norm_desig(_t text)
returns text language sql stable parallel safe set search_path = public, pg_temp as $$
  select btrim(regexp_replace(upper(public.unaccent(coalesce(_t, ''))), '[^A-Z0-9]+', ' ', 'g'));
$$;
comment on function public._al_norm_desig(text) is
  'Désignation normalisée pour comparaison : majuscules, sans accent, séparateurs réduits à un espace.';

-- Part des mots de _a (3 lettres et plus) que l'on retrouve dans _b. 1 = tout retrouvé.
create or replace function public._al_desig_ratio(_a text, _b text)
returns numeric language sql stable parallel safe set search_path = public, pg_temp as $$
  with x as (select array_agg(distinct w) as t
               from regexp_split_to_table(public._al_norm_desig(_a), ' ') w where length(w) > 2),
       y as (select array_agg(distinct w) as t
               from regexp_split_to_table(public._al_norm_desig(_b), ' ') w where length(w) > 2)
  select case when x.t is null or y.t is null then 0::numeric
              else round((select count(*) from unnest(x.t) e where e = any (y.t))::numeric
                         / array_length(x.t, 1), 3) end
    from x, y;
$$;
comment on function public._al_desig_ratio(text, text) is
  'Part des mots de la première désignation retrouvés dans la seconde (0 à 1). Sert au faisceau d''indices du rapprochement.';

-- Premier mot du titre d'un produit du site (les boutiques préfixent le titre par la référence).
create or replace function public._al_first_token(_t text)
returns text language sql stable parallel safe set search_path = public, pg_temp as $$
  select w from regexp_split_to_table(upper(coalesce(_t, '')), '[^A-Z0-9]+') w where w <> '' limit 1;
$$;

-- 2. Le miroir Shopify sait nommer la méthode selon le moyen de liaison -
create or replace function public._article_links_mirror_shopify()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := coalesce(new.company_id, old.company_id);
  v_variant text := coalesce(new.shopify_variant_id, old.shopify_variant_id);
  v_linked  boolean := tg_op <> 'DELETE' and new.status in ('auto_exact', 'valide') and new.article_id is not null;
  v_human   boolean := tg_op <> 'DELETE' and new.status in ('valide', 'ignore', 'a_valider');
  v_by      uuid := case when tg_op = 'DELETE' then null else new.decided_by end;
  v_method  text;
  v_reason  text;
begin
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
    -- Nom de la méthode selon le moyen de liaison (match_via) : le « comment » reste lisible à l'écran.
    v_method := case
      when new.status <> 'auto_exact'   then 'manuel'
      when new.match_via = 'barcode'    then 'code_barres'
      when new.match_via = 'titre'      then 'ref_dans_titre'
      when new.match_via = 'creation'   then 'creation'
      else 'sku_exact' end;
    v_reason := case
      when new.status <> 'auto_exact' then 'Relié par une personne'
      when new.match_via = 'titre'    then 'Référence de l''article en tête du titre du produit, désignation ou prix concordants'
      when new.match_via = 'creation' then 'Article créé depuis ce produit du site'
      when new.match_via = 'sku_actif' then 'SKU partagé : seul produit actif du site portant ce SKU (règle de Simon, 23/09)'
      else 'Correspondance exacte et unique (règle W-6)' end;

    update public.article_links l set status = 'a_valider', updated_at = now(),
           decision_note = 'Article relié à une autre variante Shopify'
     where l.company_id = v_company and l.article_id = new.article_id and l.target_kind = 'shopify_variant'
       and l.status = 'lie' and l.target_ref <> v_variant;
    insert into public.article_links as l (company_id, article_id, target_kind, target_ref, status, method, score,
                                           reason, details, is_auto, decided_by, decided_at)
    values (v_company, new.article_id, 'shopify_variant', v_variant, 'lie', v_method, 100, v_reason,
            jsonb_build_object('shopify_status', new.status)
              || case when new.status = 'auto_exact' and new.match_via in ('titre', 'creation', 'sku_actif')
                      then jsonb_build_object('auto_rule', new.match_via) else '{}'::jsonb end,
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

-- 3. Décision automatique relançable -----------------------------------
create or replace function public.article_links_autoresolve(_company uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t0 timestamptz := clock_timestamp();
  n_sku int := 0; n_sku_actif int := 0; n_faisceau int := 0; n_creation int := 0;
  n_rej_cat int := 0; n_rej_shop int := 0; n_doublon int := 0; n_reste int := 0;
  st jsonb;
begin
  if not public._article_links_can_write(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('article_links_autoresolve:' || _company::text));

  -- ---------------------------------------------------------------- R4a.
  -- Catalogue Ducati : une référence = un article (M-25). Tout candidat sur une référence déjà
  -- reliée à un AUTRE article est rejeté, avec la raison ; l'information de remplacement reste
  -- portée par le champ « remplacée par » de l'article.
  with r as (
    update public.article_links l
       set status = 'rejete', is_auto = true, updated_at = now(),
           details = l.details || jsonb_build_object('auto_rule', 'cible_deja_reliee'),
           decision_note = case l.method
             when 'remplacement_dms' then 'Référence Ducati déjà reliée à l''article de remplacement (chaîne « remplacée par » du DMS) : un second article sur la même référence casserait « une référence du catalogue = un article » (M-25).'
             when 'revision' then 'Indice de révision deviné : la référence Ducati est déjà portée par l''article de même référence (couleurs et versions marché avérées).'
             else 'Référence Ducati déjà reliée à un autre article du DMS.' end
     where l.company_id = _company and l.status = 'a_valider' and l.target_kind in ('ducati_part', 'ducati_product')
       and l.decided_by is null and l.is_auto
       and exists (select 1 from public.article_links x
                    where x.company_id = l.company_id and x.target_kind = l.target_kind
                      and x.target_ref = l.target_ref and x.status = 'lie' and x.article_id <> l.article_id)
    returning 1)
  select count(*) into n_rej_cat from r;

  -- ---------------------------------------------------------------- R4b.
  -- Shopify : la variante porte exactement la référence d'un article du DMS et est déjà reliée.
  -- La chaîne « remplacée par » ne change pas le produit vendu sur le site.
  with r as (
    update public.article_links l
       set status = 'rejete', is_auto = true, updated_at = now(),
           details = l.details || jsonb_build_object('auto_rule', 'variante_deja_reliee'),
           decision_note = 'Le produit du site porte exactement la référence d''un article du DMS, déjà relié par son SKU (W-6).'
     where l.company_id = _company and l.status = 'a_valider' and l.target_kind = 'shopify_variant'
       and l.decided_by is null and l.is_auto
       and exists (select 1 from public.shopify_links sl
                    where sl.company_id = l.company_id and sl.shopify_variant_id = l.target_ref
                      and sl.status in ('auto_exact', 'valide') and sl.article_id is not null
                      and sl.article_id <> l.article_id)
    returning 1)
  select count(*) into n_rej_shop from r;

  -- ---------------------------------------------------------------- R1.
  -- Rattrapage de la règle W-6 en base : SKU exact, un seul article actif, un seul produit du
  -- site (ou un seul produit ACTIF parmi ceux qui partagent le SKU — demande de Simon 23/09).
  drop table if exists pg_temp._ar_sku;
  create temp table _ar_sku on commit drop as
  with v as (
    select p.shopify_variant_id as variant, upper(btrim(p.sku)) as sku, p.status as shop_status
      from public.shopify_products p
     where p.company_id = _company and p.removed_at is null and coalesce(btrim(p.sku), '') <> ''
       and not public._shopify_is_moto(p.product_type, p.sku, p.price)
       and not exists (select 1 from public.shopify_links sl
                        where sl.company_id = _company and sl.shopify_variant_id = p.shopify_variant_id)
       and not exists (select 1 from public.article_links l
                        where l.company_id = _company and l.target_kind = 'shopify_variant'
                          and l.target_ref = p.shopify_variant_id and l.status = 'lie')
  ), a as (
    select upper(btrim(x.reference)) as ref, min(x.id::text)::uuid as article_id, count(*) as n_art
      from public.articles x where x.company_id = _company and x.is_active group by 1
  ), g as (
    select v.*, count(*) over (partition by v.sku) as n_var,
           count(*) filter (where v.shop_status = 'ACTIVE') over (partition by v.sku) as n_act
      from v
  )
  select g.variant, g.sku, g.shop_status, a.article_id, g.n_var, g.n_act,
         case when g.n_var = 1 then 'sku' else 'sku_actif' end as via
    from g join a on a.ref = g.sku and a.n_art = 1
   where g.n_var = 1 or (g.n_act = 1 and g.shop_status = 'ACTIVE');

  -- un article ne peut recevoir qu'une variante : on ne garde que les couples sans ambiguïté
  delete from _ar_sku s using _ar_sku t
   where s.article_id = t.article_id and s.variant <> t.variant;
  delete from _ar_sku s
   where exists (select 1 from public.shopify_links sl
                  where sl.company_id = _company and sl.article_id = s.article_id
                    and sl.status in ('auto_exact', 'valide') and sl.shopify_variant_id <> s.variant);

  insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
  select _company, s.variant, s.article_id, 'auto_exact', s.via, null, now() from _ar_sku s
  on conflict (company_id, shopify_variant_id) do nothing;
  get diagnostics n_sku = row_count;
  select count(*) filter (where via = 'sku_actif') into n_sku_actif from _ar_sku;

  -- ---------------------------------------------------------------- R3a.
  -- Produit du site sans SKU qui a AUSSI un candidat sur un vrai article (référence en tête du
  -- titre) : le vrai article gagne, l'article « SHOP-… » créé en double est désactivé et son
  -- stock de départ est transféré par un mouvement (seul moyen autorisé de corriger un stock).
  drop table if exists pg_temp._ar_dup;
  create temp table _ar_dup on commit drop as
  select c.target_ref as variant, c.article_id as shop_article, min(r.article_id::text)::uuid as vrai_article
    from public.article_links c
    join public.shopify_products p
      on p.company_id = c.company_id and p.shopify_variant_id = c.target_ref and p.removed_at is null
    join public.article_links r
      on r.company_id = c.company_id and r.target_kind = 'shopify_variant' and r.target_ref = c.target_ref
     and r.status = 'a_valider' and r.method <> 'creation_sans_sku' and r.decided_by is null
    join public.articles ra on ra.id = r.article_id
   where c.company_id = _company and c.status = 'a_valider' and c.target_kind = 'shopify_variant'
     and c.method = 'creation_sans_sku' and c.decided_by is null
     -- le vrai article n'est retenu que si sa référence est le premier mot du titre du produit
     and public._al_first_token(p.product_title) = regexp_replace(upper(ra.reference), '[^A-Z0-9]', '', 'g')
   group by c.target_ref, c.article_id
  having count(distinct r.article_id) = 1;

  -- Le stock à transférer est calculé AVANT le premier mouvement : sinon la sortie que l'on vient
  -- d'écrire ramène la somme à zéro et l'entrée sur le vrai article n'est jamais faite.
  drop table if exists pg_temp._ar_dup_stock;
  create temp table _ar_dup_stock on commit drop as
  select d.shop_article, d.vrai_article, sum(m.qty_delta) as qte
    from _ar_dup d join public.stock_moves m on m.article_id = d.shop_article and m.company_id = _company
   group by d.shop_article, d.vrai_article having sum(m.qty_delta) <> 0;

  insert into public.stock_moves (company_id, article_id, move_type, qty_delta, unit_cost, origin, ref, note, operator_id, occurred_at)
  select _company, x.shop_article, 'inventaire'::public.stock_move_type, -x.qte, null, 'import:shopify', 'autoresolve',
         'Doublon de produit du site sans SKU : stock transféré vers l''article de la référence', null, now()
    from _ar_dup_stock x;
  insert into public.stock_moves (company_id, article_id, move_type, qty_delta, unit_cost, origin, ref, note, operator_id, occurred_at)
  select _company, x.vrai_article, 'inventaire'::public.stock_move_type, sum(x.qte), null, 'import:shopify', 'autoresolve',
         'Stock repris du doublon sans SKU créé depuis le même produit du site', null, now()
    from _ar_dup_stock x group by x.vrai_article;

  update public.article_links l
     set status = 'rejete', is_auto = true, updated_at = now(),
         details = l.details || jsonb_build_object('auto_rule', 'doublon_sans_sku'),
         decision_note = 'Le produit du site cite une référence du DMS dans son titre : c''est cet article qui est relié, pas l''article « SHOP-… » créé faute de SKU.'
    from _ar_dup d
   where l.company_id = _company and l.target_kind = 'shopify_variant' and l.target_ref = d.variant
     and l.article_id = d.shop_article and l.status = 'a_valider';
  update public.articles a
     set is_active = false, note = concat_ws(E'\n', nullif(a.note, ''), 'Doublon du produit du site : article remplacé par la référence citée dans le titre (rapprochement automatique du 23/09).'),
         updated_at = now()
    from _ar_dup d where a.id = d.shop_article and a.company_id = _company and a.is_active;
  get diagnostics n_doublon = row_count;

  -- ---------------------------------------------------------------- R2.
  -- Faisceau d'indices sur les candidats Shopify restants.
  drop table if exists pg_temp._ar_fais;
  create temp table _ar_fais on commit drop as
  select l.id, l.article_id, l.target_ref as variant, l.method,
         (public.ducati_catalog_norm_ref(p.sku) is not null
          and public.ducati_catalog_norm_ref(p.sku) = regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g')) as i_sku,
         (public._al_first_token(p.product_title) = regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g')) as i_titre,
         public._al_desig_ratio(a.designation, coalesce(p.product_title, '') || ' ' || coalesce(p.variant_title, '')) as ratio,
         case when coalesce(p.price, 0) = 0 or coalesce(a.sale_price_ttc, 0) = 0 then null
              else abs(a.sale_price_ttc - p.price) / p.price end as ecart,
         -- un SKU qui est la référence exacte d'un AUTRE article : le SKU l'emporte, on ne devine pas
         exists (select 1 from public.articles o where o.company_id = _company and o.is_active
                   and o.id <> l.article_id and upper(btrim(o.reference)) = upper(btrim(p.sku))) as sku_concurrent
    from public.article_links l
    join public.articles a on a.id = l.article_id
    join public.shopify_products p on p.company_id = l.company_id and p.shopify_variant_id = l.target_ref
   where l.company_id = _company and l.status = 'a_valider' and l.target_kind = 'shopify_variant'
     and l.decided_by is null and l.method <> 'creation_sans_sku'
     and p.removed_at is null;

  -- Le faisceau : la référence de l'article est le premier mot du titre (ou le SKU exact),
  -- ET la désignation se retrouve dans le titre (70 % des mots) OU le prix colle à 5 % près,
  -- ET aucun SKU ne désigne un autre article. Un candidat n'est retenu que s'il est le SEUL
  -- de sa variante et le seul de son article à satisfaire le faisceau : sinon, à une personne.
  alter table _ar_fais add column qualifie boolean;
  update _ar_fais f set qualifie =
    (not f.sku_concurrent and (f.i_sku or f.i_titre) and (f.ratio >= 0.7 or f.ecart <= 0.05));

  insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
  select _company, f.variant, f.article_id, 'auto_exact', 'titre', null, now()
    from _ar_fais f
   where f.qualifie
     and not exists (select 1 from _ar_fais o where o.qualifie and o.variant = f.variant and o.id <> f.id)
     and not exists (select 1 from _ar_fais o where o.qualifie and o.article_id = f.article_id and o.id <> f.id)
     and not exists (select 1 from public.shopify_links sl where sl.company_id = _company and sl.article_id = f.article_id
                       and sl.status in ('auto_exact', 'valide') and sl.shopify_variant_id <> f.variant)
  on conflict (company_id, shopify_variant_id) do nothing;
  get diagnostics n_faisceau = row_count;

  -- ---------------------------------------------------------------- R3b.
  -- Produit du site sans SKU : l'article « SHOP-… » a été créé depuis ce produit même.
  -- Le lien est vrai par construction (un article, un produit) : relié d'office.
  insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
  select _company, l.target_ref, l.article_id, 'auto_exact', 'creation', null, now()
    from public.article_links l
   where l.company_id = _company and l.status = 'a_valider' and l.target_kind = 'shopify_variant'
     and l.method = 'creation_sans_sku' and l.decided_by is null
     and not exists (select 1 from public.article_links x
                      where x.company_id = _company and x.target_kind = 'shopify_variant'
                        and x.target_ref = l.target_ref and x.status = 'a_valider' and x.id <> l.id)
     and not exists (select 1 from public.shopify_links sl where sl.company_id = _company
                       and sl.article_id = l.article_id and sl.status in ('auto_exact', 'valide'))
  on conflict (company_id, shopify_variant_id) do nothing;
  get diagnostics n_creation = row_count;

  -- les candidats devenus « reliés » par shopify_links sont montés par le déclencheur miroir ;
  -- il reste à fermer les candidats concurrents de ces variantes.
  update public.article_links l
     set status = 'rejete', is_auto = true, updated_at = now(),
         details = l.details || jsonb_build_object('auto_rule', 'variante_reliee_autrement'),
         decision_note = 'La variante du site a été reliée d''office à un autre article (faisceau d''indices).'
   where l.company_id = _company and l.status = 'a_valider' and l.target_kind = 'shopify_variant'
     and l.decided_by is null and l.is_auto
     and exists (select 1 from public.shopify_links sl
                  where sl.company_id = _company and sl.shopify_variant_id = l.target_ref
                    and sl.status in ('auto_exact', 'valide') and sl.article_id is not null
                    and sl.article_id <> l.article_id);

  select count(*) into n_reste from public.article_links
   where company_id = _company and status = 'a_valider';

  st := jsonb_build_object(
    'relie_sku_exact', n_sku, 'dont_sku_partage_actif', n_sku_actif,
    'relie_faisceau', n_faisceau, 'relie_creation_sans_sku', n_creation,
    'doublons_sans_sku_resolus', n_doublon,
    'rejete_catalogue', n_rej_cat, 'rejete_shopify', n_rej_shop,
    'reste_a_valider', n_reste,
    'duration_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'article_links_autoresolve', 'article_links', _company::text,
          case when auth.uid() is null then 'system' else 'screen' end, null, st);
  return st;
end $$;
comment on function public.article_links_autoresolve(uuid) is
  'Décide automatiquement les candidats du rapprochement (faisceau d''indices : SKU exact W-6, référence en tête du titre, désignation, écart de prix ≤ 5 %). Relançable ; ne touche jamais une décision humaine ni un lien rejeté. Appelée à la fin de article_links_refresh.';
revoke all on function public.article_links_autoresolve(uuid) from public, anon;
grant execute on function public.article_links_autoresolve(uuid) to authenticated, service_role;
