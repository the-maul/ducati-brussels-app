/**
 * M8 — Rattrapage G8 « OR de base » (18/11/2026) : regles pures de src/modules/workshop/or-base/rules.ts.
 * Statuts G8, 30 points V / R, kilometrage obligatoire + controle « inferieur au dernier releve »,
 * filtres de la liste (vues, recherche, periode, pagination), export, impression, rappel SMS du RDV.
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  OR_EDIT_STATUSES, OR_ALL_STATUSES, OR_WORKABLE_STATUSES, orStatusTone, editableStatus, canNotifyReady, isOrStatus,
  CHECK_POINTS, normalizeCheckPoints, toggleCheckPoint, countCheckPoints,
  lastReading, parseMileage, checkMileage, mileageAck,
  viewFilter, sanitizeSearch, searchFilter, combineOrFilters, pageRange, pageCount, periodBounds, exportGrid, formatOrDate,
  printParts, printLines, printFileName, reminderSmsTo, isOrListView,
  type MileageReading, type OrListRow,
} from '../src/modules/workshop/or-base/rules';

describe('statuts G8', () => {
  test('les six statuts G8 dans l\'ordre, + facture / annule poses par le DMS', () => {
    expect([...OR_EDIT_STATUSES]).toEqual(['a_faire', 'attente_devis', 'attente_pieces', 'en_cours', 'pret', 'client_informe']);
    expect(OR_ALL_STATUSES).toContain('facture');
    expect(OR_ALL_STATUSES).toContain('annule');
    expect(isOrStatus('attente_pieces')).toBe(true);
    expect(isOrStatus('termine')).toBe(false);
  });
  test('un OR facture ou annule ne se choisit pas a l\'ecran (repli « a faire », comme avant)', () => {
    expect(editableStatus('facture')).toBe('a_faire');
    expect(editableStatus('annule')).toBe('a_faire');
    expect(editableStatus(null)).toBe('a_faire');
    expect(editableStatus('client_informe')).toBe('client_informe');
  });
  test('couleurs : attente = avertissement, pret / client informe = info, facture = succes', () => {
    expect(orStatusTone('attente_devis')).toBe('warning');
    expect(orStatusTone('attente_pieces')).toBe('warning');
    expect(orStatusTone('pret')).toBe('info');
    expect(orStatusTone('client_informe')).toBe('info');
    expect(orStatusTone('facture')).toBe('success');
    expect(orStatusTone('annule')).toBe('neutral');
  });
  test('la pointeuse accepte les OR en attente de devis / pieces, pas un OR pret ou facture', () => {
    expect(OR_WORKABLE_STATUSES).toContain('attente_pieces');
    expect(OR_WORKABLE_STATUSES).not.toContain('pret');
    expect(OR_WORKABLE_STATUSES).not.toContain('facture');
  });
  test('« prevenir le client » seulement pour un OR pret avec un client', () => {
    expect(canNotifyReady({ status: 'pret', hasContact: true })).toBe(true);
    expect(canNotifyReady({ status: 'pret', hasContact: false })).toBe(false);
    expect(canNotifyReady({ status: 'en_cours', hasContact: true })).toBe(false);
  });
});

describe('30 points a verifier (V) / a remplacer (R)', () => {
  test('30 points, sans doublon', () => {
    expect(CHECK_POINTS.length).toBe(30);
    expect(new Set(CHECK_POINTS).size).toBe(30);
  });
  test('relecture : codes connus et marques V / R seulement', () => {
    expect(normalizeCheckPoints({ huile_moteur: 'V', liquide_frein: 'R', bidon: 'V', bougie: 'X' })).toEqual({ huile_moteur: 'V', liquide_frein: 'R' });
    expect(normalizeCheckPoints(null)).toEqual({});
    expect(normalizeCheckPoints(['V'])).toEqual({});
  });
  test('recliquer sur la meme marque l\'enleve, l\'autre marque la remplace', () => {
    let cp = toggleCheckPoint({}, 'huile_moteur', 'V');
    expect(cp).toEqual({ huile_moteur: 'V' });
    cp = toggleCheckPoint(cp, 'huile_moteur', 'R');
    expect(cp).toEqual({ huile_moteur: 'R' });
    cp = toggleCheckPoint(cp, 'huile_moteur', 'R');
    expect(cp).toEqual({});
  });
  test('compte', () => {
    expect(countCheckPoints({ huile_moteur: 'V', bougie: 'V', liquide_frein: 'R' })).toEqual({ v: 2, r: 1 });
  });
});

describe('kilometrage (G8 : obligatoire, avertissement bloquant si inferieur)', () => {
  const readings: MileageReading[] = [
    { km: 12000, at: '2026-03-01', source: 'or', ref: 'OR-1', orId: 'or1' },
    { km: 15000, at: '2026-09-01', source: 'or', ref: 'OR-2', orId: 'or2' },
    { km: 14000, at: '2026-10-01', source: 'vehicle' },
    { km: 0, at: '2026-11-01', source: 'declared' },
  ];
  test('dernier releve = le plus grand km connu (un compteur ne recule pas)', () => {
    expect(lastReading(readings)?.km).toBe(15000);
    expect(lastReading(readings)?.ref).toBe('OR-2');
  });
  test('le releve de l\'OR en cours ne compte pas', () => {
    expect(lastReading(readings, 'or2')?.km).toBe(14000);
  });
  test('OR deja enregistre : seuls les releves anterieurs a l\'OR comptent', () => {
    expect(lastReading(readings, 'or1', '2026-03-01T10:00:00Z')).toBeNull();
    expect(lastReading(readings, null, '2026-09-15')?.km).toBe(15000);
  });
  test('aucun releve', () => {
    expect(lastReading([])).toBeNull();
  });
  test('saisie lue en entier (espaces, points de milliers)', () => {
    expect(parseMileage('12 500')).toBe(12500);
    expect(parseMileage('12.500')).toBe(12500);
    expect(parseMileage('')).toBeNull();
    expect(parseMileage('abc')).toBeNull();
    expect(parseMileage('-5')).toBeNull();
  });
  test('obligatoire des qu\'une moto est choisie', () => {
    expect(checkMileage({ input: '', hasVehicle: true, last: null })).toEqual({ kind: 'required' });
    expect(checkMileage({ input: '', hasVehicle: false, last: null })).toEqual({ kind: 'ok', km: null });
    expect(checkMileage({ input: 'x', hasVehicle: true, last: null })).toEqual({ kind: 'invalid' });
  });
  test('inferieur au dernier releve : bloque tant que ce n\'est pas confirme', () => {
    const last = lastReading(readings);
    const r = checkMileage({ input: '14500', hasVehicle: true, last });
    expect(r.kind).toBe('lower');
    expect(checkMileage({ input: '14500', hasVehicle: true, last, confirmed: true })).toEqual({ kind: 'ok', km: 14500 });
    expect(checkMileage({ input: '15000', hasVehicle: true, last })).toEqual({ kind: 'ok', km: 15000 });
    expect(checkMileage({ input: '16000', hasVehicle: true, last })).toEqual({ kind: 'ok', km: 16000 });
  });
  test('trace du releve depasse gardee seulement si le km est inferieur', () => {
    const last = lastReading(readings);
    expect(mileageAck(14500, last)).toBe(15000);
    expect(mileageAck(16000, last)).toBeNull();
    expect(mileageAck(null, last)).toBeNull();
  });
});

describe('liste des OR', () => {
  test('vues G8 : OR (tout), devis, garantie, accident', () => {
    expect(isOrListView('garantie')).toBe(true);
    expect(isOrListView('x')).toBe(false);
    expect(viewFilter('or')).toBeNull();
    expect(viewFilter('devis')).toBe('status.eq.attente_devis,customer_approval.eq.en_attente');
    expect(viewFilter('devis', false)).toBe('status.eq.attente_devis');
    expect(viewFilter('garantie')).toBe('warranty_status.neq.aucune,repair_type.like.garantie*');
    expect(viewFilter('accident')).toBe('repair_type.eq.accident,reason_code.eq.accident,expert_name.not.is.null');
  });
  test('recherche : n° d\'OR, clients et motos trouves', () => {
    expect(searchFilter('  ', [], [])).toBeNull();
    expect(searchFilter('OR-12', [], [])).toBe('number.ilike.*OR-12*');
    expect(searchFilter('dupont', ['c1', 'c2'], ['v1'])).toBe('number.ilike.*dupont*,contact_id.in.(c1,c2),vehicle_id.in.(v1)');
  });
  test('caracteres qui cassent un filtre PostgREST retires', () => {
    expect(sanitizeSearch('a,b(c)%*d')).toBe('a b c d');
  });
  test('vue ET recherche dans un seul filtre « ou »', () => {
    expect(combineOrFilters('a.eq.1,b.eq.2', 'c.eq.3')).toBe('and(or(a.eq.1,b.eq.2),or(c.eq.3))');
    expect(combineOrFilters(null, 'c.eq.3')).toBe('c.eq.3');
    expect(combineOrFilters(null, null)).toBeNull();
  });
  test('pagination au-dela de 100 (50 par page)', () => {
    expect(pageRange(1)).toEqual({ from: 0, to: 49 });
    expect(pageRange(3)).toEqual({ from: 100, to: 149 });
    expect(pageRange(0)).toEqual({ from: 0, to: 49 });
    expect(pageCount(0)).toBe(1);
    expect(pageCount(101)).toBe(3);
  });
  test('periode : fin de journee incluse', () => {
    expect(periodBounds('2026-11-01', '2026-11-30')).toEqual({ gte: '2026-11-01', lt: '2026-12-01' });
    expect(periodBounds('', 'x')).toEqual({ gte: null, lt: null });
  });
  test('export Excel : en-tete + une ligne par OR, montant en nombre', () => {
    const row: OrListRow = {
      id: '1', number: 'OR-2026-00012', status: 'pret', warranty_status: 'aucune', repair_type: null, created_at: '2026-11-18T09:30:00Z',
      promised_at: null, operator: 'Jeremy', total_ttc: 115.2, mileage: 60000, expert_name: null, expert_date: null,
      client: 'Dupont Jean', vehicleRef: 'DESERTX', vehicleModel: 'Ducati DesertX', plate: '1-ABC-123', vin: 'ZDM00000000000001',
    };
    const g = exportGrid([row], { headers: ['h'], status: (s) => `S:${s}`, warranty: (w) => `W:${w}` });
    expect(g[0]).toEqual(['h']);
    expect(g[1][0]).toBe('OR-2026-00012');
    const d = new Date('2026-11-18T09:30:00Z');
    const p2 = (n: number) => String(n).padStart(2, '0');
    expect(g[1][6]).toBe(`${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`);
    expect(g[1][10]).toBe(115.2);
    expect(g[1][11]).toBe('S:pret');
    expect(g[1][12]).toBe('');
  });
  test('dates au format belge', () => {
    expect(formatOrDate('2026-11-18')).toBe('18/11/2026');
    expect(formatOrDate(null)).toBe('');
  });
});

describe('impression OR / fiche de travail', () => {
  test('trois types G8', () => {
    expect(printParts('or')).toEqual({ or: true, fiche: false });
    expect(printParts('fiche')).toEqual({ or: false, fiche: true });
    expect(printParts('both')).toEqual({ or: true, fiche: true });
  });
  const lines = [
    { kind: 'piece', designation: 'Filtre a huile', quantity: 1, unit_price_ht: 10, vat_rate: 21, discount_pct: 0, is_warranty: false },
    { kind: 'mo', designation: 'MO atelier', quantity: 1.5, unit_price_ht: 63.47, vat_rate: 21, discount_pct: 0, is_warranty: false },
    { kind: 'piece', designation: 'Piece garantie', quantity: 1, unit_price_ht: 50, vat_rate: 21, discount_pct: 0, is_warranty: true },
    { kind: 'texte', designation: 'Note', quantity: 0, unit_price_ht: 0, vat_rate: 21, discount_pct: 0, is_warranty: false },
    { kind: 'mo', designation: 'Carte OK', quantity: 1, unit_price_ht: 60, vat_rate: 21, discount_pct: 0, is_warranty: false, checkup_state: 'ok' },
    { kind: 'mo', designation: 'Carte reportee', quantity: 1, unit_price_ht: 60, vat_rate: 21, discount_pct: 0, is_warranty: false, checkup_state: 'reporte' },
  ];
  test('edition chiffree : PU et total TTC, garantie a 0, check-up OK / reporte exclus', () => {
    const r = printLines(lines, true);
    expect(r.map((l) => l.designation)).toEqual(['Filtre a huile', 'MO atelier', 'Piece garantie', 'Note']);
    expect(r[0].unitTtc).toBe(12.1);
    expect(r[1].totalTtc).toBe(115.2);
    expect(r[2].totalTtc).toBe(0);
    expect(r[2].warranty).toBe(true);
    expect(r[3].unitTtc).toBeNull();
  });
  test('sans prix : aucun montant', () => {
    expect(printLines(lines, false).every((l) => l.unitTtc === null && l.totalTtc === null)).toBe(true);
  });
  test('nom du fichier', () => {
    expect(printFileName('OR-2026-00012', 'or')).toBe('OR_OR-2026-00012.pdf');
    expect(printFileName('OR-2026-00012', 'fiche')).toBe('OR_OR-2026-00012_FICHE.pdf');
    expect(printFileName(null, 'both')).toBe('OR_OR_OR-FICHE.pdf');
  });
});

describe('rappel de RDV : le SMS respecte la case du RDV (bug corrige)', () => {
  test('case decochee : pas de SMS, meme avec un portable', () => {
    expect(reminderSmsTo({ notify_sms: false, mobile: '0470000000' })).toBeNull();
  });
  test('case cochee : portable, sinon telephone', () => {
    expect(reminderSmsTo({ notify_sms: true, mobile: '0470000000', phone: '021111111' })).toBe('0470000000');
    expect(reminderSmsTo({ notify_sms: true, mobile: ' ', phone: '021111111' })).toBe('021111111');
    expect(reminderSmsTo({ notify_sms: true })).toBeNull();
  });
});
