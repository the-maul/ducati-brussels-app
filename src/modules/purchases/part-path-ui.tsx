/**
 * M4 — C2 : le chemin d'une pièce, composant réutilisable. Affiché sur la commande de pièces, le panier,
 * la commande fournisseur et la réception ; le dossier atelier peut l'afficher avec
 * `<PartPathPanel scope="repair_order" scopeId={orId} companyId={...} />`.
 * Statut = couleur + icône + libellé ; « Client prévenu » reste une case à cocher tant que l'envoi est arrêté.
 */
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, CheckCircle2, Circle, CircleDashed, Loader2, Minus, PackageCheck, PackageOpen, PhoneCall, Route as RouteIcon,
  ShoppingBasket, Truck, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCanWrite } from '@/lib/auth/use-access';
import { cn } from '@/lib/utils';
import { fillVars, t } from '@/lib/i18n';
import { INFORM_CHANNELS, type InformChannel } from './g8-rules';
import { listPartPaths, markPartInformed, type PartPathScope } from './part-path-api';
import {
  PATH_STEPS, partPath, partStatusTone, type PartPath, type PartPathRow, type PartStatus, type PartSupply, type StepState,
} from './part-path';

export const qtyFmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
export const todayBrussels = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());
const dateFr = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('fr-BE') : '');

const STATUS_ICON: Record<PartStatus, LucideIcon> = {
  a_commander: AlertTriangle, au_panier: ShoppingBasket, commandee: Truck, reliquat: PackageOpen,
  recue: PackageCheck, preparee: PackageCheck, client_prevenu: PhoneCall, remise: CheckCircle2,
};
const STEP_ICON: Record<StepState, LucideIcon> = { done: Check, partial: CircleDashed, todo: Circle, na: Minus };
const STEP_CLASS: Record<StepState, string> = {
  done: 'bg-success-bg text-success', partial: 'bg-warning-bg text-warning', todo: 'bg-neutral-bg text-neutral-tag', na: 'text-muted-foreground opacity-60',
};

export function PartStatusBadge({ status }: { status: PartStatus }) {
  return <StatusBadge tone={partStatusTone(status)} icon={STATUS_ICON[status]} label={t(`partPath.status_${status}`)} />;
}

/** Les 6 étapes, dans l'ordre du parcours. */
export function PartPathSteps({ path }: { path: PartPath }) {
  return (
    <ol className="flex flex-wrap gap-1" aria-label={t('partPath.title')}>
      {PATH_STEPS.map((k) => {
        const state = path.steps[k];
        const Icon = STEP_ICON[state];
        return (
          <li key={k} title={`${t(`partPath.step_${k}`)} : ${t(`partPath.state_${state}`)}`}
            className={cn('inline-flex items-center gap-1 rounded-[var(--radius-badge)] px-1.5 py-0.5 font-data text-[11px] font-bold', STEP_CLASS[state])}>
            <Icon className="size-3" aria-hidden /> {t(`partPath.step_${k}`)}
          </li>
        );
      })}
    </ol>
  );
}

function SupplyLink({ s }: { s: PartSupply }) {
  const label = s.number ?? t(`partPath.kind_${s.kind}`);
  if (s.kind === 'cmd') return <Link to="/purchases/$orderId" params={{ orderId: s.docId }} search={{}} className="font-mono text-[12px] text-info underline">{label}</Link>;
  if (s.kind === 'basket') return <Link to="/purchases/baskets/$basketId" params={{ basketId: s.docId }} className="font-mono text-[12px] text-info underline">{label}</Link>;
  return <Link to="/orders/excel" className="font-mono text-[12px] text-info underline">{label}</Link>;
}

