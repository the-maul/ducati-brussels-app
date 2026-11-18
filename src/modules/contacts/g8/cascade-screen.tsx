/**
 * M1 — Modification en cascade des clients (G8 « Fichiers > Clients > Modification en cascade »).
 * Filtres Type · Civilité · Catégorie · Tarif · Code client · Ville / CP · Solde -> Lister ->
 * on coche -> une action de masse -> case « Confirmer la modification » + confirmation.
 * Réservé aux administrateurs (la base le revérifie). Une transaction, une trace dans events.
 * Tarifs et cases bloqué / détaxé / HT / en compte : lot « règles client », pas ici.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ListFilter, Loader2, Check as CheckIcon, AlertTriangle, Star, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { listRef } from '@/modules/settings/reference-api';
import { contactDisplayName } from '../api';
import { PERSON_CIVILITIES, legalFormOptions } from '../civility';
import { cascadeList, cascadeApply, listGroupDefs, type CascadeFilters, type CascadeRow, type CascadeAction } from './api';
import { downloadXlsx } from './list-export';
import { Th, Empty, g8ErrorMessage } from './client-g8-tabs';

const SHOWN = 1000;
const NONE = '__none__';
const ALL = 'all';
const TYPES = ['particulier', 'professionnel', 'employe', 'fournisseur', 'banque_leasing'] as const;
const PAYMENT_TERMS = [
  { value: 'immediat', labelKey: 'contacts.payTermImmediate' },
  { value: '7j', labelKey: 'contacts.payTerm7' },
  { value: '15j', labelKey: 'contacts.payTerm15' },
  { value: '30j', labelKey: 'contacts.payTerm30' },
];

/** Actions proposées (ordre G8), avec le type de valeur demandée. */
const ACTIONS: { key: string; action: CascadeAction; value: 'zip' | 'civility' | 'category' | 'group' | 'terms' | 'text' | 'none'; flag?: string; on?: boolean }[] = [
  { key: 'set_zip', action: 'set_zip', value: 'zip' },
  { key: 'set_civility', action: 'set_civility', value: 'civility' },
  { key: 'clear_civility', action: 'clear_civility', value: 'none' },
  { key: 'set_category', action: 'set_category', value: 'category' },
  { key: 'add_group', action: 'add_group', value: 'group' },
  { key: 'remove_group', action: 'remove_group', value: 'group' },
  { key: 'clear_category', action: 'clear_category', value: 'none' },
  { key: 'watch_on', action: 'set_flag', value: 'none', flag: 'is_watch', on: true },
  { key: 'watch_off', action: 'set_flag', value: 'none', flag: 'is_watch', on: false },
  { key: 'optout_on', action: 'set_flag', value: 'none', flag: 'marketing_opt_out', on: true },
  { key: 'optout_off', action: 'set_flag', value: 'none', flag: 'marketing_opt_out', on: false },
  { key: 'set_payment_terms', action: 'set_payment_terms', value: 'terms' },
  { key: 'add_comment', action: 'add_comment', value: 'text' },
  { key: 'archive', action: 'archive', value: 'none' },
];

const emptyFilters = (): CascadeFilters => ({
  type: ALL, civility: ALL, category: ALL, price_list: '', code_from: '', code_to: '', place: '', balance_min: '', balance_max: '', include_archived: false,
});
const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

