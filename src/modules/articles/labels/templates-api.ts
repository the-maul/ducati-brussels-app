/**
 * M2 — Persistance des formats d'étiquettes (table label_templates, migration
 * 20260717). RÉSILIENCE : repli localStorage par poste tant que la migration
 * n'est pas appliquée (write-through, comme le paramétrage d'import).
 */
import { supabase } from '@/integrations/supabase/client';
import { defaultTemplateConfig, normalizeTemplateConfig, type LabelTemplate, type LabelTemplateConfig } from './template-types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = supabase as any;

function isMissingSchema(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01' || code === '42703';
}

const canStore = () => typeof window !== 'undefined' && !!window.localStorage;
const kTemplates = (companyId: string) => `ducati.label-templates.${companyId}`;

function readLocal(companyId: string): LabelTemplate[] {
  if (!canStore()) return [];
  try {
    const s = window.localStorage.getItem(kTemplates(companyId));
    return s ? (JSON.parse(s) as LabelTemplate[]) : [];
  } catch { return []; }
}
function writeLocal(companyId: string, list: LabelTemplate[]): void {
  if (!canStore()) return;
  try { window.localStorage.setItem(kTemplates(companyId), JSON.stringify(list)); } catch { /* quota (images volumineuses) */ }
}

/** Formats de la société (défaut « Brother 62×29 » créé à la volée si aucun). */
export async function listTemplates(companyId: string): Promise<LabelTemplate[]> {
  let list: LabelTemplate[] = [];
  try {
    const { data, error } = await raw
      .from('label_templates').select('*')
      .eq('company_id', companyId).order('created_at');
    if (error) throw error;
    list = (data as LabelTemplate[]) ?? [];
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
    list = readLocal(companyId);
  }
  if (list.length === 0) {
    list = [{
      id: `local-default-${companyId}`, company_id: companyId,
      name: 'Brother 62x29', is_default: true, config: defaultTemplateConfig(),
    }];
  }
  // Normalisation : formats enregistrés avant l'ajout de nouveaux éléments
  // (ex. Localisation 2) complétés avec les défauts — jamais de plantage.
  return list.map((x) => ({ ...x, config: normalizeTemplateConfig(x.config) }));
}

export async function saveTemplate(companyId: string, t: { id?: string | null; name: string; config: LabelTemplateConfig; is_default?: boolean }): Promise<string> {
  const isLocalId = !t.id || t.id.startsWith('local-');
  if (!isLocalId) {
    try {
      // is_default n'est PAS touché quand il n'est pas fourni (pas d'écrasement silencieux)
      const patch: Record<string, unknown> = { name: t.name, config: t.config };
      if (t.is_default !== undefined) patch.is_default = t.is_default;
      const { error } = await raw.from('label_templates').update(patch).eq('id', t.id);
      if (error) throw error;
      return t.id!;
    } catch (e) {
      if (!isMissingSchema(e)) throw e;
    }
  } else {
    try {
      const { data, error } = await raw.from('label_templates')
        .insert({ company_id: companyId, name: t.name, config: t.config, is_default: t.is_default ?? false })
        .select('id').single();
      if (error) throw error;
      return data.id as string;
    } catch (e) {
      if (!isMissingSchema(e)) throw e;
    }
  }
  // Repli local (write-through) — is_default existant conservé si non fourni
  const list = readLocal(companyId);
  const id = t.id && t.id.startsWith('local-') ? t.id : `local-${Date.now()}`;
  const idx = list.findIndex((x) => x.id === id);
  const next: LabelTemplate = {
    id, company_id: companyId, name: t.name,
    is_default: t.is_default ?? (idx >= 0 ? list[idx].is_default : false),
    config: t.config,
  };
  if (idx >= 0) list[idx] = next; else list.push(next);
  writeLocal(companyId, list);
  return id;
}

export async function deleteTemplate(companyId: string, id: string): Promise<void> {
  if (!id.startsWith('local-')) {
    try {
      const { error } = await raw.from('label_templates').delete().eq('id', id);
      if (error) throw error;
      return;
    } catch (e) {
      if (!isMissingSchema(e)) throw e;
    }
  }
  writeLocal(companyId, readLocal(companyId).filter((x) => x.id !== id));
}