function ForWhom({ r }: { r: PartPathRow }) {
  return (
    <div className="space-y-0.5">
      {r.contactId
        ? <Link to="/clients/$contactId" params={{ contactId: r.contactId }} className="text-info underline">{r.contactName ?? '—'}</Link>
        : <span className="text-muted-foreground">{r.excelTab ? t(`partPath.tab_${r.excelTab}`) : t('partPath.forStock')}</span>}
      <div className="flex flex-wrap gap-x-2 text-[12px] text-muted-foreground">
        {r.demandKind === 'part_order' && r.sourceId && (
          <Link to="/orders/$orderId" params={{ orderId: r.sourceId }} className="font-mono text-info underline">{r.sourceNumber ?? '—'}</Link>
        )}
        {r.repairOrderId && <Link to="/workshop/$orId" params={{ orId: r.repairOrderId }} className="font-mono text-info underline">{r.orNumber ?? t('partPath.or')}</Link>}
        {r.documentId && <Link to="/sales/$documentId" params={{ documentId: r.documentId }} className="font-mono text-info underline">{r.documentNumber ?? '—'}</Link>}
        {r.appointmentAt && <span>{fillVars(t('partPath.appointment'), { date: dateFr(r.appointmentAt) })}</span>}
      </div>
    </div>
  );
}

function NoticeHint({ r }: { r: PartPathRow }) {
  if (r.informedAt) return <span className="block text-[11px] text-success">{fillVars(t('partPath.informedOn'), { channel: t(`purchasesG8.channel_${r.informedChannel ?? 'autre'}`), date: dateFr(r.informedAt) })}</span>;
  if (!r.noticeStatus) return null;
  const key = r.noticeIsTest && r.noticeStatus === 'sent' ? 'sent_test' : r.noticeStatus;
  return <span className="block text-[11px] text-muted-foreground">{t(`partPath.notice_${['pending', 'sending', 'sent_test', 'failed', 'skipped'].includes(key) ? key : 'pending'}`)}</span>;
}

