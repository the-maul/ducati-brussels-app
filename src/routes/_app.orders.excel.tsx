import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, CheckCircle2, Loader2, Search, History, UserRound, Mail, Plus, Archive, Send, Hash } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import {
  EXCEL_TABS, getExcelConfig, getCurrentExcelOrder, listExcelOrderLines, countExcelCatalog, searchExcelCatalog,
  addExcelLines, updateExcelLine, deleteExcelLine, listClientOrdersForExcel, importClientOrderIntoExcel, contactNames,
  assignExcelNumber, archivedExcelUrl,
  type ExcelOrderLine, type ExcelOrderStatus, type ExcelCatalogItem,
} from '@/modules/orders/excel-api';
import {
  getDemoMailTo, getDemoTemplate, setDemoTab, setDemoMotos, setDcsNumber, classifyReferences,
  buildDemoWorkbook, saveWorkbookToDisk, listDemoHistory, type DemoOrder,
} from '@/modules/orders/demo-api';
import {
  DEMO_MOTO_SLOTS, checkDemoOrder, demoWorkbookFileName, motosForTab, type DemoMoto, type DemoMotos,
} from '@/modules/orders/demo-rules';
import { DemoMailDialog } from '@/modules/orders/demo-mail-dialog';
import { excelTabsSummary, type ExcelTab } from '@/modules/orders/thresholds';
import { t, pageTitle, fillVars } from '@/lib/i18n';

export const Route = createFileRoute('/_app/orders/excel')({
  head: () => ({ meta: [{ title: pageTitle('ordersExcel') }] }),
  component: ExcelOrderScreen,
});

type AnyStatus = ExcelOrderStatus | 'commandee';
const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const statusTone = (s: AnyStatus): StatusTone => (s === 'commandee' || s === 'archive' ? 'success' : s === 'cloture' ? 'info' : s === 'telecharge' ? 'warning' : 'neutral');
const statusLabel = (s: AnyStatus) => (s === 'commandee' ? t('demoOrder.status_commandee') : t(`orders.excelStatus_${s}`));
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('fr-BE') : '—');

// Commande DEMO / COURTOISIE / SHOWROOM (mission 09, carte 6 ; ecran du 19/09 reutilise) :
// panier demo = classeur ouvert enregistre en base, accessoires uniquement, onglet choisi,
// motos de demo, minimum par onglet, classeur Ducati VIERGE (GED privee) rempli et telecharge,
// envoi par mail a Ducati (statut « commandee », classeur et mail conserves), numero DCS a la main.
function ExcelOrderScreen() {
  const { activeCompanyId, companies } = useAuth();
  const [view, setView] = useState<'current' | 'history'>('current');
  const companyName = companies.find((c) => c.id === activeCompanyId)?.name ?? '';
  return (
    <>
      <PageHeader
        title={t('demoOrder.title')}
        description={t('demoOrder.subtitle')}
        breadcrumbs={[{ label: t('orders.title'), to: '/orders' }, { label: t('demoOrder.title') }]}
      />
      <div className="mb-4 flex gap-2">
        <Button variant={view === 'current' ? 'default' : 'outline'} size="sm" onClick={() => setView('current')}><FileSpreadsheet /> {t('orders.excelCurrent')}</Button>
        <Button variant={view === 'history' ? 'default' : 'outline'} size="sm" onClick={() => setView('history')}><History /> {t('orders.excelHistory')}</Button>
      </div>
      {activeCompanyId && (view === 'current' ? <CurrentWorkbook companyId={activeCompanyId} companyName={companyName} /> : <ExcelHistory companyId={activeCompanyId} />)}
    </>
  );
}

