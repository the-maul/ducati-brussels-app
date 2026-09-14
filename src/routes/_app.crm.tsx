import { createFileRoute } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Recycle, Clock, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { listLeads, createLead, setLeadStage, listOpenTasksByLead, listCompanyMembers, LEAD_STAGES, dueState, type Lead } from '@/modules/crm/api';
import { RepriseStatusBadge } from '@/modules/tradein/reprise-status-badge';
import { normalizeRepriseStatus } from '@/modules/tradein/reprise-status';
import { LeadDetail } from '@/modules/crm/lead-detail';
import { t } from '@/lib/i18n';

/** Catégories de lead (source) — filtre CRM. */
const LEAD_SOURCES = ['MAIL', 'WEB', 'REP', 'VN', 'VO', 'ATELIER', 'PIECE', 'FINANCEMENT'] as const;

export const Route = createFileRoute('/_app/crm')({
  head: () => ({ meta: [{ title: 'CRM — Ducati Bruxelles' }] }),
  component: CrmPage,
});

const eur = (n: number) => `${Math.round(n).toLocaleString('fr-BE')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

function CrmPage() {
  const { activeCompanyId } = useAuth();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [sourceFilter, setSourceFilter] = useState('all');
  const { data, isLoading } = useQuery({ queryKey: ['leads', activeCompanyId], queryFn: () => listLeads(activeCompanyId!), enabled: !!activeCompanyId });
  // Ce qu'il faut faire sur chaque carte, et qui s'en charge : une seule requête.
  const openTasks = useQuery({ queryKey: ['lead-open-tasks', activeCompanyId], queryFn: () => listOpenTasksByLead(activeCompanyId!), enabled: !!activeCompanyId });
  const members = useQuery({ queryKey: ['company-members', activeCompanyId], queryFn: () => listCompanyMembers(activeCompanyId!), enabled: !!activeCompanyId });
  const memberName = (id: string | null | undefined) => members.data?.find((m) => m.user_id === id)?.name ?? null;
  const move = useMutation({ mutationFn: ({ id, stage }: { id: string; stage: string }) => setLeadStage(id, stage), onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', activeCompanyId] }) });

  const refreshBoard = () => {
    qc.invalidateQueries({ queryKey: ['leads', activeCompanyId] });
    qc.invalidateQueries({ queryKey: ['lead-open-tasks', activeCompanyId] });
    qc.invalidateQueries({ queryKey: ['leads-due', activeCompanyId] });
  };

  const filtered = (data ?? []).filter((l) => sourceFilter === 'all' || (l.source ?? '').toUpperCase() === sourceFilter);
  const byStage = (s: string) => filtered.filter((l) => l.stage === s);
  /** Les étapes où une carte doit porter une tâche. Gagné/perdu n'attendent plus rien. */
  const OPEN = ['nouveau', 'contacte', 'qualifie', 'proposition'];

  return (
    <>
      <PageHeader title={t('crm.title')} description={t('crm.subtitle')} actions={
        <div className="flex gap-2">
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('crm.filterAll')}</SelectItem>
              {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{t(`crm.src_${s}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setShowNew(true)}><Plus /> {t('crm.newLead')}</Button>
        </div>
      } />
      {isLoading && <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-6">
        {LEAD_STAGES.map((s) => (
          <div key={s} className="rounded-md border border-border bg-card p-2">
            <p className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(`crm.stage_${s}`)}<span className="rounded bg-muted px-1.5 tabular-nums">{byStage(s).length}</span></p>
            <div className="space-y-2">
              {byStage(s).map((l) => {
                const task = openTasks.data?.[l.id];
                const state = dueState(task?.due_at ?? l.due_at);
                return (
                  <div key={l.id} className="cursor-pointer rounded-md border border-border p-2 text-[12px] transition hover:border-[var(--ducati-red)] hover:shadow-sm" onClick={() => setSelected(l)} title={(l.source ?? '').toUpperCase() === 'REP' ? t('crm.srcRepTitle') : t('crm.openCard')}>
                    <p className="flex items-center gap-1.5 font-medium">
                      {(l.source ?? '').toUpperCase() === 'REP' && <Recycle className="size-3.5 shrink-0 text-[var(--ducati-red)]" aria-label={t('crm.src_REP')} />}
                      <span className="truncate">{l.name}</span>
                    </p>
                    {l.vehicle_interest && <p className="truncate text-muted-foreground">{l.vehicle_interest}</p>}

                    {/* CE QU'IL FAUT FAIRE, ET QUI S'EN CHARGE — le cœur de la carte.
                        Rouge si l'échéance est dépassée, orange si c'est pour aujourd'hui. */}
                    {task && (
                      <div className={`mt-1 rounded border px-1.5 py-1 ${state === 'overdue' ? 'border-[var(--danger)]' : 'border-border'}`}>
                        <p className="flex items-start gap-1 font-medium">
                          <Clock className={`mt-0.5 size-3 shrink-0 ${state === 'overdue' ? 'text-[var(--danger)]' : state === 'today' ? 'text-[var(--warning)]' : 'text-muted-foreground'}`} />
                          <span className="line-clamp-2">{task.title}</span>
                        </p>
                        <p className="truncate text-muted-foreground">
                          {t('crm.byWho')} {memberName(task.assigned_to) ?? '—'}
                          {state === 'overdue' && <span className="text-[var(--danger)]"> · {t('crm.dueOverdue')}</span>}
                          {state === 'today' && <span className="text-[var(--warning)]"> · {t('crm.dueToday')}</span>}
                        </p>
                      </div>
                    )}
                    {/* Une carte ouverte sans tâche, c'est un client que personne ne rappellera. */}
                    {!task && openTasks.data && OPEN.includes(l.stage) && (
                      <p className="mt-1 flex items-center gap-1 font-medium text-[var(--danger)]">
                        <AlertTriangle className="size-3 shrink-0" /> {t('crm.noOpenTask')}
                      </p>
                    )}

                    {/* Tag de statut de reprise synchronisé depuis le module Reprises */}
                    {(l as { reprise_status?: string | null }).reprise_status && (
                      <div className="mt-1"><RepriseStatusBadge status={normalizeRepriseStatus((l as { reprise_status?: string | null }).reprise_status)} /></div>
                    )}
                    {l.estimated_value != null && <p className="tabular-nums text-muted-foreground">{eur(Number(l.estimated_value))}</p>}
                    <div onClick={(e) => e.stopPropagation()}>
                      <Select value={l.stage} onValueChange={(v) => move.mutate({ id: l.id, stage: v })}>
                        <SelectTrigger className="mt-1 h-7 text-[12px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{LEAD_STAGES.map((x) => <SelectItem key={x} value={x}>{t(`crm.stage_${x}`)}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {showNew && <NewLeadDialog companyId={activeCompanyId!} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refreshBoard(); }} />}
      {selected && <LeadDetail lead={selected} companyId={activeCompanyId!} onClose={() => setSelected(null)} onChanged={refreshBoard} />}
    </>
  );
}

function NewLeadDialog({ companyId, onClose, onCreated }: { companyId: string; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', vehicle: '', source: '', value: '' });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const create = useMutation({
    mutationFn: () => createLead({ companyId, name: f.name, email: f.email, phone: f.phone, vehicleInterest: f.vehicle, source: f.source, estimatedValue: f.value ? num(f.value) : null }),
    onSuccess: onCreated,
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('crm.newLead')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('crm.leadName')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label={t('crm.email')}><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label={t('crm.phone')}><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label={t('crm.vehicleInterest')}><Input value={f.vehicle} onChange={(e) => set('vehicle', e.target.value)} /></Field>
          <Field label={t('crm.source')}>
            <Select value={f.source || undefined} onValueChange={(v) => set('source', v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{t(`crm.src_${s}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('crm.estimatedValue')}><Input type="number" value={f.value} onChange={(e) => set('value', e.target.value)} className="text-right tabular-nums" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !f.name.trim()}>{create.isPending ? <Loader2 className="animate-spin" /> : null} {t('crm.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
