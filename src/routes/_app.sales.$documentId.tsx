import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Loader2, ArrowRightLeft, Undo2, Printer, FileText, FileDown, Mail, MessageSquare, Link2, X, ShoppingCart, Pencil, Trash2, LifeBuoy } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { getDocumentFull, convertDocument, generateCreditNote, deleteDocument, isDraftDocument, canGenerateCreditNote, isMargeDocument, listPayments, creditableLinesOf, isClosedDocStatus, CREDITED_STATUS, CONVERSIONS, DEPOSIT_DOC_TYPES, type DocumentRow, type CreditSelection } from '@/modules/sales/write-api';
import { DepositInvoicePanel, showsDepositInvoices } from '@/modules/sales/deposit-invoice-panel';
import { requiresConfirmation } from '@/modules/sales/confirm';
import { ConfirmDocumentDialog, type ConfirmDocumentRequest } from '@/modules/sales/confirm-document-dialog';
import { useConfirm } from '@/components/confirm-provider';
import { documentBalance } from '@/modules/sales/balance';
import { DocumentBalanceBlock, FinancingDialog } from '@/modules/sales/balance-panel';
import { listFinancingOrgs } from '@/modules/sales/financing-api';
import { enqueueDocumentSms } from '@/modules/sales/notify-api';
import { openSalesPdfPreview } from '@/modules/sales/document-pdf-data';
import { DocumentMailDialog } from '@/modules/sales/document-mail-dialog';
import { getContact, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { getVehicle, vehicleLabel } from '@/modules/vehicles/api';
import { PaymentPanel } from '@/modules/sales/payment-panel';
import { QrPaymentCard } from '@/modules/sales/qr-payment-card';
import { DocumentCustomerScreen } from '@/modules/sales/document-customer-screen';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { printDocument } from '@/modules/sales/print-document';
import { exportInvoiceUbl } from '@/modules/accounting/api';
import { listStock } from '@/modules/stock/stock-api';
import { computeDocAvailability, AVAILABILITY_DOC_TYPES, saleStockStatus } from '@/modules/sales/availability';
import { AvailabilityBadge, SaleStockBadge } from '@/modules/sales/availability-badge';
import { getDocumentLinesStock, listDocumentAllocations, cancelAllocation } from '@/modules/sales/on-order-api';
import { AssociateOrderDialog } from '@/modules/sales/associate-order-dialog';
import { PrepareButton } from '@/modules/sales/prepare-button';
import { DocumentOrdersPanel } from '@/modules/orders/document-orders-panel';
import { OrderFromDocumentDialog } from '@/modules/orders/order-from-document-dialog';
import { canOrderFromDocument } from '@/modules/orders/from-document';
import { useAuth } from '@/lib/auth/auth-context';
import { openAccidentFile } from '@/modules/workshop/accident/api';
import { t, tIn, pageTitle } from '@/lib/i18n';
import { contactLocale } from '@/lib/i18n/client-locale';
import { useReadOnly } from '@/lib/auth/read-only-context';
import { errorMessage } from '@/lib/mutation-feedback';

export const Route = createFileRoute('/_app/sales/$documentId')({
  head: () => ({ meta: [{ title: pageTitle('salesDocument') }] }),
  component: DocumentView,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const statusTone = (s: string) => (s === 'payee' ? 'success' : s === 'annulee' || s === 'converti' || s === CREDITED_STATUS ? 'neutral' : s === 'brouillon' ? 'info' : 'warning');

function DocumentView() {
  const { documentId } = Route.useParams();
  const navigate = useNavigate();
  // Lecture seule : on neutralise aussi les actions secondaires qui ecrivent
  // (suppression, duplication, conversion) — le bouton partage ne voit qu'elles.
  const readOnly = useReadOnly();
  const { companies, activeCompanyId } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['doc-full', documentId], queryFn: () => getDocumentFull(documentId) });
  const showAvailability = data ? (AVAILABILITY_DOC_TYPES as readonly string[]).includes(data.doc.doc_type) : false;
  const stockQ = useQuery({
    queryKey: ['stock-availability', activeCompanyId],
    queryFn: () => listStock(activeCompanyId!),
    enabled: !!activeCompanyId && showAvailability,
  });
  const stockMap = new Map((stockQ.data ?? []).map((r) => [r.article_id, r.available_qty]));
  const docAvailability = data && showAvailability ? computeDocAvailability(data.lines, stockMap) : null;
  // « En commande » par ligne pour le client du document (mission 05, carte 7) : jamais la commande d'un autre client.
  const linesStockQ = useQuery({
    queryKey: ['doc-lines-stock', documentId],
    queryFn: () => getDocumentLinesStock(documentId),
    enabled: showAvailability,
  });
  const lineStockById = new Map((linesStockQ.data ?? []).map((r) => [r.line_id, r]));
  const allocationsQ = useQuery({
    queryKey: ['doc-allocations', documentId],
    queryFn: () => listDocumentAllocations(documentId),
    enabled: showAvailability,
  });
  const removeAllocation = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => cancelAllocation(id),
    onSuccess: () => {
      toast.success(t('onOrder.removed'));
      linesStockQ.refetch(); allocationsQ.refetch();
    },
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('onOrder.errRemove')),
  });
  // Reste à payer et financement (mission 05, carte 9)
  const paymentsQ = useQuery({ queryKey: ['payments', documentId], queryFn: () => listPayments(documentId) });
  const orgsQ = useQuery({
    queryKey: ['financing-orgs', data?.doc.company_id],
    queryFn: () => listFinancingOrgs(data!.doc.company_id),
    enabled: !!data?.doc.financing_org_id,
  });
  const [financingOpen, setFinancingOpen] = useState(false);
  // Commander les pièces (mission 02, carte 3) : null = fermé, [] = tout le document, [article] = une ligne
  const [orderDialog, setOrderDialog] = useState<string[] | null>(null);
  const [associate, setAssociate] = useState<{ articleId: string; reference: string | null; designation: string } | null>(null);
  const contactId = data?.doc.contact_id ?? null;
  const contactQ = useQuery({ queryKey: ['doc-contact', contactId], queryFn: () => getContact(contactId!), enabled: !!contactId });
  const vehicleId = data?.doc.vehicle_id ?? null;
  const vehicleQ = useQuery({ queryKey: ['doc-vehicle', vehicleId], queryFn: () => getVehicle(vehicleId!), enabled: !!vehicleId });
  // Confirmation avant une facture ou un avoir (mission 08, cartes 4 et 6) : numéro consommé,
  // stock sorti ou réintégré, facture annulée — rien ne se défait ensuite.
  const [confirmRequest, setConfirmRequest] = useState<ConfirmDocumentRequest | null>(null);
  const convert = useMutation({
    mutationFn: (target: string) => convertDocument(documentId, target),
    onSuccess: (newId) => { setConfirmRequest(null); navigate({ to: '/sales/$documentId', params: { documentId: newId } }); },
  });
  const credit = useMutation({
    mutationFn: (selection?: CreditSelection[]) => generateCreditNote(documentId, selection),
    onSuccess: (newId) => { setConfirmRequest(null); navigate({ to: '/sales/$documentId', params: { documentId: newId } }); },
  });
  const askOrRun = async (action: 'convert' | 'creditNote', target: string) => {
    if (!data) return;
    if (!requiresConfirmation(target)) { convert.mutate(target); return; }
    const sign = target === 'AVO' ? -1 : 1;
    // Avoir : quantité encore créditable par ligne (avoirs partiels déjà émis déduits).
    const remaining = action === 'creditNote' ? await creditableLinesOf(documentId).catch(() => null) : null;
    setConfirmRequest({
      action, docType: target, clientName: contactQ.data ? contactDisplayName(contactQ.data) : null,
      totalTtc: sign * Number(data.doc.total_ttc),
      lines: data.lines.filter((l) => l.line_type !== 'vide').map((l) => ({
        designation: l.designation, quantity: sign * Number(l.quantity), lineTtc: sign * Number(l.line_ttc),
        ...(remaining ? { lineId: l.id, maxQuantity: remaining.get(l.id) ?? 0 } : {}),
      })),
    });
  };
  const runConfirmed = (r: ConfirmDocumentRequest, selection?: CreditSelection[]) => { if (r.action === 'creditNote') credit.mutate(selection); else convert.mutate(r.docType); };
  // Brouillon : modifier ou supprimer (mission 08, carte 1) ; un document validé est figé.
  const confirmDialog = useConfirm();
  const removeDraft = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => deleteDocument(documentId),
    onSuccess: () => { toast.success(t('sales.deleted')); navigate({ to: '/sales' }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const onDeleteDraft = async () => {
    if (await confirmDialog({ variant: 'delete', title: t('sales.deleteDraft'), message: t('sales.deleteConfirm') })) removeDraft.mutate();
  };
  const [mailOpen, setMailOpen] = useState(false);
  // Adresse tapée par le client sur l'écran client (PDV020), proposée dans la fenêtre d'envoi.
  const [mailTo, setMailTo] = useState<string | null>(null);
  // Mission 09 carte 5 : depuis un devis, ouvrir (ou retrouver) le dossier accident de cette moto.
  const accident = useMutation({
    mutationFn: () => openAccidentFile({ companyId: data!.doc.company_id, vehicleId: data!.doc.vehicle_id, contactId: data!.doc.contact_id, quoteDocumentId: documentId }),
    meta: { success: false },
    onSuccess: (fileId) => navigate({ to: '/workshop/accidents/$fileId', params: { fileId } }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [smsOpen, setSmsOpen] = useState(false);
  const pdfPreview = useMutation({
    mutationFn: () => openSalesPdfPreview(data!),
    meta: { success: false },
  });

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return (
    <>
      <PageHeader
        title={t('nav.sales')}
        breadcrumbs={[{ label: t('nav.sales'), to: '/sales' }, { label: t('nav.sales') }]}
      />
      <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('sales.notFound')}</p>
    </>
  );

  const { doc, lines } = data;
  const balance = documentBalance(doc, paymentsQ.data ?? null, new Date().toISOString().slice(0, 10));
  const orgLabel = orgsQ.data?.find((o) => o.id === doc.financing_org_id)?.label ?? null;
  const showBalance = doc.doc_type !== 'AVO';
  const linesHt = lines.reduce((s, l) => s + Number(l.line_ht), 0);
  const discount = Number(doc.global_discount_pct) > 0
    ? linesHt * Number(doc.global_discount_pct) / 100
    : Number(doc.global_discount_amount);
  const shippingHt = Number(doc.shipping_ht);
  const convertTargets = CONVERSIONS[doc.doc_type] ?? [];
  const canConvert = !isClosedDocStatus(doc.status);
  const sourceId = (doc.doc_type === 'AVO' || doc.doc_type === 'FAA') ? doc.source_document_id : null;

  return (
    <>
      <PageHeader
        title={`${t(`sales.type_${doc.doc_type}`)} ${doc.number ?? t('sales.draftSuffix')}`}
        description={`${doc.issue_date}${doc.due_date ? ` · ${t('sales.dueDate')} ${doc.due_date}` : ''}${doc.operator ? ` · ${t('sales.operator')} ${doc.operator}` : ''}`}
        breadcrumbs={[{ label: t('nav.sales'), to: '/sales' }, { label: doc.number ?? t('sales.draftSuffix') }]}
        actions={
          <div className="flex items-center gap-2">
            <PrepareButton doc={doc} withLabel />
            <Button variant="outline" onClick={() => printDocument(data, companies.find((c) => c.id === doc.company_id)?.name ?? '').catch((e) => toast.error(errorMessage(e)))}><Printer /> {t('sales.print')}</Button>
            <Button variant="outline" onClick={() => pdfPreview.mutate()} disabled={pdfPreview.isPending}>{pdfPreview.isPending ? <Loader2 className="animate-spin" /> : <FileDown />} {t('salesMail.previewPdf')}</Button>
            {(doc.doc_type === 'FAC' || doc.doc_type === 'AVO' || doc.doc_type === 'FAA') && doc.number && <Button variant="outline" onClick={() => exportInvoiceUbl(documentId).catch((e) => toast.error(errorMessage(e)))} title={t('accounting.ublHint')}><FileText /> {t('accounting.exportUbl')}</Button>}
            {/* Ticket sans client : envoi à une adresse saisie, non enregistrée (PDV010). */}
            {(contactId || (doc.doc_type === 'TIK' && doc.number)) && <Button variant="outline" onClick={() => setMailOpen(true)}><Mail /> {t('sales.sendMail')}</Button>}
            {doc.doc_type === 'DEV' && doc.vehicle_id && <Button variant="outline" onClick={() => accident.mutate()} disabled={accident.isPending}>{accident.isPending ? <Loader2 className="animate-spin" /> : <LifeBuoy />} {t('accidentFile.open')}</Button>}
            {contactId && <Button variant="outline" onClick={() => setSmsOpen(true)}><MessageSquare /> {t('sales.sendSms')}</Button>}
            <Button variant="outline" onClick={() => navigate({ to: '/sales' })}><ArrowLeft /> {t('sales.backToList')}</Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge tone={statusTone(doc.status)} label={t(`sales.status_${doc.status}`)} />
        {doc.tax_exempt && <StatusBadge tone="info" label={t('sales.taxExempt')} />}
        {isMargeDocument(doc) && <StatusBadge tone="info" label={t('sales.margeTitle')} />}
        {docAvailability && <AvailabilityBadge status={docAvailability.status} pct={docAvailability.pct} />}
        {canConvert && (convertTargets.length > 0 || canGenerateCreditNote(doc)) && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {convertTargets.length > 0 && <span className="text-[12px] text-muted-foreground">{t('sales.convertTo')}</span>}
            {convertTargets.map((tt) => (
              <Button key={tt} size="sm" variant="outline" onClick={() => { void askOrRun('convert', tt); }} disabled={readOnly || convert.isPending}>
                {convert.isPending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />} {t(`sales.type_${tt}`)}
              </Button>
            ))}
            {canGenerateCreditNote(doc) && (
              <Button size="sm" variant="outline" onClick={() => { void askOrRun('creditNote', 'AVO'); }} disabled={readOnly || credit.isPending}>
                {credit.isPending ? <Loader2 className="animate-spin" /> : <Undo2 />} {t('sales.creditNote')}
              </Button>
            )}
          </div>
        )}
        {isDraftDocument(doc) && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-muted-foreground">{t('sales.draftHint')}</span>
            <Button size="sm" onClick={() => navigate({ to: '/sales/$documentId/edit', params: { documentId } })} disabled={readOnly}>
              <Pencil /> {t('sales.editDraft')}
            </Button>
            <Button size="sm" variant="outline" className="text-danger" onClick={onDeleteDraft} disabled={readOnly || removeDraft.isPending}>
              {removeDraft.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />} {t('sales.deleteDraft')}
            </Button>
          </div>
        )}
      </div>
      <ConfirmDocumentDialog
        companyId={doc.company_id} request={confirmRequest} pending={convert.isPending || credit.isPending}
        onConfirm={runConfirmed} onCancel={() => setConfirmRequest(null)}
      />

      {(contactId || doc.code_client_legacy) && (
        <div className="mb-4 text-[13px]">
          <span className="text-muted-foreground">{t('sales.client')} : </span>
          {contactId ? (
            <button className="font-medium text-info underline" onClick={() => navigate({ to: '/clients/$contactId', params: { contactId } })}>
              {contactQ.data ? contactDisplayName(contactQ.data) : '…'}
            </button>
          ) : (
            <span className="font-medium">{t('sales.legacyClient')} #{doc.code_client_legacy}</span>
          )}
        </div>
      )}

      {sourceId && (
        <div className="mb-4 text-[13px]">
          <span className="text-muted-foreground">{t(doc.doc_type === 'AVO' ? 'sales.creditOf' : 'sales.depositOf')} : </span>
          <button className="font-medium text-info underline" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: sourceId } })}>
            {t('sales.openSource')}
          </button>
        </div>
      )}

      {vehicleId && (
        <div className="mb-4 text-[13px]">
          <span className="text-muted-foreground">{t('sales.vehicle')} : </span>
          <button className="font-medium text-info underline" onClick={() => navigate({ to: '/vehicles/$vehicleId', params: { vehicleId } })}>
            {vehicleQ.data ? vehicleLabel(vehicleQ.data) : '…'}{vehicleQ.data?.vin ? ` · ${vehicleQ.data.vin}` : ''}
          </button>
        </div>
      )}

      <DocumentOrdersPanel doc={doc} payments={paymentsQ.data ?? null} onOrder={() => setOrderDialog([])} />

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('sales.colDesignation')}</Th>
              <Th className="text-right">{t('sales.colQty')}</Th>
              <Th className="text-right">{t('sales.colPuHt')}</Th>
              <Th className="text-right">{t('sales.colVat')}</Th>
              <Th className="text-right">{t('sales.colLineHt')}</Th>
              {showAvailability && <Th>{t('availability.colDispo')}</Th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              // Lignes texte (commentaire multi-lignes) et vides : sans montant (mission 05, carte 5).
              if (l.line_type === 'vide') return <tr key={l.id} className="border-b border-border last:border-0"><td colSpan={showAvailability ? 6 : 5} className="px-3 py-2">&nbsp;</td></tr>;
              if (l.line_type === 'texte') return (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td colSpan={showAvailability ? 6 : 5} className="whitespace-pre-wrap px-3 py-2 italic">{l.designation}</td>
                </tr>
              );
              const ls = showAvailability ? lineStockById.get(l.id) : undefined;
              const lineStatus = ls ? saleStockStatus(ls, Number(l.quantity)) : null;
              return (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{l.reference ? <span className="mr-2 font-mono text-[12px] text-muted-foreground">{l.reference}</span> : null}{l.designation}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.quantity}{l.line_type === 'main_oeuvre' ? ` ${t('sales.hoursUnit')}` : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(Number(l.unit_price_ht))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.vat_rate}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(Number(l.line_ht))}</td>
                  {showAvailability && (
                    <td className="px-3 py-2">
                      {ls && lineStatus && lineStatus !== 'na' && (
                        <span
                          className="inline-flex items-center gap-1"
                          title={t('availability.stockHintClient')
                            .replace('{free}', String(ls.real_qty - ls.reserved_qty)).replace('{real}', String(ls.real_qty))
                            .replace('{reserved}', String(ls.reserved_qty)).replace('{order}', String(ls.on_order_qty))}
                        >
                          <SaleStockBadge status={lineStatus} free={ls.real_qty - ls.reserved_qty} />
                          {contactId && lineStatus !== 'disponible' && (
                            <Button
                              size="sm" variant="ghost" title={t('onOrder.associateHint')}
                              onClick={() => setAssociate({ articleId: ls.article_id, reference: l.reference, designation: l.designation })}
                            >
                              <Link2 className="size-4" />
                            </Button>
                          )}
                          {lineStatus === 'a_commander' && canOrderFromDocument(doc) && (
                            <Button size="sm" variant="ghost" title={t('orderFromDoc.lineHint')} onClick={() => setOrderDialog([ls.article_id])}>
                              <ShoppingCart className="size-4" />
                            </Button>
                          )}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {allocationsQ.data && allocationsQ.data.length > 0 && (
        <div className="mt-3 rounded-md border border-border bg-card p-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('onOrder.allocationsTitle')}</p>
          <ul className="space-y-1 font-data text-[13px]">
            {allocationsQ.data.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <Link2 className="size-4 text-info" />
                <span className="tabular-nums">
                  {t('onOrder.allocationLine')
                    .replace('{qty}', String(a.qty)).replace('{ref}', a.reference ?? '—')
                    .replace('{order}', a.part_order_number ?? '—').replace('{who}', a.created_by_name ?? '—')
                    .replace('{when}', new Date(a.created_at).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}
                </span>
                <Button
                  size="sm" variant="ghost" className="ml-auto" disabled={readOnly || removeAllocation.isPending}
                  onClick={() => { if (window.confirm(t('onOrder.removeConfirm'))) removeAllocation.mutate(a.id); }}
                >
                  <X className="size-4" /> {t('onOrder.remove')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-col items-end gap-1 font-data text-sm tabular-nums">
        {discount > 0.005 && <span className="text-muted-foreground">{t('sales.totalDiscount')} : − {eur(discount)}</span>}
        {shippingHt > 0.005 && <span className="text-muted-foreground">{t('sales.totalShipping')} : {eur(shippingHt)}</span>}
        {!isMargeDocument(doc) && <span>{t('sales.totalHt')} : <b>{eur(Number(doc.total_ht))}</b></span>}
        {!isMargeDocument(doc) && <span className="text-muted-foreground">{t('sales.totalVat')} : {eur(Number(doc.total_vat))}</span>}
        {isMargeDocument(doc) && <span className="text-muted-foreground">{t('sales.margeNoVat')}</span>}
        <span className="text-base">{t('sales.totalTtc')} : <b>{eur(Number(doc.total_ttc))}</b></span>
      </div>

      {showBalance && (
        <div className="mt-4">
          <DocumentBalanceBlock
            balance={balance} orgLabel={orgLabel}
            financingStatus={doc.financing_status} financingAmount={Number(doc.financing_amount)}
            onEditFinancing={doc.status !== 'annulee' ? () => setFinancingOpen(true) : undefined}
          />
        </div>
      )}

      {doc.status !== 'annulee' && doc.status !== CREDITED_STATUS && doc.status !== 'brouillon' && (
        <div className="mt-4">
          <PaymentPanel
            documentId={documentId} companyId={doc.company_id} due={balance.clientDue} overdue={balance.overdue}
            financingAccepted={doc.financing_status === 'accepte'}
            acompte={(DEPOSIT_DOC_TYPES as readonly string[]).includes(doc.doc_type)}
            stripe={{
              totalTtc: Number(doc.total_ttc), docNumber: doc.number,
              customerName: contactQ.data ? contactDisplayName(contactQ.data) : null,
              customerEmail: contactQ.data?.email ?? null, customerPhone: contactQ.data?.phone ?? null,
            }}
          />
        </div>
      )}

      {/* Paiement par QR de virement sur l'écran client (mission 02, carte 9) */}
      {showsDepositInvoices(doc) && (
        <div className="mt-4">
          <DepositInvoicePanel doc={doc} readOnly={readOnly} required={!!doc.vehicle_id || !!(contactQ.data?.vat_number ?? '').trim()} />
        </div>
      )}

      {doc.status !== 'annulee' && doc.doc_type !== 'AVO' && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <DocumentCustomerScreen
            full={data} contact={contactQ.data ?? null} clientDue={balance.clientDue}
            onSendTicket={(contactId || doc.doc_type === 'TIK') ? (email) => { setMailTo(email); setMailOpen(true); } : undefined}
          />
        </div>
      )}

      {!isClosedDocStatus(doc.status) && doc.doc_type !== 'AVO' && doc.doc_type !== 'FAA' && (
        <div className="mt-4">
          <QrPaymentCard
            documentId={documentId} companyId={doc.company_id} docType={doc.doc_type} docNumber={doc.number}
            customerName={contactQ.data ? contactDisplayName(contactQ.data) : null}
            totalTtc={Number(doc.total_ttc)} clientDue={balance.clientDue}
          />
        </div>
      )}

      <div className="mt-6">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ged.title')}</p>
        <AttachmentsPanel companyId={doc.company_id} entityType="document" entityId={documentId} />
      </div>

      {financingOpen && (
        <FinancingDialog
          documentId={documentId} companyId={doc.company_id} totalTtc={Number(doc.total_ttc)}
          current={{ orgId: doc.financing_org_id, amount: Number(doc.financing_amount), status: doc.financing_status }}
          onClose={() => setFinancingOpen(false)}
        />
      )}
      {orderDialog && (
        <OrderFromDocumentDialog
          documentId={documentId} companyId={doc.company_id} preselect={orderDialog}
          documentLabel={`${t(`sales.type_${doc.doc_type}`)} ${doc.number ?? t('sales.draftSuffix')}`}
          onClose={() => { setOrderDialog(null); linesStockQ.refetch(); }}
        />
      )}
      {associate && contactId && (
        <AssociateOrderDialog
          articleId={associate.articleId} reference={associate.reference} designation={associate.designation}
          documentId={documentId} contactId={contactId}
          onClose={() => { setAssociate(null); linesStockQ.refetch(); allocationsQ.refetch(); }}
        />
      )}
      {mailOpen && (contactQ.data || !contactId) && (
        <DocumentMailDialog full={data} contact={contactQ.data ?? null} companyName={companies.find((c) => c.id === doc.company_id)?.name ?? ''} initialTo={mailTo} onClose={() => { setMailOpen(false); setMailTo(null); }} />
      )}
      {smsOpen && contactQ.data && (
        <SendSmsDialog companyId={doc.company_id} document={doc} contact={contactQ.data} onClose={() => setSmsOpen(false)} />
      )}
    </>
  );
}

function SendSmsDialog({ companyId, document, contact, onClose }: { companyId: string; document: DocumentRow; contact: Contact; onClose: () => void }) {
  const label = document.number ?? t('sales.draftSuffix');
  const to = contact.mobile || contact.phone || '';
  // SMS proposé dans la langue du client (fiche contact, I18N004), modifiable.
  const [body, setBody] = useState(tIn(contactLocale(contact), 'sales.smsBodyDefault').replace('{number}', label));
  const send = useMutation({
    mutationFn: () => enqueueDocumentSms({ companyId, document, contact, body }),
    onSuccess: () => { toast.success(t('sales.smsQueued')); onClose(); },
      // Toast sur mesure émis ici : on coupe le toast global (mutation-feedback).
      meta: { success: false, error: false },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('sales.sendSmsTitle')}</DialogTitle></DialogHeader>
        {!to ? (
          <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('sales.noPhone')}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t('sales.smsTo')}</Label>
              <Input value={to} disabled />
            </div>
            <div className="space-y-1.5">
              <Label>{t('sales.smsBody')}</Label>
              <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <p className="text-[12px] text-muted-foreground">{t('sales.notifHint')}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => send.mutate()} disabled={send.isPending || !to}>
            {send.isPending ? <Loader2 className="animate-spin" /> : <MessageSquare />} {t('sales.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
