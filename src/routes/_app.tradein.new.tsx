import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Recycle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { createReprise } from '@/modules/tradein/write-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/tradein/new')({
  head: () => ({ meta: [{ title: 'Nouvelle reprise — Ducati Bruxelles' }] }),
  component: NewReprise,
});

const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

function NewReprise() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [isPro, setIsPro] = useState(false);
  const [f, setF] = useState({ designation: '', vin: '', brand: '', model: '', engineNumber: '', color: '', mileage: '', firstReg: '', reprise: '', resale: '', vat: '21' });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () => createReprise({
      companyId: activeCompanyId!, isPro, designation: f.designation || f.model || 'Occasion',
      vin: f.vin || null, brand: f.brand || null, model: f.model || null, engineNumber: f.engineNumber || null,
      color: f.color || null, mileage: f.mileage ? Math.round(num(f.mileage)) : null, firstRegistrationDate: f.firstReg || null,
      reprisePrice: num(f.reprise), resalePriceTtc: f.resale ? num(f.resale) : null, vatRate: num(f.vat),
    }),
    onSuccess: (r) => navigate({ to: '/tradein/$oroId', params: { oroId: r.oroId } }),
    onError: (e) => setError(e instanceof Error ? e.message : t('tradein.errSave')),
  });

  if (!activeCompanyId) return null;

  return (
    <>
      <PageHeader title={t('tradein.repriseTitle')} actions={<Button variant="outline" onClick={() => navigate({ to: '/tradein' })}><ArrowLeft /> {t('tradein.back')}</Button>} />
      <div className="max-w-3xl space-y-4">
        <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-3">
          <Field label={t('tradein.sellerType')}>
            <Select value={isPro ? 'pro' : 'part'} onValueChange={(v) => setIsPro(v === 'pro')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="part">{t('tradein.seller_particulier')}</SelectItem><SelectItem value="pro">{t('tradein.seller_pro')}</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label={t('tradein.designation')}><Input value={f.designation} onChange={(e) => set('designation', e.target.value)} /></Field>
          <Field label={t('tradein.vin')}><Input value={f.vin} onChange={(e) => set('vin', e.target.value)} className="font-mono" maxLength={17} /></Field>
          <Field label={t('tradein.brand')}><Input value={f.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
          <Field label={t('tradein.model')}><Input value={f.model} onChange={(e) => set('model', e.target.value)} /></Field>
          <Field label={t('tradein.engineNumber')}><Input value={f.engineNumber} onChange={(e) => set('engineNumber', e.target.value)} /></Field>
          <Field label={t('tradein.color')}><Input value={f.color} onChange={(e) => set('color', e.target.value)} /></Field>
          <Field label={t('tradein.mileage')}><Input type="number" value={f.mileage} onChange={(e) => set('mileage', e.target.value)} className="text-right tabular-nums" /></Field>
          <Field label={t('tradein.firstReg')}><Input type="date" value={f.firstReg} onChange={(e) => set('firstReg', e.target.value)} /></Field>
          <Field label={t('tradein.reprisePrice')}><Input type="number" step="0.01" value={f.reprise} onChange={(e) => set('reprise', e.target.value)} className="text-right tabular-nums" /></Field>
          <Field label={t('tradein.resalePrice')}><Input type="number" step="0.01" value={f.resale} onChange={(e) => set('resale', e.target.value)} className="text-right tabular-nums" /></Field>
          <Field label={t('tradein.vatRate')}><Input type="number" step="0.1" value={f.vat} onChange={(e) => set('vat', e.target.value)} className="text-right tabular-nums" /></Field>
        </div>
        <p className="rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t('tradein.createInfo')}</p>
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
        <div className="flex justify-end">
          <Button onClick={() => m.mutate()} disabled={m.isPending || num(f.reprise) <= 0}>{m.isPending ? <Loader2 className="animate-spin" /> : <Recycle />} {t('tradein.create')}</Button>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
