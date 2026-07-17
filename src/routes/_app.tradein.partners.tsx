import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, Trash2, Pencil, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import {
  listPartners, addPartner, updatePartner, deletePartner, checkPartnersSchema,
  type TradeinPartner, type PartnerExtraContact, type PartnerInput,
} from '@/modules/tradein/partners-api';
import { MOTO_BRANDS } from '@/modules/tradein/reprise-wizard-data';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/tradein/partners')({
  head: () => ({ meta: [{ title: 'Marchands partenaires — Ducati Bruxelles' }] }),
  component: PartnersPage,
});

const EMPTY: PartnerForm = {
  name: '', first_name: '', company: '', email: '', phone: '',
  brands: new Set<string>(), extra: [],
};
type PartnerForm = {
  name: string; first_name: string; company: string; email: string; phone: string;
  brands: Set<string>; extra: PartnerExtraContact[];
};

function toInput(f: PartnerForm): PartnerInput {
  return {
    name: f.name, first_name: f.first_name || null, company: f.company || null,
    email: f.email, phone: f.phone || null,
    extra_contacts: f.extra.filter((x) => x.value.trim() !== ''),
    brands: [...f.brands],
  };
}

function fromPartner(p: TradeinPartner): PartnerForm {
  return {
    name: p.name, first_name: p.first_name ?? '', company: p.company ?? '',
    email: p.email, phone: p.phone ?? '',
    brands: new Set(p.brands), extra: p.extra_contacts ?? [],
  };
}

function PartnersPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [f, setF] = useState<PartnerForm>(EMPTY);

  const schemaQ = useQuery({ queryKey: ['partners-schema', activeCompanyId], queryFn: checkPartnersSchema, enabled: !!activeCompanyId });
  const partnersQ = useQuery({ queryKey: ['tradein-partners', activeCompanyId], queryFn: () => listPartners(activeCompanyId!), enabled: !!activeCompanyId });
  const partners = partnersQ.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tradein-partners', activeCompanyId] });
  const save = useMutation({
    mutationFn: async () => {
      if (editingId === 'new') await addPartner(activeCompanyId!, toInput(f));
      else if (editingId) await updatePartner(editingId, { ...toInput(f) });
    },
    onSuccess: () => { setEditingId(null); setF(EMPTY); invalidate(); },
    onError: () => toast.error(t('tradein.errSave')),
  });
  const del = useMutation({ mutationFn: (id: string) => deletePartner(id), onSuccess: invalidate });
  const toggleActive = useMutation({
    mutationFn: (p: TradeinPartner) => updatePartner(p.id, { is_active: !p.is_active }),
    onSuccess: invalidate,
  });

  const startEdit = (p: TradeinPartner) => { setEditingId(p.id); setF(fromPartner(p)); };
  const set = <K extends keyof PartnerForm>(k: K, v: PartnerForm[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const toggleBrand = (b: string) => setF((prev) => { const n = new Set(prev.brands); if (n.has(b)) n.delete(b); else n.add(b); return { ...prev, brands: n }; });

  return (
    <>
      <PageHeader
        title={t('tradein.partners')}
        description={t('tradein.partnersHint')}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => { setEditingId('new'); setF(EMPTY); }}><Plus /> {t('tradein.partnerAdd')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/tradein' })}><ArrowLeft /> {t('tradein.back')}</Button>
          </div>
        }
      />

      {schemaQ.data === false && (
        <p className="mb-4 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('tradein.migrationBanner')}</p>
      )}

      <p className="mb-2 text-[13px] tabular-nums text-muted-foreground">{t('tradein.partnersCount').replace('{n}', String(partners.length))}</p>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('tradein.partnerName')}</Th>
              <Th>{t('tradein.partnerCompany')}</Th>
              <Th>{t('tradein.partnerEmail')}</Th>
              <Th>{t('tradein.partnerPhone')}</Th>
              <Th>{t('tradein.partnerBrands')}</Th>
              <Th>{t('tradein.partnerActive')}</Th>
              <Th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {partnersQ.isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {!partnersQ.isLoading && partners.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{t('tradein.partnerNone')}</td></tr>}
            {partners.map((p) => (
              <tr key={p.id} className={`border-b border-border last:border-0 ${p.is_active ? '' : 'opacity-55'}`}>
                <td className="px-3 py-2 font-medium">{[p.first_name, p.name].filter(Boolean).join(' ')}</td>
                <td className="px-3 py-2">{p.company ?? '—'}</td>
                <td className="px-3 py-2">
                  {p.email}
                  {(p.extra_contacts ?? []).filter((x) => x.kind === 'mail').map((x, i) => (
                    <span key={i} className="block text-[12px] text-muted-foreground">{x.label} : {x.value}</span>
                  ))}
                </td>
                <td className="px-3 py-2">
                  {p.phone ?? '—'}
                  {(p.extra_contacts ?? []).filter((x) => x.kind !== 'mail').map((x, i) => (
                    <span key={i} className="block text-[12px] text-muted-foreground">{x.label} : {x.value}</span>
                  ))}
                </td>
                <td className="px-3 py-2">{p.brands.length === 0 ? t('tradein.partnerAllBrands') : p.brands.join(', ')}</td>
                <td className="px-3 py-2" onClick={() => toggleActive.mutate(p)}>
                  <button type="button"><StatusBadge tone={p.is_active ? 'success' : 'neutral'} label={p.is_active ? t('tradein.partnerActive') : '—'} /></button>
                </td>
                <td className="px-2 py-1 text-right">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(p)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => del.mutate(p.id)}><Trash2 className="size-4 text-danger" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Formulaire ajout / édition */}
      {editingId && (
        <div className="mt-4 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <h2 className="mb-3 font-ui text-[15px] font-bold text-foreground">
            {editingId === 'new' ? t('tradein.partnerAdd') : [f.first_name, f.name].filter(Boolean).join(' ')}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('tradein.partnerName')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label={t('tradein.partnerFirstName')}><Input value={f.first_name} onChange={(e) => set('first_name', e.target.value)} /></Field>
            <Field label={t('tradein.partnerCompany')}><Input value={f.company} onChange={(e) => set('company', e.target.value)} /></Field>
            <Field label={t('tradein.partnerEmail')}><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label={t('tradein.partnerPhone')}><Input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          </div>

          {/* Contacts supplémentaires flexibles (Mail 2, Téléphone 2, Autre…) */}
          <p className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.partnerExtra')}</p>
          <div className="space-y-2">
            {f.extra.map((x, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select value={x.kind} onValueChange={(v) => set('extra', f.extra.map((y, j) => j === i ? { ...y, kind: v as PartnerExtraContact['kind'] } : y))}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mail">{t('tradein.extraKind_mail')}</SelectItem>
                    <SelectItem value="phone">{t('tradein.extraKind_phone')}</SelectItem>
                    <SelectItem value="autre">{t('tradein.extraKind_autre')}</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="w-40" placeholder={t('tradein.extraLabel')} value={x.label} onChange={(e) => set('extra', f.extra.map((y, j) => j === i ? { ...y, label: e.target.value } : y))} />
                <Input className="w-64 flex-1" placeholder={t('tradein.extraValue')} value={x.value} onChange={(e) => set('extra', f.extra.map((y, j) => j === i ? { ...y, value: e.target.value } : y))} />
                <Button variant="ghost" size="sm" onClick={() => set('extra', f.extra.filter((_, j) => j !== i))}><X className="size-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => set('extra', [...f.extra, { kind: 'mail', label: '', value: '' }])}>
              <Plus className="size-4" /> {t('tradein.extraAdd')}
            </Button>
          </div>

          <p className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
            {t('tradein.partnerBrands')} <span className="font-normal normal-case">— {t('tradein.partnerAllBrands').toLowerCase()} si aucune cochée</span>
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            {MOTO_BRANDS.filter((b) => b !== 'Autre').map((b) => (
              <label key={b} className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={f.brands.has(b)} onCheckedChange={() => toggleBrand(b)} /> {b}
              </label>
            ))}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setEditingId(null); setF(EMPTY); }}>{t('action.cancel')}</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !f.name.trim() || !f.email.trim()}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('action.save')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
