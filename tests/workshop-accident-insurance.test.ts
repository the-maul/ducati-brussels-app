/**
 * Tests M8 — OR accident cote assureur, rattrapage G8 du 18/11/2026 : franchise en montant ou en %,
 * saisie des montants, demarrage des travaux accepte (trace), fiche cabinet / expert.
 */
import { describe, expect, test } from 'bun:test';
import {
  deductibleAmount, deductibleLabel, insurancePartyLabel, parseAmount, validateInsuranceParty, workStartPatch,
} from '../src/modules/workshop/accident/insurance-rules';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

describe('franchise a percevoir', () => {
  test('en montant : la valeur saisie (G8 : franchise 250 €)', () => {
    expect(deductibleAmount('montant', '250', 1234)).toBe(250);
    expect(deductibleAmount('montant', '250,50', 0)).toBe(250.5);
  });
  test('en % du montant TTC de l\'OR', () => {
    expect(deductibleAmount('pourcentage', '10', 350)).toBe(35);
    expect(deductibleAmount('pourcentage', '10 %', 0)).toBe(0);
  });
  test('pourcentage au-dela de 100 ou saisie illisible : pas de franchise', () => {
    expect(deductibleAmount('pourcentage', '120', 350)).toBeNull();
    expect(deductibleAmount('montant', 'abc', 0)).toBeNull();
    expect(deductibleAmount('montant', '', 0)).toBeNull();
    expect(deductibleAmount('montant', '-5', 0)).toBeNull();
  });
  test('affichage court', () => {
    expect(deductibleLabel('montant', 250, 0, eur)).toBe('250,00 €');
    expect(deductibleLabel('pourcentage', 10, 350, eur)).toBe('10 % (35,00 €)');
    expect(deductibleLabel('montant', null, 0, eur)).toBe('—');
  });
  test('saisie des montants (valeur venale, cote)', () => {
    expect(parseAmount('4 500,00 €')).toBe(4500);
    expect(parseAmount(null)).toBeNull();
  });
});

describe('demarrage des travaux accepte', () => {
  test('coche : qui et quand', () => {
    expect(workStartPatch(true, 'u1', '2026-11-18T10:00:00.000Z')).toEqual({
      work_start_accepted: true, work_start_accepted_at: '2026-11-18T10:00:00.000Z', work_start_accepted_by: 'u1',
    });
  });
  test('decoche : trace effacee', () => {
    expect(workStartPatch(false, 'u1', '2026-11-18T10:00:00.000Z')).toEqual({
      work_start_accepted: false, work_start_accepted_at: null, work_start_accepted_by: null,
    });
  });
});

describe('fiche cabinet / expert', () => {
  test('nom obligatoire, type connu, e-mail plausible', () => {
    expect(validateInsuranceParty({ kind: 'cabinet', name: 'ASSURTEST' })).toEqual([]);
    expect(validateInsuranceParty({ kind: 'cabinet', name: '  ' })).toEqual(['name']);
    expect(validateInsuranceParty({ kind: 'garage', name: 'X' })).toEqual(['kind']);
    expect(validateInsuranceParty({ kind: 'expert', name: 'X', email: 'pas-un-mail' })).toEqual(['email']);
  });
  test('libelle de liste', () => {
    expect(insurancePartyLabel({ code: 'AT', name: 'ASSURTEST', city: 'Bruxelles' })).toBe('AT — ASSURTEST (Bruxelles)');
    expect(insurancePartyLabel({ name: 'Expert Dupont' })).toBe('Expert Dupont');
  });
});
