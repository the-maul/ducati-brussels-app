/**
 * Rattrapage G8 (18/11/2026, lot parc) — affichette moto / article : balises, remplissage,
 * lignes vides, pagination 1 ou 2 par page. Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  fillLine, fillTemplate, unknownTags, paginate, canonicalTag, vehiclePosterData, articlePosterData, defaultPosterBody,
} from '../src/modules/vehicles/poster-rules';

const moto = vehiclePosterData({
  reference: 'DESERTX', brand: 'DUCATI', model: 'DesertX', vin: 'ZDM1234567890ABCD', display_price: 16590, mileage: 12345,
  first_registration_date: '2024-03-15', displacement: 937, power_kw: 81, color: 'Star White Silk', police_book_number: 'LP-2026-0012',
  warranty_type: 'PIECES ET MO', warranty_months: 24,
}, { shopName: 'ITALBIKE STORE', monthsLabel: 'mois' });

describe('balises', () => {
  test('les balises G8 sont remplacees, montants et dates au format belge', () => {
    expect(fillLine('[MARQUE] [MODELE] - [PRIXTTC]', moto).text).toBe('DUCATI DesertX - 16 590,00 €');
    expect(fillLine('Km : [KILOMETRAGE]', moto).text).toBe('Km : 12 345 km');
    expect(fillLine('MEC [MISEENCIRCULATION]', moto).text).toBe('MEC 15/03/2024');
    expect(fillLine('[CYLINDREE]', moto).text).toBe('937 cm3');
  });
  test('[N° LIVRE DE POLICE] ecrit a la G8 = NUMLIVREPOLICE', () => {
    expect(canonicalTag('n° livre de police')).toBe('NUMLIVREPOLICE');
    expect(fillLine('LP [N° LIVRE DE POLICE]', moto).text).toBe('LP LP-2026-0012');
  });
  test('garantie : type + duree', () => {
    expect(fillLine('[GARANTIE]', moto).text).toBe('PIECES ET MO - 24 mois');
  });
  test('prix HT deduit du TTC (21 %), absent pour une occasion en TVA marge', () => {
    expect(fillLine('[PRIXHT]', moto).text).toBe('13 710,74 €');
    const occ = vehiclePosterData({ display_price: 7000 }, { marge: true });
    expect(fillLine('[PRIXHT]', occ).empty).toBe(true);
  });
  test('balise inconnue signalee (faute de frappe)', () => {
    expect(unknownTags('[MODELE] [PRIXTCC] [N° LIVRE DE POLICE]', 'vehicle')).toEqual(['PRIXTCC']);
    expect(unknownTags('[DESIGNATION] [MODELE]', 'article')).toEqual(['MODELE']);
  });
});

describe('modele rempli', () => {
  test('styles (# titre, ## sous-titre, > prix) et lignes sans donnee retirees', () => {
    const body = ['## [MARQUE]', '# [MODELE]', '', 'Plaque : [IMMATRICULATION]', '> [PRIXTTC]', ''].join('\n');
    expect(fillTemplate(body, moto)).toEqual([
      { style: 'subtitle', text: 'DUCATI' },
      { style: 'title', text: 'DesertX' },
      { style: 'text', text: '' },
      { style: 'price', text: '16 590,00 €' },
    ]);
  });
  test('le modele propose d\'office se remplit sans balise inconnue', () => {
    const L = { firstRegistration: 'Mise en circulation', mileage: 'Km', displacement: 'Cylindree', color: 'Couleur', warranty: 'Garantie', reference: 'Ref.', policeBook: 'Livre de police' };
    expect(unknownTags(defaultPosterBody('vehicle', L), 'vehicle')).toEqual([]);
    expect(unknownTags(defaultPosterBody('article', L), 'article')).toEqual([]);
    const lines = fillTemplate(defaultPosterBody('vehicle', L), moto);
    expect(lines.find((l) => l.style === 'price')?.text).toBe('16 590,00 €');
    expect(lines.at(-1)?.text).toBe('ITALBIKE STORE');
  });
  test('affichette article', () => {
    const a = articlePosterData({ reference: '96781234', designation: 'Casque Ducati', brand: 'DUCATI', sale_price_ttc: 450, vat_rate: 21, barcode: '8012345678901' });
    expect(fillLine('[DESIGNATION] [PRIXTTC] [CODEBARRE]', a).text).toBe('Casque Ducati 450,00 € 8012345678901');
  });
});

describe('1 ou 2 affichettes par page', () => {
  test('5 motos : 5 pages a 1, 3 pages a 2', () => {
    const items = [1, 2, 3, 4, 5];
    expect(paginate(items, 1).length).toBe(5);
    expect(paginate(items, 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
