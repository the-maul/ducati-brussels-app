/**
 * M8 — Parcours mecanicien, lot C (19/11/2026) : photos et commentaires de reception, regles pures
 * (miroir de la migration 20261119270000).
 *  - serie d'usine (avant, arriere, gauche, droite, compteur, plaque / VIN), toutes obligatoires ;
 *  - lecture tolerante du reglage, validation (code, doublon, libelle des photos ajoutees) ;
 *  - photo par case, photos de degats en plus, case retiree de la serie gardee ;
 *  - obligatoires manquantes signalees, prochaine case a prendre ;
 *  - la serie est proposee avant « Demarrer » sans jamais bloquer (« Plus tard »).
 * Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import {
  DAMAGE_SLOT, DEFAULT_RECEPTION_SLOTS, arrangePhotos, codeFromLabel, missingRequired, nextSlot, parseSlots,
  receptionSummary, receptionTone, shouldPromptReception, slotLabel, validateSlots, type ReceptionPhoto,
} from '../src/modules/workshop/reception/rules';

const photo = (slot: string, n = 1): ReceptionPhoto => ({
  id: `p-${slot}-${n}`, or_id: 'or-1', vehicle_id: 'v-1', slot_code: slot, attachment_id: `a-${slot}-${n}`,
  storage_path: `co/repair_order/or-1/${slot}-${n}.jpg`, comment: null, taken_by_name: 'Marco', taken_at: '2026-11-19T08:00:00Z', sort_order: n,
});
const tr = (k: string) => (k === 'reception.slot_compteur' ? 'Compteur (km)' : k);

describe('lot C — serie de reception', () => {
  test("serie d'usine : 6 photos obligatoires dans l'ordre demande", () => {
    expect(DEFAULT_RECEPTION_SLOTS.map((s) => s.code)).toEqual(['face_avant', 'face_arriere', 'cote_gauche', 'cote_droit', 'compteur', 'plaque_vin']);
    expect(DEFAULT_RECEPTION_SLOTS.every((s) => s.required)).toBe(true);
  });

  test('reglage absent ou illisible : serie d usine ; codes nettoyes, degat et doublons ecartes', () => {
    expect(parseSlots(null)).toEqual(DEFAULT_RECEPTION_SLOTS);
    expect(parseSlots([{ code: 'Compteur', required: false }, { code: 'degat' }, { code: 'compteur' }, { code: 'reservoir', label: ' Réservoir ' }])).toEqual([
      { code: 'compteur', required: false },
      { code: 'reservoir', required: true, label: 'Réservoir' },
    ]);
  });

  test('validation du reglage (miroir de workshop_reception_settings_set)', () => {
    expect(validateSlots(DEFAULT_RECEPTION_SLOTS)).toBeNull();
    expect(validateSlots([{ code: 'selle', required: true }])).toBe('reception.errLabelMissing');
    expect(validateSlots([{ code: 'selle', required: true, label: 'Selle' }])).toBeNull();
    expect(validateSlots([{ code: 'degat', required: true, label: 'X' }])).toBe('reception.errCode');
    expect(validateSlots([{ code: 'compteur', required: true }, { code: 'compteur', required: false }])).toBe('reception.errDuplicate');
    expect(validateSlots(Array.from({ length: 21 }, (_, i) => ({ code: `p${i}`, required: false, label: 'x' })))).toBe('reception.errTooMany');
  });

  test("code d'une photo ajoutee tire de son libelle, sans collision", () => {
    expect(codeFromLabel('Réservoir')).toBe('reservoir');
    expect(codeFromLabel('Réservoir', ['reservoir'])).toBe('reservoir_2');
    expect(codeFromLabel('Dégât')).toBe('degat_1');
  });

  test("libelle : celui de l'atelier, sinon la traduction, sinon le code", () => {
    expect(slotLabel({ code: 'reservoir', label: 'Réservoir' }, tr)).toBe('Réservoir');
    expect(slotLabel({ code: 'compteur' }, tr)).toBe('Compteur (km)');
    expect(slotLabel({ code: 'inconnu' }, tr)).toBe('inconnu');
  });
});

describe('lot C — photos prises', () => {
  test('une photo par case, degats en plus, case retiree gardee visible', () => {
    const a = arrangePhotos(DEFAULT_RECEPTION_SLOTS, [photo('face_avant'), photo(DAMAGE_SLOT, 2), photo(DAMAGE_SLOT, 1), photo('ancienne_case')]);
    expect(a.bySlot[0].photo?.id).toBe('p-face_avant-1');
    expect(a.bySlot[1].photo).toBeNull();
    expect(a.damages.map((p) => p.sort_order)).toEqual([1, 2]);
    expect(a.others.map((p) => p.slot_code)).toEqual(['ancienne_case']);
  });

  test('obligatoires manquantes signalees ; une conseillee ne manque jamais', () => {
    const slots = [{ code: 'face_avant', required: true }, { code: 'reservoir', required: false, label: 'Réservoir' }, { code: 'compteur', required: true }];
    expect(missingRequired(slots, [photo('face_avant')])).toEqual(['compteur']);
    expect(missingRequired(slots, [photo('face_avant'), photo('compteur')])).toEqual([]);
  });

  test('la serie guide : premiere obligatoire vide, puis les conseillees', () => {
    const slots = [{ code: 'reservoir', required: false, label: 'R' }, { code: 'face_avant', required: true }];
    expect(nextSlot(slots, [])?.code).toBe('face_avant');
    expect(nextSlot(slots, [photo('face_avant')])?.code).toBe('reservoir');
    expect(nextSlot(slots, [photo('face_avant'), photo('reservoir')])).toBeNull();
  });

  test('resume : prises / total, manquantes, degats', () => {
    const s = receptionSummary(DEFAULT_RECEPTION_SLOTS, [photo('face_avant'), photo('compteur'), photo(DAMAGE_SLOT)]);
    expect(s).toEqual({ taken: 2, total: 6, missing: ['face_arriere', 'cote_gauche', 'cote_droit', 'plaque_vin'], damages: 1 });
  });
});

describe('lot C — jamais bloquant', () => {
  test('« Demarrer » propose la serie tant que la reception n est ni terminee ni remise a plus tard', () => {
    expect(shouldPromptReception('none', 'a_faire')).toBe(true);
    expect(shouldPromptReception('en_cours', 'a_faire')).toBe(true);
    expect(shouldPromptReception('plus_tard', 'a_faire')).toBe(false);
    expect(shouldPromptReception('complete', 'attente_pieces')).toBe(false);
    expect(shouldPromptReception('none', 'facture')).toBe(false);
  });

  test('statut = couleur : terminee incomplete et « Plus tard » en avertissement', () => {
    expect(receptionTone('complete', 0)).toBe('success');
    expect(receptionTone('complete', 2)).toBe('warning');
    expect(receptionTone('plus_tard', 0)).toBe('warning');
    expect(receptionTone('none', 6)).toBe('neutral');
  });
});
