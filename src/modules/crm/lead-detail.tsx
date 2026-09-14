/**
 * M10 — Fiche d'une demande (style Pipedrive).
 *
 * Trois panneaux à droite, en onglets, pour ne pas entasser :
 *   Échanges  — le fil de mails du client ET la réponse, depuis la boîte de son choix.
 *               On réutilise le panneau de la fiche client : il porte déjà l'éditeur
 *               enrichi, les pièces jointes et l'envoi réel par Outlook.
 *   Suivi     — qui a fait quoi et quand (fonction serveur `lead_audit`, car les
 *               profils ne sont lisibles que pour soi-même).
 *   Documents — rattachés à la FICHE CLIENT : c'est là que la relève dépose les
 *               pièces jointes des mails entrants.
 *
 * À la fermeture, on ne quitte pas sans se prononcer : traitée, reportée, ou
 * laissée en l'état. Une demande laissée en l'état revient dans les retards.
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2, Save, Plus, StickyNote, Phone, Mail, MessageSquare, Clock, History } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/phone-input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { CommunicationsPanel } from './communications-panel';
import {
  updateLead, deleteLead, listLeadActivities, addLeadActivity,
  listLeadAudit, listCompanyMembers, closeAndCreateFollowUp,
  LEAD_STAGES, dueState, type Lead,
} from './api';
import { t } from '@/lib/i18n';

const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const chanIcon: Record<string, ReactNode> = { note: <StickyNote className="size-3.5" />, call: <Phone className="size-3.5" />, email: <Mail className="size-3.5" />, sms: <MessageSquare className="size-3.5" /> };

/** timestamptz → valeur d'un <input type="datetime-local"> (heure locale, sans fuseau). */
const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const plusHours = (h: number) => toLocalInput(new Date(Date.now() + h * 3600_000).toISOString());

