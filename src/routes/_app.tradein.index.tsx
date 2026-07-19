import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Bike, ChevronRight, Store, FileDown, BellRing, Users, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listOro, repriseClientLabel, type OroListItem } from '@/modules/tradein/api';
import {
  offerStatsByOro, markOffersSeen, needsFollowUp, getDispatchMode, setDispatchMode, type DispatchMode,
} from '@/modules/tradein/partners-api';
import { PartnersDialog } from '@/modules/tradein/partners-dialog';
import { downloadSheetForOro } from '@/modules/tradein/sheet-builder';
import { tradeinStatusOf, setRepriseStatusManual, cancelReprise, statusChangedAt, readValidationMeta } from '@/modules/tradein/validate-api';
import { REPRISE_STATUSES, REPRISE_STATUS_FIELD_BG, type RepriseStatus } from '@/modules/tradein/reprise-status';
import { AcceptOfferDialog } from '@/modules/tradein/accept-offer-dialog';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/tradein/')({
  head: () => ({ meta: [{ title: 'Reprises motos clients — Ducati Bruxelles' }] }),
  component: TradeinList,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '—');
const fmtDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function TradeinList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [partnersOpen, setPartnersOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RepriseStatus | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Saisie rapide « Offre acceptée » ouverte via un changement de statut manuel
  const [acceptFor, setAcceptFor] = useState<{ oroId: string; vehicleId: string | null; best: { amount: number; partnerName: string } | null } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['oro', activeCompanyId], queryFn: () => listOro(activeCompanyId!), enabled: !!activeCompanyId });
  const statsQ = useQuery({ queryKey: ['oro-offer-stats', activeCompanyId], queryFn: () => offerStatsByOro(activeCompanyId!), enabled: !!activeCompanyId });
  const stats = statsQ.data ?? new Map<string, { count: number; best: number }>();

  // Mode d'envoi aux marchands — réglage GÉNÉRAL, directement sur la page
  const dispatchQ = useQuery({ queryKey: ['tradein-dispatch', activeCompanyId], queryFn: () => getDispatchMode(activeCompanyId!), enabled: !!activeCompanyId });
  const setMode = useMutation({
    mutationFn: (m: DispatchMode) => setDispatchMode(activeCompanyId!, m),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tradein-dispatch', activeCompanyId] }),
    onError: () => toast.error(t('tradein.errSave')),
  });

  // Ouvrir la page « éteint » la pastille de notification (offres marquées vues).
  useEffect(() => {
    if (!activeCompanyId) return;
    markOffersSeen(activeCompanyId).then(() => {
      qc.invalidateQueries({ queryKey: ['tradein-unseen-offers', activeCompanyId] });
    });
  }, [activeCompanyId, qc]);

  const printSheet = (oroId: string) => {
    downloadSheetForOro(oroId).catch(() => toast.error(t('tradein.errSave')));
  };

  // Changement de statut manuel depuis la liste. Transitions « douces »
  // (collecte/envoye) → écriture directe ; les transitions qui touchent le
  // STOCK passent par le bon chemin (accepté = dialogue, repris = validation,
  // annulé = cancelReprise avec sortie de stock).
  const changeStatus = useMutation({
    mutationFn: ({ oroId, status }: { oroId: string; status: RepriseStatus }) => setRepriseStatusManual(oroId, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['oro', activeCompanyId] }); },
    onError: () => toast.error(t('tradein.errSave')),
  });
  const cancelAnnule = useMutation({
    mutationFn: (o: OroListItem) => cancelReprise(activeCompanyId!, o.id, o.number ?? o.id, o.vehicle_id ?? null),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['oro', activeCompanyId] }); qc.invalidateQueries({ queryKey: ['vehicles'] }); },
    onError: () => toast.error(t('tradein.errSave')),
  });
  const onStatusPick = (o: OroListItem, status: RepriseStatus) => {
    const current = tradeinStatusOf(o as unknown as Record<string, unknown>, o.id, o.vehicle_info);
    if (status === current) return;
    if (status === 'annule') {
      // Annulation SÛRE : sortie de stock si le véhicule était validé (B7).
      if (window.confirm(t('tradein.cancelConfirm'))) cancelAnnule.mutate(o);
      return;
    }
    if (current === 'repris') {
      // Déjà en stock : tout autre changement passe par la fiche (Modifier).
      navigate({ to: '/tradein/$oroId', params: { oroId: o.id } });
      return;
    }
    if (status === 'accepte') {
      // Saisie rapide : montant accepté + miroir de la meilleure offre marchand.
      const st = stats.get(o.id) ?? { count: 0, best: 0 };
      setAcceptFor({ oroId: o.id, vehicleId: o.vehicle_id ?? null, best: st.best > 0 ? { amount: st.best, partnerName: '' } : null });
      return;
    }
    if (status === 'repris') {
      // « Repris » = entrée en stock → passe par la validation (fiche).
      navigate({ to: '/tradein/$oroId', params: { oroId: o.id } });
      return;
    }
    changeStatus.mutate({ oroId: o.id, status }); // collecte / envoye
  };

  // Filtre de recherche : n° REP, client, société, véhicule (insensible aux
  // accents : « societe » retrouve « Société »).
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = norm(search.trim());
  const filtered = (data ?? []).filter((o) => {
    // Filtre statut
    const st = tradeinStatusOf(o as unknown as Record<string, unknown>, o.id, o.vehicle_info);
    if (statusFilter !== 'all' && st !== statusFilter) return false;
    // Filtre plage de dates (date de cr\u00e9ation / d'\u00e9mission de la demande)
    const day = (o.created_at ?? '').slice(0, 10); // AAAA-MM-JJ
    if (dateFrom && day && day < dateFrom) return false;
    if (dateTo && day && day > dateTo) return false;
    // Recherche texte
    if (q) {
      const moto = o.vehicle_info ? [o.vehicle_info.brand, o.vehicle_info.model, o.vehicle_info.model_year].filter(Boolean).join(' ') : '';
      const hay = [o.number, repriseClientLabel(o.client), moto].filter(Boolean).map((s) => norm(String(s))).join(' | ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const hasFilter = !!(q || statusFilter !== 'all' || dateFrom || dateTo);

  return (
    <>
      <PageHeader
        title={t('tradein.title')}
        description={t('tradein.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={dispatchQ.data ?? 'semi_auto'} onValueChange={(v) => setMode.mutate(v as DispatchMode)}>
              <SelectTrigger className="h-9 w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="semi_auto">{t('tradein.dispatch_semi_auto')}</SelectItem>
                <SelectItem value="auto">{t('tradein.dispatch_auto')}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setPartnersOpen(true)}><Store /> {t('tradein.partners')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/tradein/partners' })}><Users /> {t('tradein.partnersManage')}</Button>
          </div>
        }
      />

      {/* Action principale — grande cible tactile (tablette / smartphone) */}
      <Button
        onClick={() => navigate({ to: '/tradein/new' })}
        className="mb-6 h-auto w-full gap-3 py-4 shadow-[var(--shadow-card)] active:scale-[0.99] sm:py-5"
      >
        <Bike className="size-6" />
        <span className="flex flex-col items-center leading-tight">
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] opacity-80 sm:text-[11px]">{t('tradein.formLabel')}</span>
          <span className="text-[17px] font-bold uppercase tracking-[0.03em] sm:text-[19px]">{t('tradein.newMoto')}</span>
        </span>
      </Button>

      {/* Recherche : n° REP, client, société, véhicule */}
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('tradein.searchPlaceholder')} />
      </div>

      {/* Filtres : par statut + par plage de dates (De … à …) */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.filterStatus')}</label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as RepriseStatus | 'all')}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('tradein.filterAllStatuses')}</SelectItem>
              {REPRISE_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`tradein.rstatus_${s}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.filterDateFrom')}</label>
          <Input type="date" className="h-9 w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.filterDateTo')}</label>
          <Input type="date" className="h-9 w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        {hasFilter && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatusFilter('all'); setDateFrom(''); setDateTo(''); }}>
            <X className="size-4" /> {t('tradein.filterReset')}
          </Button>
        )}
      </div>

      {/* Reprises en cours */}
      <h2 className="mb-2 font-ui text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.ongoing')}</h2>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('tradein.colNumber')}</Th>
              <Th>{t('tradein.colCreated')}</Th>
              <Th>{t('tradein.colClient')}</Th>
              <Th>{t('tradein.colMoto')}</Th>
              <Th>{t('tradein.colStatus')}</Th>
              <Th className="text-center">{t('tradein.colOffers')}</Th>
              <Th className="text-right">{t('tradein.colBest')}</Th>
              <Th className="w-20 text-center">{t('tradein.pdfSheet')}</Th>
              <Th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={9} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && filtered.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">{hasFilter ? t('tradein.searchEmpty') : t('tradein.empty')}</td></tr>}
            {filtered.map((o) => {
              const st = stats.get(o.id) ?? { count: 0, best: 0 };
              const moto = o.vehicle_info
                ? [o.vehicle_info.brand, o.vehicle_info.model, o.vehicle_info.model_year ? `(${o.vehicle_info.model_year})` : null].filter(Boolean).join(' ')
                : '—';
              const tStatus = tradeinStatusOf(o as unknown as Record<string, unknown>, o.id, o.vehicle_info);
              const followUp = tStatus === 'collecte' && needsFollowUp(o.created_at, st.count, o.status);
              const changedAt = statusChangedAt(readValidationMeta(o as unknown as Record<string, unknown>, o.id), o.created_at, tStatus);
              return (
                <tr key={o.id} onClick={() => navigate({ to: '/tradein/$oroId', params: { oroId: o.id } })} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                  <td className="px-3 py-3 font-mono text-[12px]">
                    <span className="underline decoration-dotted underline-offset-2">{o.number ?? '—'}</span>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-muted-foreground">{fmtDate(o.created_at)}</td>
                  <td className="px-3 py-3 font-medium">{repriseClientLabel(o.client)}</td>
                  <td className="px-3 py-3">{moto}</td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {/* Fond doux par statut ; Accepté = pastille verte (pré-accord) */}
                      <span className="relative inline-block">
                        {tStatus === 'accepte' && (
                          <span className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-2.5 -translate-y-1/2 rounded-full bg-success" aria-hidden />
                        )}
                        <Select value={tStatus} onValueChange={(v) => onStatusPick(o, v as RepriseStatus)}>
                          <SelectTrigger
                            className={`h-8 w-[150px] ${REPRISE_STATUS_FIELD_BG[tStatus]} ${tStatus === 'accepte' ? 'pl-6' : ''}`}
                            title={t('tradein.statusChange')}
                          ><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {REPRISE_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>{t(`tradein.rstatus_${s}`)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </span>
                      {/* Date + heure du changement de statut (grisé) */}
                      {changedAt && <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{fmtDateTime(changedAt)}</span>}
                      {followUp && <StatusBadge tone="danger" icon={BellRing} label={t('tradein.followUp')} />}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {st.count > 0
                      ? <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-[var(--ducati-red-tint)] px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-[var(--ducati-red)]">{st.count}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-bold tabular-nums">{st.best > 0 ? eur(st.best) : '—'}</td>
                  <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" title={t('tradein.wizDoneSheet')} onClick={() => printSheet(o.id)}>
                      <FileDown className="size-4" />
                    </Button>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground"><ChevronRight className="size-4" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {activeCompanyId && <PartnersDialog open={partnersOpen} onOpenChange={setPartnersOpen} companyId={activeCompanyId} />}
      {acceptFor && (
        <AcceptOfferDialog
          open onOpenChange={(o) => { if (!o) setAcceptFor(null); }}
          oroId={acceptFor.oroId} vehicleId={acceptFor.vehicleId} best={acceptFor.best}
          onDone={() => { setAcceptFor(null); qc.invalidateQueries({ queryKey: ['oro', activeCompanyId] }); }}
        />
      )}
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
