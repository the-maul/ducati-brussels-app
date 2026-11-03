/**
 * Protocoles HTTP des imprimantes reseau (PDV030), sans pilote ni logiciel installe :
 *  - Epson ePOS-Print : POST SOAP vers https://IP/cgi-bin/epos/service.cgi?devid=local_printer ;
 *    le ticket voyage en ESC/POS brut dans la balise <command> (hexadecimal), une seule source
 *    d'octets pour Epson, Web Serial et WebUSB ;
 *  - Star WebPRNT : POST vers https://IP/StarWebPRNT/SendMessage, requete <root> (texte,
 *    alignement, coupe, impulsion tiroir <peripheral>) ;
 *  - Zebra : POST du ZPL vers https://IP/pstprnt (l'imprimante ne renvoie pas d'en-tetes CORS :
 *    envoi « sans reponse lisible », on ne sait pas si l'etiquette est sortie).
 * Pur : construit les adresses, les corps et lit les reponses. L'envoi est dans drivers.ts.
 */
import type { DeviceConfig } from './types';
import type { ReceiptLine } from './receipt';
import { toHex } from './escpos';
import { plainText } from './receipt';

// Caracteres de controle interdits en XML 1.0 (sauf tabulation / saut de ligne / retour chariot).
const stripControl = (s: string) => Array.from(s).filter((c) => {
  const n = c.charCodeAt(0);
  return n >= 0x20 || n === 0x09 || n === 0x0a || n === 0x0d;
}).join('');

const xmlEscape = (s: string) => stripControl(String(s))
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Origine http(s)://hote[:port] d'un appareil reseau. */
export function deviceOrigin(cfg: DeviceConfig): string {
  const scheme = cfg.https ? 'https' : 'http';
  const host = (cfg.host ?? '').trim();
  return `${scheme}://${host}${cfg.port ? `:${cfg.port}` : ''}`;
}

// ------------------------------------------------------------------ Epson ePOS-Print

export const EPOS_TIMEOUT_MS = 10000;

export function eposUrl(cfg: DeviceConfig): string {
  const devid = encodeURIComponent(cfg.deviceId || 'local_printer');
  return `${deviceOrigin(cfg)}/cgi-bin/epos/service.cgi?devid=${devid}&timeout=${EPOS_TIMEOUT_MS}`;
}

/** Enveloppe SOAP ePOS-Print contenant les octets ESC/POS en hexadecimal. */
export function eposEnvelope(bytes: Uint8Array): string {
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>'
    + '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">'
    + `<command>${toHex(bytes)}</command>`
    + '</epos-print></s:Body></s:Envelope>';
}

export const EPOS_HEADERS: Record<string, string> = {
  'Content-Type': 'text/xml; charset=utf-8',
  'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT',
  SOAPAction: '""',
};

/** Reponse ePOS-Print : <response success="true" code="" status="..."/>. */
export function parseEposResponse(xml: string): { ok: boolean; code: string | null } {
  const success = /success\s*=\s*"(true|false)"/i.exec(xml)?.[1];
  const code = /\bcode\s*=\s*"([^"]*)"/i.exec(xml)?.[1] ?? null;
  return { ok: success?.toLowerCase() === 'true', code: code || null };
}

// ------------------------------------------------------------------ Star WebPRNT

export function starUrl(cfg: DeviceConfig): string {
  return `${deviceOrigin(cfg)}/StarWebPRNT/SendMessage`;
}

export type StarJobOptions = { cut?: boolean; drawer?: boolean; drawerPin?: 2 | 5 };

/** Requete WebPRNT (<root>...</root>) a partir des lignes mises en page. */
export function starRequest(lines: ReceiptLine[], opts: StarJobOptions = {}): string {
  const parts: string[] = ['<initialization/>'];
  // Tiroir : canal 1 = broche 2, canal 2 = broche 5 ; impulsion 200 ms.
  if (opts.drawer) parts.push(`<peripheral channel="${opts.drawerPin === 5 ? 2 : 1}" on="200"/>`);
  for (const l of lines) {
    if (l.kind === 'barcode') {
      parts.push('<alignment position="center"/>');
      parts.push(`<barcode symbology="Code128" width="width2" height="40" hri="true">${xmlEscape(plainText(l.value))}</barcode>`);
      continue;
    }
    parts.push(`<alignment position="${l.align}"/>`);
    const attrs = [
      l.bold ? 'emphasis="true"' : 'emphasis="false"',
      l.large ? 'width="2" height="2"' : 'width="1" height="1"',
    ].join(' ');
    parts.push(`<text ${attrs}>${xmlEscape(plainText(l.text))}&#10;</text>`);
  }
  if (opts.cut !== false) parts.push('<cutpaper feed="true" type="partial"/>');
  return `<root>${parts.join('')}</root>`;
}

