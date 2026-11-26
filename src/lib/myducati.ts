/**
 * Réception des données My Ducati envoyées par l'extension navigateur (par VIN).
 * Enregistre, sous la session de l'utilisateur (RLS) : moto + garantie + bulletins + maintenance,
 * et le compte client Ducati sur le propriétaire courant de la moto.
 */
import { supabase } from '@/integrations/supabase/client';
import { dcsStart } from '@/lib/dcs-progress';
import {
  buildDcsClientSnapshot, buildDcsContactPatch, checkDcsPayload, cleanDcsEvents, matchDcsModel, parseDcsDate, planDcsImport,
  type DcsCounts, type DcsDecisions, type DcsModelCandidate, type DcsOwnerCheck, type DcsPayloadV2, type DcsRefusal, pickDcsVehicle,
} from '@/lib/dcs-rules';

export type MyDucatiPayload = DcsPayloadV2 & {
  vin: string;
  contact: Record<string, unknown>;
  vehicle: Record<string, unknown>;
  bulletins?: { bulletin_id?: string; title?: string; number?: string; published_at?: string; url?: string; pdf_base64?: string; pdf_name?: string }[];
  scraped_at?: string;
  source_url?: string;
};

// Function and columns created by migration 20261123130000: outside the generated types.
const looseRpc = supabase as unknown as {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};
const looseFrom = supabase as unknown as {
  from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => PromiseLike<{ data: unknown; error: unknown }> } };
};

/** Values a user already settled on this bike: the next read does not ask again. */
async function loadDcsDecisions(vehicleId: string): Promise<DcsDecisions> {
  const { data, error } = await looseFrom.from('vehicle_field_status').select('field, dcs_value, source').eq('vehicle_id', vehicleId);
  if (error) throw error;
  const out: DcsDecisions = {};
  for (const r of (data ?? []) as Array<{ field: string; dcs_value: string | null; source: string | null }>) {
    if (r.source === 'decision') out[r.field] = r.dcs_value;
  }
  return out;
}

/** Société active au moment de la demande : l'import n'est appliqué que sur celle-ci. */
const DCS_REQUEST_TTL_MS = 10 * 60 * 1000;
const dcsRequests = new Map<string, { companyId: string | null; vehicleId: string | null; at: number }>();
let dcsActiveCompany: string | null = null;
export const setDcsActiveCompany = (id: string | null) => { dcsActiveCompany = id; };

/** Demande en cours pour ce VIN (consommée) : société et fiche d'où elle part ; null = pas de demande connue. */
export function takeDcsRequest(vin: string): { companyId: string | null; vehicleId: string | null } | null {
  const key = vin.toUpperCase();
  const r = dcsRequests.get(key);
  dcsRequests.delete(key);
  return r && Date.now() - r.at <= DCS_REQUEST_TTL_MS ? { companyId: r.companyId, vehicleId: r.vehicleId } : null;
}

/**
 * Découpe le nom combiné du portail DCS (« SÉBASTIEN NUNES ») selon la règle
 * magasin : le PREMIER mot est le prénom, le reste est le nom.
 * Fonction pure — testée dans tests/myducati.test.ts.
 */
export function splitFullName(full: unknown): { first: string; last: string } {
  const tokens = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: '', last: '' };
  return { first: tokens[0], last: tokens.slice(1).join(' ') };
}

/** Origine de la moto : « Garantie activée par », sinon « Moto facturée à » (Simon, 23/11/2026). */
export function dcsOrigin(activatedBy: unknown, invoicedTo: unknown): string | undefined {
  for (const v of [activatedBy, invoicedTo]) {
    const s = String(v ?? '').trim();
    if (s && s !== '-') return s;
  }
  return undefined;
}

const nameTokens = (s: unknown): string[] => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

/** Le nom lu au DCS est-il bien celui du propriétaire de la fiche ? Dans le doute : non. */
export function dcsOwnerMatches(dcsName: unknown, owner: { last_name?: string | null; company_name?: string | null }): boolean {
  const dcs = new Set(nameTokens(dcsName));
  if (dcs.size === 0) return false;
  const last = nameTokens(owner.last_name);
  if (last.length > 0 && last.every((x) => dcs.has(x))) return true;
  return nameTokens(owner.company_name).some((x) => x.length >= 4 && dcs.has(x));
}

