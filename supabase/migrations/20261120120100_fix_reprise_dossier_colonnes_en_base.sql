-- =====================================================================
-- Correctif lot-verif-parcours (20/11/2026) — parcours G8 n° 3 « Reprise d'une moto à un particulier ».
--
-- QUOI : pose en base les colonnes du DOSSIER DE REPRISE (table `oro`) et du lien reprise ↔ demande
--        (table `leads`) que l'écran Reprises écrit déjà, plus la case « Papiers 100 CH » de la
--        fiche moto :
--          oro   : tradein_status, checklist, seller_vat_status, attestation, vat_rate,
--                  buy_price_ttc, buy_price_ht, sale_price, min_sale_price, classification,
--                  validated_at, cancelled_at, dispatched_at, accepted_amount, best_offer_amount,
--                  invoice_partner_name, accepted_at ;
--          leads : oro_id, reprise_status ;
--          vehicles : papers_100hp.
-- POURQUOI : ces colonnes viennent des migrations 20260719120000_m7_tradein_validation,
--        20260720090000_m7_reprise_workflow et 20260716090000_m3_vehicles_papers_100hp, ÉCRITES
--        MAIS JAMAIS APPLIQUÉES EN PRODUCTION (constat du 20/11 par lecture du schéma : colonnes
--        absentes). Plus anciennes que les migrations appliquées depuis, elles ne passent plus par
--        `db push` (ordre des versions) : d'où ce correctif à une date récente.
--        Conséquence vue au parcours 3 : à la validation d'une reprise, le statut « Repris », la
--        check-list des documents remis, le statut TVA du vendeur (0 % « reprise à un
--        particulier »), les montants (prix de reprise TVAC / HTVA), le PRIX DE VENTE MINIMUM DE
--        RÉSERVE et le classement (08 OCCASIONS / 01 PARTICULIERS) restaient dans le navigateur
--        du poste (localStorage, validate-api.ts) : invisibles depuis un autre poste, perdus au
--        nettoyage du navigateur. La case « Papiers 100 CH » de la fiche moto n'était jamais
--        enregistrée (écriture tolérante qui retire la colonne absente).
--
-- CHOIX : `tradein_status` est posé SANS valeur par défaut (la migration d'origine mettait
--        'ouvert' non nul) : l'écran donne la priorité à la base sur le navigateur, une valeur
--        'ouvert' posée d'office aurait affiché « Collecté » sur des reprises déjà validées ou
--        envoyées depuis un poste. Colonne vide = l'écran garde sa logique actuelle (navigateur,
--        puis statut de la moto). Les reprises déjà entrées en stock (moto avec article
--        d'occasion, en stock ou vendue) sont marquées « repris » une fois (rattrapage, tracé
--        dans events). Rien d'autre n'est modifié.
-- Idempotente (add column if not exists ; rattrapage limité aux lignes encore vides).
-- RLS : tables existantes, politiques inchangées (oro_all / leads_all, style rls_*_companies()).
-- Essai : supabase/tests/parcours_g8_03_reprise_moto_particulier.sql (PRE_SQL).
-- =====================================================================

alter table public.oro
  add column if not exists tradein_status       text,
  add column if not exists checklist            jsonb,
  add column if not exists seller_vat_status    text,
  add column if not exists attestation          jsonb,          -- {place, date, signed, pdf_path}
  add column if not exists vat_rate             numeric(5,2),
  add column if not exists buy_price_ttc        numeric(14,2),
  add column if not exists buy_price_ht         numeric(14,2),
  add column if not exists sale_price           numeric(14,2),
  add column if not exists min_sale_price       numeric(14,2),  -- prix de vente minimum de reserve (G8)
  add column if not exists classification       jsonb,          -- {supplier, rayon, sub_rayon, category}
  add column if not exists validated_at         timestamptz,
  add column if not exists cancelled_at         timestamptz,
  add column if not exists dispatched_at        timestamptz,
  add column if not exists accepted_amount      numeric(14,2),
  add column if not exists best_offer_amount    numeric(14,2),
  add column if not exists invoice_partner_name text,
  add column if not exists accepted_at          timestamptz;

comment on column public.oro.tradein_status is
  'Statut du dossier de reprise : collecte | envoye | accepte | repris | annule (anciens : ouvert, valide). Vide = ecran (navigateur / statut de la moto).';
comment on column public.oro.min_sale_price is 'Prix de vente minimum de reserve (G8 « Conditions » de la fiche de reprise).';

alter table public.leads
  add column if not exists oro_id         uuid,
  add column if not exists reprise_status text;

alter table public.vehicles
  add column if not exists papers_100hp boolean not null default false;

-- Rattrapage : reprises deja entrees en stock (article d'occasion lie a la moto) -> « repris ».
with done as (
  update public.oro o
     set tradein_status = 'repris'
    from public.vehicles v
   where v.id = o.vehicle_id
     and o.tradein_status is null
     and v.article_id is not null
     and public.vehicle_parc_kind(v.status) in ('en_stock', 'vendue')
  returning o.id, o.company_id, o.number
)
insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
select d.company_id, null, 'reprise_status_backfill', 'oro', d.id::text, 'migration',
       jsonb_build_object('tradein_status', null), jsonb_build_object('tradein_status', 'repris', 'number', d.number)
  from done d;

notify pgrst, 'reload schema';
