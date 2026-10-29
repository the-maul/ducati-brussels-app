/**
 * M8 — « Accord client » en tête de l'OR, en grand (garde-fou avant intervention, ATE009) :
 *   - signé le … par … (signature électronique à distance ou au comptoir) ;
 *   - EN ATTENTE : la proposition est partie, rien ne démarre ;
 *   - accord verbal le … par … (téléphone / comptoir / mail), noté par le vendeur, tracé dans events.
 * Règle M08 : « aucune intervention sans accord tracé ».
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Clock, PhoneCall, XCircle, Loader2, PenLine, FileText, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { recordVerbalApproval, type VerbalApprovalInput } from './api';
import { approvalState, type ApprovalState } from './rules';

type OrLike = {
  customer_approval?: string | null; approval_at?: string | null; approval_by_name?: string | null;
  approval_channel?: string | null; approval_note?: string | null; proposal_document_id?: string | null;
};

const STYLE: Record<ApprovalState, { icon: LucideIcon; box: string; text: string }> = {
  none: { icon: FileText, box: 'border-border bg-card', text: 'text-muted-foreground' },
  en_attente: { icon: Clock, box: 'border-warning bg-warning-bg', text: 'text-warning' },
  signe: { icon: CheckCircle2, box: 'border-success bg-success-bg', text: 'text-success' },
  accord_verbal: { icon: PhoneCall, box: 'border-success bg-success-bg', text: 'text-success' },
  refuse: { icon: XCircle, box: 'border-danger bg-danger-bg', text: 'text-danger' },
};

const fmtWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '');

export function ApprovalPanel({ or, onVerbal, onSignAtCounter, onOpenProposal, onResend, signBusy }: {
  or: OrLike;
  onVerbal: () => void;
  onSignAtCounter?: () => void;
  onOpenProposal?: () => void;
  onResend?: () => void;
  signBusy?: boolean;
}) {
  const state = approvalState(or);
  const s = STYLE[state];
  const Icon = s.icon;
  const by = or.approval_by_name ?? '';
  const when = fmtWhen(or.approval_at);
  const channel = or.approval_channel ? t(`checkup.channel_${or.approval_channel}`) : '';
  const detail = state === 'signe' ? t('checkup.approvalSigned').replace('{when}', when).replace('{who}', by).replace('{channel}', channel)
    : state === 'accord_verbal' ? t('checkup.approvalVerbal').replace('{when}', when).replace('{who}', by).replace('{channel}', channel)
    : state === 'en_attente' ? t('checkup.approvalPendingHint')
    : state === 'refuse' ? t('checkup.approvalRefused')
    : t('checkup.approvalNoneHint');

  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-md border p-4', s.box)}>
      <Icon className={cn('size-8 shrink-0', s.text)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('checkup.approvalTitle')}</p>
        <p className={cn('text-[20px] font-bold leading-tight', s.text)}>{t(`checkup.approval_${state}`)}</p>
        <p className="text-[13px] text-muted-foreground">{detail}</p>
        {or.approval_note && <p className="mt-1 text-[13px] italic">{or.approval_note}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {or.proposal_document_id && onOpenProposal && (
          <Button type="button" variant="outline" className="h-11" onClick={onOpenProposal}><FileText /> {t('checkup.openProposal')}</Button>
        )}
        {state === 'en_attente' && onResend && (
          <Button type="button" variant="outline" className="h-11" onClick={onResend}>{t('checkup.resendProposal')}</Button>
        )}
        {state === 'en_attente' && onSignAtCounter && (
          <Button type="button" className="h-11" onClick={onSignAtCounter} disabled={signBusy}>
            {signBusy ? <Loader2 className="animate-spin" /> : <PenLine />} {t('checkup.signAtCounter')}
          </Button>
        )}
        {(state === 'en_attente' || state === 'refuse' || state === 'none') && (
          <Button type="button" variant={state === 'en_attente' ? 'outline' : 'outline'} className="h-11" onClick={onVerbal}>
            <PhoneCall /> {t('checkup.verbalApproval')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Fenêtre « Accord verbal » : qui, quand, par quel canal, note → `repair_order_verbal_approval`. */
export function VerbalApprovalDialog({ orId, open, onClose, onDone }: { orId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [byName, setByName] = useState('');
  const [at, setAt] = useState(local);
  const [channel, setChannel] = useState<VerbalApprovalInput['channel']>('telephone');
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => recordVerbalApproval(orId, { byName, at: at ? new Date(at).toISOString() : '', channel, note }),
    onSuccess: () => { toast.success(t('checkup.verbalSaved')); onDone(); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('checkup.verbalTitle')}</DialogTitle>
          <DialogDescription>{t('checkup.verbalIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="va-who">{t('checkup.verbalWho')}</Label><Input id="va-who" value={byName} onChange={(e) => setByName(e.target.value)} className="h-11" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="va-when">{t('checkup.verbalWhen')}</Label><Input id="va-when" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-11" /></div>
            <div className="space-y-1.5">
              <Label>{t('checkup.verbalChannel')}</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as VerbalApprovalInput['channel'])}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['telephone', 'comptoir', 'mail'] as const).map((c) => <SelectItem key={c} value={c}>{t(`checkup.channel_${c}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="va-note">{t('checkup.verbalNote')}</Label><Textarea id="va-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || !byName.trim()}>
            {m.isPending ? <Loader2 className="animate-spin" /> : <PhoneCall />} {t('checkup.verbalConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
