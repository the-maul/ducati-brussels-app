import { describe, expect, it } from 'bun:test';
import { canSavePerson, personName, personPayload, EMPTY_PERSON } from '../src/modules/contacts/bank-persons';
import { hasPersonName, identityMissing } from '../src/modules/contacts/identity-rules';

describe('CON002 — fiche banque : pas de prénom / nom de personne', () => {
  it('une banque n’a pas de prénom / nom ; les autres types si', () => {
    expect(hasPersonName('banque_leasing')).toBe(false);
    for (const t of ['particulier', 'professionnel', 'fournisseur', 'employe']) expect(hasPersonName(t)).toBe(true);
  });
  it('une banque ne demande que la raison sociale', () => {
    expect(identityMissing({ type: 'banque_leasing', company_name: 'EUROPABANK' })).toEqual([]);
    expect(identityMissing({ type: 'banque_leasing', company_name: '' })).toEqual(['company_name']);
  });
});

describe('CON002 — personnes de contact', () => {
  it('le nom est obligatoire', () => {
    expect(canSavePerson(EMPTY_PERSON)).toBe(false);
    expect(canSavePerson({ ...EMPTY_PERSON, first_name: 'Anne' })).toBe(false);
    expect(canSavePerson({ ...EMPTY_PERSON, name: ' Dupont ' })).toBe(true);
  });
  it('champs vides → null, dossier moto gardé, id seulement en modification', () => {
    const f = { ...EMPTY_PERSON, name: ' Dupont ', first_name: 'Anne', phone: ' ', vehicle_id: 'v1' };
    expect(personPayload(f, 'c1')).toEqual({ contact_id: 'c1', name: 'Dupont', first_name: 'Anne', role: null, phone: null, email: null, vehicle_id: 'v1' });
    expect(personPayload(f, 'c1', 's1')).toMatchObject({ id: 's1', contact_id: 'c1' });
  });
  it('affiche « Prénom Nom »', () => {
    expect(personName({ first_name: 'Anne', name: 'DUPONT' })).toBe('Anne DUPONT');
    expect(personName({ first_name: null, name: 'DUPONT' })).toBe('DUPONT');
  });
});
