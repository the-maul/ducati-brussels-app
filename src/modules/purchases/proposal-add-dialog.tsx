/**
 * M4 — « Mise en proposition de commande » (G8 « Prop. commande », parcours 26) depuis un article, une vente
 * ou un OR : type de commande Stock / Dépannage / Garantie, quantité (arrondie au conditionnement d'achat),
 * fournisseur. Les lignes rejoignent la proposition (PCF) en brouillon du fournisseur et du type, à revoir puis
 * valider dans Achats, puis à passer en commande. Le circuit « commandes de pièces » (urgente / standard)
 * reste inchangé à côté.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listSuppliers, supplierName } from './api';
import { addToProposal } from './g8-api';
import { PURCHASE_ORDER_TYPES, roundToPack, type PurchaseOrderType } from './g8-rules';
import { t, fillVars } from '@/lib/i18n';

const sb = supabase as unknown as { from: (t: string) => any };
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

type SourceKind = 'article' | 'document' | 'repair_order';
type Item = { article_id: string; reference: string; designation: string; qty: string; supplier_id: string | null; pack_qty: number; contact_id: string | null; selected: boolean };

async function loadItems(kind: SourceKind, id: string): Promise<{ items: Item[]; ref: string | null }> {
  const art = 'id, reference, designation, main_supplier_id, pack_qty';
  const mk = (a: Record<string, any>, qty: number, contact: string | null): Item => ({
    article_id: a.id, reference: a.reference, designation: a.designation, supplier_id: a.main_supplier_id ?? null,
    pack_qty: Number(a.pack_qty) || 1, qty: String(roundToPack(Math.max(qty, 1), Number(a.pack_qty) || 1)), contact_id: contact, selected: true,
  });
  if (kind === 'article') {
    const { data, error } = await sb.from('articles').select(art).eq('id', id).single();
    if (error) throw error;
    return { items: [mk(data, 1, null)], ref: data.reference };
  }
  if (kind === 'document') {
    const [{ data: d, error: de }, { data: ls, error: le }] = await Promise.all([
      sb.from('documents').select('id, number, contact_id').eq('id', id).single(),
      sb.from('document_lines').select(`quantity, article_id, articles(${art}, mgmt_type)`).eq('document_id', id).not('article_id', 'is', null).order('sort_order'),
    ]);
    if (de) throw de; if (le) throw le;
    const items = ((ls ?? []) as Record<string, any>[])
      .filter((l) => l.articles && ['A', 'N'].includes(String(l.articles.mgmt_type)) && Number(l.quantity) > 0)
      .map((l) => mk(l.articles, Number(l.quantity), d.contact_id ?? null));
    return { items, ref: d.number };
  }
  const [{ data: ro, error: re }, { data: ls, error: le }] = await Promise.all([
    sb.from('repair_orders').select('id, number, contact_id').eq('id', id).single(),
    sb.from('repair_order_lines').select(`quantity, article_id, articles(${art}, mgmt_type)`).eq('or_id', id).not('article_id', 'is', null).order('sort_order'),
  ]);
  if (re) throw re; if (le) throw le;
  const items = ((ls ?? []) as Record<string, any>[])
    .filter((l) => l.articles && ['A', 'N'].includes(String(l.articles.mgmt_type)) && Number(l.quantity) > 0)
    .map((l) => mk(l.articles, Number(l.quantity), ro.contact_id ?? null));
  return { items, ref: ro.number };
}

/** Bouton + fenêtre, à poser sur la fiche article, un document de vente ou un OR. */
export function ProposalAddButton({ companyId, kind, sourceId, variant = 'outline' }: {
  companyId: string | null | undefined; kind: SourceKind; sourceId: string; variant?: 'outline' | 'ghost';
}) {
  const [open, setOpen] = useState(false);
  if (!companyId) return null;
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}><ClipboardList /> {t('purchasesG8.propButton')}</Button>
      {open && <ProposalAddDialog companyId={companyId} kind={kind} sourceId={sourceId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ProposalAddDialog({ companyId, kind, sourceId, onClose }: { companyId: string; kind: SourceKind; sourceId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [orderType, setOrderType] = useState<PurchaseOrderType>(kind === 'article' ? 'stock' : 'depannage');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['proposal-source', kind, sourceId], queryFn: () => loadItems(kind, sourceId) });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers-all', companyId], queryFn: () => listSuppliers(companyId, '', 500) });
  useEffect(() => { if (q.data) setItems(q.data.items); }, [q.data]);
  const set = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const chosen = items.filter((x) => x.selected && num(x.qty) > 0);
      if (!chosen.length) { setError(t('purchasesG8.propNothing')); setBusy(false); return; }
      const res = await addToProposal({
        companyId, orderType, originKind: kind, originId: sourceId, originRef: q.data?.ref ?? null,
        items: chosen.map((x) => ({ article_id: x.article_id, qty: num(x.qty), supplier_id: x.supplier_id, contact_id: orderType === 'stock' ? null : x.contact_id })),
      });
      const first = res.items[0]?.proposal_id;
      toast.success(fillVars(t('purchasesG8.propDone'), { n: res.items.length }), first ? {
        action: { label: t('purchasesG8.propOpen'), onClick: () => navigate({ to: '/purchases/$orderId', params: { orderId: first }, search: {} }) },
      } : undefined);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : t('purchases.errSave')); setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{t('purchasesG8.propTitle')}</DialogTitle></DialogHeader>
        <p className="text-[12px] text-muted-foreground">{t('purchasesG8.propHint')}</p>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">{t('purchasesG8.orderType')}</span>
          <Select value={orderType} onValueChange={(v) => setOrderType(v as PurchaseOrderType)}>
            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{PURCHASE_ORDER_TYPES.map((o) => <SelectItem key={o} value={o}>{t(`purchasesG8.orderType_${o}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {q.isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
        {q.error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(q.error as Error).message}</p>}
        {q.data && items.length === 0 && <p className="py-4 text-center text-[13px] text-muted-foreground">{t('purchasesG8.propNoArticle')}</p>}
        {items.length > 0 && (
          <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted">
                <tr>
                  {['', t('purchasesG8.colRef'), t('purchases.colQty'), t('purchases.colSupplier')].map((h, i) => (
                    <th key={i} className="px-2 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((x, i) => (
                  <tr key={`${x.article_id}-${i}`} className="border-t border-border">
                    <td className="px-2 py-1"><input type="checkbox" checked={x.selected} onChange={(e) => set(i, { selected: e.target.checked })} className="size-4 accent-[var(--ducati-red)]" /></td>
                    <td className="px-2 py-1"><span className="font-mono text-[12px]">{x.reference}</span><span className="block text-[12px] text-muted-foreground">{x.designation}</span>
                      {x.pack_qty > 1 && <span className="text-[11px] text-muted-foreground">{fillVars(t('purchasesG8.pack'), { n: x.pack_qty })}</span>}</td>
                    <td className="w-24 px-2 py-1"><Input value={x.qty} onChange={(e) => set(i, { qty: e.target.value })} onBlur={() => set(i, { qty: String(roundToPack(num(x.qty), x.pack_qty)) })} className="h-8 text-right tabular-nums" /></td>
                    <td className="w-64 px-2 py-1">
                      <Select value={x.supplier_id ?? 'none'} onValueChange={(v) => set(i, { supplier_id: v === 'none' ? null : v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('proposal.chooseSupplier')}</SelectItem>
                          {(suppliers ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{supplierName(s)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={submit} disabled={busy || items.length === 0}>{busy ? <Loader2 className="animate-spin" /> : <ClipboardList />} {t('purchasesG8.propSubmit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
