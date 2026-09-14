/**
 * M10 — Fiche d'une demande.
 *
 * LE MODÈLE : une demande = une carte = un client. Elle porte
 *   · UNE SEULE tâche en cours (ce qu'il faut faire, pour quand, par qui) ;
 *   · l'historique des tâches faites, en liste chronologique ;
 *   · les échanges avec le client, où l'on répond par mail ;
 *   · les documents liés.
 *
 * On ne crée JAMAIS une deuxième carte pour le même client : on termine la tâche
 * en cours et on en ouvre une nouvelle sur la même carte. La version précédente
 * créait une nouvelle demande à chaque relance, ce qui dupliquait les cartes.
 * Un index unique en base interdit deux tâches ouvertes sur une même demande.
 *
 * À la fermeture on ne parle pas de gagné ni de perdu : on dit si la tâche est
 * toujours à faire, ou si elle est faite, auquel cas on ouvre la suivante.
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2, Save, Clock, History, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/phone-input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { CommunicationsPanel } from './communications-panel';
import {
  updateLead, deleteLead, listLeadAudit, listCompanyMembers,
  listLeadTasks, createLeadTask, completeLeadTask, updateLeadTask, openTask,
  LEAD_STAGES, dueState, type Lead,
} from './api';
import { t } from '@/lib/i18n';

const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };

/** timestamptz → valeur d'un <input type="datetime-local"> (heure locale). */
const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const plusDays = (n: number) => toLocalInput(new Date(Date.now() + n * 864e5).toISOString());
const stamp = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function LeadDetail({ lead, companyId, onClose, onChanged }: { lead: Lead; companyId: string; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: lead.name ?? '', email: lead.email ?? '', phone: lead.phone ?? '',
    vehicle_interest: lead.vehicle_interest ?? '',
    estimated_value: lead.estimated_value != null ? String(lead.estimated_value) : '',
    stage: lead.stage, notes: lead.notes ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);

  const tasks = useQuery({ queryKey: ['lead-tasks', lead.id], queryFn: () => listLeadTasks(lead.id) });
  const audit = useQuery({ queryKey: ['lead-audit', lead.id], queryFn: () => listLeadAudit(lead.id) });
  const members = useQuery({ queryKey: ['company-members', companyId], queryFn: () => listCompanyMembers(companyId) });
  const memberName = (id: string | null | undefined) => members.data?.find((m) => m.user_id === id)?.name ?? null;

  const current = openTask(tasks.data);
  const done = (tasks.data ?? []).filter((x) => x.done_at);
  const late = dueState(current?.due_at) === 'overdue';

  // Champs de la tâche en cours, modifiables directement.
  const [tt, setTt] = useState('');
  const [td, setTd] = useState('');
  const [tw, setTw] = useState('');
  const loaded = useState(() => ({ id: '' }))[0];
  if (current && loaded.id !== current.id) {
    loaded.id = current.id;
    setTt(current.title);
    setTd(toLocalInput(current.due_at));
    setTw(current.assigned_to);
  }

  // Champs de la tâche suivante (boîte de sortie, ou carte sans tâche).
  const [nt, setNt] = useState('');
  const [nd, setNd] = useState(plusDays(2));
  const [nw, setNw] = useState('');

  const refresh = () => {
    onChanged();
    qc.invalidateQueries({ queryKey: ['leads', companyId] });
    qc.invalidateQueries({ queryKey: ['leads-due', companyId] });
    tasks.refetch(); audit.refetch();
  };

  const saveLead = useMutation({
    mutationFn: () => updateLead(lead.id, {
      name: f.name, email: f.email || null, phone: f.phone || null,
      vehicle_interest: f.vehicle_interest || null,
      estimated_value: f.estimated_value ? num(f.estimated_value) : null,
      stage: f.stage, notes: f.notes || null,
    }),
    onSuccess: () => { setMsg(t('crm.saved')); refresh(); },
  });

  const saveTask = useMutation({
    mutationFn: () => updateLeadTask(current!.id, {
      title: tt, due_at: td ? new Date(td).toISOString() : current!.due_at, assigned_to: tw,
    }),
    onSuccess: () => { setMsg(t('crm.saved')); refresh(); },
  });

  const del = useMutation({ mutationFn: () => deleteLead(lead.id), onSuccess: () => { onChanged(); onClose(); } });

  /** Terminer la tâche en cours et ouvrir la suivante, sur la MÊME carte. */
  const finishAndNext = useMutation({
    mutationFn: async () => {
      if (current) await completeLeadTask(current.id);
      await createLeadTask({
        companyId, leadId: lead.id, title: nt,
        dueAt: nd ? new Date(nd).toISOString() : new Date(Date.now() + 2 * 864e5).toISOString(),
        assignedTo: nw,
      });
    },
    onSuccess: () => { refresh(); setExiting(false); onClose(); },
    onError: (e) => setErr(e instanceof Error && e.message === 'TASK_ALREADY_OPEN' ? t('crm.taskAlreadyOpen') : String(e)),
  });

  /** Toujours à faire : on se contente éventuellement de repousser la date. */
  const keepTask = useMutation({
    mutationFn: async () => {
      if (current && late && nd) await updateLeadTask(current.id, { due_at: new Date(nd).toISOString() });
    },
    onSuccess: () => { refresh(); setExiting(false); onClose(); },
  });

  const nextReady = nt.trim().length > 0 && nw.length > 0;

  return (
    <>
      <Dialog open={!exiting} onOpenChange={(o) => { if (!o) { setErr(null); setNt(''); setNd(plusDays(2)); setNw(current?.assigned_to ?? ''); setExiting(true); } }}>
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-3 pr-6">
            <span>{f.name || lead.name}</span>
            <Button variant="ghost" size="sm" className="ml-auto text-danger" onClick={() => { if (confirm(t('crm.confirmDel'))) del.mutate(); }} disabled={del.isPending}>
              <Trash2 className="size-4" /> {t('crm.del')}
            </Button>
          </DialogTitle></DialogHeader>

          {/* ---------- LA TÂCHE EN COURS, en tête ---------- */}
          <div className={`rounded-md border p-3 ${late ? 'border-[var(--danger)]' : 'border-border'}`}>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              <Clock className="size-3.5" /> {t('crm.currentTask')}
              {late && <span className="text-[var(--danger)]">· {t('crm.dueOverdue')}</span>}
            </p>
            {!current && <p className="text-[13px] text-muted-foreground">{t('crm.noOpenTask')}</p>}
            {current && (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Field label={t('crm.taskTitle')}><Input value={tt} onChange={(e) => setTt(e.target.value)} placeholder={t('crm.taskTitlePlaceholder')} /></Field>
                <Field label={t('crm.taskDue')}><Input type="datetime-local" value={td} onChange={(e) => setTd(e.target.value)} /></Field>
                <Field label={t('crm.taskWho')}>
                  <Select value={tw} onValueChange={setTw}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{members.data?.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <div className="flex items-end gap-2">
                  <Button variant="outline" onClick={() => saveTask.mutate()} disabled={saveTask.isPending || !tt.trim() || !tw}>
                    {saveTask.isPending ? <Loader2 className="animate-spin" /> : <Save className="size-4" />}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            {/* ---------- Le client ---------- */}
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('crm.details')}</p>
              <Field label={t('crm.leadName')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label={t('crm.email')}><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
              <Field label={t('crm.phone')}><PhoneInput value={f.phone} onChange={(v) => set('phone', v)} /></Field>
              <Field label={t('crm.vehicleInterest')}><Input value={f.vehicle_interest} onChange={(e) => set('vehicle_interest', e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('crm.stage')}>
                  <Select value={f.stage} onValueChange={(v) => set('stage', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{LEAD_STAGES.map((x) => <SelectItem key={x} value={x}>{t(`crm.stage_${x}`)}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label={t('crm.value')}><Input type="number" value={f.estimated_value} onChange={(e) => set('estimated_value', e.target.value)} className="text-right tabular-nums" /></Field>
              </div>
              <Field label={t('crm.notes')}><Textarea rows={4} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
              <div className="flex items-center gap-2">
                <Button onClick={() => saveLead.mutate()} disabled={saveLead.isPending}>
                  {saveLead.isPending ? <Loader2 className="animate-spin" /> : <Save className="size-4" />} {t('crm.save')}
                </Button>
                {msg && <span className="text-[12px] text-success">{msg}</span>}
              </div>
            </div>

            {/* ---------- Échanges · Tâches faites · Documents ---------- */}
            <div className="min-w-0">
              <Tabs defaultValue={lead.contact_id ? 'thread' : 'history'}>
                <TabsList>
                  {lead.contact_id && <TabsTrigger value="thread">{t('crm.thread')}</TabsTrigger>}
                  <TabsTrigger value="history">{t('crm.taskHistory')}</TabsTrigger>
                  <TabsTrigger value="docs">{t('crm.documents')}</TabsTrigger>
                  <TabsTrigger value="followup">{t('crm.followup')}</TabsTrigger>
                </TabsList>

                {lead.contact_id && (
                  <TabsContent value="thread" className="mt-3">
                    <CommunicationsPanel companyId={companyId} contactId={lead.contact_id} />
                  </TabsContent>
                )}

                <TabsContent value="history" className="mt-3">
                  {done.length === 0 && <p className="text-[12px] text-muted-foreground">{t('crm.noTaskHistory')}</p>}
                  <div className="max-h-80 space-y-1.5 overflow-auto">
                    {done.map((x) => (
                      <div key={x.id} className="rounded-md border border-border px-2.5 py-1.5 text-[12px]">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-success" />
                          <span className="font-medium">{x.title}</span>
                          <span className="ml-auto text-muted-foreground">{stamp(x.done_at)}</span>
                        </div>
                        <p className="mt-0.5 text-muted-foreground">
                          {t('crm.taskDoneBy')} {memberName(x.done_by) ?? '—'} · {t('crm.taskDueWas')} {stamp(x.due_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="docs" className="mt-3">
                  <AttachmentsPanel
                    companyId={companyId}
                    entityType={lead.contact_id ? 'contact' : 'lead'}
                    entityId={lead.contact_id ?? lead.id}
                  />
                </TabsContent>

                <TabsContent value="followup" className="mt-3">
                  {audit.data?.length === 0 && <p className="text-[12px] text-muted-foreground">{t('crm.noFollowup')}</p>}
                  <div className="max-h-80 space-y-1.5 overflow-auto">
                    {audit.data?.map((a, i) => (
                      <div key={`${a.occurred_at}-${i}`} className="rounded-md border border-border px-2.5 py-1.5 text-[12px]">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <History className="size-3.5" />
                          <span className="font-medium text-foreground">{t(`crm.act_${a.action}`)}</span>
                          <span>· {a.actor}</span>
                          <span className="ml-auto">{stamp(a.occurred_at)}</span>
                        </div>
                        {a.changes && <p className="mt-0.5 break-words text-muted-foreground">{a.changes}</p>}
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Sortie : la tâche est-elle faite ? ---------- */}
      <Dialog open={exiting} onOpenChange={(o) => { if (!o) setExiting(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('crm.closeTitle')}</DialogTitle></DialogHeader>

          {current && (
            <>
              <p className="text-[13px]"><span className="font-medium">{current.title}</span> · {stamp(current.due_at)} · {memberName(current.assigned_to) ?? '—'}</p>

              <div className="space-y-2 rounded-md border border-border p-2.5">
                <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('crm.exitStillToDo')}</p>
                {late && <p className="text-[12px] text-[var(--danger)]">{t('crm.exitOverdueHint')}</p>}
                {late && <Input type="datetime-local" value={nd} onChange={(e) => setNd(e.target.value)} />}
                <Button variant="outline" className="w-full" onClick={() => keepTask.mutate()} disabled={keepTask.isPending || (late && !nd)}>
                  {keepTask.isPending ? <Loader2 className="animate-spin" /> : <Clock className="size-4" />} {t('crm.exitStillToDo')}
                </Button>
              </div>
            </>
          )}

          <div className="space-y-2 rounded-md border border-border p-2.5">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              {current ? t('crm.exitDoneAndNext') : t('crm.noOpenTask')}
            </p>
            <Input value={nt} onChange={(e) => setNt(e.target.value)} placeholder={t('crm.taskTitlePlaceholder')} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="datetime-local" value={nd} onChange={(e) => setNd(e.target.value)} />
              <Select value={nw} onValueChange={setNw}>
                <SelectTrigger><SelectValue placeholder={t('crm.taskWho')} /></SelectTrigger>
                <SelectContent>{members.data?.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={() => { setErr(null); finishAndNext.mutate(); }} disabled={finishAndNext.isPending || !nextReady}>
              {finishAndNext.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 className="size-4" />}
              {current ? t('crm.exitDoneCreate') : t('crm.exitNoTaskCreate')}
            </Button>
            {err && <p className="text-[12px] text-[var(--danger)]">{err}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
