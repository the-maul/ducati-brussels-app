/**
 * Postes et peripheriques (PDV030, decision de Simon du 03/11/2026) : « aucun materiel impose ».
 * Chaque besoin du comptoir est un ROLE (imprimante ticket, tiroir, etiquettes, douchette, ecran
 * client, terminal, balance) auquel chaque POSTE (caisse 1, comptoir atelier, tablette...) rattache
 * l'appareil du client, avec son TYPE DE CONNEXION. Ce fichier est pur (aucun acces reseau / base) :
 * listes fermees, defauts, lecture d'une configuration enregistree, disponibilite dans le navigateur.
 */

export const DEVICE_ROLES = [
  'receipt_printer', 'cash_drawer', 'label_printer', 'scanner', 'customer_display', 'payment_terminal', 'scale',
] as const;
export type DeviceRole = (typeof DEVICE_ROLES)[number];

export const CONNECTIONS = [
  'none',
  'browser',              // impression du navigateur (pilote de l'imprimante installe sur le PC / la tablette)
  'escpos_network',       // ESC/POS brut sur IP:9100 : impossible depuis un navigateur sans relais
  'epson_epos',           // Epson ePOS-Print (HTTP(S) vers l'imprimante, sans pilote)
  'star_webprnt',         // Star WebPRNT (HTTP(S) vers l'imprimante, sans pilote)
  'web_serial',           // Web Serial (Chrome / Edge sur PC) : port COM / USB serie
  'web_usb',              // WebUSB (Chrome / Edge sur PC) : USB brut (pilote WinUSB)
  'zebra_zpl_network',    // Zebra ZPL en reseau (POST /pstprnt)
  'relay_printnode',      // relais cloud PrintNode : prevu, desactive
  'relay_qz',             // relais local QZ Tray : prevu, desactive
  'via_receipt_printer',  // tiroir branche sur l'imprimante ticket (impulsion ESC/POS)
  'hid_keyboard',         // douchette = clavier (USB / Bluetooth HID)
  'camera',               // camera de la tablette : prevu
  'second_window',        // ecran client = fenetre /ecran-client sur le 2e ecran
  'paired_tablet',        // ecran client = tablette appairee (lot ecran client)
  'standalone',           // terminal de paiement « a cote » (montant tape sur le terminal)
  'ccv_cloud',            // terminal CCV (Omespay) pilote par le DMS : prevu
] as const;
export type Connection = (typeof CONNECTIONS)[number];

/** Connexions proposees par role, dans l'ordre d'affichage (la premiere apres « none » est le choix conseille). */
export const ROLE_CONNECTIONS: Record<DeviceRole, readonly Connection[]> = {
  receipt_printer: ['none', 'browser', 'epson_epos', 'star_webprnt', 'web_serial', 'web_usb', 'escpos_network', 'relay_printnode', 'relay_qz'],
  cash_drawer: ['none', 'via_receipt_printer', 'web_serial'],
  label_printer: ['none', 'browser', 'zebra_zpl_network', 'web_serial', 'web_usb', 'relay_printnode', 'relay_qz'],
  scanner: ['none', 'hid_keyboard', 'camera'],
  customer_display: ['none', 'second_window', 'paired_tablet'],
  payment_terminal: ['none', 'standalone', 'ccv_cloud'],
  scale: ['none', 'web_serial'],
};

/** Connexions prevues mais pas encore branchees : visibles, grisees, jamais choisies par defaut. */
export const PLANNED_CONNECTIONS: readonly Connection[] = ['relay_printnode', 'relay_qz', 'camera', 'ccv_cloud'];

/** Connexions qui parlent a un appareil par le reseau local (adresse IP / nom). */
export const NETWORK_CONNECTIONS: readonly Connection[] = ['escpos_network', 'epson_epos', 'star_webprnt', 'zebra_zpl_network'];

export type PaperWidth = 58 | 80;
export const PAPER_WIDTHS: readonly PaperWidth[] = [80, 58];

/** Configuration d'un appareil (colonne jsonb `workstation_devices.config`). Tout est facultatif. */
export type DeviceConfig = {
  host?: string;            // IP ou nom de l'imprimante (192.168.1.50)
  port?: number | null;     // port (9100 pour l'ESC/POS brut ; vide = port par defaut du protocole)
  https?: boolean;          // l'imprimante repond en HTTPS (obligatoire si le DMS est en HTTPS)
  deviceId?: string;        // Epson : identifiant du peripherique (local_printer)
  paperWidth?: PaperWidth;  // largeur du ticket
  drawerViaPrinter?: boolean; // ouvrir le tiroir branche sur cette imprimante
  drawerPin?: 2 | 5;        // broche du tiroir (2 par defaut, 5 pour un 2e tiroir)
  baudRate?: number;        // Web Serial
  usbVendorId?: number;     // Web Serial / WebUSB : appareil autorise sur ce navigateur
  usbProductId?: number;
  labelWidthMm?: number;    // etiquettes ZPL
  labelHeightMm?: number;
  dpi?: 203 | 300;
};

