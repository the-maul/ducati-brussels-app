-- =====================================================================
-- M14 — Champs de REPRISE G8 : adapter le schéma aux exports client (Info DB) pour
-- ne RIEN perdre à la migration (on adapte l'app aux documents, pas l'inverse).
-- Sources : Export FOURNISSEURS, Export PARC VEHICULES, Export Factures Antérieur/
-- Courant, Liste des clients. Tous nullables (n'impactent pas les flux natifs).
-- =====================================================================

-- ---- CONTACTS (clients + fournisseurs) ----
alter table public.contacts
  add column if not exists legacy_code          text,           -- "Code" client/fournisseur G8 (résolution FK factures)
  add column if not exists external_ref         text,           -- ref externe (réseau)
  add column if not exists street_number        text,           -- "N° de rue" (G8 sépare n° et rue)
  add column if not exists delivery_address     text,           -- "Adresse de livraison"
  add column if not exists phone_pro            text,           -- "Téléphone pro."
  add column if not exists mobile_pro           text,           -- "Portable pro."
  add column if not exists email_pro            text,           -- "E-mail pro."
  add column if not exists fax                  text,           -- "Télécopie"
  add column if not exists contact_name         text,           -- "Contact" (interlocuteur fournisseur)
  add column if not exists opening_balance      numeric(12,2) not null default 0,  -- "Solde" à la reprise
  add column if not exists dou                  text,           -- "Dou" (sémantique à clarifier client)
  add column if not exists supplier_customer_no text,           -- "N° client achat" (fournisseur)
  add column if not exists supplier_franco_min  numeric(14,2),  -- "Franco de Port"
  add column if not exists supplier_order_min   numeric(14,2),  -- "Minimum de commande en Montant"
  add column if not exists supplier_order_min_qty numeric(14,3);-- "Minimum de commande en Quantité"
create index if not exists idx_contacts_legacy_code on public.contacts(company_id, legacy_code);

-- ---- VEHICULES ----
alter table public.vehicles
  add column if not exists legacy_state            text,    -- "Etat" G8 brut (RÉPARÉ, VENDU NEUF…) conservé pour traçabilité
  add column if not exists entry_date              date,    -- "Entrée le"
  add column if not exists sold_date               date,    -- "Vendu le"
  add column if not exists purchase_invoice_number text,    -- "N° Facture achat"
  add column if not exists mymeca_qr               text;    -- "QR MyMeca"

-- ---- DOCUMENTS (factures historiques) ----
alter table public.documents
  add column if not exists legacy_number       text,            -- N° facture G8 brut (idempotence import)
  add column if not exists code_client_legacy  text,            -- "Code client" G8 (fallback si contact non résolu)
  add column if not exists operator            text,            -- "Opérateur"
  add column if not exists marge               numeric(14,2),   -- "Marge" (€)
  add column if not exists marge_pct           numeric(10,6),   -- "% Marge"
  add column if not exists condition_reglement text,            -- "Condition de règlement"
  add column if not exists compta_transferred  boolean not null default false, -- "Compta" = Transféré
  add column if not exists date_transfert      date,            -- "Date transfert"
  add column if not exists remise_ttc          numeric(14,2),   -- "Remise" parsée (x,xx € TTC)
  add column if not exists imported_from       text;            -- 'G8' (traçabilité B7)
create unique index if not exists uq_documents_legacy on public.documents(company_id, legacy_number) where legacy_number is not null;
