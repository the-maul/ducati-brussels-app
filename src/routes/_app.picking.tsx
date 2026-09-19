/**
 * M6 — Listes de préparation (mission 02, carte « picking list » ; mission 05, carte 6).
 * Une seule notion : la liste de préparation d'un document. Toutes les listes avec document,
 * client, moto, vendeur, date, avancement, emplacement et statut ; filtres, tri ; ouvrir la vue
 * tablette ou le document ; imprimer, régénérer, terminer, annuler / supprimer, rouvrir.
 * Aucune action ne touche au stock.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ClipboardList, FileText, Loader2, MapPin, Plus, Search, Tablet, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth/auth-context';
import {
  listPickingOverview, openPickingForDocument, filterPickings, sortPickings, canPrepareDocument,
  ALL_SELLERS, DEFAULT_PICKING_FILTERS, PICKING_LIST_STATUSES,
  type PickingFilters, type PickingOverviewRow, type PickingSortKey, type PickingStatusFilter,
} from '@/modules/sales/picking-api';
import { PickingActions, PickingStatusBadge } from '@/modules/sales/picking-actions';
import { listDocuments } from '@/modules/sales/write-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/picking')({
  head: () => ({ meta: [{ title: 'Listes de préparation — Ducati Bruxelles' }] }),
  component: PickingPage,
});

const docLabel = (r: PickingOverviewRow) =>
  r.doc_type ? `${t(`sales.type_${r.doc_type}`)} ${r.doc_number ?? t('sales.draftSuffix')}` : t('picking.noDocument');
const dmy = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '—');

function PickingPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<PickingFilters>(DEFAULT_PICKING_FILTERS);
  const [sort, setSort] = useState<{ key: PickingSortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [newOpen, setNewOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['picking-lists', activeCompanyId],
    queryFn: () => listPickingOverview(activeCompanyId!),
    enabled: !!activeCompanyId,
  });

  const sellers = useMemo(
    () => Array.from(new Set((data ?? []).map((r) => r.seller_name).filter((s): s is string => !!s))).sort(),
    [data],
  );
  const rows = useMemo(() => sortPickings(filterPickings(data ?? [], filters), sort.key, sort.dir), [data, filters, sort]);
  const set = (p: Partial<PickingFilters>) => setFilters((f) => ({ ...f, ...p }));
  const toggleSort = (key: PickingSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' ? 'desc' : 'asc' }));
  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_PICKING_FILTERS);

  const openTablet = (id: string) => navigate({ to: '/preparation/$pickingId', params: { pickingId: id } });

  return (
    <>
      <PageHeader
        title={t('picking.title')}
        description={t('picking.subtitle')}
        actions={<Button className="h-11" onClick={() => setNewOpen(true)}><Plus /> {t('picking.new')}</Button>}
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search} onChange={(e) => set({ search: e.target.value })}
            placeholder={t('picking.searchPlaceholder')} className="h-11 pl-9 text-base"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">{t('picking.filterStatus')}</Label>
          <Select value={filters.status} onValueChange={(v) => set({ status: v as PickingStatusFilter })}>
            <SelectTrigger className="h-11 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="actives">{t('picking.filterActives')}</SelectItem>
              <SelectItem value="toutes">{t('picking.filterAll')}</SelectItem>
              {PICKING_LIST_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`picking.listStatus_${s}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">{t('picking.filterSeller')}</Label>
          <Select value={filters.seller} onValueChange={(v) => set({ seller: v })}>
            <SelectTrigger className="h-11 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SELLERS}>{t('picking.filterAllSellers')}</SelectItem>
              {sellers.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">{t('picking.filterFrom')}</Label>
          <Input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="h-11 w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">{t('picking.filterTo')}</Label>
          <Input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="h-11 w-40" />
        </div>
        {filtered && (
          <Button variant="ghost" className="h-11" onClick={() => setFilters(DEFAULT_PICKING_FILTERS)}><X /> {t('picking.resetFilters')}</Button>
        )}
      </div>
      <p className="mb-2 text-[12px] text-muted-foreground">
        {t('picking.count').replace('{n}', String(rows.length)).replace('{total}', String(data?.length ?? 0))}
      </p>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[14px]">
          <thead className="bg-muted">
            <tr>
              <SortTh k="status" sort={sort} onSort={toggleSort}>{t('picking.colStatus')}</SortTh>
              <SortTh k="document" sort={sort} onSort={toggleSort}>{t('picking.colDocument')}</SortTh>
              <SortTh k="client" sort={sort} onSort={toggleSort}>{t('picking.colClient')}</SortTh>
              <Th>{t('picking.colVehicle')}</Th>
              <SortTh k="seller" sort={sort} onSort={toggleSort}>{t('picking.colSeller')}</SortTh>
              <SortTh k="date" sort={sort} onSort={toggleSort}>{t('picking.colDate')}</SortTh>
              <SortTh k="progress" sort={sort} onSort={toggleSort}>{t('picking.colProgress')}</SortTh>
              <Th>{t('picking.colLocation')}</Th>
              <Th className="w-56" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={9} className="px-3 py-8 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {error && <tr><td colSpan={9} className="px-3 py-6 text-center text-danger">{t('picking.errLoad')}</td></tr>}
            {data && rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                {data.length === 0 ? t('picking.listEmpty') : t('picking.listEmptyFiltered')}
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} onClick={() => openTablet(r.id)} className="cursor-pointer border-b border-border align-top last:border-0 hover:bg-accent">
                <td className="px-3 py-3"><PickingStatusBadge row={r} /></td>
                <td className="px-3 py-3">
                  <div className="font-mono text-[13px]">{docLabel(r)}</div>
                  {r.doc_changed && (r.status === 'en_cours' || r.status === 'pret') && (
                    <div className="mt-1 inline-flex items-center gap-1 text-[12px] text-warning" title={t('picking.docChangedHint')}>
                      <AlertTriangle className="size-3.5" /> {t('picking.docChanged')}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 font-semibold">{r.client_name ?? <span className="font-normal text-muted-foreground">{t('picking.tabletNoClient')}</span>}</td>
                <td className="px-3 py-3 text-[13px]">{r.vehicle_label ?? '—'}</td>
                <td className="px-3 py-3 text-[13px]">{r.seller_name ?? '—'}</td>
                <td className="px-3 py-3 font-mono text-[13px] tabular-nums">{dmy(r.created_at)}</td>
                <td className="px-3 py-3 tabular-nums">
                  <div className="font-bold">{t('picking.progressShort').replace('{done}', String(r.lines_prepared)).replace('{total}', String(r.lines_total))}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {t('picking.mountedShort').replace('{n}', String(r.lines_mounted))}
                    {r.lines_removed > 0 && ` · ${t('picking.removedShort').replace('{n}', String(r.lines_removed))}`}
                  </div>
                </td>
                <td className="px-3 py-3">
                  {r.location
                    ? <span className="inline-flex items-center gap-1 font-mono font-bold"><MapPin className="size-3.5 text-muted-foreground" />{r.location}</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="outline" className="h-10" onClick={() => openTablet(r.id)}><Tablet className="size-4" /> {t('picking.actionOpen')}</Button>
                    {r.document_id && (
                      <Button
                        variant="ghost" size="icon" className="size-10" title={t('picking.actionDocument')}
                        onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: r.document_id! } })}
                      >
                        <FileText className="size-4" />
                      </Button>
                    )}
                    <PickingActions row={r} variant="list" />
                  </div>
                  {r.status === 'annulee' && r.cancel_reason && (
                    <p className="mt-1 max-w-56 text-right text-[12px] text-muted-foreground">{t('picking.reasonShort').replace('{reason}', r.cancel_reason)}</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">{t('picking.noStockMove')}</p>

      {newOpen && activeCompanyId && (
        <NewPickingDialog companyId={activeCompanyId} onClose={() => setNewOpen(false)} onOpened={(id) => { setNewOpen(false); openTablet(id); }} />
      )}
    </>
  );
}

/** « Nouvelle liste » = « Préparer » un document choisi dans la liste (une liste par document). */
function NewPickingDialog({ companyId, onClose, onOpened }: { companyId: string; onClose: () => void; onOpened: (id: string) => void }) {
  const qc = useQueryClient();
  const [documentId, setDocumentId] = useState('');
  const { data: documents } = useQuery({
    queryKey: ['sales-documents-for-picking', companyId],
    queryFn: () => listDocuments(companyId),
  });
  const open = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => openPickingForDocument(documentId),
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ['picking-lists'] }); onOpened(id); },
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('picking.errOpen')),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('picking.newTitle')}</DialogTitle></DialogHeader>
        <p className="text-[13px] text-muted-foreground">{t('picking.newHint')}</p>
        <div className="space-y-1.5">
          <Label>{t('picking.document')}</Label>
          <Select value={documentId} onValueChange={setDocumentId}>
            <SelectTrigger className="h-11"><SelectValue placeholder={t('picking.documentPlaceholder')} /></SelectTrigger>
            <SelectContent>
              {(documents ?? []).filter(canPrepareDocument).map((d) => (
                <SelectItem key={d.id} value={d.id}>{t(`sales.type_${d.doc_type}`)} {d.number ?? t('sales.draftSuffix')} · {d.issue_date}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose}>{t('action.cancel')}</Button>
          <Button className="h-11" onClick={() => open.mutate()} disabled={!documentId || open.isPending}>
            {open.isPending ? <Loader2 className="animate-spin" /> : <ClipboardList />} {t('picking.prepare')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}

function SortTh({ k, sort, onSort, children }: {
  k: PickingSortKey; sort: { key: PickingSortKey; dir: 'asc' | 'desc' }; onSort: (k: PickingSortKey) => void; children: ReactNode;
}) {
  const Icon = sort.key !== k ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <Th>
      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-foreground" onClick={() => onSort(k)}>
        {children} <Icon className={`size-3.5 ${sort.key === k ? 'text-foreground' : 'opacity-50'}`} />
      </button>
    </Th>
  );
}
