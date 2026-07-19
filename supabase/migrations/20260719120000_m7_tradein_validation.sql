-- M7 (B2/B3) — Validation de reprise : la reprise devient un APPEL D'OFFRES ;
-- le véhicule n'entre en stock qu'après « Valider la reprise » (3 étapes :
-- checklist de réception, vérification client + attestation TVA marge signée,
-- montants + classement). Métadonnées stockées sur le dossier (table oro).
alter table public.oro
  add column if not exists tradein_status text not null default 'ouvert',  -- ouvert | valide | annule
  add column if not exists checklist jsonb,
  add column if not exists seller_vat_status text,
  add column if not exists attestation jsonb,          -- {place, date, signed, pdf_path}
  add column if not exists vat_rate numeric(5,2),
  add column if not exists buy_price_ttc numeric(14,2),
  add column if not exists buy_price_ht numeric(14,2),
  add column if not exists sale_price numeric(14,2),
  add column if not exists min_sale_price numeric(14,2),
  add column if not exists classification jsonb,       -- {supplier, rayon, sub_rayon, category}
  add column if not exists validated_at timestamptz,
  add column if not exists cancelled_at timestamptz;

notify pgrst, 'reload schema';
