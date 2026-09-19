/**
 * « Commander les pièces » depuis un document de vente — mission 02, carte 3 (parité G8
 * « Mise en proposition de commande »). Ne propose que les pièces MANQUANTES pour le client du
 * document (calcul serveur `document_order_needs`) ; choix du type avec ses règles de Paramètres
 * et le seuil en direct ; quantité client (par défaut = manquant) et quantité magasin (0) ;
 * fournisseur principal proposé. La commande est créée en brouillon, liée au client, au véhicule
 * et au document (`part_order_create_from_document`, tracé dans events), puis on l'ouvre.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, ShoppingCart, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { listSuppliers, supplierName } from '@/modules/purchases/api';
import { getOrderRules, type OrderKind } from './api';
import { kindIcon, kindLabel, ruleSentences, eur } from './order-ui';
import { thresholdProgress, lineHt } from './lines';
import { ThresholdPanel } from './order-lines';
import {
  getDocumentOrderNeeds, createPartOrderFromDocument, defaultProposal, missingNeeds, proposalTotalHt, selectedLines,
  type ProposalLine,
} from './from-document';

const NONE = '__none';
const fmtQty = (n: number) => Number(n).toLocaleString('fr-BE', { maximumFractionDigits: 3 });
const toNum = (s: string) => {
  const v = Number(String(s).replace(',', '.').trim());
  return Number.isFinite(v) ? v : 0;
};

export function OrderFromDocumentDialog({
  documentId, companyId, documentLabel, preselect, onClose,
}: {
  documentId: string;
  companyId: string;
  documentLabel: string;
  /** Articles à cocher (bouton d'une ligne) ; vide = tout le document. */
  preselect?: string[] | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const needsQ = useQuery({ queryKey: ['doc-order-needs', documentId], queryFn: () => getDocumentOrderNeeds(documentId) });
  const rulesQ = useQuery({ queryKey: ['part-order-rules', companyId], queryFn: () => getOrderRules(companyId) });
  const suppliersQ = useQuery({ queryKey: ['suppliers-all', companyId], queryFn: () => listSuppliers(companyId, '', 300), staleTime: 300_000 });

  const [lines, setLines] = useState<ProposalLine[] | null>(null);
  const [kind, setKind] = useState<OrderKind>('standard');
  const [channel, setChannel] = useState<'comptoir' | 'mail'>('comptoir');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (needsQ.data && lines === null) setLines(defaultProposal(needsQ.data, preselect));
  }, [needsQ.data, lines, preselect]);

  const rules = rulesQ.data ?? [];
  const kinds = rules.filter((r) => r.isActive);
  const needs = missingNeeds(needsQ.data ?? []);
  const needById = new Map(needs.map((n) => [n.articleId, n]));
  const current = lines ?? [];
  const total = proposalTotalHt(current);
  const progress = useMemo(() => thresholdProgress(kind, total, rules), [kind, total, rules]);
  const chosen = selectedLines(current);

  const patch = (articleId: string, p: Partial<ProposalLine>) =>
    setLines((ls) => (ls ?? []).map((l) => (l.articleId === articleId ? { ...l, ...p } : l)));

  const create = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => createPartOrderFromDocument({ documentId, kind, channel, lines: current }),
    onSuccess: (orderId) => {
      toast.success(t('orderFromDoc.created'));
      for (const k of ['doc-order-needs', 'doc-part-orders', 'doc-lines-stock']) qc.invalidateQueries({ queryKey: [k, documentId] });
      qc.invalidateQueries({ queryKey: ['part-orders'] });
      onClose();
      navigate({ to: '/orders/$orderId', params: { orderId } });
    },
    onError: (e) => setError(e instanceof Error && e.message ? e.message : t('orders.errGeneric')),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShoppingCart className="size-5" /> {t('orderFromDoc.title').replace('{doc}', documentLabel)}</DialogTitle>
          <DialogDescription>{t('orderFromDoc.rule')}</DialogDescription>
        </DialogHeader>

        {needsQ.isLoading || lines === null ? (
          <div className="grid place-items-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : needs.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
            <PackageCheck className="size-4 shrink-0" /> {t('orderFromDoc.nothingMissing')}
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.colKind')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {rulesQ.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
                {kinds.map((r) => {
                  const Icon = kindIcon(r.code);
                  return (
                    <button
                      key={r.code} type="button" onClick={() => setKind(r.code)} aria-pressed={kind === r.code}
                      className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors ${kind === r.code ? 'border-ring bg-accent' : 'border-border hover:bg-accent'}`}
                    >
                      <span className="flex items-center gap-2 font-ui text-sm font-bold"><Icon className="size-4" /> {kindLabel(r.code, rules)}</span>
                      <span className="text-[12px] text-muted-foreground">{ruleSentences(r, rules).join(' · ')}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.colChannel')}</span>
              {(['comptoir', 'mail'] as const).map((c) => (
                <button
                  key={c} type="button" onClick={() => setChannel(c)} aria-pressed={channel === c}
                  className={`rounded-md border px-3 py-1.5 text-[13px] font-ui transition-colors ${channel === c ? 'border-ring bg-accent font-bold' : 'border-border hover:bg-accent'}`}
                >
                  {t(`orders.channel_${c}`)}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse font-data text-[13px]">
                <thead className="bg-muted">
                  <tr>
                    <Th className="w-8" />
                    <Th>{t('orderFromDoc.colPiece')}</Th>
                    <Th className="text-right">{t('orderFromDoc.colNeeded')}</Th>
                    <Th className="text-right">{t('orderFromDoc.colFree')}</Th>
                    <Th className="text-right">{t('orderFromDoc.colOnOrder')}</Th>
                    <Th className="text-right">{t('orderFromDoc.colMissing')}</Th>
                    <Th className="w-24">{t('orderFromDoc.colQtyClient')}</Th>
                    <Th className="w-24">{t('orderFromDoc.colQtyShop')}</Th>
                    <Th className="min-w-44">{t('orders.colSupplier')}</Th>
                    <Th className="w-28">{t('orders.colUnitHt')}</Th>
                    <Th className="text-right">{t('orderFromDoc.colLineHt')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {current.map((l) => {
                    const need = needById.get(l.articleId);
                    if (!need) return null;
                    const ht = lineHt({ qtyClient: l.qtyClient, qtyShop: l.qtyShop, unitPriceHt: l.unitPriceHt });
                    return (
                      <tr key={l.articleId} className={`border-b border-border last:border-0 ${l.selected ? '' : 'text-muted-foreground'}`}>
                        <td className="px-3 py-2">
                          <Checkbox checked={l.selected} onCheckedChange={(v) => patch(l.articleId, { selected: v === true })} aria-label={need.reference} />
                        </td>
                        <td className="px-3 py-2">
                          <span className="mr-2 font-mono text-[12px] text-muted-foreground">{need.reference}</span>{need.designation}
                          {need.bin && <span className="ml-2 text-[11px] text-muted-foreground">{t('orders.colBin')} {need.bin}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtQty(need.qtyNeeded)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtQty(Math.max(need.freeQty, 0))}</td>
                        <td className="px-3 py-2 text-right tabular-nums" title={t('orderFromDoc.onOrderHint').replace('{draft}', fmtQty(need.draftQty))}>
                          {fmtQty(need.onOrderQty + need.draftQty)}
                        </td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtQty(need.missingQty)}</td>
                        <td className="px-3 py-2">
                          <NumInput value={l.qtyClient} disabled={!l.selected} onChange={(v) => patch(l.articleId, { qtyClient: v })} />
                        </td>
                        <td className="px-3 py-2">
                          <NumInput value={l.qtyShop} disabled={!l.selected} onChange={(v) => patch(l.articleId, { qtyShop: v })} />
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={l.supplierId ?? NONE} disabled={!l.selected}
                            onValueChange={(v) => patch(l.articleId, { supplierId: v === NONE ? null : v })}
                          >
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>{t('orders.noSupplier')}</SelectItem>
                              {need.supplierId && !(suppliersQ.data ?? []).some((s) => s.id === need.supplierId) && (
                                <SelectItem value={need.supplierId}>{need.supplierName ?? '—'}</SelectItem>
                              )}
                              {(suppliersQ.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{supplierName(s)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <NumInput value={l.unitPriceHt} disabled={!l.selected} onChange={(v) => patch(l.articleId, { unitPriceHt: v })} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.selected ? eur(ht) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="text-muted-foreground">{t('orderFromDoc.selectedCount').replace('{n}', String(chosen.length)).replace('{total}', String(current.length))}</span>
              <span>{t('orders.totalHt')} <b className="tabular-nums">{eur(total)}</b></span>
            </div>

            <ThresholdPanel progress={progress} total={total} rules={rules} drafting />
            <p className="text-[12px] text-muted-foreground">{t('orderFromDoc.afterHint')}</p>
          </div>
        )}

        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => { setError(null); create.mutate(); }} disabled={create.isPending || chosen.length === 0}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <ShoppingCart />} {t('orderFromDoc.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Saisie d'un nombre (virgule acceptée) : le texte tapé est gardé, la valeur suit. */
function NumInput({ value, disabled, onChange }: { value: number; disabled?: boolean; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value).replace('.', ','));
  useEffect(() => {
    if (toNum(text) !== value) setText(String(value).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      className="h-8 text-right tabular-nums" inputMode="decimal" disabled={disabled} value={text}
      onChange={(e) => { setText(e.target.value); onChange(toNum(e.target.value)); }}
    />
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
