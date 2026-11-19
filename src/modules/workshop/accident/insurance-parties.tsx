/**
 * M8 — Fichier des cabinets d'assurance et des experts (G8 : « Fiche assurance »), rattrapage G8
 * du 18/11/2026. Liste (Atelier → Dossiers accident → onglet « Cabinets et experts ») et fenetre
 * de fiche, reutilisee depuis le volet assureur de l'OR (bouton « Nouveau »).
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Loader2, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCanWrite } from '@/lib/auth/use-access';
import { errorMessage } from '@/lib/mutation-feedback';
import { t } from '@/lib/i18n';
import {
  createInsuranceParty, insuranceSchemaReady, insurerTariffSchemaReady, listInsuranceParties, updateInsuranceParty,
  type InsuranceParty, type InsurancePartyInput,
} from './insurance-api';
import { listPriceLists } from '@/modules/sales/customer-pricing-api';

const NO_LIST = ' none';
import { INSURANCE_PARTY_KINDS, validateInsuranceParty, type InsurancePartyKind } from './insurance-rules';

export const insurancePartiesKey = (companyId: string) => ['insurance-parties', companyId];

const EMPTY: InsurancePartyInput = {
  kind: 'cabinet', code: '', name: '', address: '', postal_code: '', city: '', country: 'BE', phone: '', phone2: '', fax: '',
  email: '', company_number: '', vat_number: '', contact_name: '', comments: '', accounting_account: '', price_list: '', is_active: true,
};

export function InsurancePartiesList({ companyId }: { companyId: string }) {
  const canWrite = useCanWrite();
  const [kind, setKind] = useState<InsurancePartyKind | 'all'>('all');
  const [editing, setEditing] = useState<InsuranceParty | 'new' | null>(null);
  const schema = useQuery({ queryKey: ['insurance-schema'], queryFn: insuranceSchemaReady, staleTime: Infinity });
  const q = useQuery({ queryKey: insurancePartiesKey(companyId), queryFn: () => listInsuranceParties(companyId), enabled: schema.data === true });
  if (schema.data === false) return <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('insurance.migrationMissing')}</p>;
  const rows = (q.data ?? []).filter((p) => kind === 'all' || p.kind === kind);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as InsurancePartyKind | 'all')}>
          <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('insurance.kindAll')}</SelectItem>
            {INSURANCE_PARTY_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`insurance.kind_${k}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        {canWrite && <Button className="ml-auto" onClick={() => setEditing('new')}><Plus /> {t('insurance.new')}</Button>}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>{[t('insurance.kind'), t('insurance.code'), t('insurance.name'), t('insurance.city'), t('insurance.phone'), t('insurance.email'), t('insurance.accountingAccount'), t('insurance.priceList'), t('insurance.active')].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={9} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {!q.isLoading && rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">{t('insurance.empty')}</td></tr>}
            {rows.map((p) => (
              <tr key={p.id} onClick={() => canWrite && setEditing(p)} className={`border-b border-border last:border-0 ${canWrite ? 'cursor-pointer hover:bg-accent' : ''}`}>
                <td className="px-3 py-2">{t(`insurance.kind_${p.kind}`)}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{p.code ?? '—'}</td>
                <td className="px-3 py-2">{p.name}{p.contact_name && <div className="text-[12px] text-muted-foreground">{p.contact_name}</div>}</td>
                <td className="px-3 py-2">{[p.postal_code, p.city].filter(Boolean).join(' ') || '—'}</td>
                <td className="px-3 py-2 tabular-nums">{p.phone ?? '—'}</td>
                <td className="px-3 py-2">{p.email ?? '—'}</td>
                <td className="px-3 py-2 font-data">{p.accounting_account ?? '—'}</td>
                <td className="px-3 py-2">{p.price_list ?? '—'}</td>
                <td className="px-3 py-2">{p.is_active
                  ? <StatusBadge tone="success" icon={CheckCircle2} label={t('insurance.activeYes')} />
                  : <StatusBadge tone="neutral" icon={Circle} label={t('insurance.activeNo')} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <InsurancePartyDialog
          companyId={companyId} party={editing === 'new' ? null : editing} defaultKind={kind === 'all' ? 'cabinet' : kind}
          onClose={() => setEditing(null)} onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Fiche d'un cabinet d'assurance ou d'un expert (creation ou modification). */
