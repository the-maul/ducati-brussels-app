/**
 * M8 — Volet assureur du dossier accident (G8 : onglet « Assurance » de l'OR), rattrapage G8 du
 * 18/11/2026 : cabinet d'assurance et expert (fichier + « Nouveau »), date de passage, franchise a
 * percevoir en montant ou en %, valeur venale, cote, « Demarrage des travaux accepte », document
 * specifique « accident ». Affiche sur la page de l'OR et sur la fiche du dossier : une seule
 * source (le dossier accident de l'OR), pas de doublon.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileDown, Hourglass, Loader2, Plus, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { errorMessage } from '@/lib/mutation-feedback';
import { t } from '@/lib/i18n';
import { contactDisplayName } from '@/modules/contacts/api';
import { getAccidentFile, storeAccidentFile } from './api';
import { downloadBytes } from './form-xlsx';
import { buildAccidentSheetPdf } from './accident-sheet-pdf';
import {
  getAccidentInsurance, insuranceSchemaReady, listInsuranceParties, saveAccidentInsurance, type AccidentInsurance,
} from './insurance-api';
import { InsurancePartyDialog, insurancePartiesKey } from './insurance-parties';
import {
  DEDUCTIBLE_KINDS, deductibleAmount, deductibleLabel, insurancePartyLabel, parseAmount, workStartPatch,
  type DeductibleKind, type InsurancePartyKind,
} from './insurance-rules';

const eur = (n: number) => `${new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`;
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '');
const NONE = ' none';

export const accidentInsuranceKey = (fileId: string) => ['accident-insurance', fileId];

type Form = {
  insurer_id: string | null; expert_id: string | null; expert_visit_date: string;
  deductible_kind: DeductibleKind; deductible_value: string; market_value: string; argus_value: string;
  work_start_accepted: boolean;
};

const toForm = (a: AccidentInsurance | null): Form => ({
  insurer_id: a?.insurer_id ?? null, expert_id: a?.expert_id ?? null, expert_visit_date: a?.expert_visit_date ?? '',
  deductible_kind: (a?.deductible_kind as DeductibleKind) ?? 'montant',
  deductible_value: a?.deductible_value != null ? String(a.deductible_value).replace('.', ',') : '',
  market_value: a?.market_value != null ? String(a.market_value).replace('.', ',') : '',
  argus_value: a?.argus_value != null ? String(a.argus_value).replace('.', ',') : '',
  work_start_accepted: !!a?.work_start_accepted,
});

export function AccidentInsurancePanel({ companyId, fileId, repairOrderId, orTotalTtc, readOnly = false }: {
  companyId: string; fileId: string; repairOrderId: string | null; orTotalTtc: number; readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const { user, companies } = useAuth();
  const companyName = companies.find((c) => c.id === companyId)?.name ?? '';
  const schema = useQuery({ queryKey: ['insurance-schema'], queryFn: insuranceSchemaReady, staleTime: Infinity });
  const insQ = useQuery({ queryKey: accidentInsuranceKey(fileId), queryFn: () => getAccidentInsurance(fileId), enabled: schema.data === true });
  const partiesQ = useQuery({ queryKey: insurancePartiesKey(companyId), queryFn: () => listInsuranceParties(companyId), enabled: schema.data === true });
  const [form, setForm] = useState<Form>(() => toForm(null));
  const [newKind, setNewKind] = useState<InsurancePartyKind | null>(null);
  useEffect(() => { if (insQ.data !== undefined) setForm(toForm(insQ.data)); }, [insQ.data]);

  const parties = partiesQ.data ?? [];
  const cabinets = parties.filter((p) => p.kind === 'cabinet' && (p.is_active || p.id === form.insurer_id));
  const experts = parties.filter((p) => p.kind === 'expert' && (p.is_active || p.id === form.expert_id));
  const insurer = parties.find((p) => p.id === form.insurer_id) ?? null;
  const expert = parties.find((p) => p.id === form.expert_id) ?? null;
  const deductible = deductibleAmount(form.deductible_kind, form.deductible_value, orTotalTtc);
  const pctInvalid = form.deductible_kind === 'pourcentage' && (parseAmount(form.deductible_value) ?? 0) > 100;
  const saved = insQ.data ?? null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: accidentInsuranceKey(fileId) });
    qc.invalidateQueries({ queryKey: ['accident-file', fileId] });
    qc.invalidateQueries({ queryKey: ['accident-ors'] });
    if (repairOrderId) qc.invalidateQueries({ queryKey: ['ro-full', repairOrderId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (pctInvalid) throw new Error(t('insurance.errPct'));
      const accepted = form.work_start_accepted;
      const changedAccept = accepted !== !!saved?.work_start_accepted;
      const patch: Partial<AccidentInsurance> = {
        insurer_id: form.insurer_id, expert_id: form.expert_id, expert_visit_date: form.expert_visit_date || null,
        deductible_kind: form.deductible_kind, deductible_value: parseAmount(form.deductible_value),
        market_value: parseAmount(form.market_value), argus_value: parseAmount(form.argus_value),
        ...(changedAccept ? workStartPatch(accepted, user?.id ?? null, new Date().toISOString()) : {}),
      };
      await saveAccidentInsurance({
        fileId, repairOrderId, patch,
        insurerName: insurer ? insurer.name : (saved?.insurer_id ? null : undefined),
        expertName: expert ? expert.name : (saved?.expert_id ? null : undefined),
        expertEmail: expert?.email ?? null,
      });
    },
    meta: { success: false },
    onSuccess: () => { refresh(); toast.success(t('insurance.panelSaved')); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const print = useMutation({
    mutationFn: async () => {
      const file = await getAccidentFile(fileId);
      if (!file) throw new Error(t('accidentFile.notFound'));
      const or = repairOrderId
        ? (await supabase.from('repair_orders').select('number, created_at, mileage, work_description').eq('id', repairOrderId).maybeSingle()).data
        : null;
      const bytes = await buildAccidentSheetPdf({
        companyName, generatedAt: new Date(),
        orNumber: or?.number ?? null, orDate: fmtDate(or?.created_at),
        client: file.contact ? contactDisplayName(file.contact) : '—', clientContact: file.contact?.email ?? null,
        vehicle: [file.vehicle?.brand, file.vehicle?.model].filter(Boolean).join(' ') || '—',
        vin: file.vehicle?.vin ?? null, plate: file.vehicle?.plate ?? null, mileage: or?.mileage ?? null,
        insurer: insurer ? { name: insurer.name, address: [insurer.address, [insurer.postal_code, insurer.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null, phone: insurer.phone, email: insurer.email } : (file.insurer ? { name: file.insurer, address: null, phone: null, email: null } : null),
        claimNumber: file.claim_number, expert: expert?.name ?? file.expert_name, expertVisit: fmtDate(form.expert_visit_date) || null,
        deductible: deductibleLabel(form.deductible_kind, form.deductible_value, orTotalTtc, eur),
        marketValue: parseAmount(form.market_value) != null ? eur(parseAmount(form.market_value)!) : '—',
        argusValue: parseAmount(form.argus_value) != null ? eur(parseAmount(form.argus_value)!) : '—',
        workStartAccepted: form.work_start_accepted, workStartAcceptedAt: fmtDate(saved?.work_start_accepted_at) || null,
        workDescription: or?.work_description ?? null,
      }, {
        title: t('insurance.pdfTitle'), or: t('insurance.pdfOr'), date: t('insurance.pdfDate'), client: t('accidentFile.client'),
        vehicle: t('accidentFile.vehicle'), vin: t('accidentFile.vin'), plate: t('insurance.pdfPlate'), mileage: t('workshop.mileage'),
        insurer: t('insurance.insurer'), claim: t('accidentFile.claimNumber'), expert: t('insurance.expert'), visit: t('insurance.visitDate'),
        deductible: t('insurance.deductible'), marketValue: t('insurance.marketValue'), argus: t('insurance.argusValue'),
        workStart: t('insurance.workStart'), yes: t('insurance.yes'), no: t('insurance.no'), work: t('workshop.workDescription'),
        signClient: t('insurance.signClient'), signExpert: t('insurance.signExpert'), signWorkshop: t('insurance.signWorkshop'),
      });
      const name = `Document-accident-${or?.number ?? fileId.slice(0, 8)}.pdf`;
      await storeAccidentFile(companyId, fileId, bytes, name, 'application/pdf', t('insurance.pdfTitle')).catch(() => null);
      downloadBytes(bytes, name, 'application/pdf');
    },
    meta: { success: false },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (schema.data === false) return <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('insurance.migrationMissing')}</p>;
  if (schema.isLoading || insQ.isLoading) return <div className="grid place-items-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;

  const partySelect = (kind: InsurancePartyKind, value: string | null, list: typeof parties, onPick: (id: string | null) => void) => (
    <div className="flex gap-2">
      <Select value={value ?? NONE} onValueChange={(v) => onPick(v === NONE ? null : v)} disabled={readOnly}>
        <SelectTrigger className="h-9"><SelectValue placeholder={t('insurance.choose')} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('insurance.none')}</SelectItem>
          {list.map((p) => <SelectItem key={p.id} value={p.id}>{insurancePartyLabel(p)}</SelectItem>)}
        </SelectContent>
      </Select>
      {!readOnly && <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={() => setNewKind(kind)} title={t('insurance.new')}><Plus /> {t('insurance.newShort')}</Button>}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {saved?.work_start_accepted
          ? <StatusBadge tone="success" icon={CheckCircle2} label={t('insurance.workStartYes')} />
          : <StatusBadge tone="warning" icon={Hourglass} label={t('insurance.workStartNo')} />}
        {saved?.work_start_accepted_at && <span className="font-data text-[12px] text-muted-foreground">{fmtDate(saved.work_start_accepted_at)}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <F label={t('insurance.insurer')}>
          {partySelect('cabinet', form.insurer_id, cabinets, (id) => setForm({ ...form, insurer_id: id }))}
          {insurer && (insurer.price_list || insurer.accounting_account) && (
            <p className="text-[12px] text-muted-foreground">
              {insurer.price_list && <>{t('insurance.priceList')} : <b className="text-foreground">{insurer.price_list}</b> </>}
              {insurer.accounting_account && <>· {t('insurance.accountingAccount')} : <span className="font-data">{insurer.accounting_account}</span></>}
            </p>
          )}
        </F>
        <F label={t('insurance.expert')}>{partySelect('expert', form.expert_id, experts, (id) => setForm({ ...form, expert_id: id }))}</F>
        <F label={t('insurance.visitDate')}><Input type="date" value={form.expert_visit_date} onChange={(e) => setForm({ ...form, expert_visit_date: e.target.value })} disabled={readOnly} className="h-9" /></F>
        <F label={t('insurance.deductible')}>
          <div className="flex gap-2">
            <Select value={form.deductible_kind} onValueChange={(v) => setForm({ ...form, deductible_kind: v as DeductibleKind })} disabled={readOnly}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{DEDUCTIBLE_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`insurance.deductible_${k}`)}</SelectItem>)}</SelectContent>
            </Select>
            <Input value={form.deductible_value} onChange={(e) => setForm({ ...form, deductible_value: e.target.value })} disabled={readOnly} inputMode="decimal" className={`h-9 text-right tabular-nums ${pctInvalid ? 'border-danger' : ''}`} />
          </div>
          {form.deductible_kind === 'pourcentage' && deductible != null && (
            <p className="text-[12px] text-muted-foreground tabular-nums">{t('insurance.deductibleAmount')} : <b className="text-foreground">{eur(deductible)}</b></p>
          )}
        </F>
        <F label={t('insurance.marketValue')}><Input value={form.market_value} onChange={(e) => setForm({ ...form, market_value: e.target.value })} disabled={readOnly} inputMode="decimal" className="h-9 text-right tabular-nums" /></F>
        <F label={t('insurance.argusValue')}><Input value={form.argus_value} onChange={(e) => setForm({ ...form, argus_value: e.target.value })} disabled={readOnly} inputMode="decimal" className="h-9 text-right tabular-nums" /></F>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Switch id={`work-start-${fileId}`} checked={form.work_start_accepted} onCheckedChange={(v) => setForm({ ...form, work_start_accepted: v })} disabled={readOnly} />
        <Label htmlFor={`work-start-${fileId}`}>{t('insurance.workStart')}</Label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => print.mutate()} disabled={print.isPending}>{print.isPending ? <Loader2 className="animate-spin" /> : <FileDown />} {t('insurance.printSheet')}</Button>
          {!readOnly && <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('insurance.panelSave')}</Button>}
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t('insurance.panelHint')}</p>
      {newKind && (
        <InsurancePartyDialog
          companyId={companyId} party={null} defaultKind={newKind}
          onClose={() => setNewKind(null)}
          onSaved={(id) => { setForm((f) => (newKind === 'cabinet' ? { ...f, insurer_id: id } : { ...f, expert_id: id })); setNewKind(null); }}
        />
      )}
    </div>
  );
}

function F({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
