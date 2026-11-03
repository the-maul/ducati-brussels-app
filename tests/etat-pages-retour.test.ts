/**
 * UX011 — l'etat de la page d'avant survit au bouton Retour (retour client du 03/11/2026).
 * Logique pure : filtres de liste dans l'adresse (`list-search.ts`), brouillon des
 * formulaires en cours (`form-draft.ts`).
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { applyListPatch, listSearchFromRaw, readListSearch } from '../src/lib/list-search';
import {
  DRAFT_TTL_MS, clearFormDraft, discardActiveDrafts, formDraftKey, isDraftSuspended, parseDraft, readDraft,
  registerDraft, removeDraft, resetDraftRegistry, serializeDraft, writeDraft, type DraftStorage,
} from '../src/lib/form-draft';

const PARTS = { q: '', page: 0, stock: 'all', supplierId: '', paLocked: false };
const CHOICES = { stock: ['all', 'pos', 'neg', 'zero'] } as const;

describe('filtres de liste dans l adresse', () => {
  it('adresse vide → les valeurs par defaut', () => {
    expect(readListSearch({}, PARTS, CHOICES)).toEqual(PARTS);
    expect(readListSearch(undefined, PARTS)).toEqual(PARTS);
  });

  it('relit recherche, page, filtre et case a cocher, avec leur type', () => {
    const raw = { q: 'frein', page: 3, stock: 'pos', supplierId: 'abc', paLocked: true };
    expect(readListSearch(raw, PARTS, CHOICES)).toEqual(raw);
    // Forme texte (adresse tapee a la main, ancien lien) : convertie au bon type.
    expect(readListSearch({ page: '2', paLocked: 'true', q: 123 }, PARTS, CHOICES)).toMatchObject({ page: 2, paLocked: true, q: '123' });
  });

  it('valeur illisible ou hors liste → defaut, sans erreur', () => {
    expect(readListSearch({ page: 'abc', stock: 'tout', paLocked: 'peut-etre', q: { x: 1 } }, PARTS, CHOICES)).toEqual(PARTS);
  });

  it('la route ne garde que ce qui differe du defaut (adresse courte, liens sans parametre valides)', () => {
    expect(listSearchFromRaw({ q: '', page: 0, stock: 'all' }, PARTS, CHOICES)).toEqual({});
    expect(listSearchFromRaw({ q: 'frein', page: 0, stock: 'neg', autre: 'x' }, PARTS, CHOICES)).toEqual({ q: 'frein', stock: 'neg' });
  });

  it('une modification retire les defauts et garde les autres parametres de l adresse', () => {
    const prev = { q: 'frein', page: 4, lead: 'l-1' };
    expect(applyListPatch(prev, { stock: 'pos', page: 0 }, PARTS, CHOICES)).toEqual({ q: 'frein', stock: 'pos', lead: 'l-1' });
    expect(applyListPatch(prev, { q: '' }, PARTS, CHOICES)).toEqual({ page: 4, lead: 'l-1' });
    // Cle inconnue de la liste : ignoree.
    expect(applyListPatch({}, { nimporte: 'x' } as never, PARTS)).toEqual({});
  });

  it('aller-retour : ce qu on ecrit se relit a l identique', () => {
    const written = applyListPatch({}, { q: 'Monster 937', page: 2, stock: 'zero', paLocked: true }, PARTS, CHOICES);
    expect(readListSearch(written, PARTS, CHOICES)).toEqual({ q: 'Monster 937', page: 2, stock: 'zero', supplierId: '', paLocked: true });
  });

  it('objet plat de cases a cocher (filtres « contenu » des ventes)', () => {
    const SALES = { q: '', content: { vn: false, vo: false } };
    const written = applyListPatch({}, { content: { vn: true, vo: false } }, SALES);
    expect(written).toEqual({ content: { vn: true, vo: false } });
    expect(readListSearch(written, SALES)).toEqual({ q: '', content: { vn: true, vo: false } });
    // Forme JSON texte et sous-cles manquantes ou en trop.
    expect(readListSearch({ content: '{"vo":true,"x":1}' }, SALES).content).toEqual({ vn: false, vo: true });
    expect(applyListPatch(written, { content: { vn: false, vo: false } }, SALES)).toEqual({});
  });
});

function memoryStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe('brouillon de formulaire (Nouvel OR, nouveau document, client, article)', () => {
  beforeEach(() => resetDraftRegistry());

  it('cle = route + identifiant (societe), sans la recherche de l adresse', () => {
    expect(formDraftKey('/workshop/new', 'soc-1')).toBe('dms-draft:v1:/workshop/new#soc-1');
    expect(formDraftKey('/workshop/new?contactId=c', 'soc-1')).toBe('dms-draft:v1:/workshop/new#soc-1');
    expect(formDraftKey('/sales/new')).toBe('dms-draft:v1:/sales/new');
    expect(formDraftKey('/workshop/new', 'soc-1')).not.toBe(formDraftKey('/workshop/new', 'soc-2'));
  });

  it('serialise / relit la saisie (client, moto, lignes)', () => {
    const value = { sel: { contact: { id: 'c-1' }, vehicle: { id: 'v-1' } }, operator: 'Marco', lines: [{ designation: 'Vidange', quantity: 1 }] };
    const now = 1_000_000;
    expect(parseDraft(serializeDraft(value, now), now + 1000)).toEqual(value);
  });

  it('absent, illisible, trop vieux ou date future → aucun brouillon', () => {
    const now = 5_000_000_000;
    expect(parseDraft(null, now)).toBeNull();
    expect(parseDraft('pas du json', now)).toBeNull();
    expect(parseDraft('{"value":1}', now)).toBeNull();
    expect(parseDraft(serializeDraft({ a: 1 }, now - DRAFT_TTL_MS - 1), now)).toBeNull();
    expect(parseDraft(serializeDraft({ a: 1 }, now + 3_600_000), now)).toBeNull();
    expect(parseDraft(serializeDraft(null, now), now)).toBeNull();
  });

  it('ecrire, relire, effacer dans le stockage de l onglet', () => {
    const st = memoryStorage();
    const key = formDraftKey('/workshop/new', 'soc-1');
    writeDraft(key, { operator: 'Marco' }, st, 100);
    expect(readDraft(key, st, 200)).toEqual({ operator: 'Marco' });
    removeDraft(key, st);
    expect(readDraft(key, st, 200)).toBeNull();
  });

  it('enregistrement : brouillon efface et formulaire « suspendu » jusqu a son demontage', () => {
    const st = memoryStorage();
    const key = formDraftKey('/sales/new', 'soc-1');
    const unregister = registerDraft(key);
    writeDraft(key, { lines: [1] }, st);
    clearFormDraft(key, st);
    expect(st.map.has(key)).toBe(false);
    expect(isDraftSuspended(key)).toBe(true);
    // Un rendu tardif avant la navigation n'ecrit plus rien : le brouillon ne renait pas.
    writeDraft(key, { lines: [1, 2] }, st);
    expect(st.map.has(key)).toBe(false);
    unregister();
    expect(isDraftSuspended(key)).toBe(false);
  });

  it('abandon explicite (bouton Retour) : seuls les formulaires a l ecran sont effaces', () => {
    const st = memoryStorage();
    const open = formDraftKey('/workshop/new', 'soc-1');
    const other = formDraftKey('/parts/new', 'soc-1');
    registerDraft(open);
    writeDraft(open, { a: 1 }, st);
    writeDraft(other, { b: 2 }, st);
    discardActiveDrafts(st);
    expect(st.map.has(open)).toBe(false);
    expect(st.map.has(other)).toBe(true);
  });

  it('remontage (« Recommencer a zero ») : le nouveau formulaire peut de nouveau ecrire', () => {
    const st = memoryStorage();
    const key = formDraftKey('/clients/new', 'soc-1');
    const first = registerDraft(key);
    clearFormDraft(key, st);
    first();
    registerDraft(key);
    writeDraft(key, { name: 'Rossi' }, st, 10);
    expect(readDraft(key, st, 20)).toEqual({ name: 'Rossi' });
  });
});
