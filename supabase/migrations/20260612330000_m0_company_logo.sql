-- M0 — Logo de la société (imprimé sur les factures, format client). URL publique
-- (bucket shop-assets). Configurable par société.
alter table public.companies add column if not exists logo_url text;
