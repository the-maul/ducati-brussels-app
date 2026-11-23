/**
 * Ecran « Cessions internes / O.R.O » (G8 : Creation · Rappel · Liste · Archives + « G8 - LISTES ») :
 * documents (en cours, valides, archives — recherche, type, periode, statut), listes par rayon
 * (quantite, HT au PAMP, HT a la vente) et detaillees (reference, moto / client, chassis, n°),
 * ancien journal des mouvements de cession, reglages de la societe.
 */
import { motoName } from '@/lib/moto-name';
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCanWrite } from '@/lib/auth/use-access';
import { t } from '@/lib/i18n';
import { rayonByCode } from '@/modules/articles/product-families';
import { listRef } from '@/modules/settings/reference-api';
import { listCessions as listCessionMoves } from '@/modules/stock/stock-api';
import {
  CESSION_SETTING_CODES, cessionReport, cessionsSchemaReady, listCessionDocs, readCessionSettings, saveCessionSetting,
  type CessionListRow, type CessionSettingCode,
} from './api';
import { CessionNewDialog } from './cession-new-dialog';
import { CessionStatusBadge } from './cession-document';
import { groupByRayon, type CessionStatus } from './rules';

export type CessionsTab = 'documents' | 'rayons' | 'details' | 'mouvements' | 'reglages';
export const CESSIONS_TABS: CessionsTab[] = ['documents', 'rayons', 'details', 'mouvements', 'reglages'];

