-- M6 — Référence article sur la ligne de document (affichée sur la facture, colonne
-- REFERENCE). Utile à la reprise des lignes de factures G8 (article non encore au
-- catalogue) et à l'édition conforme au format client.
alter table public.document_lines add column if not exists reference text;
