import { createFileRoute } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { listLeads, createLead, setLeadStage, LEAD_STAGES, type Lead } from '@/modules/crm/api';
import { LeadDetail } from '@/modules/crm/lead-detail';
import { t } from '@/lib/i18n';

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
  const { data, isLoading } = useQuery({ queryKey: ['leads', activeCompanyId], queryFn: () => listLeads(activeCompanyId!), enabled: !!activeCompanyId });
  const move = useMutation({ mutationFn: ({ id, stage }: { id: string; stage: string }) => setLeadStage(id, stage), onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', activeCompanyId] }) });

  const byStage = (s: string) => (data ?? []).filter((l) => l.stage === s);

  return (
    <>
      <PageHeader title={t('crm.title')} description={t('crm.subtitle')} actions={<Button onClick={() => setShowNew(true)}><Plus /> {t('crm.newLead')}</Button>} />
      {isLoading && <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-6">
        {LEAD_STAGES.map((s) => (
          <div key={s} className="rounded-md border border-border bg-card p-2">
            <p className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(`crm.stage_${s}`)}<span className="rounded bg-muted px-1.5 tabular-nums">{byStage(s).length}</span></p>
            <div className="space-y-2">
              {byStage(s).map((l) => (
                <div key={l.id} className="cursor-pointer rounded-md border border-border p-2 text-[12px] transition hover:border-[var(--ducati-red)] hover:shadow-sm" onClick={() => setSelected(l)} title={t('crm.openCard')}>
                  <p className="font-medium">{l.name}</p>
                  {l.vehicle_interest && <p className="truncate text-muted-foreground">{l.vehicle_interest}</p>}
                  {l.estimated_value != null && <p className="tabular-nums text-muted-foreground">{eur(Number(l.estimated_value))}</p>}
                  <div onClick={(e) => e.stopPropagation()}>
                    <Select value={l.stage} onValueChange={(v) => move.mutate({ id: l.id, stage: v })}>
                      <SelectTrigger className="mt-1 h-7 text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{LEAD_STAGES.map((x) => <SelectItem key={x} value={x}>{t(`crm.stage_${x}`)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {showNew && <NewLeadDialog companyId={activeCompanyId!} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['leads', activeCompanyId] }); }} />}
      {selected && <LeadDetail lead={selected} companyId={activeCompanyId!} onClose={() => setSelected(null)} onChanged={() => qc.invalidateQueries({ queryKey: ['leads', activeCompanyId] })} />}
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
          <Field label={t('crm.email')}><Input value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label={t('crm.phone')}><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label={t('crm.vehicleInterest')}><Input value={f.vehicle} onChange={(e) => set('vehicle', e.target.value)} /></Field>
          <Field label={t('crm.source')}><Input value={f.source} onChange={(e) => set('source', e.target.value)} /></Field>
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