function CurrentWorkbook({ companyId, companyName }: { companyId: string; companyName: string }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<ExcelTab | null>(null);
  const [mailOpen, setMailOpen] = useState(false);

  const cfgQ = useQuery({ queryKey: ['excel-config', companyId], queryFn: () => getExcelConfig(companyId) });
  const catCount = useQuery({ queryKey: ['excel-catalog-count', companyId], queryFn: () => countExcelCatalog(companyId) });
  const templateQ = useQuery({ queryKey: ['demo-template', companyId], queryFn: () => getDemoTemplate(companyId) });
  const mailToQ = useQuery({ queryKey: ['demo-mail-to', companyId], queryFn: () => getDemoMailTo(companyId) });
  const orderQ = useQuery({ queryKey: ['excel-current', companyId], queryFn: () => getCurrentExcelOrder(companyId, cfgQ.data!), enabled: !!cfgQ.data });
  const order = orderQ.data as DemoOrder | undefined;
  const linesKey = ['excel-lines', order?.id];
  const linesQ = useQuery({ queryKey: linesKey, queryFn: () => listExcelOrderLines(order!.id), enabled: !!order?.id });
  const lines = useMemo(() => linesQ.data ?? [], [linesQ.data]);
  const namesQ = useQuery({
    queryKey: ['excel-line-contacts', lines.map((l) => l.contact_id).filter(Boolean).sort().join(',')],
    queryFn: () => contactNames(lines.map((l) => l.contact_id ?? '')),
    enabled: lines.some((l) => l.contact_id),
  });
  const names = namesQ.data ?? {};
  const tab: ExcelTab = activeTab ?? (order?.tab as ExcelTab | undefined) ?? 'demo';

  const threshold = cfgQ.data?.minHtPerTab ?? 2000;
  const summary = useMemo(
    () => excelTabsSummary(lines.map((l) => ({ tab: l.tab, priceDealer: l.price_dealer, qty: l.qty, extraDiscount: l.extra_discount })), threshold),
    [lines, threshold],
  );
  const check = useMemo(() => checkDemoOrder(lines.map((l) => ({ tab: l.tab, priceDealer: l.price_dealer, qty: l.qty })), threshold), [lines, threshold]);
  const tabLines = lines.filter((l) => l.tab === tab);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: linesKey });
    qc.invalidateQueries({ queryKey: ['excel-topbar'] });
  };
  const refreshOrder = () => qc.invalidateQueries({ queryKey: ['excel-current', companyId] });
  /** Mise a jour immediate de l'ecran (totaux en temps reel), enregistrement au depart du champ. */
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
      excel_order_id: order!.id, tab, reference: c.reference, description: c.description, qty: 1,
      price_dealer: Number(c.price_dealer ?? 0), extra_discount: 0, moto_label: null, moto_vin: null, contact_id: null, catalog_id: c.id,
    }]),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const pickTab = useMutation({
    mutationFn: (tb: ExcelTab) => setDemoTab(order!.id, tb),
    onMutate: (tb) => setActiveTab(tb),
    onSuccess: refreshOrder,
    onError: (e: Error) => toast.error(e.message),
  });

  // Telecharger le classeur Ducati rempli (numero CEX attribue au 1er telechargement, comme le 19/09).
  const download = useMutation({
    mutationFn: async () => {
      const number = await assignExcelNumber(order!.id);
      const built = await buildDemoWorkbook(templateQ.data!, { ...order!, number }, lines, cfgQ.data!.dealerCode, demoWorkbookFileName(number, check.tabsWithLines));
      saveWorkbookToDisk(built);
      return { number, built };
    },
    onSuccess: ({ number, built }) => {
      toast.success(t('orders.excelNumbered').replace('{n}', number));
      if (built.report.unknown.length) toast.warning(fillVars(t('demoOrder.unknownRefs'), { refs: built.report.unknown.map((u) => u.reference).join(', ') }));
      refreshOrder();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasQty = lines.some((l) => l.qty > 0);
  const templateOk = !!templateQ.data;
  const canOrder = hasQty && templateOk && check.ok;

  if (cfgQ.isLoading || orderQ.isLoading) return <p className="py-10 text-center text-muted-foreground"><Loader2 className="mx-auto animate-spin" /></p>;
  if (orderQ.error) return <p className="py-10 text-center text-danger">{(orderQ.error as Error).message}</p>;
  if (!order) return null;

  return (
    <>
      {/* En-tete du panier demo */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
        <span className="font-ui font-bold">{order.number ?? t('orders.excelNoNumber')}</span>
        <StatusBadge tone={statusTone(order.status)} label={statusLabel(order.status)} />
        <StatusBadge tone="info" label={t('demoOrder.kindBadge')} />
        <span className="text-muted-foreground">{t('orders.excelCatalog').replace('{n}', String(catCount.data ?? '…'))}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => download.mutate()} disabled={!hasQty || !templateOk || download.isPending}>
            {download.isPending ? <Loader2 className="animate-spin" /> : <Download />} {t('demoOrder.downloadFilled')}
          </Button>
          <Button size="sm" onClick={() => setMailOpen(true)} disabled={!canOrder}>
            <Send /> {t('demoOrder.order')}
          </Button>
        </div>
      </div>

      {catCount.data === 0 && (
        <p className="mb-4 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('orders.excelCatalogEmpty')}</p>
      )}
      {/* Classeur vierge de l'annee : depose en GED privee depuis Parametres */}
      {templateQ.data ? (
        <p className="mb-3 flex items-center gap-2 text-[12px] text-muted-foreground">
          <FileSpreadsheet className="size-4" /> {fillVars(t('demoOrder.templateOk'), { file: templateQ.data.file_name, date: fmtDate(templateQ.data.created_at) })}
        </p>
      ) : templateQ.isSuccess ? (
        <p className="mb-3 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
          {t('demoOrder.templateMissing')} <Link to="/settings" className="underline">{t('nav.settings')}</Link>
        </p>
      ) : null}

      {/* Onglets + total et seuil par onglet ; l'onglet actif recoit les ajouts */}
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('demoOrder.tabPick')}</div>
      <div className="mb-4 flex flex-wrap gap-2">
        {EXCEL_TABS.map((tb) => {
          const st = summary[tb];
          return (
            <button
              key={tb}
              type="button"
              onClick={() => pickTab.mutate(tb)}
              aria-pressed={tab === tb}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-ui transition-colors ${
                tab === tb ? 'border-ring bg-accent font-bold' : 'border-border hover:bg-accent'
              }`}
            >
              <FileSpreadsheet className="size-4" />
              {t(`orders.tab_${tb}`)}
              <span className="tabular-nums">{eur(st.total)}</span>
              {st.reached
                ? <CheckCircle2 className="size-4 text-success" />
                : st.lines > 0 ? <span className="text-[11px] text-warning">−{eur(st.remaining)}</span> : null}
            </button>
          );
        })}
      </div>

      {/* Controle « minimum par onglet » : un onglet utilise sous le minimum bloque la commande */}
      {check.belowMin.map((b) => (
        <div key={b.tab} className="mb-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
          {fillVars(t('demoOrder.minPerTab'), { tab: t(`orders.tab_${b.tab}`), total: eur(b.total), min: eur(b.min), missing: eur(b.missing) })}
        </div>
      ))}
      {EXCEL_TABS.filter((tb) => summary[tb].reached).map((tb) => (
        <div key={tb} className="mb-2 flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
          <CheckCircle2 className="size-4" /> {t('orders.excelThresholdReached').replace('{tab}', t(`orders.tab_${tb}`)).replace('{min}', eur(threshold))}
        </div>
      ))}

      <DemoMotosEditor order={order} tab={tab} onSaved={refreshOrder} />

      <div className="mb-3 grid gap-3 md:grid-cols-3">
        <CatalogSearch companyId={companyId} onPick={(c) => addFromCatalog.mutate(c)} tabLabel={t(`orders.tab_${tab}`)} />
        <AddByReference companyId={companyId} excelOrderId={order.id} tab={tab} onDone={refresh} />
        <ClientOrderImport companyId={companyId} excelOrderId={order.id} tab={tab} onDone={refresh} />
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
                <td className="px-3 py-2 text-right tabular-nums">{eur(summary[tab].total)}</td>
                <td />
                <td className="px-3 py-2 text-right tabular-nums">{eur(summary[tab].totalFinal)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">{t('demoOrder.help')}</p>

      {mailOpen && templateQ.data && cfgQ.data && (
        <DemoMailDialog
          companyId={companyId} companyName={companyName} order={order} lines={lines} template={templateQ.data}
          dealerCode={cfgQ.data.dealerCode} mailTo={mailToQ.data ?? ''}
          onClose={() => setMailOpen(false)}
          onOrdered={() => {
            setMailOpen(false);
            qc.invalidateQueries({ queryKey: ['excel-current', companyId] });
            qc.invalidateQueries({ queryKey: ['excel-history', companyId] });
            qc.invalidateQueries({ queryKey: ['excel-topbar'] });
          }}
        />
      )}
    </>
  );
}

/** Blocs « Moto 1..4 » de l'onglet (modele, n° de commande, n° de serie) → cellules I3..O5 du classeur. */
function DemoMotosEditor({ order, tab, onSaved }: { order: DemoOrder; tab: ExcelTab; onSaved: () => void }) {
  const [motos, setMotos] = useState<DemoMoto[]>(() => motosForTab(order.demo_motos, tab));
  useEffect(() => { setMotos(motosForTab(order.demo_motos, tab)); }, [order.demo_motos, tab]);
  const save = useMutation({
    mutationFn: (next: DemoMoto[]) => setDemoMotos(order.id, { ...(order.demo_motos ?? {}), [tab]: next } as DemoMotos),
    onSuccess: onSaved,
    onError: (e: Error) => toast.error(e.message),
  });
  const patch = (i: number, p: Partial<DemoMoto>) => setMotos((ms) => ms.map((m, j) => (j === i ? { ...m, ...p } : m)));
  const cls = 'w-full rounded border border-border bg-background px-2 py-1 text-[13px]';
  return (
    <div className="mb-3 rounded-md border border-border p-2">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{fillVars(t('demoOrder.motosTitle'), { tab: t(`orders.tab_${tab}`) })}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: DEMO_MOTO_SLOTS }, (_, i) => (
          <div key={i} className="flex flex-col gap-1 rounded border border-border p-2">
            <span className="font-ui text-[12px] font-bold">{fillVars(t('demoOrder.motoN'), { n: i + 1 })}</span>
            <input value={motos[i]?.model ?? ''} placeholder={t('demoOrder.motoModel')} onChange={(e) => patch(i, { model: e.target.value })} onBlur={() => save.mutate(motos)} className={cls} aria-label={t('demoOrder.motoModel')} />
            <input value={motos[i]?.orderNo ?? ''} placeholder={t('demoOrder.motoOrderNo')} onChange={(e) => patch(i, { orderNo: e.target.value })} onBlur={() => save.mutate(motos)} className={cls} aria-label={t('demoOrder.motoOrderNo')} />
            <input value={motos[i]?.serial ?? ''} placeholder={t('demoOrder.motoSerial')} onChange={(e) => patch(i, { serial: e.target.value.toUpperCase() })} onBlur={() => save.mutate(motos)} className={`${cls} font-mono text-[12px]`} aria-label={t('demoOrder.motoSerial')} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Recherche dans le catalogue accessoires Ducati ; un clic ajoute la piece a l'onglet actif. */
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

/** Ajout par reference : une piece detachee ou un vetement est refuse avec la raison. */
function AddByReference({ companyId, excelOrderId, tab, onDone }: { companyId: string; excelOrderId: string; tab: ExcelTab; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const [qty, setQty] = useState('1');
  const [refused, setRefused] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: async () => {
      const [v] = await classifyReferences(companyId, [ref]);
      if (!v || v.kind !== 'accessoire') {
        const key = v?.kind === 'piece' ? 'demoOrder.refusedPiece' : v?.kind === 'vetement' ? 'demoOrder.refusedVetement' : 'demoOrder.refusedUnknown';
        throw new Error(fillVars(t(key), { ref: ref.trim() }));
      }
      await addExcelLines([{
        excel_order_id: excelOrderId, tab, reference: ref.trim(), description: v.description, qty: Math.max(1, Math.round(Number(qty) || 1)),
        price_dealer: v.priceDealer, extra_discount: 0, moto_label: null, moto_vin: null, contact_id: null, catalog_id: v.catalogId,
      }]);
    },
    onSuccess: () => { setRef(''); setQty('1'); setRefused(null); onDone(); },
    onError: (e: Error) => setRefused(e.message),
  });
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2 text-[13px]">
      <span className="font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('demoOrder.addByRef')}</span>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (ref.trim()) add.mutate(); }}>
        <input value={ref} onChange={(e) => { setRef(e.target.value); setRefused(null); }} placeholder={t('demoOrder.addByRefPlaceholder')} className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 font-mono text-[12px]" />
        <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="w-16 rounded border border-border bg-background px-2 py-1.5 text-right tabular-nums" aria-label={t('orders.excelQty')} />
        <Button size="sm" variant="outline" type="submit" disabled={!ref.trim() || add.isPending}>
          {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('demoOrder.add')}
        </Button>
      </form>
      {refused && <p className="rounded-md bg-danger-bg px-2 py-1 text-[12px] text-danger">{refused}</p>}
    </div>
  );
}

/** Charge les pieces d'une commande client (type Excel) : la ligne garde le client ; les non-accessoires sont refuses. */
function ClientOrderImport({ companyId, excelOrderId, tab, onDone }: { companyId: string; excelOrderId: string; tab: ExcelTab; onDone: () => void }) {
  const [sel, setSel] = useState('');
  const q = useQuery({ queryKey: ['excel-client-orders', companyId], queryFn: () => listClientOrdersForExcel(companyId) });
  const imp = useMutation({
    mutationFn: () => importClientOrderIntoExcel(companyId, excelOrderId, sel, tab),
    onSuccess: (r) => {
      toast.success(t('orders.excelImported').replace('{n}', String(r.added)));
      if (r.refused.length) toast.warning(fillVars(t('demoOrder.importRefused'), { n: r.refused.length, refs: r.refused.join(', ') }));
      setSel(''); onDone();
    },
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

/** Historique : commandes passees (mail, classeur, n° DCS a saisir) et anciens classeurs archives. */
function ExcelHistory({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['excel-history', companyId], queryFn: () => listDemoHistory(companyId) });
  const open = async (path: string | null | undefined) => {
    if (!path) return;
    try {
      const url = await archivedExcelUrl(path);
      if (url) window.open(url, '_blank', 'noopener');
    } catch (e) { toast.error((e as Error).message); }
  };
  const dcs = useMutation({
    mutationFn: ({ id, n }: { id: string; n: string }) => setDcsNumber(id, n || null),
    onSuccess: () => { toast.success(t('demoOrder.dcsSaved')); qc.invalidateQueries({ queryKey: ['excel-history', companyId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[980px] border-collapse font-data text-[13px]">
        <thead className="bg-muted">
          <tr>
            <Th>{t('orders.colNumber')}</Th>
            <Th>{t('demoOrder.histOrderedOn')}</Th>
            <Th>{t('demoOrder.histMail')}</Th>
            <Th>{t('demoOrder.dcsNumber')}</Th>
            {EXCEL_TABS.map((tb) => <Th key={tb} className="text-right">{t(`orders.tab_${tb}`)}</Th>)}
            <Th>{t('orders.colStatus')}</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {q.isLoading && <tr><td colSpan={9} className="px-3 py-6 text-center"><Loader2 className="mx-auto animate-spin" /></td></tr>}
          {q.data?.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">{t('orders.excelHistoryEmpty')}</td></tr>}
          {q.data?.map((o) => (
            <tr key={o.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-bold">{o.number ?? '—'}</td>
              <td className="px-3 py-2">{fmtDate(o.ordered_at ?? o.closed_at ?? o.archived_at)}</td>
              <td className="px-3 py-2 text-[12px]">
                {o.mail_to ? <span className="inline-flex items-center gap-1"><Mail className="size-3.5" /> {o.mail_to}{o.mail_from ? ` · ${o.mail_from}` : ''}</span> : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="px-3 py-2"><DcsNumberCell order={o} onSave={(n) => dcs.mutate({ id: o.id, n })} /></td>
              {EXCEL_TABS.map((tb) => {
                const v = o.tab_totals?.[tb];
                return (
                  <td key={tb} className="px-3 py-2 text-right tabular-nums">
                    {v && v.lines > 0 ? <span className={v.reached ? 'text-success' : ''}>{eur(v.value)}</span> : '—'}
                  </td>
                );
              })}
              <td className="px-3 py-2"><StatusBadge tone={statusTone(o.status as AnyStatus)} label={statusLabel(o.status as AnyStatus)} /></td>
              <td className="px-3 py-2 text-right">
                {(o.workbook_path || o.archive_path) && (
                  <Button variant="outline" size="sm" onClick={() => open(o.workbook_path ?? o.archive_path)}>
                    {o.workbook_path ? <Download /> : <Archive />} {t('orders.excelArchivedFile')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Numero DCS : saisi a la main apres l'envoi (M-79), enregistre au depart du champ. */
function DcsNumberCell({ order, onSave }: { order: DemoOrder; onSave: (n: string) => void }) {
  const [v, setV] = useState(order.dcs_number ?? '');
  useEffect(() => { setV(order.dcs_number ?? ''); }, [order.dcs_number]);
  if (order.status !== 'commandee') return <span className="text-muted-foreground">{order.dcs_number ?? '—'}</span>;
  return (
    <label className="flex items-center gap-1">
      <Hash className="size-3.5 text-muted-foreground" />
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if ((v || '') !== (order.dcs_number ?? '')) onSave(v.trim()); }}
        placeholder={t('demoOrder.dcsPlaceholder')} className="w-36 rounded border border-border bg-background px-2 py-1 font-mono text-[12px]" aria-label={t('demoOrder.dcsNumber')} />
    </label>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
