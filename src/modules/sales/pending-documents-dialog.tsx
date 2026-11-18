/**
 * M6 — Fenêtres G8 autour des documents d'un client (lot du 18/11/2026) :
 *  - « Documents en attente » : proposée à la création d'un document dès qu'on choisit un client
 *    qui a des devis, BC, réservations, BL, acomptes directs ou factures dues ouverts
 *    (Visualiser · Rappeler · Continuer le nouveau document) ;
 *  - « Choisissez votre document » : transformation d'un devis / BC / réservation / BL vers le
 *    document cible, avec ce que chaque choix fait au stock ;
 *  - bloc « Acomptes directs disponibles » d'un document : imputer un acompte direct du client.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Eye, Loader2, Undo2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { CONVERSIONS, type DocumentRow } from './write-api';
import { listPendingDocuments, listAvailableDirectDeposits, applyDirectDeposit } from './direct-deposit-api';
import { isPendingDocument, pendingDeposit, directDepositAvailable } from './pending-documents';

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-BE');

/** Documents en attente du client ; rien n'est affiché s'il n'y en a pas. */
export function PendingDocumentsDialog({ contactId, contactName, onClose }: { contactId: string; contactName: string; onClose: () => void }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['pending-docs', contactId], queryFn: () => listPendingDocuments(contactId) });
  const rows = (q.data ?? []).filter(isPendingDocument);
  if (q.isLoading || !rows.length) return null;
  const view = (d: DocumentRow) => window.open(`/sales/${d.id}`, '_blank', 'noopener');
  const recall = (d: DocumentRow) => { onClose(); navigate({ to: '/sales/$documentId', params: { documentId: d.id } }); };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('pendingDocs.title')}</DialogTitle>
          <DialogDescription>{t('pendingDocs.hint').replace('{client}', contactName)}</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                {[t('sales.colNumber'), t('sales.colType'), t('sales.colDate'), t('docList.ttc'), t('docList.colDeposit'), t('docList.colDue'), ''].map((h, i) => (
                  <th key={i} className={`px-3 py-1.5 text-left text-[11px] font-bold uppercase text-muted-foreground ${i >= 3 && i <= 5 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const isInvoice = d.doc_type === 'FAC' || d.doc_type === 'TIK';
                const deposit = d.doc_type === 'ACD' ? directDepositAvailable(d) : pendingDeposit(d);
                return (
                  <tr key={d.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5 font-mono text-[12px]">{d.number ?? '—'}</td>
                    <td className="px-3 py-1.5">{t(`sales.type_${d.doc_type}`)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{fmtDate(d.issue_date)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{d.doc_type === 'ACD' ? '' : eur(Number(d.total_ttc))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{deposit ? eur(deposit) : ''}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{isInvoice ? <span className="font-semibold text-danger">{eur(Number(d.total_ttc) - Number(d.paid_amount))}</span> : ''}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => view(d)} title={t('pendingDocs.view')}><Eye className="size-4" /></Button>
                        <Button size="sm" variant="outline" onClick={() => recall(d)}><Undo2 className="size-4" /> {t('pendingDocs.recall')}</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t('pendingDocs.continue')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ce que fait chaque transformation (affiché sous le choix, comme une aide). */
const TARGET_HINT: Record<string, string> = {
  FAC: 'chooseDoc.hint_FAC', RES: 'chooseDoc.hint_RES', BL: 'chooseDoc.hint_BL', BC: 'chooseDoc.hint_BC',
};

/** « Choisissez votre document » (G8) : les transformations permises depuis ce document. */
export function ChooseDocumentDialog({ doc, onChoose, onClose }: { doc: DocumentRow; onChoose: (target: string) => void; onClose: () => void }) {
  const targets = CONVERSIONS[doc.doc_type] ?? [];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('chooseDoc.title')}</DialogTitle>
          <DialogDescription>{t('chooseDoc.hint').replace('{doc}', `${t(`sales.type_${doc.doc_type}`)} ${doc.number ?? ''}`.trim())}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {targets.map((tt) => (
            <button key={tt} type="button" onClick={() => { onClose(); onChoose(tt); }}
              className="flex w-full items-start gap-3 rounded-md border border-border bg-card px-3 py-2 text-left hover:bg-accent">
              <ArrowRightLeft className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block font-medium">{t(`sales.type_${tt}`)}</span>
                {TARGET_HINT[tt] && <span className="block text-[12px] text-muted-foreground">{t(TARGET_HINT[tt])}</span>}
              </span>
            </button>
          ))}
          <p className="text-[12px] text-muted-foreground">{t('chooseDoc.notAvailable')}</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Acomptes directs du client disponibles pour ce document (imputation en un clic). */
export function DirectDepositsPanel({ doc, readOnly }: { doc: DocumentRow; readOnly?: boolean }) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['direct-deposits', doc.contact_id], queryFn: () => listAvailableDirectDeposits(doc.contact_id!), enabled: !!doc.contact_id });
  const apply = useMutation({
    meta: { success: false, error: false },
    mutationFn: (depositId: string) => { setBusyId(depositId); return applyDirectDeposit(depositId, doc); },
    onSuccess: (amount) => {
      toast.success(t('directDeposit.applied').replace('{amount}', eur(amount)));
      qc.invalidateQueries({ queryKey: ['direct-deposits', doc.contact_id] });
      qc.invalidateQueries({ queryKey: ['payments', doc.id] });
      qc.invalidateQueries({ queryKey: ['doc-full', doc.id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setBusyId(null),
  });
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <div className="mb-4 rounded-md border border-border bg-card p-3 text-[13px]">
      <div className="mb-2 flex items-center gap-2 font-medium">
        <StatusBadge tone="info" icon={Wallet} label={t('directDeposit.panelTitle')} />
        <span className="text-muted-foreground">{t('directDeposit.panelHint')}</span>
      </div>
      {rows.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-3 py-1">
          <span className="font-mono text-[12px]">{d.number}</span>
          <span className="tabular-nums">{fmtDate(d.issue_date)}</span>
          <span className="font-semibold tabular-nums">{eur(d.available)}</span>
          {d.notes && <span className="text-muted-foreground">{d.notes}</span>}
          <Button size="sm" variant="outline" className="ml-auto" disabled={readOnly || apply.isPending} onClick={() => apply.mutate(d.id)}>
            {busyId === d.id ? <Loader2 className="animate-spin" /> : <Wallet />} {t('directDeposit.apply')}
          </Button>
        </div>
      ))}
    </div>
  );
}
