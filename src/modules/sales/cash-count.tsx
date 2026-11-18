/**
 * M6 (POS) — Calcul monnaie (G8 : Journal de caisse › mode « Calcul monnaie », rattrapage G8 du 18/11/2026).
 * Comptage par pièce / billet de 0,01 € à 500 € : valeur faciale × quantité = sous-total, total espèces,
 * comparé au solde théorique (caisse ouverte : théorique du Z ; caisse fermée : espèces du tiroir =
 * fond proposé à la prochaine ouverture). Grille réutilisée par la clôture Z et la remise en banque.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { getOpenSession, getSessionReport, listSessionMovements } from './cash-api';
import { getDrawerBalance } from './cash-deposit-api';
import { expectedCash, cashVariance } from './cash-rules';
import { buildJournalsPdf, formatCell } from './cash-journals-export';
import { openPdfBytes } from './z-report-pdf';
import type { Journal, JournalRow } from './cash-journals';

/** Coupures en euros, de la plus grande à la plus petite. */
export const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const eur = (n: number) => `${formatCell(n, 'money')} €`;

/** Total compté (au cent) et quantités retenues (> 0) d'un comptage. */
export function countTotal(qtys: Record<string, string>): { total: number; denominations: Record<string, number> } {
  const denominations: Record<string, number> = {};
  let cents = 0;
  for (const d of DENOMS) {
    const q = Math.max(0, Math.floor(num(qtys[String(d)] ?? '')));
    if (q > 0) { denominations[String(d)] = q; cents += Math.round(d * 100) * q; }
  }
  return { total: cents / 100, denominations };
}

/** Grille de comptage (contrôlée). */
export function CashCountGrid({ qtys, onChange, showSubtotals = false }: { qtys: Record<string, string>; onChange: (q: Record<string, string>) => void; showSubtotals?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {DENOMS.map((d) => {
        const q = qtys[String(d)] ?? '';
        return (
          <div key={d} className="flex items-center gap-2">
            <span className="w-14 text-right font-data text-[13px] tabular-nums text-muted-foreground">{eur(d)}</span>
            <Input type="number" min="0" step="1" value={q} onChange={(e) => onChange({ ...qtys, [String(d)]: e.target.value })} className="h-8 w-16 text-right tabular-nums" placeholder="0" aria-label={`${t('cash.denomination')} ${eur(d)}`} />
            {showSubtotals && <span className="font-data text-[12px] tabular-nums text-muted-foreground">{num(q) > 0 ? eur(Math.round(d * 100) * Math.floor(num(q)) / 100) : ''}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Onglet « Calcul monnaie » : comptage libre, comparaison au théorique, impression. */
export function CashCountScreen({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { data: theo } = useQuery({
    queryKey: ['cash-count-theoretical', companyId],
    queryFn: async (): Promise<{ amount: number | null; source: 'session' | 'drawer' | 'none' }> => {
      const s = await getOpenSession(companyId);
      if (s) {
        const now = new Date().toISOString();
        const [z, movements] = await Promise.all([getSessionReport(s), listSessionMovements(companyId, s.opened_at, now)]);
        return { amount: expectedCash(Number(s.opening_float), z, movements), source: 'session' };
      }
      const b = await getDrawerBalance(companyId);
      return b == null ? { amount: null, source: 'none' } : { amount: b, source: 'drawer' };
    },
  });
  const { total, denominations } = countTotal(qtys);
  const variance = theo?.amount == null ? null : cashVariance(total, theo.amount);

  const print = async () => {
    setError(null);
    const rows: JournalRow[] = DENOMS.filter((d) => denominations[String(d)]).map((d) => ({ cells: [d, denominations[String(d)], Math.round(d * 100) * denominations[String(d)] / 100] }));
    rows.push({ cells: [null, null, total], tone: 'total' });
    const summary: JournalRow[] = [{ cells: [t('cashCount.totalCash'), total] }];
    if (theo?.amount != null) summary.push({ cells: [t(`cashCount.theo_${theo.source}`), theo.amount] }, { cells: [t('cash.variance'), variance] });
    const j: Journal = {
      id: 'cashCount', title: t('cashCount.title'), notes: [],
      sections: [
        { columns: [{ label: t('cash.denomination'), kind: 'money' }, { label: t('cash.qty'), kind: 'number' }, { label: t('cashCount.subtotal'), kind: 'money' }], rows },
        { columns: [{ label: t('cashCount.summary'), kind: 'text' }, { label: t('cash.amount'), kind: 'money' }], rows: summary },
      ],
    };
    try { openPdfBytes(await buildJournalsPdf([j], { companyName, period: new Date().toLocaleString('fr-BE') })); } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <div className="max-w-4xl space-y-4 rounded-md border border-border bg-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('cashCount.title')}</p>
      <p className="text-[13px] text-muted-foreground">{t('cashCount.hint')}</p>
      <CashCountGrid qtys={qtys} onChange={setQtys} showSubtotals />
      <div className="flex flex-col items-end gap-1 font-data text-sm tabular-nums">
        <span>{t('cashCount.totalCash')} : <b>{eur(total)}</b></span>
        {theo?.amount != null && <span>{t(`cashCount.theo_${theo.source}`)} : {eur(theo.amount)}</span>}
        {variance != null && <span className={Math.abs(variance) > 0.004 ? 'text-danger' : 'text-success'}>{t('cash.variance')} : <b>{variance >= 0 ? '+' : '−'} {eur(Math.abs(variance))}</b></span>}
        {theo?.source === 'none' && <span className="text-[12px] text-muted-foreground">{t('cashCount.noTheoretical')}</span>}
      </div>
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setQtys({})}><RotateCcw /> {t('cashCount.reset')}</Button>
        <Button variant="outline" onClick={print} disabled={total === 0}><Printer /> {t('cashCount.print')}</Button>
      </div>
    </div>
  );
}
