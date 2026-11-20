import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileCheck2, Globe, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { t, pageTitle } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { contactDisplayName, type Contact } from '@/modules/contacts/api';
import { ContactPicker } from '@/modules/sales/document-editor';
import { groupDeliveryNotes, selectionTotals, type BlCandidate } from '@/modules/sales/bl-invoicing';
import { invoiceDeliveryNotes, listDeliveryNotesToInvoice, listPaymentTerms, type BlInvoiceResult } from '@/modules/sales/bl-invoicing-api';
import { todayIso } from '@/modules/sales/document-list';
import { operatorPrintName } from '@/modules/sales/operators';

/**
 * Ventes → Facturation des BL (G8 « Utilitaires factures › Génération des factures par B.L. client »,
 * parcours 17) : BL d'un client ou de tous, sur une période ; date de facturation ; HT / TTC ;
 * condition de règlement imposée ; majoration fixe ou en % ; une facture par BL ou regroupement.
 */
export const Route = createFileRoute('/_app/sales/bl-invoicing')({
  head: () => ({ meta: [{ title: pageTitle('salesBlInvoicing') }] }),
  component: BlInvoicingPage,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('fr-BE');
const KEEP = '__bl';
const num = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? n : 0; };

function BlInvoicingPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canWrite = useCanWrite();
  const [contact, setContact] = useState<Contact | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [priceMode, setPriceMode] = useState<'ht' | 'ttc'>('ttc');
  const [termCode, setTermCode] = useState(KEEP);
  const [fixedHt, setFixedHt] = useState('');
  const [surchargePct, setSurchargePct] = useState('');
  const [onePerBl, setOnePerBl] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<BlInvoiceResult[] | null>(null);

  const blQ = useQuery({
    queryKey: ['bl-to-invoice', activeCompanyId, contact?.id ?? null, dateFrom, dateTo],
    queryFn: () => listDeliveryNotesToInvoice(activeCompanyId!, { contactId: contact?.id ?? null, dateFrom, dateTo }),
    enabled: !!activeCompanyId,
  });
  const termsQ = useQuery({ queryKey: ['payment-terms', activeCompanyId], queryFn: () => listPaymentTerms(activeCompanyId!), enabled: !!activeCompanyId });
  const bls = blQ.data ?? [];
  const chosen = bls.filter((b) => selected.has(b.id));
  const tot = selectionTotals(chosen);
  const invoicesCount = useMemo(() => groupDeliveryNotes(chosen, onePerBl).length, [chosen, onePerBl]);
  const allSelected = bls.length > 0 && bls.every((b) => selected.has(b.id));
  const term = termsQ.data?.find((x) => x.code === termCode) ?? null;

  const run = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => invoiceDeliveryNotes(activeCompanyId!, chosen, {
      invoiceDate, priceMode, paymentCondition: term?.label ?? null, paymentDays: term?.days ?? null, paymentEndOfMonth: term?.endOfMonth ?? false,
      surchargeFixedHt: num(fixedHt), surchargePct: num(surchargePct), onePerBl,
    }, { blHeader: t('blInvoicing.blHeaderLine'), shipping: t('blInvoicing.shippingLine'), surcharge: t('blInvoicing.surchargeLine') }),
    onSuccess: (res) => {
      setResults(res);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['bl-to-invoice'] });
      qc.invalidateQueries({ queryKey: ['sales-doc-list'] });
      const ok = res.filter((r) => r.invoiceId).length;
      if (ok === res.length) toast.success(t('blInvoicing.done').replace('{n}', String(ok)));
      else toast.error(t('blInvoicing.partial').replace('{ok}', String(ok)).replace('{n}', String(res.length)));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onValidate = async () => {
    if (!chosen.length) return;
    const ok = await confirm({
      title: t('blInvoicing.confirmTitle'),
      message: t('blInvoicing.confirmBody').replace('{bl}', String(chosen.length)).replace('{n}', String(invoicesCount)).replace('{date}', fmtDate(invoiceDate)).replace('{ttc}', eur(tot.ttc)),
      confirmLabel: t('blInvoicing.confirmDo'),
    });
    if (ok) run.mutate();
  };

  return (
    <>
      <PageHeader
        title={t('blInvoicing.title')}
        description={t('blInvoicing.subtitle')}
        breadcrumbs={[{ label: t('nav.sales'), to: '/sales' }, { label: t('blInvoicing.title') }]}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('sales.client')}>
          {contact ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
              <span className="truncate">{contactDisplayName(contact)}</span>
              <button type="button" onClick={() => setContact(null)} className="ml-auto text-muted-foreground hover:text-danger" aria-label={t('sales.filterReset')}><X className="size-4" /></button>
            </div>
          ) : <ContactPicker companyId={activeCompanyId ?? ''} onPick={setContact} />}
        </Field>
        <Field label={t('blInvoicing.blFrom')}><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
        <Field label={t('blInvoicing.blTo')}><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
        <Field label={t('blInvoicing.invoiceDate')}><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Field>
        <Field label={t('blInvoicing.priceMode')}>
          <Select value={priceMode} onValueChange={(v) => setPriceMode(v as 'ht' | 'ttc')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ttc">{t('blInvoicing.modeTtc')}</SelectItem>
              <SelectItem value="ht">{t('blInvoicing.modeHt')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('blInvoicing.paymentTerm')}>
          <Select value={termCode} onValueChange={setTermCode}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={KEEP}>{t('blInvoicing.termKeep')}</SelectItem>
              {(termsQ.data ?? []).map((x) => <SelectItem key={x.code} value={x.code}>{x.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('blInvoicing.surchargeFixed')}><Input inputMode="decimal" value={fixedHt} onChange={(e) => setFixedHt(e.target.value)} placeholder="0,00" /></Field>
        <Field label={t('blInvoicing.surchargePct')}><Input inputMode="decimal" value={surchargePct} onChange={(e) => setSurchargePct(e.target.value)} placeholder="0" /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <Checkbox checked={onePerBl} onCheckedChange={(v) => setOnePerBl(v === true)} />
          {t('blInvoicing.onePerBl')}
        </label>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setSelected(allSelected ? new Set() : new Set(bls.map((b) => b.id)))} disabled={!bls.length}>
          {allSelected ? t('blInvoicing.selectNone') : t('blInvoicing.selectAll')}
        </Button>
        <span className="text-[13px] text-muted-foreground">
          {t('blInvoicing.selectionTotals').replace('{count}', String(tot.count)).replace('{ht}', eur(tot.ht)).replace('{ttc}', eur(tot.ttc)).replace('{deposit}', eur(tot.deposit)).replace('{n}', String(invoicesCount))}
        </span>
        {canWrite && (
          <Button className="ml-auto" onClick={onValidate} disabled={!chosen.length || run.isPending}>
            {run.isPending ? <Loader2 className="animate-spin" /> : <FileCheck2 />} {t('blInvoicing.validate')}
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th className="w-8" />
              <Th>{t('blInvoicing.colBl')}</Th>
              <Th>{t('sales.colDate')}</Th>
              <Th>{t('sales.client')}</Th>
              <Th>{t('blInvoicing.colCondition')}</Th>
              <Th className="text-right">{t('docList.ht')}</Th>
              <Th className="text-right">{t('docList.ttc')}</Th>
              <Th className="text-right">{t('docList.colDeposit')}</Th>
              <Th>{t('sales.operator')}</Th>
              <Th>{t('blInvoicing.colNote')}</Th>
              <Th>{t('blInvoicing.colTaxExempt')}</Th>
            </tr>
          </thead>
          <tbody>
            {blQ.isLoading && <tr><td colSpan={11} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {!blQ.isLoading && !bls.length && <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">{t('blInvoicing.empty')}</td></tr>}
            {bls.map((b: BlCandidate) => (
              <tr key={b.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent"
                onClick={() => setSelected((p) => { const n = new Set(p); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })}>
                <td className="px-3 py-2"><Checkbox checked={selected.has(b.id)} /></td>
                <td className="px-3 py-2 font-mono text-[12px]">
                  <button type="button" className="text-info underline" onClick={(e) => { e.stopPropagation(); navigate({ to: '/sales/$documentId', params: { documentId: b.id } }); }}>{b.number ?? '—'}</button>
                </td>
                <td className="px-3 py-2 tabular-nums">{fmtDate(b.issue_date)}</td>
                <td className="px-3 py-2">{b.contact_name ?? '—'}</td>
                <td className="px-3 py-2">{b.condition_reglement ?? ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(b.total_ht)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(b.total_ttc)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{b.paid_amount ? eur(b.paid_amount) : ''}</td>
                <td className="px-3 py-2">{operatorPrintName(b.operator)}</td>
                <td className="max-w-[16rem] truncate px-3 py-2" title={b.notes ?? ''}>{b.notes ?? ''}</td>
                <td className="px-3 py-2">{b.tax_exempt && <StatusBadge tone="info" icon={Globe} label={t('sales.taxExempt')} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {results && (
        <div className="mt-4 space-y-1 rounded-md border border-border bg-card p-3 text-[13px]">
          <div className="font-medium">{t('blInvoicing.resultsTitle')}</div>
          {results.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              {r.invoiceId
                ? <StatusBadge tone="success" icon={CheckCircle2} label={t('blInvoicing.resultOk').replace('{number}', r.number ?? '')} />
                : <StatusBadge tone="danger" icon={AlertTriangle} label={t('blInvoicing.resultKo')} />}
              <span className="text-muted-foreground">{r.blNumbers.join(', ')}</span>
              {r.invoiceId && <button type="button" className="text-info underline" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: r.invoiceId as string } })}>{t('blInvoicing.openInvoice')}</button>}
              {r.error && <span className="text-danger">{r.error}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`whitespace-nowrap px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
