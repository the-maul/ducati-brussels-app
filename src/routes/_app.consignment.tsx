/**
 * M7 — Écran unique « Dépôt-vente » (rattrapage G8 du 18/11/2026, VEN007 / VEN008, bloquant #10) :
 * liste des dépôts (en cours / vendus / rendus) avec recherche n°, référence, immatriculation,
 * VIN, déposant ; nouvelle fiche ; fiche détaillée (vente, retour client, réparations, versement).
 * La logique vit dans `src/modules/tradein/consignment-*`.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { t, pageTitle } from '@/lib/i18n';
import { CONSIGNMENT_VIEWS, filterConsignments, type ConsignmentView } from '@/modules/tradein/consignment-rules';
import { listConsignmentsFull, loadConsignmentSettings, ConsignmentUnavailableError, type ConsignmentFull } from '@/modules/tradein/consignment-api';
import { partyName } from '@/modules/tradein/consignment-print';
import { ConsignmentStatusBadge, Th, eur, dateFr } from '@/modules/tradein/consignment-ui';
import { ConsignmentEntryDialog } from '@/modules/tradein/consignment-entry-dialog';
import { ConsignmentSaleDialog } from '@/modules/tradein/consignment-sale-dialog';
import { ConsignmentDetailDialog } from '@/modules/tradein/consignment-detail-dialog';

export const Route = createFileRoute('/_app/consignment')({
  head: () => ({ meta: [{ title: pageTitle('consignment') }] }),
  component: ConsignmentPage,
});

function ConsignmentPage() {
  const { activeCompanyId, activeCompany } = useAuth();
  const canWrite = useCanWrite();
  const qc = useQueryClient();
  const [view, setView] = useState<ConsignmentView>('en_cours');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [entry, setEntry] = useState<{ open: boolean; editing: ConsignmentFull | null }>({ open: false, editing: null });
  const [selling, setSelling] = useState<ConsignmentFull | null>(null);

  const list = useQuery({
    queryKey: ['consignments-full', activeCompanyId],
    queryFn: () => listConsignmentsFull(activeCompanyId!),
    // Relue au retour sur la page : l'étape du fil dépend du paiement de la facture, saisi sur un autre écran.
    enabled: !!activeCompanyId, retry: false, staleTime: 0,
  });
  const settingsQ = useQuery({
    queryKey: ['consignment-settings', activeCompanyId],
    queryFn: () => loadConsignmentSettings(activeCompanyId!),
    enabled: !!activeCompanyId,
  });
  const settings = useMemo(() => settingsQ.data ?? {}, [settingsQ.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['consignments-full', activeCompanyId] });

  const rows = useMemo(() => (list.data ?? []).map((c) => ({
    c, status: c.status, number: c.number, reference: c.article?.reference ?? c.vehicle?.reference ?? null,
    plate: c.vehicle?.plate ?? null, vin: c.vehicle?.vin ?? null, model: [c.vehicle?.brand, c.vehicle?.model].filter(Boolean).join(' '),
    depositorName: partyName(c.depositor), buyerName: c.buyer ? partyName(c.buyer) : null,
  })), [list.data]);
  const shown = filterConsignments(rows, view, q);
  const counts = useMemo(() => Object.fromEntries(CONSIGNMENT_VIEWS.map((v) => [v, filterConsignments(rows, v, '').length])), [rows]);
  const opened = (list.data ?? []).find((c) => c.id === openId) ?? null;
  const unavailable = list.error instanceof ConsignmentUnavailableError;

  return (
    <>
      <PageHeader title={t('consign.title')} description={t('consign.subtitle')}
        actions={canWrite ? <Button onClick={() => setEntry({ open: true, editing: null })} disabled={unavailable}><Plus /> {t('consign.add')}</Button> : undefined} />

      {unavailable && (
        <p className="mb-3 flex items-center gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
          <AlertTriangle className="size-4" /> {t('consign.unavailable')}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as ConsignmentView)}>
          <TabsList>
            {CONSIGNMENT_VIEWS.map((v) => <TabsTrigger key={v} value={v}>{t(`consign.view_${v}`)} <span className="ml-1 tabular-nums text-muted-foreground">{counts[v] ?? 0}</span></TabsTrigger>)}
          </TabsList>
        </Tabs>
        <div className="relative w-80 max-w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('consign.searchList')} className="h-9 pl-9" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('consign.number')}</Th><Th>{t('consign.reference')}</Th><Th>{t('consign.moto')}</Th><Th>{t('consign.vin')}</Th>
              <Th>{t('consign.plate')}</Th><Th>{t('consign.depositor')}</Th><Th>{t('consign.entryDate')}</Th>
              <Th className="text-right">{t('consign.asked')}</Th><Th className="text-right">{t('consign.salePrice')}</Th><Th>{t('consign.status')}</Th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={10} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-4 animate-spin" /></td></tr>}
            {!list.isLoading && shown.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">{t('consign.empty')}</td></tr>}
            {shown.map(({ c, reference, model, depositorName }) => (
              <tr key={c.id} onClick={() => setOpenId(c.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                <td className="px-3 py-2 font-mono">{c.number ?? '—'}</td>
                <td className="px-3 py-2 font-mono">{reference ?? '—'}</td>
                <td className="px-3 py-2">{model || '—'}</td>
                <td className="px-3 py-2 font-mono">{c.vehicle?.vin ?? '—'}</td>
                <td className="px-3 py-2">{c.vehicle?.plate ?? '—'}</td>
                <td className="px-3 py-2">{depositorName}</td>
                <td className="px-3 py-2">{dateFr(c.entry_date ?? c.created_at)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(c.asked_price)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(c.status === 'vendu' ? c.sold_price : c.agreed_price)}</td>
                <td className="px-3 py-2"><ConsignmentStatusBadge status={c.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activeCompanyId && (
        <ConsignmentEntryDialog open={entry.open} onOpenChange={(o) => setEntry((s) => ({ ...s, open: o }))}
          companyId={activeCompanyId} settings={settings} consignment={entry.editing}
          onSaved={(id) => { refresh(); setOpenId(id); }} />
      )}
      {activeCompanyId && opened && (
        <ConsignmentDetailDialog open={!!opened && !entry.open && !selling} onOpenChange={(o) => { if (!o) setOpenId(null); }}
          companyId={activeCompanyId} companyName={activeCompany?.name ?? ''} consignment={opened} canWrite={canWrite}
          onEdit={() => setEntry({ open: true, editing: opened })} onSell={() => setSelling(opened)} onChanged={refresh} />
      )}
      {activeCompanyId && selling && (
        <ConsignmentSaleDialog open={!!selling} onOpenChange={(o) => { if (!o) setSelling(null); }}
          companyId={activeCompanyId} settings={settings} consignment={selling}
          onSold={() => { refresh(); qc.invalidateQueries({ queryKey: ['vehicles'] }); }} />
      )}
    </>
  );
}
