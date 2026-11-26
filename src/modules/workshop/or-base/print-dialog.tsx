/**
 * M8 — Fenetre « Imprimer l'OR » (rattrapage G8 « Edition Ordre de reparation », 18/11/2026).
 * Type : OR uniquement / fiche de travail uniquement / OR + fiche ; options « edition chiffree »
 * et « OR sans le nom du client ». Le PDF est construit dans le navigateur (`or-pdf.ts`) a partir de
 * la version ENREGISTREE de l'OR, dans la langue de la fiche du client (papier remis au client).
 * Decision Q46 (18/11) : en plus du PDF A4, un FORMAT TICKET 80 mm (or-ticket.ts) imprime par le
 * pilote de l'imprimante ticket du poste, comme les tickets de caisse (src/lib/devices).
 * Decision Q45 : l'acompte verse est imprime sur l'OR et sur le ticket.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, ExternalLink, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { t, tIn, type Locale, ensureLocale } from '@/lib/i18n';
import { contactLocale } from '@/lib/i18n/client-locale';
import { contactDisplayName, type Contact } from '@/modules/contacts/api';
import { getRepairOrderFull } from '../api';
import { buildOrPdf, type OrPdfData, type OrPdfLabels, type OrPdfPhoto } from './or-pdf';
import { buildOrTicket } from './or-ticket';
import { listOrDeposits } from './deposit-api';
import { useAuth } from '@/lib/auth/auth-context';
import { useDeviceSetup } from '@/lib/devices/use-devices';
import { printReceipt, type ReceiptDoc } from '@/lib/devices';
import { printHtmlInWindow } from '@/lib/devices/drivers';
import { receiptHtml } from '@/lib/devices/receipt-html';
import { fetchImageForPdf, pdfSizingFor } from '@/lib/image-tools';
import { getReception, getReceptionSlots, receptionPhotoUrl, receptionSchemaReady } from '../reception/api';
import { arrangePhotos, slotLabel } from '../reception/rules';
import { listNotDoneReasons, listPlanOps, planOpsSchemaReady } from '../plan-ops/api';
import { isAbsentOnBike } from '../exploded/operation-presence';
import { DEFAULT_NOT_DONE_REASONS, reasonText } from '../plan-ops/rules';
import { CHECK_POINTS, OR_PRINT_FORMATS, OR_PRINT_MODES, normalizeCheckPoints, printFileName, type OrPrintFormat, type OrPrintMode, type PrintLineIn } from './rules';

function labelsFor(locale: Locale): OrPdfLabels {
  const k = (key: string) => tIn(locale, `orBase.pdf.${key}`);
  const checkLabels: Record<string, string> = {};
  for (const c of CHECK_POINTS) checkLabels[c] = tIn(locale, `pointsVr.${c}`);
  return {
    orTitle: k('orTitle'), ficheTitle: k('ficheTitle'), number: k('number'), receivedAt: k('receivedAt'), promisedAt: k('promisedAt'),
    operator: k('operator'), client: k('client'), vehicle: k('vehicle'), brandModel: k('brandModel'), reference: k('reference'),
    plate: k('plate'), vin: k('vin'), mileage: k('mileage'), work: k('work'), reception: k('reception'), checks: k('checks'),
    checkV: k('checkV'), checkR: k('checkR'), legendVR: k('legendVR'), colDesignation: k('colDesignation'), colQty: k('colQty'),
    colUnit: k('colUnit'), colTotal: k('colTotal'), warrantyMark: k('warrantyMark'), totalHt: k('totalHt'), totalVat: k('totalVat'),
    totalTtc: k('totalTtc'), depositTitle: k('depositTitle'), depositText: k('depositText'), signClient: k('signClient'),
    signReception: k('signReception'), date: k('date'), doneTitle: k('doneTitle'), mechanic: k('mechanic'), timeSpent: k('timeSpent'),
    page: k('page'), none: k('none'), advance: tIn(locale, 'orBase.pdfAdvance'), checkLabels,
    condition: tIn(locale, 'reception.pdfConditionTitle'), photosTitle: tIn(locale, 'reception.pdfPhotosTitle'),
    missingPhotos: tIn(locale, 'reception.pdfMissing').replace(/\s*:?\s*\{list\}\s*$/, ''),
    opsTitle: tIn(locale, 'planOps.pdfTitle'), notDoneTitle: tIn(locale, 'planOps.pdfNotDoneTitle'),
    opDone: tIn(locale, 'planOps.pdfDone'), opNotDone: tIn(locale, 'planOps.pdfNotDone'), opTodo: tIn(locale, 'planOps.pdfTodo'),
  };
}

/**
 * Lots C et D du parcours mecanicien (19/11) : reception (commentaire, manquantes, photos si
 * `withPhotos`) et operations du plan de l'OR, dans la langue du document. Sans les migrations : rien.
 */
