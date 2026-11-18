/**
 * ATE005 / ATE022 — Contrat de pret repris de G8 (19/11/2026, a-trancher T10 « contrat G8 + nos CG »).
 * Regles pures `src/modules/workshop/loans/contract-rules.ts` et contrat imprime `contract-print.ts` :
 * tout le contenu du contrat G8 est present (conducteur, permis, licence, moto du client, OR, livraison,
 * moto de pret, puissance, depart / retour date-heure-km-carburant, franchise, mention police,
 * « lu et approuve », double exemplaire), CG au verso dans la langue du client, franchise 500 par defaut.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tIn, fillVars, LOCALES } from '../src/lib/i18n';
import {
  DEFAULT_LOAN_DEDUCTIBLE, contractDate, contractLeg, contractLocale, contractTime, customerMoto, driverPrefill,
  firstFilled, formatEuro, formatPower, loanTermsFor, loanerMoto, missingDriverFields, oneLineAddress,
  parseDeductible, resolveDeductible, CV_UNIT,
} from '../src/modules/workshop/loans/contract-rules';
import { loanContractHtml, type LoanContract, type PrintTokens } from '../src/modules/workshop/loans/contract-print';

describe('franchise du contrat (G8 : 500 EUR, reglable par societe)', () => {
  test('500 par defaut, puis reglage de la societe, puis valeur figee sur le pret', () => {
    expect(DEFAULT_LOAN_DEDUCTIBLE).toBe(500);
    expect(resolveDeductible(null, undefined)).toBe(500);
    expect(resolveDeductible(null, 750)).toBe(750);
    expect(resolveDeductible('300.00', 750)).toBe(300);
    expect(resolveDeductible(0, 750)).toBe(0);
    expect(resolveDeductible(-5, 'abc')).toBe(500);
  });
  test('saisie de la franchise', () => {
    expect(parseDeductible('500')).toBe(500);
    expect(parseDeductible(' 750,5 ')).toBe(750.5);
    expect(parseDeductible('1 000,00')).toBe(1000);
    expect(parseDeductible('-1')).toBeNull();
    expect(parseDeductible('12,345')).toBeNull();
    expect(parseDeductible('')).toBeNull();
  });
  test('montant imprime', () => {
    expect(formatEuro(500)).toBe('500,00 €');
    expect(formatEuro(1250.5)).toBe('1\u202f250,50 €');
  });
});

describe('formats du contrat', () => {
  test('dates et heures', () => {
    expect(contractDate('1985-03-07')).toBe('07/03/1985');
    expect(contractDate(null)).toBe('');
    expect(contractDate('pas une date')).toBe('');
    const iso = new Date(2026, 10, 19, 9, 5).toISOString();
    expect(contractDate(iso)).toBe('19/11/2026');
    expect(contractTime(iso)).toBe('09:05');
    expect(contractTime('2026-11-19')).toBe('');
  });
  test('puissance depuis la fiche du parc, unite selon la langue', () => {
    expect(formatPower(82, 111, CV_UNIT.fr)).toBe('82 kW / 111 ch');
    expect(formatPower(82, null, CV_UNIT.nl)).toBe('82 kW');
    expect(formatPower(null, 111, CV_UNIT.en)).toBe('111 hp');
    expect(formatPower(0, null, 'ch')).toBe('');
  });
  test('adresse sur une ligne', () => {
    expect(oneLineAddress({ address: 'Rue de la Loi', street_number: '16', zip: '1000', city: 'Bruxelles' })).toBe('Rue de la Loi 16, 1000 Bruxelles');
    expect(oneLineAddress({ zip: '1000', city: 'Bruxelles' })).toBe('1000 Bruxelles');
    expect(oneLineAddress(null)).toBe('');
  });
  test('premiere valeur remplie', () => {
    expect(firstFilled(null, '  ', 'b', 'c')).toBe('b');
    expect(firstFilled()).toBe('');
  });
  test('releve de depart / retour : vide = a remplir a la main', () => {
    const iso = new Date(2026, 10, 19, 14, 30).toISOString();
    expect(contractLeg(iso, 1234, 'Plein')).toEqual({ date: '19/11/2026', time: '14:30', km: '1234', fuel: 'Plein' });
    expect(contractLeg(null, null, '')).toEqual({ date: '', time: '', km: '', fuel: '' });
  });
});

describe('conducteur : saisie du pret, sinon fiche client', () => {
  const client = {
    name: 'Domenico Test', birth_date: '1980-01-02', birth_place: 'Bari', address: 'Avenue Louise', street_number: '1',
    zip: '1050', city: 'Ixelles', mobile: null, gsm: '0470 00 00 00', phone: '02 000 00 00',
    license_number: 'B123', license_date: '2000-05-06', license_issued_by: null, license_place: 'Ixelles',
  };
  test('pre-remplissage complet depuis la fiche client', () => {
    const d = driverPrefill(null, client);
    expect(d.driver_name).toBe('Domenico Test');
    expect(d.driver_birth_date).toBe('1980-01-02');
    expect(d.driver_birth_place).toBe('Bari');
    expect(d.driver_address).toBe('Avenue Louise 1, 1050 Ixelles');
    expect(d.driver_phone).toBe('0470 00 00 00');
    expect(d.driver_license_number).toBe('B123');
    expect(d.driver_license_date).toBe('2000-05-06');
    expect(d.driver_license_issued_by).toBe('Ixelles');
    expect(d.driver_licence_number).toBeNull();
    expect(missingDriverFields(d)).toEqual(['driver_licence_number']);
  });
  test('la saisie sur le pret l emporte (conducteur different du client)', () => {
    const d = driverPrefill({ driver_name: 'Autre Conducteur', driver_licence_number: 'FMB-42', driver_phone: '' }, client);
    expect(d.driver_name).toBe('Autre Conducteur');
    expect(d.driver_licence_number).toBe('FMB-42');
    expect(d.driver_phone).toBe('0470 00 00 00');
  });
  test('autorite de delivrance avant le lieu', () => {
    expect(driverPrefill(null, { ...client, license_issued_by: 'Commune d Ixelles' }).driver_license_issued_by).toBe('Commune d Ixelles');
  });
  test('sans client : tout vide (pointilles a l impression)', () => {
    expect(missingDriverFields(driverPrefill(null, null))).toHaveLength(9);
  });
});

describe('motos imprimees', () => {
  test('moto de pret : flotte d abord, fiche du parc liee en complement (MEC, puissance)', () => {
    const m = loanerMoto({ label: 'Monster 937', brand: 'Ducati', plate: '1-ABC-123', vin: null, first_registration: null, power: null },
      { brand: 'DUCATI', model: 'MONSTER', vin: 'ZDM1234567890ABCD', first_registration_date: '2024-03-01', power_kw: 82, power_cv: 111 }, 'ch');
    expect(m).toEqual({ brand: 'Ducati', model: 'Monster 937', firstRegistration: '01/03/2024', plate: '1-ABC-123', vin: 'ZDM1234567890ABCD', power: '82 kW / 111 ch' });
    expect(loanerMoto({ label: 'X', power: '81 kW' }, null, 'ch').power).toBe('81 kW');
  });
  test('moto du client', () => {
    expect(customerMoto({ brand: 'Ducati', model: 'Panigale V4', plate: '2-XYZ-987', vin: 'ZDMV4', first_registration_date: '2022-06-15' }, 'ch'))
      .toEqual({ brand: 'Ducati', model: 'Panigale V4', firstRegistration: '15/06/2022', plate: '2-XYZ-987', vin: 'ZDMV4', power: '' });
    expect(customerMoto(null, 'ch').brand).toBe('');
  });
});

describe('conditions generales dans la langue du client', () => {
  const s = { loan_terms: 'CG FR', loan_terms_i18n: { nl: 'AV NL', en: '  ', it: 'CG IT' } };
  test('langue de la fiche, FR par defaut', () => {
    expect(contractLocale('nl')).toBe('nl');
    expect(contractLocale(null)).toBe('fr');
    expect(contractLocale('de')).toBe('fr');
  });
  test('texte de la langue, sinon le FR', () => {
    expect(loanTermsFor('fr', s)).toBe('CG FR');
    expect(loanTermsFor('nl', s)).toBe('AV NL');
    expect(loanTermsFor('it', s)).toBe('CG IT');
    expect(loanTermsFor('en', s)).toBe('CG FR');
    expect(loanTermsFor('nl', { loan_terms: 'CG FR' })).toBe('CG FR');
    expect(loanTermsFor('nl', { loan_terms: null })).toBe('');
  });
});

describe('contrat imprime : tout le contrat G8 + nos CG au verso', () => {
  const tokens: PrintTokens = { brand: 'var-brand', ink: 'var-ink', muted: 'var-muted', rule: 'var-rule', fontUi: 'ui', fontMono: 'mono', ruleWidth: '2px' };
  const base = (locale: (typeof LOCALES)[number], copies: 1 | 2 = 2): LoanContract => ({
    locale,
    company: { name: 'ITALBIKE STORE', address: 'Chaussée 1, 1000 Bruxelles', logoUrl: null },
    number: 'PRET-0007', date: '19/11/2026',
    driver: driverPrefill({ driver_licence_number: 'LIC-9' }, {
      name: 'Jean Client', birth_date: '1980-01-02', birth_place: 'Namur', address: 'Rue A', zip: '5000', city: 'Namur',
      phone: '081 00 00 00', license_number: 'B-555', license_date: '2001-02-03', license_issued_by: 'Ville de Namur',
    }),
    customerVehicle: customerMoto({ brand: 'Ducati', model: 'Panigale V4', plate: '2-XYZ-987', vin: 'ZDMPANIGALE000001', first_registration_date: '2022-06-15' }, 'ch'),
    orNumber: 'OR-0042', orDate: '18/11/2026', deliveryDate: '22/11/2026', deliveryTime: '17:00',
    loaner: loanerMoto({ label: 'Monster 937', brand: 'Ducati', plate: '1-ABC-123', vin: 'ZDMMONSTER0000001', first_registration: '2024-03-01', power: '82 kW / 111 ch' }, null, 'ch'),
    out: { date: '19/11/2026', time: '09:05', km: '1200', fuel: tIn(locale, 'loans.fuel_plein') },
    back: { date: '', time: '', km: '', fuel: '' },
    deductible: formatEuro(500), place: 'Bruxelles',
    terms: locale === 'fr' ? '1. La moto de prêt est confiée…' : `TERMS-${locale}`,
    copies,
  });

  test.each([...LOCALES])('%s : toutes les rubriques G8 dans la langue du contrat', (locale) => {
    const html = loanContractHtml(base(locale), tokens);
    const T = (k: string) => tIn(locale, `loans.contract.${k}`);
    const escH = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    for (const k of ['title', 'policeNotice', 'driverTitle', 'bornOn', 'license', 'issuedOn', 'issuedBy', 'licence',
      'customerVehicleTitle', 'firstRegistration', 'vin', 'inRepair', 'inRepairOn', 'delivery', 'deliveryAt', 'loanerTitle',
      'power', 'departure', 'back', 'day', 'time', 'km', 'fuel', 'declaration', 'doneAt', 'doneOn', 'signUser', 'signUserHint',
      'termsTitle', 'copyUser', 'copyCompany']) {
      expect(html).toContain(escH(T(k)));
    }
    expect(html).toContain(escH(fillVars(T('deductible'), { amount: '500,00 €' })));
    expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain(locale === 'fr' ? '1. La moto de prêt est confiée' : `TERMS-${locale}`);
  });

  test('donnees imprimees : conducteur, permis, licence, OR, livraison, moto de pret, depart', () => {
    const html = loanContractHtml(base('fr'), tokens);
    for (const v of ['Jean Client', '02/01/1980', 'Namur', 'Rue A, 5000 Namur', '081 00 00 00', 'B-555', '03/02/2001', 'Ville de Namur', 'LIC-9',
      'Panigale V4', '15/06/2022', '2-XYZ-987', 'ZDMPANIGALE000001', 'OR-0042', '18/11/2026', '22/11/2026', '17:00',
      'Monster 937', '01/03/2024', 'ZDMMONSTER0000001', '82 kW / 111 ch', '09:05', '1200', 'Plein', 'PRET-0007', 'Bruxelles']) {
      expect(html).toContain(v);
    }
  });

  test('double exemplaire : recto + verso par exemplaire ; un seul exemplaire sur demande', () => {
    const count = (html: string, s: string) => html.split(s).length - 1;
    const two = loanContractHtml(base('fr', 2), tokens);
    expect(count(two, '<section class="page">')).toBe(2);
    expect(count(two, '<section class="page verso">')).toBe(2);
    const one = loanContractHtml(base('fr', 1), tokens);
    expect(count(one, '<section class="page">')).toBe(1);
    expect(count(one, '<section class="page verso">')).toBe(1);
  });

  test('retour non fait : cases a remplir a la main', () => {
    expect(loanContractHtml(base('fr'), tokens)).toContain('class="dots"');
  });

  test('CG vides : rappel a la place du texte', () => {
    expect(loanContractHtml({ ...base('fr'), terms: '  ' }, tokens)).toContain(tIn('fr', 'loans.contract.noTerms'));
  });

  test('charte : couleurs et polices viennent des tokens (aucun hex, aucune police en dur)', () => {
    const src = readFileSync(new URL('../src/modules/workshop/loans/contract-print.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(src).not.toMatch(/Arial|Helvetica|Courier/);
    const html = loanContractHtml(base('fr'), tokens);
    expect(html).toContain('--c-brand:var-brand');
    expect(html).toContain('--f-ui:ui');
  });

  test('echappement HTML des donnees saisies', () => {
    const html = loanContractHtml({ ...base('fr'), place: '<script>x</script>' }, tokens);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });
});
