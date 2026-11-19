/**
 * SMS par Brevo (18/11/2026) : liste « SMS programmes » (G8, planning atelier) et historique, avec
 * annulation ; formulaire « Programmer des SMS de rappel » (RDV entre deux dates, type de RDV,
 * N j/h/min avant ou jour J-n a heure fixe, message a balises). Utilise dans Parametres → SMS et
 * depuis le planning atelier (bouton « SMS programmes »).
 * Statut = couleur + icone + libelle (charte §1). Libelles : bloc `sms` du dictionnaire.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarClock, CheckCircle2, Clock, Loader2, MessageSquareText, RefreshCw, Send, TriangleAlert, XCircle, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { t, fillVars, getLocale } from '@/lib/i18n';
import { listAppointmentTypes } from '@/modules/workshop/planning/api';
import { cancelSms, getSmsReadyState, listSms, scheduleAppointmentSms, type SmsRow } from './sms-api';
import { SMS_VARS, isKnownReason, joinLead, smsSize, smsStatusTone } from './sms-rules';

const STATUS_ICON: Record<string, LucideIcon> = {
  pending: Clock, sending: Send, sent: CheckCircle2, failed: XCircle, skipped: TriangleAlert, cancelled: Ban, not_queued: TriangleAlert,
};

const INTL: Record<string, string> = { fr: 'fr-BE', nl: 'nl-BE', en: 'en-GB', it: 'it-IT' };
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(INTL[getLocale()] ?? 'fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Libelle d'une raison (« non envoye : ... ») ; erreur Brevo brute : code garde. */
export function smsReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '';
  if (reason.startsWith('societe_de_test')) return t('sms.reason_test_company');
  if (isKnownReason(reason)) return t(`sms.reason_${reason}`);
  if (reason.startsWith('brevo_')) return fillVars(t('sms.reason_brevo'), { code: reason.slice(6) });
  return reason;
}

/** Libelle d'une erreur serveur (codes SMS_* de la base / de la fonction Edge). */
export function smsErrorLabel(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const code = (msg.match(/SMS_[A-Z_]+/) ?? [])[0];
  if (code) {
    const label = t(`sms.errors.${code}`);
    if (label !== `sms.errors.${code}`) return label;
  }
  if (isKnownReason(msg) || msg.startsWith('brevo_')) return smsReasonLabel(msg);
  return fillVars(t('sms.errors.generic'), { msg });
}

export function SmsStatusBadge({ status, reason }: { status: string; reason?: string | null }) {
  const label = t(`sms.status_${status}`);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusBadge tone={smsStatusTone(status)} icon={STATUS_ICON[status] ?? TriangleAlert} label={label.startsWith('sms.') ? status : label} />
      {reason && status !== 'sent' && <span className="text-[12px] text-muted-foreground">{smsReasonLabel(reason)}</span>}
    </span>
  );
}

function templateLabel(tpl: string | null): string {
  if (tpl === 'workshop_ready' || tpl === 'appointment_reminder_sms' || tpl === 'sms_test') return t(`sms.template_${tpl}`);
  return t('sms.template_other');
}

export const smsListKey = (companyId: string, scope: string) => ['sms-list', companyId, scope] as const;

