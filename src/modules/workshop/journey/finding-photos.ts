/**
 * M8 — Chantier C1 (23/11/2026, ATE-05) : les photos du parcours vont dans les documents de l'OR
 * (GED, dossier « Parcours »), plus en base64 dans l'état du parcours.
 * Réseau coupé : la photo reste sur la tablette (jamais envoyée en base64 à la base, voir
 * `store.ts`) et repart à la prochaine ouverture du dossier ou du parcours.
 */
import { uploadAttachment } from '@/modules/documents/ged-api';
import { loadJourney, saveJourney } from './store';
import type { Finding, JourneyState } from './types';

export const JOURNEY_GED_FOLDER = 'Parcours';

const uid = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function dataUrlToFile(dataUrl: string, name: string | null | undefined): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name || `photo-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
}

/** Dépose la photo dans la GED de l'OR. Échec (réseau) : le constat revient inchangé. */
export async function storeFindingPhoto(companyId: string, orId: string, f: Finding): Promise<Finding> {
  if (!f.photoData || f.photoPath) return f;
  try {
    const file = await dataUrlToFile(f.photoData, f.photoName);
    const note = f.texte ? `${JOURNEY_GED_FOLDER} - ${f.texte.slice(0, 120)}` : JOURNEY_GED_FOLDER;
    const photoPath = await uploadAttachment(companyId, 'repair_order', orId, file, Date.now(), note, JOURNEY_GED_FOLDER);
    return { ...f, photoPath, photoData: null };
  } catch {
    return f;
  }
}

/** Renvoie les photos restées sur la tablette. L'état n'est réécrit que si l'une d'elles est partie. */
export async function flushPendingPhotos(companyId: string, state: JourneyState): Promise<JourneyState> {
  if (!state.findings.some((f) => f.photoData && !f.photoPath)) return state;
  const findings: Finding[] = [];
  let changed = false;
  for (const f of state.findings) {
    const next = await storeFindingPhoto(companyId, state.orId, f);
    if (next !== f) changed = true;
    findings.push(next);
  }
  if (!changed) return state;
  const next = { ...state, findings };
  saveJourney(companyId, next);
  return next;
}

export async function flushDossierPhotos(companyId: string, orId: string): Promise<JourneyState | null> {
  const s = await loadJourney(orId);
  return s ? flushPendingPhotos(companyId, s) : null;
}

/** Dossier sans parcours commencé : l'état ne porte que les constats (aucune opération). */
export function emptyJourney(orId: string, now = new Date().toISOString()): JourneyState {
  return { version: 1, orId, modelYearId: '', serviceLabel: '', startedAt: now, finishedAt: null, operations: [], findings: [], reportedToOr: false };
}

/** Un parcours est commencé dès qu'il a des opérations (un simple commentaire n'en commence pas). */
export const journeyStarted = (s: JourneyState | null | undefined): s is JourneyState => !!s && s.operations.length > 0;

/** Commentaire ou photo depuis le dossier, enregistré avec les constats du parcours. */
export async function addDossierNote(
  companyId: string, orId: string, input: Omit<Finding, 'id' | 'at'>,
): Promise<{ state: JourneyState; photo: boolean; pending: boolean }> {
  const base = (await loadJourney(orId)) ?? emptyJourney(orId);
  const finding = await storeFindingPhoto(companyId, orId, { ...input, id: uid(), at: new Date().toISOString() });
  const state = { ...base, findings: [...base.findings, finding] };
  saveJourney(companyId, state);
  const photo = input.kind === 'photo';
  return { state, photo, pending: photo && !finding.photoPath };
}
