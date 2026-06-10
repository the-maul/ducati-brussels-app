-- =====================================================================
-- M2 — Ajout du type de gestion 'T' (Main d'œuvre) — ADR-002
-- Isolé dans sa propre migration (ALTER TYPE ... ADD VALUE).
-- =====================================================================
alter type public.article_mgmt_type add value if not exists 'T';