function SmsTable({ rows, canCancel, onCancel, busyId, scheduled }: {
  rows: SmsRow[]; canCancel: boolean; onCancel: (r: SmsRow) => void; busyId: number | null; scheduled: boolean;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-[13px] text-muted-foreground">{t('sms.list.empty')}</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table className="font-data text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead>{scheduled ? t('sms.list.colDate') : t('sms.list.colSent')}</TableHead>
            <TableHead>{t('sms.list.colType')}</TableHead>
            <TableHead>{t('sms.list.colClient')}</TableHead>
            <TableHead>{t('sms.list.colNumber')}</TableHead>
            <TableHead>{t('sms.list.colText')}</TableHead>
            <TableHead>{t('sms.list.colStatus')}</TableHead>
            {scheduled && canCancel && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap tabular-nums">{fmtDateTime(scheduled ? r.scheduled_at : (r.sent_at ?? r.cancelled_at ?? r.created_at))}</TableCell>
              <TableCell className="whitespace-nowrap">{templateLabel(r.template)}</TableCell>
              <TableCell>{r.contact_name ?? ''}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {r.to_address}
                {r.is_test && r.sent_to && <span className="ml-1 text-[12px] text-info">({fillVars(t('sms.list.testBadge'), { to: r.sent_to })})</span>}
              </TableCell>
              <TableCell className="max-w-[360px] text-[12px] text-muted-foreground">{r.body}</TableCell>
              <TableCell><SmsStatusBadge status={r.status} reason={r.error} /></TableCell>
              {scheduled && canCancel && (
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => onCancel(r)} disabled={busyId === r.id}>
                    {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />} {t('sms.list.cancel')}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Liste « SMS programmes » + historique. */
export function SmsQueueList({ companyId, canCancel }: { companyId: string; canCancel: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'scheduled' | 'history'>('scheduled');
  const q = useQuery({ queryKey: smsListKey(companyId, tab), queryFn: () => listSms(companyId, tab), refetchInterval: 60_000 });
  const [busyId, setBusyId] = useState<number | null>(null);
  const cancel = useMutation({
    meta: { success: false, error: false },
    mutationFn: async (r: SmsRow) => {
      const ok = await confirm({ title: t('sms.list.cancelConfirmTitle'), message: t('sms.list.cancelConfirmMsg'), confirmLabel: t('sms.list.cancel'), variant: 'delete' });
      if (!ok) return false;
      setBusyId(r.id);
      await cancelSms(r.id);
      return true;
    },
    onSuccess: (done) => {
      if (done) toast.success(t('sms.list.cancelled'));
      qc.invalidateQueries({ queryKey: ['sms-list', companyId] });
    },
    onError: (e) => toast.error(smsErrorLabel(e)),
    onSettled: () => setBusyId(null),
  });
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as 'scheduled' | 'history')}>
      <div className="flex items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="scheduled"><CalendarClock className="size-4" /> {t('sms.list.title')}</TabsTrigger>
          <TabsTrigger value="history"><MessageSquareText className="size-4" /> {t('sms.list.history')}</TabsTrigger>
        </TabsList>
        <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`size-4 ${q.isFetching ? 'animate-spin' : ''}`} /> {t('sms.list.refresh')}
        </Button>
      </div>
      {(['scheduled', 'history'] as const).map((s) => (
        <TabsContent key={s} value={s} className="mt-3">
          {q.isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" />
            : q.isError ? <p className="text-[13px] text-danger">{smsErrorLabel(q.error)}</p>
            : <SmsTable rows={q.data ?? []} canCancel={canCancel} onCancel={(r) => cancel.mutate(r)} busyId={busyId} scheduled={s === 'scheduled'} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const plusDaysYmd = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** « Programmer des SMS de rappel » (G8 « SMS programmes sur RDV atelier »). */
export function ScheduleSmsForm({ companyId, onDone }: { companyId: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const typesQ = useQuery({ queryKey: ['planning-g8', companyId, 'types'], queryFn: () => listAppointmentTypes(companyId), staleTime: 300_000 });
  const [from, setFrom] = useState(todayYmd());
  const [to, setTo] = useState(plusDaysYmd(todayYmd(), 7));
  const [type, setType] = useState('');
  const [onlyChecked, setOnlyChecked] = useState(true);
  const [whenMode, setWhenMode] = useState<'lead' | 'fixed'>('lead');
  const [lead, setLead] = useState({ d: 1, h: 0, m: 0 });
  const [daysBefore, setDaysBefore] = useState(1);
  const [atTime, setAtTime] = useState('17:00');
  const [text, setText] = useState('');
  const size = smsSize(text);
  const leadMinutes = joinLead(lead);
  const valid = !!from && !!to && to >= from && (whenMode === 'fixed' ? !!atTime && daysBefore >= 0 && daysBefore <= 14 : leadMinutes >= 10) && text.length <= 480;

  const run = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => scheduleAppointmentSms(companyId, {
      from, to, type: type || null, onlyChecked, template: text || null,
      ...(whenMode === 'fixed' ? { daysBefore, atTime } : { leadMinutes }),
    }),
    onSuccess: (r) => {
      toast.success(fillVars(t('sms.schedule.result'), Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? 0)]))));
      qc.invalidateQueries({ queryKey: ['sms-list', companyId] });
      onDone?.();
    },
    onError: (e) => toast.error(smsErrorLabel(e)),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1"><Label>{t('sms.schedule.from')}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div className="space-y-1"><Label>{t('sms.schedule.to')}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div className="space-y-1">
          <Label>{t('sms.schedule.type')}</Label>
          <Select value={type || '__all'} onValueChange={(v) => setType(v === '__all' ? '' : v)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t('sms.schedule.typeAll')}</SelectItem>
              {(typesQ.data ?? []).map((ty) => <SelectItem key={ty.code} value={ty.code}>{ty.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <Checkbox checked={onlyChecked} onCheckedChange={(v) => setOnlyChecked(v === true)} /> {t('sms.schedule.onlyChecked')}
      </label>
      <div className="space-y-1">
        <Label>{t('sms.schedule.when')}</Label>
        <Select value={whenMode} onValueChange={(v) => setWhenMode(v as 'lead' | 'fixed')}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="lead">{t('sms.schedule.whenLead')}</SelectItem>
            <SelectItem value="fixed">{t('sms.schedule.whenFixed')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {whenMode === 'lead' ? (
        <div className="flex flex-wrap items-end gap-2">
          {(['d', 'h', 'm'] as const).map((k) => (
            <div key={k} className="space-y-1">
              <Label>{t(k === 'd' ? 'sms.days' : k === 'h' ? 'sms.hours' : 'sms.minutes')}</Label>
              <Input type="number" min={0} className="w-24 text-right tabular-nums" value={String(lead[k])}
                     onChange={(e) => setLead({ ...lead, [k]: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label>{t('sms.schedule.daysBefore')}</Label>
            <Input type="number" min={0} max={14} className="w-24 text-right tabular-nums" value={String(daysBefore)} onChange={(e) => setDaysBefore(Math.round(Number(e.target.value) || 0))} /></div>
          <div className="space-y-1"><Label>{t('sms.schedule.atTime')}</Label>
            <Input type="time" className="w-32" value={atTime} onChange={(e) => setAtTime(e.target.value)} /></div>
        </div>
      )}
      <div className="space-y-1">
        <Label>{t('sms.schedule.text')}</Label>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={480} />
        <p className="text-[12px] text-muted-foreground">{fillVars(t('sms.schedule.textHint'), { list: SMS_VARS.reminder.map((v) => `{${v}}`).join(' ') })}</p>
        {text && <p className="text-[12px] tabular-nums text-muted-foreground">{fillVars(t('sms.templates.size'), { units: String(size.units), segments: String(size.segments) })}{size.encoding === 'unicode' ? ` · ${t('sms.templates.unicode')}` : ''}</p>}
      </div>
      <Button onClick={() => run.mutate()} disabled={!valid || run.isPending}>
        {run.isPending ? <Loader2 className="animate-spin" /> : <CalendarClock />} {t('sms.schedule.submit')}
      </Button>
    </div>
  );
}

/** Fenetre ouverte depuis le planning atelier : liste + programmation. */
export function ScheduledSmsDialog({ companyId, canWrite, onClose }: { companyId: string; canWrite: boolean; onClose: () => void }) {
  const [planning, setPlanning] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>{t('sms.list.title')}</DialogTitle></DialogHeader>
        {planning
          ? <ScheduleSmsForm companyId={companyId} onDone={() => setPlanning(false)} />
          : <SmsQueueList companyId={companyId} canCancel={canWrite} />}
        <DialogFooter>
          {canWrite && !planning && <Button variant="outline" onClick={() => setPlanning(true)}><CalendarClock /> {t('sms.schedule.open')}</Button>}
          {planning && <Button variant="outline" onClick={() => setPlanning(false)}>{t('sms.list.title')}</Button>}
          <Button variant="outline" onClick={onClose}>{t('sms.list.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ecran de l'OR : etat du SMS automatique de fin de travaux (programme, envoye, non envoye et
 * pourquoi). Rien tant que l'OR n'est pas passe a « Pret » ou si la migration n'est pas en base.
 */
export function ReadySmsLine({ orId, status }: { orId: string; status: string | null | undefined }) {
  const show = status === 'pret' || status === 'client_informe' || status === 'facture';
  const q = useQuery({ queryKey: ['sms-ready', orId, status], queryFn: () => getSmsReadyState(orId), enabled: show, refetchInterval: show ? 60_000 : false });
  if (!show || !q.data) return null;
  const d = q.data;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 font-data text-[13px] text-muted-foreground">
      <MessageSquareText className="size-4" /> {t('sms.orState.label')} :
      <SmsStatusBadge status={d.status} reason={d.reason} />
      {d.at && <span className="tabular-nums">{fmtDateTime(d.at)}</span>}
    </span>
  );
}
