/**
 * M9 (Simon, 26/11/2026) — lecture automatique de chaque fichier ajouté à une fiche client ou moto.
 * On ne peut pas appeler Claude dans les tests : on teste les règles sur des réponses types.
 *   1. type de pièce → dossier de rangement (et dossier choisi par l'utilisateur gardé) ;
 *   2. nettoyage de la réponse : dates, VIN, montants, données interdites jetées ;
 *   3. propositions pour la fiche (à remplir / identique / différent / certifié DCS) et écritures,
 *      avec le refus des champs interdits.
 * Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  DOCUMENT_SCHEMA, DOC_KINDS, KIND_FOLDER, folderFor, isIban, isNationalNumber, isoDate, cleanVin, looksForbidden,
  readableStatus, sanitizeReading, MAX_IMAGE_BYTES,
} from '../supabase/functions/_shared/doc-reading.ts';
import {
  DOC_KINDS as CLIENT_KINDS, buildProposals, fillKeys, findBank, mapCarGarantiePlan, mapWarranty, nameMatches,
  phoneTarget, pickVehicle, planWrites, type DocReading, type Proposal, type ReadingContext,
} from '../src/modules/documents/doc-reading-rules';
import { fr } from '../src/lib/i18n/fr';

const reading = (p: { doc_kind?: DocReading['doc_kind']; vehicle?: DocReading['vehicle']; customer?: DocReading['customer']; receipt?: DocReading['receipt'] } = {}): DocReading => ({
  doc_kind: p.doc_kind ?? 'autre', confidence: 'high', summary: null,
  vehicle: p.vehicle ?? {}, customer: p.customer ?? {}, receipt: p.receipt ?? null,
});

const VIN = 'ZDM3H00AATB004664';
const ctx = (p: Partial<ReadingContext> = {}): ReadingContext => ({
  entityType: 'vehicle',
  contact: { id: 'c1', first_name: 'Anthony', last_name: 'Gonzalez', city: null, email: 'a.gonzalez@example.be', mobile: null, phone: null },
  vehicle: { id: 'v1', vin: VIN, plate: null, model: 'Multistrada V4 S', category: 'Multistrada', model_year: 2023, warranty_type: null, financing_contact_id: null, financing_contract: null },
  certified: [],
  banks: [{ id: 'b1', name: 'Alphacredit' }, { id: 'b2', name: 'BNP Paribas Fortis' }, { id: 'b3', name: 'Beobank NV' }],
  ...p,
});

describe('type de pièce → dossier', () => {
  test('chaque type a un dossier de l\'archive, « Tickets » ou rien', () => {
    expect(KIND_FOLDER.ticket_caisse).toBe('Tickets');
    expect(KIND_FOLDER.facture).toBe('Vente - Factures');
    expect(KIND_FOLDER.avoir).toBe('Vente - Factures');
    expect(KIND_FOLDER.bon_commande).toBe('Vente - Bons de commande');
    expect(KIND_FOLDER.coc).toBe('Vente - Immatriculation / COC');
    expect(KIND_FOLDER.immatriculation).toBe('Vente - Immatriculation / COC');
    expect(KIND_FOLDER.carte_grise).toBe('Vente - Immatriculation / COC');
    expect(KIND_FOLDER.leasing_credit).toBe('Vente - Financement');
    expect(KIND_FOLDER.offre_banque).toBe('Vente - Financement');
    expect(KIND_FOLDER.garantie).toBe('Vente - Garantie');
    expect(KIND_FOLDER.pv_livraison).toBe('Vente - Livraison');
    expect(KIND_FOLDER.assurance).toBe('Vente - Assurance');
    expect(KIND_FOLDER.controle_technique).toBe('Vente - Contrôle technique');
    expect(KIND_FOLDER.reprise).toBe('Vente - Reprise');
    expect(KIND_FOLDER.photo_moto).toBe('Vente - Photos');
    for (const k of ['identite', 'fiche_paie', 'extrait_compte', 'extrait_role'] as const) expect(KIND_FOLDER[k]).toBe('Vente - Pièces personnelles');
    expect(KIND_FOLDER.autre).toBeNull();
    expect(Object.keys(KIND_FOLDER).sort()).toEqual([...DOC_KINDS].sort());
  });
  test('le dossier choisi par l\'utilisateur est gardé ; « autre » laisse le fichier où il est', () => {
    expect(folderFor('facture', null, false)).toBe('Vente - Factures');
    expect(folderFor('facture', 'Images', false)).toBe('Vente - Factures');
    expect(folderFor('facture', 'Mon dossier', true)).toBe('Mon dossier');
    expect(folderFor('autre', 'Images', false)).toBe('Images');
    expect(folderFor('autre', null, false)).toBeNull();
  });
  test('même liste de types côté écran, libellé FR pour chacun, schéma limité à cette liste', () => {
    expect([...CLIENT_KINDS]).toEqual([...DOC_KINDS]);
    for (const k of DOC_KINDS) expect(typeof (fr.lectureFichiers.kind as Record<string, string>)[k]).toBe('string');
    const props = (DOCUMENT_SCHEMA as { properties: Record<string, { enum?: string[]; properties?: Record<string, unknown> }> }).properties;
    expect(props.doc_kind.enum).toEqual([...DOC_KINDS]);
    // Le schéma ne demande jamais de donnée interdite.
    const all = JSON.stringify(DOCUMENT_SCHEMA);
    for (const k of ['national_register', 'iban', 'income', 'employer', 'salary']) expect(all.includes(`"${k}"`)).toBe(false);
  });
});

describe('nettoyage de la réponse', () => {
  test('dates, VIN et montants', () => {
    expect(isoDate('05/03/2024')).toBe('2024-03-05');
    expect(isoDate('2031-12-31')).toBe('2031-12-31');   // fin de garantie dans le futur : gardée
    expect(isoDate('31/02/2024')).toBeNull();
    expect(cleanVin('zdm3h00aatb 004664')).toBe(VIN);
    expect(cleanVin('ZDM3H00AATB00466')).toBeNull();
    const r = sanitizeReading({
      doc_kind: 'ticket_caisse', confidence: 'high', summary: 'Ticket',
      vehicle: { vin: 'ZDM3H00AATB004664', first_registration_date: '12.04.2023', mileage: 1234.5 },
      customer: { email: 'Jean@Exemple.BE', phone: '+32 475 12 34 56' },
      receipt: { supplier: 'Total', date: '26/11/2026', total_ttc: 61.5, total_ht: 50.83, total_vat: 10.67, currency: 'EUR', lines: [{ label: 'Essence', quantity: 35.2, unit_price: 1.747, total: 61.5 }] },
    });
    expect(r.vehicle.vin).toBe(VIN);
    expect(r.vehicle.first_registration_date).toBe('2023-04-12');
    expect(r.customer.email).toBe('jean@exemple.be');
    expect(r.customer.phone).toBe('+32475123456');
    expect(r.receipt?.total_ttc).toBe(61.5);
    expect(r.receipt?.lines[0].unit_price).toBe(1.75);
    expect(r.receipt?.date).toBe('2026-11-26');
  });
  test('un type inconnu devient « autre » ; le bloc ticket n\'existe que pour un ticket, une facture ou un avoir', () => {
    expect(sanitizeReading({ doc_kind: 'passeport' }).doc_kind).toBe('autre');
    expect(sanitizeReading({ doc_kind: 'garantie', receipt: { supplier: 'X', lines: [] } }).receipt).toBeNull();
  });
  test('numéro national et numéro de compte : jetés, même glissés dans un autre champ', () => {
    expect(isNationalNumber('85073003328')).toBe(true);
    expect(isIban('BE68 5390 0754 7034')).toBe(true);
    expect(looksForbidden('NN 85.07.30-033.28')).toBe(true);
    expect(looksForbidden('Compte BE68 5390 0754 7034')).toBe(true);
    expect(looksForbidden('Contrat 2024-001234')).toBe(false);
    expect(looksForbidden('BE0123456789')).toBe(false);   // un n° de TVA n'est pas un compte
    const r = sanitizeReading({
      doc_kind: 'fiche_paie',
      customer: { last_name: 'Peeters', street: 'Rue Haute 85.07.30-033.28', vat_number: 'BE0123.456.789', national_register: '85.07.30-033.28', iban: 'BE68539007547034', employer: 'ACME' },
      vehicle: { financing_contract: 'BE68 5390 0754 7034' },
    }) as unknown as Record<string, Record<string, unknown>>;
    expect(r.customer.street).toBeNull();
    expect(r.customer.vat_number).toBe('BE0123456789');
    expect(r.vehicle.financing_contract).toBeNull();
    for (const k of ['national_register', 'iban', 'employer']) expect(k in r.customer).toBe(false);
  });
  test('formats lisibles : PDF et images courantes, limite de poids', () => {
    expect(readableStatus('application/pdf', 1000)).toBeNull();
    expect(readableStatus('image/jpeg', 1000)).toBeNull();
    expect(readableStatus('image/heic', 1000)).toBe('unsupported');
    expect(readableStatus('application/vnd.ms-excel', 1000)).toBe('unsupported');
    expect(readableStatus('image/png', MAX_IMAGE_BYTES + 1)).toBe('too_large');
  });
});

describe('règles reprises du DMS', () => {
  test('garanties : libellés du DMS, 4Ever seulement Multistrada >= 2020 et DesertX', () => {
    const multi = { category: 'Multistrada', model: 'Multistrada V4', model_year: 2022 };
    expect(mapWarranty('Ever Red +24 mois', multi).value).toBe('Factory Ever Red +24');
    expect(mapWarranty('Ducati Ever Red 12', multi).value).toBe('Factory Ever Red +12');
    expect(mapWarranty('Garantie conventionnelle 24 mois', multi).value).toBe('Conventionnelle (24 mois)');
    expect(mapWarranty('CarGarantie EverRed Plus', multi).value).toBe('CarGarantie');
    expect(mapWarranty('Ducati 4Ever', multi).value).toBe('4Ever Ducati (48 mois)');
    expect(mapWarranty('Ducati 4Ever', { category: 'DesertX', model: 'DesertX', model_year: 2019 }).value).toBe('4Ever Ducati (48 mois)');
    const panigale = mapWarranty('Ducati 4Ever', { category: 'Panigale', model: 'Panigale V4', model_year: 2024 });
    expect(panigale.value).toBeNull();
    expect(panigale.note?.code).toBe('four_ever_not_eligible');
    expect(mapWarranty('Multistrada 2019 4Ever', { category: 'Multistrada', model: 'Multistrada 950', model_year: 2019 }).value).toBeNull();
    expect(mapWarranty('Garantie maison', multi).note?.code).toBe('warranty_unknown');
    expect(mapCarGarantiePlan('EverRed Plus 12 mois')).toBe('EverRed Plus (12 mois)');
    expect(mapCarGarantiePlan('Ever Red 36')).toBe('EverRed (36 mois)');
  });
  test('banque : trouvée par son nom, jamais devinée', () => {
    const banks = ctx().banks;
    expect(findBank('ALPHA CREDIT SA', banks)).toBeNull();     // nom différent : pas de devinette
    expect(findBank('Alphacredit S.A.', banks)?.id).toBe('b1');
    expect(findBank('BNP Paribas Fortis SA', banks)?.id).toBe('b2');
    expect(findBank('Beobank', banks)?.id).toBe('b3');
    expect(findBank('Banque inconnue', banks)).toBeNull();
  });
  test('téléphone : mobile belge ou fixe, au format +32', () => {
    expect(phoneTarget('0475 12 34 56')).toEqual({ field: 'mobile', value: '+32475123456' });
    expect(phoneTarget('02/123.45.67')).toEqual({ field: 'phone', value: '+3221234567' });
    expect(phoneTarget('abc')).toBeNull();
  });
  test('nom du client : le nom lu doit se retrouver sur la fiche', () => {
    const c = { id: 'c1', first_name: 'Anthony', last_name: 'Gonzalez' };
    expect(nameMatches({ first_name: 'ANTHONY', last_name: 'GONZÁLEZ' }, c)).toBe(true);
    expect(nameMatches({ last_name: 'Peeters' }, c)).toBe(false);
    expect(nameMatches({ company_name: 'AM Cars Cleaning SRL' }, { id: 'c2', company_name: 'AM CARS CLEANING' })).toBe(true);
  });
  test('moto du client : même VIN, sinon même plaque, jamais au hasard', () => {
    const vs = [{ id: 'a', vin: VIN, plate: '1ABC123' }, { id: 'b', vin: 'ZDM1BBBB0EB000001', plate: '2DEF456' }];
    expect(pickVehicle(reading({ vehicle: { vin: VIN } }), vs)?.id).toBe('a');
    expect(pickVehicle(reading({ vehicle: { plate: '2-DEF-456' } }), vs)?.id).toBe('b');
    expect(pickVehicle(reading({ vehicle: { vin: 'ZDM1CCCC0EB000002' } }), vs)).toBeNull();
    expect(pickVehicle(reading({}), vs)).toBeNull();
  });
});

describe('propositions pour la fiche', () => {
  test('case vide → à remplir ; même valeur → identique ; autre valeur → différent ; plaque sans tirets', () => {
    const { proposals } = buildProposals(reading({
      doc_kind: 'immatriculation',
      vehicle: { vin: VIN, plate: '1-ABC-123', first_registration_date: '2023-04-12', model: 'Multistrada V4 S Travel' },
    }), ctx({ vehicle: { ...ctx().vehicle!, first_registration_date: '2023-04-01' } }));
    const by = Object.fromEntries(proposals.map((p) => [p.key, p]));
    expect(by['vehicle.vin'].state).toBe('same');
    expect(by['vehicle.plate']).toMatchObject({ state: 'fill', read: '1ABC123' });
    expect(by['vehicle.first_registration_date'].state).toBe('conflict');
    expect(by['vehicle.model']).toBeUndefined();   // le modèle déjà saisi n'est jamais contesté
    expect(fillKeys(proposals)).toEqual(['vehicle.plate']);
  });
  test('valeur certifiée DCS : affichée, jamais écrite', () => {
    const { proposals } = buildProposals(reading({ vehicle: { vin: VIN, plate: '1ABC124' } }),
      ctx({ vehicle: { ...ctx().vehicle!, plate: '1ABC123' }, certified: ['plate'] }));
    const plate = proposals.find((p) => p.key === 'vehicle.plate')!;
    expect(plate.state).toBe('locked');
    const plan = planWrites(proposals, ['vehicle.plate']);
    expect(plan.vehicle.plate).toBeUndefined();
    expect(plan.refused).toEqual(['vehicle.plate']);
  });
  test('document d\'une autre moto : rien n\'est proposé pour la moto', () => {
    const r = buildProposals(reading({ vehicle: { vin: 'ZDM1BBBB0EB000001', plate: '9ZZZ999' } }), ctx());
    expect(r.proposals.filter((p) => p.target === 'vehicle')).toEqual([]);
    expect(r.notes[0]).toEqual({ code: 'other_vehicle', vin: 'ZDM1BBBB0EB000001' });
  });
  test('coordonnées : seulement si le nom lu est celui du client (jamais l\'émetteur d\'une facture)', () => {
    const ok = buildProposals(reading({ customer: { last_name: 'Gonzalez', city: 'Uccle', email: 'a.gonzalez@example.be', phone: '0475123456' } }), ctx());
    const keys = ok.proposals.map((p) => `${p.key}:${p.state}`);
    expect(keys).toContain('contact.city:fill');
    expect(keys).toContain('contact.email:same');
    expect(keys).toContain('contact.mobile:fill');
    const other = buildProposals(reading({ customer: { last_name: 'Garage Dupont', city: 'Namur' } }), ctx());
    expect(other.proposals.filter((p) => p.target === 'contact')).toEqual([]);
    expect(other.notes.map((n) => n.code)).toContain('name_mismatch');
    const noName = buildProposals(reading({ customer: { city: 'Namur' } }), ctx());
    expect(noName.notes.map((n) => n.code)).toContain('no_customer_name');
    const noOwner = buildProposals(reading({ customer: { last_name: 'Gonzalez', city: 'Uccle' } }), ctx({ contact: null }));
    expect(noOwner.notes.map((n) => n.code)).toContain('no_owner');
  });
  test('financement : la banque va dans le financement (jamais propriétaire), avec le contrat', () => {
    const { proposals, notes } = buildProposals(reading({ doc_kind: 'leasing_credit', vehicle: { vin: VIN, bank_name: 'Alphacredit', financing_contract: 'LC-778899' } }), ctx());
    expect(notes).toEqual([]);
    const bank = proposals.find((p) => p.key === 'vehicle.financing_contact_id')!;
    expect(bank).toMatchObject({ state: 'fill', read: 'b1', readLabel: 'Alphacredit' });
    const plan = planWrites(proposals, fillKeys(proposals));
    expect(plan.financing).toEqual({ contactId: 'b1', contract: 'LC-778899' });
    expect(Object.keys(plan.contact)).toEqual([]);
    expect('financing_contact_id' in plan.vehicle).toBe(false);
    // Contrat seul choisi : la banque actuelle est gardée, jamais effacée.
    const onlyContract = planWrites(proposals, ['vehicle.financing_contract'], { contactId: 'b2', contract: null });
    expect(onlyContract.financing).toEqual({ contactId: 'b2', contract: 'LC-778899' });
    const unknown = buildProposals(reading({ vehicle: { vin: VIN, bank_name: 'Banque Lointaine' } }), ctx());
    expect(unknown.notes).toEqual([{ code: 'bank_not_found', name: 'Banque Lointaine' }]);
  });
  test('garantie 4Ever proposée sur une Multistrada 2023, pas sur une Monster', () => {
    const multi = buildProposals(reading({ doc_kind: 'garantie', vehicle: { vin: VIN, warranty_type: '4Ever', warranty_start: '2023-05-01', warranty_end: '2027-04-30' } }), ctx());
    expect(multi.proposals.find((p) => p.key === 'vehicle.warranty_type')?.read).toBe('4Ever Ducati (48 mois)');
    expect(multi.proposals.find((p) => p.key === 'vehicle.warranty_end')?.state).toBe('fill');
    const monster = buildProposals(reading({ vehicle: { vin: VIN, warranty_type: '4Ever' } }),
      ctx({ vehicle: { ...ctx().vehicle!, category: 'Monster', model: 'Monster', model_year: 2023 } }));
    expect(monster.proposals.find((p) => p.key === 'vehicle.warranty_type')).toBeUndefined();
    expect(monster.notes.map((n) => n.code)).toContain('four_ever_not_eligible');
  });
});

describe('écritures', () => {
  const P = (p: Partial<Proposal> & { key: string }): Proposal => {
    const [target, field] = p.key.split('.') as [Proposal['target'], Proposal['field']];
    return { target, field, read: 'x', readLabel: 'x', current: null, currentLabel: null, state: 'fill', ...p };
  };
  test('rien n\'est écrit sans choix', () => {
    const plan = planWrites([P({ key: 'contact.city', read: 'Uccle' })], []);
    expect(plan.contact).toEqual({});
    expect(plan.vehicle).toEqual({});
    expect(plan.financing).toBeNull();
  });
  test('champs interdits refusés même s\'ils arrivent dans une proposition', () => {
    const forged = [
      P({ key: 'contact.national_register', read: '85.07.30-033.28' }),
      P({ key: 'contact.iban', read: 'BE68539007547034' }),
      P({ key: 'contact.employer', read: 'ACME' }),
      P({ key: 'contact.income', read: '3000' }),
      P({ key: 'vehicle.status', read: 'vendu' }),
      P({ key: 'contact.city', read: 'Uccle' }),
    ];
    const plan = planWrites(forged, forged.map((p) => p.key));
    expect(plan.contact).toEqual({ city: 'Uccle' });
    expect(plan.vehicle).toEqual({});
    expect(plan.refused.sort()).toEqual(['contact.employer', 'contact.iban', 'contact.income', 'contact.national_register', 'vehicle.status']);
  });
  test('l\'ancienne valeur est gardée pour la trace (events)', () => {
    const plan = planWrites([P({ key: 'vehicle.plate', read: '1ABC124', current: '1ABC123', state: 'conflict' })], ['vehicle.plate']);
    expect(plan.vehicle).toEqual({ plate: '1ABC124' });
    expect(plan.old.vehicle).toEqual({ plate: '1ABC123' });
  });
  test('une valeur identique n\'est pas réécrite', () => {
    const plan = planWrites([P({ key: 'contact.email', read: 'a@b.be', current: 'a@b.be', state: 'same' })], ['contact.email']);
    expect(plan.contact).toEqual({});
  });
});