/** Tableau du chemin : une ligne par pièce demandée. */
export function PartPathTable({ companyId, items, onChanged }: {
  companyId: string; items: { row: PartPathRow; path: PartPath }[]; onChanged: () => void;
}) {
  const canWrite = useCanWrite();
  const [inform, setInform] = useState<{ row: PartPathRow; path: PartPath } | null>(null);
  return (
    <>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              {['colPart', 'colFor', 'colOrder', 'colReceived', 'colPath', 'colStatus'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(`partPath.${h}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(({ row: r, path: p }) => (
              <tr key={`${r.demandKind}:${r.demandId}`} className="border-b border-border align-top last:border-0">
                <td className="px-3 py-2">
                  <span className="font-mono text-[12px]">{r.reference ?? '—'}</span>
                  <span className="block max-w-[240px] truncate" title={r.designation ?? ''}>{r.designation ?? ''}</span>
                  {r.bin && <span className="block text-[11px] text-muted-foreground">{fillVars(t('partPath.bin'), { bin: r.bin })}</span>}
                </td>
                <td className="px-3 py-2"><ForWhom r={r} /></td>
                <td className="px-3 py-2">
                  {r.supplies.length === 0 && <span className="text-muted-foreground">{p.steps.order === 'na' ? t('partPath.fromStock') : t('partPath.notOrdered')}</span>}
                  {r.supplies.map((s) => (
                    <div key={`${s.kind}:${s.docId}`} className="mb-0.5">
                      <span className="mr-1 text-[11px] text-muted-foreground">{t(`partPath.kind_${s.kind}`)}{s.type ? ` · ${t(`partPath.type_${['standard', 'urgente', 'demo', 'excel', 'accident'].includes(s.type) ? s.type : 'standard'}`)}` : ''}</span>
                      <SupplyLink s={s} />
                      {s.dcs && <span className="ml-1 text-[11px] text-muted-foreground">{fillVars(t('partPath.dcs'), { n: s.dcs })}</span>}
                    </div>
                  ))}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="tabular-nums">{qtyFmt(p.qtyReceived)} / {qtyFmt(r.qtyNeeded)}</span>
                  {p.qtyRemaining > 0 && p.qtyReceived > 0 && <span className="block text-[11px] font-bold text-warning">{fillVars(t('partPath.remainder'), { n: qtyFmt(p.qtyRemaining) })}</span>}
                  {p.lastReceivedAt && <span className="block text-[11px] text-muted-foreground">{dateFr(p.lastReceivedAt)}</span>}
                  {p.receipts.map((x) => (
                    <Link key={x.id} to="/purchases/$orderId" params={{ orderId: x.id }} search={{}} className="block font-mono text-[11px] text-info underline" title={x.bl ? fillVars(t('partPath.bl'), { n: x.bl }) : undefined}>
                      {x.number ?? '—'}{x.bl ? ` · ${fillVars(t('partPath.bl'), { n: x.bl })}` : ''}
                    </Link>
                  ))}
                </td>
                <td className="min-w-[250px] px-3 py-2"><PartPathSteps path={p} /><NoticeHint r={r} /></td>
                <td className="px-3 py-2">
                  <div className="flex flex-col items-start gap-1">
                    <PartStatusBadge status={p.status} />
                    {p.isLate && <StatusBadge tone="danger" icon={AlertTriangle} label={t('partPath.late')} />}
                    {p.canInform && canWrite && (
                      <Button size="sm" variant="outline" className="min-h-11" onClick={() => setInform({ row: r, path: p })}><PhoneCall /> {t('partPath.markInformed')}</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inform && <InformDialog companyId={companyId} item={inform} onClose={(done) => { setInform(null); if (done) onChanged(); }} />}
    </>
  );
}

function InformDialog({ companyId, item, onClose }: { companyId: string; item: { row: PartPathRow; path: PartPath }; onClose: (done: boolean) => void }) {
  const [channel, setChannel] = useState<InformChannel>('telephone');
  const [busy, setBusy] = useState(false);
  const { row, path } = item;
  const go = async () => {
    if (!path.informTarget) return;
    setBusy(true);
    try {
      await markPartInformed({
        companyId, sourceKind: path.informTarget.kind, sourceId: path.informTarget.id, articleId: row.articleId, channel,
        receiptId: path.receipts.at(-1)?.id ?? null,
      });
      toast.success(t('partPath.informedSaved'));
      onClose(true);
    } catch (e) { toast.error(e instanceof Error ? e.message : t('partPath.loadError')); setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('partPath.markInformed')}</DialogTitle></DialogHeader>
        <p className="text-[13px]">{fillVars(t('partPath.informHint'), { client: row.contactName ?? '—', phone: row.contactPhone ?? '—' })}</p>
        <Select value={channel} onValueChange={(v) => setChannel(v as InformChannel)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{INFORM_CHANNELS.map((c) => <SelectItem key={c} value={c}>{t(`purchasesG8.channel_${c}`)}</SelectItem>)}</SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>{t('action.cancel')}</Button>
          <Button onClick={go} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {t('partPath.markInformed')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function usePartPaths(companyId: string | null, scope: PartPathScope, scopeId: string | null, openOnly: boolean) {
  const q = useQuery({
    queryKey: ['part-paths', companyId, scope, scopeId, openOnly],
    queryFn: () => listPartPaths(companyId!, scope, scopeId, openOnly),
    enabled: !!companyId && (scope === 'all' || !!scopeId),
  });
  const today = todayBrussels();
  const items = useMemo(() => (q.data ?? []).map((row) => ({ row, path: partPath(row, today) })), [q.data, today]);
  return { ...q, items };
}

/** Bloc « Chemin des pièces » d'un document. Rien n'est affiché s'il n'a aucune pièce à suivre. */
export function PartPathPanel({ companyId, scope, scopeId }: { companyId: string; scope: PartPathScope; scopeId: string }) {
  const qc = useQueryClient();
  const { items, isLoading, error } = usePartPaths(companyId, scope, scopeId, false);
  if (isLoading) return null;
  if (error) return <p className="mt-6 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('partPath.loadError')}</p>;
  if (items.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
        <RouteIcon className="size-3.5" /> {t('partPath.title')}
      </h2>
      <p className="mb-2 text-[12px] text-muted-foreground">{t('partPath.hint')}</p>
      <PartPathTable companyId={companyId} items={items} onChanged={() => qc.invalidateQueries({ queryKey: ['part-paths'] })} />
    </section>
  );
}
