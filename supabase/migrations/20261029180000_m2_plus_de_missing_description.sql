-- M2 — On n'affiche plus « [Missing Description] » comme si c'était un libellé.
--
-- Ducati laisse ce texte dans ses propres données quand il n'a pas de description :
-- 130 pièces du catalogue, 186 lignes de planches, et 118 articles du DMS créés
-- depuis ces pièces. La liste des articles l'affichait tel quel, ce qui donnait des
-- lignes « [Missing Description] — À COMPLÉTER » incompréhensibles pour un vendeur.
--
-- 1. Le tarif Ducati, lui, connaît le libellé de 7 d'entre elles : on les récupère.
update public.articles a
   set designation = v.libelle, to_complete = false
  from (values
    ('17610540B', 'BALANCER DRIVEN GEAR Z32'),
    ('69812581AA', 'TOP CASE COVER - RED'),
    ('69812581AH', 'COVER TOP CASE - DARK STEALTH'),
    ('69812581AI', 'COVER TOP CASE - THRILLING BLACK'),
    ('69812581AK', 'COVER TOP CASE - FOREST GREEN'),
    ('69812581AN', 'COVER TOP CASE - GIALLO DUCATI'),
    ('69812581AW', 'COVER TOP CASE –  ARANCIO XANTO GLOSS')
  ) as v(reference, libelle)
 where a.reference = v.reference and a.designation ilike '%missing%';

-- 2. Pour les autres, un texte francais explicite remplace le placeholder anglais.
--    La colonne designation ne peut pas etre vide en base, et « Libelle a completer »
--    dit au vendeur ce qu'il doit faire, ce que « [Missing Description] » ne disait pas.
update public.articles set designation = 'Libelle a completer', to_complete = true
 where designation ilike '%missing%';

update public.ducati_catalog_parts set description = null
 where description ilike '%missing%';

update public.ducati_catalog_drawing_lines set description = null
 where description ilike '%missing%';

select (select count(*) from public.articles where designation ilike '%missing%') as articles_restants,
       (select count(*) from public.ducati_catalog_parts where description ilike '%missing%') as catalogue_restant,
       (select count(*) from public.articles where to_complete) as a_completer;
