/**
 * Chargeur des catalogues accessoires et vêtements Ducati (tools/accessories-loader, décision M-25).
 * Extraits au format réel de catalogue-ducati-accessoires.json (22/09). Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { num, prices, toProduct, toProducts, entries, treeIndex, attrValue, apparelIndex, gender } from '../tools/accessories-loader/transform.mjs';

const ENTRY = {
  list: {
    id: '12222', code: 'ACC010398', price: '65,16 €', priceWithVAT: '78,84 €', priceNum: 65.16,
    name: 'Grille de protection phare avant.', partRef: '97380182A', discountCode: 'I', lastChance: '0',
    imageUrl: 'https://e-catalog.ducati.com/x.th.jpg',
  },
  detail: {
    description: 'Ses mailles en acier réduisent le risque de rupture du phare.', priceNum: 0,
    imageUrl: 'https://e-catalog.ducati.com/EPCResources/GRAPHICS/immagini_pim/nullnull.th.null',
    imageAttributes: [{ accImage: { imagePath: 'i345', image448Path: 'i448', zoomImagePath: 'zoom', thumbPath: 'th90' } }],
    accessoryVariants: [
      { sku: '97380182A', descr: 'FILET FEU AVANT', price: '65,16 €', isKit: 1, isArchived: 0, isActive: 1, replaced: false,
        partDetails: { vatPrice: '78,84 €' },
        applicabilities: [{ hierarchyPath: '1/19882/19906/19910/19911' }, { hierarchyPath: '1/9/9/9/9' }],
        applicabilitiesText: [{ family: 'SCRAMBLER', superModel: '800', model: 'ICON', modelYear: '2015' },
          { family: 'X', superModel: 'Y', model: 'Z USA', modelYear: '2020' }] },
      { sku: '97380182A', descr: 'doublon' },
    ],
  },
};
const TREE = { paths: [{ path: '1/19882', label: 'SCRAMBLER' }, { path: '1/19882/19906/19910/19911', label: 'SCRAMBLER / 800 / ICON / 2015' }] };

describe('montants et prix', () => {
  test('lecture des montants', () => {
    expect(num('474,59 €')).toBe(474.59);
    expect(num('1.234,50')).toBe(1234.5);
    expect(num(12.5)).toBe(12.5);
    expect(num('-')).toBeNull();
  });
  test('HT = price, TTC = priceWithVAT / vatPrice ; TTC calculé à 21 % s\'il manque', () => {
    expect(prices(ENTRY.list)).toEqual({ priceHt: 65.16, priceTtc: 78.84 });
    expect(prices(ENTRY.detail.accessoryVariants[0])).toEqual({ priceHt: 65.16, priceTtc: 78.84 });
    expect(prices({ priceNum: 100 })).toEqual({ priceHt: 100, priceTtc: 121 });
    expect(prices({ priceNum: 0 })).toEqual({ priceHt: null, priceTtc: null });
  });
});

describe('produits (format réel)', () => {
  test('accessoire : variante, prix, images, motos compatibles traduites par l\'arbre', () => {
    const p = toProduct(ENTRY, 'accessory', { tree: treeIndex(TREE), isEurope: (m: string) => !/USA/.test(m) });
    expect(p.code).toBe('ACC010398');
    expect(p.variants).toHaveLength(1);
    const v = p.variants[0];
    expect([v.sku, v.priceHt, v.priceTtc, v.isKit, v.description]).toEqual(['97380182A', 65.16, 78.84, true, 'FILET FEU AVANT']);
    expect(v.applicabilities[0]).toEqual({ path: '1/19882/19906/19910/19911', family: 'SCRAMBLER', superModel: '800', model: 'ICON', modelYear: 2015, isEurope: true });
    expect(v.applicabilities[1].isEurope).toBe(false);
    expect(p.images[0]).toEqual({ url: 'i448', zoom: 'zoom', thumb: 'th90' });
    expect(p.imageUrl).toBe('th90');
  });
  test('vêtement : taille et couleur lues dans les attributs de la variante', () => {
    const attrs = [{ attributeCode: 'APP_TAGLIA', attributeValueList: [{ attributeValueDesc: 'XL' }] },
      { attributeCode: 'APP_COLOR', attributeValueList: [{ attributeValueDesc: 'Noir' }] }];
    expect(attrValue(attrs, ['APP_TAGLIA'])).toBe('XL');
    const p = toProduct({ list: { code: 'APP1', name: 'Blouson', price: '300,00 €' },
      detail: { accessoryVariants: [{ sku: '981041354', accessoryAttributes: attrs }, { sku: '981041356', size: '56' }] } }, 'apparel');
    expect(p.variants.map((v: { sku: string; size: string; color: string | null }) => [v.sku, v.size, v.color]))
      .toEqual([['981041354', 'XL', 'Noir'], ['981041356', '56', null]]);
    expect(p.variants[0].priceTtc).toBe(363);
  });
  test('sans variante : la référence du produit est vendable ; enveloppes et doublons', () => {
    const json = { items: [
      { list: { code: 'A1', partRef: '111111111' } },
      { list: { code: 'A1', partRef: '111111111' }, detail: { accessoryVariants: [{ sku: '222222222' }] } },
      { list: {} },
    ] };
    expect(entries(json)).toHaveLength(3);
    const r = toProducts(json, 'accessory');
    expect(r.products).toHaveLength(1);
    expect(r.variants).toBe(2);
    expect(r.skipped).toBe(1);
    expect([...r.skus]).toEqual(['111111111', '222222222']);
  });
});

describe('vêtements (catalogue-ducati-vetements.json du 23/09)', () => {
  const TREE = {
    cats: [{ path: '0/402', description: 'PERFORMANCE WEAR', categories: [{ path: '0/402/404', description: 'Cuir', categories: null }] }],
    genders: ['Uomo'],
    families: [{ code: 'PAN', description: 'PANIGALE' }, { code: 'M', description: 'MONSTER' }],
    appl: [['APP003088', { categoryPath: '0' }], ['APP003088', { categoryPath: '0/402/404', gender: 'Uomo' }],
      ['APP003088', { applicabilityPath: 'PAN' }], ['APP003088', { applicabilityPath: 'M', discontinued: true }]],
  };
  const ENTRY = {
    list: { id: '65408', code: 'APP003088', name: 'Ducati Corse C7', price: '1 351,64 €', priceWithVAT: '1 635,48 €', imageUrl: 'https://x/y.th.jpg' },
    detail: {
      description: 'Combinaison une pièce racing',
      variants: [
        { sku: '981091746', price: '1 351,64 €', partDetails: { vatPrice: '1 635,48 €', partStatus: 'F' }, isArchived: 0, disabled: true,
          attributes: [{ attributeCode: 'APP_TAGLIA', attributeValueList: [{ attributeValue: '46' }] },
            { attributeCode: 'APP_VERSIONE', attributeValueList: [{ attributeValueDesc: 'perforé' }] },
            { attributeCode: 'APP_COLLECTIONYEAR', attributeValueList: [{ attributeValue: '2026' }] }] },
        { sku: '981091748', price: '-', partDetails: { vatPrice: '-' }, isArchived: 1,
          attributes: [{ attributeCode: 'APP_TAGLIA_CASCHI', attributeValueList: [{ attributeValue: 'XL' }] }] },
      ],
    },
  };
  test('genre traduit', () => {
    expect(gender('Uomo')).toBe('Homme');
    expect(gender('Donna')).toBe('Femme');
    expect(gender('Bambino')).toBe('Enfant');
    expect(gender('Unisex')).toBe('Unisexe');
    expect(gender(null)).toBeNull();
  });
  test('arbre : catégorie la plus précise, genre, familles de motos', () => {
    const info = apparelIndex(TREE).get('APP003088');
    expect(info.categoryPath).toBe('0/402/404');
    expect(info.categoryLabel).toBe('PERFORMANCE WEAR / Cuir');
    expect(info.gender).toBe('Homme');
    expect(info.familyCodes).toEqual(['PANIGALE', 'MONSTER']);
    expect(info.discontinued).toBe(true);
  });
  test('une référence par taille, prix HT et TTC, version et statut gardés', () => {
    const p = toProduct(ENTRY, 'apparel', { info: apparelIndex(TREE) });
    expect(p.categoryLabel).toBe('PERFORMANCE WEAR / Cuir');
    expect(p.gender).toBe('Homme');
    expect(p.familyCodes).toEqual(['PANIGALE', 'MONSTER']);
    expect(p.variants).toHaveLength(2);
    const [a, b] = p.variants;
    expect([a.sku, a.size, a.priceHt, a.priceTtc, a.collectionYear]).toEqual(['981091746', '46', 1351.64, 1635.48, 2026]);
    expect(a.attributes).toEqual({ version: 'perforé', partStatus: 'F', disabled: true });
    expect(a.archived).toBe(false);
    // taille de casque, prix repris du produit faute de prix propre, archivée (plus d'article créé pour elle)
    expect([b.sku, b.size, b.priceHt, b.archived]).toEqual(['981091748', 'XL', 1351.64, true]);
  });
  test('compteurs : références distinctes et références encore au catalogue', () => {
    const r = toProducts([ENTRY], 'apparel', { info: apparelIndex(TREE) });
    expect(r.variants).toBe(2);
    expect([...r.skus]).toEqual(['981091746', '981091748']);
    expect([...r.live]).toEqual(['981091746']);
  });
});