export function InsurancePartyDialog({ companyId, party, defaultKind = 'cabinet', onClose, onSaved }: {
  companyId: string; party: InsuranceParty | null; defaultKind?: InsurancePartyKind;
  onClose: () => void; onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<InsurancePartyInput>(() => (party ? { ...EMPTY, ...stripMeta(party) } : { ...EMPTY, kind: defaultKind }));
  const [errors, setErrors] = useState<string[]>([]);
  // T4 : le tarif du cabinet se choisit parmi les tarifs communs (meme moteur que les tarifs clients).
  const tariffSchema = useQuery({ queryKey: ['insurer-tariff-schema'], queryFn: insurerTariffSchemaReady, staleTime: Infinity });
  const listsQ = useQuery({ queryKey: ['price-lists', companyId], queryFn: () => listPriceLists(companyId), enabled: tariffSchema.data === true, staleTime: 60_000 });
  const lists = tariffSchema.data === true ? listsQ.data ?? null : null;
  const save = useMutation({
    mutationFn: async () => {
      const errs = validateInsuranceParty(f);
      setErrors(errs);
      if (errs.length) throw new Error(t('insurance.errInvalid'));
      if (party) { await updateInsuranceParty(party.id, f); return party.id; }
      return createInsuranceParty(companyId, f);
    },
    meta: { success: false },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: insurancePartiesKey(companyId) }); toast.success(t('insurance.saved')); onSaved(id); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const txt = (k: keyof InsurancePartyInput) => ({
    value: (f[k] as string | null) ?? '',
    onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }),
  });
  const bad = (k: string) => (errors.includes(k) ? 'border-danger' : '');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{party ? party.name : t('insurance.new')}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label={t('insurance.kind')}>
            <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as InsurancePartyKind })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{INSURANCE_PARTY_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`insurance.kind_${k}`)}</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <F label={t('insurance.code')}><Input {...txt('code')} className="h-9 font-data uppercase" /></F>
          <div className="sm:col-span-2"><F label={t('insurance.name')}><Input {...txt('name')} className={`h-9 ${bad('name')}`} /></F></div>
          <div className="sm:col-span-2"><F label={t('insurance.address')}><Input {...txt('address')} className="h-9" /></F></div>
          <F label={t('insurance.postalCode')}><Input {...txt('postal_code')} className="h-9" /></F>
          <F label={t('insurance.city')}><Input {...txt('city')} className="h-9" /></F>
          <F label={t('insurance.country')}><Input {...txt('country')} className="h-9 uppercase" maxLength={2} /></F>
          <F label={t('insurance.contactName')}><Input {...txt('contact_name')} className="h-9" /></F>
          <F label={t('insurance.phone')}><Input {...txt('phone')} className="h-9" /></F>
          <F label={t('insurance.phone2')}><Input {...txt('phone2')} className="h-9" /></F>
          <F label={t('insurance.fax')}><Input {...txt('fax')} className="h-9" /></F>
          <F label={t('insurance.email')}><Input type="email" {...txt('email')} className={`h-9 ${bad('email')}`} /></F>
          <F label={t('insurance.companyNumber')}><Input {...txt('company_number')} className="h-9 font-data" /></F>
          <F label={t('insurance.vatNumber')}><Input {...txt('vat_number')} className="h-9 font-data uppercase" /></F>
          <F label={t('insurance.accountingAccount')}><Input {...txt('accounting_account')} className="h-9 font-data" /></F>
          {f.kind === 'cabinet' && (
            <F label={t('insurance.priceList')}>
              {lists ? (
                <Select
                  value={f.price_list_id ?? NO_LIST}
                  onValueChange={(v) => {
                    const l = lists.find((x) => x.id === v);
                    setF({ ...f, price_list_id: l ? l.id : null, price_list: l ? l.code : '' });
                  }}
                >
                  <SelectTrigger className="h-9"><SelectValue placeholder={t('insurance.priceListHint')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LIST}>{t('insurance.priceListNone')}</SelectItem>
                    {lists.filter((l) => l.is_active !== false || l.id === f.price_list_id).map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.code}{l.label ? ` — ${l.label}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input {...txt('price_list')} className="h-9" placeholder={t('insurance.priceListHint')} />
              )}
              <p className="text-[12px] text-muted-foreground">{t('insurance.priceListAuto')}</p>
            </F>
          )}
          <div className="sm:col-span-2"><F label={t('insurance.comments')}><Textarea rows={2} {...txt('comments')} /></F></div>
          <div className="flex items-center gap-3">
            <Switch id="insurance-active" checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} />
            <Label htmlFor="insurance-active">{t('insurance.active')}</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('insurance.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('insurance.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function stripMeta(p: InsuranceParty): InsurancePartyInput {
  const { id: _id, company_id: _c, created_at: _a, updated_at: _u, ...rest } = p;
  return rest;
}

function F({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
