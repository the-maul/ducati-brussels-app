/**
 * M6 — Écran de règlement (POS) : multi-modes, partiel, à échéance (différé),
 * rendu de monnaie sur espèces, ajout de règlements.
 * Réf. G8 Facturation p.39-40, p.67-69, p.90. Libellés via i18n.
 * PDV010 (03/11/2026, droit belge) : un règlement ne se supprime plus. Perçu → contre-passation
 * (règlement inverse, même mode, motif obligatoire, auteur tracé) ; attendu → annulé avec motif.
 * Plafond légal des espèces : 3 000 € par vente (acomptes compris), refus bloquant.
 * PDV040 (03/11/2026) : « Payer par QR (Bancontact / carte) » (Stripe, sans supplément) en bas du
 * panneau ; un règlement Stripe en attente ne se confirme ni ne s'annule ici (webhook / « Annuler le QR »).
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Check, Landmark, Undo2, Ban, ArrowLeftRight, Clock } from 'lucide-react';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import {
  listPaymentMethods, listPayments, addPayments, reversePayment, cancelDeferredPayment, markPaymentReceived,
  type NewPayment, type PaymentRow,
} from './write-api';
import { t, fillVars } from '@/lib/i18n';
import { CASH_LIMIT_EUR, cashLimitExceeded, cashTotal, reversedIds } from './cash-rules';
import { errorMessage } from '@/lib/mutation-feedback';
import { CASH_METHOD, applyCashRounding, cashRounding, changeDue } from './cash-rounding';
import { StripePayCard } from './stripe-pay-card';
import { STRIPE_METHOD } from './stripe-pay-rules';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const CASH = CASH_METHOD; // mode espèces → rendu de monnaie et arrondi légal à 5 cents

type Draft = { _key: string; method: string; amount: string; deferred: boolean; dueDate: string; given: string; fromFinancing: boolean };
let dc = 0;

/**
 * `due` : reste à payer par le client (financement accepté déduit, mission 05 carte 9) ;
 * `overdue` : échéance dépassée → couleur --danger, sinon neutre ;
 * `financingAccepted` : propose de marquer un règlement « versé par l'organisme ».
 */
