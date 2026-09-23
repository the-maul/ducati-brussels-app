-- =====================================================================
-- Missions 03 + 06 — Correction : le stock du doublon « SHOP-… » n'était pas repris
--
-- Dans la première version d'article_links_autoresolve (20260923140000), le transfert de stock
-- du doublon « SHOP-… » vers l'article de la référence faisait deux mouvements à la suite : la
-- sortie du doublon, puis l'entrée sur le vrai article calculée en relisant les mouvements du
-- doublon. La sortie venant d'être écrite, la somme retombait à zéro et l'entrée n'était jamais
-- faite : une unité a été perdue en production le 23/09 (article 24713071AY, produit du site
-- « 24713071AY- COUVERCLE SELLE PASSAGER »).
--
-- La fonction est corrigée (somme calculée avant le premier mouvement) ; cette migration répare
-- les cas déjà passés. Correction par MOUVEMENT DE STOCK uniquement (règle 3, B7), idempotente.
-- =====================================================================

insert into public.stock_moves (company_id, article_id, move_type, qty_delta, unit_cost, origin, ref, note, operator_id, occurred_at)
select d.company_id, d.vrai_article, 'inventaire'::public.stock_move_type, d.qte, null,
       'import:shopify', 'autoresolve-rattrapage',
       'Stock repris du doublon sans SKU créé depuis le même produit du site (l''entrée manquait)',
       null, now()
  from (
    select distinct m.company_id, l.article_id as vrai_article, -m.qty_delta as qte
      from public.stock_moves m
      join public.article_links c
        on c.article_id = m.article_id and c.company_id = m.company_id
       and c.target_kind = 'shopify_variant' and c.status = 'rejete'
       and c.details->>'auto_rule' = 'doublon_sans_sku'
      join public.article_links l
        on l.company_id = c.company_id and l.target_kind = 'shopify_variant'
       and l.target_ref = c.target_ref and l.status = 'lie'
     where m.origin = 'import:shopify' and m.ref = 'autoresolve' and m.qty_delta < 0
  ) d
 where not exists (
   select 1 from public.stock_moves x
    where x.company_id = d.company_id and x.article_id = d.vrai_article
      and x.origin = 'import:shopify' and x.ref in ('autoresolve', 'autoresolve-rattrapage')
      and x.qty_delta > 0);
