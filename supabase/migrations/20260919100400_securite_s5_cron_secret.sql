-- LOT SÉCURITÉ S5 — Tâches planifiées outlook-poll et dispatch-notifications : appel avec
-- un secret partagé au lieu de la clé publique.
-- Réf. docs/bible/securite-lot-S.md §S5 (ordre : secret AVANT cette migration et AVANT le
-- déploiement des deux Edge Functions).
--
-- Avant : pg_cron appelait les deux fonctions avec la clé anon (publique) ; les fonctions ne
-- contrôlaient rien, donc n'importe qui pouvait déclencher une relève Outlook ou vider la file
-- de notifications.
--
-- Après : l'appel porte l'en-tête x-cron-secret, lu à chaque exécution dans le coffre
-- Supabase (Vault, secret « cron_secret »). Les fonctions comparent cet en-tête au secret
-- d'Edge Function CRON_SECRET (même valeur). La valeur n'apparaît ni dans ce fichier, ni
-- dans cron.job.command.
--
-- PRÉREQUIS (à faire par l'intégrateur, hors dépôt, avec une valeur aléatoire ≥ 32 caractères) :
--   select vault.create_secret('<valeur>', 'cron_secret', 'En-tête x-cron-secret des tâches pg_cron');
--   npx supabase@2.117.0 secrets set CRON_SECRET=<même valeur> --project-ref ujmrosbgkvgvwfnuryna
-- Sans le secret dans Vault, cette migration échoue volontairement (rien n'est modifié).
--
-- La clé anon n'est plus envoyée : inutile pour une fonction déployée avec verify_jwt = false.
-- cron.schedule avec un nom existant REMPLACE la tâche (même nom, même planification).
--
-- NON APPLIQUÉE.

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and length(decrypted_secret) >= 32) then
    raise exception 'S5 : secret Vault « cron_secret » absent ou trop court (32 caractères minimum). Le créer avant cette migration.';
  end if;
end $$;

select cron.schedule('outlook-poll', '*/5 * * * *', $cron$
  select net.http_post(
    'https://ujmrosbgkvgvwfnuryna.supabase.co/functions/v1/outlook-poll',
    '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ));
$cron$);

select cron.schedule('dispatch-notifications', '*/10 * * * *', $cron$
  select net.http_post(
    'https://ujmrosbgkvgvwfnuryna.supabase.co/functions/v1/dispatch-notifications',
    '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ));
$cron$);
