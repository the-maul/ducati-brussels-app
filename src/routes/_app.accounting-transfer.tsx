import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, FileDown, Eye, Send, Undo2, Settings2, ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { t, pageTitle, fillVars } from '@/lib/i18n';
import {
  getEbpSettings, previewTransfer, runTransfer, listTransfers, downloadTransfer, cancelTransfer,
  type EbpPreview, type EbpSelection, type TransferRow,
} from '@/modules/accounting/ebp-api';

/**
 * M12 — Transfert comptable « EBP » identique à G8 (Compta › Lancement transfert + historique +
 * Utilitaires › Comptabilité « Annuler transfert »). lot-g8-export-compta, 18/11/2026.
 */
export const Route = createFileRoute('/_app/accounting-transfer')({
  head: () => ({ meta: [{ title: pageTitle('accountingTransfer') }] }),
  component: AccountingTransferPage,
});

const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const today = () => new Date().toISOString().slice(0, 10);
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
const MAX_SHOWN = 500;

function AccountingTransferPage() {
  const { activeCompanyId, hasRole } = useAuth();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const canCancel = hasRole('comptable') || hasRole('admin');
  const settings = useQuery({ queryKey: ['ebp-settings', activeCompanyId], queryFn: () => getEbpSettings(activeCompanyId!), enabled: !!activeCompanyId });
  const history = useQuery({ queryKey: ['ebp-history', activeCompanyId], queryFn: () => listTransfers(activeCompanyId!), enabled: !!activeCompanyId });

  const [sel, setSel] = useState<EbpSelection>({
    from: firstOfMonth(), to: today(), selection: 'period', numberFrom: '', numberTo: '',
    includeSales: true, includePayments: true, includePurchases: false, includeCessions: false, includeConsignments: false,
  });
  const [writeMode, setWriteMode] = useState<'invoice' | 'semi_global'>('invoice');
  const [preview, setPreview] = useState<EbpPreview | null>(null);
  const [toCancel, setToCancel] = useState<TransferRow | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  // Les cases et le mode d'écriture partent des paramètres du transfert (comme G8).
  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setSel((v) => ({
      ...v, selection: s.selection, includeSales: s.includeSales, includePayments: s.includePayments,
      includePurchases: s.includePurchases, includeCessions: s.includeCessions, includeConsignments: s.includeConsignments,
    }));
    setWriteMode(s.writeMode);
  }, [settings.data]);

  const set = <K extends keyof EbpSelection>(k: K, v: EbpSelection[K]) => { setSel((s) => ({ ...s, [k]: v })); setPreview(null); };

  const prev = useMutation({ meta: { success: false }, mutationFn: () => previewTransfer(activeCompanyId!, sel, { writeMode }), onSuccess: setPreview });
  const run = useMutation({
    meta: { success: false },
    mutationFn: () => runTransfer(activeCompanyId!, sel, preview!),
    onSuccess: (r) => { setPreview(null); history.refetch(); setDone(r.transfer_no); },
  });
  const redl = useMutation({ meta: { success: false }, mutationFn: (id: string) => downloadTransfer(id) });
  const cancel = useMutation({
    meta: { success: t('ebp.cancelled') },
    mutationFn: () => cancelTransfer(toCancel!.id, reason),
    onSuccess: () => { setToCancel(null); setReason(''); history.refetch(); setPreview(null); },
  });

  const r = preview?.result;
  const blocked = !r || r.items.length === 0 || r.unbalanced.length > 0;
  const disabled = settings.data && !settings.data.enabled;

  return (
    <>
      <PageHeader
        title={t('ebp.title')}
        description={t('ebp.subtitle')}
        actions={<div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate({ to: '/accounting' })}><ArrowLeft className="size-4" /> {t('ebp.back')}</Button>
          <Button variant="outline" onClick={() => navigate({ to: '/accounting-accounts' })}><Settings2 className="size-4" /> {t('ebp.openAccounts')}</Button>
        </div>}
      />
      <p className="mb-4 rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t('ebp.official')}</p>
      {disabled && <p className="mb-4 rounded-md bg-warning-bg px-3 py-2 text-[12px] text-warning">{t('ebp.disabled')}</p>}

      {/* Sélection (G8 « Lancement transfert ») */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
        <div className="space-y-1">
          <Lbl>{t('ebp.selection')}</Lbl>
          <Select value={sel.selection} onValueChange={(v) => set('selection', v as 'period' | 'number')}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="period">{t('ebp.byPeriod')}</SelectItem>
              <SelectItem value="number">{t('ebp.byNumber')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {sel.selection === 'period' ? (
          <>
            <div className="space-y-1"><Lbl>{t('ebp.from')}</Lbl><Input type="date" value={sel.from} onChange={(e) => set('from', e.target.value)} /></div>
            <div className="space-y-1"><Lbl>{t('ebp.to')}</Lbl><Input type="date" value={sel.to} onChange={(e) => set('to', e.target.value)} /></div>
          </>
        ) : (
          <>
            <div className="space-y-1"><Lbl>{t('ebp.numberFrom')}</Lbl><Input value={sel.numberFrom ?? ''} onChange={(e) => set('numberFrom', e.target.value)} className="w-44 font-mono" /></div>
            <div className="space-y-1"><Lbl>{t('ebp.numberTo')}</Lbl><Input value={sel.numberTo ?? ''} onChange={(e) => set('numberTo', e.target.value)} className="w-44 font-mono" /></div>
          </>
        )}
        <div className="space-y-1">
          <Lbl>{t('ebp.writeMode')}</Lbl>
          <Select value={writeMode} onValueChange={(v) => { setWriteMode(v as 'invoice' | 'semi_global'); setPreview(null); }}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="invoice">{t('ebp.modeInvoice')}</SelectItem>
              <SelectItem value="semi_global">{t('ebp.modeSemi')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Lbl>{t('ebp.include')}</Lbl>
          <div className="flex flex-wrap gap-3 py-2 text-[13px]">
            {([
              ['includeSales', 'ebp.incSales'], ['includePayments', 'ebp.incPayments'], ['includePurchases', 'ebp.incPurchases'],
              ['includeCessions', 'ebp.incCessions'], ['includeConsignments', 'ebp.incConsignments'],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5">
                <Checkbox checked={sel[k]} onCheckedChange={(v) => set(k, v === true)} /> {t(label)}
              </label>
            ))}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => { setDone(null); prev.mutate(); }} disabled={prev.isPending || !activeCompanyId}>
            {prev.isPending ? <Loader2 className="animate-spin" /> : <Eye className="size-4" />} {t('ebp.preview')}
          </Button>
          {canWrite && (
            <Button onClick={() => run.mutate()} disabled={blocked || run.isPending || !!disabled}>
              {run.isPending ? <Loader2 className="animate-spin" /> : <Send className="size-4" />} {t('ebp.run')}
            </Button>
          )}
        </div>
      </div>

      {done !== null && <p className="mb-4 rounded-md bg-success-bg px-3 py-2 text-[12px] text-success">{fillVars(t('ebp.done'), { n: done })}</p>}

      {r && (
        <div className="mb-6 space-y-2">
          <div className="flex flex-wrap gap-4 text-[13px]">
            <span><b>{t('ebp.pieces')}</b> <span className="tabular-nums">{r.pieces}</span></span>
            <span><b>{t('ebp.lines')}</b> <span className="tabular-nums">{r.lines.length}</span></span>
            <span><b>{t('ebp.debit')}</b> <span className="tabular-nums">{amt(r.totalDebit)}</span></span>
            <span><b>{t('ebp.credit')}</b> <span className="tabular-nums">{amt(r.totalCredit)}</span></span>
          </div>
          {r.items.length === 0 && <Msg tone="info">{t('ebp.nothing')}</Msg>}
          {r.unbalanced.length > 0 && <Msg tone="danger">{fillVars(t('ebp.unbalanced'), { list: r.unbalanced.join(', ') })}</Msg>}
          {r.missingAccounts.length > 0 && <Msg tone="warning">{fillVars(t('ebp.missing'), { n: r.missingAccounts.length })}</Msg>}
          {preview.load.earlierPending > 0 && <Msg tone="warning">{fillVars(t('ebp.earlier'), { n: preview.load.earlierPending })}</Msg>}
          {preview.load.warnings.includes('prepaid_unavailable') && <Msg tone="warning">{t('ebp.prepaidUnavailable')}</Msg>}
          {preview.load.warnings.includes('cessions_unavailable') && <Msg tone="warning">{t('ebp.cessionsUnavailable')}</Msg>}
          {r.lines.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse font-data text-[12px]">
                <thead className="bg-muted"><tr>
                  <Th>{t('ebp.colPiece')}</Th><Th>{t('ebp.colDate')}</Th><Th>{t('ebp.colJournal')}</Th><Th>{t('ebp.colAccount')}</Th>
                  <Th>{t('ebp.colLabel')}</Th><Th>{t('ebp.colExternal')}</Th><Th className="text-right">{t('ebp.debit')}</Th><Th className="text-right">{t('ebp.credit')}</Th>
                </tr></thead>
                <tbody>
                  {r.lines.slice(0, MAX_SHOWN).map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-1 font-mono tabular-nums">{String(l.pieceNo).padStart(5, '0')}</td>
                      <td className="px-3 py-1 font-mono">{l.date}</td>
                      <td className="px-3 py-1 font-mono">{l.journal}</td>
                      <td className={`px-3 py-1 font-mono ${l.account.trim() ? '' : 'bg-warning-bg'}`}>{l.account || '—'}</td>
                      <td className="px-3 py-1 font-mono whitespace-pre">{l.label}</td>
                      <td className="px-3 py-1 font-mono">{l.external}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{l.side === 'D' ? amt(l.amount) : ''}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{l.side === 'C' ? amt(l.amount) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.lines.length > MAX_SHOWN && <p className="px-3 py-2 text-[12px] text-muted-foreground">{fillVars(t('ebp.moreLines'), { n: r.lines.length - MAX_SHOWN })}</p>}
            </div>
          )}
        </div>
      )}

      {/* Historique (G8 Utilitaires › Comptabilité) */}
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ebp.history')}</p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr>
            <Th>{t('ebp.hNo')}</Th><Th>{t('ebp.hDate')}</Th><Th>{t('ebp.hPeriod')}</Th><Th>{t('ebp.hFile')}</Th>
            <Th className="text-right">{t('ebp.pieces')}</Th><Th>{t('ebp.hMode')}</Th><Th>{t('ebp.hState')}</Th><Th />
          </tr></thead>
          <tbody>
            {history.isLoading && <tr><td colSpan={8} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {history.data?.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{t('ebp.noHistory')}</td></tr>}
            {history.data?.map((h) => (
              <tr key={h.id} className="border-b border-border last:border-0 align-top">
                <td className="px-3 py-2 font-mono tabular-nums">{h.transfer_no}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{h.created_at.slice(0, 16).replace('T', ' ')}</td>
                <td className="px-3 py-2 font-mono text-[12px]">
                  {h.number_from || h.number_to
                    ? fillVars(t('ebp.periodNumbers'), { from: h.number_from ?? '', to: h.number_to ?? '' })
                    : `${h.period_from ?? ''} → ${h.period_to ?? ''}`}
                </td>
                <td className="px-3 py-2 font-mono text-[12px]">{[h.file_dir, h.entries_file].filter(Boolean).join('\\')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{h.pieces}</td>
                <td className="px-3 py-2">{h.mode === 'auto' ? t('ebp.modeAuto') : t('ebp.modeManual')}</td>
                <td className="px-3 py-2">
                  {h.status === 'annule'
                    ? <div><StatusBadge tone="neutral" icon={Undo2} label={t('ebp.stateCancelled')} />
                        <p className="mt-1 text-[11px] text-muted-foreground">{fillVars(t('ebp.cancelledOn'), { date: (h.cancelled_at ?? '').slice(0, 10), reason: h.cancel_reason ?? '' })}</p></div>
                    : <StatusBadge tone="success" label={t('ebp.stateDone')} />}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => redl.mutate(h.id)} title={t('ebp.redownload')}><FileDown className="size-4" /> {t('ebp.redownload')}</Button>
                  {h.status !== 'annule' && canCancel && (
                    <Button variant="ghost" size="sm" onClick={() => { setToCancel(h); setReason(''); }}><Undo2 className="size-4" /> {t('ebp.cancel')}</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={!!toCancel} onOpenChange={(o) => { if (!o) setToCancel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fillVars(t('ebp.cancelTitle'), { n: toCancel?.transfer_no ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('ebp.cancelText')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Lbl>{t('ebp.cancelReason')}</Lbl>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.no')}</AlertDialogCancel>
            <Button variant="destructive" onClick={() => cancel.mutate()} disabled={!reason.trim() || cancel.isPending}>
              {cancel.isPending ? <Loader2 className="animate-spin" /> : <Undo2 className="size-4" />} {t('ebp.cancel')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Msg({ tone, children }: { tone: 'info' | 'warning' | 'danger'; children: React.ReactNode }) {
  const cls = tone === 'danger' ? 'bg-danger-bg text-danger' : tone === 'warning' ? 'bg-warning-bg text-warning' : 'bg-info-bg text-info';
  return <p className={`rounded-md px-3 py-2 text-[12px] ${cls}`}>{children}</p>;
}
function Lbl({ children }: { children: React.ReactNode }) { return <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>; }
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>; }
