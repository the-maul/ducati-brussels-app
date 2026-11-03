/**
 * Pilotes interchangeables (PDV030) : envoi reel vers l'appareil choisi par resolve.ts.
 *  - navigateur : fenetre d'impression (ticket 80 / 58 mm, ou A4 historique) ;
 *  - Epson ePOS-Print / Star WebPRNT : fetch HTTPS vers l'imprimante du reseau local (Chrome
 *    demande une fois « acces au reseau local » ; le certificat de l'imprimante doit etre accepte
 *    une fois en ouvrant https://IP dans le navigateur du poste) ;
 *  - Web Serial / WebUSB (Chrome / Edge sur PC) : octets ESC/POS ou ZPL bruts, appareil autorise
 *    une fois depuis Parametres → Postes et peripheriques (« Autoriser l'appareil ») ;
 *  - Zebra : POST du ZPL sur /pstprnt, sans reponse lisible (l'imprimante n'envoie pas de CORS).
 * Les erreurs remontent en codes (`devices.result.*`), jamais en exception non traitee.
 */
import type { DeviceConfig } from './types';
import {
  EPOS_HEADERS, eposEnvelope, eposUrl, parseEposResponse, parseStarResponse, starEnvelope, starUrl, zebraUrl,
} from './protocols';

export type DeviceResultCode =
  | 'printed' | 'sent' | 'opened' | 'noDevice' | 'noPrinter' | 'driverSetting' | 'popupBlocked'
  | 'network' | 'printerError' | 'noPermission' | 'cancelled' | 'unsupported' | 'timeout'
  | 'planned' | 'needsRelay' | 'noWebSerial' | 'noWebUsb' | 'noHost' | 'mixedContent';

export type DeviceResult = { ok: boolean; code: DeviceResultCode; detail?: string };

const ok = (code: DeviceResultCode = 'printed'): DeviceResult => ({ ok: true, code });
const fail = (code: DeviceResultCode, detail?: string): DeviceResult => ({ ok: false, code, detail });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ''));

// ------------------------------------------------------------------ Navigateur

/** Ouvre une fenetre d'impression avec la page donnee. */
export function printHtmlInWindow(html: string, size = 'width=420,height=800'): DeviceResult {
  if (typeof window === 'undefined') return fail('unsupported');
  const w = window.open('', '_blank', size);
  if (!w) return fail('popupBlocked');
  w.document.open(); w.document.write(html); w.document.close();
  return ok('printed');
}

// ------------------------------------------------------------------ Reseau (fetch avec delai)

