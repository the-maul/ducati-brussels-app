/**
 * M6 -- Ecran client sur tablette (PDV020) : appels serveur.
 * Fonctions de la migration 20261103240000_m6_ecran_client.sql (A APPLIQUER) :
 *  - tablette, sans compte (anon, par jeton) : customer_display_pair_begin / customer_display_read /
 *    customer_display_reply ;
 *  - vendeur (session) : customer_display_pair / _claim / _rename / _revoke / _list,
 *    counter_display_set / counter_display_state / counter_display_reply_clear.
 * Tant que la migration n est pas appliquee, ces fonctions n existent pas : `isMissingFunction`
 * le reconnait et l ecran QR de virement existant reste servi tel quel.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  SCREEN_TOKEN_STORAGE_KEY, parseDeviceRead, parseSnapshot,
  type DeviceRead, type ScreenMode, type ScreenPayload, type ScreenSnapshot,
} from './customer-screen';

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;

async function call<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** La fonction n existe pas (migration non appliquee) : PostgREST PGRST202 ou Postgres 42883. */
export function isMissingFunction(err: unknown): boolean {
  const e = (err ?? {}) as { code?: string; message?: string };
  return e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? '');
}

/* ---------------------------------------------------------------- jeton garde sur la tablette */

export function readDeviceToken(): string | null {
  try { return window.localStorage.getItem(SCREEN_TOKEN_STORAGE_KEY); } catch { return null; }
}
export function storeDeviceToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(SCREEN_TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(SCREEN_TOKEN_STORAGE_KEY);
  } catch { /* stockage bloque : la tablette redemandera un code au prochain chargement */ }
}

/* ---------------------------------------------------------------- tablette (anon) */

export type PairingStart = { deviceId: string; token: string; code: string; expiresAt: string };

export async function beginPairing(): Promise<PairingStart> {
  const r = await call<Record<string, string>>('customer_display_pair_begin', {
    _user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  });
  return { deviceId: r.device_id, token: r.token, code: r.code, expiresAt: r.expires_at };
}

export async function readDevice(token: string): Promise<DeviceRead> {
  return parseDeviceRead(await call('customer_display_read', { _token: token }));
}

export async function replyEmail(token: string, email: string): Promise<void> {
  await call('customer_display_reply', { _token: token, _kind: 'email', _data: { email } });
}

export async function replySignature(token: string, png: string, signerName: string): Promise<void> {
  await call('customer_display_reply', { _token: token, _kind: 'signature', _data: { png, signer_name: signerName } });
}

/** Signal sans donnee (Realtime broadcast) sur le canal secret de l appareil ; renvoie le desabonnement. */
export function subscribeDeviceChannel(channel: string, onChange: () => void): () => void {
  const ch = supabase.channel(channel).on('broadcast', { event: 'changed' }, onChange).subscribe();
  return () => { void supabase.removeChannel(ch); };
}

/* ---------------------------------------------------------------- vendeur (session) */

export async function pairDevice(code: string, companyId: string, name: string, register: string): Promise<string> {
  return call<string>('customer_display_pair', { _code: code, _company: companyId, _name: name, _register: register });
}
export async function claimDevice(deviceId: string): Promise<void> {
  await call('customer_display_claim', { _device: deviceId });
}
export async function renameDevice(deviceId: string, name: string, register: string): Promise<void> {
  await call('customer_display_rename', { _device: deviceId, _name: name, _register: register });
}
export async function revokeDevice(deviceId: string): Promise<void> {
  await call('customer_display_revoke', { _device: deviceId });
}

export type DeviceRow = {
  id: string; name: string; register_code: string; user_id: string | null; user_name: string | null;
  paired_at: string | null; last_seen_at: string | null; revoked_at: string | null; server_now: string;
};
export async function listDevices(companyId: string): Promise<DeviceRow[]> {
  return (await call<DeviceRow[]>('customer_display_list', { _company: companyId })) ?? [];
}

/** Pousse l ecran du vendeur connecte (mode + ticket) ; renvoie la version. */
export async function setScreen(companyId: string, mode: ScreenMode, payload: ScreenPayload): Promise<number> {
  return Number(await call('counter_display_set', { _company: companyId, _mode: mode, _payload: payload }));
}

export type ScreenReply =
  | { kind: 'email'; email: string; at: string }
  | { kind: 'signature'; png: string; hash: string; signer_name: string; document_id: string | null; at: string };

export type VendorScreenState = {
  now: string;
  screen: ScreenSnapshot | null;
  reply: ScreenReply | null;
  devices: { id: string; name: string; register_code: string; last_seen_at: string | null }[];
};

export async function getVendorScreen(companyId: string): Promise<VendorScreenState> {
  const r = (await call<Record<string, unknown>>('counter_display_state', { _company: companyId })) ?? {};
  const reply = r.reply && typeof r.reply === 'object' ? (r.reply as ScreenReply) : null;
  return {
    now: String(r.now ?? new Date().toISOString()),
    screen: parseSnapshot(r.screen),
    reply,
    devices: Array.isArray(r.devices) ? (r.devices as VendorScreenState['devices']) : [],
  };
}

export async function clearScreenReply(companyId: string): Promise<void> {
  await call('counter_display_reply_clear', { _company: companyId });
}
