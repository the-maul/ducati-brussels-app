-- Unicité de la paire de fiches liées.
--
-- `linkContact` (subobjects-api.ts) insère puis ignore les erreurs `duplicate|unique`,
-- en supposant un index unique sur la paire. Il n'en existait aucun : la garde ne se
-- déclenchait jamais et lier deux fois les mêmes fiches créait deux lignes en silence.
-- Sans correctif, l'action groupée « Lier » aurait multiplié ces doublons.
--
-- L'index porte sur la paire NORMALISÉE (least/greatest) : (A,B) et (B,A) désignent le
-- même lien — `listLinkedContacts` interroge d'ailleurs les deux colonnes indifféremment.
-- Vérifié avant pose : 2 liens en base, 0 paire en double, aucune fiche au-delà de 2 liens.

create unique index if not exists contact_links_pair_uniq
  on public.contact_links (least(contact_a, contact_b), greatest(contact_a, contact_b));