async function postWithTimeout(url: string, init: RequestInit, ms = 12000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function networkFailure(e: unknown): DeviceResult {
  if (e instanceof DOMException && e.name === 'AbortError') return fail('timeout');
  return fail('network', errText(e));
}

export async function sendEpos(cfg: DeviceConfig, bytes: Uint8Array): Promise<DeviceResult> {
  try {
    const res = await postWithTimeout(eposUrl(cfg), { method: 'POST', headers: EPOS_HEADERS, body: eposEnvelope(bytes) });
    const text = await res.text();
    const r = parseEposResponse(text);
    return r.ok ? ok() : fail('printerError', r.code ?? `HTTP ${res.status}`);
  } catch (e) { return networkFailure(e); }
}

export async function sendStar(cfg: DeviceConfig, request: string): Promise<DeviceResult> {
  try {
    const res = await postWithTimeout(starUrl(cfg), {
      method: 'POST', headers: { 'Content-Type': 'text/xml; charset=UTF-8' }, body: starEnvelope(request),
    });
    const text = await res.text();
    const r = parseStarResponse(text);
    return r.ok ? ok() : fail('printerError', r.code ?? `HTTP ${res.status}`);
  } catch (e) { return networkFailure(e); }
}

/** Zebra : envoi « sans reponse » (mode no-cors) ; on sait que c'est parti, pas que c'est sorti. */
export async function sendZebra(cfg: DeviceConfig, zpl: string): Promise<DeviceResult> {
  try {
    await postWithTimeout(zebraUrl(cfg), { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: zpl });
    return ok('sent');
  } catch (e) { return networkFailure(e); }
}

// ------------------------------------------------------------------ Web Serial

type SerialPortInfo = { usbVendorId?: number; usbProductId?: number };
type SerialPortLike = {
  getInfo(): SerialPortInfo;
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
};
type SerialLike = { getPorts(): Promise<SerialPortLike[]>; requestPort(o?: object): Promise<SerialPortLike> };

const serialApi = (): SerialLike | null =>
  (typeof navigator !== 'undefined' && 'serial' in navigator ? (navigator as unknown as { serial: SerialLike }).serial : null);

function matches(info: SerialPortInfo | { vendorId?: number; productId?: number }, cfg: DeviceConfig): boolean {
  const vid = 'usbVendorId' in info ? info.usbVendorId : (info as { vendorId?: number }).vendorId;
  const pid = 'usbProductId' in info ? info.usbProductId : (info as { productId?: number }).productId;
  if (cfg.usbVendorId == null) return true;
  return vid === cfg.usbVendorId && (cfg.usbProductId == null || pid === cfg.usbProductId);
}

/** Demande a l'utilisateur de choisir un port serie (geste utilisateur obligatoire). */
export async function authorizeSerial(): Promise<{ result: DeviceResult; vendorId?: number; productId?: number }> {
  const api = serialApi();
  if (!api) return { result: fail('noWebSerial') };
  try {
    const port = await api.requestPort();
    const info = port.getInfo();
    return { result: ok('sent'), vendorId: info.usbVendorId, productId: info.usbProductId };
  } catch (e) {
    return { result: fail(e instanceof DOMException && e.name === 'NotFoundError' ? 'cancelled' : 'noPermission', errText(e)) };
  }
}

export async function sendSerial(cfg: DeviceConfig, bytes: Uint8Array): Promise<DeviceResult> {
  const api = serialApi();
  if (!api) return fail('noWebSerial');
  try {
    const ports = await api.getPorts();
    const port = ports.find((p) => matches(p.getInfo(), cfg)) ?? null;
    if (!port) return fail('noPermission');
    let opened = false;
    if (!port.writable) { await port.open({ baudRate: cfg.baudRate ?? 9600 }); opened = true; }
    const writer = port.writable!.getWriter();
    try { await writer.write(bytes); } finally { writer.releaseLock(); }
    if (opened) await port.close();
    return ok();
  } catch (e) { return fail('printerError', errText(e)); }
}

// ------------------------------------------------------------------ WebUSB

type UsbEndpoint = { endpointNumber: number; direction: 'in' | 'out'; type: string };
type UsbAlternate = { endpoints: UsbEndpoint[] };
type UsbInterface = { interfaceNumber: number; alternates: UsbAlternate[]; alternate?: UsbAlternate };
type UsbDeviceLike = {
  vendorId: number; productId: number; opened: boolean;
  configuration: { interfaces: UsbInterface[] } | null;
  open(): Promise<void>; close(): Promise<void>; selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>; releaseInterface(n: number): Promise<void>;
  transferOut(ep: number, data: Uint8Array): Promise<unknown>;
};
type UsbLike = { getDevices(): Promise<UsbDeviceLike[]>; requestDevice(o: { filters: object[] }): Promise<UsbDeviceLike> };

const usbApi = (): UsbLike | null =>
  (typeof navigator !== 'undefined' && 'usb' in navigator ? (navigator as unknown as { usb: UsbLike }).usb : null);

export async function authorizeUsb(): Promise<{ result: DeviceResult; vendorId?: number; productId?: number }> {
  const api = usbApi();
  if (!api) return { result: fail('noWebUsb') };
  try {
    // Sans filtre : les imprimantes « vendor specific » (classe 0xFF) n'apparaitraient pas avec la classe 7.
    const d = await api.requestDevice({ filters: [] });
    return { result: ok('sent'), vendorId: d.vendorId, productId: d.productId };
  } catch (e) {
    return { result: fail(e instanceof DOMException && e.name === 'NotFoundError' ? 'cancelled' : 'noPermission', errText(e)) };
  }
}

export async function sendUsb(cfg: DeviceConfig, bytes: Uint8Array): Promise<DeviceResult> {
  const api = usbApi();
  if (!api) return fail('noWebUsb');
  try {
    const devices = await api.getDevices();
    const d = devices.find((x) => matches({ vendorId: x.vendorId, productId: x.productId }, cfg)) ?? null;
    if (!d) return fail('noPermission');
    if (!d.opened) await d.open();
    if (!d.configuration) await d.selectConfiguration(1);
    const ifaces = d.configuration?.interfaces ?? [];
    let target: { iface: number; ep: number } | null = null;
    for (const i of ifaces) {
      for (const alt of [i.alternate, ...i.alternates].filter(Boolean) as UsbAlternate[]) {
        const ep = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
        if (ep) { target = { iface: i.interfaceNumber, ep: ep.endpointNumber }; break; }
      }
      if (target) break;
    }
    if (!target) return fail('unsupported');
    await d.claimInterface(target.iface);
    try { await d.transferOut(target.ep, bytes); } finally { await d.releaseInterface(target.iface).catch(() => undefined); }
    await d.close().catch(() => undefined);
    return ok();
  } catch (e) { return fail('printerError', errText(e)); }
}
