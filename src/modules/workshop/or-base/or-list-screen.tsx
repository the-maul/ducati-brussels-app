/**
 * M8 — Liste des OR (rattrapage G8 « Rappel d'un O.R. », 18/11/2026).
 *
 * G8 : filtres N° d'OR / immat. / client / chassis ; vues Ordres de reparation, Devis de reparation,
 * O.R. garantie, O.R. accident ; colonnes client, moto, recu le, promis le, operateur, montant,
 * statut ; filtres statut / periode / operateur / type ; Export Excel.
 * DMS : la meme chose, avec pagination (50 par page, au-dela des 100 derniers OR) et l'etat
 * dans l'adresse (Retour retrouve la liste telle qu'on l'a laissee, UX011).
 * Ce composant sert les vues « OR » et « Devis de reparation » de la page Atelier ; les vues
 * « O.R. garantie » et « O.R. accident » sont les tables du lot garantie / accident (memes donnees,
 * colonnes G8 propres : type de cession, cabinet, franchise...).
 */
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { WarrantyStatusBadge } from '../warranty/warranty-views';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useListSearch, useSearchText } from '@/lib/use-list-search';
import { t, fillVars } from '@/lib/i18n';
import { listRepairTypes } from '../or-page-api';
import { listOrOperators, listRepairOrdersForExport, listRepairOrdersPage, type OrListQuery } from './api';
import { listOrDeposits } from './deposit-api';
import { OrStatusBadge, orStatusLabel } from './or-status-badge';
import { OR_ALL_STATUSES, exportGrid, formatOrDate, pageCount, type OrListView } from './rules';

/** Onglets de la page Atelier (OR et devis ici ; garantie, accident, retours, listes : lot garantie / accident). */
export const WORKSHOP_VIEWS = ['or', 'devis', 'garantie', 'accident', 'retours', 'stats'] as const;
export type WorkshopView = (typeof WORKSHOP_VIEWS)[number];

/**
 * Etat de la liste garde dans l'adresse (UX011). `status` / `view` gardent les noms d'avant le 18/11.
 * Decision Q44 (18/11, comme G8 « l'OR facture disparait ») : la liste s'ouvre sur les OR OUVERTS
 * (ni factures, ni annules) ; « Tous les statuts » reste au choix. Le choix vit dans l'adresse
 * (Retour le retrouve) ; il n'existe pas de mecanisme de preference memorisee par poste.
 */
export const OR_LIST_DEFAULT_STATUS = 'open';
export const OR_LIST_DEFAULTS = { status: OR_LIST_DEFAULT_STATUS, view: 'or', q: '', from: '', to: '', op: '', type: '', page: 1 };
export const OR_LIST_CHOICES = { view: WORKSHOP_VIEWS, status: ['all', 'open', ...OR_ALL_STATUSES] } as const;

const ALL = ' all';
const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;

