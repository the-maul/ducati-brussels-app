-- M1 — Améliorations fiches contacts (2026-06-29)
-- Ajout du type "employé", champs préférences véhicule/modèles, documents permis/ID

-- 1. Nouveau type de contact : employé
ALTER TYPE contact_type ADD VALUE IF NOT EXISTS 'employe';

-- 2. Champ rue numéro (distinct de l'adresse) — street_number existait déjà en legacy G8
-- S'assurer qu'il existe au cas où la migration G8 ne serait pas encore passée
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS street_number TEXT;

-- 3. Préférence véhicule : vn / vo / both
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS vehicle_preference TEXT;

-- 4. Modèles Ducati d'intérêt (tableau de noms de modèles)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS model_interests TEXT[] DEFAULT '{}';

-- 5. Notification stock : contacter le client quand un modèle d'intérêt rentre en stock
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS notify_model_stock BOOLEAN DEFAULT FALSE;

-- 6. Chemins Storage pour documents d'identité (bucket contact-docs)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS license_scan_path TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS national_id_scan_path TEXT;
