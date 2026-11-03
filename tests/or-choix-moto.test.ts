/**
 * ATE001 — choix de la moto sur l'OR (bug client du 03/11/2026) : les motos du client passent en
 * tete, la recherche couvre tout le parc sans doublon, et choisir une moto ne touche jamais au
 * client. Logique pure de `src/modules/vehicles/vehicle-pick.ts` + garde-fou : un seul composant
 * `VehiclePicker` pour l'OR, le RDV et les documents de vente.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  buildVehicleChoices, vehicleMatches, isVehicleSearch, vehiclePickEmptyState,
  pickVehicle, clearVehicle, pickContact, clearContact, type VehiclePickRow,
} from '../src/modules/vehicles/vehicle-pick';

const moto = (id: string, model: string, vin: string | null = null, plate: string | null = null): VehiclePickRow =>
  ({ id, vin, plate, brand: 'Ducati', model, model_year: 2024 });

const monster = moto('m1', 'Monster 821', 'ZDMM604AAGB021873', '1-ABC-123');
const multi = moto('m2', 'Multistrada V2S', 'ZDM2A02AARB011345');
const panigale = moto('p1', 'Panigale 899', 'ZDMH804FAEB021907', '2-XYZ-999');
const streetfighter = moto('s1', 'Streetfighter', 'ZDMF103AADB015607');

describe('buildVehicleChoices — motos du client en tete, puis le parc', () => {
  it('sans terme : toutes les motos du client, rien du parc', () => {
    const c = buildVehicleChoices({ own: [monster, multi], found: [panigale], term: '' });
    expect(c.searching).toBe(false);
    expect(c.own.map((v) => v.id)).toEqual(['m1', 'm2']);
    expect(c.park).toEqual([]);
  });

  it('un seul caractere ne cherche pas encore', () => {
    expect(isVehicleSearch('Z')).toBe(false);
    expect(isVehicleSearch('ZD')).toBe(true);
    expect(buildVehicleChoices({ own: [monster], found: [panigale], term: 'Z' }).searching).toBe(false);
  });

  it('avec un terme : les motos du client qui correspondent restent devant, le parc suit', () => {
    const c = buildVehicleChoices({ own: [monster, multi], found: [panigale, streetfighter], term: 'ZDM' });
    expect(c.searching).toBe(true);
    expect(c.own.map((v) => v.id)).toEqual(['m1', 'm2']);
    expect(c.park.map((v) => v.id)).toEqual(['p1', 's1']);
  });

  it('une moto du client qui ressort aussi de la recherche n apparait qu une fois, en tete', () => {
    const c = buildVehicleChoices({ own: [monster], found: [monster, panigale], term: 'ZDM' });
    expect(c.own.map((v) => v.id)).toEqual(['m1']);
    expect(c.park.map((v) => v.id)).toEqual(['p1']);
  });

  it('le terme filtre aussi les motos du client (modele, plaque avec ou sans tirets, VIN)', () => {
    expect(buildVehicleChoices({ own: [monster, multi], found: [], term: 'multi' }).own.map((v) => v.id)).toEqual(['m2']);
    expect(buildVehicleChoices({ own: [monster, multi], found: [], term: '1abc123' }).own.map((v) => v.id)).toEqual(['m1']);
    expect(vehicleMatches(monster, '1-ABC')).toBe(true);
    expect(vehicleMatches(multi, 'panigale')).toBe(false);
    expect(vehicleMatches(moto('x', 'Scrambler', null, null), 'scram')).toBe(true);
  });

  it('sans client : seulement le parc', () => {
    const c = buildVehicleChoices({ own: [], found: [panigale], term: 'pani' });
    expect(c.own).toEqual([]);
    expect(c.park.map((v) => v.id)).toEqual(['p1']);
  });
});

describe('vehiclePickEmptyState — ce que le menu dit quand il n y a rien', () => {
  const empty = buildVehicleChoices({ own: [], found: [], term: '' });
  it('client sans moto : message + bouton Ajouter une moto', () => {
    expect(vehiclePickEmptyState({ contactId: 'c1', ownLoaded: true, searchLoaded: false, choices: empty })).toBe('noneForClient');
  });
  it('motos du client pas encore chargees : rien a dire', () => {
    expect(vehiclePickEmptyState({ contactId: 'c1', ownLoaded: false, searchLoaded: false, choices: empty })).toBe('none');
  });
  it('pas de client, pas de recherche : invite a choisir un client ou a taper', () => {
    expect(vehiclePickEmptyState({ contactId: null, ownLoaded: true, searchLoaded: false, choices: empty })).toBe('noClient');
  });
  it('recherche sans resultat : aucune moto trouvee', () => {
    const c = buildVehicleChoices({ own: [], found: [], term: 'zzz' });
    expect(vehiclePickEmptyState({ contactId: 'c1', ownLoaded: true, searchLoaded: true, choices: c })).toBe('noneFound');
    expect(vehiclePickEmptyState({ contactId: 'c1', ownLoaded: true, searchLoaded: false, choices: c })).toBe('none');
  });
});

describe('selection client + moto — chaque case est independante', () => {
  type C = { id: string; name: string };
  const client: C = { id: 'c1', name: 'Dupont' };
  const start = { contact: client, vehicle: null as VehiclePickRow | null };

  it('choisir une moto ne touche pas au client', () => {
    const after = pickVehicle(start, monster);
    expect(after.contact).toBe(client);
    expect(after.vehicle).toBe(monster);
  });
  it('retirer la moto garde le client', () => {
    const after = clearVehicle(pickVehicle(start, monster));
    expect(after.contact).toBe(client);
    expect(after.vehicle).toBeNull();
  });
  it('changer ou retirer le client garde la moto choisie', () => {
    const withMoto = pickVehicle(start, panigale);
    expect(pickContact(withMoto, { id: 'c2', name: 'Durand' }).vehicle).toBe(panigale);
    expect(clearContact(withMoto).vehicle).toBe(panigale);
    expect(clearContact(withMoto).contact).toBeNull();
  });
  it('ne mute jamais la selection d origine', () => {
    pickVehicle(start, monster);
    expect(start.vehicle).toBeNull();
  });
});

describe('un seul composant VehiclePicker pour l OR, le RDV et les documents de vente', () => {
  const files = [
    'src/modules/workshop/or-editor.tsx',
    'src/routes/_app.workshop.planning.tsx',
    'src/modules/sales/document-editor.tsx',
  ];
  for (const f of files) {
    it(`${f} importe le composant partage et n en redefinit pas un local`, () => {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      expect(src).toContain("from '@/modules/vehicles/vehicle-picker'");
      expect(src).not.toMatch(/function VehiclePicker\(/);
      // Le selecteur recoit le client choisi : ses motos passent en tete.
      expect(src).toMatch(/<VehiclePicker[^>]*contactId=\{contact\?\.id \?\? null\}/);
    });
  }
  it('l OR charge son client par id, plus via la liste des contacts plafonnee', () => {
    const src = readFileSync(new URL('../src/modules/workshop/or-editor.tsx', import.meta.url), 'utf8');
    expect(src).toContain('getContact(contactIdToLoad');
    expect(src).not.toMatch(/listContacts\(companyId, ''\)\)\.find/);
  });
});
