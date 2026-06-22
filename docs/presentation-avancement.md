# DMS Ducati Bruxelles — État d'avancement de l'implémentation

> Document de présentation client — **mise à jour 2026-06-12**.
> Légende : ✅ **Fait & testé** · 🟡 **Partiel / à finaliser** · 🔑 **En attente d'une clé/donnée client**.
> Tout est déployé sur la base réelle ; démo en direct sur l'application.

---

## 1. Vue d'ensemble

Le DMS remplace **G8 / Futurosoft**. Les **14 modules ont un cœur fonctionnel réel** (pas de maquette),
en architecture **append-only** (traçabilité totale), **multi-société** (ITALBIKE STORE + NL INVEST) avec
sécurité par société (RLS). La **reprise des données G8 est faite** (clients à ré-exporter), et la
**conformité belge** (TVA marge, Peppol/UBL, SEPA, clôture) est en place.

**Chiffres de la reprise (données réelles importées) :**
- **101** fournisseurs · **3 299** véhicules (parc) · **17 808** factures historiques
- **716** factures 2026 avec **détail des lignes** (3 895 lignes) extrait des PDF
- **716** PDF de factures d'origine **consultables** dans l'app
- Logo Ducati Bruxelles + facture générée **au format de la concession**

---

## 2. Statut par module

