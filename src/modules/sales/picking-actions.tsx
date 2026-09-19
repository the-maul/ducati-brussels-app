/**
 * M6 — Actions sur une liste de préparation (mission 02, carte « picking list »), partagées par la
 * page des listes et la vue tablette : imprimer, régénérer depuis le document, terminer,
 * annuler / supprimer (suppression réelle seulement si rien n'est préparé ni monté, sinon
 * annulation avec motif — B7), rouvrir. Toutes les écritures passent par les fonctions SQL
 * picking_* (tracées dans events) ; aucune ne touche au stock.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban, CheckCheck, ClipboardList, Hourglass, Loader2, MoreHorizontal, PackageCheck, Printer, RefreshCw,
  RotateCcw, Trash2, Wrench, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import {
  cancelPicking, finishPicking, getPickingDetail, pickingActions, pickingCancelMode, pickingDisplayStatus,
  regeneratePicking, reopenPicking, type PickingOverviewRow, type PickingCounts, type PickingListStatus,
} from './picking-api';
import { printPicking } from './print-picking';

/** Statut d'une liste : couleur + icône + libellé (charte). */
export const PICKING_STATUS_META: Record<PickingListStatus, { tone: StatusTone; icon: LucideIcon }> = {
  a_preparer: { tone: 'neutral', icon: ClipboardList },
  en_cours: { tone: 'warning', icon: Hourglass },
  prete: { tone: 'success', icon: PackageCheck },
  montee: { tone: 'success', icon: Wrench },
  terminee: { tone: 'info', icon: CheckCheck },
  annulee: { tone: 'danger', icon: Ban },
};

export function PickingStatusBadge({ row, className }: { row: PickingCounts; className?: string }) {
  const s = pickingDisplayStatus(row);
  const m = PICKING_STATUS_META[s];
  return <StatusBadge tone={m.tone} icon={m.icon} label={t(`picking.listStatus_${s}`)} className={className} />;
}

type Dlg = null | 'cancel' | 'regenerate' | 'finish';

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function PickingActions({ row, variant, onDeleted }: {
  row: PickingOverviewRow;
  /** « list » : icône imprimer + menu ; « tablet » : grands boutons. */
  variant: 'list' | 'tablet';
  /** appelé après une suppression réelle (la tablette revient à la liste) */
  onDeleted?: () => void;
}) {
  const qc = useQueryClient();
  const { companies } = useAuth();
  const [dlg, setDlg] = useState<Dlg>(null);
  const can = pickingActions(row);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['picking-lists'] });
    qc.invalidateQueries({ queryKey: ['picking-header', row.id] });
    qc.invalidateQueries({ queryKey: ['picking-tablet', row.id] });
  };

  const print = useMutation({
    meta: { success: false, error: false },
    mutationFn: async () => printPicking(row, await getPickingDetail(row.id), companies.find((c) => c.id === row.company_id)?.name ?? ''),
    onError: (e) => toast.error(errMsg(e, t('picking.errUpdate'))),
  });
  const reopen = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => reopenPicking(row.id),
    onSuccess: () => { toast.success(t('picking.reopened')); refresh(); },
    onError: (e) => toast.error(errMsg(e, t('picking.errUpdate'))),
  });

  const busy = print.isPending || reopen.isPending;
  const big = 'h-12 px-4 text-base';

  const dialogs = (
    <>
      {dlg === 'cancel' && <CancelDialog row={row} onClose={() => setDlg(null)} onDone={(r) => { refresh(); if (r === 'deleted') onDeleted?.(); }} />}
      {dlg === 'regenerate' && <RegenerateDialog row={row} onClose={() => setDlg(null)} onDone={refresh} />}
      {dlg === 'finish' && <FinishDialog row={row} onClose={() => setDlg(null)} onDone={refresh} />}
    </>
  );

  if (variant === 'tablet') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className={big} onClick={() => print.mutate()} disabled={busy}>
          {print.isPending ? <Loader2 className="animate-spin" /> : <Printer />} {t('picking.actionPrint')}
        </Button>
        {can.regenerate && (
          <Button variant="outline" className={big} onClick={() => setDlg('regenerate')}>
            <RefreshCw /> {t('picking.actionRegenerate')}
          </Button>
        )}
        {can.finish && (
          <Button className={big} onClick={() => setDlg('finish')}><CheckCheck /> {t('picking.actionFinish')}</Button>
        )}
        {can.reopen && (
          <Button variant="outline" className={big} onClick={() => reopen.mutate()} disabled={busy}>
            {reopen.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} {t('picking.actionReopen')}
          </Button>
        )}
        {can.cancel && (
          <Button variant="outline" className={`${big} text-danger`} onClick={() => setDlg('cancel')}>
            <Ban /> {t('picking.actionCancel')}
          </Button>
        )}
        {dialogs}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <Button variant="ghost" size="icon" className="size-10" title={t('picking.actionPrint')} onClick={() => print.mutate()} disabled={busy}>
        {print.isPending ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-10" title={t('picking.moreActions')}><MoreHorizontal className="size-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {can.regenerate && <DropdownMenuItem className="py-2.5" onSelect={() => setDlg('regenerate')}><RefreshCw /> {t('picking.actionRegenerate')}</DropdownMenuItem>}
          {can.finish && <DropdownMenuItem className="py-2.5" onSelect={() => setDlg('finish')}><CheckCheck /> {t('picking.actionFinish')}</DropdownMenuItem>}
          {can.reopen && <DropdownMenuItem className="py-2.5" onSelect={() => reopen.mutate()}><RotateCcw /> {t('picking.actionReopen')}</DropdownMenuItem>}
          {can.cancel && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="py-2.5 text-danger" onSelect={() => setDlg('cancel')}><Ban /> {t('picking.actionCancel')}</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogs}
    </div>
  );
}

