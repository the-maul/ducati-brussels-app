/**
 * M8 — Parcours mecanicien, lots 0 et A (19/11/2026) : regles pures.
 *  - lot 0 : chemin des figures du manuel dans le bucket wsm-images (vignette .DMBI. → figure) ;
 *  - lot A : un seul chrono (pointeuse) — etat de l'OR (en cours / en pause / termine), boutons
 *    Demarrer / Pause / Reprendre / Terminer, temps par operation et total exact, motifs de pause
 *    et statut d'OR propose, temps du recapitulatif du parcours = temps pointe.
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { figureStoragePath } from '../src/modules/workshop/journey/figure-path';
import {
  entryMinutes, isMine, minutesByOperation, orWorkState, proposedOrStatus, reasonLabel, stopKindKey,
  toPauseReason, totalWorkMinutes, workActions, workStateTone, type WorkEntry,
} from '../src/modules/workshop/pointage/rules';
import { summarize } from '../src/modules/workshop/journey/rules';
import type { JourneyState } from '../src/modules/workshop/journey/types';

const OR = 'or-1';
const ME = { userId: 'u-me' };
const at = (hhmm: string) => `2026-11-19T${hhmm}:00.000Z`;
const entry = (p: Partial<WorkEntry>): WorkEntry => ({
  id: Math.random().toString(36).slice(2), kind: 'travail', or_id: OR, mechanic_id: 'u-me', mechanic_code: null,
  mechanic_name: 'Luis', journey_operation: null, started_at: at('08:00'), ended_at: null, minutes: null,
  stop_kind: null, stop_reason: null, ...p,
});

describe('lot 0 — figures du manuel dans le stockage', () => {
  test('chemin du manuel → objet du bucket (prefixe images/ retire)', () => {
    expect(figureStoragePath('images/edocdmimages/CE/CE1C.png')).toBe('edocdmimages/CE/CE1C.png');
    expect(figureStoragePath('edocdmimages/CE/CE1C.png')).toBe('edocdmimages/CE/CE1C.png');
    expect(figureStoragePath('/images/edocdmimages/CE/CE1C.png')).toBe('edocdmimages/CE/CE1C.png');
  });
  test('vignette .DMBI. non envoyee → figure entiere', () => {
    expect(figureStoragePath('edocdmimages/CE/CE1C436F.DMBI.png')).toBe('edocdmimages/CE/CE1C436F.png');
  });
  test('vide → null', () => {
    expect(figureStoragePath(null)).toBeNull();
    expect(figureStoragePath('')).toBeNull();
  });
});

describe('lot A — temps de pointage', () => {
  test('pointage clos : les minutes enregistrees font foi', () => {
    expect(entryMinutes(entry({ ended_at: at('08:50'), minutes: '50.00' }))).toBe(50);
  });
  test('pointage ouvert : compte jusqu\'a maintenant', () => {
    expect(entryMinutes(entry({}), new Date(at('08:30')))).toBe(30);
  });
  test('temps total exact de l\'OR : 50 + 30 (+ pointage ouvert)', () => {
    const list = [
      entry({ ended_at: at('08:50'), minutes: 50, stop_kind: 'pause' }),
      entry({ started_at: at('09:00'), ended_at: at('09:30'), minutes: 30, stop_kind: 'stop' }),
      entry({ kind: 'presence', or_id: null, ended_at: at('18:00'), minutes: 600 }),
      entry({ or_id: 'autre', ended_at: at('11:00'), minutes: 60 }),
    ];
    expect(totalWorkMinutes(list, OR)).toBe(80);
    expect(totalWorkMinutes([...list, entry({ started_at: at('10:00') })], OR, new Date(at('10:15')))).toBe(95);
  });
  test('temps par operation du parcours', () => {
    const list = [
      entry({ journey_operation: 'op1', ended_at: at('08:20'), minutes: 20 }),
      entry({ journey_operation: 'op2', started_at: at('08:20'), ended_at: at('08:35'), minutes: 15 }),
      entry({ journey_operation: 'op1', started_at: at('09:00') }),
    ];
    expect(minutesByOperation(list, OR, new Date(at('09:10')))).toEqual({ op1: 30, op2: 15 });
  });
  test('recapitulatif du parcours : temps passe = temps pointe (plus de chrono a part)', () => {
    const state: JourneyState = {
      version: 1, orId: OR, modelYearId: 'm', serviceLabel: 'S', startedAt: at('08:00'), finishedAt: null,
      operations: [{ id: 'op1', label: 'x', parcoursId: null, done: true, steps: {}, note: '', chrono: [{ startedAt: at('07:00'), endedAt: null }] }],
      findings: [], reportedToOr: false,
    };
    // L'ancien chrono ouvert (fantome) compterait des heures ; la pointeuse dit 80 min.
    expect(summarize(state, {}, 60, 90, new Date(at('12:00')), 80).spent).toBe(80);
    expect(summarize(state, {}, 60, 90, new Date(at('12:00')), 80).times.vsOfficial).toBe(20);
    expect(summarize(state, {}, null, null, new Date(at('12:00'))).spent).toBe(300);
  });
});

describe('lot A — etat de l\'OR et boutons', () => {
  test('rien de pointe : Demarrer', () => {
    const s = orWorkState([], OR, ME);
    expect(s.state).toBe('none');
    expect(workActions(s, { orStatus: 'a_faire', workAllowed: true })).toEqual({ start: true, resume: false, pause: false, finish: false });
  });
  test('en cours (par qui, depuis quand) : Pause et Terminer pour moi', () => {
    const s = orWorkState([entry({ journey_operation: 'op3' })], OR, ME);
    expect(s.state).toBe('running');
    expect(s.running[0]).toMatchObject({ name: 'Luis', since: at('08:00'), operation: 'op3', mine: true });
    expect(workActions(s, { orStatus: 'en_cours', workAllowed: true })).toEqual({ start: false, resume: false, pause: true, finish: true });
    expect(workStateTone(s.state)).toBe('info');
  });
  test('en cours par un autre mecanicien : je peux demarrer aussi', () => {
    const s = orWorkState([entry({ mechanic_id: 'u-autre', mechanic_name: 'John' })], OR, ME);
    expect(s.state).toBe('running');
    expect(s.mineOpen).toBeNull();
    expect(workActions(s, { orStatus: 'en_cours', workAllowed: true }).start).toBe(true);
  });
  test('en pause (motif) : Reprendre depuis n\'importe quel poste', () => {
    const s = orWorkState([entry({ ended_at: at('09:00'), minutes: 60, stop_kind: 'pause', stop_reason: 'attente_piece', journey_operation: 'op2' })], OR, ME);
    expect(s.state).toBe('paused');
    expect(s.last).toMatchObject({ kind: 'pause', reason: 'attente_piece', operation: 'op2' });
    expect(s.mineLastPaused).not.toBeNull();
    expect(workActions(s, { orStatus: 'attente_pieces', workAllowed: true })).toEqual({ start: false, resume: true, pause: false, finish: false });
    expect(workStateTone(s.state)).toBe('warning');
  });
  test('arret automatique et autre OR comptent comme une pause (Reprendre)', () => {
    for (const k of ['auto_stop', 'switch', 'departure']) {
      const s = orWorkState([entry({ ended_at: at('18:00'), minutes: 600, stop_kind: k })], OR, ME);
      expect(s.state).toBe('paused');
      expect(workActions(s, { orStatus: 'en_cours', workAllowed: true }).resume).toBe(true);
    }
  });
  test('Terminer : etat termine, Demarrer reste possible tant que l\'OR est ouvert', () => {
    const s = orWorkState([entry({ ended_at: at('09:00'), minutes: 60, stop_kind: 'stop' })], OR, ME);
    expect(s.state).toBe('stopped');
    expect(workActions(s, { orStatus: 'en_cours', workAllowed: true }).start).toBe(true);
    expect(workActions(s, { orStatus: 'pret', workAllowed: true }).start).toBe(false);
  });
  test('accord client en attente : aucun demarrage', () => {
    const s = orWorkState([], OR, ME);
    expect(workActions(s, { orStatus: 'a_faire', workAllowed: false }).start).toBe(false);
  });
  test('poste partage : le mecanicien est son code mecano', () => {
    expect(isMine({ mechanic_id: null, mechanic_code: 'L01' }, { userId: 'u-me', code: 'L01' })).toBe(true);
    expect(isMine({ mechanic_id: 'u-me', mechanic_code: null }, { userId: 'u-me', code: 'L01' })).toBe(false);
    expect(isMine({ mechanic_id: 'u-me', mechanic_code: 'L01' }, { userId: 'u-me' })).toBe(false);
  });
});

describe('lot A — motifs de pause', () => {
  test('statut d\'OR propose : extra.or_status, sinon le defaut des motifs G8', () => {
    expect(toPauseReason({ code: 'attente_piece', label: 'Attente pièce', extra: { or_status: 'attente_pieces' } }).orStatus).toBe('attente_pieces');
    expect(toPauseReason({ code: 'attente_accord', label: 'Attente accord', extra: null }).orStatus).toBe('attente_devis');
    expect(toPauseReason({ code: 'fin_journee', label: 'Fin', extra: {} }).orStatus).toBeNull();
    expect(toPauseReason({ code: 'x', label: 'X', extra: { or_status: 'facture' } }).orStatus).toBeNull();
  });
  test('statut propose seulement pour un OR a faire / en cours', () => {
    const r = toPauseReason({ code: 'attente_piece', label: 'Attente pièce' });
    expect(proposedOrStatus(r, 'en_cours')).toBe('attente_pieces');
    expect(proposedOrStatus(r, 'attente_pieces')).toBeNull();
    expect(proposedOrStatus(r, 'pret')).toBeNull();
    expect(proposedOrStatus(toPauseReason({ code: 'autre', label: 'Autre' }), 'en_cours')).toBeNull();
  });
  test('libelle : celui de Parametres, sinon celui du DMS, sinon le code', () => {
    const reasons = [toPauseReason({ code: 'attente_piece', label: 'Attente pièce (atelier)' })];
    const tr = (k: string) => (k === 'pointage.reason_autre_or' ? 'Autre OR' : k);
    expect(reasonLabel('attente_piece', reasons, tr)).toBe('Attente pièce (atelier)');
    expect(reasonLabel('autre_or', reasons, tr)).toBe('Autre OR');
    expect(reasonLabel('perso', reasons, tr)).toBe('perso');
    expect(stopKindKey('auto_stop')).toBe('pointage.stop_auto_stop');
    expect(stopKindKey(null)).toBeNull();
  });
});
