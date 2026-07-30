import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { buildExcelWorkbook, type ExcelOrder, type ExcelOrderLine } from '@/modules/orders/excel-api';
import { excelTabsStatus, DEFAULT_THRESHOLDS, type ExcelTab, type ExcelLine } from '@/modules/orders/thresholds';
import { t } from '@/lib/i18n';
import * as XLSX from 'xlsx';

export const Route = createFileRoute('/_app/orders/excel')({
  head: () => ({ meta: [{ title: 'Commande Excel — Ducati Bruxelles' }] }),
  component: ExcelOrderScreen,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const TABS: ExcelTab[] = ['demo', 'courtoisie', 'showroom'];

// Écran de saisie local (démo fonctionnelle) : ajouter des lignes par onglet,
// calcul temps réel du seuil 2000 €/onglet, notification verte, download .xlsx.
// Le branchement DB (excel_orders / excel_order_lines) suit la migration orders.
type DraftLine = { key: string; tab: ExcelTab; reference: string; description: string; qty: number; priceDealer: number; extraDiscount: number };
let dc = 0;

function ExcelOrderScreen() {
  const [activeTab, setActiveTab] = useState<ExcelTab>('demo');
  const [lines, setLines] = useState<DraftLine[]>([]);

  const add = () => setLines((ls) => [...ls, { key: `d${dc++}`, tab: activeTab, reference: '', description: '', qty: 1, priceDealer: 0, extraDiscount: 0.18 }]);
  const patch = (key: string, p: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const status = useMemo(() => excelTabsStatus(lines.map((l): ExcelLine => ({ tab: l.tab, priceDealer: l.priceDealer, qty: l.qty, extraDiscount: l.extraDiscount }))), [lines]);
  const tabLines = lines.filter((l) => l.tab === activeTab);

  const download = () => {
    const order: ExcelOrder = { id: 'draft', company_id: '', part_order_id: null, number: null, status: 'en_cours', dealer_code: '100645', dealer_name: 'Ducati Bruxelles', downloaded_at: null, archived_at: null, archive_path: null };
    const dbLines: ExcelOrderLine[] = lines.map((l, i) => ({ id: l.key, excel_order_id: 'draft', tab: l.tab, reference: l.reference, description: l.description, qty: l.qty, price_dealer: l.priceDealer, extra_discount: l.extraDiscount, moto_label: null, moto_vin: null, contact_id: null, sort_order: i }));
    const wb = buildExcelWorkbook(order, dbLines);
    XLSX.writeFile(wb, `Commande_Ducati_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <>
      <PageHeader
        title={t('orders.excelTitle')}
        description={t('orders.excelSubtitle')}
        breadcrumbs={[{ label: t('orders.title'), to: '/orders' }, { label: t('orders.excelTitle') }]}
        actions={<Button onClick={download} disabled={lines.length === 0}><Download /> {t('orders.excelDownload')}</Button>}
      />

      {/* Onglets + état seuil par onglet */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const st = status[tab];
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

      {/* Notification seuil atteint (verte) */}
      {TABS.filter((tb) => status[tb].reached).map((tb) => (
        <div key={tb} className="mb-2 flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
          <CheckCircle2 className="size-4" /> {t('orders.excelThresholdReached').replace('{tab}', t(`orders.tab_${tb}`)).replace('{min}', eur(DEFAULT_THRESHOLDS.excel.minHtPerTab))}
        </div>
      ))}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('orders.lineRef')}</Th>
              <Th>{t('orders.lineDesignation')}</Th>
              <Th className="text-right">{t('orders.excelQty')}</Th>
              <Th className="text-right">{t('orders.excelPriceDealer')}</Th>
              <Th className="text-right">{t('orders.excelExtra')}</Th>
              <Th className="text-right">{t('orders.excelFinal')}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {tabLines.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{t('orders.excelEmpty')}</td></tr>}
            {tabLines.map((l) => {
              const value = l.priceDealer * l.qty;
              const final = value - value * l.extraDiscount;
              return (
                <tr key={l.key} className="border-b border-border last:border-0">
                  <td className="px-2 py-1"><input value={l.reference} onChange={(e) => patch(l.key, { reference: e.target.value })} className="w-28 rounded border border-border bg-background px-2 py-1 font-mono text-[12px]" /></td>
                  <td className="px-2 py-1"><input value={l.description} onChange={(e) => patch(l.key, { description: e.target.value })} className="w-full rounded border border-border bg-background px-2 py-1" /></td>
                  <td className="px-2 py-1 text-right"><input type="number" value={l.qty} onChange={(e) => patch(l.key, { qty: Number(e.target.value) })} className="w-16 rounded border border-border bg-background px-2 py-1 text-right tabular-nums" /></td>
                  <td className="px-2 py-1 text-right"><input type="number" step="0.01" value={l.priceDealer} onChange={(e) => patch(l.key, { priceDealer: Number(e.target.value) })} className="w-24 rounded border border-border bg-background px-2 py-1 text-right tabular-nums" /></td>
                  <td className="px-2 py-1 text-right"><input type="number" step="0.01" value={l.extraDiscount} onChange={(e) => patch(l.key, { extraDiscount: Number(e.target.value) })} className="w-20 rounded border border-border bg-background px-2 py-1 text-right tabular-nums" /></td>
                  <td className="px-3 py-1 text-right tabular-nums font-bold">{eur(final)}</td>
                  <td className="px-2 py-1 text-right"><button type="button" onClick={() => remove(l.key)} className="text-danger hover:underline">×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={add}>+ {t('orders.excelAddLine')}</Button>
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
