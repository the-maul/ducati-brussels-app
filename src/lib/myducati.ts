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
  bulletins?: { bulletin_id?: string; title?: string; number?: string; published_at?: string }[];
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

export async function applyMyDucatiData(companyId: string, p: MyDucatiPayload): Promise<ApplyResult> {
  if (!p?.vin) return { matched: false };
  const { data: veh } = await supabase.from('vehicles').select('id').eq('company_id', companyId).eq('vin', p.vin).maybeSingle();
  if (!veh) return { matched: false };
  const vehicleId = veh.id as string;

  const v = p.vehicle || {};
  const vehPatch = clean({
    engine_number: v.engine_number, ducati_state: v.ducati_state, ducati_usage: v.ducati_usage,
    production_date: isoDate(v.production_date), ship_date: isoDate(v.ship_date), invoiced_to: v.invoiced_to,
    warranty_start: isoDate(v.warranty_start), warranty_end: isoDate(v.warranty_end), warranty_type: v.warranty_type,
    warranty_state: v.warranty_state, warranty_activated_by: v.warranty_activated_by,
    mileage: v.last_km ? Number(v.last_km) : undefined,
    my_ducati_data: p as unknown as Record<string, unknown>, my_ducati_synced_at: new Date().toISOString(),
  });
  await supabase.from('vehicles').update(vehPatch).eq('id', vehicleId);

  // Bulletins : remplace l'ensemble pour cette moto (données de synchro).
  const bulletins = (p.bulletins || []).filter((b) => b.bulletin_id || b.number || b.title);
  if (bulletins.length) {
    await supabase.from('vehicle_bulletins').delete().eq('vehicle_id', vehicleId);
    await supabase.from('vehicle_bulletins').insert(bulletins.map((b) => ({
      company_id: companyId, vehicle_id: vehicleId,
      bulletin_id: b.bulletin_id || null, title: b.title || null, number: b.number || null, published_at: isoDate(b.published_at),
    })));
  }

  // Compte client Ducati → propriétaire courant de la moto.
  const c = p.contact || {};
  const contactPatch = clean({
    ducati_code: c.ducati_code, my_ducati_email: c.my_ducati_email, my_ducati_phone: c.my_ducati_phone,
    my_ducati_city: c.my_ducati_city, my_ducati_country: c.my_ducati_country,
    my_ducati_marketing: c.my_ducati_marketing as boolean | undefined, my_ducati_profiling: c.my_ducati_profiling as boolean | undefined,
    my_ducati_is_current_owner: c.my_ducati_is_current_owner as boolean | undefined,
  });
  if (Object.keys(contactPatch).length) {
    const { data: owner } = await supabase.from('vehicle_owners').select('contact_id')
      .eq('vehicle_id', vehicleId).eq('is_current', true).order('from_date', { ascending: false }).limit(1).maybeSingle();
    if (owner?.contact_id) await supabase.from('contacts').update(contactPatch).eq('id', owner.contact_id);
  }

  return { matched: true, vehicleId, bulletins: bulletins.length };
}
