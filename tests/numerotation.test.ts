/**
 * Numérotation des documents (M0, rattrapage G8 du 18/11/2026) : deux modes au choix par société.
 * Règles de l'écran (aperçu, série utilisée, réglage du prochain numéro, changement de mode).
 * La base fait foi : essais à blanc `supabase/tests/m0_numerotation_deux_modes.sql` (règles) et
 * `supabase/tests/m0_numerotation_concurrence.sql` (continuité sous concurrence, deux modes).
 * Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  numberingKey, isDormant, effectiveNextValue, formatNumber, previewNumber, nextValueError, skippedNumbers,
  modeChangeDecision, groupOf, compareDocTypes, hasHelp, KNOWN_HELP_TYPES, SHARED_SALES_TYPES, SINGLE_COUNTER_TYPE,
} from '../src/modules/settings/numbering-rules';
import { sequenceFor } from '../src/modules/settings/sequences-api';
import { fr } from '../src/lib/i18n/fr';

const FAC = { prefix: 'FAC', separator: '-', padding: 5, reset_yearly: true, next_value: 5, current_year: 2026, suffix: null };
const VEN = { prefix: '', separator: '', padding: 8, reset_yearly: false, next_value: 22701462, current_year: 2026, suffix: null };

describe('quelle série donne le numéro', () => {
  test('séries séparées : chaque type garde sa série', () => {
    for (const t of ['FAC', 'TIK', 'AVO', 'DEV', 'OR']) expect(numberingKey(t, 'separate')).toBe(t);
  });
  test('compteur unique : facture, ticket et avoir sur VEN, les autres inchangés', () => {
    for (const t of SHARED_SALES_TYPES) expect(numberingKey(t, 'single')).toBe(SINGLE_COUNTER_TYPE);
    for (const t of ['FAA', 'DEV', 'RES', 'BL', 'OR', 'ORO', 'CMD', 'Z']) expect(numberingKey(t, 'single')).toBe(t);
  });
  test('séries en sommeil selon le mode', () => {
    expect(isDormant('VEN', 'separate')).toBe(true);
    expect(isDormant('VEN', 'single')).toBe(false);
    expect(isDormant('FAC', 'single')).toBe(true);
    expect(isDormant('FAC', 'separate')).toBe(false);
    expect(isDormant('DEV', 'single')).toBe(false);
  });
  test('aperçu de la confirmation de facture : le compteur unique en mode single', () => {
    const seqs = [{ doc_type: 'FAC', id: 'f' }, { doc_type: 'VEN', id: 'v' }];
    expect(sequenceFor(seqs, 'FAC', 'single')?.id).toBe('v');
    expect(sequenceFor(seqs, 'FAC', 'separate')?.id).toBe('f');
    expect(sequenceFor(seqs, 'FAC', null)?.id).toBe('f');
  });
});

describe('aperçu du prochain numéro (même règle que la base)', () => {
  test('format historique avec année', () => {
    expect(previewNumber(FAC, 2026)).toBe('FAC-2026-00005');
  });
  test('remise à zéro annuelle : 1 au changement d année', () => {
    expect(effectiveNextValue(FAC, 2027)).toBe(1);
    expect(previewNumber(FAC, 2027)).toBe('FAC-2027-00001');
  });
  test('compteur unique façon G8 : 8 chiffres sans préfixe', () => {
    expect(previewNumber(VEN, 2026)).toBe('22701462');
  });
  test('jamais de troncature au-delà de la longueur (la base tronquait avec lpad)', () => {
    expect(formatNumber({ ...FAC, padding: 2 }, 2026, 501)).toBe('FAC-2026-501');
  });
});

describe('réglage du prochain numéro : vers le haut seulement, avec motif', () => {
  test('refus vers le bas, égal, non entier, trop grand', () => {
    expect(nextValueError(FAC, 4, 'motif valable', 2026)).toBe('notHigher');
    expect(nextValueError(FAC, 5, 'motif valable', 2026)).toBe('notHigher');
    expect(nextValueError(FAC, 6.5, 'motif valable', 2026)).toBe('notInteger');
    expect(nextValueError(FAC, 0, 'motif valable', 2026)).toBe('notInteger');
    expect(nextValueError(FAC, 1e13, 'motif valable', 2026)).toBe('tooBig');
  });
  test('motif obligatoire (au moins 5 caractères)', () => {
    expect(nextValueError(FAC, 100, ' abc ', 2026)).toBe('reasonMissing');
    expect(nextValueError(FAC, 100, 'Démarrage production', 2026)).toBeNull();
  });
  test('reprise du compteur G8 et trou annoncé', () => {
    const fresh = { ...VEN, next_value: 1 };
    expect(nextValueError(fresh, 22701462, 'Reprise du compteur G8', 2026)).toBeNull();
    expect(skippedNumbers(fresh, 22701462, 2026)).toBe(22701461);
    expect(skippedNumbers(FAC, 5, 2026)).toBe(0);
  });
  test('en nouvelle année avec remise à zéro, la base de comparaison est 1', () => {
    expect(nextValueError(FAC, 2, 'Nouvel exercice', 2027)).toBeNull();
  });
});

describe('changement de mode : seulement en début d exercice', () => {
  test('même mode : rien à faire', () => {
    expect(modeChangeDecision({ current: 'separate', requested: 'separate', numberedThisYear: 12 })).toBe('same');
  });
  test('aucun document numéroté dans l exercice : immédiat', () => {
    expect(modeChangeDecision({ current: 'separate', requested: 'single', numberedThisYear: 0 })).toBe('now');
  });
  test('documents validés dans l exercice : seulement programmé au 1er janvier', () => {
    expect(modeChangeDecision({ current: 'separate', requested: 'single', numberedThisYear: 1 })).toBe('nextYearOnly');
    expect(modeChangeDecision({ current: 'single', requested: 'separate', numberedThisYear: 40 })).toBe('nextYearOnly');
  });
});

describe('écran : groupes calqués sur la Gestion chronos de G8 et libellés explicatifs', () => {
  test('groupes', () => {
    expect(groupOf('VEN')).toBe('sales');
    expect(groupOf('OR')).toBe('workshop');
    expect(groupOf('ORO')).toBe('workshop');
    expect(groupOf('REC')).toBe('purchases');
    expect(groupOf('OCC')).toBe('vehicles');
    expect(groupOf('Z')).toBe('cash');
    expect(groupOf('XYZ')).toBe('other');
  });
  test('compteur unique puis facture en tête des ventes', () => {
    expect(['DEV', 'TIK', 'FAC', 'VEN'].sort(compareDocTypes)).toEqual(['VEN', 'FAC', 'TIK', 'DEV']);
  });
  test('chaque série connue a son explication dans le dictionnaire FR', () => {
    const help = (fr as unknown as { numbering: { help: Record<string, string> } }).numbering.help;
    for (const k of KNOWN_HELP_TYPES) {
      expect(hasHelp(k)).toBe(true);
      expect(help[k]?.length ?? 0).toBeGreaterThan(5);
    }
  });
});

describe('migration 20261118260000 : garde-fous en base', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261118260000_m0_numerotation_deux_modes.sql', import.meta.url), 'utf8');
  test('numéro pris sous verrou de ligne et validation dans la même transaction', () => {
    expect(sql).toMatch(/for update;/);
    expect(sql).toMatch(/function public\.document_assign_number/);
    expect(sql).toMatch(/update public\.documents set status = 'validee', number = _num/);
  });
  test('changement de mode refusé avec des documents numérotés dans l exercice, et tracé', () => {
    expect(sql).toMatch(/Changement refusé/);
    expect(sql).toMatch(/'numbering_mode_change'/);
    expect(sql).toMatch(/'numbering_mode_scheduled'/);
    expect(sql).toMatch(/'numbering_mode_applied'/);
  });
  test('prochain numéro : vers le haut seulement, admin ou comptable, tracé ; jamais par l API directe', () => {
    expect(sql).toMatch(/_next <= _effective/);
    expect(sql).toMatch(/has_role\(_company, 'comptable'\)/);
    expect(sql).toMatch(/'numbering_next_value_change'/);
    expect(sql).toMatch(/ne se modifie pas directement/);
  });
  test('aucune purge ni réécriture de numéros émis', () => {
    expect(sql).not.toMatch(/delete from public\.documents/i);
    expect(sql).not.toMatch(/update public\.documents set number/i);
  });
});