export function LeadDetail({ lead, companyId, onClose, onChanged }: { lead: Lead; companyId: string; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: lead.name ?? '', email: lead.email ?? '', phone: lead.phone ?? '',
    vehicle_interest: lead.vehicle_interest ?? '', source: lead.source ?? '',
    estimated_value: lead.estimated_value != null ? String(lead.estimated_value) : '', stage: lead.stage, notes: lead.notes ?? '',
    due_at: toLocalInput(lead.due_at),
    assigned_to: lead.assigned_to ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [note, setNote] = useState(''); const [chan, setChan] = useState('note'); const [msg, setMsg] = useState<string | null>(null);
  // Sortie de la carte : tant qu'on ne s'est pas prononcé, on demande.
  const [closing, setClosing] = useState(false);
  const [snoozeAt, setSnoozeAt] = useState(plusHours(48));
  // Passer le relais : clôturer celle-ci et ouvrir la suivante, confiée à quelqu'un.
  const [nextWhat, setNextWhat] = useState('');
  const [nextWho, setNextWho] = useState('');
  const [nextWhen, setNextWhen] = useState(plusHours(48));

  const acts = useQuery({ queryKey: ['lead-acts', lead.id], queryFn: () => listLeadActivities(lead.id) });
  const audit = useQuery({ queryKey: ['lead-audit', lead.id], queryFn: () => listLeadAudit(lead.id) });
  const members = useQuery({ queryKey: ['company-members', companyId], queryFn: () => listCompanyMembers(companyId) });
  const memberName = (id: string | null | undefined) => members.data?.find((m) => m.user_id === id)?.name ?? null;

  const refresh = () => { onChanged(); qc.invalidateQueries({ queryKey: ['leads', companyId] }); qc.invalidateQueries({ queryKey: ['leads-due', companyId] }); audit.refetch(); };

  const save = useMutation({
    mutationFn: () => updateLead(lead.id, {
      name: f.name, email: f.email || null, phone: f.phone || null, vehicle_interest: f.vehicle_interest || null,
      source: f.source || null, estimated_value: f.estimated_value ? num(f.estimated_value) : null, stage: f.stage, notes: f.notes || null,
      due_at: f.due_at ? new Date(f.due_at).toISOString() : null,
      assigned_to: f.assigned_to || null,
    }),
    onSuccess: () => { setMsg(t('crm.saved')); refresh(); },
  });
  const del = useMutation({ mutationFn: () => deleteLead(lead.id), onSuccess: () => { onChanged(); onClose(); } });
  const addAct = useMutation({
    mutationFn: () => addLeadActivity({ companyId, leadId: lead.id, contactId: lead.contact_id, channel: chan, body: note }),
    onSuccess: () => { setNote(''); acts.refetch(); audit.refetch(); },
  });
  /** Clôture celle-ci et ouvre la suivante, confiée à quelqu'un. */
  const relay = useMutation({
    mutationFn: () => closeAndCreateFollowUp({
      companyId, lead, stage: 'gagne',
      what: nextWhat, assignedTo: nextWho || null,
      dueAt: nextWhen ? new Date(nextWhen).toISOString() : null,
    }),
    onSuccess: () => { refresh(); setClosing(false); onClose(); },
  });
  /** Clôture ou report depuis la boîte de sortie. */
  const closeWith = useMutation({
    mutationFn: (p: { stage?: string; due_at?: string | null }) => updateLead(lead.id, p),
    onSuccess: () => { refresh(); setClosing(false); onClose(); },
  });

  const due = dueState(lead.due_at);

  return (
    <>
      <Dialog open={!closing} onOpenChange={(o) => { if (!o) setClosing(true); }}>
        {/* La carte dépasse la hauteur de l'écran dès que le fil de mails est long :
            sans hauteur bornée ni défilement, le bas devenait inatteignable. */}
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-3 pr-6">
            <span>{f.name || lead.name}</span>
            {due === 'overdue' && <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium text-[var(--danger)]"><Clock className="size-3.5" />{t('crm.dueOverdue')}</span>}
            {due === 'today' && <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium text-[var(--warning)]"><Clock className="size-3.5" />{t('crm.dueToday')}</span>}
            <Button variant="ghost" size="sm" className="ml-auto text-danger" onClick={() => { if (confirm(t('crm.confirmDel'))) del.mutate(); }} disabled={del.isPending}><Trash2 className="size-4" /> {t('crm.del')}</Button>
          </DialogTitle></DialogHeader>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            {/* ---------- Détails éditables ---------- */}
            <div className="space-y-2">
              {/* Ce qu'il y a à faire, en tête et en évidence : c'est la première
                  question que se pose celui qui ouvre la carte. */}
              <div className={`rounded-md border p-3 ${due === 'overdue' ? 'border-[var(--danger)]' : due === 'today' ? 'border-[var(--warning)]' : 'border-border'}`}>
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                  <Clock className="size-3.5" /> {t('crm.toDo')}
                </p>
                <p className="text-[13px]">{lead.notes?.split('\n')[0] || t('crm.toDoNone')}</p>
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  {t('crm.assignedTo')} : <span className="font-medium text-foreground">{memberName(lead.assigned_to) ?? t('crm.assigneeNone')}</span>
                  {lead.due_at && <> · {t('crm.dueAt')} {new Date(lead.due_at).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}</>}
                </p>
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('crm.details')}</p>
              <Field label={t('crm.leadName')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
              {/* E-mail et téléphone sur toute la largeur : côte à côte, le sélecteur
                  d'indicatif rognait le numéro au point de le rendre illisible. */}
              <Field label={t('crm.email')}><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
              <Field label={t('crm.phone')}><PhoneInput value={f.phone} onChange={(v) => set('phone', v)} /></Field>
              <Field label={t('crm.vehicleInterest')}><Input value={f.vehicle_interest} onChange={(e) => set('vehicle_interest', e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('crm.source')}><Input value={f.source} onChange={(e) => set('source', e.target.value)} /></Field>
                <Field label={t('crm.value')}><Input type="number" value={f.estimated_value} onChange={(e) => set('estimated_value', e.target.value)} className="text-right tabular-nums" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('crm.stage')}>
                  <Select value={f.stage} onValueChange={(v) => set('stage', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{LEAD_STAGES.map((x) => <SelectItem key={x} value={x}>{t(`crm.stage_${x}`)}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label={t('crm.dueAt')}>
                  <Input type="datetime-local" value={f.due_at} onChange={(e) => set('due_at', e.target.value)} />
                </Field>
              </div>
              <p className="text-[11px] text-muted-foreground">{t('crm.dueHint')}</p>
              <Field label={t('crm.assignee')}>
                <Select value={f.assigned_to || '__none__'} onValueChange={(v) => set('assigned_to', v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('crm.assigneeNone')}</SelectItem>
                    {members.data?.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('crm.notes')}><Textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
              <div className="flex items-center gap-2">
                <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save className="size-4" />} {t('crm.save')}</Button>
                {msg && <span className="text-[12px] text-success">{msg}</span>}
              </div>
            </div>

            {/* ---------- Échanges · Suivi · Documents ---------- */}
            <div className="min-w-0">
              <Tabs defaultValue={lead.contact_id ? 'thread' : 'activity'}>
                <TabsList>
                  {lead.contact_id && <TabsTrigger value="thread">{t('crm.thread')}</TabsTrigger>}
                  <TabsTrigger value="activity">{t('crm.activity')}</TabsTrigger>
                  <TabsTrigger value="followup">{t('crm.followup')}</TabsTrigger>
                  <TabsTrigger value="docs">{t('crm.documents')}</TabsTrigger>
                </TabsList>

                {/* Fil de mails + réponse. Le panneau lit les échanges du CLIENT :
                    les mails captés par la relève portent son identifiant, pas celui
                    de la demande, et n'apparaissaient donc nulle part ici. */}
                {lead.contact_id && (
                  <TabsContent value="thread" className="mt-3">
                    <CommunicationsPanel companyId={companyId} contactId={lead.contact_id} />
                  </TabsContent>
                )}

                <TabsContent value="activity" className="mt-3 space-y-3">
                  <div className="flex gap-2">
                    <Select value={chan} onValueChange={setChan}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="note">{t('crm.channel_note')}</SelectItem>
                        <SelectItem value="call">{t('crm.channel_call')}</SelectItem>
                        <SelectItem value="email">{t('crm.channel_email')}</SelectItem>
                        <SelectItem value="sms">{t('crm.channel_sms')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('crm.notePlaceholder')} onKeyDown={(e) => e.key === 'Enter' && note.trim() && addAct.mutate()} />
                    <Button variant="outline" onClick={() => addAct.mutate()} disabled={addAct.isPending || !note.trim()}><Plus className="size-4" /></Button>
                  </div>
                  <div className="max-h-72 space-y-1.5 overflow-auto">
                    {acts.data?.length === 0 && <p className="text-[12px] text-muted-foreground">{t('crm.noActivity')}</p>}
                    {acts.data?.map((a) => (
                      <div key={a.id} className="rounded-md border border-border px-2.5 py-1.5 text-[12px]">
                        <div className="flex items-center gap-1.5 text-muted-foreground">{chanIcon[a.channel] ?? null}<span className="font-medium text-foreground">{t(`crm.channel_${a.channel}`)}</span><span className="ml-auto">{new Date(a.occurred_at).toLocaleString('fr-BE')}</span></div>
                        {a.body && <p className="mt-0.5">{a.body}</p>}
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="followup" className="mt-3">
                  {audit.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                  {audit.data?.length === 0 && <p className="text-[12px] text-muted-foreground">{t('crm.noFollowup')}</p>}
                  <div className="max-h-80 space-y-1.5 overflow-auto">
                    {audit.data?.map((a, i) => (
                      <div key={`${a.occurred_at}-${i}`} className="rounded-md border border-border px-2.5 py-1.5 text-[12px]">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <History className="size-3.5" />
                          <span className="font-medium text-foreground">{t(`crm.act_${a.action}`)}</span>
                          <span>· {a.actor}</span>
                          <span className="ml-auto">{new Date(a.occurred_at).toLocaleString('fr-BE')}</span>
                        </div>
                        {a.changes && <p className="mt-0.5 break-words text-muted-foreground">{a.changes}</p>}
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="docs" className="mt-3">
                  {/* Les pièces jointes des mails entrants sont déposées par la relève sur la
                      FICHE CLIENT. Une tâche créée à la main sans client garde son dossier. */}
                  <AttachmentsPanel
                    companyId={companyId}
                    entityType={lead.contact_id ? 'contact' : 'lead'}
                    entityId={lead.contact_id ?? lead.id}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Sortie : on se prononce ---------- */}
      <Dialog open={closing} onOpenChange={(o) => { if (!o) setClosing(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('crm.closeTitle')}</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">{t('crm.closeQuestion')}</p>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => closeWith.mutate({ stage: 'gagne' })} disabled={closeWith.isPending}>{t('crm.closeDoneWon')}</Button>
              <Button variant="outline" onClick={() => closeWith.mutate({ stage: 'perdu' })} disabled={closeWith.isPending}>{t('crm.closeDoneLost')}</Button>
            </div>

            <div className="rounded-md border border-border p-2.5">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('crm.closeSnooze')}</label>
              <div className="flex gap-2">
                <Input type="datetime-local" value={snoozeAt} onChange={(e) => setSnoozeAt(e.target.value)} />
                <Button variant="outline" onClick={() => closeWith.mutate({ due_at: snoozeAt ? new Date(snoozeAt).toISOString() : null })} disabled={closeWith.isPending || !snoozeAt}>
                  {closeWith.isPending ? <Loader2 className="animate-spin" /> : <Clock className="size-4" />}
                </Button>
              </div>
            </div>

            {/* Passer le relais : on clôture celle-ci et on ouvre la suivante, confiée
                à quelqu'un. Sans ça, clôturer faisait disparaître ce qui restait à faire. */}
            <div className="rounded-md border border-border p-2.5">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('crm.closeAndNew')}</label>
              <div className="space-y-2">
                <Input value={nextWhat} onChange={(e) => setNextWhat(e.target.value)} placeholder={t('crm.newTaskPlaceholder')} />
                <div className="grid grid-cols-2 gap-2">
                  <Select value={nextWho || '__none__'} onValueChange={(v) => setNextWho(v === '__none__' ? '' : v)}>
                    <SelectTrigger><SelectValue placeholder={t('crm.assignee')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('crm.assigneeNone')}</SelectItem>
                      {members.data?.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="datetime-local" value={nextWhen} onChange={(e) => setNextWhen(e.target.value)} />
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={relay.isPending || !nextWhat.trim()}
                  onClick={() => relay.mutate()}
                >
                  {relay.isPending ? <Loader2 className="animate-spin" /> : null} {t('crm.createAndClose')}
                </Button>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">{t('crm.closeHint')}</p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setClosing(false); onClose(); }}>{t('crm.closeSkip')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
