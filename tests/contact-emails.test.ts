/**
 * Plusieurs e-mails par fiche + détection d'homonyme (M1, CON002, 26/11/2026).
 * Mêmes règles que la migration 20261126300000 (relève Outlook, recherche, doublons).
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  normEmail, isValidEmail, ownsEmail, contactsByEmail, nameKey, homonymReason, findHomonyms,
  checkNewEmail, otherEmails, type ContactEmailRow,
} from '../src/modules/contacts/contact-emails-rules';

test('normEmail / isValidEmail : casse et espaces ignorés', () => {
  expect(normEmail('  Jean.Dupont@Exemple.BE ')).toBe('jean.dupont@exemple.be');
  expect(normEmail('   ')).toBeNull();
  expect(normEmail(null)).toBeNull();
  expect(isValidEmail('a@b.be')).toBe(true);
  expect(isValidEmail('0475 12 34 56')).toBe(false);
  expect(isValidEmail('a@@b')).toBe(false);
});

test('ownsEmail : e-mail principal, e-mail pro G8 ou e-mail secondaire', () => {
  const fiche = { email: 'prive@exemple.be', email_pro: null, extra: ['Pro@Societe.be'] };
  expect(ownsEmail(fiche, 'prive@exemple.be')).toBe(true);
  expect(ownsEmail(fiche, ' PRO@societe.be')).toBe(true);
  expect(ownsEmail({ email: null, email_pro: 'g8@pro.be' }, 'g8@pro.be')).toBe(true);
  expect(ownsEmail(fiche, 'autre@exemple.be')).toBe(false);
  expect(ownsEmail(fiche, '')).toBe(false);
});

test('contactsByEmail : la fiche active la plus ancienne reçoit le mail', () => {
  const fiches = [
    { id: 'archivee', email: 'x@y.be', is_active: false, created_at: '2020-01-01' },
    { id: 'recente', email: null, extra: ['x@y.be'], is_active: true, created_at: '2026-10-08' },
    { id: 'ancienne', email: 'X@Y.be', is_active: true, created_at: '2024-05-01' },
    { id: 'autre', email: 'z@y.be', is_active: true, created_at: '2019-01-01' },
  ];
  expect(contactsByEmail(fiches, 'x@y.be').map((c) => c.id)).toEqual(['ancienne', 'recente', 'archivee']);
  expect(contactsByEmail(fiches, 'inconnu@y.be')).toEqual([]);
});

test('nameKey : accents, casse, tirets et espaces multiples', () => {
  expect(nameKey('  Hélène  Lefèvre-Durand ')).toBe('helene lefevre durand');
  expect(nameKey('')).toBeNull();
});

test('homonymReason : même prénom + nom, dans un sens ou dans l autre', () => {
  const g8 = { first_name: 'Marc', last_name: 'Dupont', company_name: null };
  expect(homonymReason({ first_name: 'marc', last_name: 'DUPONT' }, g8)).toBe('nom');
  // G8 inverse parfois prénom et nom
  expect(homonymReason({ first_name: 'Dupont', last_name: 'Marc' }, g8)).toBe('nom');
  // le nom seul ne suffit pas
  expect(homonymReason({ first_name: null, last_name: 'Dupont' }, g8)).toBeNull();
  expect(homonymReason({ first_name: 'Marco', last_name: 'Dupont' }, g8)).toBeNull();
});

test('homonymReason : même société', () => {
  const pro = { first_name: null, last_name: null, company_name: 'Garage Émile SRL' };
  expect(homonymReason({ company_name: 'garage emile srl' }, pro)).toBe('societe');
  expect(homonymReason({ company_name: 'Garage Emile' }, pro)).toBeNull();
});

test('findHomonyms : fiches actives seulement, employés exclus', () => {
  const fiches = [
    { id: '1148', first_name: 'Marc', last_name: 'Dupont', is_active: true, type: 'particulier' },
    { id: 'archivee', first_name: 'Marc', last_name: 'Dupont', is_active: false, type: 'particulier' },
    { id: 'employe', first_name: 'Marc', last_name: 'Dupont', is_active: true, type: 'employe' },
    { id: 'autre', first_name: 'Luc', last_name: 'Dupont', is_active: true, type: 'particulier' },
  ];
  expect(findHomonyms({ first_name: 'Marc', last_name: 'Dupont' }, fiches).map((c) => c.id)).toEqual(['1148']);
  expect(findHomonyms({ first_name: 'Paul', last_name: 'Martin' }, fiches)).toEqual([]);
});

test('checkNewEmail : vide, invalide, déjà sur la fiche', () => {
  const existing = ['prive@exemple.be', 'pro@societe.be'];
  expect(checkNewEmail('  ', existing)).toBe('empty');
  expect(checkNewEmail('pas-une-adresse', existing)).toBe('invalid');
  expect(checkNewEmail('PRO@societe.be', existing)).toBe('exists');
  expect(checkNewEmail('nouvelle@exemple.be', existing)).toBe('ok');
});

test('otherEmails : tout sauf le principal, du plus ancien au plus récent', () => {
  const row = (id: string, is_primary: boolean, created_at: string): ContactEmailRow => ({
    id, contact_id: 'c', email: `${id}@x.be`, kind: null, is_primary, source: 'ajout', created_at,
  });
  const rows = [row('b', false, '2026-11-02'), row('p', true, '2026-01-01'), row('a', false, '2026-11-01')];
  expect(otherEmails(rows).map((r) => r.id)).toEqual(['a', 'b']);
});
