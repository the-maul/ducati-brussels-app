/**
 * Encaissements (rattrapage G8, 18/11/2026) — onglet « Modèles et réglages » : G8 « Lettre de
 * relance » (Ajout / Modif / Suppr : modèle n°, libellé, format A4 / Ticket, niveau, agio %,
 * montant minimum, 4 blocs de texte) + réglages de la société (mode des relances arrêté / test,
 * adresse de test, nombre d'échéances par défaut, validité et minimum des bons d'achat).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import {
  deleteDunningTemplate, getReceivableSettings, listDunningTemplates, saveDunningTemplate, setReceivableSettings, type DunningTemplateRow,
} from './api';
import { DUNNING_VARIABLES, dunningFees, fillDunningText } from './dunning';
import { buildDunningLetterPdf, openPdf } from './receivables-pdf';
import { eur, loadPdfCompany, parseAmount, todayIso } from './helpers';
import { Field } from './schedule-dialog';

type Form = Omit<DunningTemplateRow, 'company_id' | 'id' | 'min_amount' | 'fee_fixed' | 'surcharge_pct' | 'level'> & {
  id?: string; level: string; min_amount: string; fee_fixed: string; surcharge_pct: string;
};
const blank = (): Form => ({
  code: '', label: '', level: '1', format: 'A4', min_amount: '0', fee_fixed: '0', surcharge_pct: '0',
  subject: '', header_text: '', body_text: '', closing_text: '', footer_text: '', is_active: true, sort_order: 0,
});
const toForm = (x: DunningTemplateRow): Form => ({
  ...x, level: String(x.level), min_amount: String(x.min_amount), fee_fixed: String(x.fee_fixed), surcharge_pct: String(x.surcharge_pct),
});

export function TemplatesTab({ companyId, canWrite, isAdmin }: { companyId: string; canWrite: boolean; isAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dunning-templates', companyId], queryFn: () => listDunningTemplates(companyId) });
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!form && q.data?.length) setForm(toForm(q.data[0])); }, [q.data, form]);
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const refresh = () => qc.invalidateQueries({ queryKey: ['dunning-templates'] });

  const save = useMutation({
    mutationFn: () => saveDunningTemplate(companyId, {
      ...form!, level: Number(form!.level) || 0, min_amount: parseAmount(form!.min_amount), fee_fixed: parseAmount(form!.fee_fixed), surcharge_pct: parseAmount(form!.surcharge_pct),
    }),
    onSuccess: () => { setError(null); refresh(); }, onError: (e) => setError(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => deleteDunningTemplate(form!.id!),
    onSuccess: () => { setForm(null); refresh(); }, onError: (e) => setError(errorMessage(e)),
  });
  const preview = async () => {
    if (!form) return;
    const w = window.open('', '_blank');
    try {
      const company = await loadPdfCompany(companyId);
      const due = 1234.5;
      const fees = dunningFees(due, parseAmount(form.fee_fixed), parseAmount(form.surcharge_pct));
      const vars = { client: t('receivables.sampleClient'), date: new Date().toLocaleDateString('fr-BE'), total_du: eur(due), frais: eur(fees), total_a_payer: eur(due + fees), societe: company.name, iban: company.iban ?? '' };
      openPdf(await buildDunningLetterPdf({
        format: form.format, company, addressee: { name: t('receivables.sampleClient'), address: t('receivables.sampleAddress'), zip: null, city: null },
        dateIso: todayIso(), subject: fillDunningText(form.subject, vars), header: fillDunningText(form.header_text, vars), body: fillDunningText(form.body_text, vars),
        closing: fillDunningText(form.closing_text, vars), footer: fillDunningText(form.footer_text, vars),
        rows: [{ number: 'FAC-2026-00001', issueDate: todayIso(), dueDate: todayIso(), amountDue: due }], totalDue: due, fees, isTest: true,
        labels: {
          place: t('receivables.pdfPlace'), colNumber: t('receivables.colNumber'), colDate: t('receivables.colDate'), colDue: t('receivables.colDueDate'),
          colAmount: t('receivables.colAmountDue'), totalDue: t('receivables.pdfTotalDue'), fees: t('receivables.pdfFees'), totalToPay: t('receivables.pdfTotalToPay'),
          testBanner: t('receivables.pdfTestBanner'), letterTitle: t('receivables.pdfLetterTitle'),
        },
      }), w);
    } catch (e) { w?.close(); setError(errorMessage(e)); }
  };

  return (
    <div className="space-y-4">
      <SettingsCard companyId={companyId} isAdmin={isAdmin} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-2">
          {(q.data ?? []).map((x) => (
            <button key={x.id} type="button" onClick={() => setForm(toForm(x))}
              className={`block w-full rounded-md border px-3 py-2 text-left text-[13px] ${form?.id === x.id ? 'border-primary bg-muted' : 'border-border bg-card hover:bg-muted'}`}>
              <span className="font-mono text-[12px]">{x.code}</span> · {x.label}
              <span className="block text-[11px] text-muted-foreground">{t('receivables.level')} {x.level} · {x.format}{x.is_active === false ? ` · ${t('receivables.inactive')}` : ''}</span>
            </button>
          ))}
          {canWrite && <Button variant="outline" size="sm" className="w-full" onClick={() => setForm(blank())}><Plus /> {t('receivables.templateNew')}</Button>}
        </div>
        {form && (
          <div className="space-y-3 rounded-md border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label={t('receivables.templateCode')}><Input value={form.code} onChange={(e) => set({ code: e.target.value })} className="font-mono" disabled={!canWrite} /></Field>
              <Field label={t('receivables.templateLabel')}><Input value={form.label} onChange={(e) => set({ label: e.target.value })} disabled={!canWrite} /></Field>
              <Field label={t('receivables.level')}><Input type="number" min={0} max={9} value={form.level} onChange={(e) => set({ level: e.target.value })} disabled={!canWrite} /></Field>
              <Field label={t('receivables.format')}>
                <Select value={form.format} onValueChange={(v) => set({ format: v as 'A4' | 'ticket' })} disabled={!canWrite}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="A4">A4</SelectItem><SelectItem value="ticket">{t('receivables.formatTicket')}</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label={t('receivables.minAmount')}><Input type="number" step="0.01" value={form.min_amount} onChange={(e) => set({ min_amount: e.target.value })} disabled={!canWrite} /></Field>
              <Field label={t('receivables.feeFixed')}><Input type="number" step="0.01" value={form.fee_fixed} onChange={(e) => set({ fee_fixed: e.target.value })} disabled={!canWrite} /></Field>
              <Field label={t('receivables.surchargePct')}><Input type="number" step="0.01" value={form.surcharge_pct} onChange={(e) => set({ surcharge_pct: e.target.value })} disabled={!canWrite} /></Field>
              <label className="flex items-end gap-2 pb-2 text-[12px] text-muted-foreground">
                <input type="checkbox" checked={form.is_active !== false} onChange={(e) => set({ is_active: e.target.checked })} disabled={!canWrite} className="size-4 accent-[var(--ducati-red)]" /> {t('receivables.active')}
              </label>
            </div>
            <Field label={t('receivables.templateSubject')}><Input value={form.subject} onChange={(e) => set({ subject: e.target.value })} disabled={!canWrite} /></Field>
            <Field label={t('receivables.block1')}><Textarea rows={2} value={form.header_text} onChange={(e) => set({ header_text: e.target.value })} disabled={!canWrite} /></Field>
            <Field label={t('receivables.block2')}><Textarea rows={3} value={form.body_text} onChange={(e) => set({ body_text: e.target.value })} disabled={!canWrite} /></Field>
            <Field label={t('receivables.block3')}><Textarea rows={3} value={form.closing_text} onChange={(e) => set({ closing_text: e.target.value })} disabled={!canWrite} /></Field>
            <Field label={t('receivables.block4')}><Textarea rows={2} value={form.footer_text} onChange={(e) => set({ footer_text: e.target.value })} disabled={!canWrite} /></Field>
            <p className="text-[12px] text-muted-foreground">{t('receivables.variables')} : {DUNNING_VARIABLES.map((v) => `{${v}}`).join(' · ')}</p>
            {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void preview()}><Eye /> {t('receivables.preview')}</Button>
              {canWrite && <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !form.code.trim() || !form.label.trim()}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('receivables.save')}</Button>}
              {canWrite && form.id && <Button variant="outline" size="sm" onClick={() => del.mutate()} disabled={del.isPending}><Trash2 className="text-danger" /> {t('receivables.delete')}</Button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsCard({ companyId, isAdmin }: { companyId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['receivable-settings', companyId], queryFn: () => getReceivableSettings(companyId), retry: false });
  const [mode, setMode] = useState<'arrete' | 'test' | 'actif'>('test');
  const [rcpt, setRcpt] = useState('');
  const [count, setCount] = useState('12');
  const [days, setDays] = useState('365');
  const [min, setMin] = useState('0');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return;
    setMode(q.data.dunning_mode); setRcpt(q.data.dunning_test_recipient ?? ''); setCount(String(q.data.default_installments));
    setDays(String(q.data.voucher_validity_days)); setMin(String(q.data.voucher_min_amount));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => setReceivableSettings(companyId, {
      // « actif » ne se pose que par Parametres → Mise en production : l'ecran ne le renvoie pas.
      ...(mode === 'actif' ? {} : { dunning_mode: mode }), dunning_test_recipient: rcpt.trim() || null, default_installments: Number(count) || 12,
      voucher_validity_days: Number(days) || 365, voucher_min_amount: parseAmount(min),
    }),
    onSuccess: () => { setMsg(t('receivables.saved')); qc.invalidateQueries({ queryKey: ['receivable-settings'] }); },
    onError: (e) => setMsg(errorMessage(e)),
  });
  if (q.isError) return <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('receivables.notInstalled')}</p>;
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('receivables.settingsTitle')}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Field label={t('receivables.dunningMode')}>
          <Select value={mode} onValueChange={(v) => setMode(v as 'arrete' | 'test' | 'actif')} disabled={!isAdmin}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="arrete">{t('receivables.modeStopped')}</SelectItem><SelectItem value="test">{t('receivables.modeTest')}</SelectItem>
              {/* Actif : seulement par Parametres → Mise en production (lecture ici). */}
              <SelectItem value="actif" disabled={mode !== 'actif'}>{t('receivables.modeActive')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('receivables.testRecipient')}><Input type="email" value={rcpt} onChange={(e) => setRcpt(e.target.value)} placeholder={q.data?.effective_test_recipient ?? ''} disabled={!isAdmin} /></Field>
        <Field label={t('receivables.defaultInstallments')}><Input type="number" min={1} max={60} value={count} onChange={(e) => setCount(e.target.value)} disabled={!isAdmin} /></Field>
        <Field label={t('receivables.voucherValidityDays')}><Input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} disabled={!isAdmin} /></Field>
        <Field label={t('receivables.voucherMinAmount')}><Input type="number" step="0.01" value={min} onChange={(e) => setMin(e.target.value)} disabled={!isAdmin} /></Field>
      </div>
      <p className="text-[12px] text-muted-foreground">
        {fillVars(t('receivables.settingsHelp'), { to: q.data?.effective_test_recipient ?? '—' })}
      </p>
      {isAdmin && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('receivables.save')}</Button>
          {msg && <span className="text-[12px] text-muted-foreground">{msg}</span>}
        </div>
      )}
    </div>
  );
}
