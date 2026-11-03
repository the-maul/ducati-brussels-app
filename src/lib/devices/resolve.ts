/**
 * Choix du pilote (PDV030) : a partir des appareils du poste courant, quel chemin prend chaque
 * besoin. Pur et teste ; l'envoi reel est dans drivers.ts.
 *
 * Regle « rien ne casse avant la migration » : aucun poste choisi, aucune ligne, table absente
 * → imprimante ticket = impression A4 actuelle du navigateur (`legacy_a4`), tiroir = rien,
 * etiquettes = impression du navigateur (gabarits existants).
 */
import { connectionProblem, type BrowserCaps, type DeviceRole, type Unavailable, type WorkstationDevice } from './types';

export type ReceiptDriverKind = 'legacy_a4' | 'none' | 'browser' | 'epson' | 'star' | 'serial' | 'usb' | 'unavailable';
export type ReceiptPlan = { kind: ReceiptDriverKind; device: WorkstationDevice | null; problem: Unavailable | null };

export type DrawerPlan =
  | { kind: 'none' }
  | { kind: 'escpos'; via: 'epson' | 'serial' | 'usb'; device: WorkstationDevice; pin: 2 | 5 }
  | { kind: 'star'; device: WorkstationDevice; pin: 2 | 5 }
  | { kind: 'serial_drawer'; device: WorkstationDevice }
  /** Imprimante en « impression du navigateur » : le tiroir s'ouvre par le reglage du pilote Windows. */
  | { kind: 'driver_setting'; device: WorkstationDevice }
  | { kind: 'unavailable'; problem: Unavailable | 'noPrinter' };

export type LabelDriverKind = 'browser' | 'zebra' | 'serial' | 'usb' | 'none' | 'unavailable';
export type LabelPlan = { kind: LabelDriverKind; device: WorkstationDevice | null; problem: Unavailable | null };

/** Appareil actif du role, ou null. */
export function deviceFor(devices: readonly WorkstationDevice[] | null | undefined, role: DeviceRole): WorkstationDevice | null {
  return (devices ?? []).find((d) => d.role === role && d.is_active) ?? null;
}

export function resolveReceipt(devices: readonly WorkstationDevice[] | null | undefined, caps: BrowserCaps): ReceiptPlan {
  const d = deviceFor(devices, 'receipt_printer');
  if (!d) return { kind: 'legacy_a4', device: null, problem: null };
  if (d.connection === 'none') return { kind: 'none', device: d, problem: null };
  const problem = connectionProblem(d.connection, d.config, caps);
  if (problem) return { kind: 'unavailable', device: d, problem };
  switch (d.connection) {
    case 'browser': return { kind: 'browser', device: d, problem: null };
    case 'epson_epos': return { kind: 'epson', device: d, problem: null };
    case 'star_webprnt': return { kind: 'star', device: d, problem: null };
    case 'web_serial': return { kind: 'serial', device: d, problem: null };
    case 'web_usb': return { kind: 'usb', device: d, problem: null };
    default: return { kind: 'unavailable', device: d, problem: 'planned' };
  }
}

/**
 * Tiroir : la ligne « tiroir-caisse » du poste decide ; sans ligne, la case « ouvrir le tiroir
 * branche sur cette imprimante » de l'imprimante ticket suffit.
 */
export function resolveDrawer(devices: readonly WorkstationDevice[] | null | undefined, caps: BrowserCaps): DrawerPlan {
  const drawer = deviceFor(devices, 'cash_drawer');
  const printer = deviceFor(devices, 'receipt_printer');
  const viaPrinter = drawer ? drawer.connection === 'via_receipt_printer' : !!printer?.config.drawerViaPrinter;
  if (drawer && drawer.connection === 'web_serial') {
    const problem = connectionProblem('web_serial', drawer.config, caps);
    return problem ? { kind: 'unavailable', problem } : { kind: 'serial_drawer', device: drawer };
  }
  if (!viaPrinter) return { kind: 'none' };
  const plan = resolveReceipt(devices, caps);
  const pin: 2 | 5 = (drawer?.config.drawerPin ?? printer?.config.drawerPin) === 5 ? 5 : 2;
  switch (plan.kind) {
    case 'epson': return { kind: 'escpos', via: 'epson', device: plan.device!, pin };
    case 'serial': return { kind: 'escpos', via: 'serial', device: plan.device!, pin };
    case 'usb': return { kind: 'escpos', via: 'usb', device: plan.device!, pin };
    case 'star': return { kind: 'star', device: plan.device!, pin };
    case 'browser': return { kind: 'driver_setting', device: plan.device! };
    case 'unavailable': return { kind: 'unavailable', problem: plan.problem ?? 'planned' };
    default: return { kind: 'unavailable', problem: 'noPrinter' };
  }
}

export function resolveLabel(devices: readonly WorkstationDevice[] | null | undefined, caps: BrowserCaps): LabelPlan {
  const d = deviceFor(devices, 'label_printer');
  if (!d) return { kind: 'browser', device: null, problem: null };
  if (d.connection === 'none') return { kind: 'none', device: d, problem: null };
  const problem = connectionProblem(d.connection, d.config, caps);
  if (problem) return { kind: 'unavailable', device: d, problem };
  switch (d.connection) {
    case 'browser': return { kind: 'browser', device: d, problem: null };
    case 'zebra_zpl_network': return { kind: 'zebra', device: d, problem: null };
    case 'web_serial': return { kind: 'serial', device: d, problem: null };
    case 'web_usb': return { kind: 'usb', device: d, problem: null };
    default: return { kind: 'unavailable', device: d, problem: 'planned' };
  }
}

/** Largeur du ticket : celle de l'imprimante du poste, sinon le reglage de la societe. */
export function receiptWidth(device: WorkstationDevice | null, companyDefault: 58 | 80): 58 | 80 {
  return device?.config.paperWidth ?? companyDefault;
}
