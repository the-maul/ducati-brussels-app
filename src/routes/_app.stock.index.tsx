import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ClipboardList, History, Gift } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { listStock, listStockHistory, type StockRow } from '@/modules/stock/stock-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/stock/')({
  head: () => ({ meta: [{ title: 'Stock & inventaire — Ducati Bruxelles' }] }),
  component: StockList,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

function StockList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [onlyStocked, setOnlyStocked] = useState(false);
  const [belowMin, setBelowMin] = useState(false);
  const [histo, setHisto] = useState<StockRow | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['stock', activeCompanyId], queryFn: () => listStock(activeCompanyId!), enabled: !!activeCompanyId });

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (data ?? []).filter((r) => {
      if (onlyStocked && Math.abs(r.real_qty) < 0.0001) return false;
      if (belowMin && !(r.stock_min > 0 && r.available_qty < r.stock_min)) return false;
      if (q && !(`${r.reference} ${r.designation} ${r.bin_location ?? ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, term, onlyStocked, belowMin]);

  const totalValue = useMemo(() => filtered.reduce((s, r) => s + r.stock_value, 0), [filtered]);

  return (
    <>
      <PageHeader
        title={t('stock.title')}
        description={t('stock.subtitle')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/stock/cessions' })}><Gift /> {t('stock.cessions')}</Button>
            <Button onClick={() => navigate({ to: '/stock/inventory' })}><ClipboardList /> {t('stock.inventory')}</Button>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('stock.search')} className="max-w-sm" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={onlyStocked} onChange={(e) => setOnlyStocked(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('stock.onlyStocked')}</label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={belowMin} onChange={(e) => setBelowMin(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('stock.belowMin')}</label>
        <span className="ml-auto font-data text-sm tabular-nums">{t('stock.totalValue')} : <b>{eur(totalValue)}</b></span>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr><Th>{t('stock.colRef')}</Th><Th>{t('stock.colDesignation')}</Th><Th>{t('stock.colBin')}</Th><Th className="text-right">{t('stock.colReal')}</Th><Th className="text-right">{t('stock.colReserved')}</Th><Th className="text-right">{t('stock.colAvailable')}</Th><Th className="text-right">{t('stock.colPamp')}</Th><Th className="text-right">{t('stock.colValue')}</Th><Th className="w-10" /></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={9} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && filtered.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">{t('stock.empty')}</td></tr>}
            {filtered.map((r) => {
              const low = r.stock_min > 0 && r.available_qty < r.stock_min;
              return (
                <tr key={r.article_id} className="border-b border-border last:border-0 hover:bg-accent">
                  <td className="px-3 py-2 font-mono text-[12px]">{r.reference}</td>
                  <td className="px-3 py-2">{r.designation}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.bin_location ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.real_qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.reserved_qty || ''}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${low ? 'font-bold text-danger' : ''}`}>{r.available_qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.pamp)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.stock_value)}</td>
                  <td className="px-2 py-1 text-center"><Button size="sm" variant="ghost" title={t('stock.history')} onClick={() => setHisto(r)}><History className="size-4 text-muted-foreground" /></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {histo && <HistoryDialog row={histo} onClose={() => setHisto(null)} />}
    </>
  );
}

function HistoryDialog({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['stock-history', row.article_id], queryFn: () => listStockHistory(row.article_id) });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{t('stock.historyOf').replace('{ref}', row.reference)}</DialogTitle></DialogHeader>
        {isLoading ? <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : (
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted sticky top-0"><tr><Th>{t('stock.colDate')}</Th><Th>{t('stock.colType')}</Th><Th className="text-right">{t('stock.colQty')}</Th><Th>{t('stock.colOrigin')}</Th><Th>{t('stock.colRefDoc')}</Th></tr></thead>
              <tbody>
                {(data ?? []).length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">{t('stock.noHistory')}</td></tr>}
                {(data ?? []).map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5 font-mono text-[12px]">{new Date(m.occurred_at).toLocaleString('fr-BE')}</td>
                    <td className="px-3 py-1.5">{m.move_type}{m.is_reservation ? ' (rés.)' : ''}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${Number(m.qty_delta) < 0 ? 'text-danger' : ''}`}>{Number(m.qty_delta) > 0 ? '+' : ''}{Number(m.qty_delta)}</td>
                    <td className="px-3 py-1.5">{m.origin}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{m.ref ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
