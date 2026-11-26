/**
 * Tests M8 — ATE014 (Simon, 26/11/2026) : mode operatoire « maison » quand le modele n'a pas de
 * manuel d'atelier Ducati (ex. Monster 1100 S 2009, OR-2026-00003). Choix Ducati / atelier,
 * conversion vers l'ecran pas a pas, brouillon d'edition, nom de la portee.
 */
import { test, expect, describe } from 'bun:test';
import {
  ATELIER_PROCEDURE_PREFIX, chooseProcedure, cleanDraft, draftFrom, draftValid, parseTorqueNm, scopeName, toOrProceduresInfo, toProcedure,
  type WorkshopProcedure,
} from '../src/modules/workshop/journey/workshop-procedure-rules';

const wp: WorkshopProcedure = {
  id: 'p1', company_id: 'c1', scope: 'model', model_year_id: null, model_id: '653',
  op_key: 'vidange de l huile moteur et remplacement du filtre', op_label: 'Vidange de l\'huile moteur et remplacement du filtre',
  steps: [{ text: 'Moteur chaud, béquille d\'atelier.' }, { text: 'Déposer le bouchon de vidange.' }, { text: 'Remplacer le filtre.' }],
  torques: [{ label: 'Bouchon de vidange', value: '20 Nm' }, { label: 'Filtre à huile', value: '10-12 Nm' }],
  tools: ['Clé à filtre'], remarks: 'Joint de bouchon neuf à chaque vidange.', version: 2,
  created_by_name: 'Chef', created_at: '2026-11-26T10:00:00Z', updated_by_name: 'Méca', updated_at: '2026-11-26T11:00:00Z',
};

describe('quel mode operatoire afficher', () => {
  test('Ducati d\'abord, meme si l\'atelier en a ecrit un', () => {
    expect(chooseProcedure('wsm-42', wp, true)).toEqual({ kind: 'ducati', procedureId: 'wsm-42' });
  });
  test('pas de Ducati : celui de l\'atelier', () => {
    expect(chooseProcedure(null, wp, false)).toEqual({ kind: 'atelier', procedure: wp });
  });
  test('ni l\'un ni l\'autre : rien, et on dit si l\'utilisateur peut l\'ecrire', () => {
    expect(chooseProcedure(null, null, true)).toEqual({ kind: 'none', canWrite: true });
    expect(chooseProcedure(undefined, { ...wp, steps: [] }, false)).toEqual({ kind: 'none', canWrite: false });
  });
});

describe('dans le meme ecran pas a pas que Ducati', () => {
  const p = toProcedure(wp, 'Remarque');
  test('etapes numerotees, outils, remarque', () => {
    expect(p.id).toBe(`${ATELIER_PROCEDURE_PREFIX}p1`);
    expect(p.titre).toBe(wp.op_label);
    expect(p.etapes.map((e) => e.n)).toEqual([1, 2, 3]);
    expect(p.etapes[1].texte).toBe('Déposer le bouchon de vidange.');
    expect(p.outils).toEqual([{ description: 'Clé à filtre' }]);
    expect(p.avertissements).toEqual([{ type: 'remarque', titre: 'Remarque', texte: wp.remarks! }]);
  });
  test('couples : « 20 Nm » en valeur mise en avant ; une plage reste en texte', () => {
    expect(p.couples![0]).toMatchObject({ valeurNm: 20, texte: 'Bouchon de vidange' });
    expect(p.couples![1]).toMatchObject({ valeurNm: null, texte: 'Filtre à huile : 10-12 Nm' });
    expect(parseTorqueNm('12,5 nm')).toBe(12.5);
    expect(parseTorqueNm('25')).toBe(25);
    expect(parseTorqueNm('serrer à la main')).toBeNull();
  });
});

describe('brouillon d\'edition', () => {
  test('page vierge : une etape vide, ce modele-annee, invalide tant que rien n\'est ecrit', () => {
    const d = draftFrom(null);
    expect(d).toEqual({ scope: 'model_year', steps: [''], torques: [], tools: [], remarks: '' });
    expect(draftValid(d)).toBe(false);
  });
  test('reprise de la version enregistree, nettoyage des lignes vides', () => {
    const d = draftFrom(wp);
    expect(d.scope).toBe('model');
    const c = cleanDraft({ ...d, steps: [...d.steps, '  '], tools: ['', ' Clé 32 '], torques: [...d.torques, { label: ' ', value: '' }] });
    expect(c.steps).toHaveLength(3);
    expect(c.tools).toEqual(['Clé 32']);
    expect(c.torques).toHaveLength(2);
    expect(draftValid(c)).toBe(true);
  });
});

describe('portee et lecture de la base', () => {
  const info = { family_name: 'Monster', model_name: '1100 S', model_year: 2009, model_year_name: '1100 S' };
  test('« ce modele-annee » / « toutes les motos de ce modele »', () => {
    expect(scopeName(info, 'model_year')).toBe('Monster 1100 S 2009');
    expect(scopeName(info, 'model')).toBe('Monster 1100 S');
    expect(scopeName({ ...info, model_name: 'MONSTER 1100 S' }, 'model')).toBe('MONSTER 1100 S');
  });
  test('workshop_procedures_for_or → mode operatoire par operation de l\'OR', () => {
    const r = toOrProceduresInfo({
      model_year_id: '1468', model_year: 2009, model_year_name: '1100 S', model_id: '653', model_name: '1100 S', family_name: 'Monster',
      can_write: true, procedures: [{ op_id: 'x', op_key: 'op2', procedure: { ...wp, tools: null } }],
    });
    expect(r.can_write).toBe(true);
    expect(r.byOpKey.get('op2')?.id).toBe('p1');
    expect(r.byOpKey.get('op2')?.tools).toEqual([]);
    expect(toOrProceduresInfo(null).byOpKey.size).toBe(0);
  });
});
