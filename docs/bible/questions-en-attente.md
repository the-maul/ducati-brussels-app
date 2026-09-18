# Questions en attente du client

Chaque question a une **recommandation** : répondre « OK » suffit pour la retenir.
Une fois tranchée, la réponse part dans le [journal des décisions](decisions.md) et la question
disparaît d'ici.

---

## Mission 01 — Nouveau client

- **Q14 — Adresses e-mail partagées.** 84 adresses sont portées par plusieurs fiches de personnes
  différentes (un couple, une famille, une société avec une adresse commune). Quand un mail arrive
  d'une de ces adresses, le système ne peut pas savoir de quelle personne il s'agit : aujourd'hui il
  le range sur la fiche la plus ancienne. Proposition : la carte affiche « Cette adresse appartient à
  2 fiches : Marc Dupont, Julie Dupont — à qui rattacher ce mail ? » et le vendeur choisit.
  *Reco : OK.*

- **Q18 — Droits d'accès par rôle** (carte ERP « Droits d'accès par rôle », 18/09). Constat : aujourd'hui
  tous les rôles voient presque toutes les pages ; seules Comptabilité (admin, comptable) et Paramètres
  (admin) sont réservées, et tout membre accède à toutes les données de la société. Proposition, les
  rôles cochés s'additionnant :
  vendeur = tableau de bord, véhicules, reprises, clients, CRM, ventes, caisse, pièces et stock en lecture,
  rapports ventes · magasinier = pièces, achats, commandes, stock, picking, ventes comptoir, caisse, clients ·
  mécanicien = atelier, véhicules / clients / pièces en lecture, picking · chef d'atelier = mécanicien +
  tout l'atelier, commandes de pièces, rapports atelier · comptable = ventes, comptabilité, rapports,
  clients en lecture · marketing = clients, CRM, rapports · admin = tout.
  *Reco : valider, puis préciser lecture seule / modification par page.*

## Futur — Shopify

- **Q17 — Accès Shopify.** Il faudra une « application personnalisée » dans l'administration
  Shopify et sa clé d'accès, posée par vous dans les secrets.
