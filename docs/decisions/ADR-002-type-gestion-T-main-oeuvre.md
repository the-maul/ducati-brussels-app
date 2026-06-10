# ADR-002 — Ajout du type de gestion « T » (Main d'œuvre)

- **Statut** : Accepté
- **Date** : 2026-06-10
- **Exigences liées** : B1 (types de gestion), ATE015 (pointage MO), M2 Articles, M8 Atelier
- **Module(s)** : M2 (Articles), impacte M6 (POS) et M8 (Atelier)

## Contexte
Le glossaire CLAUDE.md (§2, B1) liste les types de gestion d'article **A/M/F/N/V/O/P/D/R**.
L'extraction des manuels G8 (`docs/g8-reference-extract.md`, manuel Fichiers p.27) révèle un type
supplémentaire **`T` = Main d'œuvre** : en G8 la main d'œuvre est un **article** (une référence par
taux horaire / par mécanicien, ex. `MOC`/`MOM`), saisie en quantité décimale (1h15 = 1.25), réutilisée
au comptoir (POS) et sur les ordres de réparation (OR). Le client connaît et utilise ce modèle.

## Décision
**On ajoute `T` à l'enum `article_mgmt_type`** → A/M/F/N/V/O/P/D/R/**T**. La main d'œuvre est modélisée
comme un article de type T (fidèle à G8), réutilisable au POS et sur les OR de l'atelier.

## Conséquences
- `CLAUDE.md` §2 (tableau des types de gestion) et l'Annexe B/B1 doivent mentionner **T — Main d'œuvre**.
- Les écrans qui filtrent par type (articles, POS, OR) doivent gérer T (pas de stock, quantité décimale,
  pas de PAMP — c'est un taux horaire avec un PA = coût et un PV = taux facturé).
- Le rapprochement « temps passé vs temps facturé » (B11, M8) s'appuiera sur ces lignes T.
- Migration : `ALTER TYPE article_mgmt_type ADD VALUE 'T'` (idempotent, ne pas réutiliser la valeur dans
  la même transaction).
