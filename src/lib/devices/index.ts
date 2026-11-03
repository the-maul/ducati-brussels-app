/**
 * Couche materiel (PDV030) — interface UNIQUE par role, quel que soit l'appareil du client :
 *   printReceipt(ctx, doc)   imprimante ticket (navigateur 80 / 58 mm, Epson ePOS, Star WebPRNT,
 *                            Web Serial, WebUSB ; A4 historique tant qu'aucun poste n'est regle)
 *   openDrawer(ctx)          tiroir-caisse (impulsion par l'imprimante, ou tiroir USB serie)
 *   printRawLabels(ctx, ...) imprimante d'etiquettes en ZPL (Zebra reseau, Web Serial, WebUSB) ;
 *                            l'impression navigateur des gabarits reste dans modules/articles/labels.
 * Le « contexte » = les appareils du poste du navigateur + le reglage de la societe.
 */
import { browserCaps, DEFAULT_COMPANY_DEVICE_SETTINGS, type BrowserCaps, type CompanyDeviceSettings, type Workstation, type WorkstationDevice } from './types';
import { layoutReceipt, receiptColumns, type ReceiptDoc } from './receipt';
import { receiptHtml } from './receipt-html';
import { escposDrawerOnly, escposReceipt } from './escpos';
import { starDrawerOnly, starRequest, zplLabels, type ZplLabel } from './protocols';
import { resolveDrawer, resolveLabel, resolveReceipt, receiptWidth, type ReceiptDriverKind } from './resolve';
import { printHtmlInWindow, sendEpos, sendSerial, sendStar, sendUsb, sendZebra, type DeviceResult } from './drivers';

export type DeviceContext = {
  workstation: Workstation | null;
  devices: WorkstationDevice[];
  settings: CompanyDeviceSettings;
  /** Pour les tests : capacites du navigateur imposees. */
  caps?: BrowserCaps;
};

export const EMPTY_DEVICE_CONTEXT: DeviceContext = { workstation: null, devices: [], settings: { ...DEFAULT_COMPANY_DEVICE_SETTINGS } };

export type ReceiptResult = DeviceResult & { driver: ReceiptDriverKind };

/** Imprime un ticket par le pilote du poste. `legacyA4` : impression historique quand rien n'est regle. */
export async function printReceipt(
  ctx: DeviceContext, doc: ReceiptDoc, opts: { legacyA4?: () => Promise<void> | void } = {},
): Promise<ReceiptResult> {
  const caps = ctx.caps ?? browserCaps();
  const plan = resolveReceipt(ctx.devices, caps);
  const width = doc.widthMm ?? receiptWidth(plan.device, ctx.settings.receipt_width_mm);
  const done = (r: DeviceResult): ReceiptResult => ({ ...r, driver: plan.kind });
  switch (plan.kind) {
    case 'legacy_a4':
      if (opts.legacyA4) { await opts.legacyA4(); return done({ ok: true, code: 'printed' }); }
      return done(printHtmlInWindow(receiptHtml(doc, width)));
    case 'none': return done({ ok: false, code: 'noPrinter' });
    case 'unavailable': return done({ ok: false, code: plan.problem ?? 'planned' });
    case 'browser': return done(printHtmlInWindow(receiptHtml(doc, width)));
    default: break;
  }
  const lines = layoutReceipt(doc.blocks, receiptColumns(width, 'printer'));
  const cfg = plan.device!.config;
  if (plan.kind === 'star') return done(await sendStar(cfg, starRequest(lines)));
  const bytes = escposReceipt(lines);
  if (plan.kind === 'epson') return done(await sendEpos(cfg, bytes));
  if (plan.kind === 'serial') return done(await sendSerial(cfg, bytes));
  return done(await sendUsb(cfg, bytes));
}

/** Ouvre le tiroir-caisse du poste. */
export async function openDrawer(ctx: DeviceContext): Promise<DeviceResult> {
  const plan = resolveDrawer(ctx.devices, ctx.caps ?? browserCaps());
  switch (plan.kind) {
    case 'none': return { ok: false, code: 'noDevice' };
    case 'driver_setting': return { ok: false, code: 'driverSetting' };
    case 'unavailable': return { ok: false, code: plan.problem };
    case 'star': {
      const r = await sendStar(plan.device.config, starDrawerOnly(plan.pin));
      return r.ok ? { ok: true, code: 'opened' } : r;
    }
    case 'serial_drawer': {
      const r = await sendSerial(plan.device.config, escposDrawerOnly(plan.device.config.drawerPin ?? 2));
      return r.ok ? { ok: true, code: 'opened' } : r;
    }
    case 'escpos': {
      const bytes = escposDrawerOnly(plan.pin);
      const cfg = plan.device.config;
      const r = plan.via === 'epson' ? await sendEpos(cfg, bytes) : plan.via === 'serial' ? await sendSerial(cfg, bytes) : await sendUsb(cfg, bytes);
      return r.ok ? { ok: true, code: 'opened' } : r;
    }
  }
}

/**
 * Etiquettes en ZPL par le pilote du poste. Retourne null quand le poste imprime ses etiquettes par
 * le navigateur (ou n'a rien de regle) : l'appelant garde alors l'impression de ses gabarits.
 */
export async function printRawLabels(ctx: DeviceContext, labels: ZplLabel[], fallbackSizeMm?: { width: number; height: number }): Promise<DeviceResult | null> {
  const plan = resolveLabel(ctx.devices, ctx.caps ?? browserCaps());
  if (plan.kind === 'browser') return null;
  if (plan.kind === 'none') return { ok: false, code: 'noPrinter' };
  if (plan.kind === 'unavailable') return { ok: false, code: plan.problem ?? 'planned' };
  const cfg = {
    ...plan.device!.config,
    labelWidthMm: plan.device!.config.labelWidthMm ?? fallbackSizeMm?.width,
    labelHeightMm: plan.device!.config.labelHeightMm ?? fallbackSizeMm?.height,
  };
  const zpl = zplLabels(labels, cfg);
  if (plan.kind === 'zebra') return sendZebra(cfg, zpl);
  const bytes = new TextEncoder().encode(zpl);
  return plan.kind === 'serial' ? sendSerial(cfg, bytes) : sendUsb(cfg, bytes);
}

export type { DeviceResult } from './drivers';
export type { ReceiptDoc, ReceiptBlock } from './receipt';
export type { ZplLabel } from './protocols';