export function OrListScreen({ companyId, view }: { companyId: string; view: Extract<OrListView, 'or' | 'devis'> }) {
  const navigate = useNavigate();
  const [ls, setLs] = useListSearch(OR_LIST_DEFAULTS, OR_LIST_CHOICES);
  const [text, setText] = useSearchText(ls.q, (v) => setLs({ q: v, page: 1 }));

  const query: OrListQuery = {
    companyId, view, status: ls.status, search: ls.q, from: ls.from, to: ls.to, operator: ls.op, repairType: ls.type, page: ls.page,
  };
  const listQ = useQuery({
    queryKey: ['repair-orders', 'page', query],
    queryFn: () => listRepairOrdersPage(query),
    placeholderData: keepPreviousData,
  });
  const operatorsQ = useQuery({ queryKey: ['repair-orders', 'operators', companyId], queryFn: () => listOrOperators(companyId), staleTime: 300_000 });
  const typesQ = useQuery({ queryKey: ['workshop-repair-types', companyId], queryFn: () => listRepairTypes(companyId), staleTime: 300_000 });
  const rows = listQ.data?.rows ?? [];
  const total = listQ.data?.total ?? 0;
  const pages = pageCount(total);
  // Colonne « Acompte » (decision Q45 du 18/11, comme G8) : acompte net percu de chaque OR de la page.
  const depositsQ = useQuery({
    queryKey: ['repair-orders', 'deposits', rows.map((r) => r.id).join(',')],
    queryFn: () => listOrDeposits(rows.map((r) => r.id)),
    enabled: rows.length > 0, placeholderData: keepPreviousData,
  });
  const typeLabel = (code: string | null) => (typesQ.data ?? []).find((x) => x.code === code)?.label ?? code ?? '';

  const exportX = useMutation({
    mutationFn: async () => {
      const all = await listRepairOrdersForExport(query);
      const deposits = await listOrDeposits(all.map((r) => r.id));
      const XLSX = await import('xlsx');
      const grid = exportGrid(all, {
        headers: [
          t('orBase.colNumber'), t('orBase.colClient'), t('orBase.colReference'), t('orBase.colModel'), t('orBase.colPlate'), t('orBase.colVin'),
          t('orBase.colReceived'), t('orBase.colPromised'), t('orBase.colOperator'), t('orBase.colMileage'), t('orBase.colAmount'),
          t('orBase.colStatus'), t('orBase.colWarranty'), t('orBase.colDeposit'),
        ],
        status: orStatusLabel,
        warranty: (w) => t(`workshop.warranty_${w}`),
        deposit: (id) => deposits.get(id)?.amount ?? null,
      });
      const ws = XLSX.utils.aoa_to_sheet(grid);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'OR');
      XLSX.writeFile(wb, `${t('orBase.exportFileName')}-${new Date().toISOString().slice(0, 10)}.xlsx`);
      return all.length;
    },
    meta: { success: false },
    onSuccess: (n) => toast.success(fillVars(t('orBase.exportDone'), { n })),
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });

  const filtered = !!(ls.q || ls.from || ls.to || ls.op || ls.type || ls.status !== OR_LIST_DEFAULT_STATUS);
  const cols = 11;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('orBase.searchPlaceholder')} className="h-9 pl-9" />
        </div>
        <Select value={ls.status} onValueChange={(v) => setLs({ status: v, page: 1 })}>
          <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('orBase.statusAll')}</SelectItem>
            <SelectItem value="open">{t('orBase.statusOpen')}</SelectItem>
            {OR_ALL_STATUSES.map((s) => <SelectItem key={s} value={s}>{orStatusLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          {t('orBase.periodFrom')}
          <Input type="date" value={ls.from} onChange={(e) => setLs({ from: e.target.value, page: 1 })} className="h-9 w-40" />
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          {t('orBase.periodTo')}
          <Input type="date" value={ls.to} onChange={(e) => setLs({ to: e.target.value, page: 1 })} className="h-9 w-40" />
        </label>
        <Select value={ls.op || ALL} onValueChange={(v) => setLs({ op: v === ALL ? '' : v, page: 1 })}>
          <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('orBase.operatorAll')}</SelectItem>
            {(operatorsQ.data ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={ls.type || ALL} onValueChange={(v) => setLs({ type: v === ALL ? '' : v, page: 1 })}>
          <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('orBase.typeAll')}</SelectItem>
            {(typesQ.data ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => { setText(''); setLs({ q: '', from: '', to: '', op: '', type: '', status: OR_LIST_DEFAULT_STATUS, page: 1 }); }}>
            <X /> {t('orBase.resetFilters')}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="font-data text-[13px] tabular-nums text-muted-foreground">{fillVars(t('orBase.count'), { n: total })}</span>
          <Button variant="outline" size="sm" onClick={() => exportX.mutate()} disabled={exportX.isPending || total === 0}>
            {exportX.isPending ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} {t('orBase.exportExcel')}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('orBase.colNumber')}</Th><Th>{t('orBase.colClient')}</Th><Th>{t('orBase.colVehicle')}</Th>
              <Th>{t('orBase.colReceived')}</Th><Th>{t('orBase.colPromised')}</Th><Th>{t('orBase.colOperator')}</Th>
              <Th className="text-right">{t('orBase.colMileage')}</Th><Th className="text-right">{t('orBase.colAmount')}</Th>
              <Th className="text-right">{t('orBase.colDeposit')}</Th>
              <Th>{t('orBase.colStatus')}</Th>
              <Th>{t('orBase.colWarranty')}</Th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && <tr><td colSpan={cols} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {listQ.error && <tr><td colSpan={cols} className="px-3 py-3 text-danger">{(listQ.error as Error).message}</td></tr>}
            {listQ.data && rows.length === 0 && <tr><td colSpan={cols} className="px-3 py-6 text-center text-muted-foreground">{filtered || view !== 'or' ? t('orBase.empty') : t('workshop.empty')}</td></tr>}
            {rows.map((o) => (
              <tr key={o.id} onClick={() => navigate({ to: '/workshop/$orId', params: { orId: o.id } })} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                <td className="px-3 py-2 font-mono text-[12px]">{o.number ?? '—'}</td>
                <td className="px-3 py-2">{o.client || '—'}</td>
                <td className="px-3 py-2">
                  <div className="leading-tight">
                    <div>{o.vehicleModel ?? '—'}{o.vehicleRef ? <span className="text-muted-foreground"> · {o.vehicleRef}</span> : null}</div>
                    {(o.plate || o.vin) && <div className="font-mono text-[11px] text-muted-foreground">{[o.plate, o.vin].filter(Boolean).join(' · ')}</div>}
                  </div>
                </td>
                <td className="px-3 py-2 tabular-nums">{formatOrDate(o.created_at)}</td>
                <td className="px-3 py-2 tabular-nums">{o.promised_at ? formatOrDate(o.promised_at) : '—'}</td>
                <td className="px-3 py-2">{o.operator || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{o.mileage != null ? o.mileage.toLocaleString('fr-BE') : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(o.total_ttc)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{(depositsQ.data?.get(o.id)?.amount ?? 0) !== 0 ? eur(depositsQ.data!.get(o.id)!.amount) : '—'}</td>
                <td className="px-3 py-2"><OrStatusBadge status={o.status} /></td>
                <td className="px-3 py-2">
                  {o.warranty_status !== 'aucune'
                    ? <WarrantyStatusBadge status={o.warranty_status} />
                    : (o.repair_type ? <span className="text-muted-foreground">{typeLabel(o.repair_type)}</span> : '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setLs({ page: Math.max(1, ls.page - 1) })} disabled={ls.page <= 1}><ChevronLeft /> {t('orBase.prev')}</Button>
          <span className="font-data text-[13px] tabular-nums text-muted-foreground">{fillVars(t('orBase.pageOf'), { p: Math.min(ls.page, pages), t: pages })}</span>
          <Button variant="outline" size="sm" onClick={() => setLs({ page: Math.min(pages, ls.page + 1) })} disabled={ls.page >= pages}>{t('orBase.next')} <ChevronRight /></Button>
        </div>
      )}
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
