/**
 * M1 — Fiche liée (retour de Simon du 05/10) : règle de reprise du prénom / nom
 * depuis la fiche privée, et recherche d'un contact par le nom de sa fiche liée.
 * Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  isProContactType, hasPersonName, linkedNameLock, foldText, searchTokens,
  linkedHaystack, matchesWithLinked, type NameCandidate,
} from '../src/modules/contacts/linked-name';

const pro = (over: Partial<NameCandidate> = {}): NameCandidate =>
  ({ id: 'pro', type: 'professionnel', company_name: 'AGM FISC', first_name: null, last_name: null, ...over });
const priv = (id: string, first: string | null, last: string | null): NameCandidate =>
  ({ id, type: 'particulier', first_name: first, last_name: last, company_name: null });

/* ---------------- 1. Reprise du prénom / nom ---------------- */

test('types professionnels reconnus', () => {
  expect(isProContactType('professionnel')).toBe(true);
  expect(isProContactType('fournisseur')).toBe(true);
  expect(isProContactType('banque_leasing')).toBe(true);
  expect(isProContactType('particulier')).toBe(false);
  expect(isProContactType('employe')).toBe(false);
  expect(isProContactType(null)).toBe(false);
});

test('une fiche privée nommée est une source ; une fiche vierge non', () => {
  expect(hasPersonName(priv('a', 'DOMENICO', 'FONTEIO'))).toBe(true);
  expect(hasPersonName(priv('a', null, 'FONTEIO'))).toBe(true);
  expect(hasPersonName(priv('a', 'DOMENICO', null))).toBe(true);
  expect(hasPersonName(priv('a', '  ', ''))).toBe(false);
  expect(hasPersonName(priv('a', null, null))).toBe(false);
});

test('pro + UNE fiche privée liée : prénom et nom repris, champs verrouillés', () => {
  const lock = linkedNameLock(pro(), [priv('p1', 'DOMENICO', 'FONTEIO')]);
  expect(lock.locked).toBe(true);
  if (lock.locked) {
    expect(lock.source.id).toBe('p1');
    expect(lock.source.first_name).toBe('DOMENICO');
    expect(lock.source.last_name).toBe('FONTEIO');
  }
});

test('fournisseur et banque/leasing suivent la même règle', () => {
  for (const type of ['fournisseur', 'banque_leasing']) {
    expect(linkedNameLock(pro({ type }), [priv('p1', 'JEAN', 'DUPONT')]).locked).toBe(true);
  }
});

test('fiche privée ou employé : jamais de reprise, champs modifiables', () => {
  const l1 = linkedNameLock(priv('me', 'SIMON', 'MOREAU'), [priv('p1', 'ANNE', 'MOREAU')]);
  expect(l1.locked).toBe(false);
  if (!l1.locked) expect(l1.reason).toBe('not_pro');
  const l2 = linkedNameLock({ id: 'me', type: 'employe' }, [priv('p1', 'ANNE', 'MOREAU')]);
  expect(l2.locked).toBe(false);
});

test('aucune fiche privée liée : champs modifiables', () => {
  const l1 = linkedNameLock(pro(), []);
  expect(l1.locked).toBe(false);
  if (!l1.locked) expect(l1.reason).toBe('no_private_link');
  // Une fiche PRO liée à une autre fiche pro ne donne pas le nom d'une personne.
  const l2 = linkedNameLock(pro(), [{ id: 'o', type: 'professionnel', company_name: 'AUTRE SPRL' }]);
  expect(l2.locked).toBe(false);
  if (!l2.locked) expect(l2.reason).toBe('no_private_link');
});

test('PLUSIEURS fiches privées liées (couple, deux gérants) : rien n’est verrouillé', () => {
  const lock = linkedNameLock(pro(), [priv('p1', 'PIERRE', 'DURAND'), priv('p2', 'SOPHIE', 'LEGRAND')]);
  expect(lock.locked).toBe(false);
  if (!lock.locked) expect(lock.reason).toBe('several_private');
});

test('fiche privée liée sans nom ni prénom : pas de reprise (on ne vide pas le nom du pro)', () => {
  const lock = linkedNameLock(pro(), [priv('p1', null, null)]);
  expect(lock.locked).toBe(false);
  if (!lock.locked) expect(lock.reason).toBe('no_private_link');
});

test('deux fiches privées liées dont une seule nommée : la nommée fait autorité', () => {
  const lock = linkedNameLock(pro(), [priv('p1', null, '  '), priv('p2', 'SOPHIE', 'LEGRAND')]);
  expect(lock.locked).toBe(true);
  if (lock.locked) expect(lock.source.id).toBe('p2');
});

/* ---------------- 2. Recherche par la fiche liée ---------------- */

test('repliage : accents et casse retirés', () => {
  expect(foldText('Émilie LÉGRAND')).toBe('emilie legrand');
  expect(foldText(null)).toBe('');
});

test('découpage en mots : espaces multiples ignorés', () => {
  expect(searchTokens('  AGM   FISC ')).toEqual(['agm', 'fisc']);
  expect(searchTokens('')).toEqual([]);
  expect(searchTokens(null)).toEqual([]);
});

test('chercher la société remonte la personne liée', () => {
  const personne = foldText('FONTEIO DOMENICO');
  const lie = linkedHaystack([{ id: 'pro', type: 'professionnel', company_name: 'AGM FISC', code: 'C1234' }]);
  expect(matchesWithLinked('AGM FISC', personne, lie)).toBe(true);
  expect(matchesWithLinked('agm', personne, lie)).toBe(true);
  // Et la personne se trouve toujours par son propre nom.
  expect(matchesWithLinked('fonteio', personne, lie)).toBe(true);
});

test('chercher la personne remonte la société liée', () => {
  const societe = foldText('AGM FISC');
  const lie = linkedHaystack([{ id: 'p1', type: 'particulier', first_name: 'DOMENICO', last_name: 'FONTEIO' }]);
  expect(matchesWithLinked('DOMENICO FONTEIO', societe, lie)).toBe(true);
  expect(matchesWithLinked('fonteio', societe, lie)).toBe(true);
});

test('mots répartis entre la fiche et sa fiche liée : chacun doit se trouver quelque part', () => {
  const societe = foldText('AGM FISC');
  const lie = linkedHaystack([{ id: 'p1', type: 'particulier', first_name: 'DOMENICO', last_name: 'FONTEIO' }]);
  expect(matchesWithLinked('agm fonteio', societe, lie)).toBe(true);
  expect(matchesWithLinked('agm martin', societe, lie)).toBe(false);
});

test('aucune fiche liée : recherche inchangée', () => {
  const societe = foldText('13.8 COMPOSITES');
  expect(matchesWithLinked('composites', societe, linkedHaystack([]))).toBe(true);
  expect(matchesWithLinked('collyns', societe, linkedHaystack([]))).toBe(false);
});

test('recherche vide : tout passe (la liste n’est pas filtrée)', () => {
  expect(matchesWithLinked('', foldText('N’IMPORTE QUI'), '')).toBe(true);
});

test('accents : chercher « legrand » trouve « Légrand » sur la fiche liée', () => {
  const societe = foldText('ZZ SPRL');
  const lie = linkedHaystack([{ id: 'p1', type: 'particulier', first_name: 'Émilie', last_name: 'Légrand' }]);
  expect(matchesWithLinked('legrand', societe, lie)).toBe(true);
  expect(matchesWithLinked('EMILIE', societe, lie)).toBe(true);
});
