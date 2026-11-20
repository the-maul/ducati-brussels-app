/**
 * M6 — Actions groupées de la liste des factures (G8 « Utilitaires factures ») : imprimer la
 * sélection, imprimer par plage de numéros ou de dates, envoyer plusieurs factures par e-mail (PDF
 * joint, mode test « vérifier sans envoyer » coché d'office), export Excel. Lot G8 du 18/11/2026.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, Loader2, Mail, Printer, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { t, tIn, ensureLocale } from '@/lib/i18n';
import { contactLocale } from '@/lib/i18n/client-locale';
import { errorMessage } from '@/lib/mutation-feedback';
import { listCompanyMailboxes } from '@/modules/crm/api';
import { listContactsByIds } from '@/modules/contacts/api';
import { getDocumentFull } from './write-api';
import { printDocuments } from './print-document';
import { sendDocumentMail, mailErrorLabel } from './document-mail-api';
import { listAllDocuments } from './document-list-api';
import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from './print-options';
import { PrintOptionsFields } from './print-options-dialog';
import { exportAoa, displayNumber, marginPct, paymentsSummary, type DocListFilters, type DocListRow, type ExportColumn } from './document-list';

type Mode = 'selection' | 'numbers' | 'dates';

/** Imprimer la sélection ou une plage (G8 « Imprimer par numéro », « Imprimer par date », « Imprimer plusieurs factures »). */
export function BatchPrintDialog({ companyId, filters, selected, onClose }: {
  companyId: string; filters: DocListFilters; selected: DocListRow[]; onClose: () => void;
}) {
  const { companies } = useAuth();
  const [mode, setMode] = useState<Mode>(selected.length ? 'selection' : 'numbers');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [opts, setOpts] = useState<PrintOptions>(DEFAULT_PRINT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const companyName = companies.find((c) => c.id === companyId)?.name ?? '';

  const run = async () => {
    setBusy(true);
    try {
      let ids: string[];
      if (mode === 'selection') ids = selected.map((r) => r.id);
      else {
        const f: DocListFilters = mode === 'numbers'
          ? { ...filters, fiscal: 'all', numberFrom: from, numberTo: to, sort: 'number_asc' }
          : { ...filters, fiscal: 'all', dateFrom: from, dateTo: to, sort: 'date_asc' };
        const { rows, truncated } = await listAllDocuments(companyId, f);
        if (truncated) toast.warning(t('docList.truncated'));
        ids = rows.map((r) => r.id);
      }
      if (!ids.length) { toast.info(t('docList.nothingToPrint')); return; }
      if (ids.length > 200) { toast.error(t('docList.tooManyToPrint').replace('{n}', String(ids.length))); return; }
      const fulls = [];
      for (const id of ids) fulls.push(await getDocumentFull(id));
      await printDocuments(fulls, companyName, opts);
      onClose();
    } catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('docList.printTitle')}</DialogTitle>
          <DialogDescription>{t('docList.printHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            {(['selection', 'numbers', 'dates'] as Mode[]).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input type="radio" name="print-mode" checked={mode === m} onChange={() => { setMode(m); setFrom(''); setTo(''); }} disabled={m === 'selection' && !selected.length} />
                {t(`docList.printMode_${m}`).replace('{n}', String(selected.length))}
              </label>
            ))}
          </div>
          {mode !== 'selection' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t(mode === 'numbers' ? 'docList.numberFrom' : 'sales.filterDateFrom')}</Label>
                <Input type={mode === 'dates' ? 'date' : 'text'} value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t(mode === 'numbers' ? 'docList.numberTo' : 'sales.filterDateTo')}</Label>
                <Input type={mode === 'dates' ? 'date' : 'text'} value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          )}
          <PrintOptionsFields docType={null} value={opts} onChange={setOpts} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={run} disabled={busy || (mode !== 'selection' && !from && !to)}>
            {busy ? <Loader2 className="animate-spin" /> : <Printer />} {t('sales.print')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type MailResult = { id: string; number: string; to: string; ok: boolean; message: string };

/**
 * Envoyer plusieurs factures par e-mail (G8). Chaque facture part à l'adresse de sa fiche client,
 * PDF joint, texte dans la langue du client. « Mode test » (coché d'office) = simulation côté
 * serveur, rien ne part ; décoché, une confirmation est demandée avant l'envoi réel.
 */
export function BatchMailDialog({ companyId, rows, onClose }: { companyId: string; rows: DocListRow[]; onClose: () => void }) {
  const { companies } = useAuth();
  const confirm = useConfirm();
  const companyName = companies.find((c) => c.id === companyId)?.name ?? '';
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter(Boolean) as string[])];
  const contactsQ = useQuery({ queryKey: ['batch-mail-contacts', contactIds], queryFn: () => listContactsByIds(contactIds), enabled: contactIds.length > 0 });
  const mailboxesQ = useQuery({ queryKey: ['company-mailboxes', companyId], queryFn: () => listCompanyMailboxes(companyId) });
  const [from, setFrom] = useState('');
  const [testMode, setTestMode] = useState(true);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<MailResult[]>([]);
  const contactById = new Map((contactsQ.data ?? []).map((c) => [c.id, c]));
  const recipients = rows.map((r) => ({ row: r, contact: r.contact_id ? contactById.get(r.contact_id) ?? null : null }));
  const sendable = recipients.filter((x) => x.contact?.email);
  const fromBox = from || mailboxesQ.data?.[0]?.address || '';

  const run = async () => {
    if (!testMode && !(await confirm({ title: t('docList.mailRealTitle'), message: t('docList.mailRealBody').replace('{n}', String(sendable.length)) }))) return;
    setBusy(true);
    const out: MailResult[] = [];
    for (const { row, contact } of recipients) {
      const number = displayNumber(row);
      if (!contact?.email) { out.push({ id: row.id, number, to: '', ok: false, message: t('docList.mailNoEmail') }); continue; }
      try {
        const full = await getDocumentFull(row.id);
        const locale = contactLocale(contact);
        await ensureLocale(locale); // dictionnaire de la langue du client (charge a la demande, lot perf 2)
        const vars: Record<string, string> = { type: tIn(locale, `sales.type_${row.doc_type}`), number, company: companyName, client: row.contact_name ?? '' };
        const fill = (s: string) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), s);
        const body = fill(tIn(locale, 'salesMail.bodyDefault')) + (extra.trim() ? `\n\n${extra.trim()}` : '');
        const res = await sendDocumentMail({
          full, contactId: contact.id, to: contact.email, from: fromBox || undefined,
          subject: fill(tIn(locale, 'salesMail.subjectDefault')), body, dryRun: testMode, locale,
        });
        out.push(res.ok
          ? { id: row.id, number, to: contact.email, ok: true, message: t(res.dryRun ? 'docList.mailChecked' : 'docList.mailSent') }
          : { id: row.id, number, to: contact.email, ok: false, message: mailErrorLabel(res.error) });
      } catch (e) {
        out.push({ id: row.id, number, to: contact.email, ok: false, message: errorMessage(e) });
      }
      setResults([...out]);
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('docList.mailTitle').replace('{n}', String(rows.length))}</DialogTitle>
          <DialogDescription>{t('docList.mailHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('docList.mailFrom')}</Label>
              <Select value={fromBox} onValueChange={setFrom}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{(mailboxesQ.data ?? []).map((m) => <SelectItem key={m.address} value={m.address}>{m.address}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="flex items-start gap-2 pt-6 text-sm">
              <Checkbox checked={testMode} onCheckedChange={(v) => setTestMode(v === true)} />
              <span>{t('docList.mailTestMode')}<span className="block text-[12px] text-muted-foreground">{t('docList.mailTestModeHint')}</span></span>
            </label>
          </div>
          <div className="space-y-1.5">
            <Label>{t('docList.mailExtra')}</Label>
            <Textarea rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>
          <div className="max-h-72 overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr>
                <th className="px-3 py-1.5 text-left text-[11px] uppercase text-muted-foreground">{t('sales.colNumber')}</th>
                <th className="px-3 py-1.5 text-left text-[11px] uppercase text-muted-foreground">{t('sales.client')}</th>
                <th className="px-3 py-1.5 text-left text-[11px] uppercase text-muted-foreground">{t('docList.mailTo')}</th>
                <th className="px-3 py-1.5 text-left text-[11px] uppercase text-muted-foreground">{t('sales.colStatus')}</th>
              </tr></thead>
              <tbody>
                {recipients.map(({ row, contact }) => {
                  const res = results.find((x) => x.id === row.id);
                  return (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5 font-mono text-[12px]">{displayNumber(row)}</td>
                      <td className="px-3 py-1.5">{row.contact_name ?? '—'}</td>
                      <td className="px-3 py-1.5">{contact?.email ?? <span className="text-danger">{t('docList.mailNoEmail')}</span>}</td>
                      <td className="px-3 py-1.5">
                        {res && <StatusBadge tone={res.ok ? 'success' : 'danger'} icon={res.ok ? CheckCircle2 : AlertTriangle} label={res.message} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('action.close')}</Button>
          <Button onClick={run} disabled={busy || !sendable.length}>
            {busy ? <Loader2 className="animate-spin" /> : testMode ? <ShieldCheck /> : <Mail />} {t(testMode ? 'docList.mailRunTest' : 'docList.mailRunReal').replace('{n}', String(sendable.length))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Colonnes de l'export Excel (mêmes que l'écran, valeurs brutes). */
export function docListExportColumns(methodLabel: (c: string) => string): ExportColumn[] {
  return [
    { key: 'number', header: t('sales.colNumber'), value: (r) => displayNumber(r) },
    { key: 'type', header: t('sales.colType'), value: (r) => t(`sales.type_${r.doc_type}`) },
    { key: 'date', header: t('sales.colDate'), value: (r) => r.issue_date },
    { key: 'code', header: t('docList.colCode'), value: (r) => r.contact_code ?? '' },
    { key: 'client', header: t('sales.client'), value: (r) => r.contact_name ?? '' },
    { key: 'operator', header: t('sales.operator'), value: (r) => r.operator ?? '' },
    { key: 'due', header: t('docList.colDue'), value: (r) => r.due },
    { key: 'discount', header: t('docList.colDiscount'), value: (r) => r.discount },
    { key: 'ht', header: t('docList.ht'), value: (r) => r.total_ht },
    { key: 'vat', header: t('docList.colVat'), value: (r) => r.total_vat },
    { key: 'ttc', header: t('docList.ttc'), value: (r) => r.total_ttc },
    { key: 'deposit', header: t('docList.colDeposit'), value: (r) => r.deposit },
    { key: 'margin', header: t('docList.colMargin'), value: (r) => r.margin },
    { key: 'marginPct', header: t('docList.colMarginPct'), value: (r) => marginPct(r.margin, r.total_ht) },
    { key: 'payments', header: t('docList.colPayments'), value: (r) => paymentsSummary(r.payments, methodLabel, t('docList.expected')) },
    { key: 'condition', header: t('salesPdf.condition'), value: (r) => r.condition_reglement ?? '' },
    { key: 'transfer', header: t('docList.colTransfer'), value: (r) => (r.compta_transferred ? t('docList.transferDone') : t('docList.transferPending')) },
    { key: 'transferDate', header: t('docList.colTransferDate'), value: (r) => r.date_transfert ?? '' },
    { key: 'status', header: t('sales.colStatus'), value: (r) => t(`sales.status_${r.status}`) },
    { key: 'notes', header: t('docList.colNotes'), value: (r) => r.notes ?? '' },
  ];
}

/** Export Excel de toute la sélection filtrée (G8 « Export Excel »). */
export async function exportDocListXlsx(companyId: string, filters: DocListFilters, methodLabel: (c: string) => string, fileName: string): Promise<number> {
  const { rows, truncated } = await listAllDocuments(companyId, filters);
  if (truncated) toast.warning(t('docList.truncated'));
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(exportAoa(rows, docListExportColumns(methodLabel))), t('docList.sheetName'));
  XLSX.writeFile(wb, fileName);
  return rows.length;
}
