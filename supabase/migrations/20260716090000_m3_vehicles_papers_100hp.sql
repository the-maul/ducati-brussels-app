-- M3 — Fiche véhicule : indicateur « Papiers 100 CH ».
-- Moto immatriculée avec une puissance limitée à 100 CH sur les documents
-- (bridage réglementaire historique BE/FR). Coché/décoché dans la section
-- « Identification » de la fiche véhicule.
alter table public.vehicles add column if not exists papers_100hp boolean not null default false;