async function loadWorkshopExtras(orId: string, companyId: string, locale: Locale, withPhotos: boolean): Promise<Pick<OrPdfData, 'reception' | 'operations'>> {
  const tr = (key: string) => tIn(locale, key);
  const out: Pick<OrPdfData, 'reception' | 'operations'> = { reception: null, operations: null };
  if (await receptionSchemaReady().catch(() => false)) {
    const [state, slots] = await Promise.all([getReception(orId), getReceptionSlots(companyId)]);
    const a = arrangePhotos(slots, state.photos);
    const ordered = [...a.bySlot.flatMap((x) => (x.photo ? [{ p: x.photo, label: slotLabel(x.slot, tr) }] : [])),
      ...a.others.map((p) => ({ p, label: p.slot_code })),
      ...a.damages.map((p, i) => ({ p, label: `${tr('reception.damage')} ${i + 1}` }))];
    const sizing = pdfSizingFor(ordered.length);
    const photos: OrPdfPhoto[] = [];
    if (withPhotos) {
      for (const o of ordered) {
        const url = await receptionPhotoUrl(o.p.storage_path);
        const img = url ? await fetchImageForPdf(url, sizing) : null;
        if (img) photos.push({ label: o.label, comment: o.p.comment, dataUrl: img.dataUrl, w: img.w, h: img.h });
      }
    }
    const missing = state.reception || state.photos.length
      ? slots.filter((s) => s.required && !state.photos.some((p) => p.slot_code === s.code)).map((s) => slotLabel(s, tr))
      : [];
    if (state.reception?.general_comment || photos.length || missing.length) {
      out.reception = { comment: state.reception?.general_comment ?? null, missing, photos };
    }
  }
  if (await planOpsSchemaReady().catch(() => false)) {
    const [all, reasons] = await Promise.all([listPlanOps(orId), listNotDoneReasons(companyId).catch(() => [])]);
    // ATE-05 (26/11) : operation « sans objet » (element absent de la moto) : pas imprimee.
    const ops = all.filter((o) => !isAbsentOnBike(o));
    const rs = reasons.length ? reasons : DEFAULT_NOT_DONE_REASONS;
    if (ops.length) {
      out.operations = ops.map((o) => ({
        label: o.label, status: o.status,
        detail: o.status === 'non_fait' ? [reasonText(o.not_done_reason, rs, tr), o.not_done_note].filter(Boolean).join(' : ') : null,
      }));
    }
  }
  return out;
}

const joinAddr = (...parts: unknown[]) => parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(', ');

