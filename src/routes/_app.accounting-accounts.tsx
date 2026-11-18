import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, Save, Plus, Trash2, Wand2, RefreshCw, UserRoundSearch, ArrowLeft, Send } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { t, pageTitle, fillVars } from '@/lib/i18n';
import {
  getEbpSettings, saveEbpSettings, listRules, saveRule, deleteRule, listThirdAccounts, saveThirdAccount, deleteThirdAccount,
  createThirdAccounts, searchContactsForAccount, parseEbpSettings,
  type EbpRule, type EbpRuleKind, type EbpSettings,
} from '@/modules/accounting/ebp-api';

/**
 * M12 — Paramétrage des comptes façon G8 (Compta › Gestion des comptes, 8 volets, et Paramètres
 * transfert comptable, 7 onglets). lot-g8-export-compta, 18/11/2026. Plan de comptes G8 par défaut :
 * à trancher avec le comptable.
 */
export const Route = createFileRoute('/_app/accounting-accounts')({
  head: () => ({ meta: [{ title: pageTitle('accountingAccounts') }] }),
  component: AccountingAccountsPage,
});

type FieldType = 'text' | 'bool' | 'number' | 'select';
type Field = { path: string; type: FieldType; options?: { value: string; label: string }[] };
const opt = (values: string[], prefix: string) => values.map((v) => ({ value: v, label: `${prefix}${v}` }));

const SECTIONS: { title: string; fields: Field[] }[] = [
  { title: 'ebp.secGeneral', fields: [
    { path: 'enabled', type: 'bool' }, { path: 'targetDir', type: 'text' }, { path: 'entriesFile', type: 'text' }, { path: 'accountsFile', type: 'text' },
    { path: 'byDepartment', type: 'bool' },
    { path: 'selection', type: 'select', options: [{ value: 'period', label: 'ebp.byPeriod' }, { value: 'number', label: 'ebp.byNumber' }] },
    { path: 'writeMode', type: 'select', options: [{ value: 'invoice', label: 'ebp.modeInvoice' }, { value: 'semi_global', label: 'ebp.modeSemi' }] },
    { path: 'includeSales', type: 'bool' }, { path: 'includePayments', type: 'bool' }, { path: 'includePurchases', type: 'bool' },
    { path: 'includeCessions', type: 'bool' }, { path: 'includeConsignments', type: 'bool' }, { path: 'paymentsFirst', type: 'bool' }, { path: 'dedupeThirds', type: 'bool' },
    { path: 'auto.frequency', type: 'select', options: opt(['off', 'daily', 'weekly', 'fortnightly', 'monthly'], 'ebp.freq_') },
    { path: 'auto.sendEmail', type: 'bool' }, { path: 'auto.email', type: 'text' },
  ] },
  { title: 'ebp.secSales', fields: [
    'defaultCustomerAccount', 'thirdType', 'collectiveAccount', 'defaultCustomerLabel', 'salesAccount', 'retroAccount', 'retroCategories',
    'journal', 'creditJournal', 'vatAccount', 'deeeAccount',
  ].map((k) => ({ path: `sales.${k}`, type: 'text' as FieldType })).concat([
    { path: 'sales.customerAutoBase', type: 'number' }, { path: 'sales.customerAutoWidth', type: 'number' },
    { path: 'sales.onTheFlyPrefix', type: 'text' }, { path: 'sales.onTheFlyPad', type: 'number' },
  ]) },
  { title: 'ebp.secPayments', fields: [
    ...['journal', 'cashJournal', 'paymentAccount', 'cashMovementAccount', 'depositAccount', 'exceptionalAccount'].map((k) => ({ path: `payments.${k}`, type: 'text' as FieldType })),
    { path: 'payments.includeBankDeposits', type: 'bool' },
  ] },
  { title: 'ebp.secPurchases', fields: [
    ...['supplierDefault', 'thirdType', 'purchaseAccount', 'journal', 'vatAccount'].map((k) => ({ path: `purchases.${k}`, type: 'text' as FieldType })),
    { path: 'purchases.intracom', type: 'bool' }, { path: 'purchases.intracomVatDue', type: 'text' },
    { path: 'purchases.fnp', type: 'bool' }, { path: 'purchases.fnpAccount', type: 'text' }, { path: 'purchases.fnpJournal', type: 'text' },
    { path: 'purchases.pieceNumber', type: 'select', options: opt(['receipt', 'supplier_invoice'], 'ebp.piece_') },
    { path: 'purchases.supplierAutoBase', type: 'number' }, { path: 'purchases.supplierAutoWidth', type: 'number' },
  ] },
  { title: 'ebp.secCessions', fields: ['journal', 'account', 'counterAccount'].map((k) => ({ path: `cessions.${k}`, type: 'text' as FieldType })) },
  { title: 'ebp.secConsignments', fields: [
    { path: 'consignments.journal', type: 'text' }, { path: 'consignments.commissionAccount', type: 'text' },
    { path: 'consignments.distinguishVat', type: 'bool' }, { path: 'consignments.vatCommissionAccount', type: 'text' },
    { path: 'consignments.vatRate', type: 'number' }, { path: 'consignments.depositAccount', type: 'text' },
  ] },
  { title: 'ebp.secVatMargin', fields: [
    { path: 'vatMargin.distinguish', type: 'bool' }, { path: 'vatMargin.vatOccasionAccount', type: 'text' },
    { path: 'vatMargin.marginAccount', type: 'text' }, { path: 'vatMargin.vatOnTradeInAccount', type: 'text' },
  ] },
];

