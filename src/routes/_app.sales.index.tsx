import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, SlidersHorizontal, X, Printer, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listDocuments, duplicateDocument, deleteDocument, getDocumentFull, type DocumentRow } from '@/modules/sales/write-api';
import { printDocument } from '@/modules/sales/print-document';
import { listContactsByIds, contactDisplayName } from '@/modules/contacts/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/sales/')({
  head: () => ({ meta: [{ title: 'Ventes & Facturation — Ducati Bruxelles' }] }),
  component: SalesList,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const statusTone = (s: string) => (s === 'payee' ? 'success' : s === 'annulee' ? 'neutral' : s === 'brouillon' ? 'info' : 'warning');

const DOC_TYPES = ['FAC', 'DEV', 'TIK', 'BL', 'RES', 'AVO'] as const;

// Département E-shop vs magasin : la table `documents` n'a pas de colonne canal dédiée.
// Heuristique best-effort sur `imported_from` (texte libre alimenté par les imports/le web).
// TODO(sales-filters) : remplacer par une colonne `channel` explicite si le e-shop l'alimente un jour.
function isEshopDoc(d: DocumentRow): boolean {
  return /eshop|web|shopify/i.test(d.imported_from ?? '');
}

type ContentFlags = { vn: boolean; vo: boolean; dv: boolean; none: boolean };
type ClientTypeFlags = { pro: boolean; particulier: boolean };

type FiltersState = {
  department: 'all' | 'store' | 'eshop';
  docType: string;
  content: ContentFlags;
  dateFrom: string;
  dateTo: string;
  clientType: ClientTypeFlags;
};

const EMPTY_CONTENT: ContentFlags = { vn: false, vo: false, dv: false, none: false };
const EMPTY_CLIENT_TYPE: ClientTypeFlags = { pro: false, particulier: false };
const EMPTY_FILTERS: FiltersState = {
  department: 'all', docType: '', content: EMPTY_CONTENT, dateFrom: '', dateTo: '', clientType: EMPTY_CLIENT_TYPE,
};

function countActive(f: FiltersState): number {
  let n = 0;
  if (f.department !== 'all') n++;
  if (f.docType) n++;
  if (f.content.vn || f.content.vo || f.content.dv || f.content.none) n++;
  if (f.dateFrom || f.dateTo) n++;
  if (f.clientType.pro || f.clientType.particulier) n++;
  return n;
}

function SalesList() {
  const { activeCompanyId, activeCompany } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [f, setF] = useState<FiltersState>(EMPTY_FILTERS);
  const set = <K extends keyof FiltersState>(k: K, v: FiltersState[K]) => setF((p) => ({ ...p, [k]: v }));
  const active = countActive(f);

  const { data, isLoading } = useQuery({
    queryKey: ['documents', activeCompanyId],
    queryFn: () => listDocuments(activeCompanyId!),
    enabled: !!activeCompanyId,
  });

  // Carte contact_id → Contact, chargée une fois pour la liste affichée (≤100 documents,
  // cf. listDocuments) : sert à la fois à la recherche par nom/code et au filtre Pro/Particulier.
  const contactIds = useMemo(
    () => Array.from(new Set((data ?? []).map((d) => d.contact_id).filter((id): id is string => !!id))),
    [data],
  );
  const { data: contacts } = useQuery({
    queryKey: ['sales-contacts', contactIds],
    queryFn: () => listContactsByIds(contactIds),
    enabled: contactIds.length > 0,
  });
  const contactById = useMemo(() => new Map((contacts ?? []).map((c) => [c.id, c])), [contacts]);

  const rows = useMemo(() => {
    if (!data) return data;
    const q = search.trim().toLowerCase();
    return data.filter((d) => {
      if (f.department === 'store' && isEshopDoc(d)) return false;
      if (f.department === 'eshop' && !isEshopDoc(d)) return false;
      if (f.docType && d.doc_type !== f.docType) return false;
      if (f.dateFrom && d.issue_date < f.dateFrom) return false;
      if (f.dateTo && d.issue_date > f.dateTo) return false;

      const anyContent = f.content.vn || f.content.vo || f.content.dv || f.content.none;
      if (anyContent) {
        const hasVehicle = !!d.vehicle_id;
        // TODO(sales-filters) : distinguer VN / VO / dépôt-vente demande le mgmt_type de
        // l'article véhicule lié (via document_lines → articles) ; en son absence ici,
        // VN/VO/DV pointent tous vers « avec véhicule ».
        const matchesVehicle = (f.content.vn || f.content.vo || f.content.dv) && hasVehicle;
        const matchesNone = f.content.none && !hasVehicle;
        if (!matchesVehicle && !matchesNone) return false;
      }

      const contact = d.contact_id ? contactById.get(d.contact_id) : null;
      const anyClientType = f.clientType.pro || f.clientType.particulier;
      if (anyClientType) {
        if (!contact) return false;
        const isPro = contact.type === 'professionnel';
        if (isPro && !f.clientType.pro) return false;
        if (!isPro && !f.clientType.particulier) return false;
      }

      if (q) {
        const num = (d.number ?? '').toLowerCase();
        const name = contact ? contactDisplayName(contact).toLowerCase() : '';
        const code = (contact?.code ?? '').toLowerCase();
        if (!num.includes(q) && !name.includes(q) && !code.includes(q)) return false;
      }
      return true;
    });
  }, [data, search, f, contactById]);

  const printMut = useMutation({
    mutationFn: async (id: string) => printDocument(await getDocumentFull(id), activeCompany?.name ?? ''),
    onError: () => toast.error(t('sales.errPrint')),
  });
  const duplicateMut = useMutation({
    mutationFn: (id: string) => duplicateDocument(id),
    onSuccess: (newId) => {
      toast.success(t('sales.duplicated'));
      qc.invalidateQueries({ queryKey: ['documents', activeCompanyId] });
      navigate({ to: '/sales/$documentId', params: { documentId: newId } });
    },
    onError: () => toast.error(t('sales.errDuplicate')),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => {
      toast.success(t('sales.deleted'));
      qc.invalidateQueries({ queryKey: ['documents', activeCompanyId] });
    },
    onError: () => toast.error(t('sales.errDelete')),
  });
  const onDelete = (d: DocumentRow) => {
    if (d.status !== 'brouillon') return;
    if (window.confirm(t('sales.deleteConfirm'))) deleteMut.mutate(d.id);
  };

  return (
    <>
      <PageHeader
        title={t('nav.sales')}
        description={t('sales.subtitle')}
        actions={<Button onClick={() => navigate({ to: '/sales/new' })}><Plus /> {t('sales.newDoc')}</Button>}
      />

      <div className="mb-2 flex items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('sales.searchPlaceholder')} className="pl-9" />
        </div>
        <Button variant={active > 0 ? 'default' : 'outline'} onClick={() => setFiltersOpen((o) => !o)}>
          <SlidersHorizontal /> {t('sales.filters')}{active > 0 ? ` (${active})` : ''}
        </Button>
        {rows && <span className="text-sm text-muted-foreground">{rows.length}</span>}
      </div>

      {filtersOpen && (
        <div className="mb-4 rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterField label={t('sales.filterDepartment')}>
              <Select value={f.department} onValueChange={(v) => set('department', v as FiltersState['department'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('sales.filterAll')}</SelectItem>
                  <SelectItem value="store">{t('sales.filterDeptStore')}</SelectItem>
                  <SelectItem value="eshop">{t('sales.filterDeptEshop')}</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label={t('sales.filterDocType')}>
              <Select value={f.docType || ALL_SENTINEL} onValueChange={(v) => set('docType', v === ALL_SENTINEL ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SENTINEL}>{t('sales.filterAll')}</SelectItem>
                  {DOC_TYPES.map((dt) => <SelectItem key={dt} value={dt}>{t(`sales.type_${dt}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label={t('sales.filterDateFrom')}>
              <Input type="date" value={f.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} />
            </FilterField>
            <FilterField label={t('sales.filterDateTo')}>
              <Input type="date" value={f.dateTo} onChange={(e) => set('dateTo', e.target.value)} />
            </FilterField>
            <div className="flex flex-wrap items-end gap-4 pb-1 sm:col-span-2 lg:col-span-2">
              <CheckboxGroupLabel>{t('sales.filterContent')}</CheckboxGroupLabel>
              <CheckLabel checked={f.content.vn} onChange={(v) => set('content', { ...f.content, vn: v })}>{t('sales.contentVn')}</CheckLabel>
              <CheckLabel checked={f.content.vo} onChange={(v) => set('content', { ...f.content, vo: v })}>{t('sales.contentVo')}</CheckLabel>
              <CheckLabel checked={f.content.dv} onChange={(v) => set('content', { ...f.content, dv: v })}>{t('sales.contentDv')}</CheckLabel>
              <CheckLabel checked={f.content.none} onChange={(v) => set('content', { ...f.content, none: v })}>{t('sales.contentNone')}</CheckLabel>
            </div>
            <div className="flex flex-wrap items-end gap-4 pb-1 sm:col-span-2 lg:col-span-2">
              <CheckboxGroupLabel>{t('sales.filterClientType')}</CheckboxGroupLabel>
              <CheckLabel checked={f.clientType.pro} onChange={(v) => set('clientType', { ...f.clientType, pro: v })}>{t('sales.clientTypePro')}</CheckLabel>
              <CheckLabel checked={f.clientType.particulier} onChange={(v) => set('clientType', { ...f.clientType, particulier: v })}>{t('sales.clientTypeParticulier')}</CheckLabel>
              <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setF(EMPTY_FILTERS)} disabled={active === 0}>
                <X /> {t('sales.filterReset')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('sales.colNumber')}</Th>
              <Th>{t('sales.colType')}</Th>
              <Th>{t('sales.colDate')}</Th>
              <Th>{t('sales.colStatus')}</Th>
              <Th className="text-right">{t('sales.colTtc')}</Th>
              <Th>{t('sales.colAcompte')}</Th>
              <Th className="w-32 text-right">{t('sales.colActions')}</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{t('sales.empty')}</td></tr>}
            {data && data.length > 0 && rows && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{t('sales.filterEmpty')}</td></tr>}
            {rows?.map((d) => (
              <tr key={d.id} onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: d.id } })}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                <td className="px-3 py-2 font-mono text-[12px]">{d.number ?? '—'}</td>
                <td className="px-3 py-2">{t(`sales.type_${d.doc_type}`)}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{d.issue_date}</td>
                <td className="px-3 py-2"><StatusBadge tone={statusTone(d.status)} label={t(`sales.status_${d.status}`)} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(d.total_ttc))}</td>
                <td className="px-3 py-2"><PaidBadge ttc={Number(d.total_ttc)} paid={Number(d.paid_amount)} /></td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" title={t('sales.print')} onClick={() => printMut.mutate(d.id)}>
                      <Printer className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title={t('action.duplicate')} onClick={() => duplicateMut.mutate(d.id)}>
                      <Copy className="size-4" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" title={t('action.delete')}
                      disabled={d.status !== 'brouillon'}
                      onClick={() => onDelete(d)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PaidBadge({ ttc, paid }: { ttc: number; paid: number }) {
  if (paid <= 0) return <span className="text-muted-foreground">—</span>;
  if (paid >= ttc) return <StatusBadge tone="success" label={t('sales.badgePaid')} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusBadge tone="success" label={t('sales.badgeReceived').replace('{n}', eur(paid))} />
      <StatusBadge tone="danger" label={t('sales.badgeBalance').replace('{n}', eur(ttc - paid))} />
    </span>
  );
}

/** Select de filtre « Tous » : premier item avec une sentinelle (SelectItem interdit la valeur vide). */
const ALL_SENTINEL = '__tous__';

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function CheckboxGroupLabel({ children }: { children: ReactNode }) {
  return <span className="w-full text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</span>;
}

function CheckLabel({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {children}
    </label>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
