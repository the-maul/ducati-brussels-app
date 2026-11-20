/**
 * Décisions du client Q63, Q64, Q67 (20/11/2026), règles pures :
 *  - Q63 opérateur au comptoir comme G8 : liste, défaut = utilisateur connecté s'il est opérateur,
 *    choix obligatoire, nom imprimé jamais un e-mail ;
 *  - Q64 / Q67 : messages de la base traduits (km inférieur, champs de fiche à compléter) ;
 *  - Q67 fiche client : civilité / nom / prénom obligatoires pour un particulier, raison sociale
 *    pour une société, MAJUSCULES avec accents.
 * Les règles en base sont couvertes par supabase/tests/m6_operateur_comptoir_g8.sql,
 * m8_km_or_vers_fiche_moto.sql et m1_fiche_client_g8.sql.
 */
import { describe, expect, it } from 'bun:test';
import {
  defaultOperatorId, operatorErrorKey, operatorMissing, operatorPrintName, selectableOperators, toSalesOperators,
} from '../src/modules/sales/operators';
import { identityMissing, upperName } from '../src/modules/contacts/identity-rules';
import { identityFieldsLabel, translateDbError } from '../src/lib/db-error-i18n';
import { setLocale } from '../src/lib/i18n';
import { fr } from '../src/lib/i18n/fr';
import { nl } from '../src/lib/i18n/nl';
import { en } from '../src/lib/i18n/en';
import { it as itDict } from '../src/lib/i18n/it';

const rows = [
  { id: 'luc', code: 'LUC', label: 'LUC', is_active: true, extra: { kind: 'vendeur' }, sort_order: 0 },
  { id: 'dom', code: 'DOMENICO', label: 'DOMENICO', is_active: true, extra: { kind: 'vendeur', email: 'Domenico@DucatiBxl.be ' }, sort_order: 0 },
  { id: 'mik', code: 'MIKAEL', label: 'MIKAEL', is_active: false, extra: { kind: 'vendeur', email: 'mikael@x.be' }, sort_order: 0 },
  { id: 'chef', code: 'CHEF', label: 'CHEF ATELIER', is_active: true, extra: { kind: 'bidon' }, sort_order: 0 },
];

describe('Q63 — opérateurs', () => {
  const ops = toSalesOperators(rows);

  it('lit le référentiel : actifs d\'abord, puis par nom ; e-mail normalisé ; type inconnu = vendeur', () => {
    expect(ops.map((o) => o.id)).toEqual(['chef', 'dom', 'luc', 'mik']);
    expect(ops.find((o) => o.id === 'dom')!.email).toBe('domenico@ducatibxl.be');
    expect(ops.find((o) => o.id === 'chef')!.kind).toBe('vendeur');
  });

  it('défaut G8 : l\'utilisateur connecté s\'il est opérateur actif, sinon rien', () => {
    expect(defaultOperatorId(ops, 'DOMENICO@ducatibxl.be')).toBe('dom');
    expect(defaultOperatorId(ops, 'mikael@x.be')).toBeNull(); // désactivé
    expect(defaultOperatorId(ops, 'simon@themaul.be')).toBeNull();
    expect(defaultOperatorId(ops, null)).toBeNull();
  });

  it('choix obligatoire dès que la société a des opérateurs actifs', () => {
    expect(operatorMissing(ops, null)).toBe(true);
    expect(operatorMissing(ops, 'luc')).toBe(false);
    expect(operatorMissing([], null)).toBe(false);
    expect(operatorMissing(ops.filter((o) => !o.isActive), null)).toBe(false);
  });

  it('liste proposée : les actifs, plus l\'opérateur désactivé déjà posé sur le document', () => {
    expect(selectableOperators(ops).map((o) => o.id)).toEqual(['chef', 'dom', 'luc']);
    expect(selectableOperators(ops, 'mik').map((o) => o.id)).toContain('mik');
  });

  it('nom imprimé : jamais un e-mail', () => {
    expect(operatorPrintName('JOHN')).toBe('JOHN');
    expect(operatorPrintName('simon@themaul.be')).toBe('SIMON');
    expect(operatorPrintName('SIMON@THEMAUL.BE')).toBe('SIMON');
    expect(operatorPrintName('@x')).toBe('');
    expect(operatorPrintName(null)).toBe('');
  });

  it('erreurs de la base reconnues', () => {
    expect(operatorErrorKey({ hint: 'operator_unknown' })).toBe('q63.errUnknown');
    expect(operatorErrorKey({ hint: 'operator_locked' })).toBe('q63.errLocked');
    expect(operatorErrorKey(new Error('x'))).toBeNull();
  });
});

describe('Q67 — fiche client', () => {
  it('particulier : civilité, prénom, nom obligatoires (ordre G8)', () => {
    expect(identityMissing({ type: 'particulier', civility: '', first_name: ' ', last_name: '' })).toEqual(['civility', 'first_name', 'last_name']);
    expect(identityMissing({ type: 'particulier', civility: 'Madame', first_name: 'Éloïse', last_name: 'Dupont' })).toEqual([]);
    expect(identityMissing({ type: 'particulier', civility: 'Monsieur', first_name: null, last_name: 'X' })).toEqual(['first_name']);
  });

  it('société : raison sociale obligatoire, pas de civilité', () => {
    expect(identityMissing({ type: 'professionnel', company_name: '' })).toEqual(['company_name']);
    expect(identityMissing({ type: 'professionnel', company_name: 'MOTOS SRL', civility: '' })).toEqual([]);
    expect(identityMissing({ type: 'fournisseur', company_name: null })).toEqual(['company_name']);
    expect(identityMissing({ type: 'employe' })).toEqual([]);
  });

  it('MAJUSCULES avec les accents', () => {
    expect(upperName('éloïse de la fontaine')).toBe('ÉLOÏSE DE LA FONTAINE');
    expect(upperName(null)).toBeNull();
  });
});

describe('messages de la base traduits (FR / NL / EN / IT)', () => {
  it('champs à compléter, km inférieur, opérateur', () => {
    setLocale('fr');
    expect(identityFieldsLabel(['last_name', 'civility', 'first_name'])).toBe('Civilité, Prénom, Nom');
    expect(translateDbError({ hint: 'contact_identity_required', details: 'civility,first_name' })).toBe('Fiche client : compléter Civilité, Prénom.');
    expect(translateDbError({ hint: 'mileage_lower', details: '12500' })).toContain('12');
    expect(translateDbError({ hint: 'mileage_lower', details: '12500' })).toContain('Forcer');
    expect(translateDbError({ hint: 'operator_unknown' })).toBe(fr.q63.errUnknown);
    expect(translateDbError({ message: 'autre' })).toBeNull();
    setLocale('nl');
    expect(translateDbError({ hint: 'contact_identity_required', details: 'company_name' })).toBe('Klantenfiche: vul Bedrijfsnaam in.');
    setLocale('fr');
  });

  it('mêmes clés dans les quatre langues', () => {
    for (const d of [nl, en, itDict]) {
      expect(Object.keys(d.q63)).toEqual(Object.keys(fr.q63));
      expect(Object.keys(d.q64)).toEqual(Object.keys(fr.q64));
      expect(Object.keys(d.q67)).toEqual(Object.keys(fr.q67));
    }
  });
});
