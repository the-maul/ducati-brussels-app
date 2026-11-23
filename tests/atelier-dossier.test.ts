/**
 * M8 — Chantier C1 (23/11/2026) : règle de l'étape du dossier moto (Réserver → Rentrer →
 * Travailler → Payer et sortir), variantes comprises. Exécution : `bun test`.
 */
import { describe, expect, test } from 'bun:test';
import { linesToReserve, type DossierLineLite } from '../src/modules/workshop/dossier/rules';
import { focusTransform } from '../src/modules/catalog/format';
import { cardDossierStep } from '../src/modules/workshop/my-workshop/card-view';
import { withoutPhotoData } from '../src/modules/workshop/journey/store';
import { emptyJourney, journeyStarted } from '../src/modules/workshop/journey/finding-photos';
import {
  DOSSIER_STEPS, VARIANT_STEPS, dossierFlow, dossierPrimary, dossierVariant, invoicePaid, paymentNotNeeded, viewedStep,
  type DossierFacts, type DossierStepKey,
} from '../src/modules/workshop/dossier/rules';

const appt = (p: Partial<NonNullable<DossierFacts['appointment']>> = {}): NonNullable<DossierFacts['appointment']> => ({
  status: 'prevu', unassigned: false, hasMechanic: true, day: '2026-11-25', hasWork: true, reasonCode: null, ...p,
});
const or = (p: Partial<NonNullable<DossierFacts['or']>> = {}): NonNullable<DossierFacts['or']> => ({
  status: 'a_faire', customerApproval: null, warrantyStatus: 'aucune', reasonCode: null, repairType: null,
  serviceCode: null, hasVehicle: true, hasContact: true, mileage: 12000, ...p,
});
const facts = (p: Partial<DossierFacts> = {}): DossierFacts => ({
  today: '2026-11-23', appointment: appt(), or: null,
  receptionReady: true, receptionStatus: 'none', photosMissing: 0,
  pointageReady: true, workState: 'none', mineRunning: false, minePaused: false,
  planTotal: 0, planResolved: 0, planMandatoryOpen: 0, partsTotal: 0, partsMissing: 0,
  invoice: null, handedOver: false, ...p,
});
const states = (f: DossierFacts) => dossierFlow(f).steps.map((s) => s.state);
const primary = (f: DossierFacts, viewed?: DossierStepKey) => {
  const flow = dossierFlow(f);
  return dossierPrimary(f, flow, viewed ?? flow.current ?? 'payer');
};
const task = (f: DossierFacts, step: DossierStepKey, key: string) => dossierFlow(f).tasks[step].find((x) => x.key === key)?.state;
const entered = (p: Partial<DossierFacts> = {}) => facts({ or: or(), receptionStatus: 'complete', ...p });

describe('Réserver', () => {
  test('demande du client : à placer', () => {
    const f = facts({ appointment: appt({ status: 'demande', hasMechanic: false }) });
    expect(dossierFlow(f).current).toBe('reserver');
    expect(primary(f)).toEqual({ action: 'schedule', skip: 'view_next' });
  });
  test('RDV sans compagnon : à placer', () => {
    expect(dossierFlow(facts({ appointment: appt({ unassigned: true, hasMechanic: false }) })).current).toBe('reserver');
  });
  test('RDV placé, pièces couvertes : la moto peut rentrer', () => {
    const f = facts({ partsTotal: 2 });
    expect(states(f)).toEqual(['done', 'current', 'todo', 'todo']);
    expect(primary(f).action).toBe('create_or');
  });
  test('pièce manquante avant le jour J : reste à Réserver, on peut avancer', () => {
    const f = facts({ partsTotal: 2, partsMissing: 1 });
    expect(dossierFlow(f).current).toBe('reserver');
    expect(primary(f).action).toBe('next_step');
    expect(task(f, 'reserver', 'parts')).toBe('warning');
    // « Étape suivante » mène à Rentrer, qui doit proposer d'entrer la moto (pas de retour en boucle).
    expect(primary(f, 'rentrer').action).toBe('create_or');
  });
  test('demande pas encore placée : Rentrer renvoie à l\'étape en cours', () => {
    const f = facts({ appointment: appt({ status: 'demande', hasMechanic: false }) });
    expect(primary(f, 'rentrer').action).toBe('go_current');
  });
  test('pièce manquante le jour J : la moto rentre quand même', () => {
    const f = facts({ today: '2026-11-25', partsTotal: 2, partsMissing: 1 });
    expect(dossierFlow(f).current).toBe('rentrer');
  });
  test('passage sans RDV : Réserver est sans objet', () => {
    const f = entered({ appointment: null });
    expect(states(f)[0]).toBe('na');
    expect(dossierFlow(f).current).toBe('travailler');
  });
});

