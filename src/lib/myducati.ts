/**
 * Réception des données My Ducati envoyées par l'extension navigateur (par VIN).
 * Enregistre, sous la session de l'utilisateur (RLS) : moto + garantie + bulletins + maintenance,
 * et le compte client Ducati sur le propriétaire courant de la moto.
 */
import { supabase } from '@/integrations/supabase/client';

export type MyDucatiPayload = {
  vin: string;
  contact: Record<string, unknown>;
  vehicle: Record<string, unknown>;
  bulletins?: { bulletin_id?: string; title?: string; number?: string; published_at?: string; url?: string; pdf_base64?: string; pdf_name?: string }[];
  maintenance_raw?: unknown;
  scraped_at?: string;
  source_url?: string;
};

/** « 6/07/2022 » → « 2022-07-06 » (ISO) ; sinon null. */
const isoDate = (s: unknown): string | null => {
  const m = String(s ?? '').trim().match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
const clean = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '')) as Partial<T>;

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
export function requestMyDucati(vin: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!vin) { resolve(false); return; }
    let done = false;
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { source?: string; action?: string } | null;
      if (d && d.source === 'dms-ducati-ext' && d.action === 'fetch-ack') {
        done = true; window.removeEventListener('message', onMsg); resolve(true);
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ source: 'dms-ducati', action: 'fetch-myducati', vin }, window.location.origin);
    setTimeout(() => { if (!done) { window.removeEventListener('message', onMsg); resolve(false); } }, 2000);
  });
}

export type ApplyResult = { matched: boolean; vehicleId?: string; bulletins?: number };

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