/** base64 → Uint8Array (pour uploader un PDF rapatrié par l'extension). */
const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * Demande à l'extension d'aller scraper My Ducati pour ce VIN (ouvre l'URL, scrape, réimporte).
 * Renvoie true si l'extension a accusé réception (donc installée + active), false sinon (timeout).
 * Les données arrivent ensuite via l'écouteur global (MyDucatiListener).
 */
export function requestMyDucati(vin: string, vehicleId: string | null = null): Promise<boolean> {
  return new Promise((resolve) => {
    if (!vin) { resolve(false); return; }
    const requestKey = vin.toUpperCase();
    dcsRequests.set(requestKey, { companyId: dcsActiveCompany, vehicleId, at: Date.now() });
    let done = false;
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { source?: string; action?: string } | null;
      if (ev.origin === window.location.origin && d && d.source === 'dms-ducati-ext' && d.action === 'fetch-ack') {
        done = true; window.removeEventListener('message', onMsg); dcsStart(requestKey); resolve(true);
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ source: 'dms-ducati', action: 'fetch-myducati', vin }, window.location.origin);
    setTimeout(() => { if (!done) { window.removeEventListener('message', onMsg); dcsRequests.delete(requestKey); resolve(false); } }, 2000);
  });
}

export type ApplyResult = {
  matched: boolean; refused?: DcsRefusal; vehicleId?: string; bulletins?: number; events?: number;
  counts?: DcsCounts; invalid?: string[]; ownerMismatch?: boolean;
  /** false: the bike is saved, but the customer or the catalogue fields could not be completed. */
  completed?: boolean; catalogFilled?: string[];
};

export type BulletinPdfPayload = { number?: string; pdf_base64?: string; pdf_name?: string };

/**
 * Enregistre le PDF d'un bulletin (téléchargé par l'extension sur bulletins.ducati.com)
 * et le range sur TOUTES les motos qui référencent ce numéro de bulletin (company courante).
 * Une seule copie stockée, liée à chaque ligne. Renvoie le nombre de motos mises à jour.
 */
