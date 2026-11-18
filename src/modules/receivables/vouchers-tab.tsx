/**
 * Encaissements (rattrapage G8, 18/11/2026) — onglet « Bons d'achat » : G8 Fichiers > Clients >
 * Gestion Bons d'achat (délai avant expiration, montant minimum, statut ; n°, code, client, montant
 * TTC, date début, date d'expiration, statut, e-mail, portable ; modèle A4 / ticket ; Visualiser /
 * Imprimer ; Nouveau ; Supprimer → ici « Annuler », motif, jamais si le bon a servi).
 * Utilisation : mode de règlement « Bon d'achat » (BA) au pied de facture / en caisse.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Clock, Loader2, Plus, Printer, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { cancelVoucher, createVoucher, getReceivableSettings, listVouchers, type ContactPick, type VoucherRow } from './api';
import { buildVoucherPdf, openPdf } from './receivables-pdf';
import { eur, fmtDate, loadPdfCompany, parseAmount, todayIso } from './helpers';
import { Field } from './schedule-dialog';
import { ContactPicker, Empty, Lbl, Th } from './ui-bits';

const ALL = '__all';
const ORIGINS: VoucherRow['origin'][] = ['geste', 'vente', 'avoir', 'autre'];

export function VoucherBadge({ status }: { status: VoucherRow['effective_status'] }) {
  if (status === 'actif') return <StatusBadge tone="success" icon={CheckCircle2} label={t('receivables.vActive')} />;
  if (status === 'utilise') return <StatusBadge tone="info" icon={Ticket} label={t('receivables.vUsed')} />;
  if (status === 'expire') return <StatusBadge tone="warning" icon={Clock} label={t('receivables.vExpired')} />;
  return <StatusBadge tone="neutral" icon={Ban} label={t('receivables.vCancelled')} />;
}

export async function printVoucher(companyId: string, v: VoucherRow, format: 'A4' | 'ticket'): Promise<void> {
  const w = window.open('', '_blank');
  try {
    const company = await loadPdfCompany(companyId);
    openPdf(await buildVoucherPdf({
      format, company, number: v.number, amount: v.amount, remaining: v.remaining, validFrom: v.valid_from, validUntil: v.valid_until,
      holder: v.contact_name, note: v.note,
      labels: {
        title: t('receivables.voucherTitle'), number: t('receivables.voucherNumber'), amount: t('receivables.colAmount'),
        remaining: t('receivables.voucherRemaining'), validity: t('receivables.voucherValidity'), holder: t('receivables.voucherHolder'),
        conditions: t('receivables.voucherConditions'),
      },
    }), w);
  } catch (e) { w?.close(); throw e; }
}

export function VouchersTab({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>(ALL);
  const [format, setFormat] = useState<'A4' | 'ticket'>('A4');
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<VoucherRow | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const settingsQ = useQuery({ queryKey: ['receivable-settings', companyId], queryFn: () => getReceivableSettings(companyId), retry: false });
  const q = useQuery({ queryKey: ['vouchers', companyId, status], queryFn: () => listVouchers(companyId, status === ALL ? null : status) });
  const rows = q.data ?? [];
  const refresh = () => { qc.invalidateQueries({ queryKey: ['vouchers'] }); qc.invalidateQueries({ queryKey: ['usable-vouchers'] }); };
  const cancel = useMutation({
    mutationFn: () => cancelVoucher(cancelling!.id, reason),
    onSuccess: () => { setCancelling(null); setReason(''); refresh(); }, onError: (e) => setError(errorMessage(e)),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
        <label className="space-y-1"><Lbl>{t('receivables.colStatus')}</Lbl>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('receivables.allStatuses')}</SelectItem>
              <SelectItem value="actif">{t('receivables.vActive')}</SelectItem><SelectItem value="utilise">{t('receivables.vUsed')}</SelectItem>
              <SelectItem value="expire">{t('receivables.vExpired')}</SelectItem><SelectItem value="annule">{t('receivables.vCancelled')}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1"><Lbl>{t('receivables.printModel')}</Lbl>
          <Select value={format} onValueChange={(v) => setFormat(v as 'A4' | 'ticket')}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="A4">A4</SelectItem><SelectItem value="ticket">{t('receivables.formatTicket')}</SelectItem></SelectContent>
          </Select>
        </label>
        {settingsQ.data && (
          <p className="text-[12px] text-muted-foreground">
            {fillVars(t('receivables.voucherSettingsInfo'), { days: String(settingsQ.data.voucher_validity_days), min: eur(settingsQ.data.voucher_min_amount) })}
          </p>
        )}
        {canWrite && <Button className="ml-auto" size="sm" onClick={() => setCreating(true)}><Plus /> {t('receivables.voucherNew')}</Button>}
      </div>
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
      {q.isLoading ? <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        : q.isError ? <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorMessage(q.error)}</p>
        : rows.length === 0 ? <Empty>{t('receivables.noVoucher')}</Empty> : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[12px]">
            <thead className="bg-muted"><tr>
              <Th>{t('receivables.voucherNumber')}</Th><Th>{t('receivables.colCode')}</Th><Th>{t('receivables.colClient')}</Th>
              <Th className="text-right">{t('receivables.colAmount')}</Th><Th className="text-right">{t('receivables.voucherRemaining')}</Th>
              <Th>{t('receivables.validFrom')}</Th><Th>{t('receivables.validUntil')}</Th><Th>{t('receivables.colStatus')}</Th>
              <Th>{t('receivables.voucherOrigin')}</Th><Th>{t('receivables.colEmail')}</Th><Th>{t('receivables.colMobile')}</Th><Th />
            </tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5 font-mono">{v.number}</td>
                  <td className="px-2 py-1.5 font-mono">{v.contact_code ?? ''}</td>
                  <td className="px-2 py-1.5">{v.contact_id ? <Link to="/clients/$contactId" params={{ contactId: v.contact_id }} className="hover:underline">{v.contact_name}</Link> : '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(v.amount)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(v.remaining)}</td>
                  <td className="px-2 py-1.5">{fmtDate(v.valid_from)}</td>
                  <td className="px-2 py-1.5">{fmtDate(v.valid_until)}</td>
                  <td className="px-2 py-1.5"><VoucherBadge status={v.effective_status} /></td>
                  <td className="px-2 py-1.5">{t(`receivables.origin_${v.origin}`)}</td>
                  <td className="px-2 py-1.5">{v.email ?? ''}</td>
                  <td className="px-2 py-1.5">{v.mobile ?? ''}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    <Button size="sm" variant="ghost" title={t('receivables.print')} onClick={() => printVoucher(companyId, v, format).catch((e) => setError(errorMessage(e)))}><Printer className="size-4" /></Button>
                    {canWrite && v.status === 'actif' && Math.abs(v.remaining - v.amount) < 0.005 && (
                      <Button size="sm" variant="ghost" title={t('receivables.voucherCancel')} onClick={() => { setReason(''); setCancelling(v); }}><Ban className="size-4 text-danger" /></Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <VoucherCreateDialog open={creating} companyId={companyId} onOpenChange={setCreating}
        onCreated={(v) => { refresh(); if (v) void printVoucher(companyId, v, format).catch(() => undefined); }} />
      <Dialog open={!!cancelling} onOpenChange={(o) => { if (!o && !cancel.isPending) setCancelling(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('receivables.voucherCancel')} {cancelling?.number}</DialogTitle>
            <DialogDescription>{t('receivables.voucherCancelHelp')}</DialogDescription>
          </DialogHeader>
          <Field label={t('receivables.reason')}><Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)} disabled={cancel.isPending}>{t('action.cancel')}</Button>
            <Button onClick={() => cancel.mutate()} disabled={cancel.isPending || !reason.trim()}>{cancel.isPending ? <Loader2 className="animate-spin" /> : <Ban />} {t('receivables.voucherCancel')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function VoucherCreateDialog({ open, companyId, onOpenChange, onCreated, presetContact = null }: {
  open: boolean; companyId: string; onOpenChange: (o: boolean) => void; onCreated: (v: VoucherRow | null) => void; presetContact?: ContactPick | null;
}) {
  const [contact, setContact] = useState<ContactPick | null>(presetContact);
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(todayIso());
  const [until, setUntil] = useState('');
  const [origin, setOrigin] = useState<VoucherRow['origin']>('geste');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const id = await createVoucher(companyId, { amount: parseAmount(amount), contactId: contact?.id, validFrom: from, validUntil: until || null, origin, note });
      const rows = await listVouchers(companyId, null, contact?.id ?? null);
      return rows.find((r) => r.id === id) ?? null;
    },
    onSuccess: (v) => { setAmount(''); setNote(''); setUntil(''); setError(null); onOpenChange(false); onCreated(v); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!save.isPending) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('receivables.voucherNew')}</DialogTitle>
          <DialogDescription>{t('receivables.voucherNewHelp')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('receivables.colClient')}><ContactPicker companyId={companyId} value={contact} onChange={setContact} className="w-full" /></Field>
          <Field label={t('receivables.colAmount')}><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right tabular-nums" /></Field>
          <Field label={t('receivables.validFrom')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('receivables.validUntil')}><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} placeholder={t('receivables.fromSettings')} /></Field>
          <Field label={t('receivables.voucherOrigin')}>
            <Select value={origin} onValueChange={(v) => setOrigin(v as VoucherRow['origin'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ORIGINS.map((o) => <SelectItem key={o} value={o}>{t(`receivables.origin_${o}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('receivables.note')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <p className="text-[12px] text-muted-foreground">{t('receivables.voucherUntilHint')}</p>
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>{t('action.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || parseAmount(amount) <= 0}>{save.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('receivables.voucherCreate')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
