import { afterEach, describe, expect, test } from 'bun:test';
import { dcsFinish, dcsRunning, dcsStart, onDcsTimeout } from '../src/lib/dcs-progress';

const VIN = 'ZDMAA01FAGB099999';

describe('Chargement pendant la lecture DCS', () => {
  afterEach(() => { for (const v of [...dcsRunning()]) dcsFinish(v); });

  test('démarre puis s\'arrête au retour du DCS', () => {
    dcsStart(VIN);
    expect(dcsRunning()).toEqual([VIN]);
    dcsFinish(VIN.toLowerCase());
    expect(dcsRunning()).toEqual([]);
  });
  test('une même moto ne compte qu\'une fois', () => {
    dcsStart(VIN);
    dcsStart(VIN);
    expect(dcsRunning()).toEqual([VIN]);
  });
  test('sans réponse, le chargement s\'arrête et le signale', async () => {
    const seen: string[] = [];
    const off = onDcsTimeout((v) => seen.push(v));
    dcsStart(VIN, 5);
    await new Promise((r) => setTimeout(r, 25));
    off();
    expect(dcsRunning()).toEqual([]);
    expect(seen).toEqual([VIN]);
  });
  test('une réponse reçue annule le délai', async () => {
    const seen: string[] = [];
    const off = onDcsTimeout((v) => seen.push(v));
    dcsStart(VIN, 5);
    dcsFinish(VIN);
    await new Promise((r) => setTimeout(r, 25));
    off();
    expect(seen).toEqual([]);
  });
});
