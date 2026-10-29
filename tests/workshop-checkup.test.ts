/**
 * Tests M8 / M9 — Check-up a l'accueil, proposition d'intervention, accord client, interventions
 * reportees (ATE008 / ATE009, decision client du 30/10/2026). Regles pures, aucun appel reseau.
 *   - prix d'une carte (MO = heures x taux horaire HT + pieces au PV) et total du check-up ;
 *   - cartes ↔ lignes de l'OR (aller-retour sans perte) ;
 *   - partition gardees / reportees a la signature, creation des reportees ;
 *   - texte accepte deterministe et son empreinte SHA-256 ;
 *   - garde-fou : pas de demarrage sans accord trace ;
 *   - date par defaut des interventions reportees au comptoir (+30 jours) ;
 *   - lignes facturables (jamais OK ni reportees) ; choix de l'echeance selon le motif ;
 *   - lien de signature cliquable dans le mail.
 */
import { test, expect, describe } from 'bun:test';
import {
  acceptedTextFor, blankCard, blankPart, canStartWork, approvalState, cardPrice, cardsToLines, checkupTotals,
  defaultPlannedDate, deferredFromDeclined, invoiceableRoLines, isMaintenanceReason, linesToCards, partitionProposal,
  pickServiceForReason, proposalGroups, sha256Hex, type CheckupCard, type ProposalLine,
} from '../src/modules/workshop/checkup/rules';
import { computeRoTotals } from '../src/modules/workshop/write-api';
import { plainTextToHtml } from '../src/modules/sales/document-mail-api';
import { acceptedText, groupsFor, proposalPdfInput, type ProposalPayload } from '../src/modules/documents/proposal-sign';

const card = (p: Partial<CheckupCard> = {}): CheckupCard => blankCard({ key: 'k1', label: 'Plaquettes avant', state: 'a_faire', hours: 1.5, hourly_rate_ht: null, ...p });

describe('check-up — prix d\'une carte et total', () => {
  test('MO = heures x taux horaire HT, pieces = qte x PV, TTC avec la TVA de chaque partie', () => {
    const c = card({ parts: [blankPart({ designation: 'Plaquettes', quantity: 2, unit_price_ht: 40, vat_rate: 21 })] });
    const p = cardPrice(c, 90);
    expect(p.labourHt).toBe(135);          // 1,5 h x 90 €
    expect(p.partsHt).toBe(80);            // 2 x 40 €
    expect(p.totalHt).toBe(215);
    expect(p.totalTtc).toBe(260.15);       // 215 x 1,21
  });

  test('taux fige sur la carte prioritaire ; sans taux connu, la main-d\'oeuvre vaut 0', () => {
    expect(cardPrice(card({ hourly_rate_ht: 100 }), 90).labourHt).toBe(150);
    expect(cardPrice(card(), null).labourHt).toBe(0);
    expect(cardPrice(card({ hours: 0 }), 90).labourHt).toBe(0);
  });

  test('le total du check-up ne compte que « a faire » et « a prevoir »', () => {
    const cards = [
      card({ key: 'a', state: 'a_faire' }),                       // 135 HT
      card({ key: 'b', state: 'a_prevoir', hours: 1 }),           // 90 HT
      card({ key: 'c', state: 'ok', hours: 3 }),                  // ignoree
      card({ key: 'd', state: 'reporte', hours: 2 }),             // ignoree
    ];
    const tot = checkupTotals(cards, 90);
    expect(tot.count).toBe(2);
    expect(tot.ht).toBe(225);
    expect(tot.ttc).toBe(272.25);
    expect(tot.vat).toBe(47.25);
  });
});

