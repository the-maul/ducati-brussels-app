import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, FileDown, Plus, AlertTriangle, Archive, Ban, ChevronDown, ChevronRight, Save, CheckCircle2, Clock } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { useAuth } from '@/lib/auth/auth-context';
import { AccountingGate } from '@/components/layout/accounting-gate';
import { supabase } from '@/integrations/supabase/client';
import {
  archiveSepaBatch, cancelSepaBatch, candidateKey, createSepaBatch, downloadSepaBatch, getSepaCreditor, listSepaBatchItems, listSepaBatches,
  listSepaCandidates, looksLikeCreditorId, markSepaItemUnpaid, saveSepaCreditor, type SepaBatch,
} from '@/modules/accounting/sepa-batches';
import { errorMessage } from '@/lib/mutation-feedback';
import { t, fillVars, pageTitle } from '@/lib/i18n';

/**
 * M12 — Domiciliations SEPA. Rattrapage G8 « Encaissements » (18/11/2026) : mandats, créancier
 * (ICS, IBAN, BIC de la société), « Nouvelle remise » depuis les échéances DOM et les factures de
 * clients avec mandat, « Remises en attente / archivées ». L'encaissement est noté à l'archivage
 * (la banque a prélevé), plus à la génération du fichier ; plus jamais d'ICS factice.
 */
