import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, CheckCircle2, Archive, Loader2, Search, History, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import {
  EXCEL_TABS, getExcelConfig, getCurrentExcelOrder, listExcelOrderLines, countExcelCatalog, searchExcelCatalog,
  addExcelLines, updateExcelLine, deleteExcelLine, listClientOrdersForExcel, importClientOrderIntoExcel, contactNames,
  downloadCurrentExcel, closeAndArchiveExcel, listExcelOrderHistory, archivedExcelUrl,
  type ExcelOrder, type ExcelOrderLine, type ExcelOrderStatus, type ExcelCatalogItem,
} from '@/modules/orders/excel-api';
import { excelTabsSummary, type ExcelTab } from '@/modules/orders/thresholds';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/orders/excel')({
  head: () => ({ meta: [{ title: 'Commande Excel — Ducati Bruxelles' }] }),
  component: ExcelOrderScreen,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const statusTone = (s: ExcelOrderStatus): StatusTone => (s === 'archive' ? 'success' : s === 'cloture' ? 'info' : s === 'telecharge' ? 'warning' : 'neutral');
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('fr-BE') : '—');

// Classeur Excel Ducati (spécification docs/process-commandes-pieces.md §1.6) :
// classeur ouvert enregistré en base, totaux par onglet en temps réel, seuil paramétré,
// n° interne au 1er téléchargement, clôture + archivage en GED, historique.
function ExcelOrderScreen() {
  const { activeCompanyId } = useAuth();
  const [view, setView] = useState<'current' | 'history'>('current');
  return (
    <>
      <PageHeader
        title={t('orders.excelTitle')}
        description={t('orders.excelSubtitle')}
        breadcrumbs={[{ label: t('orders.title'), to: '/orders' }, { label: t('orders.excelTitle') }]}
      />
      <div className="mb-4 flex gap-2">
        <Button variant={view === 'current' ? 'default' : 'outline'} size="sm" onClick={() => setView('current')}><FileSpreadsheet /> {t('orders.excelCurrent')}</Button>
        <Button variant={view === 'history' ? 'default' : 'outline'} size="sm" onClick={() => setView('history')}><History /> {t('orders.excelHistory')}</Button>
      </div>
      {activeCompanyId && (view === 'current' ? <CurrentWorkbook companyId={activeCompanyId} /> : <ExcelHistory companyId={activeCompanyId} />)}
    </>
  );
}

