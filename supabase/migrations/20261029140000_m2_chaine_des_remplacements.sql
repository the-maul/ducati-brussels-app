-- M2 — La chaîne des remplacements, d'un bout à l'autre.
--
-- Règle décidée par le client le 19/10/2026 : « une nouvelle référence, c'est le
-- même produit ». Taper l'ancienne doit mener à la nouvelle, et la fiche doit
-- montrer tout l'historique des références, comme le catalogue Ducati le fait :
--
--   59210212F — JAUGE NIVEAU ESSENCE (RÉFÉRENCE ÉPUISÉE AVEC SUBSTITUTIF)
--     59210212G   JAUGE NIVEAU ESSENCE   143,17 €   (rouge : plus disponible)
--       59210213G JAUGE NIVEAU ESSENCE   143,17 €   (vert : à commander)
--
-- Le DMS ne savait faire qu'un saut : articles.superseded_by_id donne le
-- remplaçant immédiat. Une chaîne à trois maillons laissait le vendeur sur le
-- maillon du milieu, qui n'est pas commandable non plus.

-- 1. La référence finalement commandable, au bout de la chaîne.
--    Garde-fou : 20 sauts au maximum, et on s'arrête si on repasse par un article
--    déjà vu (une boucle de données ne doit pas faire tourner le serveur).
create or replace function public.article_final_replacement(_article uuid)
returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  courant uuid := _article;
  suivant uuid;
  vus uuid[] := array[_article];
  i int := 0;
begin
  if _article is null then return null; end if;
  loop
    select superseded_by_id into suivant from public.articles where id = courant;
    exit when suivant is null;
    exit when suivant = any (vus);          -- boucle : on garde le dernier sain
    i := i + 1;
    exit when i > 20;                       -- chaîne anormalement longue
    courant := suivant;
    vus := vus || suivant;
  end loop;
  return courant;
end $$;

comment on function public.article_final_replacement(uuid) is
  'Suit les remplacements successifs et renvoie la reference finalement commandable. Rend l''article lui-meme s''il n''est pas remplace.';

-- 2. La chaîne complète, pour l'affichage façon catalogue Ducati.
--    rang 0 = l'article demandé, puis 1, 2, 3… jusqu'au dernier.
--    « disponible » = c'est le dernier de la chaîne, donc celui à commander.
create or replace function public.article_replacement_chain(_company uuid, _article uuid)
returns table (
  rang int, article_id uuid, reference text, designation text,
  sale_price_ttc numeric, purchase_price numeric, is_final boolean
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  courant uuid := _article;
  suivant uuid;
  vus uuid[] := array[_article];
  i int := 0;
begin
  if _article is null or not public.is_member(_company) then return; end if;
  loop
    return query
      select i, a.id, a.reference, a.designation, a.sale_price_ttc, a.purchase_price,
             a.superseded_by_id is null
        from public.articles a
       where a.id = courant and a.company_id = _company;
    select superseded_by_id into suivant from public.articles where id = courant;
    exit when suivant is null;
    exit when suivant = any (vus);
    i := i + 1;
    exit when i > 20;
    courant := suivant;
    vus := vus || suivant;
  end loop;
end $$;

revoke all on function public.article_replacement_chain(uuid, uuid) from public, anon;
grant execute on function public.article_replacement_chain(uuid, uuid) to authenticated;
grant execute on function public.article_final_replacement(uuid) to authenticated;

comment on function public.article_replacement_chain(uuid, uuid) is
  'Chaine des remplacements depuis un article : rang, reference, libelle, prix, et is_final pour la reference a commander.';