async function loadPdfData(orId: string): Promise<{ data: OrPdfData; locale: Locale }> {
  const full = await getRepairOrderFull(orId);
  const o = full.or as typeof full.or & Record<string, unknown>;
  const [{ data: company }, { data: contact }, { data: vehicle }] = await Promise.all([
    supabase.from('companies').select('*').eq('id', o.company_id).maybeSingle(),
    o.contact_id ? supabase.from('contacts').select('*').eq('id', o.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    o.vehicle_id ? supabase.from('vehicles').select('*').eq('id', o.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const co = (company ?? {}) as Record<string, unknown>;
  const c = (contact ?? null) as (Contact & Record<string, unknown>) | null;
  const v = (vehicle ?? null) as Record<string, unknown> | null;
  const deposits = await listOrDeposits([orId]).catch(() => new Map<string, { amount: number }>());
  const data: OrPdfData = {
    company: {
      name: String(co.legal_name || co.name || ''),
      address: joinAddr(co.address, [co.zip, co.city].filter(Boolean).join(' ')),
      vat: co.vat_number ? `TVA ${co.vat_number}` : null,
      phone: (co.phone as string | null | undefined) ?? null,
    },
    or: {
      number: o.number, created_at: o.created_at, promised_at: (o.promised_at as string | null | undefined) ?? null,
      operator: o.operator, mileage: o.mileage, work_description: o.work_description, reception_notes: o.reception_notes,
      total_ht: Number(o.total_ht), total_vat: Number(o.total_vat), total_ttc: Number(o.total_ttc),
    },
    checkPoints: normalizeCheckPoints(o.check_points),
    lines: full.lines.map((l) => ({ ...l, checkup_state: (l as Record<string, unknown>).checkup_state as string | null | undefined } as PrintLineIn)),
    client: c ? {
      name: contactDisplayName(c),
      address: joinAddr(c.address, [c.zip, c.city].filter(Boolean).join(' ')),
      phone: (c.mobile as string | null) || (c.gsm as string | null) || (c.phone as string | null) || null,
      email: (c.email as string | null) ?? null,
    } : null,
    vehicle: v ? {
      brandModel: [v.brand, v.model].filter(Boolean).join(' '),
      reference: (v.reference as string | null) ?? null, plate: (v.plate as string | null) ?? null, vin: (v.vin as string | null) ?? null,
    } : null,
    deposit: deposits.get(orId)?.amount ?? null,
  };
  const locale = contactLocale(c);
  await ensureLocale(locale); // dictionnaire de la langue du client (charge a la demande, lot perf 2)
  return { data, locale };
}

/** Ticket 80 mm (decision Q46) depuis les memes donnees que le PDF, dans la langue du client. */
function ticketFrom(data: OrPdfData, locale: Locale): ReceiptDoc {
  return buildOrTicket({
    company: { name: data.company.name, address: data.company.address || null, phone: data.company.phone, vat: data.company.vat },
    or: {
      number: data.or.number, receivedAt: data.or.created_at, promisedAt: data.or.promised_at, mileage: data.or.mileage,
      workDescription: data.or.work_description,
    },
    client: data.client ? { name: data.client.name, phone: data.client.phone } : null,
    vehicle: data.vehicle ? { model: data.vehicle.brandModel || data.vehicle.reference, plate: data.vehicle.plate, vin: data.vehicle.vin } : null,
    deposit: data.deposit ?? null,
  }, (key) => tIn(locale, `orBase.ticket_${key}`));
}

export function OrPrintDialog({ orId, orNumber, onClose }: { orId: string; orNumber: string | null; onClose: () => void }) {
  const { activeCompanyId } = useAuth();
  // Format (decision Q46 du 18/11) : PDF A4 (par defaut, comme avant) ou ticket 80 mm (imprimante de caisse du poste).
  const [format, setFormat] = useState<OrPrintFormat>('a4');
  const devices = useDeviceSetup(activeCompanyId);
  const [mode, setMode] = useState<OrPrintMode>('both');
  const [priced, setPriced] = useState(false);
  const [hideClient, setHideClient] = useState(false);
  // Lot C (19/11) : photos de reception en annexe de l'OR (coche par defaut).
  const [withPhotos, setWithPhotos] = useState(true);

  const ticket = useMutation({
    mutationFn: async () => {
      const { data, locale } = await loadPdfData(orId);
      const doc = ticketFrom(data, locale);
      // Aucun poste regle : le ticket 80 mm s'imprime par le navigateur (jamais l'A4).
      const r = await printReceipt(devices.ctx, doc, { legacyA4: () => { printHtmlInWindow(receiptHtml(doc, 80)); } });
      if (!r.ok) throw new Error(r.code);
    },
    meta: { success: false },
    onError: (e) => toast.error(e instanceof Error ? `${t('orBase.printError')} (${e.message})` : t('orBase.printError')),
  });

  const run = useMutation({
    mutationFn: async (target: 'open' | 'download') => {
      const { data, locale } = await loadPdfData(orId);
      const extras = activeCompanyId ? await loadWorkshopExtras(orId, activeCompanyId, locale, withPhotos).catch(() => ({})) : {};
      const blob = await buildOrPdf({ ...data, ...extras }, { mode, priced, hideClient }, labelsFor(locale));
      const url = URL.createObjectURL(blob);
      if (target === 'open') {
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        const a = document.createElement('a');
        a.href = url; a.download = printFileName(orNumber, mode);
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }
    },
    meta: { success: false },
    onError: (e) => toast.error(e instanceof Error ? `${t('orBase.printError')} (${e.message})` : t('orBase.printError')),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Printer className="size-5" /> {t('orBase.printTitle')}</DialogTitle>
          <DialogDescription>{t('orBase.printUnsaved')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('orBase.printFormat')}</Label>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as OrPrintFormat)}>
              {OR_PRINT_FORMATS.map((f) => (
                <label key={f} className="flex items-center gap-2 text-[14px]">
                  <RadioGroupItem value={f} /> {t(`orBase.format_${f}`)}
                </label>
              ))}
            </RadioGroup>
          </div>
          {format === 'a4' && <>
          <div className="space-y-2">
            <Label>{t('orBase.printMode')}</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as OrPrintMode)}>
              {OR_PRINT_MODES.map((m) => (
                <label key={m} className="flex items-center gap-2 text-[14px]">
                  <RadioGroupItem value={m} /> {t(`orBase.mode.${m}`)}
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[14px]"><Checkbox checked={priced} onCheckedChange={(v) => setPriced(v === true)} /> {t('orBase.priced')}</label>
            <label className="flex items-center gap-2 text-[14px]"><Checkbox checked={hideClient} onCheckedChange={(v) => setHideClient(v === true)} /> {t('orBase.hideClient')}</label>
            <label className="flex items-center gap-2 text-[14px]"><Checkbox checked={withPhotos} onCheckedChange={(v) => setWithPhotos(v === true)} /> {t('reception.printPhotos')}</label>
          </div>
          </>}
          {format === 'ticket' && <p className="text-[13px] text-muted-foreground">{t('orBase.ticketHint')}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={run.isPending || ticket.isPending}>{t('action.cancel')}</Button>
          {format === 'ticket' && (
            <Button onClick={() => ticket.mutate()} disabled={ticket.isPending}>
              {ticket.isPending ? <Loader2 className="animate-spin" /> : <Printer />} {t('orBase.ticketPrint')}
            </Button>
          )}
          {format === 'a4' && <>
          <Button variant="outline" onClick={() => run.mutate('download')} disabled={run.isPending}>
            {run.isPending && run.variables === 'download' ? <Loader2 className="animate-spin" /> : <Download />} {t('orBase.printDownload')}
          </Button>
          <Button onClick={() => run.mutate('open')} disabled={run.isPending}>
            {run.isPending && run.variables === 'open' ? <Loader2 className="animate-spin" /> : <ExternalLink />} {t('orBase.printOpen')}
          </Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
