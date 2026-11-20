-- Dépôt-vente : les textes imprimés (conditions, mention légale, mention sur la facture acheteur,
-- mode de règlement « Retenu sur dépôt-vente ») avaient été semés SANS accents par la migration
-- 20261118270000 (« Le vehicule reste la propriete du deposant jusqu a sa vente »). Ils partent
-- tels quels sur le document de dépôt remis au client et sur la facture acheteur.
-- Vérif écrans du 20/11/2026. On ne remplace QUE les textes encore identiques à la graine :
-- un texte déjà retouché par le magasin n'est pas touché. Idempotent.

update public.reference_values set label = v.new_label
  from (values
    ('consignment_settings', 'buyer_mention_particulier',
     'Vente pour compte du deposant, depot-vente {numero}. Vehicule d occasion appartenant a un particulier non assujetti : pas de TVA sur le prix du vehicule.',
     'Vente pour compte du déposant, dépôt-vente {numero}. Véhicule d''occasion appartenant à un particulier non assujetti : pas de TVA sur le prix du véhicule.'),
    ('consignment_settings', 'buyer_mention_professionnel',
     'Vente pour compte du deposant, depot-vente {numero}.',
     'Vente pour compte du déposant, dépôt-vente {numero}.'),
    ('consignment_settings', 'conditions_particulier',
     'Le vehicule reste la propriete du deposant jusqu a sa vente. Le deposant garantit etre proprietaire du vehicule et qu il est libre de tout gage. La concession s engage a ne pas vendre en dessous du prix minimum convenu sans accord du deposant. A la vente, le prix de vente diminue de la commission, des frais et des reparations acceptees est reverse au deposant.',
     'Le véhicule reste la propriété du déposant jusqu''à sa vente. Le déposant garantit être propriétaire du véhicule et qu''il est libre de tout gage. La concession s''engage à ne pas vendre en dessous du prix minimum convenu sans accord du déposant. À la vente, le prix de vente diminué de la commission, des frais et des réparations acceptées est reversé au déposant.'),
    ('consignment_settings', 'conditions_professionnel',
     'Le vehicule reste la propriete du deposant jusqu a sa vente. A la vente, le deposant facture le vehicule a la concession ou la concession facture pour son compte selon les conditions convenues ; la commission, les frais et les reparations acceptees sont factures au deposant.',
     'Le véhicule reste la propriété du déposant jusqu''à sa vente. À la vente, le déposant facture le véhicule à la concession ou la concession facture pour son compte selon les conditions convenues ; la commission, les frais et les réparations acceptées sont facturés au déposant.'),
    ('consignment_settings', 'legal_mention',
     'Document de depot-vente etabli en deux exemplaires. Le deposant declare avoir pris connaissance des conditions ci-dessus et les accepter.',
     'Document de dépôt-vente établi en deux exemplaires. Le déposant déclare avoir pris connaissance des conditions ci-dessus et les accepter.'),
    ('payment_method', 'DEP',
     'Retenu sur depot-vente',
     'Retenu sur dépôt-vente')
  ) as v(table_key, code, old_label, new_label)
 where reference_values.table_key = v.table_key
   and reference_values.code = v.code
   and reference_values.label = v.old_label;
