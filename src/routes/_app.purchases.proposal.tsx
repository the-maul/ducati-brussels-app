/**
 * M4 — Proposition de commande des commandes de pièces (mission 02, carte 4 ; parité G8
 * « Rappel proposition de commande », process-commandes-pieces.md §2.3). Les pièces des commandes
 * validées, pas encore commandées chez un fournisseur, regroupées par fournisseur : total HTVA au
 * prix d'achat, minimum de commande et franco de port, détail des lignes ; demande de prix et
 * commande par mail (Outlook, simulation possible) ; « Valider → commande fournisseur ».
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, FileDown, FileQuestion, Loader2, Mail, PackageCheck, Truck, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { getOrderRules } from '@/modules/orders/api';
import { DispatchBadge, eur, kindIcon, kindLabel } from '@/modules/orders/order-ui';
import type { OrderDispatchStatus } from '@/modules/orders/api';
import { getPurchaseFull, listSuppliers, supplierName } from '@/modules/purchases/api';
import { downloadDcs } from '@/modules/purchases/dcs-export';
import {
  countByKind, dcsKindOf, defaultSelected, groupBySupplier, isExcel, lineAmount, splitDcs, thresholdState, totalsOf,
  NO_SUPPLIER, type ProposalRow, type SupplierGroup, type Threshold,
} from '@/modules/purchases/proposal';
import {
  createSupplierOrder, getSupplierProposal, setProposalLineSupplier, type SupplierOrderResult,
} from '@/modules/purchases/proposal-api';
import { SupplierMailDialog, type SupplierMailKind } from '@/modules/purchases/supplier-mail-dialog';

export const Route = createFileRoute('/_app/purchases/proposal')({
  head: () => ({ meta: [{ title: 'Proposition de commande — Ducati Bruxelles' }] }),
  component: ProposalPage,
});

const fill = (s: string, vars: Record<string, string>) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), s);
const qtyFmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

function ProposalPage() {
  const { activeCompanyId, activeCompany } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [kind, setKind] = useState<string>('all');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [mail, setMail] = useState<{ kind: SupplierMailKind; group: SupplierGroup; lines: ProposalRow[] } | null>(null);
  const [confirm, setConfirm] = useState<SupplierGroup | null>(null);
  const [result, setResult] = useState<(SupplierOrderResult & { supplier: string }) | null>(null);

  const rowsQ = useQuery({ queryKey: ['supplier-proposal', activeCompanyId], queryFn: () => getSupplierProposal(activeCompanyId!), enabled: !!activeCompanyId });
  const rulesQ = useQuery({ queryKey: ['order-rules', activeCompanyId], queryFn: () => getOrderRules(activeCompanyId!), enabled: !!activeCompanyId });
  const suppliersQ = useQuery({ queryKey: ['suppliers-all', activeCompanyId], queryFn: () => listSuppliers(activeCompanyId!, '', 500), enabled: !!activeCompanyId });

  const rows = rowsQ.data ?? [];
  const rules = rulesQ.data ?? [];
  // Pré-sélection : lignes payées / à envoyer, hors Excel, avec fournisseur (une fois par ligne).
  useEffect(() => {
    if (!rowsQ.data) return;
    setSelected((s) => {
      const next = { ...s };
      for (const r of rowsQ.data) if (next[r.line_id] === undefined) next[r.line_id] = defaultSelected(r);
      return next;
    });
  }, [rowsQ.data]);

  const groups = useMemo(() => groupBySupplier(rows, kind), [rows, kind]);
  const counts = useMemo(() => countByKind(rows), [rows]);
  const kinds = useMemo(() => {
    const codes = rules.map((r) => r.code);
    for (const r of rows) if (!codes.includes(r.order_kind)) codes.push(r.order_kind);
    return codes;
  }, [rules, rows]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['supplier-proposal', activeCompanyId] });

  const setSupplier = useMutation({
    mutationFn: ({ lineId, supplierId }: { lineId: string; supplierId: string }) => setProposalLineSupplier(lineId, supplierId),
    onSuccess: () => { toast.success(t('proposal.supplierChanged')); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('proposal.errGeneric')),
  });

  const create = useMutation({
    mutationFn: (g: SupplierGroup) => createSupplierOrder(activeCompanyId!, g.supplierId!, selectedOf(g).map((l) => l.line_id)),
    onSuccess: (r, g) => {
      setResult({ ...r, supplier: g.name ?? '' });
      toast.success(fill(t('proposal.created'), { n: String(r.orders.length) }));
      refresh();
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['part-orders'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('proposal.errGeneric')),
  });

  const selectable = (l: ProposalRow) => !isExcel(l) && !!l.supplier_id;
  const selectedOf = (g: SupplierGroup) => g.lines.filter((l) => selectable(l) && selected[l.line_id]);
  const toggle = (id: string, v: boolean) => setSelected((s) => ({ ...s, [id]: v }));

  return (
    <>
      <PageHeader
        title={t('proposal.title')}
        description={t('proposal.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/purchases' })}><ArrowLeft /> {t('purchases.backToList')}</Button>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.filterKind')}</span>
        {['all', ...kinds].map((k) => {
          const Icon = k === 'all' ? null : kindIcon(k);
          return (
            <Button key={k} size="sm" variant={kind === k ? 'default' : 'outline'} onClick={() => setKind(k)}>
              {Icon && <Icon />} {k === 'all' ? t('orders.filterAll') : kindLabel(k, rules)}
              <span className="tabular-nums opacity-80">({counts[k] ?? 0})</span>
            </Button>
          );
        })}
      </div>
      <p className="mb-4 flex items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
        <Info className="mt-0.5 size-4 shrink-0" /> {t('proposal.hint')}
      </p>

      {result && <ResultPanel result={result} onClose={() => setResult(null)} />}

      {rowsQ.isLoading && <div className="grid place-items-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}
      {rowsQ.isError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(rowsQ.error as Error).message}</p>}
      {rowsQ.data && groups.length === 0 && (
        <p className="rounded-md border border-border px-3 py-8 text-center text-[13px] text-muted-foreground">{t('proposal.empty')}</p>
      )}

      <div className="space-y-5">
        {groups.map((g) => {
          const sel = selectedOf(g);
          const selTotals = totalsOf(sel);
          const minT = thresholdState(selTotals.totalHt, g.orderMin);
          const francoT = thresholdState(selTotals.totalHt, g.francoMin);
          const noSupplier = g.key === NO_SUPPLIER;
          const unpaidSel = sel.filter((l) => l.dispatch_status === 'en_attente_paiement').length;
          const allSelectable = g.lines.filter(selectable);
          const allChecked = allSelectable.length > 0 && allSelectable.every((l) => selected[l.line_id]);
          return (
            <section key={g.key} className="rounded-md border border-border">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/50 px-4 py-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-ui text-[15px] font-bold">{noSupplier ? t('proposal.noSupplier') : g.name}</h2>
                    {g.isDcs && <StatusBadge tone="info" icon={FileDown} label={t('proposal.dcsBadge')} />}
                    {noSupplier && <StatusBadge tone="warning" icon={AlertTriangle} label={t('proposal.chooseSupplier')} />}
                  </div>
                  <p className="font-data text-[13px] tabular-nums text-muted-foreground">
                    {fill(t('proposal.groupTotal'), { n: String(g.lines.length), total: eur(g.totalHt) })}
                    {Object.entries(g.byKind).map(([k, v]) => ` · ${kindLabel(k, rules)} ${eur(v)}`).join('')}
                  </p>
                  {g.missingPa > 0 && (
                    <p className="flex items-center gap-1 text-[12px] text-warning"><AlertTriangle className="size-3.5" /> {fill(t('proposal.missingPa'), { n: String(g.missingPa) })}</p>
                  )}
                </div>
                {!noSupplier && (
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex flex-wrap items-center justify-end gap-2 font-data text-[13px]">
                      <span className="tabular-nums">{t('proposal.selection')} : <b>{eur(selTotals.totalHt)}</b> HTVA</span>
                      <ThresholdBadge label={t('proposal.orderMin')} th={minT} />
                      <ThresholdBadge label={t('proposal.franco')} th={francoT} />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="outline" disabled={sel.length === 0} onClick={() => setMail({ kind: 'price_request', group: g, lines: sel })}>
                        <FileQuestion /> {t('proposal.actPriceRequest')}
                      </Button>
                      <Button size="sm" variant="outline" disabled={sel.length === 0} onClick={() => setMail({ kind: 'order', group: g, lines: sel })}>
                        <Mail /> {t('proposal.actMailOrder')}
                      </Button>
                      <Button size="sm" disabled={sel.length === 0 || create.isPending} onClick={() => setConfirm(g)}>
                        {create.isPending && create.variables?.key === g.key ? <Loader2 className="animate-spin" /> : <PackageCheck />} {t('proposal.actValidate')}
                      </Button>
                    </div>
                  </div>
                )}
              </header>
              {!noSupplier && (minT.state === 'missing' || francoT.state === 'missing') && (
                <p className="flex items-center gap-2 border-b border-border bg-warning-bg px-4 py-2 text-[12px] text-warning">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  {[minT.state === 'missing' ? fill(t('proposal.minMissing'), { rest: eur(minT.rest), min: eur(minT.min ?? 0) }) : null,
                    francoT.state === 'missing' ? fill(t('proposal.francoMissing'), { rest: eur(francoT.rest), min: eur(francoT.min ?? 0) }) : null]
                    .filter(Boolean).join(' ')}
                </p>
              )}
              {unpaidSel > 0 && (
                <p className="flex items-center gap-2 border-b border-border bg-warning-bg px-4 py-2 text-[12px] text-warning">
                  <AlertTriangle className="size-3.5 shrink-0" /> {fill(t('proposal.unpaidSelected'), { n: String(unpaidSel) })}
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-data text-[13px]">
                  <thead className="bg-muted">
                    <tr>
                      <Th className="w-8">
                        {!noSupplier && (
                          <Checkbox checked={allChecked} onCheckedChange={(v) => setSelected((s) => {
                            const next = { ...s }; for (const l of allSelectable) next[l.line_id] = v === true; return next;
                          })} aria-label={t('proposal.selectAll')} />
                        )}
                      </Th>
                      <Th>{t('proposal.colRef')}</Th><Th>{t('proposal.colDesignation')}</Th><Th>{t('proposal.colClient')}</Th>
                      <Th>{t('proposal.colOrigin')}</Th><Th>{t('proposal.colOrder')}</Th><Th>{t('proposal.colKind')}</Th>
                      <Th className="text-right">{t('proposal.colQtyClient')}</Th><Th className="text-right">{t('proposal.colQtyShop')}</Th>
                      <Th className="text-right">{t('proposal.colPa')}</Th><Th className="text-right">{t('proposal.colAmount')}</Th>
                      <Th>{t('proposal.colSupplier')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((l) => {
                      const KIcon = kindIcon(l.order_kind);
                      const amount = lineAmount(l);
                      return (
                        <tr key={l.line_id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2">
                            {selectable(l)
                              ? <Checkbox checked={!!selected[l.line_id]} onCheckedChange={(v) => toggle(l.line_id, v === true)} aria-label={t('proposal.selectLine')} />
                              : null}
                          </td>
                          <td className="px-3 py-2 font-mono text-[12px]">
                            {l.reference ?? '—'}
                            {l.supplier_ref && l.supplier_ref !== l.reference && <div className="text-muted-foreground">{l.supplier_ref}</div>}
                          </td>
                          <td className="px-3 py-2">{l.designation}</td>
                          <td className="px-3 py-2">
                            {l.contact_id
                              ? <Link to="/clients/$contactId" params={{ contactId: l.contact_id }} className="text-info underline">{l.contact_name ?? '—'}</Link>
                              : <span className="text-muted-foreground">{t('proposal.forStock')}</span>}
                          </td>
                          <td className="px-3 py-2 font-mono text-[12px]">
                            {l.source_document_id
                              ? <Link to="/sales/$documentId" params={{ documentId: l.source_document_id }} className="text-info underline">{l.source_document_number ?? t('proposal.document')}</Link>
                              : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col items-start gap-1">
                              <Link to="/orders/$orderId" params={{ orderId: l.order_id }} className="font-mono text-[12px] text-info underline">{l.order_number ?? '—'}</Link>
                              <DispatchBadge status={l.dispatch_status as OrderDispatchStatus} />
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1"><KIcon className="size-3.5 text-muted-foreground" /> {kindLabel(l.order_kind, rules)}</span>
                            {isExcel(l) && <div className="text-[12px] text-muted-foreground">{t('proposal.excelCircuit')}</div>}
                            {g.isDcs && !isExcel(l) && <div className="text-[12px] text-muted-foreground">{fill(t('proposal.dcsFile'), { kind: dcsKindOf(l.order_kind) })}</div>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(l.qty_client)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(l.qty_shop)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{l.purchase_price != null ? eur(l.purchase_price) : <span className="text-warning">{t('proposal.paUnknown')}</span>}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{amount != null ? eur(amount) : '—'}</td>
                          <td className="px-3 py-2">
                            <Select
                              value={l.supplier_id ?? undefined}
                              onValueChange={(v) => setSupplier.mutate({ lineId: l.line_id, supplierId: v })}
                              disabled={setSupplier.isPending}
                            >
                              <SelectTrigger className="h-8 w-44"><SelectValue placeholder={t('proposal.chooseSupplier')} /></SelectTrigger>
                              <SelectContent>
                                {(suppliersQ.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{supplierName(s)}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      {mail && activeCompanyId && mail.group.supplierId && (
        <SupplierMailDialog
          kind={mail.kind} companyId={activeCompanyId} companyName={activeCompany?.name ?? ''}
          supplierId={mail.group.supplierId} supplierName={mail.group.name ?? ''} supplierEmail={mail.group.email}
          lines={mail.lines} onClose={() => setMail(null)}
        />
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          {confirm && (() => {
            const sel = selectedOf(confirm);
            const split = splitDcs(sel);
            const tot = totalsOf(sel);
            const minT = thresholdState(tot.totalHt, confirm.orderMin);
            const francoT = thresholdState(tot.totalHt, confirm.francoMin);
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>{fill(t('proposal.confirmTitle'), { supplier: confirm.name ?? '' })}</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 text-[13px]">
                      <p>{fill(t('proposal.confirmLines'), { n: String(sel.length), total: eur(tot.totalHt) })}</p>
                      {confirm.isDcs && (
                        <p>{fill(t('proposal.confirmDcs'), { std: String(split.STANDARD.length), urg: String(split.URGENTE.length) })}</p>
                      )}
                      {minT.state === 'missing' && <p className="text-warning">{fill(t('proposal.minMissing'), { rest: eur(minT.rest), min: eur(minT.min ?? 0) })}</p>}
                      {francoT.state === 'missing' && <p className="text-warning">{fill(t('proposal.francoMissing'), { rest: eur(francoT.rest), min: eur(francoT.min ?? 0) })}</p>}
                      {tot.missingPa > 0 && <p className="text-warning">{fill(t('proposal.missingPa'), { n: String(tot.missingPa) })}</p>}
                      <p>{t('proposal.confirmEffects')}</p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { const g = confirm; setConfirm(null); create.mutate(g); }}>{t('proposal.actValidate')}</AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ThresholdBadge({ label, th }: { label: string; th: Threshold }) {
  if (th.state === 'unset') return <StatusBadge tone="neutral" label={`${label} : ${t('proposal.notSet')}`} />;
  if (th.state === 'met') return <StatusBadge tone="success" icon={CheckCircle2} label={fill(t('proposal.thresholdMet'), { label, min: eur(th.min ?? 0) })} />;
  return <StatusBadge tone="warning" icon={AlertTriangle} label={fill(t('proposal.thresholdRest'), { label, rest: eur(th.rest) })} />;
}

function ResultPanel({ result, onClose }: { result: SupplierOrderResult & { supplier: string }; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const dl = async (id: string, kind: 'STANDARD' | 'URGENTE') => {
    setBusy(id);
    try {
      const full = await getPurchaseFull(id);
      downloadDcs(full.order, full.lines, kind);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('proposal.errGeneric'));
    } finally { setBusy(null); }
  };
  return (
    <div className="mb-5 space-y-2 rounded-md bg-success-bg px-4 py-3 text-[13px] text-success">
      <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4" /> {fill(t('proposal.resultTitle'), { supplier: result.supplier })}</p>
      <ul className="space-y-1">
        {result.orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2">
            <Truck className="size-3.5" />
            <Link to="/purchases/$orderId" params={{ orderId: o.id }} className="font-mono underline">{o.number}</Link>
            <span className="tabular-nums">{fill(t('proposal.resultLines'), { n: String(o.lines) })}</span>
            {o.dcs_kind && (
              <Button size="sm" variant="outline" disabled={busy === o.id} onClick={() => dl(o.id, o.dcs_kind!)}>
                {busy === o.id ? <Loader2 className="animate-spin" /> : <FileDown />} {o.dcs_kind === 'URGENTE' ? t('purchases.dcsUrgent') : t('purchases.dcsStandard')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {result.orders.some((o) => o.dcs_kind) && <p className="text-[12px]">{t('proposal.dcsProvisional')}</p>}
      {result.part_orders_sent.length > 0 && (
        <p>{fill(t('proposal.resultSent'), { list: result.part_orders_sent.map((p) => p.number ?? '—').join(', ') })}</p>
      )}
      {result.part_orders_kept.map((p) => (
        <Fragment key={p.id}>
          <p className="text-warning">{fill(t(`proposal.kept_${p.reason}`), { n: p.number ?? '—', msg: p.message ?? '' })}</p>
        </Fragment>
      ))}
      <Button size="sm" variant="outline" onClick={onClose}>{t('proposal.close')}</Button>
    </div>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