type Rec = Record<string, unknown>;
const getPath = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Rec)[k] : undefined), o);
function setPath<T>(o: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const clone = structuredClone(o) as Rec;
  let cur: Rec = clone;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] as Rec;
  cur[keys[keys.length - 1]] = value;
  return clone as T;
}
const fieldLabel = (path: string) => t(`ebp.f_${path.replace(/\./g, '_')}`);

function AccountingAccountsPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const settings = useQuery({ queryKey: ['ebp-settings', activeCompanyId], queryFn: () => getEbpSettings(activeCompanyId!), enabled: !!activeCompanyId });
  const rules = useQuery({ queryKey: ['ebp-rules', activeCompanyId], queryFn: () => listRules(activeCompanyId!), enabled: !!activeCompanyId });

  return (
    <>
      <PageHeader
        title={t('ebp.accTitle')}
        description={t('ebp.accSubtitle')}
        actions={<div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate({ to: '/accounting' })}><ArrowLeft className="size-4" /> {t('ebp.back')}</Button>
          <Button variant="outline" onClick={() => navigate({ to: '/accounting-transfer' })}><Send className="size-4" /> {t('ebp.title')}</Button>
        </div>}
      />
      <p className="mb-4 rounded-md bg-warning-bg px-3 py-2 text-[12px] text-warning">{t('ebp.toDecide')}</p>
      <Tabs defaultValue="settings">
        <TabsList className="mb-3 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="settings">{t('ebp.tabSettings')}</TabsTrigger>
          <TabsTrigger value="C">{t('ebp.tabCustomers')}</TabsTrigger>
          <TabsTrigger value="F">{t('ebp.tabSuppliers')}</TabsTrigger>
          <TabsTrigger value="sales">{t('ebp.tabSales')}</TabsTrigger>
          <TabsTrigger value="purchase">{t('ebp.tabPurchases')}</TabsTrigger>
          <TabsTrigger value="cession">{t('ebp.tabCessions')}</TabsTrigger>
          <TabsTrigger value="vat">{t('ebp.tabVat')}</TabsTrigger>
          <TabsTrigger value="payment">{t('ebp.tabPayments')}</TabsTrigger>
          <TabsTrigger value="cash_movement">{t('ebp.tabMovements')}</TabsTrigger>
        </TabsList>
        <TabsContent value="settings">
          {settings.data ? <SettingsForm initial={settings.data} canWrite={canWrite} onSaved={() => settings.refetch()} /> : <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        </TabsContent>
        {(['C', 'F'] as const).map((k) => (
          <TabsContent key={k} value={k}>
            {settings.data && <ThirdAccounts kind={k} settings={settings.data} canWrite={canWrite} />}
          </TabsContent>
        ))}
        {(['sales', 'purchase', 'cession', 'vat', 'payment', 'cash_movement'] as EbpRuleKind[]).map((k) => (
          <TabsContent key={k} value={k}>
            <RulesTable kind={k} rules={(rules.data ?? []).filter((r) => r.kind === k)} canWrite={canWrite} onChange={() => rules.refetch()} loading={rules.isLoading} />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

// ------------------------------------------------------------------------------------------
function SettingsForm({ initial, canWrite, onSaved }: { initial: EbpSettings; canWrite: boolean; onSaved: () => void }) {
  const { activeCompanyId } = useAuth();
  const [s, setS] = useState<EbpSettings>(initial);
  useEffect(() => setS(initial), [initial]);
  const save = useMutation({ meta: { success: t('ebp.saved') }, mutationFn: () => saveEbpSettings(activeCompanyId!, parseEbpSettings(s)), onSuccess: onSaved });
  return (
    <div className="space-y-4">
      {SECTIONS.map((sec) => (
        <fieldset key={sec.title} className="rounded-md border border-border p-3">
          <legend className="px-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(sec.title)}</legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sec.fields.map((f) => {
              const v = getPath(s, f.path);
              if (f.type === 'bool') {
                return (
                  <label key={f.path} className="flex items-center gap-2 text-[13px]">
                    <Checkbox checked={v === true} disabled={!canWrite} onCheckedChange={(c) => setS(setPath(s, f.path, c === true))} /> {fieldLabel(f.path)}
                  </label>
                );
              }
              if (f.type === 'select') {
                return (
                  <div key={f.path} className="space-y-1">
                    <Lbl>{fieldLabel(f.path)}</Lbl>
                    <Select value={String(v)} disabled={!canWrite} onValueChange={(x) => setS(setPath(s, f.path, x))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{f.options!.map((o) => <SelectItem key={o.value} value={o.value}>{t(o.label)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                );
              }
              return (
                <div key={f.path} className="space-y-1">
                  <Lbl>{fieldLabel(f.path)}</Lbl>
                  <Input
                    value={String(v ?? '')} disabled={!canWrite} className={f.type === 'number' || /ccount|ournal|Prefix/.test(f.path) ? 'font-mono' : ''}
                    inputMode={f.type === 'number' ? 'numeric' : undefined}
                    onChange={(e) => setS(setPath(s, f.path, f.type === 'number' ? Number(e.target.value.replace(',', '.')) || 0 : e.target.value))}
                  />
                </div>
              );
            })}
          </div>
          {sec.title === 'ebp.secGeneral' && <p className="mt-2 text-[12px] text-muted-foreground">{t('ebp.autoHint')}</p>}
        </fieldset>
      ))}
      {canWrite && (
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save className="size-4" />} {t('ebp.save')}
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------
function ThirdAccounts({ kind, settings, canWrite }: { kind: 'C' | 'F'; settings: EbpSettings; canWrite: boolean }) {
  const { activeCompanyId } = useAuth();
  const list = useQuery({ queryKey: ['ebp-thirds', activeCompanyId, kind], queryFn: () => listThirdAccounts(activeCompanyId!, kind), enabled: !!activeCompanyId });
  const [msg, setMsg] = useState<string | null>(null);
  const bulk = useMutation({
    meta: { success: false },
    mutationFn: (mode: 'auto' | 'refresh' | 'from_contact') => createThirdAccounts(activeCompanyId!, kind, mode, settings),
    onSuccess: (n) => { setMsg(fillVars(t('ebp.tDone'), { n })); list.refetch(); },
  });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const saveOne = useMutation({
    mutationFn: (a: { id: string; contact_id: string; account: string; label: string | null }) => saveThirdAccount(activeCompanyId!, { ...a, kind }),
    onSuccess: () => list.refetch(),
  });
  const del = useMutation({ mutationFn: (id: string) => deleteThirdAccount(id), onSuccess: () => list.refetch() });
  const [q, setQ] = useState('');
  const found = useQuery({ queryKey: ['ebp-contact-search', activeCompanyId, q], queryFn: () => searchContactsForAccount(activeCompanyId!, q), enabled: !!activeCompanyId && q.trim().length >= 2 });
  const [newAccount, setNewAccount] = useState('');
  const add = useMutation({
    mutationFn: (c: { id: string; name: string }) => saveThirdAccount(activeCompanyId!, { contact_id: c.id, kind, account: newAccount, label: c.name }),
    onSuccess: () => { setQ(''); setNewAccount(''); list.refetch(); },
  });

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">{t(kind === 'C' ? 'ebp.tAutoHintC' : 'ebp.tAutoHintF')}</p>
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => bulk.mutate('auto')} disabled={bulk.isPending}><Wand2 className="size-4" /> {t('ebp.tAuto')}</Button>
          <Button variant="outline" onClick={() => bulk.mutate('refresh')} disabled={bulk.isPending}><RefreshCw className="size-4" /> {t('ebp.tRefresh')}</Button>
          <Button variant="outline" onClick={() => bulk.mutate('from_contact')} disabled={bulk.isPending}><UserRoundSearch className="size-4" /> {t('ebp.tFromContact')}</Button>
          {bulk.isPending && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
          {msg && <span className="self-center text-[12px] text-success">{msg}</span>}
        </div>
      )}
      {canWrite && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
          <div className="space-y-1"><Lbl>{t('ebp.tSearch')}</Lbl><Input value={q} onChange={(e) => setQ(e.target.value)} className="w-72" /></div>
          <div className="space-y-1"><Lbl>{t('ebp.tAccount')}</Lbl><Input value={newAccount} onChange={(e) => setNewAccount(e.target.value)} className="w-40 font-mono" /></div>
          <div className="flex flex-wrap gap-1">
            {(found.data ?? []).map((c) => (
              <Button key={c.id} size="sm" variant="outline" disabled={!newAccount.trim() || add.isPending} onClick={() => add.mutate(c)}>
                <Plus className="size-3" /> {c.code ? `${c.code} · ` : ''}{c.name}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>{t('ebp.tCode')}</Th><Th>{t('ebp.tName')}</Th><Th>{t('ebp.tAccount')}</Th><Th>{t('ebp.tLabel')}</Th><Th>{t('ebp.tOrigin')}</Th><Th /></tr></thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('ebp.tEmpty')}</td></tr>}
            {list.data?.map((a) => {
              const val = edits[a.id] ?? a.account;
              return (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1 font-mono">{a.contact_code ?? ''}</td>
                  <td className="px-3 py-1">{a.contact_name}</td>
                  <td className="px-3 py-1">
                    <Input value={val} disabled={!canWrite} className="h-8 w-36 font-mono" onChange={(e) => setEdits({ ...edits, [a.id]: e.target.value })}
                      onBlur={() => { if (val.trim() && val !== a.account) saveOne.mutate({ id: a.id, contact_id: a.contact_id, account: val, label: a.label }); }} />
                  </td>
                  <td className="px-3 py-1">{a.label ?? ''}</td>
                  <td className="px-3 py-1 text-[12px]">{t(`ebp.origin_${a.origin}`)}</td>
                  <td className="px-3 py-1 text-right">
                    {canWrite && <Button size="sm" variant="ghost" onClick={() => del.mutate(a.id)} title={t('ebp.delete')}><Trash2 className="size-4" /></Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
type Col = { key: keyof EbpRule; type: 'text' | 'rate' | 'tri' | 'bool' | 'style'; labelKey: string };
const COLS: Record<EbpRuleKind, Col[]> = {
  sales: [
    { key: 'key', type: 'text', labelKey: 'ebp.c_key_sales' }, { key: 'family', type: 'text', labelKey: 'ebp.c_family' },
    { key: 'vat_rate', type: 'rate', labelKey: 'ebp.c_vat_rate' }, { key: 'tax_exempt', type: 'tri', labelKey: 'ebp.c_tax_exempt' },
    { key: 'demo', type: 'tri', labelKey: 'ebp.c_demo' }, { key: 'customer_category', type: 'text', labelKey: 'ebp.c_customer_category' },
    { key: 'account', type: 'text', labelKey: 'ebp.c_account' }, { key: 'account2', type: 'text', labelKey: 'ebp.c_account2_sales' },
    { key: 'journal', type: 'text', labelKey: 'ebp.c_journal' },
  ],
  purchase: [
    { key: 'key', type: 'text', labelKey: 'ebp.c_key_purchase' }, { key: 'family', type: 'text', labelKey: 'ebp.c_family' },
    { key: 'vat_rate', type: 'rate', labelKey: 'ebp.c_vat_rate' }, { key: 'account', type: 'text', labelKey: 'ebp.c_account' },
    { key: 'account2', type: 'text', labelKey: 'ebp.c_account2_purchase' }, { key: 'account3', type: 'text', labelKey: 'ebp.c_account3_purchase' },
    { key: 'journal', type: 'text', labelKey: 'ebp.c_journal' },
  ],
  cession: [
    { key: 'key', type: 'text', labelKey: 'ebp.c_key_cession' }, { key: 'label', type: 'text', labelKey: 'ebp.c_label' },
    { key: 'account', type: 'text', labelKey: 'ebp.c_account' }, { key: 'account2', type: 'text', labelKey: 'ebp.c_account2_cession' },
    { key: 'journal', type: 'text', labelKey: 'ebp.c_journal' },
  ],
  vat: [
    { key: 'vat_rate', type: 'rate', labelKey: 'ebp.c_vat_rate' }, { key: 'label', type: 'text', labelKey: 'ebp.c_label' },
    { key: 'account', type: 'text', labelKey: 'ebp.c_account' }, { key: 'account2', type: 'text', labelKey: 'ebp.c_account2_vat' },
    { key: 'account3', type: 'text', labelKey: 'ebp.c_account3_vat' }, { key: 'country', type: 'text', labelKey: 'ebp.c_country' },
  ],
  payment: [
    { key: 'key', type: 'text', labelKey: 'ebp.c_key_payment' }, { key: 'label', type: 'text', labelKey: 'ebp.c_label' },
    { key: 'account', type: 'text', labelKey: 'ebp.c_account' }, { key: 'journal', type: 'text', labelKey: 'ebp.c_journal' },
    { key: 'mode_label', type: 'text', labelKey: 'ebp.c_mode_label_payment' },
  ],
  cash_movement: [
    { key: 'key', type: 'text', labelKey: 'ebp.c_key_cash_movement' }, { key: 'label', type: 'text', labelKey: 'ebp.c_label' },
    { key: 'account', type: 'text', labelKey: 'ebp.c_account' }, { key: 'account2', type: 'text', labelKey: 'ebp.c_account2_cash_movement' },
    { key: 'vat_rate', type: 'rate', labelKey: 'ebp.c_vat_rate' }, { key: 'mode_label', type: 'style', labelKey: 'ebp.c_mode_label_cash_movement' },
  ],
};

const emptyRule = (kind: EbpRuleKind): EbpRule => ({
  kind, key: null, family: null, vat_rate: null, tax_exempt: null, demo: null, customer_category: null, account: '', account2: null,
  account3: null, country: null, journal: null, label: null, mode_label: kind === 'cash_movement' ? 'generic' : null, is_active: true, sort_order: 0,
});

function RulesTable({ kind, rules, canWrite, onChange, loading }: { kind: EbpRuleKind; rules: EbpRule[]; canWrite: boolean; onChange: () => void; loading: boolean }) {
  const { activeCompanyId } = useAuth();
  const [rows, setRows] = useState<EbpRule[]>(rules);
  useEffect(() => setRows(rules), [rules]);
  const save = useMutation({ mutationFn: (r: EbpRule) => saveRule(activeCompanyId!, r), onSuccess: onChange });
  const del = useMutation({ mutationFn: (id: string) => deleteRule(id), onSuccess: onChange });
  const cols = COLS[kind];
  const upd = (i: number, k: keyof EbpRule, v: unknown) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const cell = (r: EbpRule, i: number, c: Col) => {
    const v = r[c.key];
    if (c.type === 'tri') {
      const val = v === null || v === undefined ? 'any' : v ? 'yes' : 'no';
      return (
        <Select value={val} disabled={!canWrite} onValueChange={(x) => upd(i, c.key, x === 'any' ? null : x === 'yes')}>
          <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t('ebp.rAny')}</SelectItem><SelectItem value="yes">{t('ebp.rYes')}</SelectItem><SelectItem value="no">{t('ebp.rNo')}</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    if (c.type === 'style') {
      return (
        <Select value={String(v ?? 'generic')} disabled={!canWrite} onValueChange={(x) => upd(i, c.key, x)}>
          <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{['bank', 'deposit', 'generic'].map((s) => <SelectItem key={s} value={s}>{t(`ebp.style_${s}`)}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    return (
      <Input
        value={v === null || v === undefined ? '' : String(v)} disabled={!canWrite}
        className={`h-8 ${c.type === 'rate' ? 'w-20 text-right tabular-nums' : c.key === 'label' ? 'w-48' : 'w-32 font-mono'}`}
        onChange={(e) => upd(i, c.key, c.type === 'rate' ? (e.target.value.trim() === '' ? null : Number(e.target.value.replace(',', '.'))) : e.target.value)}
      />
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">{t(`ebp.hint_${kind}`)}</p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr>{cols.map((c) => <Th key={String(c.key)}>{t(c.labelKey)}</Th>)}<Th>{t('ebp.c_is_active')}</Th><Th /></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={cols.length + 2} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={cols.length + 2} className="px-3 py-6 text-center text-muted-foreground">{t('ebp.rEmpty')}</td></tr>}
            {rows.map((r, i) => (
              <tr key={r.id ?? `new-${i}`} className="border-b border-border last:border-0">
                {cols.map((c) => <td key={String(c.key)} className="px-2 py-1">{cell(r, i, c)}</td>)}
                <td className="px-2 py-1"><Checkbox checked={r.is_active} disabled={!canWrite} onCheckedChange={(x) => upd(i, 'is_active', x === true)} /></td>
                <td className="px-2 py-1 whitespace-nowrap text-right">
                  {canWrite && <>
                    <Button size="sm" variant="ghost" onClick={() => save.mutate(r)} disabled={save.isPending} title={t('ebp.save')}><Save className="size-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => (r.id ? del.mutate(r.id) : setRows(rows.filter((_, j) => j !== i)))} title={t('ebp.delete')}><Trash2 className="size-4" /></Button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canWrite && <Button variant="outline" onClick={() => setRows([...rows, emptyRule(kind)])}><Plus className="size-4" /> {t('ebp.rAdd')}</Button>}
    </div>
  );
}

function Lbl({ children }: { children: React.ReactNode }) { return <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>; }
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>; }
