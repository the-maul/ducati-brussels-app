/**
 * Rattrapage G8 « clients » (18/11/2026) — règles pures de src/modules/contacts/g8/rules.ts.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  beProvince, beRegion, consentStatus, channelState, consentDraftError, emptyCriteria, criteriaPayload,
  dayMonthToMmDd, renderCampaignText, smsSegments, labelSlot, addressLines, exportToSheets, type ConsentRow,
} from '../src/modules/contacts/g8/rules';

test('province et région belges depuis le code postal', () => {
  expect(beProvince('1000')).toBe('BRU');
  expect(beProvince('1180')).toBe('BRU');
  expect(beProvince('1300')).toBe('BWA');
  expect(beProvince('1500')).toBe('VBR');
  expect(beProvince('3000')).toBe('VBR');
  expect(beProvince('3500')).toBe('LIM');
  expect(beProvince('4000')).toBe('LIE');
  expect(beProvince('5000')).toBe('NAM');
  expect(beProvince('6000')).toBe('HAI');
  expect(beProvince('6700')).toBe('LUX');
  expect(beProvince('7000')).toBe('HAI');
  expect(beProvince('8000')).toBe('WVL');
  expect(beProvince('9000')).toBe('OVL');
  expect(beProvince('L-1234')).toBeNull();
  expect(beProvince('')).toBeNull();
  expect(beRegion('1050')).toBe('bruxelles');
  expect(beRegion('4000')).toBe('wallonie');
  expect(beRegion('2000')).toBe('flandre');
  expect(beRegion('75001')).toBeNull();
});

const row = (p: Partial<ConsentRow>): ConsentRow => ({
  id: Math.random().toString(36), declared_at: '2026-01-01', accepted: [], refused: [], form: null, form_ref: null,
  expires_at: null, note: null, revoked_at: null, revoke_reason: null, created_at: '2026-01-01T10:00:00Z', ...p,
});

test('statut d\'une déclaration RGPD', () => {
  expect(consentStatus(row({}), '2026-11-18')).toBe('active');
  expect(consentStatus(row({ expires_at: '2026-06-30' }), '2026-11-18')).toBe('expiree');
  expect(consentStatus(row({ revoked_at: '2026-05-01T00:00:00Z' }), '2026-11-18')).toBe('revoquee');
  expect(consentStatus(row({ declared_at: '2026-12-01' }), '2026-11-18')).toBe('future');
});

test('la dernière déclaration active qui cite le canal fait foi', () => {
  const rows = [
    row({ declared_at: '2025-01-01', accepted: ['email', 'sms'] }),
    row({ declared_at: '2026-03-01', refused: ['sms'] }),
    row({ declared_at: '2026-06-01', accepted: ['courrier'], revoked_at: '2026-07-01T00:00:00Z' }),
  ];
  expect(channelState(rows, 'email', '2026-11-18')).toBe('accepte');
  expect(channelState(rows, 'sms', '2026-11-18')).toBe('refuse');
  expect(channelState(rows, 'courrier', '2026-11-18')).toBeNull();
  expect(channelState([], 'email', '2026-11-18', '2026-02-02T00:00:00Z')).toBe('accepte');
  expect(channelState([], 'courrier', '2026-11-18', '2026-02-02T00:00:00Z')).toBeNull();
  // Une déclaration expirée ne compte plus : on retombe sur la précédente.
  expect(channelState([row({ declared_at: '2025-01-01', accepted: ['email'] }), row({ declared_at: '2026-01-01', refused: ['email'], expires_at: '2026-02-01' })], 'email', '2026-11-18')).toBe('accepte');
});

test('une déclaration doit être cohérente', () => {
  expect(consentDraftError({ accepted: [], refused: [], declared_at: '2026-11-18', expires_at: '' })).toBe('noChannel');
  expect(consentDraftError({ accepted: ['email'], refused: ['email'], declared_at: '2026-11-18', expires_at: '' })).toBe('bothWays');
  expect(consentDraftError({ accepted: ['email'], refused: [], declared_at: '2026-11-18', expires_at: '2026-01-01' })).toBe('expiryBefore');
  expect(consentDraftError({ accepted: ['email'], refused: ['sms'], declared_at: '2026-11-18', expires_at: '2029-11-18' })).toBeNull();
});

test('critères d\'extraction : défauts G8 et champs vides non envoyés', () => {
  const c = emptyCriteria();
  expect(c.exclude_opt_out).toBe(true);
  expect(c.exclude_npai).toBe(true);
  const p = criteriaPayload(c);
  expect(p).toEqual({ exclude_opt_out: true, exclude_npai: true, vehicle_current_only: true });
  const p2 = criteriaPayload({ ...c, name: ' dupont ', provinces: ['BRU'], birthday_from: '1/12', birthday_to: '31/12', exclude_opt_out: false });
  expect(p2.name).toBe('dupont');
  expect(p2.provinces).toEqual(['BRU']);
  expect(p2.birthday_from).toBe('12-01');
  expect(p2.birthday_to).toBe('12-31');
  expect(p2.exclude_opt_out).toBe(false);
  // Anniversaire incomplet : ignoré.
  expect(criteriaPayload({ ...c, birthday_from: '1/12' }).birthday_from).toBeUndefined();
});

test('jour/mois -> MM-DD', () => {
  expect(dayMonthToMmDd('25/12')).toBe('12-25');
  expect(dayMonthToMmDd('5-3')).toBe('03-05');
  expect(dayMonthToMmDd('32/01')).toBeNull();
  expect(dayMonthToMmDd('12/13')).toBeNull();
  expect(dayMonthToMmDd('noel')).toBeNull();
});

test('message de campagne personnalisé et nombre de SMS', () => {
  const txt = 'Bonjour {civilite} {nom}, votre code {code} — {societe}';
  expect(renderCampaignText(txt, { civility: 'Madame', last_name: 'DE SMET', code: '42', company_name: null }))
    .toBe('Bonjour Mme De Smet, votre code 42 — ');
  expect(renderCampaignText('{prenom}', { first_name: "JEAN-LUC" })).toBe('Jean-Luc');
  expect(smsSegments('')).toBe(0);
  expect(smsSegments('a'.repeat(160))).toBe(1);
  expect(smsSegments('a'.repeat(161))).toBe(2);
  expect(smsSegments('a'.repeat(306))).toBe(2);
  expect(smsSegments('a'.repeat(307))).toBe(3);
});

test('planche d\'étiquettes 3 x 8', () => {
  expect(labelSlot(0)).toEqual({ page: 0, x: 0, y: 0.5 });
  expect(labelSlot(2)).toEqual({ page: 0, x: 140, y: 0.5 });
  expect(labelSlot(3)).toEqual({ page: 0, x: 0, y: 37.5 });
  expect(labelSlot(24)).toEqual({ page: 1, x: 0, y: 0.5 });
});

test('lignes d\'adresse : société, personne, rue, ville, pays étranger seulement', () => {
  expect(addressLines({ type: 'particulier', civility: 'Monsieur', first_name: 'Jean', last_name: 'DUPONT', address: 'Rue Haute', street_number: '12', zip: '1000', city: 'Bruxelles', country: 'BE' }))
    .toEqual(['M. Jean DUPONT', 'Rue Haute 12', '1000 Bruxelles']);
  expect(addressLines({ type: 'professionnel', company_name: 'MOTO SA', legal_form: 'SA', first_name: 'Ann', last_name: 'PEETERS', zip: 'L-1234', city: 'Luxembourg', country: 'LU' }))
    .toEqual(['MOTO SA SA', 'Ann PEETERS', 'L-1234 Luxembourg', 'LU']);
});

test('portabilité : une feuille Fiche puis une feuille par liste', () => {
  const sheets = exportToSheets({
    contact: { code: '12', last_name: 'DUPONT', email: null },
    documents: [{ number: 'FAC-1', total_ttc: 10, lines: [{ designation: 'Filtre' }] }],
    consents: [],
    consent_state: { email: 'accepte' },
  });
  expect(sheets.map((s) => s.name)).toEqual(['Fiche', 'documents']);
  expect(sheets[0].rows).toEqual([['Champ', 'Valeur'], ['code', '12'], ['last_name', 'DUPONT']]);
  expect(sheets[1].rows[0]).toEqual(['number', 'total_ttc', 'lines']);
  expect(sheets[1].rows[1][2]).toBe('[{"designation":"Filtre"}]');
});
