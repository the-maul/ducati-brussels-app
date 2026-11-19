/**
 * M8 — Parcours mecanicien, lot C (19/11/2026) : photos et commentaires de reception. Regles pures
 * (sans base ni React), testees dans `tests/atelier-reception-photos.test.ts`.
 * Miroir des fonctions SQL de la migration 20261119270000 (workshop_reception_default_slots,
 * workshop_reception_settings_set, repair_order_reception_missing).
 *
 * - La serie par defaut (reglage atelier) : avant, arriere, gauche, droite, compteur (km),
 *   plaque / VIN ; chaque case peut etre obligatoire ou conseillee. Les photos de DEGATS (code
 *   reserve `degat`) sont libres et toujours possibles en plus.
 * - Une photo obligatoire manquante n'empeche JAMAIS de continuer : elle est signalee.
 */

export type ReceptionSlot = { code: string; required: boolean; label?: string | null };

/** Code reserve des photos libres de degats (en nombre). */
export const DAMAGE_SLOT = 'degat';

/** Serie d'usine, dans l'ordre de prise (miroir de workshop_reception_default_slots). */
export const DEFAULT_RECEPTION_SLOTS: ReceptionSlot[] = [
  { code: 'face_avant', required: true },
  { code: 'face_arriere', required: true },
  { code: 'cote_gauche', required: true },
  { code: 'cote_droit', required: true },
  { code: 'compteur', required: true },
  { code: 'plaque_vin', required: true },
];
export const DEFAULT_SLOT_CODES = DEFAULT_RECEPTION_SLOTS.map((s) => s.code);

export type ReceptionStatus = 'none' | 'en_cours' | 'complete' | 'plus_tard';

export type ReceptionPhoto = {
  id: string;
  or_id: string;
  vehicle_id: string | null;
  slot_code: string;
  attachment_id: string;
  storage_path: string;
  comment: string | null;
  taken_by_name: string | null;
  taken_at: string;
  sort_order: number;
};

const CODE_RE = /^[a-z0-9_]{1,40}$/;

/** Libelle d'une case : celui de l'atelier, sinon la traduction de la case d'usine, sinon le code. */
export function slotLabel(slot: Pick<ReceptionSlot, 'code' | 'label'>, tr: (k: string) => string): string {
  if (slot.label && slot.label.trim()) return slot.label.trim();
  const key = `reception.slot_${slot.code}`;
  const v = tr(key);
  return v === key ? slot.code : v;
}

/** Lecture tolerante du reglage (jsonb) : liste valide, sinon la serie d'usine. */
export function parseSlots(raw: unknown): ReceptionSlot[] {
  if (!Array.isArray(raw)) return DEFAULT_RECEPTION_SLOTS;
  const out: ReceptionSlot[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const code = String(o.code ?? '').trim().toLowerCase();
    if (!CODE_RE.test(code) || code === DAMAGE_SLOT || seen.has(code)) continue;
    seen.add(code);
    const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : null;
    out.push({ code, required: o.required === undefined ? true : o.required === true, ...(label ? { label } : {}) });
  }
  return out;
}

/** Erreur de saisie du reglage (cle i18n), ou null si la serie est valable (miroir du SQL). */
export function validateSlots(slots: ReceptionSlot[]): string | null {
  if (slots.length > 20) return 'reception.errTooMany';
  const seen = new Set<string>();
  for (const s of slots) {
    const code = s.code.trim().toLowerCase();
    if (!CODE_RE.test(code) || code === DAMAGE_SLOT) return 'reception.errCode';
    if (seen.has(code)) return 'reception.errDuplicate';
    seen.add(code);
    const label = (s.label ?? '').trim();
    if (label.length > 60) return 'reception.errLabelLong';
    if (!label && !DEFAULT_SLOT_CODES.includes(code)) return 'reception.errLabelMissing';
  }
  return null;
}

/** Code d'une case ajoutee par l'atelier, tire de son libelle (« Réservoir » → « reservoir »). */
export function codeFromLabel(label: string, taken: string[] = []): string {
  const base = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36) || 'photo';
  const safe = base === DAMAGE_SLOT ? `${base}_1` : base;
  if (!taken.includes(safe)) return safe;
  for (let i = 2; i < 100; i++) if (!taken.includes(`${safe}_${i}`)) return `${safe}_${i}`;
  return `${safe}_${Date.now() % 1000}`;
}

/** Photo de chaque case de la serie (null = pas encore prise) et photos de degats. */
export function arrangePhotos(slots: ReceptionSlot[], photos: ReceptionPhoto[]): {
  bySlot: { slot: ReceptionSlot; photo: ReceptionPhoto | null }[];
  damages: ReceptionPhoto[];
  others: ReceptionPhoto[];
} {
  const codes = new Set(slots.map((s) => s.code));
  const bySlot = slots.map((slot) => ({ slot, photo: photos.find((p) => p.slot_code === slot.code) ?? null }));
  const damages = photos.filter((p) => p.slot_code === DAMAGE_SLOT).sort((a, b) => a.sort_order - b.sort_order);
  // Case retiree de la serie depuis la prise : la photo reste visible (jamais perdue).
  const others = photos.filter((p) => p.slot_code !== DAMAGE_SLOT && !codes.has(p.slot_code));
  return { bySlot, damages, others };
}

/** Cases obligatoires sans photo (miroir de repair_order_reception_missing). */
export function missingRequired(slots: ReceptionSlot[], photos: Pick<ReceptionPhoto, 'slot_code'>[]): string[] {
  const taken = new Set(photos.map((p) => p.slot_code));
  return slots.filter((s) => s.required && !taken.has(s.code)).map((s) => s.code);
}

/** Prochaine case a photographier (la serie guide : premiere case vide, obligatoires d'abord). */
export function nextSlot(slots: ReceptionSlot[], photos: Pick<ReceptionPhoto, 'slot_code'>[]): ReceptionSlot | null {
  const taken = new Set(photos.map((p) => p.slot_code));
  return slots.find((s) => s.required && !taken.has(s.code)) ?? slots.find((s) => !taken.has(s.code)) ?? null;
}

export type ReceptionSummary = { taken: number; total: number; missing: string[]; damages: number };

export function receptionSummary(slots: ReceptionSlot[], photos: ReceptionPhoto[]): ReceptionSummary {
  const a = arrangePhotos(slots, photos);
  return {
    taken: a.bySlot.filter((x) => x.photo).length,
    total: slots.length,
    missing: missingRequired(slots, photos),
    damages: a.damages.length,
  };
}

/**
 * Faut-il proposer la serie avant de « Demarrer » ? Oui tant que la reception n'est ni terminee ni
 * remise a plus tard. Ne bloque jamais : l'ecran propose, le mecanicien peut passer.
 */
export function shouldPromptReception(status: ReceptionStatus, orStatus: string | null | undefined): boolean {
  if (orStatus === 'facture' || orStatus === 'annule' || orStatus === 'pret' || orStatus === 'client_informe') return false;
  return status === 'none' || status === 'en_cours';
}

/** Couleur du statut de reception (toujours avec icone + libelle). */
export function receptionTone(status: ReceptionStatus, missing: number): 'success' | 'warning' | 'neutral' | 'info' {
  if (status === 'complete') return missing ? 'warning' : 'success';
  if (status === 'plus_tard') return 'warning';
  if (status === 'en_cours') return missing ? 'info' : 'success';
  return 'neutral';
}
