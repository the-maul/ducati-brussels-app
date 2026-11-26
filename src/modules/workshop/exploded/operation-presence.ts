/**
 * M8 — ATE-05 (26/11/2026, Simon : « pourquoi il y a vidange de liquide de refroidissement s'il n'y
 * en a pas sur cette moto ? »). Règles PURES (tests/atelier-vue-eclatee-operation.test.ts).
 *
 * Les motos sans manuel d'atelier reprennent le plan d'entretien Ducati générique, avec des
 * opérations « (si présent) ». On lit le catalogue de CE modèle-année (titres de dessins et
 * désignations de pièces) pour savoir si l'élément existe :
 *  - présent  : l'opération reste, le libellé perd « (si présent) » ;
 *  - absent   : l'opération n'est pas affichée (ou, pour « huile de freins et d'embrayage », la
 *               partie embrayage disparaît du libellé : les freins restent) ;
 *  - inconnu  : pas de modèle-année, catalogue vide, ou aucun indice dans un sens ni dans l'autre :
 *               l'opération reste telle quelle.
 * Rien n'est supprimé en base : c'est un filtre d'affichage (voir usePlanOps).
 */
import { normalizeText } from './operation-components';

export type Presence = 'present' | 'absent' | 'unknown';
export type PresenceDrawing = { drawing_id: string; description: string | null };
export type PresenceLine = { drawing_id: string; description: string | null };
export type PresenceIndex = { drawings: readonly PresenceDrawing[]; lines: readonly PresenceLine[] };

