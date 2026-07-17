import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, Building2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { listCompanies, updateCompany, createCompany, type Company, type CompanyPatch } from '@/modules/settings/companies-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/companies')({
  head: () => ({ meta: [{ title: 'Sociétés — Ducati Bruxelles' }] }),
  component: CompaniesPage,
});

function CompaniesPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const { data } = useQuery({ queryKey: ['companies-list'], queryFn: listCompanies });

  if (!isAdmin()) return <><PageHeader title={t('settings.coTitle')} /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('settings.notAdmin')}</p></>;
  const current = data?.find((c) => c.id === selected) ?? data?.[0] ?? null;

  return (
    <>
      <PageHeader
        title={t('settings.coTitle')}
        description={t('settings.companiesDesc')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/settings' })}><ArrowLeft /> {t('settings.title')}</Button>
            <Button onClick={() => setShowNew(true)}><Plus /> {t('settings.coNew')}</Button>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-1">
          {data?.map((c) => (
            <button key={c.id} type="button" onClick={() => setSelected(c.id)} className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ${current?.id === c.id ? 'border-ring bg-accent' : 'border-border hover:bg-accent'}`}>
              <Building2 className="size-4 text-muted-foreground" /><span className="truncate">{c.name}</span>{!c.is_active && <span className="ml-auto text-[11px] text-muted-foreground">inactive</span>}
            </button>
          ))}
        </div>
        {current && <CompanyForm key={current.id} company={current} onSaved={() => qc.invalidateQueries({ queryKey: ['companies-list'] })} />}
      </div>
      {showNew && <NewCompanyDialog onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); setSelected(id); qc.invalidateQueries({ queryKey: ['companies-list'] }); }} />}
    </>
  );
}

function CompanyForm({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const [f, setF] = useState<CompanyPatch>({
    name: company.name, legal_name: company.legal_name, vat_number: company.vat_number, address: company.address,
    zip: company.zip, city: company.city, country: company.country, iban: company.iban, peppol_id: company.peppol_id,
    sales_account_default: company.sales_account_default, customer_account_default: company.customer_account_default,
    vat_account_default: company.vat_account_default, is_active: company.is_active,
    inbound_mailbox: company.inbound_mailbox,
    round_sale_prices_up: company.round_sale_prices_up,
    price_floor_threshold: Number((company as Record<string, unknown>).price_floor_threshold ?? 1),
    price_floor_min: Number((company as Record<string, unknown>).price_floor_min ?? 2),
  });
  const set = (k: keyof CompanyPatch, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const [msg, setMsg] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => updateCompany(company.id, f), onSuccess: () => { setMsg(t('settings.coSaved')); onSaved(); } });

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <Section title={t('settings.coSecLegal')}>
        <Field label={t('settings.coCode')}><Input value={company.code} disabled className="font-mono" /></Field>
        <Field label={t('settings.coName')}><Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label={t('settings.coLegalName')}><Input value={f.legal_name ?? ''} onChange={(e) => set('legal_name', e.target.value)} /></Field>
        <Field label={t('settings.coVat')}><Input value={f.vat_number ?? ''} onChange={(e) => set('vat_number', e.target.value)} className="font-mono" placeholder="BE0..." /></Field>
        <Field label={t('settings.coAddress')}><Input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label={t('settings.coZip')}><Input value={f.zip ?? ''} onChange={(e) => set('zip', e.target.value)} /></Field>
        <Field label={t('settings.coCity')}><Input value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label={t('settings.coCountry')}><Input value={f.country ?? 'BE'} onChange={(e) => set('country', e.target.value)} /></Field>
      </Section>
      <Section title={t('settings.coSecAccounting')}>
        <Field label={t('settings.coIban')}><Input value={f.iban ?? ''} onChange={(e) => set('iban', e.target.value)} className="font-mono" /></Field>
        <Field label={t('settings.coPeppol')}><Input value={f.peppol_id ?? ''} onChange={(e) => set('peppol_id', e.target.value)} className="font-mono" placeholder="9925:BE0..." /></Field>
        <Field label={t('settings.coSalesAccount')}><Input value={f.sales_account_default ?? ''} onChange={(e) => set('sales_account_default', e.target.value)} className="font-mono" /></Field>
        <Field label={t('settings.coCustomerAccount')}><Input value={f.customer_account_default ?? ''} onChange={(e) => set('customer_account_default', e.target.value)} className="font-mono" /></Field>
        <Field label={t('settings.coVatAccount')}><Input value={f.vat_account_default ?? ''} onChange={(e) => set('vat_account_default', e.target.value)} className="font-mono" /></Field>
        <Field label={t('settings.coInboundMailbox')}><Input type="email" value={f.inbound_mailbox ?? ''} onChange={(e) => set('inbound_mailbox', e.target.value)} placeholder="info@ducatibxl.be" /></Field>
        <Field label={t('settings.coActive')}>
          <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={!!f.is_active} onChange={(e) => set('is_active', e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('settings.coActive')}</label>
        </Field>
      </Section>
      <Section title={t('settings.coSecPricing')}>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!f.round_sale_prices_up} onChange={(e) => set('round_sale_prices_up', e.target.checked)} className="size-4 accent-[var(--ducati-red)]" />
            {t('settings.coRoundPrices')}
          </label>
          <p className="mt-1 text-[12px] text-muted-foreground">{t('settings.coRoundPricesHint')}</p>
        </div>
        <Field label={t('settings.coFloorThreshold')}>
          <Input
            type="number" step="0.01" min="0"
            value={f.price_floor_threshold ?? ''}
            onChange={(e) => setF((p) => ({ ...p, price_floor_threshold: Number(e.target.value) || 0 }))}
            className="text-right tabular-nums"
          />
        </Field>
        <Field label={t('settings.coFloorMin')}>
          <Input
            type="number" step="0.01" min="0"
            value={f.price_floor_min ?? ''}
            onChange={(e) => setF((p) => ({ ...p, price_floor_min: Number(e.target.value) || 0 }))}
            className="text-right tabular-nums"
          />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <p className="text-[12px] text-muted-foreground">{t('settings.coFloorHint')}</p>
        </div>
      </Section>
      {msg && <p className="rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">{msg}</p>}
      <div className="flex justify-end"><Button onClick={() => { setMsg(null); save.mutate(); }} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : null} {t('settings.coSave')}</Button></div>
    </div>
  );
}

function NewCompanyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ code: '', name: '', vat: '', address: '', zip: '', city: '' });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({ mutationFn: () => createCompany(f), onSuccess: (id) => onCreated(id), onError: (e) => setError(e instanceof Error ? e.message : 'Erreur') });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('settings.coNew')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.coCode')}><Input value={f.code} onChange={(e) => set('code', e.target.value)} className="font-mono" /></Field>
          <Field label={t('settings.coName')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label={t('settings.coVat')}><Input value={f.vat} onChange={(e) => set('vat', e.target.value)} className="font-mono" /></Field>
          <Field label={t('settings.coCity')}><Input value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
        </div>
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => { setError(null); create.mutate(); }} disabled={create.isPending || !f.code.trim() || !f.name.trim()}>{create.isPending ? <Loader2 className="animate-spin" /> : null} {t('settings.coCreate')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div><p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{title}</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div></div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
