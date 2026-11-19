/**
 * M8 — Decisions du client du 18/11/2026 (lot « decisions atelier ») : regles pures.
 * Q42 km obligatoire a la creation / au rattachement d'une moto, Q43 statuts (OR a faire, RDV
 * receptionne, en cours au demarrage, deposee / en travail au planning), Q47 couleurs des types de RDV.
 * Execution : `bun test`.
 */
import { describe, expect, it } from 'bun:test';
import { canStartOr, checkMileage, mileageRequired, orStatusTone } from '../src/modules/workshop/or-base/rules';
import {
  APPOINTMENT_STATUSES, APPOINTMENT_STATUS_WITH_OR, DEFAULT_BLOCK_CLASS, JOB_BLOCK_CLASS, OR_STATUS_FROM_APPOINTMENT,
  appointmentBlockClass, appointmentPhase, appointmentStatusForOr, orIntakeNeeds, statusTone,
} from '../src/modules/workshop/planning/rules';

describe('Q42 — km obligatoire comme G8', () => {
  it('a la creation de l OR avec moto', () => {
    expect(mileageRequired({ isNew: true, savedVehicleId: null, vehicleId: 'v1' })).toBe(true);
    expect(mileageRequired({ isNew: true, savedVehicleId: null, vehicleId: null })).toBe(false);
  });
  it('ensuite : plus redemande tant que la moto ne change pas', () => {
    expect(mileageRequired({ isNew: false, savedVehicleId: 'v1', vehicleId: 'v1' })).toBe(false);
  });
  it('moto rattachee ou changee sur un OR existant : exige', () => {
    expect(mileageRequired({ isNew: false, savedVehicleId: null, vehicleId: 'v1' })).toBe(true);
    expect(mileageRequired({ isNew: false, savedVehicleId: 'v1', vehicleId: 'v2' })).toBe(true);
  });
  it('checkMileage suit `required` (km vide accepte sur un OR deja cree)', () => {
    expect(checkMileage({ input: '', hasVehicle: true, last: null, required: false })).toEqual({ kind: 'ok', km: null });
    expect(checkMileage({ input: '', hasVehicle: true, last: null, required: true })).toEqual({ kind: 'required' });
    // Un km modifie reste controle contre le dernier releve.
    const last = { km: 20000, at: '2026-10-01', source: 'or' as const, ref: 'OR-1' };
    expect(checkMileage({ input: '15000', hasVehicle: true, last, required: false }).kind).toBe('lower');
  });
  it('avant d ouvrir l OR depuis le RDV', () => {
    expect(orIntakeNeeds({ vehicle_id: 'v1', mileage: 12000 })).toBe('none');
    expect(orIntakeNeeds({ vehicle_id: 'v1', mileage: null })).toBe('mileage');
    expect(orIntakeNeeds({ vehicle_id: null, mileage: null })).toBe('vehicle');
  });
});

describe('Q43 — statuts comme G8', () => {
  it('OR ne « a faire », RDV « receptionne » (meme correspondance que la base)', () => {
    expect(OR_STATUS_FROM_APPOINTMENT).toBe('a_faire');
    expect(APPOINTMENT_STATUS_WITH_OR).toBe('arrive');
    expect(appointmentStatusForOr(OR_STATUS_FROM_APPOINTMENT)).toBe(APPOINTMENT_STATUS_WITH_OR);
  });
  it('« Demarrer » possible depuis a faire / attente, pas depuis en cours ni apres', () => {
    for (const s of ['a_faire', 'attente_devis', 'attente_pieces']) expect(canStartOr(s)).toBe(true);
    for (const s of ['en_cours', 'pret', 'client_informe', 'facture', 'annule', null]) expect(canStartOr(s)).toBe(false);
  });
  it('planning : « deposee » et « en travail » ont des couleurs differentes', () => {
    expect(statusTone('arrive')).not.toBe(statusTone('en_cours'));
    expect(statusTone('en_cours')).toBe('info');
    expect(appointmentPhase('arrive')).toBe('deposee');
    expect(appointmentPhase('en_cours')).toBe('en_travail');
    expect(appointmentPhase('prevu')).toBeNull();
  });
  it('OR : « a faire » et « en cours » se distinguent aussi', () => {
    expect(orStatusTone('a_faire')).not.toBe(orStatusTone('en_cours'));
    expect(orStatusTone('en_cours')).toBe('info');
  });
  it('tout statut a une couleur', () => {
    for (const s of APPOINTMENT_STATUSES) expect(statusTone(s)).toBeDefined();
  });
});

describe('Q47 — couleur du type de RDV sur le fond de la case', () => {
  it('palette fermee de tokens --job-*, fond teinte', () => {
    for (const cls of Object.values(JOB_BLOCK_CLASS)) {
      expect(cls).toMatch(/^border-l-job-[a-z]+ bg-job-[a-z]+\/20$/);
      expect(cls).not.toContain('ducati');
      expect(cls).not.toContain('#');
    }
  });
  it('sans couleur ou couleur inconnue : neutre', () => {
    expect(appointmentBlockClass(null)).toBe(DEFAULT_BLOCK_CLASS);
    expect(appointmentBlockClass('neutre')).toBe(DEFAULT_BLOCK_CLASS);
    expect(appointmentBlockClass('#C8102E')).toBe(DEFAULT_BLOCK_CLASS);
    expect(appointmentBlockClass('entretien')).toBe(JOB_BLOCK_CLASS.entretien);
  });
});
