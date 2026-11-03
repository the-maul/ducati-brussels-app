/**
 * Tests M8 / M5 — mission 10, cartes 1 et 6 (ATE015, regle critique « reservations », regle 7) :
 *  - l'entretien choisi vient du motif (Annual / Oil / 1000), le reglage du motif prime ;
 *  - kit de l'entretien : annuel + huile = Annual + Oil, une piece une seule fois (pas de double huile) ;
 *  - quantites reservees face au stock, manque vers le panier (urgente / standard) ;
 *  - minimax declenche par la reservation (stock du minimax = reel - reserve - manque) ;
 *  - RDV annule : tout est libere ; facture de l'OR : une seule sortie, reservation consommee ;
 *  - statut affiche du bloc et avertissement du comptoir.
 * Memes regles que les fonctions SQL de supabase/migrations/20261103270000_m8_entretien_reservation.sql
 * (essai a blanc supabase/tests/m8_entretien_reservation.sql, 22 / 22 le 03/11/2026). Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  serviceCodeForReason, kitKindsFor, mergeServiceKits, serviceKindOf, pickServiceForCode, isServiceCode, SERVICE_TO_REASON,
} from '../src/modules/workshop/service-code';
import {
  planReservationLine, basketKindFor, minimaxStock, minimaxNeed, invoiceRelease, invoiceMoves, releaseAll, displayStatus,
  reservedSaleWarning,
} from '../src/modules/workshop/reservations/rules';
import { minimaxQty } from '../src/modules/purchases/basket';

describe("l'entretien choisi (carte 1)", () => {
  test('motif -> entretien du manuel', () => {
    expect(serviceCodeForReason('entretien_annuel')).toBe('annual');
    expect(serviceCodeForReason('entretien_annuel_huile')).toBe('oil');
    expect(serviceCodeForReason('entretien_1000')).toBe('first_1000');
    expect(serviceCodeForReason('pneus')).toBeNull();
    expect(serviceCodeForReason('vidange')).toBeNull();
    expect(serviceCodeForReason(null)).toBeNull();
  });
  test('anciens motifs retires (posters) gardent leur entretien pour les anciens OR', () => {
    expect(serviceCodeForReason('entretien_15000')).toBe('oil');
    expect(serviceCodeForReason('entretien_30000')).toBe('desmo');
  });
  test('le reglage du motif (Parametres -> Tables) prime ; une valeur inconnue est ignoree', () => {
    expect(serviceCodeForReason('autre', 'annual')).toBe('annual');
    expect(serviceCodeForReason('entretien_annuel', 'bidon')).toBe('annual');
  });
  test('entretien -> motif propose (espace client)', () => {
    expect(SERVICE_TO_REASON.oil).toBe('entretien_annuel_huile');
    expect(isServiceCode('first_1000')).toBe(true);
    expect(isServiceCode('15000_km')).toBe(false);
  });
  test('type d une echeance (manuel, plan, DCS)', () => {
    expect(serviceKindOf('Annual Service')).toBe('annual');
    expect(serviceKindOf('Oil Service')).toBe('oil');
    expect(serviceKindOf('Oil Service 1000km/600mi')).toBe('first_1000');
    expect(serviceKindOf('Desmo Service')).toBe('desmo');
    expect(serviceKindOf('Entretien', 15000)).toBe('oil');
    expect(serviceKindOf('Entretien', null, 12)).toBe('annual');
  });
  test('le parcours ouvre l echeance du meme type, la plus petite', () => {
    const svcs = [{ name: 'Oil Service 1000km', km: 1000 }, { name: 'Annual Service', months: 12 }, { name: 'Oil Service', km: 15000 }, { name: 'Oil Service', km: 45000 }];
    expect(pickServiceForCode(svcs, 'oil')?.km).toBe(15000);
    expect(pickServiceForCode(svcs, 'annual')?.name).toBe('Annual Service');
    expect(pickServiceForCode(svcs, 'first_1000')?.km).toBe(1000);
    expect(pickServiceForCode(svcs, 'desmo')).toBeNull();
  });
});

describe('choix du kit selon l entretien (M-109)', () => {
  const annual = [
    { articleId: 'filtre', reference: '44440312B', designation: 'Filtre a huile', quantity: 1 },
    { articleId: null, reference: null, familyCode: 'huile_moteur', designation: 'Huile moteur', quantity: 3.4 },
    { articleId: null, reference: null, familyCode: 'liquide_frein', designation: 'Liquide de frein', quantity: 1 },
  ];
  const oil = [
    { articleId: 'filtre', reference: '44440312B', designation: 'Filtre a huile', quantity: 1 },
    { articleId: null, reference: null, familyCode: 'huile_moteur', designation: 'Huile moteur', quantity: 3.4 },
    { articleId: 'bouchon', reference: 'B1', designation: 'Bouchon', quantity: 1 },
  ];
  test('kits a reunir', () => {
    expect(kitKindsFor('annual')).toEqual(['annual']);
    expect(kitKindsFor('oil')).toEqual(['annual', 'oil']);
    expect(kitKindsFor('first_1000')).toEqual(['first_1000']);
    expect(kitKindsFor(null)).toEqual([]);
  });
  test('annuel + huile = Annual + Oil sans double filtre ni double huile', () => {
    const merged = mergeServiceKits([annual, oil]);
    expect(merged.length).toBe(4);
    expect(merged.filter((m) => m.articleId === 'filtre').length).toBe(1);
    expect(merged.find((m) => m.familyCode === 'huile_moteur')?.quantity).toBe(3.4);
  });
  test('quand l Annual Service contient deja la vidange, les deux motifs donnent le meme kit', () => {
    const annualWithOil = [...annual, oil[2]];
    expect(mergeServiceKits([annualWithOil, oil])).toEqual(mergeServiceKits([annualWithOil]));
  });
  test('la plus grande quantite gagne', () => {
    const a = [{ articleId: 'x', reference: 'X', designation: 'X', quantity: 1 }];
    const b = [{ articleId: 'x', reference: 'X', designation: 'X', quantity: 2 }];
    expect(mergeServiceKits([a, b])[0].quantity).toBe(2);
  });
});

describe('quantites reservees (carte 6)', () => {
  test('stock suffisant : tout est reserve, rien au panier', () => {
    expect(planReservationLine({ needed: 1, stock: { real: 40, reserved: 0 } })).toEqual({ reserve: 1, move: 1, missing: 0, toBasket: 0 });
  });
  test('stock court : on reserve ce qui est la, le reste part au panier', () => {
    expect(planReservationLine({ needed: 2, stock: { real: 1, reserved: 0 } })).toEqual({ reserve: 1, move: 1, missing: 1, toBasket: 1 });
  });
  test('la reservation deja tenue compte comme disponible pour la ligne (pas de mouvement en double)', () => {
    expect(planReservationLine({ needed: 2, stock: { real: 1, reserved: 1 }, alreadyReserved: 1, alreadyOrdered: 1 }))
      .toEqual({ reserve: 1, move: 0, missing: 1, toBasket: 0 });
  });
  test('stock pris par d autres (site, RES) : rien de reserve, tout au panier', () => {
    expect(planReservationLine({ needed: 1, stock: { real: 2, reserved: 2 } })).toEqual({ reserve: 0, move: 0, missing: 1, toBasket: 1 });
  });
  test('piece arrivee : la ligne reserve ce qui manquait', () => {
    expect(planReservationLine({ needed: 2, stock: { real: 3, reserved: 1 }, alreadyReserved: 1, alreadyOrdered: 1 }))
      .toEqual({ reserve: 2, move: 1, missing: 0, toBasket: 0 });
  });
  test('panier du manque : urgente a moins de 5 jours ou si la moto est la', () => {
    expect(basketKindFor('2026-11-05T09:00:00', new Date('2026-11-03T12:00:00'), 5)).toBe('urgente');
    expect(basketKindFor('2026-11-13T09:00:00', new Date('2026-11-03T12:00:00'), 5)).toBe('standard');
    expect(basketKindFor(null)).toBe('urgente');
  });
});

describe('minimax declenche par la reservation (M-112)', () => {
  test('stock du minimax = reel - reserve - manque des RDV', () => {
    expect(minimaxStock({ real: 1, reserved: 1, workshopMissing: 1 })).toBe(-1);
  });
  test('la reservation fait passer sous le minimum : la piece entre au panier', () => {
    const s = minimaxStock({ real: 1, reserved: 1, workshopMissing: 1 });
    // 1 deja au panier (le manque du RDV) : 4 - (-1) - 1 = 4 ; au final 1 + 1 + 4 - 2 consommees = 4 = maximum
    expect(minimaxNeed({ stockMin: 2, stockMax: 4, minimaxStock: s, onOrder: 1 })).toBe(4);
  });
  test('au-dessus du minimum : rien', () => {
    expect(minimaxNeed({ stockMin: 2, stockMax: 4, minimaxStock: 3, onOrder: 0 })).toBe(0);
    expect(minimaxNeed({ stockMin: 0, stockMax: 4, minimaxStock: -5, onOrder: 0 })).toBe(0);
  });
  test('meme formule que le panier (minimaxQty) une fois le minimum franchi', () => {
    expect(minimaxNeed({ stockMin: 3, stockMax: 0, minimaxStock: 1, onOrder: 0 })).toBe(minimaxQty({ stockMin: 3, stockMax: 0, realQty: 1, onOrderQty: 0 }));
  });
});

describe('liberation et facture : jamais de double sortie (M-113)', () => {
  const rows = [{ articleId: 'filtre', reserved: 1 }, { articleId: 'bougie', reserved: 2 }];
  test('RDV annule : tout ce qui est tenu est libere', () => {
    expect(releaseAll(rows)).toEqual([{ articleId: 'filtre', liberation: -1 }, { articleId: 'bougie', liberation: -2 }]);
    expect(releaseAll([{ articleId: 'x', reserved: 0 }])).toEqual([]);
  });
  test('facture : consommee pour ce qui est facture, liberee sinon', () => {
    const r = invoiceRelease(rows, new Map([['filtre', 1]]));
    expect(r[0]).toEqual({ articleId: 'filtre', liberation: -1, consumed: 1, status: 'consommee', reason: 'facture' });
    expect(r[1]).toEqual({ articleId: 'bougie', liberation: -2, consumed: 0, status: 'liberee', reason: 'non_facturee' });
  });
  test('le reel ne bouge qu une fois (la facture), le reserve revient a zero', () => {
    const m = invoiceMoves([{ articleId: 'filtre', qty: 1 }], rows);
    expect(m.get('filtre')).toEqual({ real: -1, reserved: -1 });
    expect(m.get('bougie')).toEqual({ real: 0, reserved: -2 });
  });
});

describe('ecran : statut et avertissement du comptoir', () => {
  test('statut affiche du bloc Pieces reservees', () => {
    expect(displayStatus({ status: 'active', needed: 1, reserved: 1 })).toBe('reservee');
    expect(displayStatus({ status: 'active', needed: 2, reserved: 1, basketStatus: 'ouvert' })).toBe('a_commander');
    expect(displayStatus({ status: 'active', needed: 2, reserved: 1, basketStatus: 'commande' })).toBe('commandee');
    expect(displayStatus({ status: 'active', needed: 2, reserved: 1, basketStatus: 'recu' })).toBe('recue');
    expect(displayStatus({ status: 'consommee', needed: 1, reserved: 0 })).toBe('sortie');
    expect(displayStatus({ status: 'liberee', needed: 1, reserved: 0 })).toBe('liberee');
  });
  const resa = [{ holder: 'RDV 12/11/2026 09:00', contactName: 'DUPONT Jean', dueAt: '2026-11-12T08:00:00Z', qtyReserved: 1 }];
  test('vente couverte par le libre : pas d avertissement', () => {
    expect(reservedSaleWarning({ qty: 1, real: 40, reserved: 1, reservations: resa })).toBeNull();
  });
  test('vente qui mange la piece reservee : avertissement avec le RDV', () => {
    expect(reservedSaleWarning({ qty: 1, real: 1, reserved: 1, reservations: resa })?.[0].holder).toBe('RDV 12/11/2026 09:00');
  });
  test('reserve par autre chose que l atelier : pas d avertissement atelier', () => {
    expect(reservedSaleWarning({ qty: 1, real: 1, reserved: 1, reservations: [] })).toBeNull();
  });
});
