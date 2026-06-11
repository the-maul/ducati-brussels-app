-- =====================================================================
-- M6 (POS) — Pied de facture : remise globale, mode HT/TTC, détaxe (export 0%),
-- frais de port (taxé/non taxé), net TTC forcé (arrondi de facture).
-- Réf. G8 Facturation p.31 (mode HT/TTC), p.52-54 (port), p.54 (détaxe PDV005),
-- p.66-67 (remise globale % ou montant, net TTC forçable). B7 : totaux recalculés,
-- jamais d'UPDATE silencieux (audit via trigger existant sur `documents`).
-- =====================================================================

alter table public.documents
  add column if not exists price_mode             text          not null default 'ttc',  -- 'ht' (pro/TVA) | 'ttc' (particulier)
  add column if not exists tax_exempt             boolean       not null default false,   -- détaxe export 0% (PDV005)
  add column if not exists global_discount_pct    numeric(6,2)  not null default 0,        -- remise globale en %
  add column if not exists global_discount_amount numeric(14,2) not null default 0,        -- OU remise globale en montant HT
  add column if not exists shipping_ht            numeric(14,2) not null default 0,        -- frais de port HT
  add column if not exists shipping_taxed         boolean       not null default true,     -- port taxé (TVA) ou non
  add column if not exists shipping_vat_rate      numeric(6,2)  not null default 21,        -- taux TVA appliqué au port
  add column if not exists forced_ttc             numeric(14,2);                            -- net TTC forcé (arrondi facture), null = non forcé
