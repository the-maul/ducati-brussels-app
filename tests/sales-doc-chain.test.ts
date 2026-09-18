/**
 * Tests M6 — chaîne des documents de vente (mission 05, carte 1) :
 * DEV (devis / proforma) → BC (bon de commande) → RES / BL / FAC.
 */
import { test, expect } from 'bun:test';
import { CONVERSIONS, DEPOSIT_DOC_TYPES, SALE_DOC_TYPES } from '../src/modules/sales/write-api';
import { AVAILABILITY_DOC_TYPES } from '../src/modules/sales/availability';

test('un devis / proforma se convertit en bon de commande, réservation, BL ou facture', () => {
  expect([...CONVERSIONS.DEV]).toEqual(['BC', 'RES', 'BL', 'FAC']);
});

test('un bon de commande se convertit en réservation, BL ou facture, jamais en devis', () => {
  expect([...CONVERSIONS.BC]).toEqual(['RES', 'BL', 'FAC']);
  expect(CONVERSIONS.BC).not.toContain('DEV');
});

test('le bon de commande ne bouge pas le stock mais accepte un acompte', () => {
  expect(SALE_DOC_TYPES as readonly string[]).not.toContain('BC');
  expect(DEPOSIT_DOC_TYPES as readonly string[]).toContain('BC');
  expect(DEPOSIT_DOC_TYPES as readonly string[]).toContain('RES');
});

test('la disponibilité du stock est affichée sur un bon de commande', () => {
  expect(AVAILABILITY_DOC_TYPES as readonly string[]).toContain('BC');
});