export const Route = createFileRoute('/_app/accounting-sepa')({
  head: () => ({ meta: [{ title: pageTitle('accountingSepa') }] }),
  component: () => <AccountingGate><SepaPage /></AccountingGate>,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const fmtDate = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-BE') : '—');

function SepaPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ contact_id: '', mandate_ref: '', iban: '', bic: '', signature_date: today(), seq_type: 'FRST' });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const mandates = useQuery({ queryKey: ['sepa-mandates', activeCompanyId], queryFn: async () => {
    const { data } = await supabase.from('sepa_mandates').select('id, mandate_ref, iban, seq_type, status, contact_id, contacts(first_name, last_name, company_name)').eq('company_id', activeCompanyId!).order('created_at', { ascending: false });
    return data ?? [];
  }, enabled: !!activeCompanyId });

  const contacts = useQuery({ queryKey: ['sepa-contacts', activeCompanyId], queryFn: async () => {
    const { data } = await supabase.from('contacts').select('id, first_name, last_name, company_name, iban, bic').eq('company_id', activeCompanyId!).order('last_name').limit(200);
    return data ?? [];
  }, enabled: !!activeCompanyId });

  const addMandate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('sepa_mandates').insert({ company_id: activeCompanyId!, ...form });
      if (error) throw error;
    },
    onSuccess: () => { setForm({ contact_id: '', mandate_ref: '', iban: '', bic: '', signature_date: today(), seq_type: 'FRST' }); mandates.refetch(); qc.invalidateQueries({ queryKey: ['sepa-candidates'] }); },
    onError: (e) => setErr(errorMessage(e)),
  });

  const contactName = (c: { first_name?: string | null; last_name?: string | null; company_name?: string | null }) => c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';

  return (
    <>
      <PageHeader title={t('accounting.sepa')} description={t('accounting.sepaSub')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/accounting' })}><ArrowLeft /> {t('accounting.title')}</Button>} />

      {msg && <p className="mb-3 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">{msg}</p>}
      {err && <p className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{err}</p>}

      {activeCompanyId && <CreditorCard companyId={activeCompanyId} onError={setErr} />}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Mandats */}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accounting.sepaMandates')}</p>
          <div className="mb-3 grid gap-2 rounded-md border border-border bg-card p-3">
            <Select value={form.contact_id} onValueChange={(v) => { const c = contacts.data?.find((x) => x.id === v); setForm({ ...form, contact_id: v, iban: c?.iban || form.iban, bic: c?.bic || form.bic }); }}>
              <SelectTrigger><SelectValue placeholder={t('accounting.sepaContact')} /></SelectTrigger>
              <SelectContent>{contacts.data?.map((c) => <SelectItem key={c.id} value={c.id}>{contactName(c)}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder={t('accounting.sepaRum')} value={form.mandate_ref} onChange={(e) => setForm({ ...form, mandate_ref: e.target.value })} />
            <Input placeholder={t('accounting.sepaIban')} value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} />
            <div className="flex gap-2">
              <Input placeholder={t('accounting.sepaBic')} value={form.bic} onChange={(e) => setForm({ ...form, bic: e.target.value })} />
              <Input type="date" value={form.signature_date} onChange={(e) => setForm({ ...form, signature_date: e.target.value })} />
              <Select value={form.seq_type} onValueChange={(v) => setForm({ ...form, seq_type: v })}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="FRST">FRST</SelectItem><SelectItem value="RCUR">RCUR</SelectItem><SelectItem value="OOFF">OOFF</SelectItem></SelectContent>
              </Select>
            </div>
            <Button onClick={() => { setErr(null); addMandate.mutate(); }} disabled={addMandate.isPending || !form.contact_id || !form.mandate_ref || !form.iban}>
              {addMandate.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('accounting.sepaSave')}
            </Button>
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[12px]">
              <thead className="bg-muted"><tr><Th>{t('accounting.sepaContact')}</Th><Th>{t('accounting.sepaRum')}</Th><Th>{t('accounting.sepaIban')}</Th><Th>{t('accounting.sepaSeq')}</Th></tr></thead>
              <tbody>
                {mandates.data?.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">{t('accounting.sepaNoMandate')}</td></tr>}
                {mandates.data?.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">{contactName((m.contacts ?? {}) as never)}</td>
                    <td className="px-3 py-1.5 font-mono">{m.mandate_ref}</td>
                    <td className="px-3 py-1.5 font-mono">{m.iban}</td>
                    <td className="px-3 py-1.5 font-mono">{m.seq_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Nouvelle remise */}
        {activeCompanyId && <NewBatchCard companyId={activeCompanyId} onDone={(text) => { setMsg(text); setErr(null); }} onError={setErr} />}
      </div>

      {activeCompanyId && <BatchesCard companyId={activeCompanyId} onError={setErr} />}
    </>
  );
}

function CreditorCard({ companyId, onError }: { companyId: string; onError: (m: string) => void }) {
  const q = useQuery({ queryKey: ['sepa-creditor', companyId], queryFn: () => getSepaCreditor(companyId) });
  const [f, setF] = useState({ sepa_creditor_id: '', iban: '', bic: '' });
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) setF({ sepa_creditor_id: q.data.sepa_creditor_id ?? '', iban: q.data.iban ?? '', bic: q.data.bic ?? '' }); }, [q.data]);
  const save = useMutation({ mutationFn: () => saveSepaCreditor(companyId, f), onSuccess: () => { setSaved(true); q.refetch(); }, onError: (e) => onError(errorMessage(e)) });
  const icsOk = looksLikeCreditorId(q.data?.sepa_creditor_id);
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accounting.sepaCreditor')}</p>
        {q.data && (icsOk && q.data.iban
          ? <StatusBadge tone="success" icon={CheckCircle2} label={t('accounting.sepaCreditorOk')} />
          : <StatusBadge tone="danger" icon={AlertTriangle} label={t('accounting.sepaCreditorMissing')} />)}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1"><Lbl>{t('accounting.sepaIcs')}</Lbl><Input value={f.sepa_creditor_id} onChange={(e) => { setSaved(false); setF({ ...f, sepa_creditor_id: e.target.value }); }} className="w-56 font-mono" /></label>
        <label className="space-y-1"><Lbl>{t('accounting.sepaIban')}</Lbl><Input value={f.iban} onChange={(e) => { setSaved(false); setF({ ...f, iban: e.target.value }); }} className="w-64 font-mono" /></label>
        <label className="space-y-1"><Lbl>{t('accounting.sepaBic')}</Lbl><Input value={f.bic} onChange={(e) => { setSaved(false); setF({ ...f, bic: e.target.value }); }} className="w-36 font-mono" /></label>
        <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('accounting.sepaSaveCreditor')}</Button>
        {saved && <span className="text-[12px] text-success">{t('accounting.sepaSaved')}</span>}
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">{t('accounting.sepaCreditorHelp')}</p>
    </div>
  );
}