describe('Pièces tapées sur l\'OR', () => {
  const line = (article_id: string, quantity: number, over: Partial<DossierLineLite> = {}): DossierLineLite =>
    ({ article_id, quantity, checkup_state: null, mgmt_type: 'A', is_active: true, ...over });
  test('une pièce sans réservation est à réserver', () => {
    expect(linesToReserve([line('a', 2)], [])).toBe(1);
  });
  test('couverte, ou déjà dans le kit : rien à faire', () => {
    expect(linesToReserve([line('a', 2)], [{ article_id: 'a', origin: 'manuel', qty_needed: 2 }])).toBe(0);
    expect(linesToReserve([line('a', 5)], [{ article_id: 'a', origin: 'atelier', qty_needed: 2 }])).toBe(0);
  });
  test('quantité augmentée sur une réservation manuelle : à réserver', () => {
    expect(linesToReserve([line('a', 1), line('a', 2)], [{ article_id: 'a', origin: 'manuel', qty_needed: 2 }])).toBe(1);
  });
  test('constats et articles non stockés ignorés', () => {
    expect(linesToReserve([
      line('a', 1, { checkup_state: 'ok' }), line('b', 1, { checkup_state: 'a_prevoir' }), line('c', 1, { checkup_state: 'reporte' }),
      line('d', 1, { mgmt_type: 'M' }), line('e', 1, { is_active: false }), line('f', 0),
    ], [])).toBe(0);
    expect(linesToReserve([line('a', 1, { checkup_state: 'a_faire' })], [])).toBe(1);
  });
});

describe('Rentrer', () => {
  test('pas d\'OR à la prise de RDV : il naît à l\'entrée', () => {
    const f = facts();
    expect(task(f, 'rentrer', 'or')).toBe('todo');
    expect(primary(f).action).toBe('create_or');
  });
  test('OR créé, photos à faire ou à passer', () => {
    const f = facts({ or: or() });
    expect(dossierFlow(f).current).toBe('rentrer');
    expect(primary(f)).toEqual({ action: 'photos', skip: 'photos_later' });
  });
  test('photos « plus tard » : on passe à Travailler', () => {
    const f = facts({ or: or(), receptionStatus: 'plus_tard' });
    expect(dossierFlow(f).current).toBe('travailler');
    expect(task(f, 'rentrer', 'photos')).toBe('skipped');
  });
  test('photos incomplètes : signalé, jamais bloquant', () => {
    const f = facts({ or: or(), receptionStatus: 'complete', photosMissing: 2 });
    expect(dossierFlow(f).current).toBe('travailler');
    expect(task(f, 'rentrer', 'photos')).toBe('warning');
  });
  test.each(['en_attente', 'refuse'])('accord %s : bloqué à Rentrer', (customerApproval) => {
    const f = entered({ or: or({ customerApproval }) });
    const flow = dossierFlow(f);
    expect(flow.current).toBe('rentrer');
    expect(flow.blocked).toBe('approval');
    expect(primary(f).action).toBe('approval');
  });
  test.each(['signe', 'accord_verbal'])('accord %s : on travaille', (customerApproval) => {
    const f = entered({ or: or({ customerApproval }) });
    expect(dossierFlow(f).current).toBe('travailler');
    expect(task(f, 'rentrer', 'approval')).toBe('done');
  });
  test('sans la migration des photos : pas d\'étape photo', () => {
    const f = facts({ or: or(), receptionReady: false });
    expect(dossierFlow(f).current).toBe('travailler');
    expect(task(f, 'rentrer', 'photos')).toBe('na');
  });
});

