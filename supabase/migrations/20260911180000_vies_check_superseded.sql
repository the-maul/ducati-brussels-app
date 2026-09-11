-- Retrait de la fonction SQL `vies_check`, remplacée par l'Edge Function `vies-check`.
--
-- 20260719090000_m1_vies_check.sql interrogeait VIES depuis Postgres via l'extension
-- `http`. Cette migration n'avait jamais été appliquée ; en la passant le 11/09/2026 on
-- a découvert que le chemin ne fonctionne pas : `ec.europa.eu` coupe la connexion
-- (`OpenSSL SSL_read: SSL_ERROR_SYSCALL, errno 0`) alors que les autres domaines
-- répondent en 200 depuis le même serveur. Ni un User-Agent explicite ni un repli en
-- HTTP/1.1 n'y changent rien — `CURLOPT_HTTP_VERSION` n'est pas configurable à
-- l'exécution par l'extension.
--
-- L'Edge Function `vies-check` (Deno, `fetch`) répond correctement, avec un délai borné
-- à 10 s. `checkVat` (src/modules/contacts/vies-api.ts) l'appelle désormais.
--
-- On supprime la fonction SQL plutôt que de la laisser : elle renverrait
-- silencieusement `vies_unreachable` à quiconque l'appellerait encore.
-- L'extension `http` est conservée : elle n'est pas en cause et peut resservir.

drop function if exists public.vies_check(text, text);

notify pgrst, 'reload schema';
