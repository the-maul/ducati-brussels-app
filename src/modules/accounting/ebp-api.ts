/**
 * M12 — Transfert comptable « EBP » identique à G8 (lot-g8-export-compta, 18/11/2026).
 *
 * Décision de Simon (18/11) : tant que Falco n'est pas branché, ce transfert (ECRITURES.TXT +
 * COMPTES.TXT) est LA voie officielle vers le comptable. L'export Winbooks provisoire et l'UBL restent
 * disponibles tels quels (téléchargement seulement).
 *
 * La mise en forme et la résolution des comptes vivent dans supabase/functions/_shared (partagées avec
 * la tâche planifiée) ; ce fichier câble l'écran : aperçu, lancement, historique, annulation,
 * paramètres et comptes.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  buildEbpTransfer, type EbpResult, type EbpLine,
} from '../../../supabase/functions/_shared/ebp-format';
import {
  loadEbpSources, loadEbpRules, loadEbpSettings, parseEbpSettings, proposeCustomerAccount, contactName,
  type EbpDbClient, type EbpRule, type EbpRuleKind, type EbpSelection, type EbpSettings, type EbpLoadResult,
} from '../../../supabase/functions/_shared/ebp-sources';

export type { EbpRule, EbpRuleKind, EbpSettings, EbpSelection, EbpResult, EbpLine, EbpLoadResult };
export { parseEbpSettings, proposeCustomerAccount };

/** Tables du lot non encore présentes dans types.ts (généré depuis la base) : client non typé. */
const db = supabase as unknown as EbpDbClient;

// ---- Paramètres -------------------------------------------------------------------------
export async function getEbpSettings(companyId: string): Promise<EbpSettings> {
  return loadEbpSettings(db, companyId);
}

export async function saveEbpSettings(companyId: string, settings: EbpSettings): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await db.from('accounting_transfer_settings')
    .upsert({ company_id: companyId, params: settings, updated_at: new Date().toISOString(), updated_by: user?.id ?? null }, { onConflict: 'company_id' });
  if (error) throw error;
}

// ---- Règles de comptes (Gestion des comptes) -------------------------------------------
export async function listRules(companyId: string): Promise<EbpRule[]> {
  return loadEbpRules(db, companyId);
}

export async function saveRule(companyId: string, rule: EbpRule): Promise<void> {
  const row = {
    company_id: companyId, kind: rule.kind, key: rule.key || null, family: rule.family || null,
    vat_rate: rule.vat_rate === null || Number.isNaN(Number(rule.vat_rate)) ? null : Number(rule.vat_rate),
    tax_exempt: rule.tax_exempt, demo: rule.demo, customer_category: rule.customer_category || null,
    account: (rule.account ?? '').trim(), account2: rule.account2?.trim() || null, account3: rule.account3?.trim() || null,
    country: rule.country || null, journal: rule.journal || null, label: rule.label || null, mode_label: rule.mode_label || null,
    is_active: rule.is_active, sort_order: rule.sort_order ?? 0, updated_at: new Date().toISOString(),
  };
  const q = rule.id ? db.from('accounting_account_rules').update(row).eq('id', rule.id) : db.from('accounting_account_rules').insert(row);
  const { error } = await q;
  if (error) throw error;
}

export async function deleteRule(id: string): Promise<void> {
  const { error } = await db.from('accounting_account_rules').delete().eq('id', id);
  if (error) throw error;
}

// ---- Comptes clients / fournisseurs ----------------------------------------------------
export type ThirdAccount = {
  id: string; contact_id: string; kind: 'C' | 'F'; account: string; label: string | null; origin: string;
  contact_code: string | null; contact_name: string;
};

export async function listThirdAccounts(companyId: string, kind: 'C' | 'F'): Promise<ThirdAccount[]> {
  const out: ThirdAccount[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await db.from('accounting_third_accounts')
      .select('id, contact_id, kind, account, label, origin, contacts(code, company_name, first_name, last_name)')
      .eq('company_id', companyId).eq('kind', kind).order('account').range(start, start + 999);
    if (error) throw error;
    const rows = (data ?? []) as (Omit<ThirdAccount, 'contact_code' | 'contact_name'> & { contacts: { code: string | null; company_name: string | null; first_name: string | null; last_name: string | null } | null })[];
    for (const r of rows) {
      out.push({
        id: r.id, contact_id: r.contact_id, kind: r.kind, account: r.account, label: r.label, origin: r.origin,
        contact_code: r.contacts?.code ?? null,
        contact_name: r.contacts ? contactName({ id: r.contact_id, code: r.contacts.code, company_name: r.contacts.company_name, first_name: r.contacts.first_name, last_name: r.contacts.last_name, address: null, zip: null, city: null, country: null, phone: null }) : '',
      });
    }
    if (rows.length < 1000) break;
  }
  return out;
}

export async function saveThirdAccount(companyId: string, a: { id?: string; contact_id: string; kind: 'C' | 'F'; account: string; label: string | null }): Promise<void> {
  const row = { company_id: companyId, contact_id: a.contact_id, kind: a.kind, account: a.account.trim(), label: a.label?.trim() || null, origin: 'manual', updated_at: new Date().toISOString() };
  const q = a.id ? db.from('accounting_third_accounts').update(row).eq('id', a.id) : db.from('accounting_third_accounts').upsert(row, { onConflict: 'company_id,contact_id,kind' });
  const { error } = await q;
  if (error) throw error;
}

export async function deleteThirdAccount(id: string): Promise<void> {
  const { error } = await db.from('accounting_third_accounts').delete().eq('id', id);
  if (error) throw error;
}