describe('Travailler', () => {
  test('à démarrer', () => expect(primary(entered()).action).toBe('start'));
  test('mon pointage en pause : Reprendre', () => {
    const f = entered({ or: or({ status: 'en_cours' }), workState: 'paused', minePaused: true });
    expect(primary(f).action).toBe('resume');
    expect(task(f, 'travailler', 'pointage')).toBe('paused');
  });
  test('je pointe, opérations ouvertes : parcours guidé', () => {
    const f = entered({ or: or({ status: 'en_cours', serviceCode: 'annual' }), workState: 'running', mineRunning: true, planTotal: 5, planResolved: 2, planMandatoryOpen: 3 });
    expect(primary(f).action).toBe('journey');
  });
  test('opérations réglées : Moto prête', () => {
    const f = entered({ or: or({ status: 'en_cours' }), workState: 'running', mineRunning: true, planTotal: 5, planResolved: 5 });
    expect(primary(f).action).toBe('ready');
  });
  test('sans liste d\'opérations : Moto prête', () => {
    const f = entered({ or: or({ status: 'en_cours' }), workState: 'running', mineRunning: true });
    expect(primary(f).action).toBe('ready');
    expect(task(f, 'travailler', 'operations')).toBe('na');
  });
  test('devis complémentaire en cours de travail : bloqué à Travailler', () => {
    const f = entered({ or: or({ status: 'en_cours', customerApproval: 'en_attente' }), workState: 'paused', minePaused: true });
    const flow = dossierFlow(f);
    expect(flow.current).toBe('travailler');
    expect(flow.blocked).toBe('approval');
    expect(primary(f).action).toBe('approval');
  });
  test('attente pièces : toujours à Travailler, on peut démarrer', () => {
    const f = entered({ or: or({ status: 'attente_pieces' }) });
    expect(dossierFlow(f).current).toBe('travailler');
    expect(primary(f).action).toBe('start');
  });
  test('Travailler ne se passe pas', () => expect(primary(entered()).skip).toBeNull());
});

describe('Payer et sortir', () => {
  const inv = (p: Partial<NonNullable<DossierFacts['invoice']>> = {}) => ({ status: 'validee', totalTtc: 250, paidAmount: 0, ...p });
  test('prête : prévenir le client, ou passer à la facture', () => {
    const f = entered({ or: or({ status: 'pret' }) });
    expect(dossierFlow(f).current).toBe('payer');
    expect(primary(f)).toEqual({ action: 'notify', skip: 'invoice' });
  });
  test('prête sans client : facture directe', () => {
    expect(primary(entered({ or: or({ status: 'pret', hasContact: false }) })).action).toBe('invoice');
  });
  test('client informé : facture', () => {
    const f = entered({ or: or({ status: 'client_informe' }) });
    expect(primary(f).action).toBe('invoice');
    expect(task(f, 'payer', 'notify')).toBe('done');
  });
  test('facturée, non réglée : encaisser, ou sortir à crédit', () => {
    const f = entered({ or: or({ status: 'facture' }), invoice: inv() });
    expect(primary(f)).toEqual({ action: 'pay', skip: 'handover' });
  });
  test('réglée : la sortie reste une étape visible', () => {
    const f = entered({ or: or({ status: 'facture' }), invoice: inv({ status: 'payee', paidAmount: 250 }) });
    expect(dossierFlow(f).current).toBe('payer');
    expect(primary(f).action).toBe('handover');
    expect(task(f, 'payer', 'handover')).toBe('todo');
  });
  test('réglée et remise : dossier clos', () => {
    const f = entered({ or: or({ status: 'facture' }), invoice: inv({ status: 'payee', paidAmount: 250 }), handedOver: true });
    const flow = dossierFlow(f);
    expect(flow.closed).toBe(true);
    expect(flow.current).toBeNull();
    expect(states(f)).toEqual(['done', 'done', 'done', 'done']);
    expect(primary(f).action).toBe('none');
  });
  test('remise à crédit : reste à encaisser', () => {
    const f = entered({ or: or({ status: 'facture' }), invoice: inv(), handedOver: true });
    expect(dossierFlow(f).closed).toBe(false);
    expect(primary(f)).toEqual({ action: 'pay', skip: null });
  });
  test('paiement partiel : pas soldée', () => expect(invoicePaid(inv({ paidAmount: 100 }))).toBe(false));
  test('paiement au centime près', () => expect(invoicePaid(inv({ paidAmount: 249.999 }))).toBe(true));
  test('facture avec avoir : rien à encaisser', () => expect(paymentNotNeeded(inv({ status: 'avoir_emis' }))).toBe(true));
});

