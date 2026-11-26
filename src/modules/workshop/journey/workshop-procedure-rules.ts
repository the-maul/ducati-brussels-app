/**
 * M8 — Mode operatoire « maison » (Simon, 26/11/2026, ATE014). Regles PURES
 * (tests/atelier-mode-operatoire-atelier.test.ts). Tables et fonctions : migration 20261126270000.
 *
 * Quand le modele n'a pas de manuel d'atelier Ducati, l'atelier ecrit son mode operatoire par
 * operation (etapes, couples de serrage, outils, remarques, photos de la GED), pour CE modele-annee
 * ou pour TOUTES les motos du modele. Il est repris sur les parcours suivants, a la place du mode
 * operatoire Ducati, dans le meme ecran (ProcedureView) avec la mention « Mode operatoire de
 * l'atelier » + auteur + date. Un mode operatoire Ducati, quand il existe, passe toujours avant.
 */
import type { Procedure } from './types';

export type WorkshopProcedureScope = 'model_year' | 'model';

export type WorkshopProcedure = {
  id: string;
  company_id: string;
  scope: WorkshopProcedureScope;
  model_year_id: string | null;
  model_id: string;
  op_key: string;
  op_label: string;
  steps: { text: string }[];
  torques: { label: string; value: string }[];
  tools: string[];
  remarks: string | null;
  version: number;
  created_by_name: string | null;
  created_at: string;
  updated_by_name: string | null;
  updated_at: string;
  versions?: number;
};

export type OrProceduresInfo = {
  model_year_id: string | null;
  model_year: number | null;
  model_year_name: string | null;
  model_id: string | null;
  model_name: string | null;
  family_name: string | null;
  can_write: boolean;
  /** Mode operatoire de l'atelier par op_key de l'OR (op1, op2...). */
  byOpKey: Map<string, WorkshopProcedure>;
};

export const ATELIER_PROCEDURE_PREFIX = 'atelier:';

export type ProcedureChoice =
  | { kind: 'ducati'; procedureId: string }
  | { kind: 'atelier'; procedure: WorkshopProcedure }
  | { kind: 'none'; canWrite: boolean };

/** Ducati d'abord ; sinon celui de l'atelier ; sinon rien (l'atelier peut l'ecrire s'il en a le droit). */
export function chooseProcedure(ducatiProcedureId: string | null | undefined, atelier: WorkshopProcedure | null | undefined, canWrite: boolean): ProcedureChoice {
  if (ducatiProcedureId) return { kind: 'ducati', procedureId: ducatiProcedureId };
  if (atelier && atelier.steps.length) return { kind: 'atelier', procedure: atelier };
  return { kind: 'none', canWrite };
}

/** « 25 Nm », « 25 », « 12,5 nm » → 25 / 12,5 ; autre chose (plage, texte) → null (texte gardé tel quel). */
export function parseTorqueNm(value: string | null | undefined): number | null {
  const m = String(value ?? '').trim().match(/^(\d+(?:[.,]\d+)?)\s*(n\.?\s?m)?$/i);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/** Le mode operatoire de l'atelier dans la forme du manuel Ducati (meme ecran pas a pas). */
export function toProcedure(wp: WorkshopProcedure, remarkTitle: string): Procedure {
  return {
    id: `${ATELIER_PROCEDURE_PREFIX}${wp.id}`,
    titre: wp.op_label,
    outils: wp.tools.map((d) => ({ description: d })),
    couples: wp.torques.map((c) => {
      const nm = parseTorqueNm(c.value);
      return nm != null
        ? { etape: null, valeurNm: nm, texte: c.label }
        : { etape: null, valeurNm: null, texte: [c.label, c.value].filter(Boolean).join(' : ') };
    }),
    avertissements: wp.remarks ? [{ type: 'remarque', titre: remarkTitle, texte: wp.remarks }] : [],
    etapes: wp.steps.map((s, i) => ({ n: i + 1, texte: s.text })),
  };
}

export type ProcedureDraft = {
  scope: WorkshopProcedureScope;
  steps: string[];
  torques: { label: string; value: string }[];
  tools: string[];
  remarks: string;
};

/** Brouillon d'edition : la version enregistree, ou une page vierge (une etape vide, portee modele-annee). */
export function draftFrom(wp: WorkshopProcedure | null | undefined, defaultScope: WorkshopProcedureScope = 'model_year'): ProcedureDraft {
  if (!wp) return { scope: defaultScope, steps: [''], torques: [], tools: [], remarks: '' };
  return {
    scope: wp.scope,
    steps: wp.steps.length ? wp.steps.map((s) => s.text) : [''],
    torques: wp.torques.map((c) => ({ ...c })),
    tools: [...wp.tools],
    remarks: wp.remarks ?? '',
  };
}

/** Ce qui part en base : textes vides retires (meme nettoyage que workshop_procedure_save). */
export function cleanDraft(d: ProcedureDraft): ProcedureDraft {
  return {
    scope: d.scope,
    steps: d.steps.map((s) => s.trim()).filter(Boolean),
    torques: d.torques.map((c) => ({ label: c.label.trim(), value: c.value.trim() })).filter((c) => c.label || c.value),
    tools: d.tools.map((s) => s.trim()).filter(Boolean),
    remarks: d.remarks.trim(),
  };
}

export const draftValid = (d: ProcedureDraft) => cleanDraft(d).steps.length > 0;

/** Nom lisible de la portee : « Monster 1100 S 2009 » (modele-annee) ou « Monster 1100 S » (modele). */
export function scopeName(info: Pick<OrProceduresInfo, 'family_name' | 'model_name' | 'model_year' | 'model_year_name'>, scope: WorkshopProcedureScope): string {
  const fam = (info.family_name ?? '').trim();
  const model = (info.model_name ?? info.model_year_name ?? '').trim();
  const base = model.toUpperCase().startsWith(fam.toUpperCase()) || !fam ? model : `${fam} ${model}`;
  return scope === 'model_year' && info.model_year ? `${base} ${info.model_year}` : base;
}

/** Lecture de workshop_procedures_for_or → informations de portee + mode operatoire par operation. */
export function toOrProceduresInfo(raw: unknown): OrProceduresInfo {
  const r = (raw ?? {}) as Partial<OrProceduresInfo> & { procedures?: { op_key: string; procedure: WorkshopProcedure }[] };
  const byOpKey = new Map<string, WorkshopProcedure>();
  for (const x of r.procedures ?? []) {
    if (!x?.procedure) continue;
    byOpKey.set(x.op_key, {
      ...x.procedure,
      steps: x.procedure.steps ?? [], torques: x.procedure.torques ?? [], tools: x.procedure.tools ?? [],
    });
  }
  return {
    model_year_id: r.model_year_id ?? null, model_year: r.model_year ?? null, model_year_name: r.model_year_name ?? null,
    model_id: r.model_id ?? null, model_name: r.model_name ?? null, family_name: r.family_name ?? null,
    can_write: !!r.can_write, byOpKey,
  };
}