/** G8 « Création automatique » (base + code), « Mettre à jour clients » (intitulés), « Récupérer depuis client ». */
export async function createThirdAccounts(companyId: string, kind: 'C' | 'F', mode: 'auto' | 'refresh' | 'from_contact', settings: EbpSettings): Promise<number> {
  const base = kind === 'C' ? settings.sales.customerAutoBase : settings.purchases.supplierAutoBase;
  const width = kind === 'C' ? settings.sales.customerAutoWidth : settings.purchases.supplierAutoWidth;
  const { data, error } = await db.rpc('accounting_create_third_accounts', { _company: companyId, _kind: kind, _mode: mode, _base: base, _width: width });
  if (error) throw error;
  return Number(data ?? 0);
}

// ---- Transfert ---------------------------------------------------------------------------
export type EbpPreview = { result: EbpResult; load: EbpLoadResult; settings: EbpSettings };

/** Lit les documents non transférés de la sélection et construit les deux fichiers (rien n'est enregistré). */
export async function previewTransfer(companyId: string, sel: EbpSelection, settingsOverride?: Partial<Pick<EbpSettings, 'writeMode'>>): Promise<EbpPreview> {
  const [settings, rules] = await Promise.all([getEbpSettings(companyId), listRules(companyId)]);
  const s = { ...settings, ...settingsOverride };
  const load = await loadEbpSources(db, companyId, sel, s, rules);
  const result = buildEbpTransfer(load.sources, {
    writeMode: s.writeMode, paymentsFirst: s.paymentsFirst, dedupeThirds: s.dedupeThirds,
  });
  return { result, load, settings: s };
}

function download(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=us-ascii' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/** Les documents d'origine (y compris ceux à 0 € qui n'écrivent rien) : marquage « transféré ». */
export function transferItems(result: EbpResult): { kind: string; id: string; piece: number | null }[] {
  return result.items;
}

/**
 * Lance le transfert : enregistre l'historique (n° séquentiel par société), marque les documents
 * « transférés » puis télécharge ECRITURES.TXT et COMPTES.TXT. Refusé si un document est parti entre-temps.
 */
export async function runTransfer(companyId: string, sel: EbpSelection, preview: EbpPreview): Promise<{ id: string; transfer_no: number }> {
  const { result, settings } = preview;
  const items = transferItems(result);
  const { data, error } = await db.rpc('record_accounting_transfer', {
    _company: companyId,
    _t: {
      mode: 'manual', period_from: sel.selection === 'period' ? sel.from : null, period_to: sel.to,
      number_from: sel.selection === 'number' ? sel.numberFrom ?? null : null, number_to: sel.selection === 'number' ? sel.numberTo ?? null : null,
      options: { ...sel, writeMode: settings.writeMode, paymentsFirst: settings.paymentsFirst },
      file_dir: settings.targetDir, entries_file: settings.entriesFile, accounts_file: settings.accountsFile,
      ecritures: result.ecritures, comptes: result.comptes, pieces: result.pieces, lines: result.lines.length,
      total_debit: result.totalDebit, total_credit: result.totalCredit, items,
    },
  });
  if (error) throw error;
  download(settings.entriesFile, result.ecritures);
  download(settings.accountsFile, result.comptes);
  return data as { id: string; transfer_no: number };
}

// ---- Historique et annulation ----------------------------------------------------------
export type TransferRow = {
  id: string; transfer_no: number; mode: string; created_at: string; period_from: string | null; period_to: string | null;
  number_from: string | null; number_to: string | null; file_dir: string | null; entries_file: string; accounts_file: string;
  pieces: number; lines: number; total_debit: number; status: 'transfere' | 'annule'; cancelled_at: string | null; cancel_reason: string | null;
};

export async function listTransfers(companyId: string): Promise<TransferRow[]> {
  const { data, error } = await db.from('accounting_transfers')
    .select('id, transfer_no, mode, created_at, period_from, period_to, number_from, number_to, file_dir, entries_file, accounts_file, pieces, lines, total_debit, status, cancelled_at, cancel_reason')
    .eq('company_id', companyId).order('transfer_no', { ascending: false }).limit(200);
  if (error) throw error;
  return ((data ?? []) as TransferRow[]).map((r) => ({ ...r, total_debit: Number(r.total_debit) }));
}

/** Retélécharge les fichiers d'un transfert (tels qu'ils ont été produits). */
export async function downloadTransfer(id: string): Promise<void> {
  const { data, error } = await db.from('accounting_transfers').select('entries_file, accounts_file, ecritures, comptes').eq('id', id).single();
  if (error) throw error;
  const r = data as { entries_file: string; accounts_file: string; ecritures: string; comptes: string };
  download(r.entries_file, r.ecritures);
  download(r.accounts_file, r.comptes);
}

/** G8 « Annuler transfert comptable n° … » : comptable / admin, motif obligatoire, tracé. */
export async function cancelTransfer(id: string, reason: string): Promise<void> {
  const { error } = await db.rpc('cancel_accounting_transfer', { _transfer: id, _reason: reason });
  if (error) throw error;
}

/** Contacts pour l'ajout manuel d'un compte (recherche par nom ou code). */
export async function searchContactsForAccount(companyId: string, q: string): Promise<{ id: string; code: string | null; name: string }[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const safe = term.replace(/[%,()]/g, ' ');
  const { data, error } = await supabase.from('contacts')
    .select('id, code, company_name, first_name, last_name')
    .eq('company_id', companyId)
    .or(`code.eq.${safe},last_name.ilike.%${safe}%,company_name.ilike.%${safe}%`)
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id, code: c.code, name: contactName({ ...c, address: null, zip: null, city: null, country: null, phone: null }) }));
}