describe('check-up — cartes et lignes de l\'OR', () => {
  test('une carte devient une ligne MO + ses pieces, toutes avec la meme cle et le meme etat', () => {
    const c = card({ photo_path: 'co/repair_order/or/1_photo.jpg', parts: [blankPart({ article_id: 'art1', designation: 'Plaquettes', quantity: 2, unit_price_ht: 40 })] });
    const lines = cardsToLines([c], 90);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: 'mo', designation: 'Plaquettes avant', quantity: 1.5, unit_price_ht: 90, checkup_key: 'k1', checkup_state: 'a_faire', photo_path: 'co/repair_order/or/1_photo.jpg' });
    expect(lines[1]).toMatchObject({ kind: 'piece', article_id: 'art1', quantity: 2, unit_price_ht: 40, checkup_key: 'k1', checkup_state: 'a_faire', photo_path: null });
    // Les totaux de l'OR suivent (MO 135 + pieces 80).
    expect(computeRoTotals(lines).total_ht).toBe(215);
  });

  test('aller-retour lignes → cartes sans perte ; les lignes classiques restent a part', () => {
    const c = card({ parts: [blankPart({ article_id: 'art1', designation: 'Plaquettes', quantity: 2, unit_price_ht: 40 })] });
    const back = linesToCards([
      { kind: 'piece', designation: 'Huile classique', quantity: 1, unit_price_ht: 10, vat_rate: 21 },
      ...cardsToLines([c], 90),
    ]);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ key: 'k1', label: 'Plaquettes avant', state: 'a_faire', hours: 1.5, hourly_rate_ht: 90 });
    expect(back[0].parts).toHaveLength(1);
    expect(back[0].parts[0]).toMatchObject({ article_id: 'art1', quantity: 2, unit_price_ht: 40 });
  });

  test('les totaux de l\'OR ignorent les actions OK et reportees ; la facture aussi, et une carte sans heures devient un texte', () => {
    const lines = [
      ...cardsToLines([card({ key: 'a', state: 'a_faire' })], 90),
      ...cardsToLines([card({ key: 'b', state: 'ok', hours: 2 })], 90),
      ...cardsToLines([card({ key: 'c', state: 'reporte', hours: 2 })], 90),
      ...cardsToLines([card({ key: 'd', state: 'a_faire', hours: 0, label: 'Pneu arriere a surveiller' })], 90),
    ];
    expect(computeRoTotals(lines).total_ht).toBe(135);
    const inv = invoiceableRoLines(lines);
    expect(inv.map((l) => l.checkup_state)).toEqual(['a_faire', 'a_faire']);
    expect(inv[1]).toMatchObject({ designation: 'Pneu arriere a surveiller', as_text: true });
    expect(inv[0].as_text).toBe(false);
  });
});

const L = (p: Partial<ProposalLine> & { id: string }): ProposalLine => ({
  line_type: 'article', designation: 'x', quantity: 1, unit_price_ht: 0, vat_rate: 21, line_ht: 0, line_ttc: 0, sort_order: 0, ...p,
});
const proposalLines: ProposalLine[] = [
  L({ id: 'l1', line_type: 'main_oeuvre', designation: 'Plaquettes avant', quantity: 1.5, unit_price_ht: 90, line_ht: 135, line_ttc: 163.35, sort_order: 0, checkup_key: 'k1', photo_path: 'p.jpg' }),
  L({ id: 'l2', designation: 'Plaquettes', quantity: 2, unit_price_ht: 40, line_ht: 80, line_ttc: 96.8, sort_order: 1, checkup_key: 'k1' }),
  L({ id: 'l3', line_type: 'main_oeuvre', designation: 'Pneu arriere', quantity: 0.5, unit_price_ht: 90, line_ht: 45, line_ttc: 54.45, sort_order: 2, checkup_key: 'k2' }),
  L({ id: 'l4', designation: 'Pneu 180/55', quantity: 1, unit_price_ht: 200, line_ht: 200, line_ttc: 242, sort_order: 3, checkup_key: 'k2' }),
  L({ id: 'l5', designation: 'Ligne isolee', quantity: 1, unit_price_ht: 10, line_ht: 10, line_ttc: 12.1, sort_order: 4 }),
];

