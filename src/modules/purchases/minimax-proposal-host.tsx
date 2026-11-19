/**
 * Fenêtre « Pièces passées sous leur minimum » (réassort minimax en proposition manuelle, décision
 * de Simon du 18/11/2026, parité G8 « contrôle des minis/maxis en facturation = ouvrir fenêtre de
 * mise en PRC »). Montée une fois dans la mise en page (_app.tsx) : écoute MINIMAX_CHECK_EVENT,
 * émis après la validation d'une vente, d'un ticket de caisse ou d'une liste de préparation.
 * En mode « automatique » (défaut) elle ne s'ouvre jamais : la base a déjà rempli le panier.
 * « Ajouter » → minimax_proposal_apply (panier standard ouvert, origine minimax) ;
 * « Ignorer » → minimax_proposal_ignore (tracé). La tâche de nuit reste le filet de sécurité.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShoppingBasket, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { t, fillVars } from '@/lib/i18n';
import { applyMinimaxProposal, getMinimaxMode, getMinimaxNightRows, getMinimaxProposal, ignoreMinimaxProposal, minimaxNightKey } from './minimax-api';
import {
  MINIMAX_CHECK_EVENT, MINIMAX_NIGHT_EVENT, defaultChoices, ignoredArticleIds, proposalLinesToApply,
  type MinimaxCheckRequest, type MinimaxProposalRow, type ProposalChoice,
} from './minimax-immediate';
import { fmtQty } from './basket-ui';

type Pending = { req: MinimaxCheckRequest; rows: MinimaxProposalRow[] };

export function MinimaxProposalHost() {
  const [queue, setQueue] = useState<Pending[]>([]);

  useEffect(() => {
    const onCheck = (ev: Event) => {
      const req = (ev as CustomEvent<MinimaxCheckRequest>).detail;
      if (!req?.companyId || !req.articleIds?.length) return;
      // Jamais bloquant : une erreur de lecture laisse simplement la tâche de nuit faire son travail.
      void (async () => {
        try {
          if ((await getMinimaxMode(req.companyId)) !== 'manuel') return;
          const rows = await getMinimaxProposal(req.companyId, req.articleIds);
          if (rows.length > 0) setQueue((q) => [...q, { req, rows }]);
        } catch {
          /* fonction absente (migration non posée) ou réseau : rien à proposer */
        }
      })();
    };
    // Liste préparée par la tâche de nuit (mode manuel, Q52) : demandée par l'écran des achats / paniers.
    const onNight = (ev: Event) => {
      const companyId = (ev as CustomEvent<{ companyId: string }>).detail?.companyId;
      if (!companyId) return;
      void (async () => {
        try {
          const rows = await getMinimaxNightRows(companyId);
          if (rows.length === 0) return;
          const req: MinimaxCheckRequest = { companyId, articleIds: rows.map((r) => r.articleId), reference: null, source: 'nuit' };
          setQueue((q) => (q.some((p) => p.req.source === 'nuit' && p.req.companyId === companyId) ? q : [...q, { req, rows }]));
        } catch {
          /* fonction absente (migration non posée) ou réseau : rien à proposer */
        }
      })();
    };
    window.addEventListener(MINIMAX_CHECK_EVENT, onCheck);
    window.addEventListener(MINIMAX_NIGHT_EVENT, onNight);
    return () => {
      window.removeEventListener(MINIMAX_CHECK_EVENT, onCheck);
      window.removeEventListener(MINIMAX_NIGHT_EVENT, onNight);
    };
  }, []);

  const current = queue[0];
  if (!current) return null;
  return <MinimaxProposalDialog key={`${current.req.reference ?? ''}-${current.rows.map((r) => r.articleId).join(',')}`}
    pending={current} onClose={() => setQueue((q) => q.slice(1))} />;
}

function MinimaxProposalDialog({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const { req, rows } = pending;
  const qc = useQueryClient();
  const [choices, setChoices] = useState<Record<string, ProposalChoice>>(() => defaultChoices(rows));
  const [error, setError] = useState<string | null>(null);
  const lines = proposalLinesToApply(rows, choices);
  const patch = (id: string, p: Partial<ProposalChoice>) => setChoices((c) => ({ ...c, [id]: { ...c[id], ...p } }));
  const ref = req.reference;

  const add = useMutation({
    meta: { success: false, error: false },
    mutationFn: async () => {
      const res = await applyMinimaxProposal(req.companyId, lines, ref);
      const skipped = ignoredArticleIds(rows, choices);
      if (skipped.length) await ignoreMinimaxProposal(req.companyId, skipped, ref).catch(() => undefined);
      return res;
    },
    onSuccess: () => {
      toast.success(fillVars(t('minimax.added'), { n: lines.length }));
      qc.invalidateQueries({ queryKey: ['supplier-baskets', req.companyId] });
      qc.invalidateQueries({ queryKey: minimaxNightKey(req.companyId) });
      onClose();
    },
    onError: (e) => setError(e instanceof Error && e.message ? e.message : t('minimax.error')),
  });

  const ignore = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => ignoreMinimaxProposal(req.companyId, rows.map((r) => r.articleId), ref),
    onSettled: () => { toast(t('minimax.ignored')); qc.invalidateQueries({ queryKey: minimaxNightKey(req.companyId) }); onClose(); },
  });

  const busy = add.isPending || ignore.isPending;
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) ignore.mutate(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-warning" /> {t('minimax.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {req.source === 'nuit'
              ? t('minimax.dialogDescNight')
              : fillVars(t('minimax.dialogDesc'), { ref: ref ?? t('minimax.noRef'), source: t(`minimax.source_${req.source}`) })}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th className="w-8" />
                <Th>{t('minimax.colPiece')}</Th>
                <Th className="text-right">{t('minimax.colStock')}</Th>
                <Th className="text-right">{t('minimax.colMin')}</Th>
                <Th className="text-right">{t('minimax.colMax')}</Th>
                <Th className="text-right">{t('minimax.colOnOrder')}</Th>
                <Th className="w-24 text-right">{t('minimax.colQty')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = choices[r.articleId];
                return (
                  <tr key={r.articleId} className={`border-b border-border last:border-0 ${c?.selected ? '' : 'text-muted-foreground'}`}>
                    <td className="px-3 py-2"><Checkbox checked={!!c?.selected} onCheckedChange={(v) => patch(r.articleId, { selected: v === true })} aria-label={r.reference} /></td>
                    <td className="px-3 py-2"><span className="mr-2 font-mono text-[12px] text-muted-foreground">{r.reference}</span>{r.designation}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(r.minimaxStock)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(r.stockMin)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(r.stockMax)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(r.onOrder + r.inBasket)}</td>
                    <td className="px-3 py-2">
                      <Input className="h-8 text-right tabular-nums" inputMode="decimal" disabled={!c?.selected}
                        value={c?.qty ?? ''} onChange={(e) => patch(r.articleId, { qty: e.target.value })} aria-label={t('minimax.colQty')} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => ignore.mutate()} disabled={busy}>
            {ignore.isPending && <Loader2 className="animate-spin" />} {t('minimax.ignore')}
          </Button>
          <Button onClick={() => { setError(null); add.mutate(); }} disabled={busy || lines.length === 0}>
            {add.isPending ? <Loader2 className="animate-spin" /> : <ShoppingBasket />} {t('minimax.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
