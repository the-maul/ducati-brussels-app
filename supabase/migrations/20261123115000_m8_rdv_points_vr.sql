-- =====================================================================
-- M8 — Retour de Domenico (23/11/2026) : au rendez-vous, on coche les demandes V / R comme dans G8.
-- ATE001 B8. Les marques sont gardees sur le RDV puis recopiees sur l'OR a l'entree de la moto
-- (createOrFromPlanningAppointment). Aucune ligne, aucun prix, aucun stock ne bouge.
-- Additive, rejouable. Essai a blanc : supabase/tests/m8_rdv_points_vr.sql.
-- =====================================================================
alter table public.workshop_appointments
  add column if not exists check_points jsonb not null default '{}'::jsonb;
