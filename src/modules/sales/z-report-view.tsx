/**
 * M6 (POS) — Affichage d'un rapport X (session ouverte) ou d'un journal Z figé (PDV010) :
 * documents, ventilation TVA, remises, remboursements, CA net TVAC, encaissements par mode,
 * lignes distinctes des ventes > 500 EUR TTC, espèces (fond, théorique, compté, écart, motif).
 * Ne recalcule rien : affiche le JSON de la base (`parseZReport`).
 */
import { StatusBadge } from '@/components/status-badge';
import { Lock, Clock } from 'lucide-react';
import { t, fillVars } from '@/lib/i18n';
import type { ZReport } from './z-report';

const eur = (n: number | null | undefined) => (n == null ? '—' : `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`);
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('fr-BE') : '—');

export function ZReportView({ z, showCash = false }: { z: ZReport; showCash?: boolean }) {
  const vatTotal = z.vat_breakdown.reduce((a, v) => ({ b: a.b + v.base_ht, v: a.v + v.vat, t: a.t + v.ttc }), { b: 0, v: 0, t: 0 });
  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
          {z.number ? fillVars(t('cash.zTitle'), { number: z.number }) : t('cash.xReport')}
        </p>
        {z.number
          ? <StatusBadge tone="neutral" icon={Lock} label={t('cash.zFrozen')} />
          : <StatusBadge tone="info" icon={Clock} label={t('cash.xProvisional')} />}
        <span className="font-data text-[12px] text-muted-foreground">{t('cash.register')} {z.register_code} · {when(z.opened_at)} → {when(z.closed_at)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={t('cash.ticketCount')} value={String(z.ticket_count)} />
        <Kpi label={t('cash.discounts')} value={eur(z.discounts_ht)} />
        <Kpi label={t('cash.refundsTtc')} value={eur(z.refunds_ttc)} />
        <Kpi label={t('cash.netSales')} value={eur(z.net_sales_ttc)} strong />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-[12px] font-bold">{t('cash.byMethod')}</p>
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr><Th>{t('cash.method')}</Th><Th className="text-right">{t('cash.sales')}</Th><Th className="text-right">{t('cash.deposits')}</Th><Th className="text-right">{t('cash.refunds')}</Th><Th className="text-right">{t('cash.total')}</Th></tr></thead>
            <tbody>
              {z.payments_by_method.map((p) => (
                <tr key={p.method} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5">{p.label}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(p.sales)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(p.deposits)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(p.refunds)}</td>
                  <td className="px-2 py-1.5 text-right font-bold tabular-nums">{eur(p.total)}</td>
                </tr>
              ))}
              {z.payments_by_method.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">—</td></tr>}
            </tbody>
          </table>
          <div className="mt-2 flex justify-between font-data text-[13px] tabular-nums text-muted-foreground">
            <span>{t('cash.cashIn')} : {eur(z.cash_in)}</span><span>{t('cash.cashOut')} : {eur(z.cash_out)}</span>
          </div>
        </div>
        <div>
          <p className="mb-1 text-[12px] font-bold">{t('cash.vat')}</p>
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr><Th className="text-right">{t('cash.vatRate')}</Th><Th className="text-right">{t('cash.baseHt')}</Th><Th className="text-right">{t('cash.vatAmount')}</Th><Th className="text-right">{t('cash.ttc')}</Th></tr></thead>
            <tbody>
              {z.vat_breakdown.map((v) => (
                <tr key={v.vat_rate} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5 text-right tabular-nums">{v.vat_rate}%</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(v.base_ht)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(v.vat)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(v.ttc)}</td>
                </tr>
              ))}
              {z.vat_breakdown.length === 0
                ? <tr><td colSpan={4} className="px-2 py-3 text-center text-muted-foreground">—</td></tr>
                : <tr className="font-bold"><td className="px-2 py-1.5 text-right">{t('cash.total')}</td><td className="px-2 py-1.5 text-right tabular-nums">{eur(vatTotal.b)}</td><td className="px-2 py-1.5 text-right tabular-nums">{eur(vatTotal.v)}</td><td className="px-2 py-1.5 text-right tabular-nums">{eur(vatTotal.t)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[12px] font-bold">{t('cash.largeItems')}</p>
        {z.large_items.length === 0 ? <p className="text-[13px] text-muted-foreground">{t('cash.noLargeItems')}</p> : (
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr><Th>{t('cash.zDocNumber')}</Th><Th>{t('pos.article')}</Th><Th className="text-right">{t('pos.qty')}</Th><Th className="text-right">{t('cash.ttc')}</Th></tr></thead>
            <tbody>
              {z.large_items.map((l, i) => (
                <tr key={`${l.number}-${i}`} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5">{l.number ?? '—'}</td>
                  <td className="px-2 py-1.5">{l.designation}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(l.line_ttc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCash && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-data text-[13px] tabular-nums sm:max-w-md">
          <dt className="text-muted-foreground">{t('cash.openingFloat')}</dt><dd className="text-right">{eur(z.opening_float)}</dd>
          <dt className="text-muted-foreground">{t('cash.theoretical')}</dt><dd className="text-right">{eur(z.expected_cash)}</dd>
          <dt className="text-muted-foreground">{t('cash.countedCash')}</dt><dd className="text-right">{eur(z.counted_cash)}</dd>
          <dt className="text-muted-foreground">{t('cash.variance')}</dt><dd className={`text-right ${Math.abs(z.variance ?? 0) > 0.005 ? 'text-danger' : 'text-success'}`}>{eur(z.variance)}</dd>
          {z.variance_reason && <><dt className="text-muted-foreground">{t('cash.varianceReason')}</dt><dd className="text-right">{z.variance_reason}</dd></>}
        </dl>
      )}
    </div>
  );
}

function Kpi({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
      <p className={`font-data tabular-nums ${strong ? 'text-lg font-bold' : 'text-sm'}`}>{value}</p>
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-2 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