const eur = (n: number | null | undefined) => (n == null ? '—' : `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '');
const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);

export function CessionsScreen({ companyId, tab, onTab, onOpen }: {
  companyId: string;
  tab: CessionsTab;
  onTab: (tab: CessionsTab) => void;
  onOpen: (id: string) => void;
}) {
  const canWrite = useCanWrite();
  const ready = useQuery({ queryKey: ['cessions-ready'], queryFn: cessionsSchemaReady });
  const [newOpen, setNewOpen] = useState(false);

  return (
    <>
      {ready.data === false && (
        <p className="mb-3 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('cession.schemaMissing')}</p>
      )}
      <Tabs value={tab} onValueChange={(v) => onTab(v as CessionsTab)}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TabsList>
            {CESSIONS_TABS.map((k) => <TabsTrigger key={k} value={k}>{t(`cession.tab_${k}`)}</TabsTrigger>)}
          </TabsList>
          {canWrite && <Button className="ml-auto" onClick={() => setNewOpen(true)}><Plus /> {t('cession.new')}</Button>}
        </div>
        <TabsContent value="documents"><DocumentsList companyId={companyId} onOpen={onOpen} /></TabsContent>
        <TabsContent value="rayons"><ReportView companyId={companyId} mode="rayons" /></TabsContent>
        <TabsContent value="details"><ReportView companyId={companyId} mode="details" /></TabsContent>
        <TabsContent value="mouvements"><MovesList companyId={companyId} /></TabsContent>
        <TabsContent value="reglages"><SettingsPanel companyId={companyId} canWrite={canWrite} /></TabsContent>
      </Tabs>
      {newOpen && <CessionNewDialog open={newOpen} onOpenChange={setNewOpen} companyId={companyId} onCreated={onOpen} />}
    </>
  );
}

function useTypes(companyId: string) {
  return useQuery({ queryKey: ['cession-types', companyId], queryFn: () => listRef(companyId, 'cession_type') });
}

function contactLabel(r: CessionListRow): string {
  const c = r.contact;
  if (!c) return '';
  return c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ');
}

function DocumentsList({ companyId, onOpen }: { companyId: string; onOpen: (id: string) => void }) {
  const types = useTypes(companyId);
  const [status, setStatus] = useState<'actives' | CessionStatus | 'all'>('actives');
  const [type, setType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [term, setTerm] = useState('');
  const statuses: CessionStatus[] | undefined =
    status === 'actives' ? ['ouvert', 'valide'] : status === 'all' ? undefined : [status];
  const q = useQuery({
    queryKey: ['cession-docs', companyId, status, type, from, to],
    queryFn: () => listCessionDocs(companyId, { statuses, type: type === 'all' ? null : type, from: from || null, to: to || null }),
  });
  const rows = useMemo(() => {
    const s = term.trim().toLowerCase();
    if (!s) return q.data ?? [];
    return (q.data ?? []).filter((r) => [r.number, contactLabel(r), r.vehicle?.vin, r.vehicle?.plate, r.vehicle?.reference,
      r.vehicle?.model, r.work_description, r.internal_note, r.operator_name].some((x) => String(x ?? '').toLowerCase().includes(s)));
  }, [q.data, term]);
  const total = rows.reduce((sum, r) => sum + Number(r.status === 'ouvert' ? 0 : r.total_cost), 0);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label={t('cession.search')}><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('cession.searchPlaceholder')} className="w-64" /></Field>
        <Field label={t('cession.status')}>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="actives">{t('cession.statusActive')}</SelectItem>
              <SelectItem value="ouvert">{t('cession.status_ouvert')}</SelectItem>
              <SelectItem value="valide">{t('cession.status_valide')}</SelectItem>
              <SelectItem value="archive">{t('cession.status_archive')}</SelectItem>
              <SelectItem value="annule">{t('cession.status_annule')}</SelectItem>
              <SelectItem value="all">{t('cession.statusAll')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <TypeFilter types={types.data} value={type} onChange={setType} />
        <Field label={t('cession.from')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Field>
        <Field label={t('cession.to')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></Field>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr>
            <Th>{t('cession.colNumber')}</Th><Th>{t('cession.status')}</Th><Th>{t('cession.type')}</Th><Th>{t('cession.colDate')}</Th>
            <Th>{t('cession.vehicle')}</Th><Th>{t('cession.vin')}</Th><Th>{t('cession.plate')}</Th><Th>{t('cession.client')}</Th>
            <Th>{t('cession.operator')}</Th><Th>{t('cession.work')}</Th><Th className="text-right">{t('cession.colAmountHt')}</Th>
          </tr></thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={11} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {!q.isLoading && rows.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">{t('cession.empty')}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} onClick={() => onOpen(r.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                <td className="px-3 py-2 font-mono text-[12px]">{r.number}</td>
                <td className="px-3 py-2"><CessionStatusBadge status={r.status} /></td>
                <td className="px-3 py-2">{r.cession_type} · {r.type_label}</td>
                <td className="px-3 py-2">{day(r.validated_at ?? r.created_at)}</td>
                <td className="px-3 py-2">{r.vehicle ? motoName(r.vehicle) : ''}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{r.vehicle?.vin ?? ''}</td>
                <td className="px-3 py-2">{r.vehicle?.plate ?? ''}</td>
                <td className="px-3 py-2">{contactLabel(r)}</td>
                <td className="px-3 py-2">{r.operator_name ?? ''}</td>
                <td className="max-w-[16rem] truncate px-3 py-2">{r.work_description ?? ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.status === 'ouvert' ? '' : eur(r.total_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-right font-data text-[13px] tabular-nums">{t('cession.count').replace('{n}', String(rows.length))} · {t('cession.totalCost')} {eur(total)}</p>
    </>
  );
}

function TypeFilter({ types, value, onChange }: { types?: { code: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={t('cession.type')}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('cession.typeAll')}</SelectItem>
          {(types ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.code} · {r.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(name: string, header: string[], rows: unknown[][]) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const dec = (n: number) => String(Math.round(Number(n) * 100) / 100).replace('.', ',');

function ReportView({ companyId, mode }: { companyId: string; mode: 'rayons' | 'details' }) {
  const types = useTypes(companyId);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [type, setType] = useState('all');
  const q = useQuery({
    queryKey: ['cession-report', companyId, from, to, type],
    queryFn: () => cessionReport(companyId, from || null, to || null, type === 'all' ? null : type),
  });
  const rows = q.data ?? [];
  const byRayon = useMemo(() => groupByRayon(rows), [rows]);
  const totals = rows.reduce((s, r) => ({ qty: s.qty + r.quantity, pamp: s.pamp + r.amount_pamp, sale: s.sale + r.amount_sale_ht }), { qty: 0, pamp: 0, sale: 0 });
  const rayonLabel = (code: string) => (code ? `${code} ${rayonByCode(code)?.label ?? ''}`.trim() : t('cession.noRayon'));

  const exportCsv = () => {
    if (mode === 'rayons') {
      downloadCsv(`cessions-rayons-${from}-${to}.csv`, [t('cession.colRayon'), t('cession.colQty'), t('cession.colAmountPamp'), t('cession.colAmountSale')],
        byRayon.map((r) => [rayonLabel(r.rayon), dec(r.quantity), dec(r.amountPamp), dec(r.amountSaleHt)]));
    } else {
      downloadCsv(`cessions-detail-${from}-${to}.csv`,
        [t('cession.colDate'), t('cession.colNumber'), t('cession.type'), t('cession.colRef'), t('cession.colDesignation'), t('cession.colQty'),
          t('cession.colAmountPamp'), t('cession.colAmountSale'), t('cession.vehicle'), t('cession.client'), t('cession.vin')],
        rows.map((r) => [r.cession_date, r.number, r.type_label, r.reference, r.designation, dec(r.quantity), dec(r.amount_pamp),
          dec(r.amount_sale_ht), r.vehicle_label, r.contact_name, r.vin]));
    }
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label={t('cession.from')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Field>
        <Field label={t('cession.to')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></Field>
        <TypeFilter types={types.data} value={type} onChange={setType} />
        <Button variant="outline" className="ml-auto" onClick={exportCsv} disabled={rows.length === 0}><Download /> {t('cession.export')}</Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        {mode === 'rayons' ? (
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr><Th>{t('cession.colRayon')}</Th><Th className="text-right">{t('cession.colQty')}</Th><Th className="text-right">{t('cession.colAmountPamp')}</Th><Th className="text-right">{t('cession.colAmountSale')}</Th></tr></thead>
            <tbody>
              {byRayon.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">{q.isLoading ? '…' : t('cession.empty')}</td></tr>}
              {byRayon.map((r) => (
                <tr key={r.rayon || 'none'} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{rayonLabel(r.rayon)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.amountPamp)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.amountSaleHt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr>
              <Th>{t('cession.colDate')}</Th><Th>{t('cession.colNumber')}</Th><Th>{t('cession.type')}</Th><Th>{t('cession.colRef')}</Th><Th>{t('cession.colDesignation')}</Th>
              <Th className="text-right">{t('cession.colQty')}</Th><Th className="text-right">{t('cession.colAmountPamp')}</Th><Th className="text-right">{t('cession.colAmountSale')}</Th>
              <Th>{t('cession.vehicle')}</Th><Th>{t('cession.client')}</Th><Th>{t('cession.vin')}</Th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">{q.isLoading ? '…' : t('cession.empty')}</td></tr>}
              {rows.map((r) => (
                <tr key={r.line_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{new Date(r.cession_date).toLocaleDateString('fr-BE')}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.number}</td>
                  <td className="px-3 py-2">{r.type_label}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.reference ?? ''}</td>
                  <td className="px-3 py-2">{r.designation}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.amount_pamp)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.amount_sale_ht)}</td>
                  <td className="px-3 py-2">{r.vehicle_label ?? ''}</td>
                  <td className="px-3 py-2">{r.contact_name ?? ''}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.vin ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-right font-data text-[13px] tabular-nums">
        {t('cession.lineCount').replace('{n}', String(rows.length))} · {t('cession.colQty')} {Math.round(totals.qty * 1000) / 1000} · {t('cession.colAmountPamp')} {eur(totals.pamp)} · {t('cession.colAmountSale')} {eur(totals.sale)}
      </p>
    </>
  );
}

/** Ancien journal : mouvements de stock « cession » (dont ceux d'avant les documents). */
function MovesList({ companyId }: { companyId: string }) {
  const q = useQuery({ queryKey: ['cessions', companyId], queryFn: () => listCessionMoves(companyId) });
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full border-collapse font-data text-[13px]">
        <thead className="bg-muted"><tr><Th>{t('cession.colDate')}</Th><Th>{t('cession.colRefDoc')}</Th><Th className="text-right">{t('cession.colQty')}</Th><Th>{t('cession.colNote')}</Th></tr></thead>
        <tbody>
          {q.data && q.data.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">{t('cession.empty')}</td></tr>}
          {q.data?.map((m) => (
            <tr key={m.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-mono text-[12px]">{new Date(m.occurred_at).toLocaleString('fr-BE')}</td>
              <td className="px-3 py-2">{m.ref ?? '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums text-danger">{Number(m.qty_delta)}</td>
              <td className="px-3 py-2">{m.note ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsPanel({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const types = useTypes(companyId);
  const s = useQuery({ queryKey: ['cession-settings', companyId], queryFn: () => readCessionSettings(companyId) });
  const save = useMutation({
    mutationFn: ({ code, value }: { code: CessionSettingCode; value: string }) => saveCessionSetting(companyId, s.data?.rows ?? [], code, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cession-settings', companyId] }),
  });
  if (!s.data) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  const v = s.data.values;
  const yesNo = (code: CessionSettingCode) => (
    <Select value={['oui', 'o', 'true', '1', 'yes'].includes(v[code].toLowerCase()) ? 'oui' : 'non'} onValueChange={(val) => save.mutate({ code, value: val })} disabled={!canWrite}>
      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="oui">{t('cession.yes')}</SelectItem><SelectItem value="non">{t('cession.no')}</SelectItem></SelectContent>
    </Select>
  );
  return (
    <div className="max-w-2xl space-y-3 rounded-md border border-border bg-card p-4">
      <SettingRow code="cost_basis">
        <Select value={v.cost_basis === 'pa' ? 'pa' : 'pamp'} onValueChange={(val) => save.mutate({ code: 'cost_basis', value: val })} disabled={!canWrite}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="pamp">{t('cession.basis_pamp')}</SelectItem><SelectItem value="pa">{t('cession.basis_pa')}</SelectItem></SelectContent>
        </Select>
      </SettingRow>
      <SettingRow code="auto_open_on_reprise">{yesNo('auto_open_on_reprise')}</SettingRow>
      <SettingRow code="reprise_cession_type">
        <Select value={v.reprise_cession_type} onValueChange={(val) => save.mutate({ code: 'reprise_cession_type', value: val })} disabled={!canWrite}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>{(types.data ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.code} · {r.label}</SelectItem>)}</SelectContent>
        </Select>
      </SettingRow>
      <SettingRow code="auto_archive_on_sale">{yesNo('auto_archive_on_sale')}</SettingRow>
      <SettingRow code="internal_hourly_rate">
        <Input type="number" step="0.01" min="0" defaultValue={v.internal_hourly_rate} disabled={!canWrite} className="w-32 text-right tabular-nums"
          onBlur={(e) => { if (e.target.value !== v.internal_hourly_rate) save.mutate({ code: 'internal_hourly_rate', value: e.target.value || '0' }); }} />
      </SettingRow>
      <p className="text-[12px] text-muted-foreground">{t('cession.settingsHint')}</p>
    </div>
  );
}

function SettingRow({ code, children }: { code: (typeof CESSION_SETTING_CODES)[number]; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-0">
      <div>
        <p className="text-sm font-medium">{t(`cession.setting_${code}`)}</p>
        <p className="text-[12px] text-muted-foreground">{t(`cession.setting_${code}_hint`)}</p>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
