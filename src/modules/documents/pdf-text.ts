/**
 * M9 — Assainissement du texte des PDF (jsPDF, polices standard WinAnsi).
 * Les espaces exotiques (insécable U+00A0, fine insécable U+202F utilisée
 * comme séparateur de milliers par toLocaleString('fr-BE'), etc.) sont HORS
 * de l'encodage WinAnsi des polices intégrées de jsPDF : elles ressortent en
 * caractère parasite (« / » pour U+202F). On les remplace par une espace
 * normale. Regex en séquences \u : source purement ASCII (anti-mangling).
 */
export function sanitizePdfText(v: string): string {
  return v.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ');
}

/**
 * Filet ABSOLU : remplace `doc.text` par une version qui assainit TOUTE chaîne
 * écrite dans le PDF, quelle que soit sa provenance (données, toLocaleString,
 * code futur). Couvre aussi les tableaux de lignes (splitTextToSize).
 * À appeler juste après `new jsPDF(...)`.
 */
export function patchPdfText(doc: { text: (...a: unknown[]) => unknown }): void {
  const raw = doc.text.bind(doc);
  doc.text = (t: unknown, ...rest: unknown[]) =>
    raw(Array.isArray(t) ? t.map((x) => sanitizePdfText(String(x))) : sanitizePdfText(String(t)), ...rest);
}
