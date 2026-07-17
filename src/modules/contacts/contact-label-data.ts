/**
 * M1/M2 (B12) — Étiquette client : assemblage des lignes à imprimer selon les
 * informations cochées (nom, entreprise, moto, châssis, document, localisation).
 * Fonctions PURES — testées dans tests/contact-label.test.ts.
 */

/** Localisations magasin proposées (héritage G8) + texte libre. */
export const LABEL_LOCATIONS = ['Buanderie', 'G.ET.C', 'P.ET.C', 'ET.@'] as const;
export const LOCATION_FREE = '__free__';

/** 6 derniers caractères du châssis, préfixés « * » (repère visuel P-touch). */
export function vinLast6(vin: string | null | undefined): string {
  const v = (vin ?? '').replace(/\s/g, '');
  if (!v) return '';
  return `*${v.slice(-6).toUpperCase()}`;
}

export type ContactLabelSelection = {
  includeName: boolean; nameLine: string;
  includeCompany: boolean; companyLine: string;
  includeModel: boolean; modelLine: string;
  includeVin6: boolean; vin: string | null;
  includeDoc: boolean; docNumber: string;
  includeLocation: boolean; location: string; freeLocation: string;
};

/** Lignes de l'étiquette, dans l'ordre, sans lignes vides. */
export function buildContactLabelLines(s: ContactLabelSelection): string[] {
  const lines: string[] = [];
  if (s.includeName && s.nameLine.trim()) lines.push(s.nameLine.trim().toUpperCase());
  if (s.includeCompany && s.companyLine.trim()) lines.push(s.companyLine.trim().toUpperCase());
  if (s.includeModel && s.modelLine.trim()) lines.push(s.modelLine.trim().toUpperCase());
  if (s.includeVin6) {
    const v = vinLast6(s.vin);
    if (v) lines.push(v);
  }
  if (s.includeDoc && s.docNumber.trim()) lines.push(s.docNumber.trim().toUpperCase());
  if (s.includeLocation) {
    const loc = s.location === LOCATION_FREE ? s.freeLocation : s.location;
    if (loc.trim()) lines.push(loc.trim().toUpperCase());
  }
  return lines;
}