/** Opération « si présent / si prévu(e)s » : on sait la régler. */
const CONDITIONAL = /\(SI (PRESENTE?S?|PREVUE?S?)\)/;
const COND_SUFFIX = /\s*\((si\s+(présente?s?|presente?s?|prévue?s?|prevue?s?))\)/i;
const CLUTCH_PART = /\s+et\s+d['’]\s?embrayage\s*\((si\s+présent|si\s+present)\)/i;

type Facts = { titles: string[]; descs: string[]; byDrawing: Map<string, string[]>; titleOf: Map<string, string> };

function factsOf(idx: PresenceIndex): Facts {
  const titleOf = new Map(idx.drawings.map((d) => [d.drawing_id, normalizeText(d.description)]));
  const byDrawing = new Map<string, string[]>();
  for (const l of idx.lines) {
    if (!titleOf.has(l.drawing_id)) continue;
    const arr = byDrawing.get(l.drawing_id) ?? [];
    arr.push(normalizeText(l.description));
    byDrawing.set(l.drawing_id, arr);
  }
  const tools = /OUTILS?|INSTRUMENT|TESTER/;
  const titles = [...titleOf.values()].filter((t) => !tools.test(t));
  const descs = [...byDrawing].filter(([id]) => !tools.test(titleOf.get(id) ?? '')).flatMap(([, d]) => d);
  return { titles, descs, byDrawing, titleOf };
}

const any = (arr: readonly string[], re: RegExp) => arr.some((s) => re.test(s));

/** Refroidissement liquide : radiateur d'eau, vase d'expansion, pompe à eau, circuit de refroidissement. */
export function liquidCooling(idx: PresenceIndex): Presence {
  if (!idx.drawings.length) return 'unknown';
  const f = factsOf(idx);
  if (any(f.titles, /RADIATEUR (D'?)?EAU|POMPE A EAU|REFROIDISSEMENT|RAFFREDDAMENTO/)) return 'present';
  if (any(f.descs, /^(VASE|RESERVOIR) (D'?)?(EXPANSION|EAU)|^RADIATEUR (D'?)?EAU|^POMPE A EAU|LIQUIDE (DE )?REFROIDISSEMENT/)) return 'present';
  return f.descs.length ? 'absent' : 'unknown';
}

/** Commande d'embrayage : hydraulique (maître-cylindre) ou par câble. */
export function clutchCommand(idx: PresenceIndex): 'hydraulique' | 'cable' | 'unknown' {
  if (!idx.drawings.length) return 'unknown';
  const f = factsOf(idx);
  if (any(f.titles, /MAITRE.?CYLINDRE (D.)?EMBRAYAGE/)
    || any(f.descs, /^(MAITRE.?CYLINDRE|POMPE) (D.)?EMBRAYAGE|^TUYAU (D.)?HUILE (D.)?EMBRAYAGE|^KIT PISTON FLOTTANT EMBRAYAGE|^CYLINDRE (DE )?POUSSEE EMBRAYAGE/)) return 'hydraulique';
  if (any(f.descs, /^CABLE (DE |D')?(COMMANDE )?(D')?EMBRAYAGE|^TRANSMISSION (DE )?COMMANDE EMBRAYAGE/)) return 'cable';
  // Dessin de commande d'embrayage avec un levier, sans maître-cylindre : câble.
  for (const [id, descs] of f.byDrawing) {
    const title = f.titleOf.get(id) ?? '';
    if (/COMANDO FRIZIONE|COMMANDE (D.)?EMBRAYAGE/.test(title) && any(descs, /^LEVIER (D.)?EMBRAYAGE/) && any(descs, /^CABLE/)) return 'cable';
  }
  return 'unknown';
}

/** Roues à rayons. */
export function spokedWheels(idx: PresenceIndex): Presence {
  if (!idx.drawings.length) return 'unknown';
  const f = factsOf(idx);
  if (any(f.descs, /^RAYONS?( |$)|ROUES? A RAYONS|JANTE A RAYONS/)) return 'present';
  return any(f.descs, /^JANTE/) ? 'absent' : 'unknown';
}

/** Système d'air secondaire (soupape à lamelles). */
export function secondaryAir(idx: PresenceIndex): Presence {
  if (!idx.drawings.length) return 'unknown';
  const f = factsOf(idx);
  if (any(f.titles, /AIR SECONDAIRE/) || any(f.descs, /AIR SECONDAIRE|^SOUPAPE (A )?LAMELLES/)) return 'present';
  return f.descs.length ? 'absent' : 'unknown';
}

export type ConditionalVerdict = { visible: boolean; label: string; rule: string | null; presence: Presence };

/**
 * Ce que devient une opération « (si présent) » pour cette moto. `idx` null : catalogue inconnu,
 * l'opération reste telle quelle.
 */
export function conditionalOperation(label: string, idx: PresenceIndex | null): ConditionalVerdict {
  const keep: ConditionalVerdict = { visible: true, label, rule: null, presence: 'unknown' };
  const text = normalizeText(label);
  if (!CONDITIONAL.test(text) || !idx) return keep;
  const strip = (l: string) => l.replace(COND_SUFFIX, '').replace(/\s+$/, '');

  if (/LIQUIDE (DE |DU )?REFROIDISSEMENT/.test(text)) {
    const p = liquidCooling(idx);
    if (p === 'present') return { visible: true, label: strip(label), rule: 'refroidissement', presence: p };
    if (p === 'absent') return { visible: false, label, rule: 'refroidissement', presence: p };
    return { ...keep, rule: 'refroidissement' };
  }
  if (/EMBRAYAGE AVEC CABLE|CABLE D'?EMBRAYAGE/.test(text)) {
    const c = clutchCommand(idx);
    if (c === 'cable') return { visible: true, label: strip(label), rule: 'embrayage_cable', presence: 'present' };
    if (c === 'hydraulique') return { visible: false, label, rule: 'embrayage_cable', presence: 'absent' };
    return { ...keep, rule: 'embrayage_cable' };
  }
  if (/(HUILE|LIQUIDE) (DE |DES |DU )?FREINS? ET D'?EMBRAYAGE/.test(text)) {
    const c = clutchCommand(idx);
    if (c === 'hydraulique') return { visible: true, label: strip(label), rule: 'embrayage_hydraulique', presence: 'present' };
    // Embrayage à câble : l'opération reste pour les freins, sans l'embrayage.
    if (c === 'cable') return { visible: true, label: label.replace(CLUTCH_PART, ''), rule: 'embrayage_hydraulique', presence: 'absent' };
    return { ...keep, rule: 'embrayage_hydraulique' };
  }
  if (/ROUES A RAYONS/.test(text)) {
    const p = spokedWheels(idx);
    if (p === 'present') return { visible: true, label: strip(label), rule: 'roues_rayons', presence: p };
    if (p === 'absent') return { visible: false, label, rule: 'roues_rayons', presence: p };
    return { ...keep, rule: 'roues_rayons' };
  }
  if (/AIR SECONDAIRE/.test(text)) {
    const p = secondaryAir(idx);
    if (p === 'present') return { visible: true, label: strip(label), rule: 'air_secondaire', presence: p };
    if (p === 'absent') return { visible: false, label, rule: 'air_secondaire', presence: p };
    return { ...keep, rule: 'air_secondaire' };
  }
  return keep;
}

/** Note posée sur une opération absente de la moto, marquée « non faite » au moment de « Terminer ». */
export const ABSENT_ON_BIKE_NOTE = 'Sans objet : élément absent sur cette moto (catalogue Ducati)';

/**
 * La liste de l'OR vue pour CETTE moto : opérations absentes retirées, libellés sans « (si présent) ».
 * `toSettle` : absentes encore « à faire », à régler « non faite / sans objet » pour que « Terminer »
 * et l'avancement x / y ne les attendent pas.
 */
export function applyBikePresence<O extends { label: string; status: string; not_done_note?: string | null }>(
  ops: readonly O[], idx: PresenceIndex | null,
): { visible: O[]; hidden: O[]; toSettle: O[] } {
  const visible: O[] = [];
  const hidden: O[] = [];
  for (const o of ops) {
    const v = conditionalOperation(o.label, idx);
    if (v.visible) visible.push(v.label === o.label ? o : { ...o, label: v.label });
    else hidden.push(o);
  }
  return { visible, hidden, toSettle: hidden.filter((o) => o.status === 'a_faire') };
}

/** L'opération a été réglée « sans objet » (absente de la moto) : rien à mentionner sur la facture ni sur l'OR imprimé. */
export function isAbsentOnBike(o: { status: string; not_done_note?: string | null }): boolean {
  return o.status === 'non_fait' && o.not_done_note === ABSENT_ON_BIKE_NOTE;
}

/** Faut-il lire le catalogue pour cette liste ? */
export function hasConditionalOps(ops: readonly { label: string }[]): boolean {
  return ops.some((o) => CONDITIONAL.test(normalizeText(o.label)));
}