/** Ouverture du tiroir seule. */
export function starDrawerOnly(pin: 2 | 5 = 2): string {
  return `<root><initialization/><peripheral channel="${pin === 5 ? 2 : 1}" on="200"/></root>`;
}

/** Enveloppe envoyee a /StarWebPRNT/SendMessage (la requete y figure echappee, comme StarWebPrintTrader). */
export function starEnvelope(request: string, timeoutMs = 10000): string {
  return '<StarWebPrint xmlns="http://www.star-m.jp" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">'
    + `<Request>${xmlEscape(request)}</Request>`
    + `<PrintSetting><Timeout>${Math.round(timeoutMs)}</Timeout></PrintSetting>`
    + '</StarWebPrint>';
}

/** Reponse WebPRNT : <success>true</success>, <code>...</code>. */
export function parseStarResponse(xml: string): { ok: boolean; code: string | null } {
  const success = /<success>\s*(true|false)\s*<\/success>/i.exec(xml)?.[1];
  const code = /<code>\s*([^<]*)\s*<\/code>/i.exec(xml)?.[1]?.trim() ?? null;
  return { ok: success?.toLowerCase() === 'true', code: code || null };
}

// ------------------------------------------------------------------ Zebra ZPL

export function zebraUrl(cfg: DeviceConfig): string {
  return `${deviceOrigin(cfg)}/pstprnt`;
}

/** Une etiquette article en ZPL (mise en page simple : designation, reference, prix, code-barres). */
export type ZplLabel = { reference: string; designation: string; price: string | null; barcode: string; qty: number };

/** Texte sur dans un champ ^FD (^ et ~ sont des caracteres de commande ZPL). */
const zplText = (s: string) => plainText(s).replace(/[\^~]/g, ' ').replace(/\n/g, ' ').trim();

export function zplLabels(labels: ZplLabel[], cfg: DeviceConfig): string {
  const dpmm = cfg.dpi === 300 ? 12 : 8;                 // points par mm (203 dpi = 8, 300 dpi = 12)
  const w = Math.round((cfg.labelWidthMm ?? 50) * dpmm);
  const h = Math.round((cfg.labelHeightMm ?? 30) * dpmm);
  const m = 2 * dpmm;                                    // marge 2 mm
  const small = Math.round(2.8 * dpmm);                  // police 2,8 mm
  const big = Math.round(4.5 * dpmm);
  const barH = Math.max(4 * dpmm, Math.round(h * 0.32));
  const out: string[] = [];
  for (const l of labels) {
    const qty = Number.isFinite(l.qty) ? Math.max(1, Math.min(500, Math.round(l.qty))) : 1;
    const code = zplText(l.barcode || l.reference);
    out.push([
      '^XA', '^CI28', `^PW${w}`, `^LL${h}`, '^LH0,0',
      `^FO${m},${m}^A0N,${small},${small}^FB${w - 2 * m},2,0,L^FD${zplText(l.designation)}^FS`,
      `^FO${m},${m + 2 * small + dpmm}^A0N,${small},${small}^FD${zplText(l.reference)}^FS`,
      l.price ? `^FO${m},${m + 2 * small + dpmm}^A0N,${big},${big}^FB${w - 2 * m},1,0,R^FD${zplText(l.price)}^FS` : '',
      code ? `^FO${m},${h - barH - m}^BY2^BCN,${barH - small},Y,N,N^FD${code}^FS` : '',
      `^PQ${qty}`, '^XZ',
    ].filter(Boolean).join('\n'));
  }
  return out.join('\n');
}
