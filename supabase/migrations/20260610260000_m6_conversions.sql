-- =====================================================================
-- M6 (POS) — Conversions de documents : Devis→Facture/BL/Réservation,
-- Réservation→Facture/BL, BL→Facture (G8 Facturation p.96, p.101-109).
-- Le document cible porte source_document_id (filiation) ; le document source passe
-- au statut 'converti'. L'acompte d'une réservation est reporté sur la facture.
-- =====================================================================

alter table public.documents
  add column if not exists source_document_id uuid references public.documents(id) on delete set null;

create index if not exists idx_documents_source on public.documents(source_document_id);
