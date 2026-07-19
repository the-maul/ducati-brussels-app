-- M7/M10 — Workflow de statut de reprise (Collecté → Envoyé → Accepté → Repris)
-- + offre acceptée (montant client, miroir meilleure offre marchand, marchand
-- à facturer) + synchronisation du TAG de statut vers la fiche CRM (lead).

-- 1. Métadonnées d'offre acceptée + horodatage d'envoi sur le dossier de reprise
alter table public.oro
  add column if not exists dispatched_at timestamptz,
  add column if not exists accepted_amount numeric(14,2),
  add column if not exists best_offer_amount numeric(14,2),
  add column if not exists invoice_partner_name text,
  add column if not exists accepted_at timestamptz;

-- 2. Lien lead ↔ reprise + tag de statut (synchro inter-départements)
alter table public.leads
  add column if not exists oro_id uuid,
  add column if not exists reprise_status text;

notify pgrst, 'reload schema';
