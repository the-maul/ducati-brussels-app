-- =====================================================================
-- M1 — Statut client à 4 valeurs (parité G8 : capture liste clients)
-- Ajoute 'client_piece' et 'client_atelier' à l'enum contact_status.
-- Isolé (ALTER TYPE ... ADD VALUE).
-- =====================================================================
alter type public.contact_status add value if not exists 'client_piece';
alter type public.contact_status add value if not exists 'client_atelier';
