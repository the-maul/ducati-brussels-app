/**
 * Tests M8 — ATE014 (Simon, 26/11/2026) : le parcours n'affiche que les operations A ECHEANCE.
 * Donnees : contexte reel de l'OR-2026-00003 (Monster 1100 S 2009, entretien annuel + vidange,
 * plan monster696_796_1100_08_14 ; facture G8 du 10/04/2015 de la moto), tel que le renvoie
 * workshop_periodic_due_context (essai a blanc du 26/11).
 */
import { test, expect, describe } from 'bun:test';
import {
  applyDueRule, evidenceMatches, filterKitByDue, isAutoSettled, isNotDueSettled, lastDoneFor, notDueNote, periodicDue,
  signatureOf, verdictFor, NOT_DUE_NOTE_PREFIX, type DueContext, type DueEvidence,
} from '../src/modules/workshop/plan-ops/due-rules';
import { ABSENT_ON_BIKE_NOTE, isAbsentOnBike } from '../src/modules/workshop/exploded/operation-presence';

const inv = (text: string, date = '2015-04-10', ref = 'FAC 20150292'): DueEvidence => ({ source: 'invoice_line', date, km: null, ref, text, kinds: [] });
const COURROIES = 'Remplacement courroies distribution';
const FREINS = 'Vidange huile de freins et d’embrayage (si présent)';
const REFROID = 'Vidange liquide de refroidissement (si présent)';

const or00003: DueContext = {
  now_date: '2026-11-03', now_km: 125000, start_date: null, start_source: null,
  periodic: [
    { text: COURROIES, forced: false, families: ['courroie_distribution'], covered_by: ['desmo'], periodicity_months: 60 },
    { text: FREINS, forced: false, families: [], covered_by: [], periodicity_months: 24 },
    { text: REFROID, forced: false, families: [], covered_by: ['desmo'], periodicity_months: 48 },
  ],
  evidence: [
    inv('PLAQUETTE DE FREIN ARRIERE BREMBO'), inv('5 HUILE DE FREIN DOT 5.1'), inv('FILTRE A HUILE'),
    inv('RESERVOIR LIQUIDE FREINS'), inv('RESERVOIR HUILE EMBRAYAGE'), inv('COURROIE DENTEE COMMANDE DISTRIBUTION'), inv('BOUGIE'),
  ],
};

const op = (id: string, label: string, extra: Partial<{ status: string; not_done_note: string | null; due_forced: boolean; source: string }> = {}) =>
  ({ id, label, status: 'a_faire', source: 'plan', not_done_note: null, due_forced: false, ...extra });

describe('signatures : ce qui prouve qu\'une operation a ete faite', () => {
  test('courroies : la courroie dentee de la facture G8, pas le galet', () => {
    const sig = signatureOf(COURROIES)!;
    expect(sig.id).toBe('courroies_distribution');
    expect(evidenceMatches(sig, 'COURROIE DENTEE COMMANDE DISTRIBUTION')).toBe(true);
    expect(evidenceMatches(sig, 'GALET TENDEUR COURROIE DISTRIBUTION')).toBe(false);
  });
  test('liquide de frein : le bidon DOT, pas le reservoir', () => {
    const sig = signatureOf(FREINS)!;
    expect(sig.id).toBe('liquide_frein');
    expect(evidenceMatches(sig, '5 HUILE DE FREIN DOT 5.1')).toBe(true);
    expect(evidenceMatches(sig, 'RESERVOIR LIQUIDE FREINS')).toBe(false);
    expect(evidenceMatches(sig, 'PLAQUETTE DE FREIN ARRIERE BREMBO')).toBe(false);
  });
});

