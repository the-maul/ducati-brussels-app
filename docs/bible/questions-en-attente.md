# Questions en attente du client

Chaque question a une **recommandation** : répondre « OK » suffit pour la retenir.
Une fois tranchée, la réponse part dans le [journal des décisions](decisions.md) et la question
disparaît d'ici.

---

## Stock (23/09)

- **Q19 — Le stock de G8 n'a jamais été repris.** Constat en base le 23/09 : `stock_moves` ne contient
  que **1 093 mouvements**, tous postérieurs au projet (reprise Shopify des 21 et 23/09, motos du parc,
  6 réceptions, 1 vente, 1 ORO). Il n'existe **aucun** mouvement d'origine G8, aucune table d'import G8
  et aucune colonne de quantité dans l'import des articles G8 (`src/modules/migration/articles-import.ts`) :
  l'import de juillet a repris les **fiches** (81 473 articles) et les **prix**, pas les quantités.
  Résultat : sur les 81 473 articles venus de G8, **260 seulement ont un stock** — et ils le tiennent de
  la reprise Shopify, pas de G8. Les articles créés depuis le catalogue Ducati sont bien à 0 sans prix
  (8 760, conforme) et ceux créés depuis Shopify ont bien le stock et le prix du site (2 559, 927 pièces).
  **Ce n'est donc pas un problème d'affichage** (corrigé le 23/09, M-28) mais une **donnée absente**.
  Il faut un export de stock depuis G8 (référence + quantité + casier, idéalement PA pour le PAMP) puis
  un import en mouvements `inventaire` append-only, comme la reprise Shopify (B7).
  *Reco : demander l'export G8 à Domenico et planifier la reprise avant le go-live.*

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
