-- M2 — Rapprochement : lui donner son propre delai, au lieu des 8 s de l'API.
--
-- Constate le 15/10/2026. Apres l'import du catalogue Ducati, 3 306 liens
-- attendaient d'etre crees. Le bouton « Relancer le rapprochement » partait,
-- se faisait couper par le statement_timeout de 8 s accorde au role de l'API,
-- et comme tout se fait dans une seule transaction, RIEN n'etait ecrit : la
-- page revenait a l'identique. Il a fallu lancer la fonction cote serveur pour
-- rattacher les 2 164 references concernees.
--
-- Une fois le retard rattrape, le meme rapprochement prend 5,7 s — soit 70 %
-- du budget. Le prochain gros import le recouperait. On donne donc a ces trois
-- fonctions leur propre delai. Elles gardent leur verrou par societe
-- (pg_advisory_xact_lock) et restent idempotentes : relancer ne duplique rien.
--
-- 120 s est un plafond de securite, pas une cible : un rapprochement normal
-- reste a quelques secondes. Si un jour un retard depasse la patience du
-- navigateur, la fonction s'execute aussi depuis le serveur.
alter function public.article_links_refresh(uuid)
  set statement_timeout = '120s';

alter function public.article_links_autoresolve(uuid)
  set statement_timeout = '120s';

alter function public.article_links_create_missing(uuid, text, integer, text)
  set statement_timeout = '120s';