export async function saveBulletinPdf(companyId: string, b: BulletinPdfPayload): Promise<{ updated: number }> {
  if (!b?.number || !b.pdf_base64) return { updated: 0 };
  const { data: rows } = await supabase.from('vehicle_bulletins')
    .select('id').eq('company_id', companyId).eq('number', b.number);
  if (!rows || !rows.length) return { updated: 0 };           // aucune moto avec ce bulletin
  const safe = (b.pdf_name || `${b.number}.pdf`).replace(/[^\w.-]+/g, '_').slice(-60);
  const path = `${companyId}/bulletins/${b.number.replace(/[^\w.-]+/g, '_')}/${Date.now()}_${safe}`;
  const { error } = await supabase.storage.from('ged').upload(path, base64ToBytes(b.pdf_base64), { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  await supabase.from('vehicle_bulletins').update({ storage_path: path }).eq('company_id', companyId).eq('number', b.number);
  return { updated: rows.length };
}

const VEHICLE_COLUMNS = 'id, vin, model, ducati_model_year_id, engine_number, plate, color, origin, mileage, production_date, ship_date, warranty_start, warranty_end, warranty_type, warranty_state, warranty_activated_by, invoiced_to, ducati_state, ducati_usage';

/**
 * Applique un import DCS : contrôles, décision champ par champ (dcs-rules), puis écriture en une
 * seule transaction (dcs_import_commit). Toute erreur remonte : pas de message de succès trompeur.
 */
export async function applyMyDucatiData(companyId: string, p: MyDucatiPayload, requestedVehicleId: string | null = null): Promise<ApplyResult> {
  const refused = checkDcsPayload(p);
  if (refused) return { matched: false, refused };
  const vin = String(p.read_vin).toUpperCase();

  const { data: found, error: findError } = await supabase.from('vehicles').select(VEHICLE_COLUMNS)
    .eq('company_id', companyId).eq('vin', vin).limit(20);
  if (findError) throw findError;
  const target = pickDcsVehicle((found ?? []) as unknown as Array<{ id: string }>, requestedVehicleId);
  if (!target) return { matched: false };
  if (target === 'duplicate') return { matched: false, refused: 'duplicate_vin' };
  const current = target as unknown as Record<string, unknown>;
  const vehicleId = current.id as string;

  // Versions possibles de ce VIN : le titre DCS départage, jamais de choix au hasard.
  const { data: identity, error: identityError } = await looseRpc.rpc('vin_identify', { _vin: vin });
  if (identityError) throw identityError;
  const candidates = (identity as { candidates?: DcsModelCandidate[] } | null)?.candidates ?? [];
  const model = matchDcsModel(p.header?.descriptor, p.header?.year, candidates);

  // Propriétaire : le nom lu au DCS est comparé, jamais écrit sur une autre personne.
  const c = p.contact || {};
  let firstName = String(c.my_ducati_first_name ?? '').trim();
  let lastName = String(c.my_ducati_last_name ?? '').trim();
  if (!firstName && !lastName) {
    const s = splitFullName(c.my_ducati_name ?? c.name);
    firstName = s.first;
    lastName = s.last;
  }
  const dcsName = [firstName, lastName].filter(Boolean).join(' ');
  const { data: ownerRow, error: ownerError } = await supabase.from('vehicle_owners').select('contact_id')
    .eq('vehicle_id', vehicleId).eq('is_current', true).order('from_date', { ascending: false }).limit(1).maybeSingle();
  if (ownerError) throw ownerError;
  let owner: DcsOwnerCheck | null = dcsName ? { name: dcsName, currentName: null, matches: false } : null;
  let contactId: string | null = null;
  if (ownerRow?.contact_id && owner) {
    const { data: fiche, error: ficheError } = await supabase.from('contacts')
      .select('first_name, last_name, company_name').eq('id', ownerRow.contact_id).maybeSingle();
    if (ficheError) throw ficheError;
    if (fiche) {
      owner = {
        name: dcsName,
        currentName: [fiche.first_name, fiche.last_name].filter(Boolean).join(' ') || fiche.company_name || null,
        matches: dcsOwnerMatches(dcsName, fiche),
      };
      if (owner.matches) contactId = ownerRow.contact_id;
    }
  }

  const decisions = await loadDcsDecisions(vehicleId);
  const plan = planDcsImport({ current, payload: p, model, owner, decisions });
  const events = cleanDcsEvents(p.maintenance);
  const bulletins = (p.bulletins || []).filter((b) => b.bulletin_id).map((b) => ({
    bulletin_id: b.bulletin_id, title: b.title || null, number: b.number || null,
    published_at: parseDcsDate(b.published_at), url: b.url || null,
  }));
  // La preuve brute reste sur la moto, sans les coordonnées du client.
  const raw: Record<string, unknown> = { ...p };
  delete raw.contact;

  const { data, error } = await looseRpc.rpc('dcs_import_commit', {
    _company: companyId, _vehicle: vehicleId, _vin: vin,
    _changes: plan.changes, _statuses: plan.statuses, _raw: raw,
    _maintenance: events, _maintenance_tables: p.maintenance_tables ?? [], _bulletins: bulletins,
    _contact: contactId, _contact_patch: contactId ? buildDcsContactPatch(c, firstName, lastName) : null,
  });
  if (error) throw error;
  const saved = (data ?? {}) as { events?: number; bulletins?: number };

  // Second step, kept apart so that the import itself never depends on it (manual and nightly).
  let completed: boolean | undefined;
  let catalogFilled: string[] = [];
  let done: Awaited<ReturnType<typeof looseRpc.rpc>>;
  try {
    done = await looseRpc.rpc('dcs_import_complete', {
      _company: companyId, _vehicle: vehicleId, _vin: vin, _client: buildDcsClientSnapshot(c, firstName, lastName),
    });
  } catch {
    done = { data: null, error: { message: 'dcs_complete_failed' } };
  }
  if (done.error) {
    // Migration not applied yet: the import works as before, nothing to report.
    if (done.error.code !== 'PGRST202') completed = false;
  } else {
    completed = true;
    catalogFilled = ((done.data ?? {}) as { filled?: string[] }).filled ?? [];
  }
  return {
    matched: true, vehicleId, bulletins: saved.bulletins ?? 0, events: saved.events ?? 0,
    counts: plan.counts, invalid: plan.invalid,
    ownerMismatch: plan.statuses.some((s) => s.field === 'owner' && s.status === 'conflit'),
    completed, catalogFilled,
  };
}
