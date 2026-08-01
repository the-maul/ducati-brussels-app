/**
 * M7 — Notes structurées d'une reprise (bloc texte stocké sur la fiche véhicule).
 * Le formulaire de reprise sérialise ses réponses en lignes « Libellé : valeur ».
 * Ce module fait le chemin INVERSE (parse) pour permettre de MODIFIER une
 * reprise à tout moment, puis de re-sérialiser à l'identique.
 * Fonctions PURES — testées dans tests/reprise-notes.test.ts.
 */
import { WEAR_ITEMS } from './reprise-wizard-data';

export type RepriseNotes = {
  vatDeductible: boolean | null;
  fuel: string;
  transmission: string;
  owners: string;
  techState: string;
  techDesc: string;
  /** clé WEAR_ITEMS → état (Neuf / Moyen / A remplacer / Je ne sais pas) */
  wear: Record<string, string>;
  originalPaint: boolean | null;
  imported: boolean | null;
  papers100: boolean;
  accessories: string[];
  wishedPrice: string;
  wishedPriceVisible: boolean;
  remarks: string;
};

export const EMPTY_NOTES: RepriseNotes = {
  vatDeductible: null, fuel: '', transmission: '', owners: '', techState: '', techDesc: '',
  wear: {}, originalPaint: null, imported: null, papers100: false, accessories: [],
  wishedPrice: '', wishedPriceVisible: true, remarks: '',
};

const yes = (v: string) => v.trim().toLowerCase() === 'oui';

/** Découpe « Libellé : valeur » (le 1er deux-points sépare). */
function splitLine(line: string): { key: string; value: string } | null {
  const i = line.indexOf(':');
  if (i < 0) return null;
  return { key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
}

/** Lit un bloc de notes de reprise. Les lignes inconnues vont dans `remarks`. */
export function parseRepriseNotes(notes: string | null | undefined): RepriseNotes {
  const out: RepriseNotes = { ...EMPTY_NOTES, wear: {}, accessories: [] };
  const extra: string[] = [];
  const wearByLabel = new Map(WEAR_ITEMS.map((w) => [w.label.toLowerCase(), w.key]));

  for (const rawLine of String(notes ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const kv = splitLine(line);
    if (!kv) { extra.push(line); continue; }
    const k = kv.key.toLowerCase();
    const v = kv.value;

    if (k === 'tva déductible') { out.vatDeductible = yes(v); continue; }
    if (k === 'carburant') { out.fuel = v; continue; }
    if (k === 'transmission') { out.transmission = v; continue; }
    if (k === 'propriétaires') { out.owners = v; continue; }
    if (k === 'état technique') {
      // « Traces d'usure — description libre »
      const [state, ...rest] = v.split('—');
      out.techState = state.trim();
      out.techDesc = rest.join('—').trim();
      continue;
    }
    if (wearByLabel.has(k)) { out.wear[wearByLabel.get(k)!] = v; continue; }
    // Rétrocompatibilité : ancien format (un seul état d'usure + un état pneus).
    // « Satisfaisant » est l'ancien libellé de « Moyen ».
    if (k === "pièces d'usure") {
      const val = /satisfaisant/i.test(v) ? 'Moyen' : v;
      out.wear.brake_front = out.wear.brake_front || val;
      out.wear.brake_rear = out.wear.brake_rear || val;
      out.wear.chain_kit = out.wear.chain_kit || val;
      continue;
    }
    if (k === 'pneus') {
      const val = /satisfaisant/i.test(v) ? 'Moyen' : v;
      out.wear.tyre_front = out.wear.tyre_front || val;
      out.wear.tyre_rear = out.wear.tyre_rear || val;
      continue;
    }
    if (k === "peinture d'origine") { out.originalPaint = yes(v); continue; }
    if (k === 'véhicule importé') { out.imported = yes(v); continue; }
    if (k === 'papiers 100 ch') { out.papers100 = yes(v); continue; }
    if (k === 'accessoires') {
      out.accessories = v.split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (k === 'prix souhaité') { out.wishedPrice = v.replace(/€/g, '').trim(); continue; }
    if (k === 'prix souhaité visible pdf') { out.wishedPriceVisible = yes(v); continue; }
    if (k === 'remarques') { out.remarks = v; continue; }
    extra.push(line); // ligne non reconnue : conservée
  }

  out.remarks = [out.remarks, ...extra].filter(Boolean).join('\n');
  return out;
}

/**
 * Re-sérialise les notes (même format que l'assistant).
 * @param withPdfMarker inclut le marqueur interne de visibilité du prix souhaité
 *   (stocké sur le véhicule, jamais envoyé aux marchands).
 */
export function buildRepriseNotes(n: RepriseNotes, withPdfMarker = true): string {
  const lines: string[] = [];
  if (n.vatDeductible != null) lines.push(`TVA déductible : ${n.vatDeductible ? 'Oui' : 'Non'}`);
  if (n.fuel) lines.push(`Carburant : ${n.fuel}`);
  if (n.transmission) lines.push(`Transmission : ${n.transmission}`);
  if (n.owners) lines.push(`Propriétaires : ${n.owners}`);
  if (n.techState) lines.push(`État technique : ${n.techState}${n.techDesc ? ` — ${n.techDesc}` : ''}`);
  for (const it of WEAR_ITEMS) {
    if (n.wear[it.key]) lines.push(`${it.label} : ${n.wear[it.key]}`);
  }
  if (n.originalPaint != null) lines.push(`Peinture d'origine : ${n.originalPaint ? 'Oui' : 'Non'}`);
  if (n.imported != null) lines.push(`Véhicule importé : ${n.imported ? 'Oui' : 'Non'}`);
  if (n.papers100) lines.push('Papiers 100 CH : Oui');
  if (n.accessories.length) lines.push(`Accessoires : ${n.accessories.join(', ')}`);
  if (n.wishedPrice.trim()) lines.push(`Prix souhaité : ${n.wishedPrice.trim()} €`);
  if (n.remarks.trim()) lines.push(`Remarques : ${n.remarks.trim()}`);
  if (withPdfMarker && n.wishedPrice.trim()) {
    lines.push(`Prix souhaité visible PDF : ${n.wishedPriceVisible ? 'Oui' : 'Non'}`);
  }
  return lines.join('\n');
}
