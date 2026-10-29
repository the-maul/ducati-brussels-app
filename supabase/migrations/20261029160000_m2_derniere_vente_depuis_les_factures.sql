-- M2 — La date de dernière vente, reconstituée depuis les factures.
--
-- last_sold_at était vide sur les 93 755 articles : la reprise G8 de juin 2026
-- n'avait jamais transmis le détail des factures (les exports Excel de G8 ne
-- contenaient que des en-têtes). Le détail a été extrait des 12 703 PDF livrés
-- avec la reprise : 89 853 lignes, dont 34 578 rattachées à un article.
--
-- Sans cette date : pas de rotation, pas de réassort fondé sur l'historique, pas
-- de détection des articles dormants.
--
-- On ne descend jamais une date déjà connue : l'export G8 du stock du 28/10/2026
-- en avait posé 1 613, on garde la plus récente des deux.
set statement_timeout = '900s';

with v as (
  select dl.article_id, max(d.issue_date) as derniere
    from public.document_lines dl
    join public.documents d on d.id = dl.document_id
   where dl.article_id is not null
     and d.doc_type in ('FAC', 'TIK', 'AVO')
     and d.issue_date is not null
   group by dl.article_id
)
update public.articles a
   set last_sold_at = v.derniere::timestamptz
  from v
 where a.id = v.article_id
   and (a.last_sold_at is null or a.last_sold_at < v.derniere::timestamptz);

select count(*) filter (where last_sold_at is not null) as avec_derniere_vente,
       count(*) filter (where last_sold_at >= now() - interval '2 years') as vendus_depuis_2_ans,
       count(*) filter (where last_sold_at < now() - interval '5 years') as dormants_5_ans
  from public.articles;
