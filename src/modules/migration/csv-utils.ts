/**
 * M14 — Migration G8 : petits utilitaires CSV partagés par les imports
 * (contacts, articles, véhicules) : détection du séparateur, découpage d'une
 * ligne (guillemets), normalisation d'en-tête insensible à la casse/accents.
 */

/** En-tête normalisé : minuscule, accents retirés, ponctuation/espaces → "_". */
export function normHeader(s: string): string {
  return s.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^﻿/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function detectDelimiter(line: string): string {
  const counts = [';', ',', '\t'].map((d) => [d, line.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ';';
}

export function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Nombre tolérant (virgule ou point décimal). */
export function parseNum(s: string): number | null {
  const n = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export type ParsedRow = Record<string, string>;
export type ImportPreview = {
  headers: string[];
  rows: ParsedRow[];
  mapped: { row: ParsedRow; payload: Record<string, unknown>; error: string | null }[];
  toCreate: number;
  errors: number;
};

/** Découpe un CSV (1re ligne = en-têtes) en lignes brutes indexées par en-tête d'origine. */
export function splitCsvRows(text: string): { rawHeaders: string[]; dataLines: string[]; delim: string } | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;
  const delim = detectDelimiter(lines[0]);
  const rawHeaders = splitCsvLine(lines[0], delim);
  return { rawHeaders, dataLines: lines.slice(1), delim };
}

export type ApplyResult = { created: number; ignored: number };
