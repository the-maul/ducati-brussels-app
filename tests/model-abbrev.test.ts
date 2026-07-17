/**
 * Abréviation des modèles Ducati pour étiquettes (M3) — CLAUDE.md règle 7.
 * Les 10 exemples client font foi. Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { abbreviateBikeModel as ab } from '../src/modules/vehicles/model-abbrev';

test('10 exemples client (vérité terrain)', () => {
  expect(ab('Streetfighter V4 S')).toBe('SF V4 S');
  expect(ab('Multistrada V4 S')).toBe('MTS V4 S');
  expect(ab('Diavel V4')).toBe('DVL V4');
  expect(ab('Panigale V4 S')).toBe('PANI V4 S');
  expect(ab('Monster V2')).toBe('M V2');
  expect(ab('DesertX V2')).toBe('DSX V2');
  expect(ab('Scrambler 800 Icon')).toBe('SCR800 ICON');
  expect(ab('Scrambler Nightshift 2G')).toBe('SCR NS 2G');
  expect(ab('Monster 937 +')).toBe('M 937 +');
  expect(ab('Multistrada 1260 S')).toBe('MTS 1260 S');
});

test('marque Ducati retirée', () => {
  expect(ab('DUCATI STREETFIGHTER V4 S')).toBe('SF V4 S');
  expect(ab('Ducati Panigale V4 R')).toBe('PANI V4 R');
});

test('Scrambler + cylindrée collée', () => {
  expect(ab('DUCATI SCRAMBLER 1100 SPORT PRO')).toBe('SCR1100 SPORT PRO');
  expect(ab('Scrambler Icon Dark')).toBe('SCR ICON DARK');
  expect(ab('Scrambler Full Throttle')).toBe('SCR FT');
  expect(ab('Scrambler Desert Sled')).toBe('SCR DS');
});

test('gamme actuelle + vintage', () => {
  expect(ab('Multistrada V4 Pikes Peak')).toBe('MTS V4 PP');
  expect(ab('Panigale V4 SP2')).toBe('PANI V4 SP2');
  expect(ab('Hypermotard 698 Mono RVE')).toBe('HM 698 MONO RVE');
  expect(ab('DesertX Rally')).toBe('DSX RALLY');
  expect(ab('XDiavel S')).toBe('XDVL S');
  expect(ab('Monster 1200 25° Anniversario')).toBe('M 1200 25° ANNIVERSARIO');
  expect(ab('Multistrada 1260 Enduro')).toBe('MTS 1260 ENDURO');
});

test('couverture occasion / vintage (workflow)', () => {
  expect(ab('Desmosedici RR')).toBe('D16 RR');
  expect(ab('Paul Smart 1000 LE')).toBe('PS 1000 LE');
  expect(ab('Multistrada V4 Grand Tour')).toBe('MTS V4 GT');
  expect(ab('Scrambler Urban Motard')).toBe('SCR UM');
  expect(ab('Scrambler 1100 Sport')).toBe('SCR1100 SPORT');
  expect(ab('Panigale V4 Tricolore')).toBe('PANI V4 TRICOLORE');
  expect(ab('MH900e')).toBe('MH900E');
});

test('superbikes « cylindrée + famille » → famille abrégée', () => {
  expect(ab('1199 Panigale S')).toBe('1199 PANI S');
  expect(ab('1199 Panigale')).toBe('1199 PANI');
  expect(ab('959 Panigale')).toBe('959 PANI');
  expect(ab('899 Panigale')).toBe('899 PANI');
  expect(ab('1299 Superleggera')).toBe('1299 SL');
});

test('modèles dont le nom est un nombre SANS famille → tout gardé', () => {
  expect(ab('916')).toBe('916');
  expect(ab('999 R')).toBe('999 R');
  expect(ab('916 SPS')).toBe('916 SPS');
  expect(ab('888 SP2')).toBe('888 SP2');
  expect(ab('851 Strada')).toBe('851 STRADA');
  expect(ab('900 SS')).toBe('900 SS');
  expect(ab('ST4 S')).toBe('ST4 S');
});

test('robustesse : vide / null', () => {
  expect(ab('')).toBe('');
  expect(ab(null)).toBe('');
  expect(ab(undefined)).toBe('');
});
