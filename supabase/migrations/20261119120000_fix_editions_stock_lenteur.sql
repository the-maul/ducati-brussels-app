-- Correctif 19/11/2026 : editions du stock et etiquetage trop lents (M5, 20261118211000 / 212000).
-- Sur la base reelle (~94 000 articles), stock_edition (onglets Invendus, Rupture, Depreciation,
-- Stock reel sans recherche) et label_candidates (sans recherche) depassaient le delai de 2 min :
-- les filtres optionnels lus dans le CTE « p » font estimer 1 seul article au planificateur, qui
-- choisit alors des boucles imbriquees (articles x mouvements de stock agreges). Mesure en
-- production : > 120 s -> 3,3 s pour 5 editions completes, label_candidates > 60 s -> < 1 s.
-- Correction : ces deux fonctions s'executent sans boucles imbriquees (jointures par hachage).
-- Meme resultat, aucune donnee touchee. Idempotent.
do $$
begin
  if to_regprocedure('public.stock_edition(uuid, text, jsonb, integer, integer)') is not null then
    execute 'alter function public.stock_edition(uuid, text, jsonb, integer, integer) set enable_nestloop = off';
  end if;
  if to_regprocedure('public.label_candidates(uuid, text, jsonb, integer, integer)') is not null then
    execute 'alter function public.label_candidates(uuid, text, jsonb, integer, integer) set enable_nestloop = off';
  end if;
end $$;
