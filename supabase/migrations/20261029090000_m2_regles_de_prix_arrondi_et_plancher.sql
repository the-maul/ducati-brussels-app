-- M2 — Les règles de prix savent arrondir, et les petits prix ont leur traitement.
--
-- Règles décidées avec le client les 19 et 28/10/2026 :
--   · pièces détachées : prix public conseillé + 6 %, PUIS arrondi ;
--   · accessoires et vêtements : arrondi vers le haut, sans pourcentage ;
--   · toute pièce sous 2 € : on AJOUTE 2 € au lieu de la remonter à 2 €
--     (0,25 € → 2,25 € et 1,74 € → 2,74 €), pour garder l'écart entre deux
--     petites pièces au lieu de les aplatir au même prix.
--
-- Jusqu'ici une règle ne savait faire qu'un pourcentage, et le plancher de prix
-- ne savait que remonter au minimum.

-- 1. L'arrondi de la règle, applique APRES le pourcentage.
alter table public.ppc_price_rules
  add column if not exists round_mode text not null default 'none';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ppc_price_rules_round_mode_ck') then
    alter table public.ppc_price_rules
      add constraint ppc_price_rules_round_mode_ck
      check (round_mode in ('none', 'ceil_0_1', 'ceil_0_5', 'ceil_1', 'ceil_5', 'ceil_10', 'end_99'));
  end if;
end $$;

comment on column public.ppc_price_rules.round_mode is
  'Arrondi applique apres le pourcentage, toujours vers le haut : none, ceil_0_1 (10 centimes), ceil_0_5, ceil_1 (euro), ceil_5, ceil_10, end_99 (prix en x,99).';

-- 2. Le mode du plancher des petits prix, par societe.
alter table public.companies
  add column if not exists price_floor_mode text not null default 'min';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_price_floor_mode_ck') then
    alter table public.companies
      add constraint companies_price_floor_mode_ck
      check (price_floor_mode in ('min', 'add'));
  end if;
end $$;

comment on column public.companies.price_floor_mode is
  'Traitement des prix de vente sous le seuil : min = remonte au minimum (0,25 -> 2,00), add = le minimum s''ajoute au prix (0,25 -> 2,25). Choix du client : add.';
