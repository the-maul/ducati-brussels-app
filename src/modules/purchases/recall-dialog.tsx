/**
 * M4 — « Rappel cde » (G8) : choisir une ou plusieurs commandes du fournisseur (ou une proposition pour une
 * commande) et reprendre leurs lignes restant à recevoir. La quantité reprise = le reste ; l'utilisateur la
 * baisse pour une réception partielle (le reliquat reste en commande).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { listOpenLines, type OpenLine } from './g8-api';
import { purchaseStatusTone } from './g8-rules';
import { t, fillVars } from '@/lib/i18n';

const qtyFmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

export function RecallDialog({ companyId, supplierId, docType, alreadyIds, onClose, onPick }: {
  companyId: string; supplierId: string; docType: 'CMD' | 'PCF'; alreadyIds: string[];
  onClose: () => void; onPick: (lines: OpenLine[]) => void;
}) {
  const q = useQuery({ queryKey: ['open-lines', companyId, supplierId, docType], queryFn: () => listOpenLines(companyId, supplierId, docType) });
  const rows = useMemo(() => (q.data ?? []).filter((l) => l.remaining > 0 && !alreadyIds.includes(l.line_id)), [q.data, alreadyIds]);
  const orders = useMemo(() => {
    const m = new Map<string, { id: string; number: string | null; date: string | null; status: string; type: string | null; lines: OpenLine[] }>();
    for (const l of rows) {
      if (!m.has(l.order_id)) m.set(l.order_id, { id: l.order_id, number: l.order_number, date: l.order_date, status: l.order_status, type: l.order_type, lines: [] });
      m.get(l.order_id)!.lines.push(l);
    }
    return [...m.values()];
  }, [rows]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{docType === 'CMD' ? t('purchasesG8.recallOrder') : t('purchasesG8.recallProposal')}</DialogTitle></DialogHeader>
        <p className="text-[12px] text-muted-foreground">{docType === 'CMD' ? t('purchasesG8.recallHint') : t('purchasesG8.recallProposalHint')}</p>
        {q.isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
        {q.error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(q.error as Error).message}</p>}
        {!q.isLoading && orders.length === 0 && <p className="py-4 text-center text-[13px] text-muted-foreground">{t('purchasesG8.recallEmpty')}</p>}
        <div className="max-h-[60vh] space-y-3 overflow-auto">
          {orders.map((o) => (
            <label key={o.id} className="block cursor-pointer rounded-md border border-border p-3 hover:bg-accent">
              <div className="flex flex-wrap items-center gap-3">
                <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} className="size-4 accent-[var(--ducati-red)]" />
                <span className="font-mono text-[13px] font-bold">{o.number ?? '—'}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{o.date ?? ''}</span>
                <StatusBadge tone={purchaseStatusTone(o.status)} label={t(`purchases.status_${o.status}`)} />
                {o.type && <span className="text-[12px] text-muted-foreground">{t(`purchasesG8.orderType_${o.type}`)}</span>}
                <span className="ml-auto text-[12px] text-muted-foreground">{fillVars(t('purchasesG8.linesLeft'), { n: o.lines.length })}</span>
              </div>
              <table className="mt-2 w-full font-data text-[12px]">
                <tbody>
                  {o.lines.map((l) => (
                    <tr key={l.line_id} className="border-t border-border">
                      <td className="py-1 pr-2 font-mono">{l.reference ?? ''}</td>
                      <td className="py-1 pr-2">{l.designation}{l.contact_name ? <span className="text-muted-foreground"> — {l.contact_name}</span> : null}</td>
                      <td className="py-1 text-right tabular-nums">{fillVars(t('purchasesG8.orderedReceived'), { ordered: qtyFmt(l.quantity), received: qtyFmt(l.received), remaining: qtyFmt(l.remaining) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button disabled={sel.size === 0} onClick={() => onPick(rows.filter((l) => sel.has(l.order_id)))}>{t('purchasesG8.recallDo')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
