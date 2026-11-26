/**
 * « La plaque suit le motard » (VEH001) : moto la plus récente d'un même motard, année lue dans le
 * VIN, même motard, anciennes plaques affichées. Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  bikeYear, compareBikeRecency, lastSaleDate, mostRecentBike, previousPlates, sameRider, vinModelYear,
  type BikeRecency, type PlateHistoryRow,
} from '../src/modules/vehicles/plate-history';

const MAX = 2027;
const bike = (p: Partial<BikeRecency> & { id: string }): BikeRecency => ({
  vin: null, modelYear: null, productionDate: null, riders: ['client'], riderInvoiceDate: null,
  anyInvoiceDate: null, ownerFrom: null, soldDate: null, ...p,
});

test('vinModelYear : 10e caractère des VIN Ducati, cycle de 30 ans', () => {
  expect(vinModelYear('ZDM1002BGSB001731', MAX)).toBe(2025);
  expect(vinModelYear('ZDMH200AAXB007684', MAX)).toBe(1999);
  expect(vinModelYear('ZDMM500AA9B026465', MAX)).toBe(2009);
  expect(vinModelYear('ZDM1003PPVB012122', MAX)).toBe(2027);
  expect(vinModelYear('VBKV79400MM939579', MAX)).toBeNull(); // pas un VIN Ducati
  expect(vinModelYear('ZDM600', MAX)).toBeNull();
});

test('bikeYear : model_year, puis année de production, puis VIN', () => {
  expect(bikeYear({ modelYear: 2020, productionDate: '2019-10-01', vin: 'ZDM1002BGSB001731' }, MAX)).toBe(2020);
  expect(bikeYear({ modelYear: null, productionDate: '2019-10-01', vin: 'ZDM1002BGSB001731' }, MAX)).toBe(2019);
  expect(bikeYear({ modelYear: null, productionDate: null, vin: 'ZDM1002BGSB001731' }, MAX)).toBe(2025);
});

test('sameRider : un propriétaire ou client financé en commun ; fiche sans propriétaire = aucun', () => {
  expect(sameRider({ riders: ['a', 'banque'] }, { riders: ['a'] })).toBe(true);
  expect(sameRider({ riders: ['a'] }, { riders: ['b'] })).toBe(false);
  expect(sameRider({ riders: [] }, { riders: ['a'] })).toBe(false);
});

test('lastSaleDate : facture au motard, sinon début du propriétaire ; sans propriétaire = pas de date', () => {
  expect(lastSaleDate(bike({ id: 'a', riderInvoiceDate: '2025-03-03', ownerFrom: '2024-01-01' }))).toBe('2025-03-03');
  expect(lastSaleDate(bike({ id: 'a', ownerFrom: '2024-01-01', soldDate: '2026-01-01' }))).toBe('2024-01-01');
  expect(lastSaleDate(bike({ id: 'a', ownerFrom: '2024-01-01', soldDate: '2026-01-01' }), 'large')).toBe('2026-01-01');
  expect(lastSaleDate(bike({ id: 'a', riders: [], soldDate: '2026-01-01' }))).toBeNull();
});

test('la dernière vente décide avant l\'année du modèle (moto d\'occasion achetée plus tard)', () => {
  const old = bike({ id: 'old', modelYear: 2022, riderInvoiceDate: '2022-04-12', anyInvoiceDate: '2022-04-12' });
  const used = bike({ id: 'used', modelYear: 2019, riderInvoiceDate: '2026-04-02', anyInvoiceDate: '2026-04-02' });
  expect(compareBikeRecency(used, old)).toBeGreaterThan(0);
  expect(mostRecentBike([old, used], MAX)?.id).toBe('used');
});

test('sans date de vente des deux côtés : l\'année du modèle décide', () => {
  const a = bike({ id: 'a', vin: 'ZDMM602FAFB013648' });
  const b = bike({ id: 'b', vin: 'ZDM1F02BGMB000764' });
  expect(mostRecentBike([a, b], MAX)?.id).toBe('b');
});

test('fiche sans propriétaire (reprise) : la moto vendue au client garde la plaque', () => {
  const reprise = bike({ id: 'ktm', riders: [], vin: 'VBKTU9406PM853441', soldDate: '2026-03-21' });
  const client = bike({ id: 'sf', modelYear: 2024, riderInvoiceDate: '2024-06-27', anyInvoiceDate: '2024-06-27' });
  expect(mostRecentBike([reprise, client], MAX)?.id).toBe('sf');
});

test('trois motos du même client : la plus récente seule garde la plaque', () => {
  const bikes = [
    bike({ id: 'm821', modelYear: 2019, ownerFrom: '2019-03-12' }),
    bike({ id: 'sf', modelYear: 2021, ownerFrom: '2021-05-01' }),
    bike({ id: 'mts', modelYear: 2025, ownerFrom: '2024-12-18' }),
  ];
  expect(mostRecentBike(bikes, MAX)?.id).toBe('mts');
});

test('dates contradictoires ou inconnues : on ne tranche pas (null)', () => {
  // La date de vente (revente d'une reprise ?) dit l'une, l'année dit l'autre.
  const monster = bike({ id: 'monster', vin: 'ZDMM502AA9B018417', soldDate: '2015-04-10' });
  const sf = bike({ id: 'sf', vin: 'ZDMF103AABB009253', ownerFrom: '2012-12-31', soldDate: '2013-06-12' });
  expect(mostRecentBike([monster, sf], MAX)).toBeNull();
  // Rien pour départager.
  expect(mostRecentBike([bike({ id: 'x', riders: [] }), bike({ id: 'y', riders: [] })], MAX)).toBeNull();
});

const hist = (p: Partial<PlateHistoryRow> & { id: string; plate: string }): PlateHistoryRow => ({
  from_date: null, to_date: null, is_current: false, reason: null, created_at: '2026-11-26T10:00:00Z', ...p,
});

test('previousPlates : sans la plaque en cours, la plus récente d\'abord, sans date en dernier', () => {
  const rows = [
    hist({ id: 'cur', plate: 'MAEA886', is_current: true }),
    hist({ id: 'a', plate: '1ABC123', to_date: '2018-03-15' }),
    hist({ id: 'b', plate: 'XYZ789' }),
    hist({ id: 'c', plate: '2DEF456', to_date: '2022-01-10' }),
  ];
  expect(previousPlates(rows, 'MAEA886').map((r) => r.id)).toEqual(['c', 'a', 'b']);
  expect(previousPlates([hist({ id: 'd', plate: 'MAEA886', to_date: '2025-03-03' })], 'maea886')).toEqual([]);
});
