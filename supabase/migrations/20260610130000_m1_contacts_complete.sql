-- =====================================================================
-- M1 — Complément CONTACTS (parité fiche client G8)
-- Champs issus de docs/g8-reference-extract.md : statut, blocage, mode HT,
-- adresse complète, RGPD, tarif/catégorie, compta (BIC/domiciliation/affacturage),
-- type de vente TVA (national/intracom/export).
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'contact_status') then
    create type public.contact_status as enum ('prospect','client');
  end if;
  if not exists (select 1 from pg_type where typname = 'sale_vat_type') then
    create type public.sale_vat_type as enum ('national','intracom','export');
  end if;
end $$;

alter table public.contacts
  add column if not exists code                text,
  add column if not exists status              public.contact_status not null default 'prospect',
  add column if not exists is_blocked          boolean not null default false,   -- Client bloqué
  add column if not exists mode_ht             boolean not null default false,   -- Mode H.T.
  add column if not exists address_complement  text,
  add column if not exists po_box              text,
  add column if not exists address_mismatch    boolean not null default false,   -- N'habite pas à l'adresse
  add column if not exists marketing_opt_out   boolean not null default false,   -- Opposé au marketing (RGPD)
  add column if not exists price_list          text,                              -- Tarif (grille nommée)
  add column if not exists category            text,                              -- Catégorie client
  add column if not exists receipt_copies      int not null default 0,            -- Nb exemplaires en caisse
  add column if not exists show_discounts_pos  boolean not null default true,     -- Afficher remises en caisse
  add column if not exists accounting_account  text,                              -- Compte comptable
  add column if not exists domiciliation       text,
  add column if not exists bic                 text,
  add column if not exists factoring_code      text,                              -- Code affacturage
  add column if not exists sale_vat_type       public.sale_vat_type not null default 'national';

create index if not exists idx_contacts_code on public.contacts(company_id, code);
create index if not exists idx_contacts_status on public.contacts(company_id, status);
