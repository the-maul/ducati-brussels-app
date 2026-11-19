/**
 * M8 — OR au format ticket 80 mm (decision Q46 du 18/11/2026) et acompte de l'OR dans la liste /
 * l'impression (Q45). Regles pures : or-base/or-ticket.ts, or-base/rules.ts (exportGrid).
 * Execution : `bun test`.
 */
import { describe, expect, it } from 'bun:test';
import { buildOrTicket, shortVin, ticketDateTime } from '../src/modules/workshop/or-base/or-ticket';
import { exportGrid, OR_PRINT_FORMATS, type OrListRow } from '../src/modules/workshop/or-base/rules';
import { layoutReceipt, receiptColumns } from '../src/lib/devices/receipt';

const tr = (k: string) => `[${k}]`;
const input = {
  company: { name: 'ITALBIKE STORE', address: 'Chaussee de Waterloo 1, 1180 Uccle', phone: '02 000 00 00', vat: 'TVA BE0123456789' },
  or: { number: 'OR-2026-00012', receivedAt: '2026-11-18T09:30:00', promisedAt: '2026-11-20T17:00:00', mileage: 60000, workDescription: 'Entretien annuel + pneu arriere' },
  client: { name: 'Dupont Jean', phone: '+32 470 00 00 00' },
  vehicle: { model: 'Ducati DesertX', plate: '1-ABC-123', vin: 'ZDM1AB2C3D4E56789' },
  deposit: 150,
};
const text = (doc: ReturnType<typeof buildOrTicket>) =>
  layoutReceipt(doc.blocks, receiptColumns(80)).map((l) => (l.kind === 'text' ? l.text : `#${l.value}`)).join('\n');

describe('Q46 — ticket 80 mm', () => {
  it('largeur 80 mm, titre avec le n° d OR', () => {
    const d = buildOrTicket(input, tr);
    expect(d.widthMm).toBe(80);
    expect(d.title).toBe('[title] OR-2026-00012');
    expect(OR_PRINT_FORMATS).toEqual(['a4', 'ticket']);
  });
  it('contenu demande par le client', () => {
    const s = text(buildOrTicket(input, tr));
    for (const part of ['ITALBIKE STORE', 'Uccle', '02 000 00 00', 'OR-2026-00012', '18/11/2026 09:30', 'Dupont Jean', '+32 470 00 00 00',
      'Ducati DesertX', '1-ABC-123', '...E56789'.slice(0, 3), 'E56789', '60 000 km', 'Entretien annuel', '20/11/2026 17:00', '150,00 EUR']) {
      expect(s).toContain(part);
    }
    // code-barres du n° d'OR (scan a la pointeuse)
    expect(s).toContain('#OR-2026-00012');
  });
  it('aucune ligne ne depasse 48 colonnes (imprimante thermique 80 mm)', () => {
    for (const l of layoutReceipt(buildOrTicket(input, tr).blocks, 48)) if (l.kind === 'text') expect(l.text.length).toBeLessThanOrEqual(48);
  });
  it('sans acompte, sans client, sans moto : pas de ligne vide', () => {
    const s = text(buildOrTicket({ ...input, deposit: 0, client: null, vehicle: null, or: { ...input.or, promisedAt: null } }, tr));
    expect(s).not.toContain('[deposit]');
    expect(s).not.toContain('[client]');
    expect(s).not.toContain('[vehicle]');
    expect(s).not.toContain('[promisedAt]');
  });
  it('VIN abrege et dates', () => {
    expect(shortVin('ZDM1AB2C3D4E56789')).toBe('...D4E56789');
    expect(shortVin('ABC')).toBe('ABC');
    expect(shortVin(null)).toBe('');
    expect(ticketDateTime(null)).toBe('');
    expect(ticketDateTime('x')).toBe('');
  });
});

describe('Q45 — acompte dans l export de la liste des OR', () => {
  const row: OrListRow = {
    id: 'or1', number: 'OR-1', status: 'a_faire', warranty_status: 'aucune', repair_type: null, created_at: '2026-11-18T09:30:00Z',
    promised_at: null, operator: null, total_ttc: 300, mileage: 1000, expert_name: null, expert_date: null,
    client: 'X', vehicleRef: null, vehicleModel: null, plate: null, vin: null,
  };
  it('derniere colonne = acompte (les colonnes existantes gardent leur place)', () => {
    const g = exportGrid([row, { ...row, id: 'or2' }], { headers: ['h'], status: (s) => s, warranty: (w) => w, deposit: (id) => (id === 'or1' ? 150 : null) });
    expect(g[1][10]).toBe(300);
    expect(g[1][13]).toBe(150);
    expect(g[2][13]).toBe('');
  });
  it('sans fonction acompte : grille inchangee', () => {
    expect(exportGrid([row], { headers: ['h'], status: (s) => s, warranty: (w) => w })[1]).toHaveLength(13);
  });
});