describe('signature — partition gardees / reportees', () => {
  test('une case par carte : la ligne de tete est la main-d\'oeuvre, la photo et le total suivent', () => {
    const groups = proposalGroups(proposalLines);
    expect(groups.map((g) => g.id)).toEqual(['l1', 'l3', 'l5']);
    expect(groups[0]).toMatchObject({ label: 'Plaquettes avant', hours: 1.5, photo_path: 'p.jpg', totalHt: 215, totalTtc: 260.15 });
    expect(groups[1].totalTtc).toBe(296.45);
    expect(groups[2]).toMatchObject({ label: 'Ligne isolee', totalTtc: 12.1 });
  });

  test('decocher une carte reporte toutes ses lignes ; le total se recalcule', () => {
    const groups = proposalGroups(proposalLines);
    const part = partitionProposal(groups, ['l1', 'l5']);
    expect(part.kept.map((g) => g.id)).toEqual(['l1', 'l5']);
    expect(part.deferred.map((g) => g.id)).toEqual(['l3']);
    expect(part.keptLineIds).toEqual(['l1', 'l2', 'l5']);
    expect(part.totalTtc).toBe(272.25);
    expect(part.deferredTtc).toBe(296.45);
  });

  test('les cartes decochees deviennent des interventions reportees « a planifier », avec leur montant TTC', () => {
    const part = partitionProposal(proposalGroups(proposalLines), ['l1']);
    const def = deferredFromDeclined(part.deferred);
    expect(def).toEqual([
      { document_line_id: 'l3', label: 'Pneu arriere', amount_ttc: 296.45, status: 'a_planifier' },
      { document_line_id: 'l5', label: 'Ligne isolee', amount_ttc: 12.1, status: 'a_planifier' },
    ]);
  });
});