describe('Variantes', () => {
  const inv0 = { status: 'validee', totalTtc: 0, paidAmount: 0 };
  test('type du dossier', () => {
    expect(dossierVariant({ or: or(), appointment: null })).toBe('client');
    expect(dossierVariant({ or: or({ reasonCode: 'accident' }), appointment: null })).toBe('accident');
    expect(dossierVariant({ or: or({ repairType: 'accident' }), appointment: null })).toBe('accident');
    expect(dossierVariant({ or: or({ reasonCode: 'garantie' }), appointment: null })).toBe('garantie');
    expect(dossierVariant({ or: or({ repairType: 'garantie_ducati' }), appointment: null })).toBe('garantie');
    expect(dossierVariant({ or: or({ warrantyStatus: 'acceptee' }), appointment: null })).toBe('garantie');
    expect(dossierVariant({ or: null, appointment: appt({ reasonCode: 'garantie' }) })).toBe('garantie');
  });
  test('garantie en attente : pas de facture', () => {
    const f = entered({ or: or({ status: 'pret', reasonCode: 'garantie', warrantyStatus: 'en_attente' }) });
    const flow = dossierFlow(f);
    expect(flow.blocked).toBe('warranty');
    expect(task(f, 'payer', 'invoice')).toBe('blocked');
    expect(primary(f).action).toBe('none');
  });
  test('garantie à 0 € : règlement sans objet, la sortie reste à faire', () => {
    const f = entered({ or: or({ status: 'facture', reasonCode: 'garantie', warrantyStatus: 'acceptee' }), invoice: inv0 });
    expect(task(f, 'payer', 'payment')).toBe('na');
    expect(primary(f).action).toBe('handover');
  });
  test('garantie à 0 € remise : clos', () => {
    expect(dossierFlow(entered({ or: or({ status: 'facture', warrantyStatus: 'acceptee' }), invoice: inv0, handedOver: true })).closed).toBe(true);
  });
  test('accident : mêmes 4 étapes', () => {
    const f = entered({ or: or({ reasonCode: 'accident' }) });
    expect(dossierFlow(f).variant).toBe('accident');
    expect(states(f)).toEqual(['done', 'done', 'current', 'todo']);
  });
  test('préparés pour C4 : neuve, occasion, interne sans Réserver ni Payer', () => {
    for (const v of ['neuve', 'occasion', 'interne'] as const) {
      expect(VARIANT_STEPS[v]).toEqual({ reserver: false, rentrer: true, travailler: true, payer: false });
    }
  });
  test('chaque variante décrit les 4 étapes', () => {
    for (const steps of Object.values(VARIANT_STEPS)) expect(Object.keys(steps)).toEqual([...DOSSIER_STEPS]);
  });
});

describe('Mon atelier : la carte ouvre la bonne étape', () => {
  const base = { receptionReady: true, pointageReady: true, today: '2026-11-23' };
  const dayOr = (p = {}) => ({ id: 'o1', number: 'OR-1', status: 'a_faire', created_at: '2026-11-23T08:00:00Z', operator: null, work_description: null, ...p });
  const dayRdv = (p = {}) => ({ id: 'a1', starts_at: '2026-11-23T09:00:00Z', status: 'prevu', or_id: null, mechanic_id: 'm1', mechanic_name: 'John', unassigned: false, planned_minutes: 60, work_description: 'Entretien', ...p });
  test('RDV du jour sans OR : Rentrer', () => expect(cardDossierStep({ or: null, appointment: dayRdv(), work: null } as never, base)).toBe('rentrer'));
  test('OR sans photos : Rentrer', () => expect(cardDossierStep({ or: dayOr(), appointment: null, work: null } as never, base)).toBe('rentrer'));
  test('OR, photos faites : Travailler', () => {
    expect(cardDossierStep({ or: dayOr(), appointment: null, work: null } as never, { ...base, reception: { status: 'complete', missing: 0 } })).toBe('travailler');
  });
  test('OR prêt : Payer et sortir', () => expect(cardDossierStep({ or: dayOr({ status: 'pret' }), appointment: null, work: null } as never, base)).toBe('payer'));
});