export function CascadeScreen({ companyId }: { companyId: string }) {
  const { isAdmin } = useAuth();
  const confirm = useConfirm();
  const admin = isAdmin(companyId);
  const [f, setF] = useState<CascadeFilters>(emptyFilters);
  const setFilter = <K extends keyof CascadeFilters>(k: K, v: CascadeFilters[K]) => setF((p) => ({ ...p, [k]: v }));
  const [rows, setRows] = useState<CascadeRow[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [actionKey, setActionKey] = useState<string>('');
  const [val, setVal] = useState('');
  const [city, setCity] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const civQ = useQuery({ queryKey: ['ref', companyId, 'civility'], queryFn: () => listRef(companyId, 'civility') });
  const catQ = useQuery({ queryKey: ['ref', companyId, 'client_category'], queryFn: () => listRef(companyId, 'client_category') });
  const groupsQ = useQuery({ queryKey: ['g8-group-defs', companyId], queryFn: () => listGroupDefs(companyId) });
  const civOptions = [
    ...PERSON_CIVILITIES.map((p) => ({ value: p.value, label: t(p.labelKey) })),
    ...legalFormOptions(civQ.data ?? []).map((o) => ({ value: o.code, label: o.label })),
  ];

  const list = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => cascadeList(companyId, { ...f, civility: f.civility === ALL ? '' : f.civility, category: f.category === ALL ? '' : f.category, type: f.type === ALL ? '' : f.type }),
    onSuccess: (r) => { setRows(r); setSel(new Set()); setConfirmed(false); },
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });
  const action = ACTIONS.find((a) => a.key === actionKey) ?? null;
  const apply = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => {
      const value: Record<string, unknown> = { value: val };
      if (action?.value === 'zip') value.city = city;
      if (action?.flag) { value.flag = action.flag; value.on = action.on; }
      return cascadeApply(companyId, [...sel], action!.action, value);
    },
    onSuccess: (n) => { toast.success(t('g8c.cascade.applied').replace('{n}', String(n))); setConfirmed(false); setVal(''); setCity(''); list.mutate(); },
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });

  const selectedRows = useMemo(() => (rows ?? []).filter((r) => sel.has(r.id)), [rows, sel]);
  const needsValue = action && action.value !== 'none';
  const canApply = admin && action && sel.size > 0 && confirmed && (!needsValue || val.trim() !== '');

  const doApply = async () => {
    if (!action) return;
    const ok = await confirm({
      title: t('g8c.cascade.confirmTitle'),
      message: t('g8c.cascade.confirmMessage').replace('{action}', t(`g8c.cascade.action_${action.key}`)).replace('{n}', String(sel.size)),
      confirmLabel: t('g8c.cascade.apply'),
      variant: action.action === 'archive' ? 'delete' : 'default',
    });
    if (ok) apply.mutate();
  };

  const exportXlsx = () => downloadXlsx(`cascade_clients_${new Date().toISOString().slice(0, 10)}.xlsx`, t('g8c.cascade.sheet'),
    [t('g8c.list.colCode'), t('g8c.list.colName'), t('g8c.list.colCivility'), t('g8c.list.colZip'), t('g8c.list.colCity'), t('g8c.list.colCategory'),
      t('g8c.cascade.colPriceList'), t('g8c.cascade.colTerms'), t('g8c.cascade.colBalance')],
    (selectedRows.length ? selectedRows : rows ?? []).map((r) => [r.code, contactDisplayName(r), r.civility ?? r.legal_form, r.zip, r.city, r.category, r.price_list, r.payment_terms, r.balance]));

  return (
    <div className="space-y-4">
      {!admin && <p className="flex items-center gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning"><AlertTriangle className="size-4" /> {t('g8c.cascade.adminOnly')}</p>}
      <section className="rounded-md border border-border bg-card p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-[12px]"><span className="mb-0.5 block text-muted-foreground">{t('g8c.cascade.fType')}</span>
            <Select value={f.type} onValueChange={(v) => setFilter('type', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>{t('g8c.all')}</SelectItem>{TYPES.map((x) => <SelectItem key={x} value={x}>{t(`contacts.type_${x}`)}</SelectItem>)}</SelectContent>
            </Select></label>
          <label className="text-[12px]"><span className="mb-0.5 block text-muted-foreground">{t('g8c.cascade.fCivility')}</span>
            <Select value={f.civility} onValueChange={(v) => setFilter('civility', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>{t('g8c.all')}</SelectItem><SelectItem value={NONE}>{t('g8c.notFilled')}</SelectItem>{civOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select></label>
          <label className="text-[12px]"><span className="mb-0.5 block text-muted-foreground">{t('g8c.cascade.fCategory')}</span>
            <Select value={f.category} onValueChange={(v) => setFilter('category', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>{t('g8c.all')}</SelectItem><SelectItem value={NONE}>{t('g8c.notFilled')}</SelectItem>{(catQ.data ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}</SelectContent>
            </Select></label>
          <label className="text-[12px]"><span className="mb-0.5 block text-muted-foreground">{t('g8c.cascade.fPriceList')}</span>
            <Input value={f.price_list} onChange={(e) => setFilter('price_list', e.target.value)} placeholder={t('g8c.cascade.fPriceListHint')} /></label>
          <label className="text-[12px]"><span className="mb-0.5 block text-muted-foreground">{t('g8c.cascade.fPlace')}</span>
            <Input value={f.place} onChange={(e) => setFilter('place', e.target.value)} /></label>
          <label className="text-[12px]"><span className="mb-0.5 block text-muted-foreground">{t('g8c.cascade.fCodeFrom')}</span>
            <Input value={f.code_from} onChange={(e) => setFilter('code_from', e.target.value)} /></label>
          <label className="text-[12px]"><span className="mb-0.5 block text-muted-foreground">{t('g8c.cascade.fCodeTo')}</span>
            <Input value={f.code_to} onChange={(e) => setFilter('code_to', e.target.value)} /></label>
          <label className="text-[12px]"><span className="mb-0.5 block text-muted-foreground">{t('g8c.cascade.fBalanceMin')}</span>
            <Input inputMode="decimal" value={f.balance_min} onChange={(e) => setFilter('balance_min', e.target.value)} /></label>
          <label className="text-[12px]"><span className="mb-0.5 block text-muted-foreground">{t('g8c.cascade.fBalanceMax')}</span>
            <Input inputMode="decimal" value={f.balance_max} onChange={(e) => setFilter('balance_max', e.target.value)} /></label>
          <label className="flex items-end gap-2 pb-2 text-[13px]"><Checkbox checked={f.include_archived} onCheckedChange={(v) => setFilter('include_archived', v === true)} />{t('g8c.cascade.fArchived')}</label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button disabled={list.isPending} onClick={() => list.mutate()}>{list.isPending ? <Loader2 className="animate-spin" /> : <ListFilter />} {t('g8c.cascade.list')}</Button>
          <Button variant="outline" onClick={() => { setF(emptyFilters()); setRows(null); }}>{t('g8c.extract.reset')}</Button>
          {rows && <span className="text-[13px] tabular-nums text-muted-foreground">{t('g8c.cascade.count').replace('{sel}', String(sel.size)).replace('{n}', String(rows.length))}</span>}
          {rows && rows.length > 0 && <Button variant="outline" onClick={exportXlsx}><FileSpreadsheet /> {t('g8c.extract.exportExcel')}</Button>}
        </div>
      </section>

      {rows && (
        <section className="rounded-md border border-border bg-card p-3">
          <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[18rem_1fr_auto]">
            <label className="text-[12px]"><span className="mb-0.5 block text-muted-foreground">{t('g8c.cascade.action')}</span>
              <Select value={actionKey} onValueChange={(v) => { setActionKey(v); setVal(''); setCity(''); setConfirmed(false); }}>
                <SelectTrigger><SelectValue placeholder={t('g8c.cascade.chooseAction')} /></SelectTrigger>
                <SelectContent>{ACTIONS.map((a) => <SelectItem key={a.key} value={a.key}>{t(`g8c.cascade.action_${a.key}`)}</SelectItem>)}</SelectContent>
              </Select></label>
            <div className="flex flex-wrap gap-2">
              {action?.value === 'zip' && (<>
                <Input className="w-28" value={val} onChange={(e) => setVal(e.target.value)} placeholder={t('g8c.list.colZip')} />
                <Input className="w-48" value={city} onChange={(e) => setCity(e.target.value)} placeholder={t('g8c.list.colCity')} />
              </>)}
              {action?.value === 'civility' && (
                <Select value={val} onValueChange={setVal}><SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{civOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
              )}
              {action?.value === 'category' && (
                <Select value={val} onValueChange={setVal}><SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{(catQ.data ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}</SelectContent></Select>
              )}
              {action?.value === 'group' && (
                <Select value={val} onValueChange={setVal}><SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{(groupsQ.data ?? []).filter((g) => g.is_active).map((g) => <SelectItem key={g.code} value={g.code}>{g.label}</SelectItem>)}</SelectContent></Select>
              )}
              {action?.value === 'terms' && (
                <Select value={val} onValueChange={setVal}><SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{PAYMENT_TERMS.map((p) => <SelectItem key={p.value} value={p.value}>{t(p.labelKey)}</SelectItem>)}</SelectContent></Select>
              )}
              {action?.value === 'text' && <Input className="w-96" value={val} onChange={(e) => setVal(e.target.value)} placeholder={t('g8c.cascade.commentHint')} />}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} disabled={!admin} />{t('g8c.cascade.confirmBox')}</label>
              <Button disabled={!canApply || apply.isPending} onClick={() => void doApply()}>{apply.isPending ? <Loader2 className="animate-spin" /> : <CheckIcon />} {t('g8c.cascade.apply')}</Button>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">{t('g8c.cascade.hint')}</p>
        </section>
      )}

      {rows && (rows.length === 0 ? <Empty>{t('g8c.extract.none')}</Empty> : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[64rem] border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr>
              <th className="w-10 px-3 py-2"><Checkbox checked={sel.size === 0 ? false : sel.size === rows.length ? true : 'indeterminate'}
                onCheckedChange={() => setSel(sel.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <Th>{t('g8c.list.colCode')}</Th><Th>{t('g8c.list.colName')}</Th><Th>{t('g8c.list.colCivility')}</Th><Th>{t('g8c.list.colCity')}</Th>
              <Th>{t('g8c.list.colCategory')}</Th><Th>{t('g8c.cascade.colPriceList')}</Th><Th>{t('g8c.cascade.colTerms')}</Th><Th>{t('g8c.list.colFlags')}</Th><Th className="text-right">{t('g8c.cascade.colBalance')}</Th>
            </tr></thead>
            <tbody>
              {rows.slice(0, SHOWN).map((r) => (
                <tr key={r.id} className={`border-b border-border last:border-0 ${r.is_watch ? 'bg-warning-bg' : ''} ${r.is_active ? '' : 'text-muted-foreground line-through'}`}>
                  <td className="px-3 py-1.5"><Checkbox checked={sel.has(r.id)} onCheckedChange={() => setSel((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                  <td className="px-3 py-1.5 font-mono"><a className="text-info underline" href={`/clients/${r.id}`} target="_blank" rel="noopener noreferrer">{r.code ?? '—'}</a></td>
                  <td className="px-3 py-1.5">{contactDisplayName(r)}</td>
                  <td className="px-3 py-1.5">{r.civility ?? r.legal_form ?? '—'}</td>
                  <td className="px-3 py-1.5">{[r.zip, r.city].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-3 py-1.5">{r.category ?? '—'}</td>
                  <td className="px-3 py-1.5">{r.price_list ?? '—'}</td>
                  <td className="px-3 py-1.5">{r.payment_terms ?? '—'}</td>
                  <td className="px-3 py-1.5"><div className="flex flex-wrap gap-1">
                    {r.is_watch && <StatusBadge tone="warning" icon={Star} label={t('contacts.flagWatch')} />}
                    {r.is_blocked && <StatusBadge tone="danger" label={t('g8c.cascade.flagBlocked')} />}
                    {r.is_detaxe && <StatusBadge tone="info" label={t('contacts.flagDetaxe')} />}
                    {r.mode_ht && <StatusBadge tone="info" label={t('g8c.cascade.flagHt')} />}
                    {r.is_account && <StatusBadge tone="neutral" label={t('contacts.flagAccount')} />}
                    {r.marketing_opt_out && <StatusBadge tone="danger" label={t('g8c.rgpd.optOutFlag')} />}
                  </div></td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${r.balance > 0.005 ? 'font-bold text-danger' : ''}`}>{eur(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {rows && rows.length > SHOWN && <p className="text-[12px] text-muted-foreground">{t('g8c.cascade.shownLimit').replace('{n}', String(SHOWN))}</p>}
    </div>
  );
}