describe('OR-2026-00003 : derniere fois d\'apres l\'historique de la moto', () => {
  test('courroies : changees le 10/04/2015 (facture G8) → 60 mois depasses → a echeance', () => {
    const v = verdictFor(or00003, COURROIES)!;
    expect(v.state).toBe('due');
    expect(v.last?.date).toBe('2015-04-10');
    expect(v.last?.ref).toBe('FAC 20150292');
  });
  test('liquide de frein : DOT 5.1 du 10/04/2015 → a echeance', () => {
    expect(verdictFor(or00003, FREINS)!.state).toBe('due');
  });
  test('liquide de refroidissement : aucune trace, pas de date de depart → a verifier (affichee)', () => {
    const v = verdictFor(or00003, REFROID)!;
    expect(v.state).toBe('unknown');
    expect(v.basis).toBe('none');
  });
  test('operations de 12 mois (filtre a air, plaquettes...) : pas concernees', () => {
    expect(verdictFor(or00003, 'Contrôle et nettoyage du filtre à air')).toBeNull();
  });
  test('rien n\'est masque sur cet OR : les trois restent, avec leur etat', () => {
    const ops = [op('a', COURROIES), op('b', FREINS), op('c', REFROID), op('d', 'Contrôle de la pression et de l\'usure des pneus')];
    const r = applyDueRule(ops, or00003);
    expect(r.visible.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(r.hidden).toEqual([]);
    expect(r.info.get('a')?.state).toBe('due');
    expect(r.info.get('c')?.state).toBe('unknown');
    expect(r.info.has('d')).toBe(false);
  });
});

describe('pas a echeance : masquee, reglee une fois, reversible', () => {
  const recent: DueContext = { ...or00003, evidence: [...or00003.evidence, inv('KIT COURROIES DISTRIBUTION', '2024-03-15', 'FAC 2024-00123')] };
  test('courroies changees en 03/2024 → pas a echeance en 11/2026, masquee et a regler', () => {
    const r = applyDueRule([op('a', COURROIES), op('b', FREINS)], recent);
    expect(r.visible.map((o) => o.id)).toEqual(['b']);
    expect(r.hidden.map((h) => h.op.id)).toEqual(['a']);
    expect(r.toSettle[0].note).toBe(`${NOT_DUE_NOTE_PREFIX} (dernière fois : 15/03/2024, FAC 2024-00123 ; prochaine : 15/03/2029)`);
  });
  test('deja reglee « pas a echeance » : reste masquee, rien a regler ; ni facture ni impression', () => {
    const settled = op('a', COURROIES, { status: 'non_fait', not_done_note: 'Pas à échéance (dernière fois : 15/03/2024)' });
    const r = applyDueRule([settled], recent);
    expect(r.visible).toEqual([]);
    expect(r.toSettle).toEqual([]);
    expect(isNotDueSettled(settled)).toBe(true);
    expect(isAutoSettled(settled)).toBe(true);
    expect(isAutoSettled({ status: 'non_fait', not_done_note: ABSENT_ON_BIKE_NOTE })).toBe(true);
    expect(isAbsentOnBike(settled)).toBe(false);
    expect(isAutoSettled({ status: 'non_fait', not_done_note: 'Refus du client' })).toBe(false);
  });
  test('« Faire quand meme » (due_forced) : affichee', () => {
    const r = applyDueRule([op('a', COURROIES, { due_forced: true })], recent);
    expect(r.visible.map((o) => o.id)).toEqual(['a']);
    expect(r.toSettle).toEqual([]);
  });
  test('pieces de l\'operation deja sur l\'OR : affichee (coherence operations / pieces)', () => {
    expect(applyDueRule([op('a', COURROIES)], recent, new Set(['a'])).visible.map((o) => o.id)).toEqual(['a']);
  });
  test('operation deja cochee ou marquee non faite par le mecanicien : affichee', () => {
    expect(applyDueRule([op('a', COURROIES, { status: 'fait' })], recent).visible).toHaveLength(1);
    expect(applyDueRule([op('a', COURROIES, { status: 'non_fait', not_done_note: 'client pressé' })], recent).visible).toHaveLength(1);
  });
  test('service choisi qui la fait d\'office (forced) : toujours affichee', () => {
    const desmo: DueContext = { ...recent, periodic: recent.periodic.map((p) => (p.text === COURROIES ? { ...p, forced: true } : p)) };
    expect(verdictFor(desmo, COURROIES)).toBeNull();
    expect(applyDueRule([op('a', COURROIES)], desmo).visible).toHaveLength(1);
  });
  test('operation d\'un manuel (source manuel) : jamais filtree', () => {
    expect(applyDueRule([op('a', COURROIES, { source: 'manuel' })], recent).visible).toHaveLength(1);
  });
});

describe('autres sources de l\'historique', () => {
  test('Desmo Service DCS en 2023 → courroies et refroidissement faits d\'office', () => {
    const ev: DueEvidence[] = [{ source: 'dcs', date: '2023-06-01', km: 30000, ref: 'DCS Desmo Service', text: 'Desmo Service', kinds: ['desmo'] }];
    const ctx: DueContext = { ...or00003, evidence: ev };
    expect(lastDoneFor(ctx.periodic[0], ev)?.date).toBe('2023-06-01');
    expect(verdictFor(ctx, COURROIES)!.state).toBe('not_due');
    expect(verdictFor(ctx, REFROID)!.state).toBe('not_due');
    expect(verdictFor(ctx, FREINS)!.state).toBe('unknown');
  });
  test('operation cochee sur un autre OR de la moto', () => {
    const ev: DueEvidence[] = [{ source: 'or_op', date: '2025-11-10', km: 20000, ref: 'OR OR-2025-00042', text: FREINS, kinds: [] }];
    expect(verdictFor({ ...or00003, evidence: ev }, FREINS)!.state).toBe('not_due');
  });
  test('la plus recente gagne', () => {
    const ev = [inv('HUILE DE FREIN DOT 4', '2019-01-01'), inv('HUILE DE FREIN DOT 4', '2025-09-01', 'FAC 2025-1')];
    expect(lastDoneFor(or00003.periodic[1], ev)?.ref).toBe('FAC 2025-1');
  });
});

describe('periodicDue : date, km, depart', () => {
  test('24 mois : faite le 10/12/2024 → due au 26/11/2026 (tolerance), pas au 20/11/2025', () => {
    expect(periodicDue({ months: 24 }, { date: '2026-11-26', km: null }, { date: '2024-12-10' }, null).state).toBe('due');
    expect(periodicDue({ months: 24 }, { date: '2025-11-20', km: null }, { date: '2024-12-10' }, null).state).toBe('not_due');
  });
  test('jamais vue, moto mise en circulation il y a 2 ans : premiere echeance des courroies pas atteinte', () => {
    const v = periodicDue({ months: 60 }, { date: '2026-11-26', km: 9000 }, null, '2024-10-01');
    expect(v).toMatchObject({ state: 'not_due', basis: 'start', nextDate: '2029-10-01' });
    expect(notDueNote(v, 'mise_en_circulation')).toBe('Pas à échéance (première échéance : 01/10/2029, depuis la mise en circulation)');
  });
  test('jamais vue, premiere echeance depassee : a verifier', () => {
    expect(periodicDue({ months: 48 }, { date: '2026-11-26', km: null }, null, '2019-03-01').state).toBe('unknown');
  });
  test('km : due des que le km est atteint, meme avant la date', () => {
    expect(periodicDue({ months: 60, km: 30000 }, { date: '2026-11-26', km: 52000 }, { date: '2025-01-01', km: 21000 }, null).state).toBe('due');
    expect(periodicDue({ months: 60, km: 30000 }, { date: '2026-11-26', km: 40000 }, { date: '2025-01-01', km: 21000 }, null).state).toBe('not_due');
  });
});

describe('kit : memes regles que les operations', () => {
  const recent: DueContext = { ...or00003, evidence: [inv('KIT COURROIES DISTRIBUTION', '2024-03-15', 'FAC 2024-00123')] };
  const rows = [{ designation: 'FILTRE A HUILE' }, { designation: 'COURROIE DISTRIBUTION' }, { designation: 'LIQUIDE DE FREIN DOT 4' }];
  test('courroies pas a echeance : la courroie n\'est pas chargee, le reste oui', () => {
    const r = filterKitByDue(rows, recent);
    expect(r.kept.map((x) => x.designation)).toEqual(['FILTRE A HUILE', 'LIQUIDE DE FREIN DOT 4']);
    expect(r.dropped.map((d) => d.row.designation)).toEqual(['COURROIE DISTRIBUTION']);
  });
  test('OR-2026-00003 (tout est du ou inconnu) / contexte absent : tout est charge', () => {
    expect(filterKitByDue(rows, or00003).kept).toHaveLength(3);
    expect(filterKitByDue(rows, null).kept).toHaveLength(3);
  });
});
