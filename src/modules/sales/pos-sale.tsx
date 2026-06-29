/**
 * M6 (POS) — Vente comptoir (Express) : scan/recherche d'articles → panier →
 * encaissement → ticket. Crée un TIK validé (stock réel débité) puis encaissement
 * via le panneau de règlement, et impression du ticket.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Search, ScanLine, CreditCard, Printer, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createDocument, computeTotals, searchSaleArticles, getDocumentFull, type SaleArticle } from './write-api';
import { PaymentPanel } from './payment-panel';
import { printDocument } from './print-document';
import { effectiveSaleHt, useRoundSalePrices } from '@/lib/pricing';
import { t } from '@/lib/i18n';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

type CartLine = { _key: string; article_id: string | null; designation: string; quantity: number; unit_price_ht: number; vat_rate: number };
let ck = 0;

export function PosSale({ companyId, companyName }: { companyId: string; companyName: string }) {
  const qc = useQueryClient();
  const roundUp = useRoundSalePrices(companyId);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activeDoc, setActiveDoc] = useState<{ id: string; ttc: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = computeTotals(cart.map(({ _key, ...l }) => ({ ...l, discount_pct: 0 })));

  const add = (a: SaleArticle) => setCart((c) => {
    const existing = c.find((l) => l.article_id === a.id);
    if (existing) return c.map((l) => (l.article_id === a.id ? { ...l, quantity: l.quantity + 1 } : l));
    return [...c, { _key: `c${ck++}`, article_id: a.id, designation: a.designation, quantity: 1, unit_price_ht: effectiveSaleHt(a.sale_price_ht, a.vat_rate, roundUp), vat_rate: a.vat_rate }];
  });
  const setQty = (key: string, q: number) => setCart((c) => c.map((l) => (l._key === key ? { ...l, quantity: q } : l)));
  const remove = (key: string) => setCart((c) => c.filter((l) => l._key !== key));

  const checkout = async () => {
    setBusy(true); setError(null);
    try {
      const lines = cart.filter((l) => l.quantity > 0).map(({ _key, ...l }) => ({ ...l, discount_pct: 0 }));
      if (lines.length === 0) { setError(t('pos.cartEmpty')); setBusy(false); return; }
      const id = await createDocument({ companyId, docType: 'TIK', issueDate: new Date().toISOString().slice(0, 10), status: 'validee', lines });
      const tot = computeTotals(lines);
      setActiveDoc({ id, ttc: tot.total_ttc });
    } catch (e) { setError(e instanceof Error ? e.message : t('pos.errSale')); }
    setBusy(false);
  };

  const newSale = () => { setCart([]); setActiveDoc(null); setError(null); qc.invalidateQueries({ queryKey: ['stock', companyId] }); };
  const print = async () => { if (activeDoc) { const full = await getDocumentFull(activeDoc.id); printDocument(full, companyName); } };

  // Encaissement en cours
  if (activeDoc) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t('pos.toCollect')}</p>
          <p className="font-data text-2xl font-bold tabular-nums">{eur(activeDoc.ttc)}</p>
        </div>
        <PaymentPanel documentId={activeDoc.id} companyId={companyId} due={activeDoc.ttc} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={print}><Printer /> {t('pos.printTicket')}</Button>
          <Button onClick={newSale}><RotateCcw /> {t('pos.newSale')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      {/* Panier */}
      <div className="space-y-3">
        <ScanBar companyId={companyId} onAdd={add} />
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr><Th>{t('pos.article')}</Th><Th className="w-24 text-right">{t('pos.qty')}</Th><Th className="w-24 text-right">{t('pos.price')}</Th><Th className="w-24 text-right">{t('pos.total')}</Th><Th className="w-10" /></tr></thead>
            <tbody>
              {cart.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">{t('pos.cartEmpty')}</td></tr>}
              {cart.map((l) => (
                <tr key={l._key} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{l.designation}</td>
                  <td className="px-2 py-1"><Input type="number" step="1" value={String(l.quantity)} onChange={(e) => setQty(l._key, num(e.target.value))} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(l.unit_price_ht * (1 + l.vat_rate / 100))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(l.quantity * l.unit_price_ht * (1 + l.vat_rate / 100))}</td>
                  <td className="px-2 py-1 text-center"><Button size="sm" variant="ghost" onClick={() => remove(l._key)}><Trash2 className="size-4 text-danger" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Total + encaisser */}
      <div className="space-y-3 rounded-md border border-border bg-card p-4">
        <div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">{t('pos.totalHt')}</span><span className="font-data tabular-nums">{eur(totals.total_ht)}</span></div>
        <div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">{t('pos.totalVat')}</span><span className="font-data tabular-nums">{eur(totals.total_vat)}</span></div>
        <div className="flex items-baseline justify-between border-t border-border pt-3"><span className="font-bold">{t('pos.totalTtc')}</span><span className="font-data text-2xl font-bold tabular-nums">{eur(totals.total_ttc)}</span></div>
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Button className="w-full" size="lg" onClick={checkout} disabled={busy || cart.length === 0}>{busy ? <Loader2 className="animate-spin" /> : <CreditCard />} {t('pos.checkout')}</Button>
      </div>
    </div>
  );
}

function ScanBar({ companyId, onAdd }: { companyId: string; onAdd: (a: SaleArticle) => void }) {
  const roundUp = useRoundSalePrices(companyId);
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 200); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({ queryKey: ['pos-art', companyId, deb], queryFn: () => searchSaleArticles(companyId, deb), enabled: deb.length >= 2 });

  // Scan : Entrée → si une seule correspondance, l'ajoute et vide le champ.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && data && data.length >= 1) { onAdd(data[0]); setTerm(''); }
  };
  return (
    <div className="relative">
      <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input ref={inputRef} value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={onKey} placeholder={t('pos.scan')} className="h-11 pl-9 text-base" autoFocus />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.map((a) => (
            <button key={a.id} type="button" onClick={() => { onAdd(a); setTerm(''); inputRef.current?.focus(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
              <Search className="size-4 text-muted-foreground" /><span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span><span className="ml-auto tabular-nums text-muted-foreground">{eur(effectiveSaleHt(a.sale_price_ht, a.vat_rate, roundUp))}</span><Plus className="size-4 text-success" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
