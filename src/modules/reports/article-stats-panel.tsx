/**
 * M13 — Statistiques d'un article sur sa fiche (G8 02-articles.md « Statistiques article ») :
 * onglets Stat. cumulées · Annuelles · N-1 · N-2 ; par mois : quantité, CA HT, marge HT,
 * quantités achetées ; synthèse CA, marge (%), quantités vendue / achetée ; case « Exclure cession ».
 * Données : `article_stats` (migration 20261118181000) ; avoirs déduits, brouillons exclus.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { t, getLocale } from '@/lib/i18n';
import { getArticleStats, isStatsMissing } from './stats-api';
import { articleYear, articleYears, type ArticleMonthStat } from './stats-core';

const fmt2 = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQ = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 3 });
const eur = (n: number) => `${fmt2.format(n)} €`;
const monthName = (m: number) => {
  const s = new Date(2000, m - 1, 1).toLocaleDateString(`${getLocale()}-BE`, { month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * `fallback` : l'ancien affichage, montré tant que la migration n'est pas posée en base.
 */
export function ArticleStatsPanel({ articleId, fallback }: { articleId: string; fallback: ReactNode }) {
  const q = useQuery({ queryKey: ['article-stats', articleId], queryFn: () => getArticleStats(articleId), retry: false });
  const [exclude, setExclude] = useState(false);
  const year = new Date().getFullYear();

  if (q.isLoading) return <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (q.error && isStatsMissing(q.error)) return <>{fallback}</>;
  if (q.error) return <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{q.error instanceof Error ? q.error.message : String(q.error)}</p>;
  const rows = q.data ?? [];
  if (rows.length === 0) return <div className="rounded-md border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">{t('articleStats.empty')}</div>;

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <Checkbox checked={exclude} onCheckedChange={(v) => setExclude(v === true)} /> {t('articleStats.excludeCessions')}
      </label>
      <Tabs defaultValue="year">
        <TabsList>
          <TabsTrigger value="cumul">{t('articleStats.tabCumul')}</TabsTrigger>
          <TabsTrigger value="year">{t('articleStats.tabYear')} {year}</TabsTrigger>
          <TabsTrigger value="n1">{t('articleStats.tabN1')} {year - 1}</TabsTrigger>
          <TabsTrigger value="n2">{t('articleStats.tabN2')} {year - 2}</TabsTrigger>
        </TabsList>
        <TabsContent value="cumul" className="mt-3"><Cumul rows={rows} exclude={exclude} /></TabsContent>
        <TabsContent value="year" className="mt-3"><YearTable rows={rows} year={year} exclude={exclude} /></TabsContent>
        <TabsContent value="n1" className="mt-3"><YearTable rows={rows} year={year - 1} exclude={exclude} /></TabsContent>
        <TabsContent value="n2" className="mt-3"><YearTable rows={rows} year={year - 2} exclude={exclude} /></TabsContent>
      </Tabs>
      <p className="text-[12px] text-muted-foreground">{t('articleStats.hint')}</p>
    </div>
  );
}

function Summary({ qty, ca, margin, qtyBought }: { qty: number; ca: number; margin: number; qtyBought: number }) {
  const cards = [
    { k: t('articleStats.qtySold'), v: fmtQ.format(qty) },
    { k: t('articleStats.revenue'), v: eur(ca) },
    { k: t('articleStats.margin'), v: `${eur(margin)}${ca ? ` (${fmt2.format((100 * margin) / ca)} %)` : ''}` },
    { k: t('articleStats.qtyBought'), v: fmtQ.format(qtyBought) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.k} className="rounded-md border border-border bg-card p-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{c.k}</div>
          <div className="mt-1 font-data text-[18px] font-bold tabular-nums">{c.v}</div>
        </div>
      ))}
    </div>
  );
}

function YearTable({ rows, year, exclude }: { rows: ArticleMonthStat[]; year: number; exclude: boolean }) {
  const months = articleYear(rows, year, exclude);
  const sum = (k: 'qty' | 'ca' | 'margin' | 'qtyBought') => months.reduce((s, m) => s + m[k], 0);
  return (
    <div className="space-y-3">
      <Summary qty={sum('qty')} ca={sum('ca')} margin={sum('margin')} qtyBought={sum('qtyBought')} />
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr>
            <Th>{t('articleStats.month')}</Th><Th className="text-right">{t('articleStats.qtySold')}</Th>
            <Th className="text-right">{t('articleStats.revenue')}</Th><Th className="text-right">{t('articleStats.margin')}</Th>
            <Th className="text-right">{t('articleStats.qtyBought')}</Th>
          </tr></thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5">{monthName(m.month)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{m.qty ? fmtQ.format(m.qty) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{m.ca ? eur(m.ca) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{m.margin ? eur(m.margin) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{m.qtyBought ? fmtQ.format(m.qtyBought) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cumul({ rows, exclude }: { rows: ArticleMonthStat[]; exclude: boolean }) {
  const years = articleYears(rows, exclude);
  return (
    <div className="space-y-3">
      <Summary qty={years.reduce((s, y) => s + y.qty, 0)} ca={years.reduce((s, y) => s + y.ca, 0)}
        margin={years.reduce((s, y) => s + y.margin, 0)} qtyBought={years.reduce((s, y) => s + y.qtyBought, 0)} />
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr>
            <Th>{t('articleStats.year')}</Th><Th className="text-right">{t('articleStats.qtySold')}</Th>
            <Th className="text-right">{t('articleStats.revenue')}</Th><Th className="text-right">{t('articleStats.margin')}</Th>
            <Th className="text-right">{t('articleStats.marginPct')}</Th><Th className="text-right">{t('articleStats.qtyBought')}</Th>
          </tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.year} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5 tabular-nums">{y.year}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtQ.format(y.qty)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{eur(y.ca)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{eur(y.margin)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{y.marginPct === null ? '' : `${fmt2.format(y.marginPct)} %`}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtQ.format(y.qtyBought)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
