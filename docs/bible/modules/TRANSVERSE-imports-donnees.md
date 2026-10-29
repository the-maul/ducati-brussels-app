---
chapitre: TRANSVERSE-IMP
titre: Imports de données — ce qu'on a vraiment en base
etat: 🟦
verifie_le: 2026-10-28
missions: []
mots_cles: [import, reprise, G8, catalogue, tarif, rapprochement, PDF, facture, stock, remplacement]
---

# TRANSVERSE — Imports de données

> **En une phrase** : d'où vient chaque donnée du DMS, ce qui est complet, ce qui manque,
> et pourquoi — pour qu'on arrête de redécouvrir les mêmes trous.

## 1. À quoi ça sert

Le DMS ne part pas d'une page blanche : il reprend 20 ans de données de G8, le catalogue
constructeur Ducati, les tarifs, et le site Shopify. Ces sources arrivent par des canaux
différents, à des dates différentes, avec des trous différents. Ce chapitre dit, source par
source, ce qui est entré, ce qui ne l'est pas, et ce que ça empêche.

## 2. Les cinq sources

| Source | Ce qu'elle apporte | Comment elle entre | État |
|---|---|---|---|
| **Reprise G8 (juin 2026)** | 94 063 articles, 17 812 documents, clients, véhicules, fournisseurs | `tools/migration/import_g8.py` | ✅ en-têtes · ❌ lignes de factures |
| **Inventaire G8 (23/09/2026)** | PAMP et casiers sur ~3 300 articles, mouvements de stock | `tools/migration/import_inventaire_g8.py` | ✅ |
| **Catalogue Ducati (oct. 2026)** | 2 399 modèles-années, 59 145 vues éclatées, 54 630 références | extension Chrome `tools/myducati-extension` | ✅ complet |
| **Tarifs Ducati (fichiers ListPrice)** | 126 391 références avec prix, classe de remise, remplacement | écran `/parts/import` | 🟡 jamais appliqué |
| **Export G8 du stock (28/10/2026)** | verrous de prix, dernière vente/achat, PAMP, casiers sur 4 050 articles | à faire | 🔴 pas repris |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écran d'import de tarif | `src/routes/_app.parts.import.tsx` |
| Lecture et règles de l'import | `src/modules/articles/import/` (`parse.ts`, `rules.ts`, `apply.ts`, `translate.ts`) |
| Rapprochement article ↔ catalogue | `article_links_refresh`, `article_links_autoresolve` |
| Écran de rapprochement | `src/routes/_app.parts.links.tsx` |
| Extension de scraping du catalogue | `tools/myducati-extension/` |
| Chargeur hors ligne du catalogue | `tools/catalog-loader/load.mjs` |
| Reprise G8 | `tools/migration/import_g8.py`, `import_inventaire_g8.py`, `import_pdf_lines.py` |
| Tables catalogue | `ducati_catalog_*` (13 tables) |
| Tables de liens | `article_links` (statuts `lie`, `a_valider`, `rejete`) |
| Journal des prix | `price_changes` (append-only) |

## 4. Ce qu'on a vraiment — chiffres vérifiés le 28/10/2026

### Catalogue Ducati — complet

| | |
|---|---|
| Modèles-années | 2 399 (tous marchés, 1985 à 2027) |
| Vues éclatées | 59 145 |
| Lignes de planches | 1 363 904 |
| Références pièces | 54 630 |
| Accessoires / vêtements | 4 500 |

Le catalogue a été lu **en entier** : tous les marchés (EU, USA, Thaïlande, Brésil, Argentine,
Australie, Taïwan, Chine, Japon) et tous les millésimes depuis 1985. Ce n'est plus un
échantillon : une référence absente de ces tables est absente du catalogue Ducati.

### Rattachement des articles

| | |
|---|---|
| Articles actifs | 93 755 |
| Reliés aux pièces du catalogue | 53 928 |
| Reliés aux accessoires / vêtements | 6 940 |
| Reliés à Shopify | 2 892 |
| Sans aucun lien catalogue | 13 680 |
| À valider | 8 |
| Rejetés automatiquement | 10 125 |

**Les « rejetés » ne sont pas des échecs.** Tous automatiques, avec un motif :
8 377 parce que l'article est remplacé dans le DMS par une référence qui porte déjà le lien,
1 743 parce que c'est le même numéro avec un autre indice (`57410221A` / `57410221AB`),
5 divers. Les 8 « à valider » sont les cas d'indice trop ambigus pour décider seul.

**Les 13 680 sans lien** ne sont dans aucune vue éclatée, tous marchés confondus — établi par
exhaustivité. 13 599 viennent de G8. On y trouve 2 384 imprimés (préfixe 91 : manuels,
documentation), des codes de projet et de présérie (`PROJECT 140`, `V21D`, `V22B`), et des
pièces de marchés lointains ou de modèles anciens retirées de la publication. Seules 180 ont
déjà bougé en stock. **Mais 13 610 d'entre elles sont dans les fichiers de tarif** avec leur
libellé et leur prix : le tarif les récupérera.

### Les pièces sans référence Ducati — décision du 29/10/2026

On arrête de chercher à rattacher à tout prix. Une pièce sans lien catalogue
reste une pièce normale du DMS : elle a sa référence, son libellé, son prix et son
stock. Domenico peut la rattacher à la main depuis la fiche s'il tombe dessus,
mais **on ne lui demandera jamais de traiter une file de plusieurs milliers**.

Chiffres vérifiés le 29/10/2026 :

| | |
|---|---|
| Pièces sans lien catalogue | **32 074** |
| — dont présentes dans le tarif Ducati | **31 386** |
| — dont absentes du tarif | **688** |