describe('signature — texte accepte et empreinte', () => {
  const base = {
    number: 'DEV-2026-0042', companyName: 'ITALBIKE STORE', clientName: 'Jean Dupont', vehicleLabel: 'Ducati Monster (1-ABC-123)',
    signerName: 'Jean Dupont', sentence: 'J\'accepte les travaux coches.', dateIso: '2026-10-31T10:00:00.000Z',
  };
  test('le texte est deterministe et reprend les cartes gardees, le total et le nom', () => {
    const part = partitionProposal(proposalGroups(proposalLines), ['l1', 'l5']);
    const text = acceptedTextFor({ ...base, kept: part.kept, totalTtc: part.totalTtc });
    expect(text).toBe([
      'ITALBIKE STORE - DEV-2026-0042', 'Client : Jean Dupont', 'Moto : Ducati Monster (1-ABC-123)',
      '[x] Plaquettes avant - 260,15 EUR', '[x] Ligne isolee - 12,10 EUR', 'Total TTC : 272,25 EUR',
      'J\'accepte les travaux coches.', 'Jean Dupont - 2026-10-31',
    ].join('\n'));
    expect(acceptedTextFor({ ...base, kept: part.kept, totalTtc: part.totalTtc })).toBe(text);
  });

  test('SHA-256 : 64 hexa, stable, et change des qu\'une carte change', async () => {
    const groups = proposalGroups(proposalLines);
    const a = acceptedTextFor({ ...base, kept: partitionProposal(groups, ['l1', 'l5']).kept, totalTtc: 272.25 });
    const b = acceptedTextFor({ ...base, kept: partitionProposal(groups, ['l1']).kept, totalTtc: 260.15 });
    const ha = await sha256Hex(a);
    expect(ha).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(a)).toBe(ha);
    expect(await sha256Hex(b)).not.toBe(ha);
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('texte dans la langue du client et PDF signe sur les lignes gardees', () => {
    const payload: ProposalPayload = {
      document_id: 'd1', number: 'DEV-2026-0042', issue_date: '2026-10-31', created_at: '2026-10-31T09:00:00Z', status: 'en_attente',
      accepted_at: null, expires_at: null, total_ht: 460, total_vat: 96.6, total_ttc: 556.6, notes: null, operator: 'Domenico',
      company: { id: 'c', name: 'ITALBIKE STORE', legal_name: null, address: null, zip: null, city: null, vat_number: null, iban: null, bic: null, invoice_footer: null, cgv_text: null, logo_url: null },
      contact: { id: 'k', first_name: 'Piet', last_name: 'Janssens', company_name: null, email: 'piet@example.be', locale: 'nl', address: null, street_number: null, zip: null, city: null, country: null, legacy_code: null },
      vehicle: { id: 'v', brand: 'Ducati', model: 'Monster', vin: null, plate: '1-ABC-123', mileage: 15000 },
      repair_order: { id: 'o', number: 'OR-2026-0007', mileage: 15000, reason_code: 'entretien_15000' },
      lines: proposalLines, signature: null,
    };
    const groups = groupsFor(payload);
    const text = acceptedText(payload, groups, ['l1'], 'Piet Janssens', '2026-10-31T10:00:00Z');
    expect(text).toContain('Ik aanvaard de hierboven aangevinkte werken');
    expect(text).toContain('[x] Plaquettes avant - 260,15 EUR');
    expect(text).not.toContain('Pneu arriere');
    const input = proposalPdfInput(payload, {
      keptLineIds: new Set(['l1', 'l2']), photos: new Map(),
      signature: { signerName: 'Piet Janssens', signedAt: '2026-10-31T10:00:00Z', mode: 'distance', hash: 'abc' },
    });
    expect(input.titleOverride).toBe('Interventievoorstel');
    expect(input.lines.map((l) => l.accepted)).toEqual([true, true, false, false, false]);
    expect(input.totals.ttc).toBe(260.15);
    expect(input.locale).toBe('nl');
  });
});

describe('garde-fou — aucune intervention sans accord trace', () => {
  test('en attente ou refuse : pas de demarrage ; signe, accord verbal ou sans proposition : oui', () => {
    expect(canStartWork({ customer_approval: 'en_attente' })).toBe(false);
    expect(canStartWork({ customer_approval: 'refuse' })).toBe(false);
    expect(canStartWork({ customer_approval: 'signe' })).toBe(true);
    expect(canStartWork({ customer_approval: 'accord_verbal' })).toBe(true);
    expect(canStartWork({ customer_approval: null })).toBe(true);
    expect(canStartWork({})).toBe(true);
    expect(approvalState({ customer_approval: 'bidon' })).toBe('none');
  });
});

describe('comptoir — interventions reportees', () => {
  test('date proposee par defaut : aujourd\'hui + 30 jours (AAAA-MM-JJ, fin d\'annee comprise)', () => {
    expect(defaultPlannedDate('2026-10-31')).toBe('2026-11-30');
    expect(defaultPlannedDate('2026-12-15')).toBe('2027-01-14');
    expect(defaultPlannedDate(new Date(2026, 1, 1))).toBe('2026-03-03');
    expect(defaultPlannedDate('2026-10-31', 7)).toBe('2026-11-07');
  });
});

describe('motif d\'entree — plan d\'entretien', () => {
  const services = [
    { name: 'Oil Service 1000', code: 'oil_1000', kmFirst: 1000, kmInterval: null, months: 6 },
    { name: 'Oil Service', code: 'oil', kmFirst: null, kmInterval: 15000, months: 12 },
    { name: 'Desmo Service', code: 'desmo', kmFirst: null, kmInterval: 30000, months: 24 },
    { name: 'Annual Service', code: 'annual', kmFirst: null, kmInterval: null, months: 12 },
  ];
  test('le motif choisit l\'echeance : km, annuel, vidange, sinon la premiere', () => {
    expect(isMaintenanceReason('entretien_15000')).toBe(true);
    expect(isMaintenanceReason('pneus')).toBe(false);
    expect(pickServiceForReason(services, 'entretien_15000')?.code).toBe('oil');
    expect(pickServiceForReason(services, 'entretien_30000')?.code).toBe('desmo');
    expect(pickServiceForReason(services, 'entretien_1000')?.code).toBe('oil_1000');
    expect(pickServiceForReason(services, 'entretien_annuel')?.code).toBe('annual');
    expect(pickServiceForReason(services, 'vidange')?.code).toBe('oil_1000');
    expect(pickServiceForReason(services, 'entretien_99999')?.code).toBe('oil_1000');
    expect(pickServiceForReason([], 'entretien_15000')).toBeNull();
  });
});

describe('mail — lien de signature cliquable', () => {
  test('une adresse https dans le texte devient un lien, le reste est echappe', () => {
    const html = plainTextToHtml('Signez ici :\nhttps://app.ducatibruxelles.be/signer/abc123.\n<b>');
    expect(html).toBe('Signez ici :<br><a href="https://app.ducatibruxelles.be/signer/abc123">https://app.ducatibruxelles.be/signer/abc123</a>.<br>&lt;b&gt;');
  });
});
