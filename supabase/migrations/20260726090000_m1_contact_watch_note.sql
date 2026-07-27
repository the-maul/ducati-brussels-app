-- M1 — Motif de surveillance (2026-07-26)
-- Note libre expliquant pourquoi un contact est marqué "à surveiller"

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS watch_note text;