describe('Vue éclatée : zoom sur la pièce', () => {
  test('centrée sur le repère', () => {
    const z = focusTransform({ left: 48, top: 48, width: 4, height: 4 });
    expect(z.scale).toBe(2.2); // assez large pour voir la pièce au bout du trait
    expect(z.x + 50 * z.scale).toBeCloseTo(50);
    expect(z.y + 50 * z.scale).toBeCloseTo(50);
  });
  test('repère dans un coin : pas de bord vide', () => {
    const a = focusTransform({ left: 0, top: 0, width: 2, height: 2 });
    expect([a.x, a.y]).toEqual([0, 0]);
    const b = focusTransform({ left: 98, top: 98, width: 2, height: 2 });
    expect(b.x).toBeCloseTo(100 - 100 * b.scale);
    expect(b.y).toBeCloseTo(100 - 100 * b.scale);
  });
  test('grande zone : zoom limité, jamais sous 1', () => {
    expect(focusTransform({ left: 0, top: 0, width: 90, height: 90 }).scale).toBe(1);
  });
});

describe('Photos du parcours', () => {
  const f = { id: 'f1', kind: 'photo' as const, operationId: 'op1', stepNo: 2, texte: 'Fuite', at: '2026-11-23T10:00:00Z' };
  test('jamais de base64 dans l\'état envoyé en base', () => {
    const s = { ...emptyJourney('or1'), findings: [{ ...f, photoName: 'a.jpg', photoData: 'data:image/jpeg;base64,AAAA' }] };
    expect(JSON.stringify(withoutPhotoData(s))).not.toContain('base64');
    expect(withoutPhotoData(s).findings[0].photoName).toBe('a.jpg');
  });
  test('le chemin dans les documents est conservé', () => {
    const s = { ...emptyJourney('or1'), findings: [{ ...f, photoPath: 'co/repair_order/or1/1_a.jpg' }] };
    expect(withoutPhotoData(s).findings[0].photoPath).toBe('co/repair_order/or1/1_a.jpg');
  });
  test('un simple commentaire ne commence pas le parcours', () => {
    expect(journeyStarted({ ...emptyJourney('or1'), findings: [f] })).toBe(false);
    expect(journeyStarted(null)).toBe(false);
  });
});

describe('Annulé et navigation', () => {
  test('OR annulé : tout est sans objet', () => {
    const f = entered({ or: or({ status: 'annule' }) });
    const flow = dossierFlow(f);
    expect(flow.cancelled).toBe(true);
    expect(states(f)).toEqual(['na', 'na', 'na', 'na']);
    expect(primary(f, 'rentrer').action).toBe('none');
  });
  test('RDV annulé sans OR', () => expect(dossierFlow(facts({ appointment: appt({ status: 'annule' }) })).cancelled).toBe(true));
  test('revenir sur une étape passée : le bouton ramène à l\'étape en cours', () => {
    const f = entered();
    expect(primary(f, 'rentrer')).toEqual({ action: 'go_current', skip: null });
  });
  test('étape demandée dans l\'adresse', () => {
    const flow = dossierFlow(entered());
    expect(viewedStep(flow, 'rentrer')).toBe('rentrer');
    expect(viewedStep(flow, null)).toBe('travailler');
  });
  test('étape sans objet demandée : on revient à l\'étape en cours', () => {
    expect(viewedStep(dossierFlow(entered({ appointment: null })), 'reserver')).toBe('travailler');
  });
  test('dossier clos : ouvre la dernière étape', () => {
    const flow = dossierFlow(entered({ or: or({ status: 'facture' }), invoice: { status: 'payee', totalTtc: 10, paidAmount: 10 }, handedOver: true }));
    expect(viewedStep(flow, null)).toBe('payer');
  });
});