| Module | État | Ce qui est démontrable |
|---|---|---|
| **M0 — Socle / Paramètres** | ✅ | Login, multi-société, rôles + RLS, audit append-only, séquences de numérotation configurables, gestion utilisateurs, sociétés (TVA/IBAN/Peppol) |
| **M1 — Contacts** | ✅ | Fiche client parité G8, recherche, encours crédit, types, **tarifs clients** (remise %/coefficient/paliers) |
| **M2 — Articles & tarifs** | ✅ | Référentiel A–R/T, code-barres, PAMP, casiers, import tarifs, **prix tracés append-only** (B7), modif en cascade |
| **M3 — Véhicules & parc** | ✅ | Fiche VIN parité G8, parc (3 299 repris), statuts, historique propriétaires, alerte stock dormant |
| **M4 — Achats & réceptions** | ✅ 🔑 | Fournisseurs (101 repris), réception→stock+PAMP, châssis→véhicule · 🔑 **format DCS Ducati** (gabarit Excel attendu) |
| **M5 — Stock & inventaire** | ✅ | Triple stock, mouvements append-only, **3 modes d'inventaire** (dont casier), inventaire tournant, copies datées auto (15/fin de mois), étiquetage différé |
| **M6 — Ventes & POS / Caisse** | ✅ | Devis→facture, avoirs, encaissement multi-modes, clôture Z · **facture PDF au format Ducati Bruxelles** (logo, bandeau, code-barres) |
| **M7 — Reprise / Occasion / Dépôt** | ✅ | Flux reprise→occasion+véhicule+ORO, marge par VIN, **dépôt-vente + commission**, **TVA sur marge (VO)** |
| **M8 — Atelier & SAV** | ✅ | OR (cycle complet), garantie (refus partiel), chronos/productivité, planning + taux de charge, checklist opérations, tâches hors-facturation |
| **M9 — Documents / GED** | ✅ 🟡 | Pièces jointes (photos/PDF), **716 factures d'origine attachées**, CGV au verso · 🟡 signature électronique (capacité posée, UI à finir), portails client |
| **M10 — CRM & marketing** | ✅ 🔑 | **Fiches lead style Pipedrive** (édition, notes/activités, documents, suppression), pipeline · 🔑 envois e-mail/SMS réels (infra prête, clés Resend/SMS attendues) |
| **M11 — Site web & e-shop** | ✅ 🔑 | Site builder, vitrine publique, **paiement Stripe bouclé** (commande→payée→facture→stock) · 🔑 clé `whsec` live pour la prod |
| **M12 — Compta & exports** | ✅ 🔑 | Plan PCMN, **moteur d'écritures équilibrées**, registre TVA, **TVA marge VO + registre + attestation**, **SEPA pain.008**, **clôture d'exercice**, **date de bascule comptable** · 🔑 transmission Falco/Peppol + gabarit Winbooks exact |
| **M13 — Reporting** | ✅ | Tableau de bord (KPIs réels), **stats avancées** (CA/marge par marque/rayon/article/client/opérateur/mois, comparaison N-1, taux de transformation) |
| **M14 — Migration G8** | ✅ 🔑 | Import xlsx (clients/fournisseurs/véhicules/factures) + **détail lignes & PDF depuis les factures** · 🔑 **ré-export clients** (l'export fourni était vide) |

---

## 3. Conformité au droit belge

| Exigence | État |
|---|---|
| Plan comptable **PCMN** (400/440/451/70/60…) | ✅ paramétrable |
| **TVA marge VO** (art. 58 §4) : calcul sur (PV−PA), registre, attestation TRAXIO | ✅ |
| **e-Facturation Peppol / UBL** (obligatoire 2026) | 🟡 UBL généré · 🔑 transmission Falco |
| **Domiciliation SEPA (pain.008)** + impayés | ✅ |
| **Clôture d'exercice** archivante + éditions pré-clôture | ✅ |
| **Date de bascule comptable** (reprise sans re-déclarer l'historique) | ✅ |
| Multi-société + numérotation par société | ✅ |

---

## 4. Invariants métier (B1–B12)

✅ **B1** types A–R/T · ✅ **B2** TVA marge + registre · ✅ **B3** flux reprise→ORO · ✅ **B4** triple stock + copies datées ·
✅ **B5** PAMP · ✅ **B6** 3 modes d'inventaire · ✅ **B7** append-only stock **et prix** · ✅ **B8** cycle OR ·
✅ **B9** n° de série · ✅ **B10** garantie (refus partiel) · 🟡 **B11** productivité atelier · ✅ **B12** étiquetage.

---

## 5. Ce qui reste (dépend du client)

🔑 **À fournir pour activer le live :**
1. **Ré-export Clients** (l'export reçu était vide) → relie automatiquement les 17 808 factures aux fiches clients.
2. **Stripe** : clé webhook `whsec` de production (le test fonctionne déjà de bout en bout).
3. **Falco / Peppol** : identifiants API → transmission réelle des factures UBL.
4. **DCS Ducati** : gabarit Excel STANDARD/URGENTE exact.
5. **Resend + SMS** : clés → les confirmations/relances/rappels partent réellement (l'infra est prête).
6. **Winbooks** : un fichier d'import exemple du comptable → calage des colonnes exactes.

---

## 6. Parcours de démo recommandés

1. **Multi-société & recherche** : bascule ITALBIKE/NL INVEST · recherche globale (VIN, client, n° facture).
2. **Vente comptoir** (Caisse) : scan → panier → encaissement → ticket.
3. **Facture** : ouvrir une facture 2026 → **lignes détaillées + PDF d'origine** → **Imprimer** (format Ducati Bruxelles avec logo).
4. **Reprise occasion** : reprise → occasion + véhicule + ORO → marge par VIN → **attestation TVA marge**.
5. **Atelier** : OR → garantie → planning/charge.
6. **Comptabilité** : journal des ventes (cliquable), **registre TVA**, **générer les écritures**, **registre VO**, **SEPA**, **clôture**, **date de bascule**.
7. **Reporting** : tableau de bord + **stats** (CA/marge par opérateur, comparaison N-1).
8. **CRM** : pipeline → ouvrir une fiche lead (édition, notes, documents).
9. **E-shop** : vitrine publique + commande + paiement (Stripe test).

> **Honnêteté de présentation** : montrer ce qui est ✅ en confiance ; pour les 🔑, expliquer « prêt, en attente de votre clé/donnée » — ne pas cliquer un envoi réel (e-mail/Falco/DCS) tant que les clés ne sont pas posées.
