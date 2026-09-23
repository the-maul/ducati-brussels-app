/**
 * « Commander les pièces manquantes » depuis un OR ou depuis sa liste de préparation
 * (mission 07, carte 2 ; demande de Simon du 23/09 : « pouvoir commander depuis l'or ou
 * la picking list (en choisissant le type de commande) »).
 *
 * On ne recrée pas le circuit d'achat : on ouvre une commande de pièces (part_orders),
 * avec son TYPE (standard / urgente / accident, règles de Paramètres et seuil en direct),
 * qui repart ensuite dans la proposition de commande fournisseur et le fichier DCS.
 * Seules les pièces MANQUANTES sont proposées (calcul serveur : besoin − libre −
 * en commande − déjà en brouillon). Aucun mouvement de stock.
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
import { t } from '@/lib/i18n';
import { getOrderRules, type OrderKind } from '@/modules/orders/api';
import { kindIcon, kindLabel, ruleSentences, eur } from '@/modules/orders/order-ui';
import { thresholdProgress, lineHt } from '@/modules/orders/lines';
import { ThresholdPanel } from '@/modules/orders/order-lines';
import {
  defaultProposal, missingNeeds, proposalTotalHt, selectedLines, proposalPayload, type ProposalLine,
} from '@/modules/orders/from-document';
import { getRepairOrderNeeds, getPickingNeeds, createPartOrderForWorkshop } from './api';
import { fmtQty } from './rules';

const toNum = (s: string) => {
  const v = Number(String(s).replace(',', '.').trim());
  return Number.isFinite(v) ? v : 0;
};

export function OrderFromWorkshopDialog({
  orId, pickingId, companyId, label, onClose,
}: {
  /** L'un des deux exactement : l'OR, ou sa liste de préparation. */
  orId?: string | null;
  pickingId?: string | null;
  companyId: string;
  /** Ce qu'on affiche dans le titre : « OR-2026-00012 » ou « Liste de préparation ». */
  label: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const key = pickingId ? ['picking-order-needs', pickingId] : ['ro-order-needs', orId];
  const needsQ = useQuery({
    queryKey: key,
    queryFn: () => (pickingId ? getPickingNeeds(pickingId) : getRepairOrderNeeds(orId!)),
  });
  const rulesQ = useQuery({ queryKey: ['part-order-rules', companyId], queryFn: () => getOrderRules(companyId) });

  const [lines, setLines] = useState<ProposalLine[] | null>(null);
  const [kind, setKind] = useState<OrderKind>('standard');
  const [channel, setChannel] = useState<'comptoir' | 'mail'>('comptoir');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (needsQ.data && lines === null) setLines(defaultProposal(needsQ.data));
  }, [needsQ.data, lines]);

  const rules = rulesQ.data ?? [];
  // La commande Excel garde son circuit propre (classeur Ducati) : pas proposée ici.
  const kinds = rules.filter((r) => r.isActive && r.code !== 'excel');
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
    mutationFn: () => createPartOrderForWorkshop({
      orId: orId ?? null, pickingId: pickingId ?? null, kind, channel,
      lines: proposalPayload(current),
    }),
    onSuccess: (orderId) => {
      toast.success(t('workshopOrder.created'));
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['part-orders'] });
      if (orId) qc.invalidateQueries({ queryKey: ['ro-full', orId] });
      onClose();
      navigate({ to: '/orders/$orderId', params: { orderId } });
    },
    onError: (e) => setError(e instanceof Error && e.message ? e.message : t('orders.errGeneric')),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="size-5" /> {t('workshopOrder.title').replace('{label}', label)}
          </DialogTitle>
          <DialogDescription>{t('workshopOrder.rule')}</DialogDescription>
        </DialogHeader>

        {needsQ.isLoading || lines === null ? (
          <div className="grid place-items-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : needs.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
            <PackageCheck className="size-4 shrink-0" /> {t('workshopOrder.nothingMissing')}
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
                    <Th>{t('workshopOrder.colOrigin')}</Th>
                    <Th className="text-right">{t('orderFromDoc.colNeeded')}</Th>
                    <Th className="text-right">{t('orderFromDoc.colFree')}</Th>
                    <Th className="text-right">{t('orderFromDoc.colOnOrder')}</Th>
                    <Th className="text-right">{t('orderFromDoc.colMissing')}</Th>
                    <Th className="w-24">{t('orderFromDoc.colQtyClient')}</Th>
                    <Th className="w-24">{t('orderFromDoc.colQtyShop')}</Th>
                    <Th className="w-28">{t('orders.colUnitHt')}</Th>
                    <Th className="text-right">{t('orderFromDoc.colLineHt')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {current.map((l) => {
                    const need = needById.get(l.articleId);
                    if (!need) return null;
                    const ht = lineHt({ qtyClient: l.qtyClient, qtyShop: l.qtyShop, unitPriceHt: l.unitPriceHt });
                    const origin = (need as { origin?: string }).origin ?? 'kit';
                    return (
                      <tr key={l.articleId} className={`border-b border-border last:border-0 ${l.selected ? '' : 'text-muted-foreground'}`}>
                        <td className="px-3 py-2">
                          <Checkbox checked={l.selected} onCheckedChange={(v) => patch(l.articleId, { selected: v === true })} aria-label={need.reference} />
                        </td>
                        <td className="px-3 py-2">
                          <span className="mr-2 font-mono text-[12px] text-muted-foreground">{need.reference}</span>{need.designation}
                          {need.bin && <span className="ml-2 text-[11px] text-muted-foreground">{t('orders.colBin')} {need.bin}</span>}
                        </td>
                        <td className="px-3 py-2 text-[12px] text-muted-foreground">{t(`workshopOrder.origin_${origin}`)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtQty(need.qtyNeeded)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtQty(Math.max(need.freeQty, 0))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtQty(need.onOrderQty + need.draftQty)}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtQty(need.missingQty)}</td>
                        <td className="px-3 py-2"><NumInput value={l.qtyClient} disabled={!l.selected} onChange={(v) => patch(l.articleId, { qtyClient: v })} /></td>
                        <td className="px-3 py-2"><NumInput value={l.qtyShop} disabled={!l.selected} onChange={(v) => patch(l.articleId, { qtyShop: v })} /></td>
                        <td className="px-3 py-2"><NumInput value={l.unitPriceHt} disabled={!l.selected} onChange={(v) => patch(l.articleId, { unitPriceHt: v })} /></td>
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
            <p className="text-[12px] text-muted-foreground">{t('workshopOrder.afterHint')}</p>
          </div>
        )}

        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => { setError(null); create.mutate(); }} disabled={create.isPending || chosen.length === 0}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <ShoppingCart />} {t('workshopOrder.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
