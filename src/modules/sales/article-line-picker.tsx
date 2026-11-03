/**
 * Recherche d'article d'une ligne — UN SEUL composant pour l'OR, le check-up et les documents de
 * vente (retour client du 03/11/2026, ATE001b).
 *
 * Avant : la liste des propositions etait un bloc `absolute` dans le tableau des lignes, coupee par
 * le conteneur (`overflow-x-auto`) : on ne voyait que 2 propositions et il fallait faire defiler.
 * Maintenant : liste en surcouche (Popover de `src/components/ui/`, rendue dans un portail, donc
 * au-dessus de tout), navigation clavier (fleches, Entree, Echap), 20 resultats classes par la
 * recherche (`searchSaleArticles` : reference exacte d'abord, en stock d'abord), stock, casier et
 * PV HT affiches.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Repeat } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils';
import { effectiveSaleHt, useRoundSalePrices } from '@/lib/pricing';
import { t } from '@/lib/i18n';
import { searchSaleArticles, type SaleArticle } from './write-api';
import { saleStockStatus } from './availability';
import { SaleStockBadge } from './availability-badge';
import { SupplyStateBadge } from '@/modules/articles/supply-badge';

import { moveActive } from './article-line-pick';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

export function ArticleLinePicker({ companyId, value, onText, onPick, placeholder, className = 'h-8', autoFocus }: {
  companyId: string;
  value: string;
  onText: (v: string) => void;
  onPick: (a: SaleArticle) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const roundUp = useRoundSalePrices(companyId);
  const [deb, setDeb] = useState('');
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const id = setTimeout(() => setDeb(value.trim()), 250); return () => clearTimeout(id); }, [value]);
  const q = useQuery({
    queryKey: ['line-article', companyId, deb],
    queryFn: () => searchSaleArticles(companyId, deb),
    enabled: deb.length >= 2, staleTime: 30_000,
  });
  const hits = deb.length >= 2 ? (q.data ?? []) : [];
  useEffect(() => { setActive(-1); }, [deb]);
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const open = focused && !dismissed && deb.length >= 2 && (q.isFetching || q.isFetched);
  const pick = (a: SaleArticle) => { onPick(a); setDismissed(true); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setDismissed(false);
      setActive((i) => moveActive(i, e.key === 'ArrowDown' ? 1 : -1, hits.length));
    } else if (e.key === 'Enter' && open && active >= 0 && hits[active]) {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setDismissed(true);
    }
  };

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <div className="relative w-full">
          <Input
            value={value} autoFocus={autoFocus}
            onChange={(e) => { setDismissed(false); onText(e.target.value); }}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={onKeyDown}
            placeholder={placeholder ?? t('articlePick.placeholder')} className={className}
            role="combobox" aria-expanded={open} aria-autocomplete="list"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start" sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}
        className="w-[min(640px,calc(100vw-2rem))] min-w-[var(--radix-popover-trigger-width)] p-0"
      >
        <div ref={listRef} role="listbox" onMouseDown={(e) => e.preventDefault()} className="max-h-80 overflow-auto">
          {q.isFetching && hits.length === 0 && (
            <p className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {t('articlePick.searching')}</p>
          )}
          {!q.isFetching && hits.length === 0 && (
            <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('articlePick.none').replace('{term}', deb)}</p>
          )}
          {hits.map((a, i) => (
            <button
              key={a.id} type="button" role="option" aria-selected={i === active} data-idx={i}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(a)} onMouseEnter={() => setActive(i)}
              title={t('availability.stockHint').replace('{free}', String(a.real_qty - a.reserved_qty)).replace('{real}', String(a.real_qty)).replace('{reserved}', String(a.reserved_qty)).replace('{order}', String(a.on_order_qty))}
              className={cn('flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-0', i === active ? 'bg-accent' : 'hover:bg-accent')}
            >
              <span className="w-28 shrink-0 truncate font-mono text-[12px]">{a.reference}</span>
              <span className="min-w-0 flex-1 truncate">{a.designation}</span>
              <span className="flex shrink-0 items-center gap-2">
                {a.bin_location && <span className="font-data text-[11px] text-muted-foreground">{a.bin_location}</span>}
                {a.superseded_by_id && <StatusBadge tone="warning" icon={Repeat} label={t('sales.replacedBadge')} />}
                {!(a.superseded_by_id && a.supplier_availability === 'yellow') && <SupplyStateBadge availability={a.supplier_availability} />}
                <SaleStockBadge status={saleStockStatus(a)} free={a.real_qty - a.reserved_qty} />
                <span className="w-20 text-right tabular-nums text-muted-foreground">{eur(effectiveSaleHt(a.sale_price_ht, a.vat_rate, roundUp))}</span>
              </span>
            </button>
          ))}
        </div>
        {hits.length > 0 && <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">{t('articlePick.keyboardHint')}</p>}
      </PopoverContent>
    </Popover>
  );
}