export function PaymentPanel({ documentId, companyId, due, acompte = false, overdue = false, financingAccepted = false, stripe, onSaved }: {
  documentId: string; companyId: string; due: number; acompte?: boolean; overdue?: boolean; financingAccepted?: boolean;
  /** QR Stripe (PDV040) : données affichées dans le lien envoyé au client. */
  stripe?: { totalTtc?: number; docNumber?: string | null; customerName?: string | null; customerEmail?: string | null; customerPhone?: string | null };
  /** Appele apres l'enregistrement (caisse : ouverture du tiroir sur un encaissement en especes, PDV030). */
  onSaved?: (lines: NewPayment[]) => void;
}) {
  const qc = useQueryClient();
  const { data: methods } = useQuery({ queryKey: ['pay-methods', companyId], queryFn: () => listPaymentMethods(companyId) });
  const { data: payments } = useQuery({ queryKey: ['payments', documentId], queryFn: () => listPayments(documentId) });

  // Le moyen « Stripe » ne se saisit jamais à la main : il passe par le QR (PDV040).
  const manualMethods = (methods ?? []).filter((m) => m.code !== STRIPE_METHOD);
  const firstMethod = manualMethods[0]?.code ?? CASH;
  const newDraft = (amount = ''): Draft => ({ _key: `d${dc++}`, method: firstMethod, amount, deferred: false, dueDate: '', given: '', fromFinancing: false });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const methodLabel = useMemo(() => {
    const map = new Map((methods ?? []).map((m) => [m.code, m.label]));
    return (code: string) => map.get(code) ?? code;
  }, [methods]);

  const setDraft = (key: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d._key === key ? { ...d, ...patch } : d)));
  const addLine = () => setDrafts((ds) => [...ds, newDraft(ds.length === 0 ? String(due.toFixed(2)) : '')]);
  const removeLine = (key: string) => setDrafts((ds) => ds.filter((d) => d._key !== key));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['payments', documentId] });
    qc.invalidateQueries({ queryKey: ['doc-full', documentId] });
    qc.invalidateQueries({ queryKey: ['documents'] });
    qc.invalidateQueries({ queryKey: ['client-docs'] });
    qc.invalidateQueries({ queryKey: ['client-payments'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const lines: NewPayment[] = drafts
        .filter((d) => num(d.amount) > 0)
        .map((d) => ({
          method: d.method, amount: num(d.amount),
          status: d.deferred ? 'attendu' : 'recu',
          dueDate: d.deferred ? (d.dueDate || null) : null,
          givenAmount: d.method === CASH && num(d.given) > 0 ? num(d.given) : null,
          fromFinancing: financingAccepted && d.fromFinancing,
        }));
      if (lines.length === 0) throw new Error(t('sales.payNeedAmount'));
      // Plafond légal des espèces (loi du 18/09/2017, art. 67) : 3 000 € par vente, déjà perçu compris.
      const existing = (payments ?? []).map((p) => ({ method: p.method, amount: Number(p.amount), status: p.status }));
      if (cashLimitExceeded(existing, lines)) {
        throw new Error(fillVars(t('sales.cashLimit'), { amount: eur(cashTotal(existing, lines)), limit: eur(CASH_LIMIT_EUR) }));
      }
      // Arrondi légal des espèces à 5 cents (Belgique, depuis le 1er décembre 2019) : la ligne
      // espèces est ramenée au montant arrondi, l'écart est porté par un règlement « ARR ».
      const saved = applyCashRounding(lines);
      await addPayments(documentId, saved);
      return saved;
    },
    onSuccess: (saved) => { setDrafts([]); setError(null); refresh(); onSaved?.(saved); },
    // Motif réel (PostgrestError compris) plutôt que « Erreur » ; le toast global le montre aussi.
    onError: (e) => setError(errorMessage(e)),
  });

  // Annulation d'un règlement (jamais de suppression) : contre-passation ou annulation motivée.
  const [undo, setUndo] = useState<PaymentRow | null>(null);
  const [undoReason, setUndoReason] = useState('');
  const [undoError, setUndoError] = useState<string | null>(null);
  const undoM = useMutation({
    mutationFn: (p: PaymentRow) => (p.status === 'attendu' ? cancelDeferredPayment(p.id, documentId, undoReason) : reversePayment(p, documentId, undoReason)),
    onSuccess: () => { setUndo(null); setUndoReason(''); setUndoError(null); refresh(); },
    onError: (e) => setUndoError(errorMessage(e)),
  });
  const reversed = reversedIds((payments ?? []) as { id: string; reversal_of?: string | null }[]);
  const recv = useMutation({ mutationFn: (id: string) => markPaymentReceived(id, documentId), onSuccess: refresh });

  // Espèces à encaisser arrondies à 5 cents ; rendu de monnaie = espèces remises − espèces arrondies.
  const rounding = cashRounding(drafts.map((d) => ({ method: d.method, amount: num(d.amount), status: d.deferred ? 'attendu' : 'recu' })));
  const cashGiven = drafts.filter((d) => d.method === CASH && !d.deferred).reduce((s, d) => s + num(d.given), 0);
  const change = changeDue(cashGiven, rounding.roundedCash);
  const draftTotal = drafts.reduce((s, d) => s + (d.deferred ? 0 : num(d.amount)), 0);

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{acompte ? t('sales.deposits') : t('sales.payments')}</p>
        {due > 0.005 && <span className={`font-data text-sm tabular-nums ${overdue ? 'text-danger' : 'text-foreground'}`}>{t('balance.restToPayClient')} : <b>{eur(due)}</b></span>}
      </div>
      {acompte && <p className="rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t('sales.depositInfo')}</p>}

      {/* Règlements déjà saisis */}
      {payments && payments.length > 0 && (
        <table className="w-full border-collapse font-data text-[13px]">
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="py-1.5">{methodLabel(p.method)}</td>
                <td className="py-1.5">
                  {p.status === 'attendu' && p.method === STRIPE_METHOD
                    ? <StatusBadge tone="warning" icon={Clock} label={t('stripePay.pendingBadge')} />
                    : p.status === 'attendu'
                    ? <StatusBadge tone="warning" label={`${t('sales.deferred')}${p.due_date ? ` · ${p.due_date}` : ''}`} />
                    : p.status === 'annule'
                      ? <StatusBadge tone="neutral" icon={Ban} label={t('sales.cancelledBadge')} />
                      : <StatusBadge tone="success" label={t('sales.received')} />}
                  {rowReversalOf(p) && <span className="ml-1"><StatusBadge tone="info" icon={ArrowLeftRight} label={t('sales.reversalBadge')} /></span>}
                  {reversed.has(p.id) && <span className="ml-1"><StatusBadge tone="neutral" icon={Undo2} label={t('sales.reversedBadge')} /></span>}
                  {p.from_financing && <span className="ml-1"><StatusBadge tone="info" icon={Landmark} label={t('balance.orgBadge')} /></span>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{eur(Number(p.amount))}</td>
                <td className="w-20 py-1.5 text-right">
                  {p.status === 'attendu' && p.method !== STRIPE_METHOD && (
                    <Button size="sm" variant="ghost" title={t('sales.markReceived')} onClick={() => recv.mutate(p.id)} disabled={recv.isPending}><Check className="size-4 text-success" /></Button>
                  )}
                  {canUndo(p, reversed) && !(p.method === STRIPE_METHOD && p.status === 'attendu') && (
                    <Button size="sm" variant="ghost" title={p.status === 'attendu' ? t('sales.cancelDeferred') : t('sales.reverse')} onClick={() => { setUndo(p); setUndoReason(''); setUndoError(null); }}>
                      {p.status === 'attendu' ? <Ban className="size-4 text-danger" /> : <Undo2 className="size-4 text-danger" />}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Saisie de nouveaux règlements */}
      {drafts.map((d) => (
        <div key={d._key} className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-2">
          <div className="space-y-1">
            <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.payMethod')}</label>
            <Select value={d.method} onValueChange={(v) => setDraft(d._key, { method: v })}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{manualMethods.map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.payAmount')}</label>
            <Input type="number" step="0.01" value={d.amount} onChange={(e) => setDraft(d._key, { amount: e.target.value })} className="w-28 text-right tabular-nums" />
          </div>
          {d.method === CASH && !d.deferred && (
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.cashGiven')}</label>
              <Input type="number" step="0.01" value={d.given} onChange={(e) => setDraft(d._key, { given: e.target.value })} className="w-28 text-right tabular-nums" />
            </div>
          )}
          <label className="flex h-9 items-center gap-2 px-1 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={d.deferred} onChange={(e) => setDraft(d._key, { deferred: e.target.checked })} className="size-4 accent-[var(--ducati-red)]" />
            {t('sales.deferred')}
          </label>
          {financingAccepted && (
            <label className="flex h-9 items-center gap-2 px-1 text-[12px] text-muted-foreground">
              <input type="checkbox" checked={d.fromFinancing} onChange={(e) => setDraft(d._key, { fromFinancing: e.target.checked })} className="size-4 accent-[var(--ducati-red)]" />
              {t('balance.fromFinancing')}
            </label>
          )}
          {d.deferred && (
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.dueDate')}</label>
              <Input type="date" value={d.dueDate} onChange={(e) => setDraft(d._key, { dueDate: e.target.value })} className="w-40" />
            </div>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => removeLine(d._key)}><Trash2 className="size-4 text-danger" /></Button>
        </div>
      ))}

      {rounding.delta !== 0 && (
        <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
          {t('sales.cashRounding')} : <b className="tabular-nums">{eur(rounding.roundedCash)}</b>
          <span className="tabular-nums"> ({rounding.delta > 0 ? '+' : '−'} {eur(Math.abs(rounding.delta))})</span>
        </p>
      )}
      {change > 0.005 && (
        <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('sales.change')} : <b className="tabular-nums">{eur(change)}</b></p>
      )}
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <AlertDialog open={!!undo} onOpenChange={(o) => { if (!o && !undoM.isPending) setUndo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{undo?.status === 'attendu' ? t('sales.cancelDeferredTitle') : t('sales.reverseTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {undo && fillVars(t(undo.status === 'attendu' ? 'sales.cancelDeferredBody' : 'sales.reverseBody'), { method: methodLabel(undo.method), amount: eur(Number(undo.amount)) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.reverseReason')}</label>
            <Input value={undoReason} onChange={(e) => setUndoReason(e.target.value)} autoFocus />
          </div>
          {undoError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{undoError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undoM.isPending}>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (undo) undoM.mutate(undo); }} disabled={undoM.isPending || !undoReason.trim()}>
              {undoM.isPending ? <Loader2 className="animate-spin" /> : <Undo2 />} {undo?.status === 'attendu' ? t('sales.cancelDeferredDo') : t('sales.reverseDo')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addLine}><Plus /> {acompte ? t('sales.addDeposit') : t('sales.addPayment')}</Button>
        {drafts.length > 0 && (
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} {acompte ? t('sales.recordDeposits') : t('sales.recordPayments')}{draftTotal > 0 ? ` · ${eur(draftTotal)}` : ''}
          </Button>
        )}
      </div>

      <StripePayCard
        documentId={documentId} companyId={companyId} due={due} totalTtc={stripe?.totalTtc}
        docNumber={stripe?.docNumber} customerName={stripe?.customerName}
        customerEmail={stripe?.customerEmail} customerPhone={stripe?.customerPhone}
      />
    </div>
  );
}

/** Contre-passation d'un autre règlement (colonne de la migration 20261103170000, absente avant). */
const rowReversalOf = (p: PaymentRow): string | null => (p as PaymentRow & { reversal_of?: string | null }).reversal_of ?? null;

/**
 * Un règlement s'annule une seule fois : attendu → annulé ; perçu (ni contre-passation, ni déjà
 * contre-passé, ni acompte reporté d'un autre document) → contre-passation.
 */
function canUndo(p: PaymentRow, reversed: Map<string, string>): boolean {
  if (p.status === 'attendu') return true;
  if (p.status !== 'recu') return false;
  if (rowReversalOf(p) || reversed.has(p.id)) return false;
  return !(p as PaymentRow & { transferred_from?: string | null }).transferred_from;
}
