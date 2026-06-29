-- M1/M14 — Reprise du « code client » G8 dans le champ visible `code`.
-- À l'import, le code G8 a été stocké dans `legacy_code` (résolution des FK factures).
-- On le recopie dans `code` (le champ « Code client » affiché) là où il est vide —
-- important pour la comptabilité (rapprochement avec l'historique G8). Idempotent.
update public.contacts
   set code = legacy_code
 where (code is null or code = '')
   and legacy_code is not null and legacy_code <> '';
