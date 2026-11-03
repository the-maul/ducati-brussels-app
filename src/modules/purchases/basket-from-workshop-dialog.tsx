/**
 * « Ajouter au panier standard » depuis un ordre de réparation (mission 09, carte 1, origine
 * « atelier ») : les pièces MANQUANTES de l'OR (kit d'entretien + pièces ajoutées par le
 * technicien, calcul serveur repair_order_order_needs) vont dans le panier standard ouvert le
 * plus récent par basket_add_lines (origine atelier, référence = n° de l'OR, client de l'OR).
 * Le circuit « Commander les pièces manquantes » (commande de pièces typée) reste disponible à côté.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, PackageCheck, ShoppingBasket } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { t, fillVars } from '@/lib/i18n';
import { missingNeeds } from '@/modules/orders/from-document';
import { getRepairOrderNeeds } from '@/modules/workshop/kits/api';
import { addBasketLines } from './basket-api';
import { fmtQty } from './basket-ui';

type Row = { articleId: string; selected: boolean; qty: number };

const toNum = (s: string) => {
  const v = Number(String(s).replace(',', '.').trim());
  return Number.isFinite(v) ? v : 0;
};

export function BasketFromWorkshopDialog({ orId, companyId, contactId, label, onClose }: {
  orId: string; companyId: string; contactId: string | null; label: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const needsQ = useQuery({ queryKey: ['ro-order-needs', orId], queryFn: () => getRepairOrderNeeds(orId) });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Même règle que missingNeeds (from-document.ts), en gardant l'origine (kit / atelier) de chaque besoin.
  const needs = (needsQ.data ?? []).filter((n) => n.missingQty > 0.0005);
  useEffect(() => {
    if (needsQ.data && rows === null) setRows(missingNeeds(needsQ.data).map((n) => ({ articleId: n.articleId, selected: true, qty: n.missingQty })));
  }, [needsQ.data, rows]);

  const patch = (articleId: string, p: Partial<Row>) => setRows((rs) => (rs ?? []).map((r) => (r.articleId === articleId ? { ...r, ...p } : r)));
  const chosen = (rows ?? []).filter((r) => r.selected && r.qty > 0);

  const add = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => addBasketLines(companyId, 'standard', chosen.map((r) => ({
      article_id: r.articleId, qty: r.qty, origin: 'atelier' as const, origin_ref: label, contact_id: contactId,
    }))),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['supplier-baskets', companyId] });
      onClose();
      navigate({ to: '/purchases/baskets/$basketId', params: { basketId: res.basket_id } });
    },
    onError: (e) => setError(e instanceof Error && e.message ? e.message : t('orders.errGeneric')),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShoppingBasket className="size-5" /> {fillVars(t('basket.wsTitle'), { label })}</DialogTitle>
          <DialogDescription>{t('basket.wsHint')}</DialogDescription>
        </DialogHeader>
        {needsQ.isLoading || rows === null ? (
          <div className="grid place-items-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : needs.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
            <PackageCheck className="size-4 shrink-0" /> {t('basket.wsNothing')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted">
                <tr>
                  <Th className="w-8" />
                  <Th>{t('orderFromDoc.colPiece')}</Th>
                  <Th>{t('workshopOrder.colOrigin')}</Th>
                  <Th className="text-right">{t('orderFromDoc.colNeeded')}</Th>
                  <Th className="text-right">{t('orderFromDoc.colFree')}</Th>
                  <Th className="text-right">{t('orderFromDoc.colOnOrder')}</Th>
                  <Th className="text-right">{t('orderFromDoc.colMissing')}</Th>
                  <Th className="w-24 text-right">{t('basket.colQty')}</Th>
                </tr>
              </thead>
              <tbody>
                {needs.map((n) => {
                  const r = rows.find((x) => x.articleId === n.articleId);
                  if (!r) return null;
                  return (
                    <tr key={n.articleId} className={`border-b border-border last:border-0 ${r.selected ? '' : 'text-muted-foreground'}`}>
                      <td className="px-3 py-2"><Checkbox checked={r.selected} onCheckedChange={(v) => patch(n.articleId, { selected: v === true })} aria-label={n.reference} /></td>
                      <td className="px-3 py-2"><span className="mr-2 font-mono text-[12px] text-muted-foreground">{n.reference}</span>{n.designation}</td>
                      <td className="px-3 py-2 text-[12px] text-muted-foreground">{t(`workshopOrder.origin_${n.origin}`)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(n.qtyNeeded)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(Math.max(n.freeQty, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(n.onOrderQty + n.draftQty)}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtQty(n.missingQty)}</td>
                      <td className="px-3 py-2">
                        <Input className="h-8 text-right tabular-nums" inputMode="decimal" disabled={!r.selected}
                          defaultValue={String(r.qty).replace('.', ',')} onChange={(e) => patch(n.articleId, { qty: toNum(e.target.value) })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => { setError(null); add.mutate(); }} disabled={add.isPending || chosen.length === 0}>
            {add.isPending ? <Loader2 className="animate-spin" /> : <ShoppingBasket />} {t('basket.wsAdd')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
