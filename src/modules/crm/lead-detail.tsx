/**
 * M10 — Fiche lead détaillée (style Pipedrive) : champs éditables, étape, timeline
 * d'activités (notes/appels/e-mails), pièces jointes (GED), suppression.
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2, Save, Plus, StickyNote, Phone, Mail, MessageSquare } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { updateLead, deleteLead, listLeadActivities, addLeadActivity, LEAD_STAGES, type Lead } from './api';
import { t } from '@/lib/i18n';

const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const chanIcon: Record<string, ReactNode> = { note: <StickyNote className="size-3.5" />, call: <Phone className="size-3.5" />, email: <Mail className="size-3.5" />, sms: <MessageSquare className="size-3.5" /> };

export function LeadDetail({ lead, companyId, onClose, onChanged }: { lead: Lead; companyId: string; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: lead.name ?? '', email: lead.email ?? '', phone: lead.phone ?? '',
    vehicle_interest: lead.vehicle_interest ?? '', source: lead.source ?? '',
    estimated_value: lead.estimated_value != null ? String(lead.estimated_value) : '', stage: lead.stage, notes: lead.notes ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [note, setNote] = useState(''); const [chan, setChan] = useState('note'); const [msg, setMsg] = useState<string | null>(null);

  const acts = useQuery({ queryKey: ['lead-acts', lead.id], queryFn: () => listLeadActivities(lead.id) });
  const save = useMutation({
    mutationFn: () => updateLead(lead.id, {
      name: f.name, email: f.email || null, phone: f.phone || null, vehicle_interest: f.vehicle_interest || null,
      source: f.source || null, estimated_value: f.estimated_value ? num(f.estimated_value) : null, stage: f.stage, notes: f.notes || null,
    }),
    onSuccess: () => { setMsg(t('crm.saved')); onChanged(); qc.invalidateQueries({ queryKey: ['leads', companyId] }); },
  });
  const del = useMutation({ mutationFn: () => deleteLead(lead.id), onSuccess: () => { onChanged(); onClose(); } });
  const addAct = useMutation({
    mutationFn: () => addLeadActivity({ companyId, leadId: lead.id, contactId: lead.contact_id, channel: chan, body: note }),
    onSuccess: () => { setNote(''); acts.refetch(); },
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="flex items-center justify-between pr-6">
          <span>{f.name || lead.name}</span>
          <Button variant="ghost" size="sm" className="text-danger" onClick={() => { if (confirm(t('crm.confirmDel'))) del.mutate(); }} disabled={del.isPending}><Trash2 className="size-4" /> {t('crm.del')}</Button>
        </DialogTitle></DialogHeader>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Détails éditables */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('crm.details')}</p>
            <Field label={t('crm.leadName')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('crm.email')}><Input value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
              <Field label={t('crm.phone')}><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            </div>
            <Field label={t('crm.vehicleInterest')}><Input value={f.vehicle_interest} onChange={(e) => set('vehicle_interest', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('crm.source')}><Input value={f.source} onChange={(e) => set('source', e.target.value)} /></Field>
              <Field label={t('crm.value')}><Input type="number" value={f.estimated_value} onChange={(e) => set('estimated_value', e.target.value)} className="text-right tabular-nums" /></Field>
            </div>
            <Field label={t('crm.stage')}>
              <Select value={f.stage} onValueChange={(v) => set('stage', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LEAD_STAGES.map((x) => <SelectItem key={x} value={x}>{t(`crm.stage_${x}`)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={t('crm.notes')}><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
            <div className="flex items-center gap-2">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save className="size-4" />} {t('crm.save')}</Button>
              {msg && <span className="text-[12px] text-success">{msg}</span>}
            </div>
          </div>

          {/* Activité + documents */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('crm.activity')}</p>
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
            <div className="max-h-44 space-y-1.5 overflow-auto">
              {acts.data?.length === 0 && <p className="text-[12px] text-muted-foreground">{t('crm.noActivity')}</p>}
              {acts.data?.map((a) => (
                <div key={a.id} className="rounded-md border border-border px-2.5 py-1.5 text-[12px]">
                  <div className="flex items-center gap-1.5 text-muted-foreground">{chanIcon[a.channel] ?? null}<span className="font-medium text-foreground">{t(`crm.channel_${a.channel}`)}</span><span className="ml-auto">{new Date(a.occurred_at).toLocaleString('fr-BE')}</span></div>
                  {a.body && <p className="mt-0.5">{a.body}</p>}
                </div>
              ))}
            </div>
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('crm.documents')}</p>
            <AttachmentsPanel companyId={companyId} entityType="lead" entityId={lead.id} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
