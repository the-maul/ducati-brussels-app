-- =====================================================================
-- M1/M2 — Derniers champs G8 (captures infos app)
-- M1 : 3e téléphone (GSM), 2e complément d'adresse.
-- M2 : prix public conseillé (PPC HT/TTC), verrous de prix.
-- =====================================================================

alter table public.contacts
  add column if not exists gsm                 text,
  add column if not exists address_complement2 text;

alter table public.articles
  add column if not exists ppc_ht                numeric(12,2),   -- prix public conseillé HT
  add column if not exists ppc_ttc               numeric(12,2),   -- prix public conseillé TTC
  add column if not exists price_purchase_locked boolean not null default false,
  add column if not exists price_sale_locked     boolean not null default false;
