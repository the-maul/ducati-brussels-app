-- =====================================================================
-- MISSION 01 — LOT 4 : écran d'accueil de la borne (retour client du 21/09).
-- Migration STRICTEMENT ADDITIVE. NON APPLIQUÉE par l'agent : à appliquer
-- par l'agence après validation.
--
-- Deux adresses réglables dans Paramètres → Borne d'inscription :
--   - kiosk_configurator_url : tuile « Configurer ma Ducati » ;
--   - kiosk_used_url         : tuile « Nos occasions ».
-- null = adresse par défaut du code (src/modules/signup/kiosk-links.ts) ;
-- ''   = tuile masquée. Tant que la migration n'est pas appliquée, la borne
-- affiche les adresses par défaut ; seul l'enregistrement du réglage échoue
-- (message clair à l'écran).
-- Écriture : politique existante signup_settings_admin_write (administrateurs) ;
-- trace : trigger existant trg_signup_settings_audit (events).
-- =====================================================================

alter table public.signup_settings
  add column if not exists kiosk_configurator_url text,
  add column if not exists kiosk_used_url text;

alter table public.signup_settings
  drop constraint if exists signup_settings_kiosk_urls_https;
alter table public.signup_settings
  add constraint signup_settings_kiosk_urls_https check (
    (kiosk_configurator_url is null or kiosk_configurator_url = ''
      or (kiosk_configurator_url like 'https://%' and length(kiosk_configurator_url) <= 500))
    and
    (kiosk_used_url is null or kiosk_used_url = ''
      or (kiosk_used_url like 'https://%' and length(kiosk_used_url) <= 500))
  );

comment on column public.signup_settings.kiosk_configurator_url is
  'Borne /borne, tuile « Configurer ma Ducati ». null = configurateur Ducati Belgique (défaut du code), '''' = tuile masquée.';
comment on column public.signup_settings.kiosk_used_url is
  'Borne /borne, tuile « Nos occasions ». null = page occasions de ducatibruxelles.be (défaut du code), '''' = tuile masquée.';
