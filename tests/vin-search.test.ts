import { describe, expect, test } from 'bun:test';
import { parseVinQuery, vinLikePattern, vinMatchesQuery } from '../src/lib/vin-search';

const VIN = 'ZDMM502AA9B018417';
const hit = (term: string, vin = VIN) => {
  const q = parseVinQuery(term);
  return !!q && vinMatchesQuery(vin, q);
};

describe('Recherche par n° de châssis', () => {
  test('sans étoile : le VIN commence par', () => {
    expect(hit('ZDMM50')).toBe(true);
    expect(hit('zdmm50')).toBe(true);
    expect(hit('018417')).toBe(false);
  });
  test('*chiffres : dans les 6 derniers', () => {
    expect(hit('*018417')).toBe(true);
    expect(hit('*0184')).toBe(true);
    expect(hit('*8417')).toBe(true);
    expect(hit('*502')).toBe(false);
  });
  test('*chiffres* : contient', () => {
    expect(hit('*502AA*')).toBe(true);
    expect(hit('*0184*')).toBe(true);
    expect(hit('*999*')).toBe(false);
  });
  test('moins de 2 caractères utiles : pas de recherche', () => {
    expect(parseVinQuery('')).toBeNull();
    expect(parseVinQuery('*')).toBeNull();
    expect(parseVinQuery('*1')).toBeNull();
  });
  test('filtre envoyé à la base', () => {
    expect(vinLikePattern(parseVinQuery('ZDM')!)).toBe('ZDM%');
    expect(vinLikePattern(parseVinQuery('*123')!)).toBe('%123%');
    expect(vinLikePattern(parseVinQuery('*123*')!)).toBe('%123%');
  });
});
