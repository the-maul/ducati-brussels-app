/**
 * M10 — Fiche d'une demande (la « carte »).
 *
 * LE FLUX, EN TROIS SORTIES ET TROIS SEULEMENT :
 *   1. la tâche reste à faire  → on ferme, rien ne bouge ;
 *   2. la tâche est faite      → on dit tout de suite la suivante (même carte) ;
 *   3. plus rien à faire       → on archive la carte.
 *
 * Une carte ne reste JAMAIS sans tâche : si elle se retrouve sans tâche et sans
 * archivage, une boîte de dialogue le rappelle avant de fermer. Tant qu'une
 * tâche est en cours, fermer la carte ne pose aucune question.
 *
 * On ne crée jamais une deuxième carte pour le même client : « c'est fait » +
 * la tâche suivante se font sur la même carte (index unique en base : une seule
 * tâche ouverte par demande).
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2, Save, Clock, History, CheckCircle2, Archive, Pencil, AlertTriangle } from 'lucide-react';
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
  updateLead, deleteLead, archiveLead, listLeadAudit, listCompanyMembers,
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

/** Ce que l'utilisateur est en train de faire dans l'en-tête de la carte. */
type Mode = 'view' | 'edit' | 'next' | 'archive';

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
  const [mode, setMode] = useState<Mode>('view');
  const [exiting, setExiting] = useState(false);

  const tasks = useQuery({ queryKey: ['lead-tasks', lead.id], queryFn: () => listLeadTasks(lead.id) });
  const audit = useQuery({ queryKey: ['lead-audit', lead.id], queryFn: () => listLeadAudit(lead.id) });
  const members = useQuery({ queryKey: ['company-members', companyId], queryFn: () => listCompanyMembers(companyId) });
  const memberName = (id: string | null | undefined) => members.data?.find((m) => m.user_id === id)?.name ?? null;

  const current = openTask(tasks.data);
  const done = (tasks.data ?? []).filter((x) => x.done_at);
  const late = dueState(current?.due_at) === 'overdue';

  // Champs de la tâche en cours (mode « Modifier la tâche »).
  const [tt, setTt] = useState('');
  const [td, setTd] = useState('');
  const [tw, setTw] = useState('');
  const loaded = useState(() => ({ id: '' }))[0];
  if (current && loaded.id !== current.id) {
    loaded.id = current.id;
    setTt(current.title); setTd(toLocalInput(current.due_at)); setTw(current.assigned_to);
  }

  // Champs de la tâche SUIVANTE.
  const [nt, setNt] = useState('');
  const [nd, setNd] = useState(plusDays(2));
  const [nw, setNw] = useState('');
  const who = nw || current?.assigned_to || '';
  const [reason, setReason] = useState('');

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
    onSuccess: () => { setMsg(t('crm.saved')); setMode('view'); refresh(); },
  });

  const del = useMutation({ mutationFn: () => deleteLead(lead.id), onSuccess: () => { onChanged(); onClose(); } });

  /** « C'est fait » + la suivante, en un seul geste, sur la MÊME carte. */
  const finishAndNext = useMutation({
    mutationFn: async () => {
      if (current) await completeLeadTask(current.id);
      await createLeadTask({
        companyId, leadId: lead.id, title: nt.trim(),
        dueAt: nd ? new Date(nd).toISOString() : new Date(Date.now() + 2 * 864e5).toISOString(),
        assignedTo: who,
      });
    },
    onSuccess: () => {
      setNt(''); setNd(plusDays(2)); setMode('view'); refresh();
      if (exiting) { setExiting(false); onClose(); }
    },
    onError: (e) => setErr(e instanceof Error && e.message === 'TASK_ALREADY_OPEN' ? t('crm.taskAlreadyOpen') : String(e)),
  });

  /** Plus rien à faire : la carte quitte le pipeline (elle n'est pas supprimée). */
  const archive = useMutation({
    mutationFn: () => archiveLead(lead.id, reason || null),
    onSuccess: () => { onChanged(); setExiting(false); onClose(); },
    onError: (e) => setErr(String(e)),
  });

  const nextReady = nt.trim().length > 0 && who.length > 0 && !!nd;

  /** Le formulaire de la tâche suivante — identique partout, pour qu'on le reconnaisse. */
  const nextTaskForm = (label: string) => (
    <div className="space-y-2">
      <p className="text-[13px] font-medium">{t('crm.nextAsk')}</p>
      <p className="text-[12px] text-muted-foreground">{t('crm.nextHelp')}</p>
      <Field label={t('crm.taskTitle')}>
        <Input value={nt} onChange={(e) => setNt(e.target.value)} placeholder={t('crm.taskTitlePlaceholder')} />
      </Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t('crm.taskDue')}><Input type="datetime-local" value={nd} onChange={(e) => setNd(e.target.value)} /></Field>
        <Field label={t('crm.taskWho')}>
          <Select value={who} onValueChange={setNw}>
            <SelectTrigger><SelectValue placeholder={t('crm.taskWho')} /></SelectTrigger>
            <SelectContent>{members.data?.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <Button className="w-full" onClick={() => { setErr(null); finishAndNext.mutate(); }} disabled={finishAndNext.isPending || !nextReady}>
        {finishAndNext.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 className="size-4" />} {label}
      </Button>
      {err && <p className="text-[12px] text-[var(--danger)]">{err}</p>}
    </div>
  );

  /** Le bloc d'archivage — identique partout lui aussi. */
  const archiveForm = () => (
    <div className="space-y-2">
      <p className="text-[13px] font-medium">{t('crm.archiveAsk')}</p>
      <p className="text-[12px] text-muted-foreground">{t('crm.archiveHelp')}</p>
      <Field label={t('crm.archiveReason')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('crm.archiveReasonPlaceholder')} />
      </Field>
      <Button variant="outline" className="w-full" onClick={() => archive.mutate()} disabled={archive.isPending}>
        {archive.isPending ? <Loader2 className="animate-spin" /> : <Archive className="size-4" />} {t('crm.archiveYes')}
      </Button>
    </div>
  );

  return (
    <>
      <Dialog open={!exiting} onOpenChange={(o) => {
        if (o) return;
        // On ne bloque QUE si la carte se retrouve sans tâche et sans archivage.
        if (current) { onClose(); return; }
        setErr(null); setNt(''); setNd(plusDays(2)); setExiting(true);
      }}>
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-3 pr-6">
            <span>{f.name || lead.name}</span>
            <Button variant="ghost" size="sm" className="ml-auto text-danger" onClick={() => { if (confirm(t('crm.confirmDel'))) del.mutate(); }} disabled={del.isPending}>
              <Trash2 className="size-4" /> {t('crm.del')}
            </Button>
          </DialogTitle></DialogHeader>

          {/* ---------- EN-TÊTE : ce qu'il faut faire, et les trois sorties ---------- */}
          <div className={`rounded-md border p-3 ${late || !current ? 'border-[var(--danger)]' : 'border-border'}`}>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              <Clock className="size-3.5" /> {t('crm.nowTodo')}
              {late && <span className="text-[var(--danger)]">· {t('crm.dueOverdue')}</span>}
            </p>

            {/* Pas de tâche : on le dit en clair, et on demande la suivante tout de suite. */}
            {!current && mode !== 'archive' && (
              <>
                <p className="mb-2 flex items-center gap-1.5 text-[13px] text-[var(--danger)]">
                  <AlertTriangle className="size-4" /> {t('crm.noTaskWarn')}
                </p>
                {nextTaskForm(t('crm.nextSaveOnly'))}
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => setMode('archive')}>
                  <Archive className="size-4" /> {t('crm.btnArchive')}
                </Button>
              </>
            )}

            {/* Tâche en cours : une phrase, puis trois boutons qui disent ce qu'ils font. */}
            {current && mode === 'view' && (
              <>
                <p className="text-[15px] font-medium">{current.title}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {t('crm.forWhen')} {stamp(current.due_at)} · {t('crm.byWho')} {memberName(current.assigned_to) ?? '—'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={() => { setErr(null); setNw(current.assigned_to); setMode('next'); }}>
                    <CheckCircle2 className="size-4" /> {t('crm.btnTaskDone')}
                  </Button>
                  <Button variant="outline" onClick={() => setMode('edit')}>
                    <Pencil className="size-4" /> {t('crm.btnTaskEdit')}
                  </Button>
                  <Button variant="outline" onClick={() => setMode('archive')}>
                    <Archive className="size-4" /> {t('crm.btnArchive')}
                  </Button>
                </div>
              </>
            )}

            {/* « C'est fait » → on enchaîne immédiatement sur la suivante. */}
            {current && mode === 'next' && (
              <>
                <p className="mb-2 text-[13px] text-muted-foreground">
                  <CheckCircle2 className="mr-1 inline size-4 text-success" />
                  <span className="line-through">{current.title}</span>
                </p>
                {nextTaskForm(t('crm.nextSaveDone'))}
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => { setErr(null); setMode('view'); }}>{t('crm.cancel')}</Button>
              </>
            )}

            {current && mode === 'edit' && (
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
                  <Button onClick={() => saveTask.mutate()} disabled={saveTask.isPending || !tt.trim() || !tw}>
                    {saveTask.isPending ? <Loader2 className="animate-spin" /> : <Save className="size-4" />} {t('crm.save')}
                  </Button>
                  <Button variant="ghost" onClick={() => setMode('view')}>{t('crm.cancel')}</Button>
                </div>
              </div>
            )}

            {mode === 'archive' && (
              <>
                {archiveForm()}
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => setMode('view')}>{t('crm.cancel')}</Button>
              </>
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

            {/* ---------- Échanges · Tâches faites · Documents · Suivi ---------- */}
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
                    <CommunicationsPanel companyId={companyId} contactId={lead.contact_id} defaultChannel="email" />
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

      {/* ---------- Sortie : uniquement si la carte n'a plus de tâche ---------- */}
      <Dialog open={exiting} onOpenChange={(o) => { if (!o) setExiting(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('crm.exitNoTaskTitle')}</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">{t('crm.exitNoTaskHelp')}</p>
          <div className="rounded-md border border-border p-2.5">{nextTaskForm(t('crm.nextSaveOnly'))}</div>
          <div className="rounded-md border border-border p-2.5">{archiveForm()}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
