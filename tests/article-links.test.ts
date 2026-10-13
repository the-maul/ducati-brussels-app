/**
 * « Article DMS = pivot » (décision M-25) — normalisation des références et score des candidats.
 * Miroir des règles de la fonction SQL article_links_refresh (migration 20260921200000).
 * Exemples tirés des données réelles du 21/09. Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  normRef, refBase, revisionCandidate, isUsedPart, isCopiedProduct, titleRefTokens,
  candidateScore, initialStatus, scoreTone, classifyShopifyForCreation, isProposedForCreation, METHOD_SCORE,
  normDesignation, designationRatio, firstToken, priceGap, bundleQualifies, pickSharedSkuVariant,
} from '../src/modules/articles/links-rules';
import { activeNavTo, mainNav } from '../src/lib/navigation';

describe('normalisation (même clé que la base : majuscules, A-Z0-9)', () => {
  test('ponctuation, espaces et casse ignorés', () => {
    expect(normRef(' 852.502.41a ')).toBe('85250241A');
    expect(normRef('96780-591-A')).toBe('96780591A');
    expect(normRef('979000215/2')).toBe('9790002152');
    expect(normRef(null)).toBe('');
  });
});

describe('indice de révision', () => {
  test('numéro de pièce sans ses 1 à 3 lettres finales', () => {
    expect(refBase('48018871AA')).toBe('48018871');
    expect(refBase('4801C181AA')).toBe('4801C181');
    expect(refBase('44440031C')).toBe('44440031');
    expect(refBase('981090260')).toBeNull();
    expect(refBase('SEED-A-0050')).toBeNull();
  });
  test('une seule référence Ducati avec le même numéro : candidat', () => {
    expect(revisionCandidate('44440031A', ['44440031C', '12345678A'])).toBe('44440031C');
    expect(revisionCandidate('71614901A', ['71614901AA'])).toBe('71614901AA');
  });
  test('plusieurs références (couleurs, langues) : pas de candidat', () => {
    expect(revisionCandidate('48210181HA', ['48210181RA', '48210181LA', '48210181SA'])).toBeNull();
  });
  test('notices 913… (lettre = langue) exclues', () => {
    expect(revisionCandidate('91373081H', ['91373081A'])).toBeNull();
  });
  test('déjà dans le catalogue ou numéro trop court : pas de candidat', () => {
    expect(revisionCandidate('44440031C', ['44440031C'])).toBeNull();
    expect(revisionCandidate('123456A', ['123456B'])).toBeNull();
  });
});

describe('Shopify : occasion, copies, références dans le titre', () => {
  test('pièce d\'occasion reconnue par le SKU ou le titre', () => {
    expect(isUsedPart('48019275BAOCC')).toBe(true);
    expect(isUsedPart('48321551AAOCCN2')).toBe(true);
    expect(isUsedPart('', '56411331AT - GARDE-BOUE AVANT VERT (occ.)')).toBe(true);
    expect(isUsedPart('96780591A', '96780591A - Selle à assise surbaissée')).toBe(false);
    expect(isUsedPart('', 'Protection de soccer')).toBe(false);
  });
  test('produit copié', () => {
    expect(isCopiedProduct('(Copie) 4601R291AA- Protection-Main Cauche')).toBe(true);
    expect(isCopiedProduct('Copie de 65440031A -  CONTROLE GAZ')).toBe(true);
    expect(isCopiedProduct('96880121A- Selle basse')).toBe(false);
  });
  test('références extraites du titre (7 à 12 caractères, commence par un chiffre, hors OCC)', () => {
    expect(titleRefTokens('48114251AB- COUPOLE ROUGE | PANI V2 2020-25', 'Default Title')).toEqual(['48114251AB']);
    expect(titleRefTokens('Downtown C2', '41 - 981040341')).toEqual(['981040341']);
    expect(titleRefTokens('48032302AOCC- CAR.INF.DRT')).toEqual([]);
    expect(titleRefTokens('Panigale V4 S (2020)')).toEqual([]);
  });
});

describe('score et statut des méthodes', () => {
  test('seules les correspondances exactes sont reliées d\'office (W-6)', () => {
    expect(initialStatus('ref_exacte')).toBe('lie');
    expect(initialStatus('sku_exact')).toBe('lie');
    expect(initialStatus('code_barres')).toBe('lie');
    for (const m of ['sku_normalise', 'code_barres_ref', 'ref_dans_titre', 'remplacement_dms', 'prefixe_suffixe', 'revision'] as const) {
      expect(initialStatus(m)).toBe('a_valider');
    }
  });
  test('scores identiques à la base, du plus sûr au moins sûr', () => {
    expect(candidateScore('ref_exacte')).toBe(100);
    expect(candidateScore('sku_normalise')).toBe(90);
    expect(candidateScore('code_barres_ref')).toBe(85);
    expect(candidateScore('ref_dans_titre')).toBe(80);
    expect(candidateScore('ref_dans_titre', { copy: true })).toBe(60);
    expect(candidateScore('remplacement_dms', { kind: 'shopify_variant' })).toBe(70);
    expect(candidateScore('remplacement_dms', { kind: 'ducati_part' })).toBe(60);
    expect(candidateScore('prefixe_suffixe')).toBe(40);
    expect(candidateScore('revision')).toBe(50);
    // une lettre = indice de révision ; deux lettres = souvent une couleur
    expect(candidateScore('revision', { articleRef: '14823071A', catalogRef: '14823071C' })).toBe(50);
    expect(candidateScore('revision', { articleRef: '69812692AK', catalogRef: '69812692AA' })).toBe(35);
    expect(candidateScore('revision', { articleRef: '4601C312AA', catalogRef: '4601C312A' })).toBe(35);
    const candidates = Object.entries(METHOD_SCORE).filter(([m]) => initialStatus(m as never) === 'a_valider');
    for (const [, s] of candidates) expect(s).toBeLessThan(100);
  });
  test('ton du badge', () => {
    expect(scoreTone(100)).toBe('success');
    expect(scoreTone(80)).toBe('info');
    expect(scoreTone(50)).toBe('warning');
  });
});

describe('aperçu « créer les articles manquants »', () => {
  test('familles', () => {
    expect(classifyShopifyForCreation({ sku: '981090260' })).toBe('vetement_98');
    expect(classifyShopifyForCreation({ sku: '96180381A' })).toBe('accessoire_96_97');
    expect(classifyShopifyForCreation({ sku: '48019275BAOCC' })).toBe('occasion');
    expect(classifyShopifyForCreation({ sku: '46011462A', inDucatiParts: true })).toBe('piece_ducati');
    expect(classifyShopifyForCreation({ sku: '981090260', inDucatiProducts: true })).toBe('accessoire_vetement_ducati');
    expect(classifyShopifyForCreation({ sku: '', price: 18990 })).toBe('moto');
    expect(classifyShopifyForCreation({ sku: 'X', productType: "Moto d'occasion" })).toBe('moto');
    expect(classifyShopifyForCreation({ sku: '', price: 49 })).toBe('sans_reference');
    expect(classifyShopifyForCreation({ sku: 'PT526B' })).toBe('autre_reference');
  });
  test('motos et produits sans référence ne sont pas proposés', () => {
    expect(isProposedForCreation('moto')).toBe(false);
    expect(isProposedForCreation('sans_reference')).toBe(false);
    expect(isProposedForCreation('vetement_98')).toBe(true);
    expect(isProposedForCreation('occasion')).toBe(true);
  });
});

describe('menu : un seul catalogue, Rapprochements comme outil', () => {
  test('ni « Catalogue Ducati » ni « Produits Shopify » dans le menu ; Rapprochements sous Pièces & Accessoires', () => {
    const i = mainNav.findIndex((n) => n.to === '/parts');
    expect(mainNav.some((n) => n.to === '/parts/catalog' || n.to === '/parts/shopify')).toBe(false);
    expect(mainNav[i + 1].to).toBe('/parts/links');
    expect(mainNav[i + 1].child).toBe(true);
  });
  test("l'entrée la plus précise est active", () => {
    expect(activeNavTo('/parts/links', mainNav)).toBe('/parts/links');
    expect(activeNavTo('/parts/shopify', mainNav)).toBe('/parts');
    expect(activeNavTo('/parts/abc', mainNav)).toBe('/parts');
  });
});

describe("faisceau d'indices : decision automatique sans validation humaine (23/09)", () => {
  test('designation normalisee : accents, casse et ponctuation ignores', () => {
    expect(normDesignation('Rétroviseur DROIT  (alu)')).toBe('RETROVISEUR DROIT ALU');
    expect(normDesignation(null)).toBe('');
  });

  test('part des mots de la designation retrouves dans le titre du site', () => {
    expect(designationRatio('GARDE-BOUE AVANT ROUGE', '56410772AA - GARDE BOUE AVANT ROUGE | MTS1200')).toBe(1);
    expect(designationRatio('Support moteur.', '97180961AB - SUPPORT MOTEUR NOIR | MONSTER 937')).toBe(1);
    expect(designationRatio('NUMBER PLATE HOLDER-CREAMID', '56113651A -')).toBe(0);
  });

  test('premier mot du titre : les boutiques prefixent par la reference', () => {
    expect(firstToken('46010383A -  PROTECTION PIED DROIT | 1000/400/900')).toBe('46010383A');
    expect(firstToken('Sac Souple Top Case - 96792210B')).toBe('SAC');
    expect(firstToken(null)).toBe('');
  });

  test('ecart de prix relatif', () => {
    expect(priceGap(176.78, 176.78)).toBe(0);
    expect(priceGap(304.21, 295.35)).toBeCloseTo(0.03, 2);
    expect(priceGap(null, 10)).toBeNull();
  });

  test("etalon de Simon : SKU exact, meme designation, meme prix -> relie d'office", () => {
    expect(bundleQualifies({
      articleRef: '46010383A', designation: 'PROTECTION PIED DROIT', salePriceTtc: 176.78,
      sku: '46010383A', productTitle: '46010383A -  PROTECTION PIED DROIT | 1000/400/900/S4/620',
      variantTitle: 'Default Title', shopPrice: 176.78,
    })).toBe(true);
  });

  test("reference en tete du titre, sans SKU, designation retrouvee -> relie d'office", () => {
    expect(bundleQualifies({
      articleRef: '56410772AA', designation: 'GARDE-BOUE AVANT ROUGE', salePriceTtc: 202.21,
      sku: null, productTitle: '56410772AA - GARDE BOUE AVANT ROUGE | MTS1200', shopPrice: 100,
    })).toBe(true);
  });

  test('titre sans designation et prix trop loin -> laisse a une personne', () => {
    expect(bundleQualifies({
      articleRef: '56113651A', designation: 'NUMBER PLATE HOLDER-CREAMID', salePriceTtc: 50.53,
      sku: null, productTitle: '56113651A -', shopPrice: 162.25,
    })).toBe(false);
  });

  test("un SKU qui designe un autre article l'emporte : on ne devine pas", () => {
    expect(bundleQualifies({
      articleRef: '59510601D', designation: 'SELLE', salePriceTtc: 159.33,
      sku: '969A08503B', productTitle: '59510601D - Selle origine', shopPrice: 203.97,
      skuOfAnotherArticle: true,
    })).toBe(false);
  });

  test('SKU partage : on prend le seul produit ACTIF, jamais deux actifs', () => {
    const brouillon = { variantId: 'v1', shopStatus: 'DRAFT' };
    const actif = { variantId: 'v2', shopStatus: 'ACTIVE' };
    expect(pickSharedSkuVariant([actif])).toBe(actif);
    expect(pickSharedSkuVariant([brouillon, actif])).toBe(actif);
    expect(pickSharedSkuVariant([actif, { variantId: 'v3', shopStatus: 'ACTIVE' }])).toBeNull();
    expect(pickSharedSkuVariant([brouillon, { variantId: 'v4', shopStatus: 'ARCHIVED' }])).toBeNull();
    expect(pickSharedSkuVariant([])).toBeNull();
  });
});
