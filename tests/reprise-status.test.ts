/**
 * Tests du flux de statut de reprise (M7) — CLAUDE.md règle 7.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { normalizeRepriseStatus, autoAdvance, REPRISE_STATUSES, REPRISE_FLOW } from '../src/modules/tradein/reprise-status';

test('normalizeRepriseStatus : rétrocompat ouvert/valide + valeurs inconnues', () => {
  expect(normalizeRepriseStatus('ouvert')).toBe('collecte');
  expect(normalizeRepriseStatus('valide')).toBe('repris');
  expect(normalizeRepriseStatus('collecte')).toBe('collecte');
  expect(normalizeRepriseStatus('envoye')).toBe('envoye');
  expect(normalizeRepriseStatus('accepte')).toBe('accepte');
  expect(normalizeRepriseStatus('repris')).toBe('repris');
  expect(normalizeRepriseStatus('annule')).toBe('annule');
  expect(normalizeRepriseStatus(null)).toBe('collecte');
  expect(normalizeRepriseStatus('n_importe_quoi')).toBe('collecte');
});

test('autoAdvance : avance seulement vers l’avant, jamais en arrière', () => {
  expect(autoAdvance('collecte', 'envoye')).toBe('envoye');
  expect(autoAdvance('collecte', 'accepte')).toBe('accepte');
  expect(autoAdvance('envoye', 'collecte')).toBeNull();     // pas de recul
  expect(autoAdvance('accepte', 'envoye')).toBeNull();      // pas de recul
  expect(autoAdvance('envoye', 'envoye')).toBeNull();       // déjà à ce stade
  expect(autoAdvance('collecte', 'repris')).toBe('repris');
});

test('autoAdvance : un dossier annulé reste figé', () => {
  expect(autoAdvance('annule', 'envoye')).toBeNull();
  expect(autoAdvance('annule', 'repris')).toBeNull();
});

test('constantes de flux cohérentes', () => {
  expect(REPRISE_STATUSES).toEqual(['collecte', 'envoye', 'accepte', 'repris', 'annule']);
  expect(REPRISE_FLOW).toEqual(['collecte', 'envoye', 'accepte', 'repris']);
});
