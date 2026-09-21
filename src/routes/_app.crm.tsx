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
import { listLeads, createManualLead, getLead, setLeadStage, listOpenTasksByLead, listCompanyMembers, LEAD_STAGES, PIPELINES, dueState, type Lead, type Pipeline } from '@/modules/crm/api';
import { RepriseStatusBadge } from '@/modules/tradein/reprise-status-badge';
import { normalizeRepriseStatus } from '@/modules/tradein/reprise-status';
import { LeadDetail } from '@/modules/crm/lead-detail';
import { PhoneInput } from '@/components/phone-input';
import { toE164 } from '@/lib/phone';
import { t } from '@/lib/i18n';

/** Catégories de lead (source) — filtre CRM. */
const LEAD_SOURCES = ['MAIL', 'WEB', 'COMPTOIR', 'REP', 'VN', 'VO', 'ATELIER', 'PIECE', 'FINANCEMENT'] as const;

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
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState('all');
  // Le CRM affiché. Un seul aujourd'hui (commercial) ; l'atelier s'ajoutera à PIPELINES.
  const [pipeline, setPipeline] = useState<Pipeline>('commercial');
  const { data, isLoading } = useQuery({ queryKey: ['leads', activeCompanyId, pipeline], queryFn: () => listLeads(activeCompanyId!, pipeline), enabled: !!activeCompanyId });
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
      {/* Onglets des CRM : commercial aujourd'hui, atelier plus tard. */}
      <div className="mb-3 flex gap-1 border-b border-border">
        {PIPELINES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPipeline(p)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium ${pipeline === p ? 'border-[var(--ducati-red)] text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t(`crm.pipeline_${p}`)}
          </button>
        ))}
      </div>
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
      {showNew && <NewLeadDialog companyId={activeCompanyId!} pipeline={pipeline} onClose={() => setShowNew(false)}
        onCreated={() => { setShowNew(false); refreshBoard(); }}
        onExisting={(l) => { setShowNew(false); setNotice(t('crm.existingLeadOpened')); setSelected(l); }} />}
      {selected && <LeadDetail key={selected.id} lead={selected} notice={notice} companyId={activeCompanyId!} onClose={() => { setSelected(null); setNotice(null); }} onChanged={refreshBoard} />}
    </>
  );
}

function NewLeadDialog({ companyId, pipeline, onClose, onCreated, onExisting }: { companyId: string; pipeline: Pipeline; onClose: () => void; onCreated: () => void; onExisting: (lead: Lead) => void }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', vehicle: '', source: '', value: '' });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [err, setErr] = useState<string | null>(null);
  const noEmail = f.email.trim() === '';
  // Retour client du 21/09 : le téléphone n'accepte qu'un numéro (jamais un e-mail), stocké en E.164.
  const phoneE164 = toE164(f.phone);
  const phoneInvalid = phoneE164 === null;
  const create = useMutation({
    // Tout se fait en base, en une transaction (crm_create_manual_lead) :
    // - l'e-mail décide (D3) : fiche existante reliée, sinon fiche prospect créée ;
    // - si ce client a déjà une carte ouverte, pas de doublon : on ouvre la sienne ;
    // - la carte entre avec « Recontacter le client » à J+2, confiée au responsable par défaut.
    mutationFn: () => createManualLead({ companyId, pipeline, name: f.name.trim(), email: f.email.trim(), phone: phoneE164 || undefined, vehicleInterest: f.vehicle, source: f.source, estimatedValue: f.value ? num(f.value) : null }),
    onSuccess: async (r) => {
      if (r.existing) {
        const lead = await getLead(r.lead_id);
        if (lead) { onExisting(lead); return; }
      }
      onCreated();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('crm.newLead')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('crm.leadName')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label={t('crm.email')}><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <div className="col-span-2"><Field label={t('crm.phone')}><PhoneInput name="lead-phone" autoComplete="off" value={f.phone} onChange={(v) => set('phone', v)} /></Field></div>
          <Field label={t('crm.vehicleInterest')}><Input value={f.vehicle} onChange={(e) => set('vehicle', e.target.value)} /></Field>
          <Field label={t('crm.source')}>
            <Select value={f.source || undefined} onValueChange={(v) => set('source', v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{t(`crm.src_${s}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('crm.estimatedValue')}><Input type="number" value={f.value} onChange={(e) => set('value', e.target.value)} className="text-right tabular-nums" /></Field>
        </div>
        {/* Sans e-mail, la carte n'est reliée à aucune fiche : pas d'échanges par mail. */}
        {noEmail && f.name.trim() && (
          <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]" /> {t('crm.noEmailWarn')}
          </p>
        )}
        {err && <p className="text-[12px] text-[var(--danger)]">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => { setErr(null); create.mutate(); }} disabled={create.isPending || !f.name.trim() || phoneInvalid}>{create.isPending ? <Loader2 className="animate-spin" /> : null} {t('crm.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
