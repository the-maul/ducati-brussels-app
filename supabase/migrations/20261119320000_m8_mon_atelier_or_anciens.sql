-- =====================================================================
-- M8 — « Mon atelier » : cartes lisibles (bug client du 19/11/2026, ATE010, B8, B11).
--
-- Reglage atelier du seuil des « OR anciens a verifier » : un OR ouvert depuis plus de
-- `stale_or_days` jours, sans pointage depuis autant de jours, quitte « Mes motos du jour » pour
-- une section repliee. 14 jours par defaut, de 1 a 365. Une colonne sur la ligne de reglages
-- existante (Atelier → Planning → Reglages) : memes droits, memes politiques, rien de nouveau.
-- Sans cette migration, l'ecran garde 14 jours et le reglage ne s'affiche pas.
--
-- Additive, rejouable (add column if not exists, contrainte posee une seule fois).
-- =====================================================================

alter table public.workshop_planning_settings
  add column if not exists stale_or_days smallint not null default 14;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'workshop_planning_settings_stale_or_days_chk'
       and conrelid = 'public.workshop_planning_settings'::regclass
  ) then
    alter table public.workshop_planning_settings add constraint workshop_planning_settings_stale_or_days_chk
      check (stale_or_days between 1 and 365);
  end if;
end $$;

comment on column public.workshop_planning_settings.stale_or_days is
  '« Mon atelier » : un OR ouvert depuis plus de ce nombre de jours, sans pointage depuis autant de jours, passe dans « OR anciens a verifier » (14 par defaut, 1 a 365).';
