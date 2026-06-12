import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Loader2, FileDown, Plus, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { getSepaCollectable, generateSepaFile, recordSepaUnpaid } from '@/modules/accounting/sepa';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/accounting-sepa')({
  head: () => ({ meta: [{ title: 'Domiciliations SEPA — Ducati Bruxelles' }] }),
  component: SepaPage,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

function SepaPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [dueTo, setDueTo] = useState(plusDays(30));
  const [collDate, setCollDate] = useState(plusDays(7));
  const [form, setForm] = useState({ contact_id: '', mandate_ref: '', iban: '', bic: '', signature_date: today(), seq_type: 'RCUR' });
  const [msg, setMsg] = useState<string | null>(null);

  const mandates = useQuery({ queryKey: ['sepa-mandates', activeCompanyId], queryFn: async () => {
    const { data } = await supabase.from('sepa_mandates').select('id, mandate_ref, iban, seq_type, status, contact_id, contacts(first_name, last_name, company_name)').eq('company_id', activeCompanyId!).order('created_at', { ascending: false });
    return data ?? [];
  }, enabled: !!activeCompanyId });

  const contacts = useQuery({ queryKey: ['sepa-contacts', activeCompanyId], queryFn: async () => {
    const { data } = await supabase.from('contacts').select('id, first_name, last_name, company_name, iban').eq('company_id', activeCompanyId!).order('last_name').limit(200);
    return data ?? [];
  }, enabled: !!activeCompanyId });

  const collectable = useQuery({ queryKey: ['sepa-collectable', activeCompanyId, dueTo], queryFn: () => getSepaCollectable(activeCompanyId!, dueTo), enabled: !!activeCompanyId });

  const addMandate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('sepa_mandates').insert({ company_id: activeCompanyId!, ...form });
      if (error) throw error;
    },
    onSuccess: () => { setForm({ contact_id: '', mandate_ref: '', iban: '', bic: '', signature_date: today(), seq_type: 'RCUR' }); mandates.refetch(); collectable.refetch(); },
  });

  const gen = useMutation({ mutationFn: () => generateSepaFile(activeCompanyId!, dueTo, collDate), onSuccess: (n) => { setMsg(`${n} ${t('accounting.sepaGenerated')}`); collectable.refetch(); } });
  const unpaid = useMutation({ mutationFn: (r: { document_id: string; amount_due: number }) => recordSepaUnpaid(r.document_id, r.amount_due), onSuccess: () => { setMsg(t('accounting.sepaUnpaidOk')); collectable.refetch(); } });

  const contactName = (c: { first_name?: string | null; last_name?: string | null; company_name?: string | null }) => c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';

  return (
    <>
      <PageHeader title={t('accounting.sepa')} description={t('accounting.sepaSub')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/accounting' })}><ArrowLeft /> {t('accounting.title')}</Button>} />

      {msg && <p className="mb-3 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">{msg}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Mandats */}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accounting.sepaMandates')}</p>
          <div className="mb-3 grid gap-2 rounded-md border border-border bg-card p-3">
            <Select value={form.contact_id} onValueChange={(v) => { const c = contacts.data?.find((x) => x.id === v); setForm({ ...form, contact_id: v, iban: c?.iban || form.iban }); }}>
              <SelectTrigger><SelectValue placeholder={t('accounting.sepaContact')} /></SelectTrigger>
              <SelectContent>{contacts.data?.map((c) => <SelectItem key={c.id} value={c.id}>{contactName(c)}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder={t('accounting.sepaRum')} value={form.mandate_ref} onChange={(e) => setForm({ ...form, mandate_ref: e.target.value })} />
            <Input placeholder={t('accounting.sepaIban')} value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} />
            <div className="flex gap-2">
              <Input placeholder={t('accounting.sepaBic')} value={form.bic} onChange={(e) => setForm({ ...form, bic: e.target.value })} />
              <Input type="date" value={form.signature_date} onChange={(e) => setForm({ ...form, signature_date: e.target.value })} />
            </div>
            <Button onClick={() => addMandate.mutate()} disabled={addMandate.isPending || !form.contact_id || !form.mandate_ref || !form.iban}>
              {addMandate.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('accounting.sepaSave')}
            </Button>
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[12px]">
              <thead className="bg-muted"><tr><Th>{t('accounting.sepaContact')}</Th><Th>{t('accounting.sepaRum')}</Th><Th>{t('accounting.sepaIban')}</Th></tr></thead>
              <tbody>
                {mandates.data?.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">{t('accounting.sepaNoMandate')}</td></tr>}
                {mandates.data?.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">{contactName((m.contacts ?? {}) as never)}</td>
                    <td className="px-3 py-1.5 font-mono">{m.mandate_ref}</td>
                    <td className="px-3 py-1.5 font-mono">{m.iban}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Remise SEPA */}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accounting.sepaCollect')}</p>
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-3">
            <div className="space-y-1"><Lbl>{t('accounting.sepaDueTo')}</Lbl><Input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} /></div>
            <div className="space-y-1"><Lbl>{t('accounting.sepaCollDate')}</Lbl><Input type="date" value={collDate} onChange={(e) => setCollDate(e.target.value)} /></div>
            <Button onClick={() => gen.mutate()} disabled={gen.isPending || !collectable.data?.length}>{gen.isPending ? <Loader2 className="animate-spin" /> : <FileDown />} {t('accounting.sepaGenerate')}</Button>
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[12px]">
              <thead className="bg-muted"><tr><Th>{t('accounting.colNumber')}</Th><Th>{t('accounting.sepaContact')}</Th><Th className="text-right">{t('accounting.sepaDue')}</Th><Th /></tr></thead>
              <tbody>
                {collectable.data?.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">{t('accounting.sepaNoCollect')}</td></tr>}
                {collectable.data?.map((r) => (
                  <tr key={r.document_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5 font-mono">{r.number}</td>
                    <td className="px-3 py-1.5">{r.contact_name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{eur(r.amount_due)}</td>
                    <td className="px-3 py-1.5 text-right"><Button variant="ghost" size="sm" onClick={() => unpaid.mutate(r)}><AlertTriangle className="size-3.5" /> {t('accounting.sepaUnpaid')}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function Lbl({ children }: { children: React.ReactNode }) { return <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>; }
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>; }
