-- M14 — Traçabilité d'import (B7) : marquer l'origine des enregistrements migrés.
alter table public.contacts add column if not exists imported_from text;
alter table public.vehicles add column if not exists imported_from text;
