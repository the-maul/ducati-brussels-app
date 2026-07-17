/**
 * M1 — Vérification des numéros de TVA (BE + UE) via VIES (Commission
 * européenne), appelée par la fonction SQL `vies_check` (anti-CORS).
 * Fonctions pures (parsing du numéro, analyse de l'adresse VIES pour le
 * préremplissage) testées dans tests/vies.test.ts.
 */
import { supabase } from '@/integrations/supabase/client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Codes pays UE acceptés par VIES (EL = Grèce, XI = Irlande du Nord). */
const EU_CODES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI',
]);

/** Normalise et découpe un n° TVA : « be 0451.308.707 » → { country:'BE', number:'0451308707' }. */
export function parseVatInput(raw: string): { country: string; number: string } | null {
  const s = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  const m = s.match(/^([A-Z]{2})(.+)$/);
  if (m && EU_CODES.has(m[1])) return { country: m[1], number: m[2] };
  // Pas de préfixe pays → belge par défaut (9 chiffres → 0 devant)
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  return { country: 'BE', number: digits.length === 9 ? `0${digits}` : digits };
}

/**
 * Analyse l'adresse VIES (« Rue de la Loi 16\n1000 Bruxelles ») pour le
 * préremplissage : rue, numéro, code postal, ville. Best-effort — champs
 * absents laissés vides.
 */
export function parseViesAddress(address: string | null | undefined): { street: string; number: string; zip: string; city: string } {
  const out = { street: '', number: '', zip: '', city: '' };
  const lines = (address ?? '').split('\n').map((l) => l.trim()).filter((l) => l && l !== '---');
  if (lines.length === 0) return out;
  // Dernière ligne : « 1000 Bruxelles » (ou « L-1855 Luxembourg »)
  const last = lines[lines.length - 1];
  const zm = last.match(/^([A-Z]{0,2}-?\d{4,5})\s+(.+)$/i);
  if (zm) { out.zip = zm[1]; out.city = zm[2]; }
  else if (lines.length === 1) { out.city = last; return out; }
  // Première ligne : « Rue de la Loi 16 » / « Avenue X 12 b3 »
  const first = lines[0] === last && zm ? '' : lines[0];
  if (first) {
    const sm = first.match(/^(.+?)\s+(\d+[A-Za-z0-9/.-]*)$/);
    if (sm) { out.street = sm[1]; out.number = sm[2]; }
    else out.street = first;
  }
  return out;
}

export type ViesResult = {
  status: 'valid' | 'invalid' | 'unavailable' | 'not_configured';
  name: string | null;
  address: string | null;
  country: string;
  number: string;
};

/** Interroge VIES via la fonction SQL. Gère l'absence de la fonction (SQL non installé). */
export async function checkVat(raw: string): Promise<ViesResult | null> {
  const parsed = parseVatInput(raw);
  if (!parsed) return null;
  const { data, error } = await (supabase as any).rpc('vies_check', { _country: parsed.country, _number: parsed.number });
  if (error) {
    const code = (error as { code?: string }).code ?? '';
    const missing = code === 'PGRST202' || code === '42883' || /vies_check/i.test(error.message ?? '');
    return { status: missing ? 'not_configured' : 'unavailable', name: null, address: null, ...parsed };
  }
  const d = (data ?? {}) as { error?: string; isValid?: boolean; name?: string | null; address?: string | null };
  if (d.error) return { status: 'unavailable', name: null, address: null, ...parsed };
  const clean = (s: string | null | undefined) => {
    const v = (s ?? '').trim();
    return v && v !== '---' ? v : null;
  };
  return {
    status: d.isValid ? 'valid' : 'invalid',
    name: clean(d.name),
    address: clean(d.address),
    ...parsed,
  };
}

/** Lien de vérification manuelle BCE/KBO (entreprises belges). */
export function kboUrl(number: string): string {
  return `https://kbopub.economie.fgov.be/kbopub/zoeknummerform.html?lang=fr&nummer=${encodeURIComponent(number)}&actionLu=Rechercher`;
}

/** Lien de vérification manuelle Companyweb (entreprises belges). */
export function companywebUrl(number: string): string {
  return `https://www.companyweb.be/fr/${encodeURIComponent(number)}`;
}