export type WorkstationKind = 'caisse' | 'comptoir_atelier' | 'tablette' | 'bureau' | 'autre';
export const WORKSTATION_KINDS: readonly WorkstationKind[] = ['caisse', 'comptoir_atelier', 'tablette', 'bureau', 'autre'];

export type Workstation = {
  id: string; company_id: string; name: string; kind: WorkstationKind; register_code: string | null;
  is_active: boolean; sort_order: number; notes: string | null;
};

export type WorkstationDevice = {
  id: string; company_id: string; workstation_id: string; role: DeviceRole; connection: Connection;
  label: string | null; config: DeviceConfig; is_active: boolean;
  last_test_at: string | null; last_test_ok: boolean | null; last_test_message: string | null;
};

/** Reglage par societe (`company_device_settings`), defauts appliques quand la ligne n'existe pas. */
export type CompanyDeviceSettings = {
  receipt_width_mm: PaperWidth;
  auto_print_receipt: boolean;
  open_drawer_on_cash: boolean;
  receipt_footer: string | null;
};
export const DEFAULT_COMPANY_DEVICE_SETTINGS: CompanyDeviceSettings = {
  receipt_width_mm: 80, auto_print_receipt: false, open_drawer_on_cash: true, receipt_footer: null,
};

export const isRole = (v: unknown): v is DeviceRole => typeof v === 'string' && (DEVICE_ROLES as readonly string[]).includes(v);
export const isConnection = (v: unknown): v is Connection => typeof v === 'string' && (CONNECTIONS as readonly string[]).includes(v);
export const isPlanned = (c: Connection) => PLANNED_CONNECTIONS.includes(c);
export const roleAccepts = (role: DeviceRole, c: Connection) => ROLE_CONNECTIONS[role].includes(c);

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Lit une configuration enregistree (jsonb libre) en ne gardant que des valeurs valides. */
export function parseDeviceConfig(raw: unknown): DeviceConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: DeviceConfig = {};
  if (typeof r.host === 'string' && r.host.trim()) out.host = r.host.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const port = num(r.port);
  if (port != null && port > 0 && port < 65536) out.port = Math.round(port);
  if (typeof r.https === 'boolean') out.https = r.https;
  if (typeof r.deviceId === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(r.deviceId)) out.deviceId = r.deviceId;
  const w = num(r.paperWidth);
  if (w === 58 || w === 80) out.paperWidth = w;
  if (typeof r.drawerViaPrinter === 'boolean') out.drawerViaPrinter = r.drawerViaPrinter;
  const pin = num(r.drawerPin);
  if (pin === 2 || pin === 5) out.drawerPin = pin;
  const baud = num(r.baudRate);
  if (baud != null && [9600, 19200, 38400, 57600, 115200].includes(baud)) out.baudRate = baud;
  const vid = num(r.usbVendorId); if (vid != null && vid >= 0 && vid <= 0xffff) out.usbVendorId = vid;
  const pid = num(r.usbProductId); if (pid != null && pid >= 0 && pid <= 0xffff) out.usbProductId = pid;
  const lw = num(r.labelWidthMm); if (lw != null && lw >= 10 && lw <= 120) out.labelWidthMm = lw;
  const lh = num(r.labelHeightMm); if (lh != null && lh >= 5 && lh <= 300) out.labelHeightMm = lh;
  const dpi = num(r.dpi); if (dpi === 203 || dpi === 300) out.dpi = dpi;
  return out;
}

/** Ce que le navigateur sait faire (lu une fois a l'execution, passe aux fonctions pures pour les tests). */
export type BrowserCaps = { secureContext: boolean; pageHttps: boolean; webSerial: boolean; webUsb: boolean };

export function browserCaps(): BrowserCaps {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { secureContext: false, pageHttps: false, webSerial: false, webUsb: false };
  }
  return {
    secureContext: !!window.isSecureContext,
    pageHttps: window.location.protocol === 'https:',
    webSerial: 'serial' in navigator,
    webUsb: 'usb' in navigator,
  };
}

/** Pourquoi une connexion ne peut pas servir ici (code de dictionnaire `devices.why.*`), ou null. */
export type Unavailable = 'planned' | 'needsRelay' | 'noWebSerial' | 'noWebUsb' | 'noHost' | 'mixedContent';

export function connectionProblem(c: Connection, cfg: DeviceConfig, caps: BrowserCaps): Unavailable | null {
  if (isPlanned(c)) return 'planned';
  if (c === 'escpos_network') return 'needsRelay';
  if (c === 'web_serial' && !(caps.webSerial && caps.secureContext)) return 'noWebSerial';
  if (c === 'web_usb' && !(caps.webUsb && caps.secureContext)) return 'noWebUsb';
  if (NETWORK_CONNECTIONS.includes(c)) {
    if (!cfg.host) return 'noHost';
    // Page en HTTPS : le navigateur bloque un appel HTTP vers l'imprimante (contenu mixte).
    if (caps.pageHttps && !cfg.https) return 'mixedContent';
  }
  return null;
}
