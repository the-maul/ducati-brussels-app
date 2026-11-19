/**
 * M8 — Lot « OR lisible » (19/11/2026) : bandeau « Où en est cet OR / prochaine étape », regles pures.
 *  - le cas du client (OR « en cours », personne ne pointe, photos a faire) : une lecture coherente,
 *    l'etape Photos d'abord, un seul gros bouton « Prendre les photos » ;
 *  - apres la serie de photos : etape cochee, bouton « Demarrer » ;
 *  - pointage en cours / en pause / operations x / y / Terminer / Passer pret / Facturer ;
 *  - accord client en attente : rien ne demarre ; garantie en attente : pas de facture ;
 *  - sans pointage en base (lot A absent) : Demarrer = OR en cours ;
 *  - au plus 3 actions secondaires ;
 *  - popup « Commentaire client » : les lignes « Statut G8 : ... » de l'import ne comptent pas ;
 *  - autres OR ouverts de la meme moto.
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { meaningfulClientComment, openSiblings, orProgress, type OrProgressInput } from '../src/modules/workshop/or-base/progress-rules';

const base: OrProgressInput = {
  orStatus: 'a_faire', receptionOn: true, receptionStatus: 'none', photosTaken: 0, photosTotal: 6, photosMissing: 6,
  pointageOn: true, workState: 'none', mineRunning: false, minePaused: false, runningBy: null,
  planTotal: 0, planResolved: 0, planMandatoryOpen: 0, hasService: true, workAllowed: true, warrantyPending: false,
};
const go = (patch: Partial<OrProgressInput>) => orProgress({ ...base, ...patch });
const stateOf = (r: ReturnType<typeof orProgress>, key: string) => r.steps.find((s) => s.key === key)?.state;

describe('le cas du client (OR-2026-00004)', () => {
  test('« en cours » sans pointage ni photos : titre coherent, photos d\'abord', () => {
    const r = go({ orStatus: 'en_cours' });
    expect(r.headline).toBe('in_progress_nobody');
    expect(r.tone).toBe('warning');
    expect(r.current).toBe('reception');
    expect(r.next).toBe('photos');
    expect(stateOf(r, 'reception')).toBe('current');
    // jamais « travail fait » quand personne n'a pointe
    expect(stateOf(r, 'work')).toBe('todo');
  });

  test('apres la serie de photos : etape cochee, gros bouton « Demarrer »', () => {
    const r = go({ orStatus: 'en_cours', receptionStatus: 'complete', photosTaken: 6, photosMissing: 0 });
    expect(stateOf(r, 'reception')).toBe('done');
    expect(r.current).toBe('work');
    expect(stateOf(r, 'work')).toBe('current');
    expect(r.next).toBe('start');
  });

  test('photos incompletes ou remises a plus tard : on peut demarrer, l\'etape le signale', () => {
    expect(stateOf(go({ receptionStatus: 'complete', photosMissing: 2 }), 'reception')).toBe('warning');
    const later = go({ receptionStatus: 'plus_tard' });
    expect(stateOf(later, 'reception')).toBe('skipped');
    expect(later.next).toBe('start');
    expect(later.headline).toBe('todo');
  });
});

describe('travail et operations', () => {
  test('mon pointage tourne, liste d\'operations ouverte : continuer le parcours, Pause / Arreter', () => {
    const r = go({ orStatus: 'en_cours', receptionStatus: 'complete', photosMissing: 0, workState: 'running', mineRunning: true, planTotal: 26, planResolved: 3, planMandatoryOpen: 23 });
    expect(r.headline).toBe('running');
    expect(r.tone).toBe('info');
    expect(r.current).toBe('operations');
    expect(r.next).toBe('journey');
    expect(stateOf(r, 'work')).toBe('done');
    expect(r.steps.find((s) => s.key === 'operations')?.count).toEqual({ done: 3, total: 26 });
    expect(r.side).toEqual(['pause', 'stop']);
  });

  test('toutes les operations obligatoires reglees : Terminer (passer pret)', () => {
    const r = go({ orStatus: 'en_cours', receptionStatus: 'complete', photosMissing: 0, workState: 'running', mineRunning: true, planTotal: 26, planResolved: 26, planMandatoryOpen: 0 });
    expect(r.current).toBe('ready');
    expect(r.next).toBe('finish');
  });

  test('sans liste d\'operations ni entretien : « Passer pret »', () => {
    const r = go({ orStatus: 'en_cours', receptionStatus: 'complete', photosMissing: 0, workState: 'running', mineRunning: true, hasService: false });
    expect(r.next).toBe('ready');
    expect(r.steps.map((s) => s.key)).toEqual(['reception', 'work', 'ready', 'invoice']);
  });

  test('mon pointage en pause : Reprendre', () => {
    const r = go({ orStatus: 'en_cours', receptionStatus: 'complete', photosMissing: 0, workState: 'paused', minePaused: true });
    expect(r.headline).toBe('paused');
    expect(r.next).toBe('resume');
  });

  test('un collegue pointe : je peux demarrer aussi', () => {
    const r = go({ orStatus: 'en_cours', receptionStatus: 'complete', photosMissing: 0, workState: 'running', runningBy: 'Marco' });
    expect(r.headline).toBe('running');
    expect(r.next).toBe('start');
  });

  test('attente pieces : titre « en attente de pieces »', () => {
    expect(go({ orStatus: 'attente_pieces', receptionStatus: 'complete', photosMissing: 0 }).headline).toBe('waiting_parts');
  });
});

describe('fin de parcours', () => {
  test('pret : facturer, prevenir le client', () => {
    const r = go({ orStatus: 'pret', receptionStatus: 'complete', photosMissing: 0, workState: 'stopped' });
    expect(r.headline).toBe('ready');
    expect(r.tone).toBe('success');
    expect(r.current).toBe('invoice');
    expect(r.next).toBe('invoice');
    expect(r.side).toContain('notify_ready');
    expect(stateOf(r, 'ready')).toBe('done');
  });

  test('garantie en attente : pas de bouton Facturer', () => {
    expect(go({ orStatus: 'pret', warrantyPending: true }).next).toBe('none');
  });

  test('facture : voir la facture, tout est fait', () => {
    const r = go({ orStatus: 'facture', receptionStatus: 'complete', photosMissing: 0, workState: 'stopped' });
    expect(r.next).toBe('view_invoice');
    expect(r.current).toBeNull();
    expect(stateOf(r, 'invoice')).toBe('done');
  });

  test('annule : aucun geste', () => {
    const r = go({ orStatus: 'annule' });
    expect(r.next).toBe('none');
    expect(r.headline).toBe('cancelled');
  });
});

describe('garde-fous', () => {
  test('accord client en attente : rien ne demarre, titre « bloque »', () => {
    const r = go({ workAllowed: false, receptionStatus: 'complete', photosMissing: 0 });
    expect(r.headline).toBe('blocked_approval');
    expect(r.tone).toBe('danger');
    expect(r.next).toBe('none');
    expect(r.side).toContain('approval');
  });

  test('sans pointage en base : Demarrer passe l\'OR en cours, puis parcours', () => {
    expect(go({ pointageOn: false, receptionStatus: 'complete', photosMissing: 0 }).next).toBe('start');
    const r = go({ pointageOn: false, orStatus: 'en_cours', receptionStatus: 'complete', photosMissing: 0 });
    expect(r.headline).toBe('running');
    expect(r.next).toBe('journey');
  });

  test('sans photos de reception en base : pas d\'etape photos', () => {
    const r = go({ receptionOn: false });
    expect(r.steps[0].key).toBe('work');
    expect(r.next).toBe('start');
    expect(r.headline).toBe('todo');
  });

  test('jamais plus de 3 actions secondaires', () => {
    const r = go({ orStatus: 'en_cours', workState: 'running', mineRunning: true, workAllowed: true, planTotal: 0 });
    expect(r.side.length).toBeLessThanOrEqual(3);
  });
});

describe('popup « Commentaire client »', () => {
  test('les lignes « Statut G8 : ... » de l\'import ne sont pas un commentaire', () => {
    expect(meaningfulClientComment('Statut G8 : Client')).toBe('');
    expect(meaningfulClientComment('statut g8 : Client pièces')).toBe('');
    expect(meaningfulClientComment(null)).toBe('');
    expect(meaningfulClientComment('  ')).toBe('');
  });
  test('un vrai commentaire reste, sans la ligne technique', () => {
    expect(meaningfulClientComment('Statut G8 : Client\nPaie toujours en liquide')).toBe('Paie toujours en liquide');
    expect(meaningfulClientComment('Client exigeant sur les délais')).toBe('Client exigeant sur les délais');
  });
});

describe('autres OR ouverts de la meme moto', () => {
  test('ouverts seulement, sans l\'OR affiche, du plus recent au plus ancien', () => {
    const rows = [
      { id: 'a', number: 'OR-3', status: 'en_cours', created_at: '2026-11-03T15:27:50Z' },
      { id: 'b', number: 'OR-4', status: 'en_cours', created_at: '2026-11-19T09:29:31Z' },
      { id: 'c', number: 'OR-5', status: 'a_faire', created_at: '2026-11-19T12:23:40Z' },
      { id: 'd', number: 'OR-1', status: 'facture', created_at: '2026-09-01T10:00:00Z' },
    ];
    expect(openSiblings(rows, 'b').map((r) => r.number)).toEqual(['OR-5', 'OR-3']);
    expect(openSiblings([], 'b')).toEqual([]);
  });
});
