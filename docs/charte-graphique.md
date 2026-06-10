# Charte Graphique — ERP Ducati Bruxelles
> Design system pour un ERP/DMS de concession moto (périmètre fonctionnel type G8 d'Orisha : véhicules, atelier, pièces, ventes, CRM, caisse).
> Ce fichier est la source de vérité pour Claude Code. Toute décision visuelle non couverte ici doit être dérivée de ces principes, pas inventée.

---

## 1. Principes directeurs

1. **Le rouge est une signature, pas un fond.** Le rouge Ducati est réservé aux actions primaires, à l'identité (header, logo) et aux états actifs. Jamais en fond de page, jamais en masse dans les tableaux. Un ERP se regarde 8h/jour : le rouge doit rester un événement.
2. **Densité avant décoration.** Un ERP de concession affiche des tableaux de 50+ lignes, des plannings d'atelier, des fiches véhicule. La hiérarchie passe par la typo (Cond pour la donnée, Ext pour les titres), pas par des cartes ombrées partout.
3. **Couleur ≠ seule information.** Tout statut combine couleur + icône + libellé. Daltonisme et impression N&B (OR papier) obligent.
4. **Lisibilité industrielle.** Référence mentale : tableau de bord d'une Multistrada, pas un site marketing. Contrastes forts, chiffres tabulaires, zéro gris pâle sur blanc.

---

## 2. Couleurs

### 2.1 Marque (extraites du site ducatibruxelles)

```css
:root {
  /* Marque */
  --ducati-red:        #C8102E;  /* Rouge Ducati — actions primaires, identité, actif */
  --ducati-red-dark:   #A50D26;  /* Hover/pressed du rouge */
  --ducati-red-tint:   #FBEAED;  /* Fond léger : ligne sélectionnée, badge rouge */
  --ducati-black:      #1A1A1A;  /* Texte principal, sidebar */
  --ducati-anthracite: #343434;  /* Surfaces sombres secondaires (cf. bouton Assistance du site) */
}
```

### 2.2 Neutres (échelle de gris)

```css
:root {
  --gray-0:   #FFFFFF;  /* Fond des surfaces de travail (tableaux, formulaires) */
  --gray-50:  #F6F6F6;  /* Fond de page, fond de cellule alternée */
  --gray-100: #ECECEC;  /* Séparateurs légers, fond hover de ligne */
  --gray-200: #D9D9D9;  /* Bordures d'inputs, bordures de tableaux */
  --gray-400: #9A9A9A;  /* Placeholders, texte désactivé */
  --gray-600: #5C5C5C;  /* Texte secondaire, labels */
  --gray-800: #2B2B2B;  /* Texte fort secondaire */
}
```

### 2.3 Sémantique (statuts ERP)

Le rouge sémantique est **distinct** du rouge marque (plus sombre, tirant brique) pour que "erreur" ne se confonde jamais avec "action Ducati".

```css
:root {
  --success:      #1E7B3C;  /* Validé, payé, en stock, OR clôturé */
  --success-bg:   #E7F4EB;
  --warning:      #B45309;  /* En attente, stock bas, devis à relancer */
  --warning-bg:   #FDF1E2;
  --danger:       #99201C;  /* Erreur, impayé, rupture, OR bloqué */
  --danger-bg:    #F9E9E8;
  --info:         #1D5FA8;  /* Information, en cours, commande fournisseur */
  --info-bg:      #E8F0F9;
  --neutral-tag:  #5C5C5C;  /* Archivé, brouillon */
  --neutral-bg:   #EFEFEF;
}
```

### 2.4 Couleurs métier (planning atelier & stock)

Palette dédiée aux types d'intervention / catégories — désaturée pour tenir en masse sur un planning :

```css
:root {
  --job-entretien:   #4C7FA3;  /* Entretien périodique */
  --job-reparation:  #A35B4C;  /* Réparation mécanique */
  --job-garantie:    #6B5CA3;  /* Garantie / rappel constructeur */
  --job-pneus:       #4CA379;  /* Pneus / consommables */
  --job-prepa:       #C2913A;  /* Préparation véhicule neuf/occasion */
  --job-carrosserie: #7A7A7A;  /* Carrosserie / esthétique */
}
```

### Règles d'usage couleur
- Ratio de contraste minimum **4.5:1** pour tout texte ; les badges de statut utilisent le texte foncé sur fond `-bg` clair.
- Le rouge Ducati n'apparaît **jamais** comme couleur de statut. Une facture impayée = `--danger`, pas `--ducati-red`.
- Actions destructrices (supprimer, annuler OR) : `--danger` + modal de confirmation systématique.

---

## 3. Typographie

### 3.1 Familles (fichiers fournis)

| Famille | Fichiers | Rôle dans l'ERP |
|---|---|---|
| **Ducati Style Ext** | `DucatiStyleExt_Rg.ttf`, `DucatiStyleExt_Bd.ttf` | Display : titres de modules, écran de login, headers d'impression. Usage rare et large. |
| **Ducati Style** | `DucatiStyle_Rg.ttf`, `DucatiStyle_Bd.ttf`, `DucatiStyle_XBd.ttf` | UI courante : labels, boutons, navigation, corps de formulaire. |
| **Ducati Style Cond** | `DucatiStyleCond_Rg.ttf`, `DucatiStyleCond_Bd.ttf`, `DucatiStyleCond_XBd.ttf` | Donnée dense : tableaux, KPI, badges, planning. Gagne ~20% de largeur. |
| **JetBrains Mono** (ou IBM Plex Mono, à installer) | — | Codes : VIN, n° châssis, réf. pièces, n° facture, codes-barres lisibles. |

```css
@font-face { font-family: 'Ducati Style Ext'; src: url('/fonts/DucatiStyleExt_Rg.ttf'); font-weight: 400; }
@font-face { font-family: 'Ducati Style Ext'; src: url('/fonts/DucatiStyleExt_Bd.ttf'); font-weight: 700; }
@font-face { font-family: 'Ducati Style'; src: url('/fonts/DucatiStyle_Rg.ttf'); font-weight: 400; }
@font-face { font-family: 'Ducati Style'; src: url('/fonts/DucatiStyle_Bd.ttf'); font-weight: 700; }
@font-face { font-family: 'Ducati Style'; src: url('/fonts/DucatiStyle_XBd.ttf'); font-weight: 800; }
@font-face { font-family: 'Ducati Style Cond'; src: url('/fonts/DucatiStyleCond_Rg.ttf'); font-weight: 400; }
@font-face { font-family: 'Ducati Style Cond'; src: url('/fonts/DucatiStyleCond_Bd.ttf'); font-weight: 700; }
@font-face { font-family: 'Ducati Style Cond'; src: url('/fonts/DucatiStyleCond_XBd.ttf'); font-weight: 800; }

:root {
  --font-display: 'Ducati Style Ext', 'Arial Black', sans-serif;
  --font-ui:      'Ducati Style', 'Helvetica Neue', Arial, sans-serif;
  --font-data:    'Ducati Style Cond', 'Arial Narrow', sans-serif;
  --font-mono:    'JetBrains Mono', 'Courier New', monospace;
}
```

### 3.2 Échelle typographique

| Token | Taille / interligne | Police | Usage |
|---|---|---|---|
| `--text-display` | 28px / 34px, Bd, UPPERCASE | Ext | Titre de module ("ATELIER & SAV"), login |
| `--text-h1` | 22px / 28px, Bd | UI | Titre de page ("Ordre de réparation #2026-0412") |
| `--text-h2` | 17px / 24px, Bd | UI | Sections de formulaire, titres de cartes |
| `--text-body` | 14px / 20px, Rg | UI | Texte courant, formulaires |
| `--text-label` | 12px / 16px, Bd, UPPERCASE, letter-spacing 0.04em | UI | Labels de champs, en-têtes de colonnes |
| `--text-data` | 13px / 18px, Rg | **Cond** | Cellules de tableaux, listes denses |
| `--text-kpi` | 32px / 36px, XBd | **Cond** | Chiffres de dashboard |
| `--text-mono` | 13px / 18px | Mono | VIN, réfs, n° de documents |
| `--text-caption` | 11px / 14px, Rg | UI | Méta-infos, horodatage |

**Règles :**
- Chiffres en `font-variant-numeric: tabular-nums` partout (tableaux, KPI, prix) — alignement vertical des montants obligatoire.
- UPPERCASE réservé à Ext display et aux labels. Jamais de phrases entières en capitales.
- Pas d'italique : les fontes Ducati n'en ont pas, ne pas en simuler (faux-italique interdit).

---

## 4. Layout & espacement

### 4.1 Grille applicative

```
┌──────────────────────────────────────────────────────┐
│ TOPBAR 56px — fond blanc, logo Ducati BXL, recherche │
│ globale (VIN/client/réf), notifications, user        │
├─────────┬────────────────────────────────────────────┤
│ SIDEBAR │  ZONE DE TRAVAIL                           │
│ 240px   │  fond --gray-50, padding 24px              │
│ fond    │  ┌──────────────────────────────────────┐  │
│ #1A1A1A │  │ Surfaces blanches (cards, tableaux)  │  │
│ texte   │  │ radius 6px, bordure --gray-200       │  │
│ blanc   │  └──────────────────────────────────────┘  │
│ actif:  │                                            │
│ barre   │                                            │
│ rouge   │                                            │
│ 3px à   │                                            │
│ gauche  │                                            │
└─────────┴────────────────────────────────────────────┘
```

- **Sidebar** : fond `--ducati-black`, items en `--font-ui` 14px. Item actif = fond `#2B2B2B` + barre verticale `--ducati-red` 3px à gauche (reprise du soulignement rouge de la nav du site). Repliable à 64px (icônes seules).
- **Modules sidebar** : Dashboard · Véhicules (neuf/occasion) · Atelier & SAV · Pièces & Accessoires · Ventes & Facturation · Clients (CRM) · Caisse · E-shop · Rapports · Paramètres.
- **Espacement** : échelle 4px → `4, 8, 12, 16, 24, 32, 48`. Padding standard des cards : 16px. Gouttière entre cards : 16px.
- **Radius** : 6px (cards, inputs, boutons), 4px (badges), 0 sur les documents imprimables.
- **Ombres** : quasi inexistantes. `0 1px 2px rgba(0,0,0,.06)` max sur les cards ; modals : `0 8px 32px rgba(0,0,0,.18)`.

### 4.2 Breakpoints

| Token | Largeur | Comportement |
|---|---|---|
| Desktop | ≥1280px | Layout complet |
| Laptop | 1024–1279px | Sidebar repliée par défaut |
| Tablette atelier | 768–1023px | Mode "atelier" : planning et OR plein écran, navigation par onglets bas |
| Mobile | <768px | Consultation seule : recherche, fiche client, statut OR |

---

## 5. Composants

### 5.1 Boutons

| Variante | Style | Usage |
|---|---|---|
| **Primaire** | Fond `--ducati-red`, texte blanc, Bd 14px, hover `--ducati-red-dark` | 1 max par écran : "Créer l'OR", "Facturer", "Encaisser" |
| **Secondaire** | Fond blanc, bordure `--gray-200`, texte `--ducati-black` | Actions courantes |
| **Tertiaire/ghost** | Texte seul `--gray-600`, hover `--gray-100` | Actions de tableau (éditer, dupliquer) |
| **Danger** | Fond blanc, bordure et texte `--danger` ; plein `--danger` dans la modal de confirmation | Supprimer, annuler |
| **Désactivé** | Fond `--gray-100`, texte `--gray-400`, cursor not-allowed | — |

Hauteurs : 36px standard, 44px sur écrans tactiles atelier, 28px compact dans les tableaux. Padding horizontal 16px. Icône à gauche du libellé, 16px.

### 5.2 Formulaires

- Inputs : hauteur 36px, fond blanc, bordure `--gray-200`, radius 6px. Focus : bordure `--ducati-black` + ring 2px `rgba(200,16,46,.15)`.
- Label au-dessus (`--text-label`), jamais de label flottant.
- Champ requis : astérisque `--ducati-red`.
- Erreur : bordure `--danger` + message 12px sous le champ avec icône. Le message dit quoi corriger, pas juste "champ invalide".
- Champs codes (VIN 17 caractères, réf. pièce) : `--font-mono`, validation de format en direct, bouton scan code-barres intégré à droite.
- Selects et combobox avec recherche dès 8 options (marques, modèles, clients).
- Montants : alignés à droite, suffixe € grisé, tabular-nums.

### 5.3 Tableaux de données (cœur de l'ERP)

- Police `--font-data` (Cond) 13px, hauteur de ligne 36px (compact : 30px — toggle utilisateur).
- En-têtes : `--text-label` sur fond `--gray-50`, sticky au scroll, triables (chevron).
- Lignes : bordure basse `--gray-100`, hover `--gray-100`, sélection `--ducati-red-tint` + checkbox.
- Zébrage optionnel `--gray-50` pour les tableaux > 20 lignes.
- Colonnes numériques (prix, stock, km) alignées à droite. Colonnes statut : badge. Colonne actions : icônes ghost à droite, visibles au hover.
- Barre de filtres au-dessus : recherche + filtres en pills (statut, marque, période) + compteur de résultats + export (CSV, PDF).
- Pagination 25/50/100 ou scroll virtuel au-delà de 200 lignes.
- Actions groupées : barre flottante en bas quand sélection ≥1 ("3 éléments — Facturer · Exporter · Supprimer").

### 5.4 Badges de statut

Forme : radius 4px, padding 2px 8px, texte Cond Bd 12px UPPERCASE, **icône + libellé toujours**.

| Domaine | Statuts |
|---|---|
| OR atelier | Planifié (info) · En cours (info) · Attente pièces (warning) · À facturer (warning) · Clôturé (success) · Bloqué (danger) |
| Véhicule | En stock (success) · Réservé (warning) · Vendu (neutral) · En préparation (info) · En commande (info) |
| Facture | Payée (success) · Partielle (warning) · Impayée (danger) · Avoir (neutral) · Brouillon (neutral) |
| Pièce | En stock (success) · Stock bas (warning, seuil paramétrable) · Rupture (danger) · En commande (info) |

### 5.5 Dashboard & data-viz

- KPI cards : libellé `--text-label`, valeur `--text-kpi` (Cond XBd), delta vs période précédente en 12px (`--success`/`--danger` + flèche). 4–6 KPI max par rôle : CA jour/mois, OR ouverts, taux d'occupation atelier, véhicules en stock, marge pièces, paniers e-shop.
- Graphiques : barres et lignes uniquement (pas de camemberts au-delà de 4 segments). Série principale `--ducati-red`, séries secondaires en gris `--gray-400`/`--gray-600` et `--info`. Grille horizontale `--gray-100` fine, pas de grille verticale. Axe Y en Cond 11px.
- Jauges (occupation atelier) : barre horizontale, seuils 80% warning / 95% danger.

### 5.6 Planning atelier (vue calendrier)

- Grille semaine : colonnes = mécaniciens (ou ponts), lignes = créneaux 30min, Cond 12px.
- Blocs d'intervention : fond couleur `--job-*` à 12% d'opacité, bordure gauche 3px pleine couleur, titre Cond Bd, client + véhicule en dessous, icône statut en coin.
- Drag & drop avec ghost à 50% d'opacité ; conflit de créneau = contour `--danger` + refus.
- Ligne "maintenant" : trait `--ducati-red` 2px traversant.
- Vue jour (tablette atelier) : blocs 44px min de haut, boutons tactiles.

### 5.7 Fiche véhicule

- En-tête : photo 4:3 à gauche, puis "MULTISTRADA V4 S" en Ext Bd UPPERCASE, VIN en mono copiable (clic = copie + toast), badges statut.
- Onglets : Infos · Historique atelier · Documents · Photos · Comptabilité.
- Galerie photos : grille 4 colonnes, ratio 4:3, upload par glisser-déposer.

### 5.8 Modals, toasts, états

- **Modal** : max 560px (formulaires) / 880px (sélecteurs), titre H2, footer avec actions à droite (primaire en dernier). Overlay `rgba(26,26,26,.5)`. Confirmation destructrice : le bouton reprend le verbe exact ("Supprimer l'OR #2026-0412", pas "OK").
- **Toast** : coin bas-droit, fond `--ducati-black`, texte blanc, barre latérale couleur sémantique, auto-dismiss 5s, action "Annuler" quand pertinent.
- **État vide** : icône ligne 48px grise, phrase d'invitation + bouton primaire ("Aucun OR aujourd'hui — Planifier une intervention").
- **Chargement** : skeletons gris animés (pas de spinners plein écran). Squelette de tableau = lignes grises.
- **Erreur système** : bandeau `--danger-bg` en haut de la zone de travail, texte explicite + action de réessai.

### 5.9 Recherche globale (topbar)

Champ unique 320px, placeholder "VIN, client, réf. pièce, n° facture…", raccourci `Ctrl+K`. Résultats groupés par type avec icône, navigation clavier. Reconnaissance auto : 17 caractères alphanum = VIN, format BE0xxx = TVA.

---

## 6. Iconographie

- Bibliothèque : **Lucide** (trait 1.75px), taille 16px (inline) / 20px (nav) / 24px (touch).
- Couleur : héritée du texte. Jamais d'icônes multicolores.
- Icônes métier à créer dans le même style de trait : moto (profil), casque, pont élévateur, clé dynamométrique, pièce/engrenage, pneu.
- Le logo bouclier Ducati n'est **jamais** utilisé comme icône fonctionnelle — uniquement identité (topbar, login, documents).

---

## 7. Documents imprimables (facture, devis, OR, bon de livraison)

- A4, marges 18mm, **noir et rouge uniquement** (impression laser N&B fréquente : tout doit rester lisible sans le rouge).
- En-tête : logo Ducati Bruxelles à gauche, coordonnées + TVA à droite, filet rouge 2px sous l'en-tête.
- Titre document en Ext Bd UPPERCASE ("FACTURE", "ORDRE DE RÉPARATION") + numéro en mono.
- Tableaux : bordures fines noires, en-têtes fond `--gray-50`, montants tabular-nums alignés à droite, total TTC en XBd encadré.
- OR atelier : zone signature client, cases à cocher des points de contrôle, QR code de suivi en pied.
- Pied de page : mentions légales 8px, IBAN, conditions, pagination "1/2".

---

## 8. Accessibilité & règles d'or

- Contraste AA (4.5:1) minimum partout ; AAA visé sur la donnée des tableaux.
- Focus visible (ring 2px) sur tout élément interactif, navigation clavier complète des tableaux et du planning.
- Cibles tactiles ≥44px en mode atelier.
- `prefers-reduced-motion` respecté : transitions ≤150ms ease-out, aucune animation décorative.
- Jamais de rouge/vert seuls pour distinguer deux états : toujours icône + libellé.
- Langue : FR par défaut, prévoir NL (Bruxelles oblige) — labels courts, éviter les abréviations non standard.

## 9. Anti-patterns (à refuser explicitement)

- ❌ Fond rouge plein écran ou sidebar rouge.
- ❌ Dégradés, glassmorphism, ombres portées lourdes.
- ❌ Camemberts multicolores sur le dashboard.
- ❌ Ducati Style Ext en corps de texte ou dans les tableaux.
- ❌ Texte gris clair (`--gray-400`) pour de l'information utile.
- ❌ Border-radius > 8px (l'identité Ducati est anguleuse et technique).
- ❌ Emojis dans l'interface.