Donc la quasi-totalité **aura son libellé et son prix** par l'import du tarif.
Ce qui leur manque, et manquera toujours, c'est la **vue éclatée** : elles ne
figurent sur aucune planche du catalogue.

> **À garder en tête pour la suite.** Partout où l'on s'appuiera sur la référence
> Ducati — ouvrir la vue éclatée depuis un ordre de réparation, proposer les
> pièces compatibles d'une moto, illustrer une ligne de devis — il faudra
> prévoir ce qu'on affiche pour ces 32 074 pièces. Ne pas supposer qu'une pièce
> a forcément une planche.

**Piège de mesure.** Les premiers comptes de ce chapitre parlaient de « 16 628 »
puis « 13 680 » références : c'était un filtre trop étroit (`^[0-9]{8}[A-Z]?$`),
qui excluait des références Ducati parfaitement valides comme `57314551AA`,
`490P0322A`, `91378191US` ou `320318`. Pour compter les pièces sans lien,
**filtrer sur `mgmt_type` et l'absence de lien, jamais sur la forme de la
référence**.

### Contrôles de cohérence

| Contrôle | Résultat |
|---|---|
| Un article relié à deux pièces du catalogue | 0 |
| Références en double dans le DMS | 0 |
| Vues éclatées orphelines | 0 |
| Une pièce du catalogue reliée à deux articles | 91 — **normal** : paires neuf/occasion (`12120471A` + `12120471AOCC`) |
| Articles reliés sans prix de vente | 1 398 — se règlent par l'import du tarif |

## 5. Les trous connus, et pourquoi

### Les lignes de factures (2013 à 2025)

17 092 factures sur 17 812 n'ont **aucune ligne**. Ce n'est pas une perte à l'import : les
exports Excel de G8 ne contiennent que des en-têtes (numéro, client, date, totaux, règlements).
G8 n'a jamais exporté le détail.

Conséquence : `last_sold_at` et `last_purchased_at` sont vides sur les 93 755 articles, donc pas
de rotation, pas de réassort fondé sur l'historique, et une facture d'avant 2026 s'affiche sans
détail dans l'espace client.

Le détail existe dans les **12 704 PDF** livrés avec la reprise (`Ducati/Info DB`, 1,6 Go,
texte extractible). `tools/migration/import_pdf_lines.py` est écrit et n'a jamais tourné en entier.

### Le prix d'achat

Seuls 4 116 articles ont un prix d'achat. Les fichiers de tarif Ducati ne donnent **que le prix
public HT** et une **classe de remise** (A à E, P, R, S). Le prix d'achat se déduit de la grille
« classe vers pourcentage », négociée avec Ducati, qui n'est dans aucun fichier.

### Les verrous de prix

`price_sale_locked` et `price_purchase_locked` sont vides sur tous les articles : la reprise de
juin ne les a pas transmis. L'export du 28/10 les donne : 89 verrous de vente, 3 d'achat.
**À reprendre avant le premier import de tarif**, sinon on écrase des prix fixés volontairement.

## 6. Règles et décisions

| Date | Règle | Source |
|---|---|---|
| 15/10/2026 | Une référence absente du catalogue reste en base, la fiche indique qu'aucune info catalogue n'existe, et la saisie manuelle et l'ajout de documents restent possibles | décision client |
| 19/10/2026 | Le tarif constructeur est en **HT**. Le TTC se déduit (× 1,21) | vérifié contre le catalogue en ligne |
| 19/10/2026 | Les règles de prix s'appliquent dans l'ordre : **pourcentage d'abord, arrondi ensuite** | décision client |
| 19/10/2026 | Une nouvelle référence, c'est le même produit : taper l'ancienne mène à la nouvelle, et le stock bascule | décision Domenico |
| M-25 | Une référence du catalogue égale un article | invariant |
| B7 | Tout écart de stock passe par un mouvement tracé, jamais par un UPDATE | invariant |

## 7. Pièges

1. **Le prix « au détail » des tarifs Ducati est HORS TVA.** Le mapping automatique le rangeait
   dans le PPC TTC : tous les prix seraient rentrés 21 % trop bas. Corrigé le 19/10 (`M2-TAR001`).
2. **Les migrations ne s'appliquent pas toutes seules.** Ni Lovable ni Netlify ne les jouent.
   L'écran d'import a dormi cinq semaines parce que ses tables n'existaient pas. Vérifier le
   **schéma réel**, pas le registre `supabase_migrations` qui n'est pas fiable.
3. **Le rapprochement dépasse les 8 s de l'API** quand il a du retard, et comme tout est dans une
   transaction, rien n'est écrit. Les fonctions ont reçu leur propre délai de 120 s le 15/10.
4. **L'export G8 du stock ne couvre que les articles en stock** (4 050), pas les 93 755.
5. **Les chaînes de remplacement font plusieurs niveaux** : suivre jusqu'à la dernière disponible.

## 8. Prochaines étapes

Cartes ouvertes au CRM : tarifs (chargement et application), règles de prix, références
remplacées, reprise de l'export G8 du stock, lignes de factures depuis les PDF, contrôle des
migrations non appliquées.

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | Reprise G8 : 94 063 articles, 17 812 documents | `tools/migration/import_g8.py` |
| 2026-09-23 | Inventaire G8 : PAMP, casiers, mouvements | `import_inventaire_g8.py` |
| 2026-10-15 | Délai propre aux fonctions de rapprochement | `20261015170000` |
| 2026-10-16 | Catalogue Ducati complet : 2 399 modèles-années | `CAT011` à `CAT014` |
| 2026-10-19 | Tarif lu en HT, classe de remise et état ajoutés | `M2-TAR001`, `M2-TAR002` |
| 2026-10-19 | Arrondi des prix après pourcentage | `M2-TAR003` |