function CurrentWorkbook({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<ExcelTab>('demo');

  const cfgQ = useQuery({ queryKey: ['excel-config', companyId], queryFn: () => getExcelConfig(companyId) });
  const catCount = useQuery({ queryKey: ['excel-catalog-count', companyId], queryFn: () => countExcelCatalog(companyId) });
  const orderQ = useQuery({ queryKey: ['excel-current', companyId], queryFn: () => getCurrentExcelOrder(companyId, cfgQ.data!), enabled: !!cfgQ.data });
  const order = orderQ.data;
  const linesKey = ['excel-lines', order?.id];
  const linesQ = useQuery({ queryKey: linesKey, queryFn: () => listExcelOrderLines(order!.id), enabled: !!order?.id });
  const lines = useMemo(() => linesQ.data ?? [], [linesQ.data]);
  const namesQ = useQuery({
    queryKey: ['excel-line-contacts', lines.map((l) => l.contact_id).filter(Boolean).sort().join(',')],
    queryFn: () => contactNames(lines.map((l) => l.contact_id ?? '')),
    enabled: lines.some((l) => l.contact_id),
  });
  const names = namesQ.data ?? {};

  const threshold = cfgQ.data?.minHtPerTab ?? 2000;
  const summary = useMemo(
    () => excelTabsSummary(lines.map((l) => ({ tab: l.tab, priceDealer: l.price_dealer, qty: l.qty, extraDiscount: l.extra_discount })), threshold),
    [lines, threshold],
  );
  const tabLines = lines.filter((l) => l.tab === activeTab);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: linesKey });
    qc.invalidateQueries({ queryKey: ['excel-topbar'] });
  };
  /** Mise à jour immédiate de l'écran (totaux en temps réel), enregistrement au départ du champ. */
  const patchLocal = (id: string, p: Partial<ExcelOrderLine>) =>
    qc.setQueryData<ExcelOrderLine[]>(linesKey, (ls) => (ls ?? []).map((l) => (l.id === id ? { ...l, ...p } : l)));

  const save = useMutation({
    mutationFn: ({ id, p }: { id: string; p: Parameters<typeof updateExcelLine>[1] }) => updateExcelLine(id, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['excel-topbar'] }),
    onError: (e: Error) => { toast.error(e.message); refresh(); },
  });
  const del = useMutation({ mutationFn: deleteExcelLine, onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });
  const addFromCatalog = useMutation({
    mutationFn: (c: ExcelCatalogItem) => addExcelLines([{
      excel_order_id: order!.id, tab: activeTab, reference: c.reference, description: c.description, qty: 1,
      price_dealer: Number(c.price_dealer ?? 0), extra_discount: 0, moto_label: null, moto_vin: null, contact_id: null, catalog_id: c.id,
    }]),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const download = useMutation({
    mutationFn: () => downloadCurrentExcel(order!, lines, threshold, names),
    onSuccess: (n) => { toast.success(t('orders.excelNumbered').replace('{n}', n)); qc.invalidateQueries({ queryKey: ['excel-current', companyId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const close = useMutation({
    mutationFn: () => closeAndArchiveExcel(companyId, order!, lines, threshold, names),
    onSuccess: (o) => {
      toast.success(t('orders.excelArchived').replace('{n}', o.number ?? ''));
      qc.invalidateQueries({ queryKey: ['excel-current', companyId] });
      qc.invalidateQueries({ queryKey: ['excel-history', companyId] });
      qc.invalidateQueries({ queryKey: ['excel-topbar'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasQty = lines.some((l) => l.qty > 0);
  const onClose = async () => {
    const ok = await confirm({ title: t('orders.excelCloseTitle'), message: t('orders.excelCloseMsg'), confirmLabel: t('orders.excelClose') });
    if (ok) close.mutate();
  };

  if (cfgQ.isLoading || orderQ.isLoading) return <p className="py-10 text-center text-muted-foreground"><Loader2 className="mx-auto animate-spin" /></p>;
  if (orderQ.error) return <p className="py-10 text-center text-danger">{(orderQ.error as Error).message}</p>;
  if (!order) return null;

  return (
    <>
      {/* En-tête du classeur ouvert */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
        <span className="font-ui font-bold">{order.number ?? t('orders.excelNoNumber')}</span>
        <StatusBadge tone={statusTone(order.status)} label={t(`orders.excelStatus_${order.status}`)} />
        <span className="text-muted-foreground">{t('orders.excelCatalog').replace('{n}', String(catCount.data ?? '…'))}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => download.mutate()} disabled={!hasQty || download.isPending}>
            {download.isPending ? <Loader2 className="animate-spin" /> : <Download />} {t('orders.excelDownload')}
          </Button>
          <Button size="sm" onClick={onClose} disabled={!hasQty || close.isPending}>
            {close.isPending ? <Loader2 className="animate-spin" /> : <Archive />} {t('orders.excelClose')}
          </Button>
        </div>
      </div>

      {catCount.data === 0 && (
        <p className="mb-4 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('orders.excelCatalogEmpty')}</p>
      )}

      {/* Onglets + total et seuil par onglet */}
      <div className="mb-4 flex flex-wrap gap-2">
        {EXCEL_TABS.map((tab) => {
          const st = summary[tab];
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-ui transition-colors ${
                activeTab === tab ? 'border-ring bg-accent font-bold' : 'border-border hover:bg-accent'
              }`}
            >
              <FileSpreadsheet className="size-4" />
              {t(`orders.tab_${tab}`)}
              <span className="tabular-nums">{eur(st.total)}</span>
              {st.reached
                ? <CheckCircle2 className="size-4 text-success" />
                : <span className="text-[11px] text-warning">−{eur(st.remaining)}</span>}
            </button>
          );
        })}
      </div>

      {/* Seuil atteint (vert) — également signalé dans la barre du haut */}
      {EXCEL_TABS.filter((tb) => summary[tb].reached).map((tb) => (
        <div key={tb} className="mb-2 flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
          <CheckCircle2 className="size-4" /> {t('orders.excelThresholdReached').replace('{tab}', t(`orders.tab_${tb}`)).replace('{min}', eur(threshold))}
        </div>
      ))}

      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <CatalogSearch companyId={companyId} onPick={(c) => addFromCatalog.mutate(c)} tabLabel={t(`orders.tab_${activeTab}`)} />
        <ClientOrderImport companyId={companyId} excelOrderId={order.id} tab={activeTab} onDone={refresh} />
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[860px] border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('orders.lineRef')}</Th>
              <Th>{t('orders.lineDesignation')}</Th>
              <Th>{t('orders.excelClient')}</Th>
              <Th className="text-right">{t('orders.excelQty')}</Th>
              <Th className="text-right">{t('orders.excelPriceDealer')}</Th>
              <Th className="text-right">{t('orders.excelValue')}</Th>
              <Th className="text-right">{t('orders.excelExtra')}</Th>
              <Th className="text-right">{t('orders.excelFinal')}</Th>
              <Th>{t('orders.excelMoto')}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {tabLines.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">{t('orders.excelEmpty')}</td></tr>}
            {tabLines.map((l) => {
              const value = l.price_dealer * l.qty;
              const final = value - value * l.extra_discount;
              return (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-1 font-mono text-[12px]">{l.reference}</td>
                  <td className="px-2 py-1">{l.description}</td>
                  <td className="px-2 py-1 text-[12px]">
                    {l.contact_id
                      ? <Link to="/clients/$contactId" params={{ contactId: l.contact_id }} className="inline-flex items-center gap-1 hover:underline"><UserRound className="size-3.5" />{names[l.contact_id] ?? '…'}</Link>
                      : <span className="text-muted-foreground">{t('orders.excelStock')}</span>}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input type="number" min={0} value={l.qty}
                      onChange={(e) => patchLocal(l.id, { qty: Math.max(0, Number(e.target.value)) })}
                      onBlur={() => save.mutate({ id: l.id, p: { qty: l.qty } })}
                      className="w-16 rounded border border-border bg-background px-2 py-1 text-right tabular-nums" />
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">{eur(l.price_dealer)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{eur(value)}</td>
                  <td className="px-2 py-1 text-right">
                    <input type="number" min={0} max={100} step="0.5" value={Math.round(l.extra_discount * 10000) / 100}
                      onChange={(e) => patchLocal(l.id, { extra_discount: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
                      onBlur={() => save.mutate({ id: l.id, p: { extra_discount: l.extra_discount } })}
                      className="w-16 rounded border border-border bg-background px-2 py-1 text-right tabular-nums" aria-label={t('orders.excelExtra')} />
                    <span className="ml-1 text-muted-foreground">%</span>
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums font-bold">{eur(final)}</td>
                  <td className="px-2 py-1">
                    <div className="flex gap-1">
                      <input value={l.moto_label ?? ''} placeholder={t('orders.excelMotoModel')}
                        onChange={(e) => patchLocal(l.id, { moto_label: e.target.value })}
                        onBlur={() => save.mutate({ id: l.id, p: { moto_label: l.moto_label || null } })}
                        className="w-28 rounded border border-border bg-background px-2 py-1" />
                      <input value={l.moto_vin ?? ''} placeholder="VIN"
                        onChange={(e) => patchLocal(l.id, { moto_vin: e.target.value.toUpperCase() })}
                        onBlur={() => save.mutate({ id: l.id, p: { moto_vin: l.moto_vin || null } })}
                        className="w-36 rounded border border-border bg-background px-2 py-1 font-mono text-[12px]" />
                    </div>
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button type="button" onClick={() => del.mutate(l.id)} className="text-danger hover:underline" aria-label={t('orders.excelRemoveLine')}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {tabLines.length > 0 && (
            <tfoot>
              <tr className="border-t border-border bg-muted font-bold">
                <td colSpan={5} className="px-3 py-2 text-right">{t('orders.excelTabTotal')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(summary[activeTab].total)}</td>
                <td />
                <td className="px-3 py-2 text-right tabular-nums">{eur(summary[activeTab].totalFinal)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">{t('orders.excelHelp')}</p>
    </>
  );
}

/** Recherche dans le catalogue Ducati ; un clic ajoute la pièce à l'onglet actif. */
function CatalogSearch({ companyId, onPick, tabLabel }: { companyId: string; onPick: (c: ExcelCatalogItem) => void; tabLabel: string }) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const h = setTimeout(() => setDebounced(term), 250); return () => clearTimeout(h); }, [term]);
  const q = useQuery({ queryKey: ['excel-catalog-search', companyId, debounced], queryFn: () => searchExcelCatalog(companyId, debounced, 12), enabled: debounced.trim().length >= 2 });
  return (
    <div className="rounded-md border border-border p-2">
      <label className="flex items-center gap-2 rounded border border-border bg-background px-2">
        <Search className="size-4 text-muted-foreground" />
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('orders.excelSearch').replace('{tab}', tabLabel)} className="w-full bg-transparent py-1.5 text-[13px] outline-none" />
      </label>
      {debounced.trim().length >= 2 && (
        <ul className="mt-2 max-h-56 overflow-y-auto text-[13px]">
          {q.data?.length === 0 && <li className="px-2 py-1 text-muted-foreground">{t('orders.excelSearchNone')}</li>}
          {q.data?.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { onPick(c); setTerm(''); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent">
                <span className="font-mono text-[12px]">{c.reference}</span>
                <span className="min-w-0 flex-1 truncate">{c.description}</span>
                <span className="tabular-nums text-muted-foreground">{eur(Number(c.price_dealer ?? 0))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Charge les pièces d'une commande client (type Excel) : la ligne garde le client pour la réception. */
function ClientOrderImport({ companyId, excelOrderId, tab, onDone }: { companyId: string; excelOrderId: string; tab: ExcelTab; onDone: () => void }) {
  const [sel, setSel] = useState('');
  const q = useQuery({ queryKey: ['excel-client-orders', companyId], queryFn: () => listClientOrdersForExcel(companyId) });
  const imp = useMutation({
    mutationFn: () => importClientOrderIntoExcel(companyId, excelOrderId, sel, tab),
    onSuccess: (n) => { toast.success(t('orders.excelImported').replace('{n}', String(n))); setSel(''); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2 text-[13px]">
      <span className="font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.excelFromClient')}</span>
      <div className="flex gap-2">
        <select value={sel} onChange={(e) => setSel(e.target.value)} className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5">
          <option value="">{q.data && q.data.length === 0 ? t('orders.excelNoClientOrder') : t('orders.excelPickClientOrder')}</option>
          {q.data?.map((o) => (
            <option key={o.id} value={o.id}>{`${o.number ?? t('orders.draft')} · ${o.contact_name ?? '—'} · ${fmtDate(o.created_at)}`}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={!sel || imp.isPending} onClick={() => imp.mutate()}>
          {imp.isPending ? <Loader2 className="animate-spin" /> : null} {t('orders.excelLoad')}
        </Button>
      </div>
    </div>
  );
}

/** Historique : n°, dates, total par onglet, statut, classeur archivé téléchargeable. */
function ExcelHistory({ companyId }: { companyId: string }) {
  const q = useQuery({ queryKey: ['excel-history', companyId], queryFn: () => listExcelOrderHistory(companyId) });
  const open = async (o: ExcelOrder) => {
    if (!o.archive_path) return;
    try {
      const url = await archivedExcelUrl(o.archive_path);
      if (url) window.open(url, '_blank', 'noopener');
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[760px] border-collapse font-data text-[13px]">
        <thead className="bg-muted">
          <tr>
            <Th>{t('orders.colNumber')}</Th>
            <Th>{t('orders.excelDownloadedOn')}</Th>
            <Th>{t('orders.excelClosedOn')}</Th>
            {EXCEL_TABS.map((tb) => <Th key={tb} className="text-right">{t(`orders.tab_${tb}`)}</Th>)}
            <Th>{t('orders.colStatus')}</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {q.isLoading && <tr><td colSpan={8} className="px-3 py-6 text-center"><Loader2 className="mx-auto animate-spin" /></td></tr>}
          {q.data?.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{t('orders.excelHistoryEmpty')}</td></tr>}
          {q.data?.map((o) => (
            <tr key={o.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-bold">{o.number ?? '—'}</td>
              <td className="px-3 py-2">{fmtDate(o.downloaded_at)}</td>
              <td className="px-3 py-2">{fmtDate(o.closed_at ?? o.archived_at)}</td>
              {EXCEL_TABS.map((tb) => {
                const v = o.tab_totals?.[tb];
                return (
                  <td key={tb} className="px-3 py-2 text-right tabular-nums">
                    {v ? <span className={v.reached ? 'text-success' : ''}>{eur(v.value)}</span> : '—'}
                  </td>
                );
              })}
              <td className="px-3 py-2"><StatusBadge tone={statusTone(o.status)} label={t(`orders.excelStatus_${o.status}`)} /></td>
              <td className="px-3 py-2 text-right">
                {o.archive_path && <Button variant="outline" size="sm" onClick={() => open(o)}><Download /> {t('orders.excelArchivedFile')}</Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
