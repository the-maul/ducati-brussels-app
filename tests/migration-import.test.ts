/**
 * Tests M14 — Parse CSV d'import contacts (mapping, validation, délimiteurs).
 */
import { test, expect } from 'bun:test';
import { parseContactsCsv } from '../src/modules/migration/contacts-import';

test('mapping en-têtes FR + ligne valide', () => {
  const r = parseContactsCsv('Nom;Prénom;Email;Ville;Type\nMoreau;Simon;simon@x.be;Bruxelles;particulier');
  expect(r.toCreate).toBe(1);
  expect(r.errors).toBe(0);
  expect(r.mapped[0].payload.last_name).toBe('Moreau');
  expect(r.mapped[0].payload.email).toBe('simon@x.be');
  expect(r.mapped[0].payload.type).toBe('particulier');
});

test('société sans nom est acceptée (raison sociale)', () => {
  const r = parseContactsCsv('Societe;Email\nDucati BXL;info@x.be');
  expect(r.toCreate).toBe(1);
  expect(r.mapped[0].payload.company_name).toBe('Ducati BXL');
});

test('ligne sans nom ni société = erreur', () => {
  const r = parseContactsCsv('Nom;Email\n;orphan@x.be');
  expect(r.errors).toBe(1);
  expect(r.toCreate).toBe(0);
});

test('délimiteur virgule détecté + lignes vides ignorées', () => {
  const r = parseContactsCsv('Nom,Ville\nMoreau,Bruxelles\n\n');
  expect(r.toCreate).toBe(1);
  expect(r.mapped[0].payload.city).toBe('Bruxelles');
});

test('type professionnel mappé', () => {
  const r = parseContactsCsv('Nom;Type\nFrs;pro');
  expect(r.mapped[0].payload.type).toBe('professionnel');
});
