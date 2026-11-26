-- M9 (Simon, 26/11/2026) : chaque fichier ajouté à la fiche client ou moto est LU automatiquement
-- (Claude, fonction serveur read-id-doc en mode « document »). La lecture reconnaît le type de pièce,
-- range le fichier dans le bon dossier et garde ce qu'elle a lu sur le fichier. Les informations ne
-- vont dans les fiches qu'après un clic de l'utilisateur (panneau « Lu dans le fichier »), tracé dans events.
-- Rien n'est relu en masse : les fichiers déjà présents (archive importée) gardent ces colonnes vides
-- jusqu'à un clic sur « Relire ».

alter table public.attachments add column if not exists doc_kind text;
alter table public.attachments add column if not exists extracted jsonb;
alter table public.attachments add column if not exists read_at timestamptz;
alter table public.attachments add column if not exists read_status text;

alter table public.attachments drop constraint if exists attachments_read_status_check;
alter table public.attachments add constraint attachments_read_status_check
  check (read_status is null or read_status in ('pending', 'done', 'failed', 'unsupported', 'too_large', 'no_credit', 'refused'));

comment on column public.attachments.doc_kind is
  'Type de pièce reconnu par la lecture automatique (ticket_caisse, facture, avoir, bon_commande, coc, immatriculation, carte_grise, leasing_credit, offre_banque, garantie, pv_livraison, assurance, controle_technique, identite, fiche_paie, extrait_compte, extrait_role, reprise, photo_moto, autre). Null = jamais lu.';
comment on column public.attachments.extracted is
  'Informations lues dans le fichier (moto, client, ticket/facture : fournisseur, date, montants, lignes). Jamais de numéro national, revenus, employeur ni numéro de compte. Ne crée aucune pièce comptable.';
comment on column public.attachments.read_at is 'Date de la dernière lecture automatique du fichier.';
comment on column public.attachments.read_status is
  'Résultat de la dernière lecture : pending (en cours), done, failed, unsupported (format non lisible), too_large, no_credit (crédit de la clé épuisé), refused.';

create index if not exists idx_attachments_doc_kind on public.attachments(company_id, doc_kind) where doc_kind is not null;