export async function applyMyDucatiData(companyId: string, p: MyDucatiPayload): Promise<ApplyResult> {
  if (!p?.vin) return { matched: false };
  const { data: veh } = await supabase.from('vehicles').select('id').eq('company_id', companyId).eq('vin', p.vin).maybeSingle();
  if (!veh) return { matched: false };
  const vehicleId = veh.id as string;

  const v = p.vehicle || {};
  // 1) Données PROPRES À DUCATI (source de vérité) → toujours mises à jour.
  const ducatiPatch = clean({
    ducati_state: v.ducati_state, ducati_usage: v.ducati_usage,
    production_date: isoDate(v.production_date), ship_date: isoDate(v.ship_date), invoiced_to: v.invoiced_to,
    warranty_start: isoDate(v.warranty_start), warranty_end: isoDate(v.warranty_end), warranty_type: v.warranty_type,
    warranty_state: v.warranty_state, warranty_activated_by: v.warranty_activated_by,
    my_ducati_data: p as unknown as Record<string, unknown>, my_ducati_synced_at: new Date().toISOString(),
  });
  // 2) Champs PARTAGÉS avec d'autres sources (factures, parc) → remplis SEULEMENT si vides
  //    côté DMS (on ne réécrit jamais une donnée déjà saisie).
  const shared = clean({
    engine_number: v.engine_number,
    mileage: v.last_km ? Number(v.last_km) : undefined,
    model: v.model, color: v.color, plate: v.plate,
    first_registration_date: isoDate(v.first_registration_date),
  }) as Record<string, unknown>;
  const emptyOnly: Record<string, unknown> = {};
  if (Object.keys(shared).length) {
    const { data: cur } = await supabase.from('vehicles')
      .select('engine_number, mileage, model, color, plate, first_registration_date')
      .eq('id', vehicleId).maybeSingle();
    const row = (cur ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(shared)) {
      const e = row[k];
      if (e === null || e === undefined || e === '') emptyOnly[k] = shared[k];
    }
  }
  await supabase.from('vehicles').update({ ...ducatiPatch, ...emptyOnly }).eq('id', vehicleId);

  // Bulletins : remplace l'ensemble pour cette moto, MAIS préserve les PDF déjà rapatriés
  // (le PDF est téléchargé séparément par l'extension via saveBulletinPdf ; on ne le perd jamais
  // au re-scrape). On reporte storage_path/url des lignes existantes (par bulletin_id/numéro).
  const bulletins = (p.bulletins || []).filter((b) => b.bulletin_id || b.number || b.title);
  if (bulletins.length) {
    const { data: prev } = await supabase.from('vehicle_bulletins')
      .select('number, bulletin_id, storage_path, url').eq('vehicle_id', vehicleId);
    const keep = new Map<string, { storage_path: string | null; url: string | null }>();
    for (const r of (prev ?? []) as Array<{ number: string | null; bulletin_id: string | null; storage_path: string | null; url: string | null }>) {
      const k = r.bulletin_id || r.number;
      if (k) keep.set(String(k), { storage_path: r.storage_path ?? null, url: r.url ?? null });
    }
    await supabase.from('vehicle_bulletins').delete().eq('vehicle_id', vehicleId);
    await supabase.from('vehicle_bulletins').insert(bulletins.map((b) => {
      const old = keep.get(String(b.bulletin_id || b.number || ''));
      return {
        company_id: companyId, vehicle_id: vehicleId,
        bulletin_id: b.bulletin_id || null, title: b.title || null, number: b.number || null,
        published_at: isoDate(b.published_at), url: b.url || old?.url || null,
        storage_path: old?.storage_path ?? null,        // <- PDF préservé
      };
    }));
  }

  // Maintenance (événements) : lignes objet { libellé colonne → valeur } → table dédiée.
  const maint = Array.isArray(p.maintenance_raw) ? (p.maintenance_raw as Record<string, string>[]) : [];
  if (maint.length) {
    const pick = (r: Record<string, string>, needles: string[]) => {
      for (const k of Object.keys(r)) { const kl = k.toLowerCase(); if (needles.some((n) => kl.includes(n)) && r[k] && r[k] !== '-') return r[k]; }
      return null;
    };
    const rows = maint.map((r) => {
      const kmRaw = pick(r, ['km/mi', 'km', 'mi/h']) || '';
      return {
        company_id: companyId, vehicle_id: vehicleId,
        service_type: pick(r, ['type']), state: pick(r, ['état', 'etat']),
        km: kmRaw ? (Number(String(kmRaw).replace(/[^\d]/g, '')) || null) : null,
        event_date: isoDate(pick(r, ['date de', 'date'])), due_date: isoDate(pick(r, ['éché', 'eche'])),
        dealer: pick(r, ['concess']), ducati_event_id: pick(r, ['id']),
      };
    }).filter((r) => r.service_type || r.km || r.dealer || r.ducati_event_id);
    await supabase.from('vehicle_maintenance').delete().eq('vehicle_id', vehicleId);
    if (rows.length) await supabase.from('vehicle_maintenance').insert(rows);
  }

  // Compte client Ducati → propriétaire courant de la moto.
  const c = p.contact || {};
  const contactPatch = clean({
    ducati_code: c.ducati_code, my_ducati_email: c.my_ducati_email, my_ducati_phone: c.my_ducati_phone,
    my_ducati_city: c.my_ducati_city, my_ducati_country: c.my_ducati_country,
    my_ducati_marketing: c.my_ducati_marketing as boolean | undefined, my_ducati_profiling: c.my_ducati_profiling as boolean | undefined,
    my_ducati_is_current_owner: c.my_ducati_is_current_owner as boolean | undefined,
    my_ducati_synced_at: new Date().toISOString(),
  });
  if (Object.keys(contactPatch).length) {
    const { data: owner } = await supabase.from('vehicle_owners').select('contact_id')
      .eq('vehicle_id', vehicleId).eq('is_current', true).order('from_date', { ascending: false }).limit(1).maybeSingle();
    if (owner?.contact_id) await supabase.from('contacts').update(contactPatch).eq('id', owner.contact_id);
  }

  return { matched: true, vehicleId, bulletins: bulletins.length };
}
