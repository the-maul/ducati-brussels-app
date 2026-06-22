-- =====================================================================
-- M9 — GED : dossiers (classer les pièces) + empreinte de contenu (déduplication,
-- pour ne pas recharger 4× la même image au fil d'une discussion e-mail).
-- =====================================================================
alter table public.attachments
  add column if not exists folder       text,   -- nom de dossier (null = racine)
  add column if not exists content_hash text;   -- SHA-256 du contenu (anti-doublon)

create index if not exists idx_attach_hash on public.attachments(entity_type, entity_id, content_hash);
create index if not exists idx_attach_folder on public.attachments(entity_type, entity_id, folder);