function NewBatchCard({ companyId, onDone, onError }: { companyId: string; onDone: (m: string) => void; onError: (m: string) => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(plusDays(30));
  const [collDate, setCollDate] = useState(plusDays(7));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const q = useQuery({ queryKey: ['sepa-candidates', companyId, from, to], queryFn: () => listSepaCandidates(companyId, { from, to }) });
  const rows = q.data ?? [];
  const selected = rows.filter((r) => sel.has(candidateKey(r)));
  const total = useMemo(() => selected.reduce((s, r) => s + r.amount, 0), [selected]);
  const create = useMutation({
    mutationFn: () => createSepaBatch(companyId, collDate, selected),
    onSuccess: (b) => {
      setSel(new Set());
      onDone(fillVars(t('accounting.sepaBatchCreated'), { ref: b.reference, n: String(b.tx_count), total: eur(b.total) }));
      qc.invalidateQueries({ queryKey: ['sepa-candidates'] }); qc.invalidateQueries({ queryKey: ['sepa-batches'] });
    },
    onError: (e) => onError(errorMessage(e)),
  });
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accounting.sepaNewBatch')}</p>
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-3">
        <div className="space-y-1"><Lbl>{t('accounting.sepaDueFrom')}</Lbl><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Lbl>{t('accounting.sepaDueTo')}</Lbl><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="space-y-1"><Lbl>{t('accounting.sepaCollDate')}</Lbl><Input type="date" value={collDate} onChange={(e) => setCollDate(e.target.value)} /></div>
        <Button onClick={() => create.mutate()} disabled={create.isPending || selected.length === 0}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <FileDown />} {t('accounting.sepaGenerate')} · {eur(total)}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[12px]">
          <thead className="bg-muted"><tr>
            <Th><input type="checkbox" checked={rows.length > 0 && selected.length === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map(candidateKey)) : new Set())} className="size-4 accent-[var(--ducati-red)]" /></Th>
            <Th>{t('accounting.colNumber')}</Th><Th>{t('accounting.sepaContact')}</Th><Th>{t('accounting.sepaDueDate')}</Th><Th>{t('accounting.sepaKind')}</Th><Th className="text-right">{t('accounting.sepaDue')}</Th>
          </tr></thead>
          <tbody>
            {q.isError && <tr><td colSpan={6} className="px-3 py-4 text-center text-danger">{errorMessage(q.error)}</td></tr>}
            {!q.isError && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">{t('accounting.sepaNoCollect')}</td></tr>}
            {rows.map((r) => (
              <tr key={candidateKey(r)} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5"><input type="checkbox" checked={sel.has(candidateKey(r))} onChange={() => toggle(candidateKey(r))} className="size-4 accent-[var(--ducati-red)]" /></td>
                <td className="px-3 py-1.5 font-mono">{r.number}</td>
                <td className="px-3 py-1.5">{r.contact_name}</td>
                <td className="px-3 py-1.5">{fmtDate(r.due_date)}</td>
                <td className="px-3 py-1.5">{r.kind === 'installment' ? `${t('accounting.sepaKindInstallment')}${r.installment_no ? ` #${r.installment_no}` : ''}` : t('accounting.sepaKindInvoice')} · {r.seq_type}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{eur(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BatchStatus({ status }: { status: SepaBatch['status'] }) {
  if (status === 'archivee') return <StatusBadge tone="success" icon={CheckCircle2} label={t('accounting.sepaArchived')} />;
  if (status === 'annulee') return <StatusBadge tone="neutral" icon={Ban} label={t('accounting.sepaCancelled')} />;
  return <StatusBadge tone="warning" icon={Clock} label={t('accounting.sepaPending')} />;
}

function BatchesCard({ companyId, onError }: { companyId: string; onError: (m: string) => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'en_attente' | 'archivee' | 'all'>('en_attente');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['sepa-batches', companyId], queryFn: () => listSepaBatches(companyId) });
  const rows = (q.data ?? []).filter((b) => filter === 'all' || b.status === filter);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['sepa-batches'] }); qc.invalidateQueries({ queryKey: ['sepa-items'] }); qc.invalidateQueries({ queryKey: ['sepa-candidates'] }); };
  const archive = useMutation({ mutationFn: (id: string) => archiveSepaBatch(id), onSuccess: refresh, onError: (e) => onError(errorMessage(e)) });
  const cancel = useMutation({
    mutationFn: (id: string) => { const r = window.prompt(t('accounting.sepaCancelReason')) ?? ''; if (!r.trim()) throw new Error(t('accounting.sepaReasonRequired')); return cancelSepaBatch(id, r); },
    onSuccess: refresh, onError: (e) => onError(errorMessage(e)),
  });
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accounting.sepaBatches')}</p>
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="en_attente">{t('accounting.sepaPending')}</SelectItem>
            <SelectItem value="archivee">{t('accounting.sepaArchived')}</SelectItem>
            <SelectItem value="all">{t('accounting.sepaAll')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[12px]">
          <thead className="bg-muted"><tr>
            <Th /><Th>{t('accounting.sepaRef')}</Th><Th>{t('accounting.sepaCollDate')}</Th><Th className="text-right">{t('accounting.sepaTxCount')}</Th>
            <Th className="text-right">{t('accounting.sepaTotal')}</Th><Th>{t('accounting.sepaStatus')}</Th><Th />
          </tr></thead>
          <tbody>
            {q.isError && <tr><td colSpan={7} className="px-3 py-4 text-center text-danger">{errorMessage(q.error)}</td></tr>}
            {!q.isError && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">{t('accounting.sepaNoBatch')}</td></tr>}
            {rows.map((b) => (
              <BatchRow key={b.id} b={b} open={open === b.id} onToggle={() => setOpen(open === b.id ? null : b.id)}
                onDownload={() => downloadSepaBatch(b).catch((e) => onError(errorMessage(e)))}
                onArchive={() => { if (window.confirm(fillVars(t('accounting.sepaArchiveConfirm'), { ref: b.reference, total: eur(b.total) }))) archive.mutate(b.id); }}
                onCancel={() => cancel.mutate(b.id)} busy={archive.isPending || cancel.isPending} onError={onError} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BatchRow({ b, open, onToggle, onDownload, onArchive, onCancel, busy, onError }: {
  b: SepaBatch; open: boolean; onToggle: () => void; onDownload: () => void; onArchive: () => void; onCancel: () => void; busy: boolean; onError: (m: string) => void;
}) {
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ['sepa-items', b.id], queryFn: () => listSepaBatchItems(b.id), enabled: open });
  const unpaid = useMutation({
    mutationFn: (id: string) => { const r = window.prompt(t('accounting.sepaUnpaidReason')) ?? ''; if (!r.trim()) throw new Error(t('accounting.sepaReasonRequired')); return markSepaItemUnpaid(id, r); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sepa-items', b.id] }), onError: (e) => onError(errorMessage(e)),
  });
  return (
    <>
      <tr className="border-b border-border">
        <td className="px-2 py-1.5"><Button size="sm" variant="ghost" onClick={onToggle}>{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Button></td>
        <td className="px-3 py-1.5 font-mono">{b.reference}</td>
        <td className="px-3 py-1.5">{fmtDate(b.collection_date)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{b.tx_count}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{eur(b.total)}</td>
        <td className="px-3 py-1.5" title={b.cancel_reason ?? undefined}><BatchStatus status={b.status} /></td>
        <td className="whitespace-nowrap px-3 py-1.5 text-right">
          {b.status !== 'annulee' && <Button size="sm" variant="ghost" onClick={onDownload} title={t('accounting.sepaDownload')}><FileDown className="size-4" /></Button>}
          {b.status === 'en_attente' && <Button size="sm" variant="ghost" onClick={onArchive} disabled={busy} title={t('accounting.sepaArchive')}><Archive className="size-4 text-success" /></Button>}
          {b.status === 'en_attente' && <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy} title={t('accounting.sepaCancel')}><Ban className="size-4 text-danger" /></Button>}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-muted/40">
          <td colSpan={7} className="px-4 py-2">
            {items.isLoading ? <Loader2 className="size-4 animate-spin" /> : (
              <table className="w-full border-collapse text-[12px]">
                <tbody>
                  {(items.data ?? []).map((i) => (
                    <tr key={i.id} className="border-b border-border last:border-0">
                      <td className="px-2 py-1">{i.debtor_name}</td>
                      <td className="px-2 py-1 font-mono">{i.document_number}</td>
                      <td className="px-2 py-1 font-mono">{i.mandate_ref} · {i.seq_type}</td>
                      <td className="px-2 py-1 font-mono">{i.iban}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{eur(i.amount)}</td>
                      <td className="px-2 py-1" title={i.unpaid_reason ?? undefined}>{t(`accounting.sepaItem_${i.status}`)}</td>
                      <td className="px-2 py-1 text-right">
                        {i.status === 'encaisse' && <Button size="sm" variant="ghost" onClick={() => unpaid.mutate(i.id)} disabled={unpaid.isPending}><AlertTriangle className="size-3.5" /> {t('accounting.sepaUnpaid')}</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Lbl({ children }: { children: React.ReactNode }) { return <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>; }
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>; }
