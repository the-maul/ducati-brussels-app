/**
 * Bloc « Données DCS » de la fiche moto : colonnes, écarts, client, historique. Données fictives.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildDcsClientSnapshot, dcsCountryCode, planDcsImport, type DcsModelMatch, type DcsPayloadV2,
} from '../src/lib/dcs-rules';
import {
  dcsBlockColumns, dcsCatalogFields, dcsClientSituation, dcsEventFamily, dcsModelChoices, dcsOpenConflicts,
  dcsBlockFolded, dcsValidatePlan, groupDcsEvents, isDcsResolvable, type DcsBlockRow, type DcsClientRow, type DcsFieldRow,
} from '../src/modules/vehicles/dcs-block-rules';

const VIN = 'ZDM00000000000001';
const row = (field: string, status: DcsFieldRow['status'], dcs_value: string | null, source = 'dcs'): DcsFieldRow =>
  ({ field, status, dcs_value, previous_value: null, source });
const noModel: DcsModelMatch = { status: 'conflict', reason: 'no_title', modelYearId: null, modelText: null, color: null, candidateIds: [] };
const ambiguous: DcsModelMatch = { ...noModel, reason: 'ambiguous', modelText: 'TEST 1200 S', candidateIds: ['a', 'b'] };
const payload = (vehicle: Record<string, unknown> = {}, plate: string | null = null): DcsPayloadV2 => ({
  format: 2, vin: VIN, read_vin: VIN, requested_vin: VIN, read_error: null, issues: [], header: { plate }, vehicle, contact: {},
});
const client: DcsClientRow = {
  full_name: 'JEAN TEST', first_name: 'JEAN', last_name: 'TEST', email: 'jean@example.test', mobile: '+32400000001',
  address: '1 rue Fictive', postal_code: '1000', city: 'TESTVILLE', region: null, country: 'Belgium', country_code: 'BE',
  birth_date: '1980-01-15', ducati_code: 'ZZ001',
};

describe('décisions déjà prises', () => {
  test('un km déjà refusé ne redevient pas un écart à la lecture suivante', () => {
    const plan = planDcsImport({
      current: { mileage: 19798 }, payload: payload({ last_km: '20.366 km' }), model: noModel, decisions: { mileage: '20366' },
    });
    expect(plan.statuses.find((s) => s.field === 'mileage')).toMatchObject({ status: 'saisi', source: 'decision' });
    expect(plan.counts.conflicts).toBe(0);
    expect(plan.changes).toEqual([]);
  });

  test('un nouveau km au DCS rouvre l’écart', () => {
    const plan = planDcsImport({
      current: { mileage: 19798 }, payload: payload({ last_km: '21.000 km' }), model: noModel, decisions: { mileage: '20366' },
    });
    expect(plan.statuses.find((s) => s.field === 'mileage')?.status).toBe('conflit');
    expect(plan.counts.conflicts).toBe(1);
  });

  test('une plaque tranchée reste tranchée, même écrite autrement', () => {
    const plan = planDcsImport({
      current: { plate: '1ABC234' }, payload: payload({}, '2-XYZ-999'), model: noModel, decisions: { plate: '2XYZ999' },
    });
    expect(plan.statuses.find((s) => s.field === 'plate')?.status).toBe('saisi');
  });

  test('le modèle choisi parmi les candidats n’est pas redemandé', () => {
    const plan = planDcsImport({
      current: { model: 'TEST 1200', ducati_model_year_id: 'a' }, payload: payload(), model: ambiguous, decisions: { model: 'TEST 1200 S' },
    });
    expect(plan.statuses.find((s) => s.field === 'model')?.status).toBe('saisi');
    expect(plan.statuses.find((s) => s.field === 'ducati_model_year_id')).toMatchObject({ status: 'saisi', dcs_value: 'a', source: 'decision' });
    expect(plan.counts.conflicts).toBe(0);
  });

  test('sans décision, le modèle ambigu reste un écart et rien n’est écrit', () => {
    const plan = planDcsImport({ current: { model: 'TEST 1200' }, payload: payload(), model: ambiguous });
    expect(plan.statuses.find((s) => s.field === 'model')?.status).toBe('conflit');
    expect(plan.changes).toEqual([]);
  });

  test('un propriétaire tranché ne revient pas pour le même nom, mais revient pour un autre', () => {
    const owner = { name: 'JEAN TEST', currentName: 'PAUL AUTRE', matches: false };
    const same = planDcsImport({ current: {}, payload: payload(), model: noModel, owner, decisions: { owner: 'Jean Test' } });
    expect(same.statuses.find((s) => s.field === 'owner')?.status).toBe('saisi');
    const other = planDcsImport({ current: {}, payload: payload(), model: noModel, owner: { ...owner, name: 'MARC NOUVEAU' }, decisions: { owner: 'Jean Test' } });
    expect(other.statuses.find((s) => s.field === 'owner')?.status).toBe('conflit');
  });

  test('une donnée d’usine continue de remplacer malgré une décision', () => {
    const plan = planDcsImport({
      current: { engine_number: 'ZDM1198W4000001' }, payload: payload({ engine_number: 'ZDM1198W4000002' }), model: noModel,
      decisions: { engine_number: 'ZDM1198W4000002' },
    });
    expect(plan.changes[0]).toMatchObject({ field: 'engine_number', action: 'replaced' });
  });
});

describe('client lu au DCS', () => {
  const raw = {
    ducati_code: 'ZZ001', my_ducati_email: 'jean@example.test', my_ducati_phone: '+32400000001', my_ducati_country: 'Belgium',
    address: '1 rue Fictive', postal_code: '1000', my_ducati_city: 'TESTVILLE', region: '-', birth_date: '15/01/1980',
    my_ducati_marketing: true, my_ducati_profiling: true,
  };

  test('garde les coordonnées et normalise date et pays', () => {
    expect(buildDcsClientSnapshot(raw, 'JEAN', 'TEST')).toEqual({ ...client });
  });

  test('ne reprend jamais les consentements marketing', () => {
    const s = buildDcsClientSnapshot(raw, 'JEAN', 'TEST') as Record<string, unknown>;
    expect(Object.keys(s).some((k) => /marketing|profiling|consent/i.test(k))).toBe(false);
  });

  test('e-mail et date invalides restent vides', () => {
    const s = buildDcsClientSnapshot({ ...raw, my_ducati_email: 'pas-un-mail', birth_date: '31/02/1980' }, 'JEAN', 'TEST');
    expect(s?.email).toBeNull();
    expect(s?.birth_date).toBeNull();
  });

  test('sans nom ni code, rien à conserver', () => {
    expect(buildDcsClientSnapshot({ my_ducati_email: 'a@example.test' }, '', '')).toBeNull();
  });

  test('un pays inconnu n’est pas deviné', () => {
    expect(dcsCountryCode('Belgique')).toBe('BE');
    expect(dcsCountryCode('Pays-Bas')).toBe('NL');
    expect(dcsCountryCode('Atlantide')).toBeNull();
    expect(dcsCountryCode('-')).toBeNull();
  });

  test('situation de la colonne Client', () => {
    expect(dcsClientSituation(null, undefined, 'c1')).toBe('none');
    expect(dcsClientSituation(client, row('owner', 'conflit', 'JEAN TEST'), null)).toBe('no_owner');
    expect(dcsClientSituation(client, row('owner', 'certifie', 'JEAN TEST'), 'c1')).toBe('same');
    expect(dcsClientSituation(client, row('owner', 'conflit', 'JEAN TEST'), 'c1')).toBe('other');
    expect(dcsClientSituation(client, row('owner', 'saisi', 'JEAN TEST', 'decision'), 'c1')).toBe('settled');
  });
});

describe('colonnes du bloc', () => {
  const vehicle = {
    mileage: 19798, plate: '1ABC234', model: 'TEST 1200',
    my_ducati_data: { header: { title: 'TEST 1200 S RED', year: 2020, market: 'Belgium' }, vehicle: { warranty_age: '3 ans', last_km: '20.366 km', ducati_usage: 'Privé' } },
  };
  const statuses = [row('mileage', 'conflit', '20366'), row('engine_number', 'certifie', 'E123456'), row('warranty_end', 'certifie', '2027-01-01')];

  test('les trois colonnes ne montrent que ce qui a été lu', () => {
    const c = dcsBlockColumns(vehicle, statuses, client, 'PAUL AUTRE');
    expect(c.moto.map((r) => r.key)).toEqual(['title', 'year', 'market', 'engine_number', 'mileage', 'ducati_usage']);
    expect(c.warranty.map((r) => r.key)).toEqual(['warranty_end', 'warranty_age']);
    expect(c.client.map((r) => r.key)).not.toContain('region');
  });

  test('un écart porte les deux valeurs', () => {
    const km = dcsBlockColumns(vehicle, statuses, null).moto.find((r) => r.key === 'mileage');
    expect(km).toMatchObject({ value: '20366', sheet: '19798', status: 'conflit' });
  });

  test('le nom du client porte le statut du propriétaire', () => {
    const c = dcsBlockColumns(vehicle, [row('owner', 'conflit', 'JEAN TEST')], client, 'PAUL AUTRE');
    expect(c.client[0]).toMatchObject({ key: 'owner', status: 'conflit', sheet: 'PAUL AUTRE', value: 'JEAN TEST' });
  });

  test('lecture ancienne sans client conservé : l’écart sur le nom reste visible', () => {
    const c = dcsBlockColumns(vehicle, [row('owner', 'conflit', 'JEAN TEST')], null, 'PAUL AUTRE');
    expect(c.client).toHaveLength(1);
    expect(c.client[0]).toMatchObject({ key: 'owner', status: 'conflit', value: 'JEAN TEST', sheet: 'PAUL AUTRE' });
  });

  test('moto jamais lue : colonnes vides', () => {
    const c = dcsBlockColumns({ mileage: 100 }, [], null);
    expect([...c.moto, ...c.warranty, ...c.client]).toEqual([]);
  });

  test('le modèle-année ne compte pas comme un second écart', () => {
    expect(dcsOpenConflicts([row('model', 'conflit', 'X'), row('ducati_model_year_id', 'conflit', 'a,b'), row('plate', 'certifie', 'Y')])).toBe(1);
  });

  test('champs complétés par le catalogue', () => {
    expect(dcsCatalogFields([row('cylinders', 'catalogue', '2'), row('plate', 'certifie', 'Y')])).toEqual(['cylinders']);
  });

  test('liste fermée des champs à trancher', () => {
    expect(isDcsResolvable('mileage')).toBe(true);
    expect(isDcsResolvable('vin')).toBe(false);
    expect(isDcsResolvable('engine_number')).toBe(false);
  });
});

describe('candidats du modèle', () => {
  const candidates = [
    { model_year_id: 'a', family: 'MULTISTRADA', supermodel: '1200', model: 'MULTISTRADA 1200 S', year: 2016 },
    { model_year_id: 'b', family: 'MULTISTRADA', supermodel: '1200', model: 'MULTISTRADA 1200 S TOURING', year: 2016 },
    { model_year_id: 'c', family: 'MONSTER', supermodel: '821', model: 'MONSTER 821', year: 2016 },
  ];

  test('seuls les candidats enregistrés sont proposés', () => {
    const choices = dcsModelChoices(row('ducati_model_year_id', 'conflit', 'b,a'), candidates);
    expect(choices.map((c) => c.id)).toEqual(['b', 'a']);
    expect(choices[0]).toMatchObject({ label: 'MULTISTRADA 1200 S TOURING', year: 2016 });
  });

  test('aucun candidat : aucune proposition', () => {
    expect(dcsModelChoices(row('ducati_model_year_id', 'conflit', null), candidates)).toEqual([]);
    expect(dcsModelChoices(undefined, candidates)).toEqual([]);
  });
});

describe('historique DCS', () => {
  test('à venir, en cours, passés, dans le bon ordre', () => {
    const groups = groupDcsEvents([
      { id: '1', kind: 'past', event_date: '2021-01-01', due_date: null },
      { id: '2', kind: 'past', event_date: '2023-01-01', due_date: null },
      { id: '3', kind: 'upcoming', event_date: null, due_date: '2027-06-01' },
      { id: '4', kind: 'upcoming', event_date: null, due_date: '2026-12-01' },
      { id: '5', kind: 'current', event_date: '2026-11-01', due_date: null },
      { id: '6', kind: null, event_date: '2022-01-01', due_date: null },
      { id: '7', kind: 'past', event_date: null, due_date: null },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['upcoming', 'current', 'past']);
    expect(groups[0].rows.map((r) => r.id)).toEqual(['4', '3']);
    expect(groups[2].rows.map((r) => r.id)).toEqual(['2', '6', '1', '7']);
  });

  test('un tableau vide n’est pas affiché', () => {
    expect(groupDcsEvents([{ kind: 'past', event_date: '2021-01-01' }]).map((g) => g.kind)).toEqual(['past']);
  });

  test('familles d’événements', () => {
    expect(dcsEventFamily('Maintenance').family).toBe('maintenance');
    expect(dcsEventFamily('Garantie').family).toBe('warranty');
    expect(dcsEventFamily('Checklist').family).toBe('checklist');
    expect(dcsEventFamily(null).family).toBe('other');
  });
});

describe('bouton Valider du bloc DCS', () => {
  const r = (key: string, status: DcsBlockRow['status'], sheet: string | null = 'A'): DcsBlockRow =>
    ({ key, labelKey: key, value: 'B', kind: 'text', status, sheet });

  test('chaque écart prend la valeur DCS, le reste ne bouge pas', () => {
    const p = dcsValidatePlan([r('plate', 'conflit', 'AB12345'), r('color', 'certifie'), r('mileage', 'conflit', '100')],
      { needsModelChoice: false, situation: 'same', matches: [] });
    expect(p.steps).toEqual([{ kind: 'take', field: 'plate', seen: 'AB12345' }, { kind: 'take', field: 'mileage', seen: '100' }]);
    expect(p.left).toEqual([]);
  });

  test('plusieurs versions possibles du modèle : reste à choisir', () => {
    const p = dcsValidatePlan([r('model', 'conflit')], { needsModelChoice: true, situation: 'same', matches: [] });
    expect(p.steps).toEqual([]);
    expect(p.left).toEqual(['model']);
  });

  test('moto sans propriétaire : une seule fiche trouvée est attribuée, aucune = création', () => {
    const one = dcsValidatePlan([r('owner', 'conflit', null)], { needsModelChoice: false, situation: 'no_owner', matches: [{ id: 'c1', is_owner: false }] });
    expect(one.steps).toEqual([{ kind: 'attach', contactId: 'c1' }]);
    const none = dcsValidatePlan([], { needsModelChoice: false, situation: 'no_owner', matches: [] });
    expect(none.steps).toEqual([{ kind: 'create' }]);
  });

  test('plusieurs clients possibles ou autre propriétaire : jamais de choix automatique', () => {
    const many = dcsValidatePlan([], { needsModelChoice: false, situation: 'no_owner', matches: [{ id: 'a', is_owner: false }, { id: 'b', is_owner: false }] });
    expect(many.steps).toEqual([]);
    expect(many.left).toEqual(['owner']);
    const other = dcsValidatePlan([r('owner', 'conflit')], { needsModelChoice: false, situation: 'other', matches: [] });
    expect(other.left).toEqual(['owner']);
    const lost = dcsValidatePlan([r('owner', 'conflit', null)], { needsModelChoice: false, situation: 'none', matches: [] });
    expect(lost.left).toEqual(['owner']);
  });

  test('replié seulement après validation de la dernière lecture et sans écart', () => {
    expect(dcsBlockFolded(null, '2026-11-24T08:00:00Z', 0)).toBe(false);
    expect(dcsBlockFolded('2026-11-24T09:00:00Z', '2026-11-24T08:00:00Z', 0)).toBe(true);
    expect(dcsBlockFolded('2026-11-24T09:00:00Z', '2026-11-24T10:00:00Z', 0)).toBe(false);
    expect(dcsBlockFolded('2026-11-24T09:00:00Z', '2026-11-24T08:00:00Z', 1)).toBe(false);
  });
});