/** Annuler / supprimer : le mode est calculé sur les lignes (mêmes règles que picking_cancel). */
function CancelDialog({ row, onClose, onDone }: { row: PickingOverviewRow; onClose: () => void; onDone: (r: 'deleted' | 'cancelled') => void }) {
  const [reason, setReason] = useState('');
  const linesQ = useQuery({ queryKey: ['picking-tablet', row.id], queryFn: () => getPickingDetail(row.id) });
  const mode = linesQ.data ? pickingCancelMode(row.status, linesQ.data) : null;
  const run = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => cancelPicking(row.id, reason),
    onSuccess: (r) => { toast.success(t(r === 'deleted' ? 'picking.deleted' : 'picking.cancelled')); onClose(); onDone(r); },
    onError: (e) => toast.error(errMsg(e, t('picking.errUpdate'))),
  });
  const needReason = mode === 'cancel';
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{mode === 'delete' ? t('picking.cancelTitleDelete') : t('picking.cancelTitleCancel')}</DialogTitle>
          <DialogDescription>
            {mode === null ? t('picking.loading') : mode === 'delete' ? t('picking.cancelBodyDelete') : t('picking.cancelBodyCancel')}
          </DialogDescription>
        </DialogHeader>
        {needReason && (
          <div className="space-y-1.5">
            <Label htmlFor="picking-cancel-reason">{t('picking.cancelReason')}</Label>
            <Textarea
              id="picking-cancel-reason" value={reason} maxLength={300} rows={3}
              onChange={(e) => setReason(e.target.value)} placeholder={t('picking.cancelReasonPlaceholder')}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose}>{t('action.close')}</Button>
          <Button
            variant="destructive" className="h-11"
            disabled={mode === null || run.isPending || (needReason && !reason.trim())}
            onClick={() => run.mutate()}
          >
            {run.isPending ? <Loader2 className="animate-spin" /> : mode === 'delete' ? <Trash2 /> : <Ban />}
            {mode === 'delete' ? t('picking.confirmDelete') : t('picking.confirmCancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegenerateDialog({ row, onClose, onDone }: { row: PickingOverviewRow; onClose: () => void; onDone: () => void }) {
  const run = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => regeneratePicking(row.id),
    onSuccess: (r) => {
      const msg = t('picking.regenDone')
        .replace('{added}', String(r.added)).replace('{removed}', String(r.removed)).replace('{qty}', String(r.qty_changed));
      const removed = r.removed_lines.map((l) => [l.reference, l.designation].filter(Boolean).join(' ')).join(', ');
      if (removed) toast.warning(msg, { description: t('picking.regenRemovedList').replace('{lines}', removed), duration: 10000 });
      else toast.success(msg);
      onClose(); onDone();
    },
    onError: (e) => toast.error(errMsg(e, t('picking.errUpdate'))),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t('picking.regenTitle')}</DialogTitle>
          <DialogDescription>{t('picking.regenBody')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose}>{t('action.close')}</Button>
          <Button className="h-11" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('picking.regenConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinishDialog({ row, onClose, onDone }: { row: PickingOverviewRow; onClose: () => void; onDone: () => void }) {
  const run = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => finishPicking(row.id),
    onSuccess: () => { toast.success(t('picking.finished')); onClose(); onDone(); },
    onError: (e) => toast.error(errMsg(e, t('picking.errUpdate'))),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t('picking.finishTitle')}</DialogTitle>
          <DialogDescription>{t('picking.finishBody')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose}>{t('action.close')}</Button>
          <Button className="h-11" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Loader2 className="animate-spin" /> : <CheckCheck />} {t('picking.finishConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
