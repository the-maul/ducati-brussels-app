/**
 * M14 — Migration G8 : import de contacts depuis un CSV (dry-run + application).
 * Mapping souple des en-têtes (FR/EN), validation, aperçu des créations/erreurs,
 * puis insertion. Réutilisable pour d'autres entités sur le même patron.
 */
import { supabase } from '@/integrations/supabase/client';

export type ParsedRow = Record<string, string>;
export type ImportPreview = {
  headers: string[];
  rows: ParsedRow[];
  mapped: { row: ParsedRow; payload: Record<string, unknown>; error: string | null }[];
  toCreate: number;
  errors: number;
};

const HEADER_MAP: Record<string, string> = {
  nom: 'last_name', name: 'last_name', last_name: 'last_name', lastname: 'last_name',
  prenom: 'first_name', 'prénom': 'first_name', first_name: 'first_name', firstname: 'first_name',
  societe: 'company_name', 'société': 'company_name', raison_sociale: 'company_name', company: 'company_name', company_name: 'company_name',
  email: 'email', 'e-mail': 'email', mail: 'email',
  tel: 'phone', 'téléphone': 'phone', telephone: 'phone', phone: 'phone',
  gsm: 'mobile', mobile: 'mobile', portable: 'mobile',
  adresse: 'address', address: 'address', rue: 'address',
  cp: 'zip', code_postal: 'zip', zip: 'zip',
  ville: 'city', city: 'city',
  pays: 'country', country: 'country',
  tva: 'vat_number', vat: 'vat_number', vat_number: 'vat_number', 'n_tva': 'vat_number',
  type: 'type',
};

const TYPE_MAP: Record<string, string> = {
  particulier: 'particulier', professionnel: 'professionnel', pro: 'professionnel',
  fournisseur: 'fournisseur', supplier: 'fournisseur', banque: 'banque_leasing', leasing: 'banque_leasing',
};

const norm = (s: string) => s.trim().toLowerCase().replace(/^﻿/, '');

function detectDelimiter(line: string): string {
  const counts = [';', ',', '\t'].map((d) => [d, line.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ';';
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseContactsCsv(text: string): ImportPreview {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { headers: [], rows: [], mapped: [], toCreate: 0, errors: 0 };
  const delim = detectDelimiter(lines[0]);
  const rawHeaders = splitCsvLine(lines[0], delim);
  const headers = rawHeaders.map((h) => norm(h));
  const fields = headers.map((h) => HEADER_MAP[h] ?? null);

  const rows: ParsedRow[] = [];
  const mapped: ImportPreview['mapped'] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim);
    const row: ParsedRow = {};
    rawHeaders.forEach((h, j) => { row[h] = cells[j] ?? ''; });
    rows.push(row);

    const payload: Record<string, unknown> = { type: 'particulier', country: 'BE' };
    fields.forEach((f, j) => {
      const v = (cells[j] ?? '').trim();
      if (!f || v === '') return;
      if (f === 'type') payload.type = TYPE_MAP[v.toLowerCase()] ?? 'particulier';
      else payload[f] = v;
    });
    const hasName = (payload.last_name as string)?.trim() || (payload.company_name as string)?.trim();
    mapped.push({ row, payload, error: hasName ? null : 'Nom ou raison sociale requis' });
  }
  return { headers, rows, mapped, toCreate: mapped.filter((m) => !m.error).length, errors: mapped.filter((m) => m.error).length };
}

/** Applique l'import : insère les contacts valides. Retourne le nombre créé. */
export async function applyContactsImport(companyId: string, preview: ImportPreview): Promise<number> {
  const payloads = preview.mapped.filter((m) => !m.error).map((m) => ({ ...m.payload, company_id: companyId, status: 'client' }));
  if (payloads.length === 0) return 0;
  // Insertion par lots de 200
  let created = 0;
  for (let i = 0; i < payloads.length; i += 200) {
    const batch = payloads.slice(i, i + 200);
    const { error, count } = await supabase.from('contacts').insert(batch, { count: 'exact' });
    if (error) throw error;
    created += count ?? batch.length;
  }
  return created;
}
