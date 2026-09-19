/**
 * M6 — « Reste à payer » en grand et financement en cours (mission 05, carte 9).
 * « Au niveau visuel, important d'avoir en grand le solde restant dû » (Domenico, vidéo G8 7:59).
 * Couleur de statut : --danger seulement si l'échéance est dépassée ; sinon neutre ; jamais le rouge
 * Ducati. Statut = couleur + icône + libellé ; montants en tabular-nums.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Landmark, Loader2, Save, Trash2, XCircle, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { cn } from '@/lib/utils';
import { FINANCING_STATUSES, type DocBalance, type FinancingStatus } from './balance';
import { listFinancingOrgs, setDocumentFinancing } from './financing-api';
import { t } from '@/lib/i18n';

export const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;

export const FINANCING_META: Record<FinancingStatus, { tone: StatusTone; icon: LucideIcon }> = {
  demande: { tone: 'warning', icon: Clock },
  accepte: { tone: 'success', icon: CheckCircle2 },
  refuse: { tone: 'danger', icon: XCircle },
};

export function FinancingBadge({ status, orgLabel }: { status: string | null | undefined; orgLabel?: string | null }) {
  if (!status || !(FINANCING_STATUSES as readonly string[]).includes(status)) return null;
  const m = FINANCING_META[status as FinancingStatus];
  const label = `${t('balance.financing')}${orgLabel ? ` ${orgLabel}` : ''} · ${t(`balance.financingStatus_${status}`)}`;
  return <StatusBadge tone={m.tone} icon={m.icon} label={label} />;
}

/** Badge d'état du reste à payer : soldé / à échoir / échéance dépassée. */
export function RestStatusBadge({ due, overdue }: { due: number; overdue: boolean }) {
  if (due <= 0.005) return <StatusBadge tone="success" icon={CheckCircle2} label={t('balance.settled')} />;
  if (overdue) return <StatusBadge tone="danger" icon={AlertTriangle} label={t('balance.overdue')} />;
  return <StatusBadge tone="neutral" icon={Clock} label={t('balance.notDue')} />;
}

/** Le chiffre principal : reste à payer par le client, en grand. */
export function RestToPay({ due, overdue, size = 'xl', label }: { due: number; overdue: boolean; size?: 'xl' | 'lg'; label?: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label ?? t('balance.restToPay')}</span>
      <span className={cn(
        'font-data font-bold leading-none tabular-nums',
        size === 'xl' ? 'text-4xl' : 'text-3xl',
        overdue && due > 0.005 ? 'text-danger' : 'text-foreground',
      )}>
        {eur(due)}
      </span>
      <RestStatusBadge due={due} overdue={overdue} />
    </div>
  );
}

/** Bloc « Reste à payer » d'un document : chiffre principal + détail + financement. */
export function DocumentBalanceBlock({ balance, orgLabel, financingStatus, financingAmount, onEditFinancing }: {
  balance: DocBalance; orgLabel: string | null; financingStatus: string | null; financingAmount: number;
  onEditFinancing?: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 font-data text-sm tabular-nums">
          <Row label={t('balance.ttc')} value={eur(balance.ttc)} />
          <Row label={t('balance.paidClient')} value={eur(balance.paid - balance.paidByOrg)} />
          {balance.paidByOrg > 0.005 && <Row label={t('balance.paidByOrg')} value={eur(balance.paidByOrg)} />}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Landmark className="size-4 text-muted-foreground" />
            {financingStatus
              ? <><FinancingBadge status={financingStatus} orgLabel={orgLabel} /><span>{eur(financingAmount)}</span></>
              : <span className="text-muted-foreground">{t('balance.financingNone')}</span>}
            {onEditFinancing && (
              <Button size="sm" variant="outline" onClick={onEditFinancing}>{t('balance.financingEdit')}</Button>
            )}
          </div>
          {balance.toReceiveFromOrg > 0.005 && <Row label={t('balance.toReceiveFromOrg')} value={eur(balance.toReceiveFromOrg)} strong />}
          {balance.financingPending > 0.005 && <Row label={t('balance.financingPending')} value={eur(balance.financingPending)} />}
        </div>
        <RestToPay due={balance.clientDue} overdue={balance.overdue} label={t('balance.restToPayClient')} />
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-56 text-muted-foreground">{label}</span>
      <span className={strong ? 'font-bold' : ''}>{value}</span>
    </div>
  );
}

/** Saisie du financement : organisme (Paramètres → Tables), montant, statut. */
export function FinancingDialog({ documentId, companyId, totalTtc, current, onClose }: {
  documentId: string; companyId: string; totalTtc: number;
  current: { orgId: string | null; amount: number; status: string | null };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const orgsQ = useQuery({ queryKey: ['financing-orgs', companyId], queryFn: () => listFinancingOrgs(companyId) });
  const [orgId, setOrgId] = useState(current.orgId ?? '');
  const [amount, setAmount] = useState(current.amount > 0 ? String(current.amount) : '');
  const [status, setStatus] = useState<string>(current.status ?? 'demande');
  const num = Number(amount.replace(',', '.'));

  const done = () => {
    qc.invalidateQueries({ queryKey: ['doc-full', documentId] });
    qc.invalidateQueries({ queryKey: ['client-docs'] });
    onClose();
  };
  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => setDocumentFinancing(documentId, { orgId, amount: num, status: status as FinancingStatus }),
    onSuccess: () => { toast.success(t('balance.financingSaved')); done(); },
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('balance.errFinancing')),
  });
  const remove = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => setDocumentFinancing(documentId, { orgId: null, amount: 0, status: null }),
    onSuccess: () => { toast.success(t('balance.financingSaved')); done(); },
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('balance.errFinancing')),
  });
  const orgs = (orgsQ.data ?? []).filter((o) => o.isActive || o.id === current.orgId);
  const valid = !!orgId && num > 0 && num <= totalTtc + 0.005;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('balance.financingTitle')}</DialogTitle>
          <DialogDescription>{t('balance.financingRule')}</DialogDescription>
        </DialogHeader>
        {orgsQ.data && orgs.length === 0 ? (
          <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('balance.financingNoOrg')}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t('balance.financingOrg')}</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('balance.financingAmount')}</Label>
              <Input type="number" step="0.01" min={0} max={totalTtc} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-40 text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('balance.financingStatus')}</Label>
              <div className="flex flex-wrap gap-2">
                {FINANCING_STATUSES.map((s) => {
                  const M = FINANCING_META[s];
                  return (
                    <Button key={s} type="button" variant={status === s ? 'default' : 'outline'} onClick={() => setStatus(s)}>
                      <M.icon /> {t(`balance.financingStatus_${s}`)}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          {current.status && (
            <Button variant="outline" className="mr-auto" onClick={() => remove.mutate()} disabled={remove.isPending}>
              <Trash2 /> {t('balance.financingRemove')}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
