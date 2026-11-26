import { describe, expect, it } from 'bun:test';
import { repriseFillPatch, repriseVehicleChoice } from '../src/modules/tradein/reprise-vehicle-rules';

describe('reprise sur une moto deja connue (un VIN = une fiche)', () => {
  it('cree une fiche seulement si le VIN est inconnu', () => {
    expect(repriseVehicleChoice([])).toEqual({ kind: 'create' });
  });
  it('reprend la fiche d une moto vendue au client', () => {
    expect(repriseVehicleChoice([{ id: 'g8', status: 'vendu', openReprise: false }])).toEqual({ kind: 'reuse', id: 'g8' });
  });
  it('prend la plus ancienne fiche quand il y a deja un doublon', () => {
    expect(repriseVehicleChoice([
      { id: 'rep', status: 'repris', created_at: '2026-07-31', openReprise: false },
      { id: 'g8', status: 'vendu', created_at: '2026-06-12', openReprise: false },
    ])).toEqual({ kind: 'reuse', id: 'g8' });
  });
  it('refuse une moto encore au magasin ou deja en reprise', () => {
    expect(repriseVehicleChoice([{ id: 'a', status: 'stock_vo', openReprise: false }])).toEqual({ kind: 'refuse', status: 'stock_vo', id: 'a' });
    expect(repriseVehicleChoice([{ id: 'b', status: 'repris', openReprise: true }])).toEqual({ kind: 'refuse', status: 'repris', id: 'b' });
  });
  it('ne remplit que les champs vides, et le km seulement s il monte', () => {
    const cur = { brand: 'DUCATI', color: 'DARK', engine_number: null, mileage: 16014 };
    expect(repriseFillPatch(cur, { brand: 'Ducati', color: null, engine_number: 'ZDM821W4', mileage: 17798 }))
      .toEqual({ engine_number: 'ZDM821W4', mileage: 17798 });
    expect(repriseFillPatch(cur, { mileage: 9000 })).toEqual({});
  });
});
