/**
 * M8 — Productivité atelier (B11, G8 « Productivité Atelier », 07-atelier §8) : période, cumul par
 * mécanicien / jour / semaine / mois / journée × mécanicien, case « Inclure le temps à facturer »,
 * colonnes présence, passé, facturé, à facturer, non facturé, internes, garanties, improductif,
 * % facturé, rendement production, rendement atelier, % improductif ; ligne Total ; export Excel.
 * Données : `workshop_productivity_detail` (migration 20261118110000) ; calculs : `./rules.ts`.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { getProductivityDetail, labourTimeSchemaReady } from './api';
import {
  PRODUCTIVITY_COLUMNS, productivitySheet, productivityTotal, summarizeProductivity,
  type Granularity, type ProductivityColumn, type ProductivitySummary,
} from './rules';

const GRANULARITIES: Granularity[] = ['mechanic', 'day', 'week', 'month', 'mechanic_day'];
const PCT: ProductivityColumn[] = ['billedPct', 'productionPct', 'efficiencyPct', 'improductivePct'];

const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const todayIso = () => new Date().toISOString().slice(0, 10);
const fmt = (c: ProductivityColumn, v: number | null) => {
  if (v === null) return '—';
  const s = String(Math.round(v * 100) / 100).replace('.', ',');
  return PCT.includes(c) ? `${s} %` : s;
};

export function ProductivityPanel({ companyId }: { companyId: string }) {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayIso);
  const [by, setBy] = useState<Granularity>('mechanic');
  const [includeToBill, setIncludeToBill] = useState(false);
  const schema = useQuery({ queryKey: ['labour-time-schema'], queryFn: labourTimeSchemaReady, staleTime: Infinity });
  const q = useQuery({
    queryKey: ['workshop-productivity-detail', companyId, from, to],
    queryFn: () => getProductivityDetail(companyId, from, to),
    enabled: schema.data === true && !!from && !!to,
  });
  const unassigned = t('labourTime.unassigned');
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const summaries = useMemo(() => summarizeProductivity(rows, { by, includeToBill, unassignedLabel: unassigned }), [rows, by, includeToBill, unassigned]);
  const total = useMemo(() => productivityTotal(rows, includeToBill, t('labourTime.total')), [rows, includeToBill]);
  const groupLabel = t(`labourTime.by_${by}`);

  const exportXlsx = () => {
    const columns = Object.fromEntries(PRODUCTIVITY_COLUMNS.map((c) => [c, t(`labourTime.col_${c}`)])) as Record<ProductivityColumn, string>;
    const wb = XLSX.utils.book_new();
    const sheet = (s: ProductivitySummary[], label: string) => XLSX.utils.aoa_to_sheet(productivitySheet(s, total, { label, columns }));
    XLSX.utils.book_append_sheet(wb, sheet(summaries, groupLabel), t('labourTime.sheetSummary').slice(0, 31));
    // Détail par journée et par mécanicien (G8 « Détail par journée/mécanicien »), toujours joint.
    const detail = summarizeProductivity(rows, { by: 'mechanic_day', includeToBill, unassignedLabel: unassigned });
    XLSX.utils.book_append_sheet(wb, sheet(detail, t('labourTime.by_mechanic_day')), t('labourTime.sheetDetail').slice(0, 31));
    XLSX.writeFile(wb, `productivite-atelier-${from}-${to}.xlsx`);
  };

  if (schema.data === false) {
    return <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('labourTime.migrationMissing')}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-4">
        <div className="space-y-1"><Label>{t('labourTime.from')}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div className="space-y-1"><Label>{t('labourTime.to')}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div className="space-y-1">
          <Label>{t('labourTime.groupBy')}</Label>
          <Select value={by} onValueChange={(v) => setBy(v as Granularity)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{GRANULARITIES.map((g) => <SelectItem key={g} value={g}>{t(`labourTime.by_${g}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <Checkbox checked={includeToBill} onCheckedChange={(v) => setIncludeToBill(v === true)} /> {t('labourTime.includeToBill')}
        </label>
        <Button variant="outline" className="ml-auto" onClick={exportXlsx} disabled={!rows.length}><Download /> {t('labourTime.exportExcel')}</Button>
      </div>

      {q.isLoading ? (
        <div className="grid place-items-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : q.error ? (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{q.error instanceof Error ? q.error.message : t('workshop.errSave')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr>
              <Th>{groupLabel}</Th>
              {PRODUCTIVITY_COLUMNS.map((c) => <Th key={c} className="text-right" title={t(`labourTime.hint_${c}`)}>{t(`labourTime.col_${c}`)}</Th>)}
            </tr></thead>
            <tbody>
              {summaries.length === 0 && <tr><td colSpan={1 + PRODUCTIVITY_COLUMNS.length} className="px-3 py-4 text-center text-muted-foreground">{t('labourTime.noData')}</td></tr>}
              {summaries.map((s) => <Row key={s.key} s={s} />)}
              {summaries.length > 0 && <Row s={total} strong />}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] text-muted-foreground">{t('labourTime.productivityLegend')}</p>
    </div>
  );
}

function Row({ s, strong = false }: { s: ProductivitySummary; strong?: boolean }) {
  return (
    <tr className={`border-b border-border last:border-0 ${strong ? 'bg-muted font-bold' : ''}`}>
      <td className="px-3 py-1.5">{s.label}</td>
      {PRODUCTIVITY_COLUMNS.map((c) => <td key={c} className="px-3 py-1.5 text-right tabular-nums">{fmt(c, s[c])}</td>)}
    </tr>
  );
}
function Th({ children, className = '', title }: { children?: React.ReactNode; className?: string; title?: string }) {
  return <th title={title} className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
