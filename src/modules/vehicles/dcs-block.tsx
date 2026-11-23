/**
 * Bloc « Données DCS » en tête de la fiche moto (VEH001, retour de Simon du 23/11/2026) : tout ce
 * qui a été lu, en trois colonnes comme le portail, avec son statut. Chaque écart se tranche en un
 * clic, le client lu peut être attribué ou créé. Rien n'est écrit sans clic.
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, CheckCircle2, FileCheck2, History, Loader2, ShieldCheck, UserCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { fillVars, t } from '@/lib/i18n';
import { translateDbError } from '@/lib/db-error-i18n';
import type { DcsFieldStatus } from '@/lib/dcs-rules';
import { canAskDcs, DcsUpdateButton } from './dcs-update';
import {
  attachDcsClient, createDcsClient, loadDcsBlock, loadDcsMatches, loadDcsModelCandidates, resolveDcsField,
  type DcsMatch, type DcsResolveInput,
} from './dcs-block-api';
import {
  dcsBlockColumns, dcsCatalogFields, dcsClientSituation, dcsModelChoices, dcsOpenConflicts, isDcsResolvable,
  type DcsBlockRow, type DcsFieldRow,
} from './dcs-block-rules';
import type { Vehicle } from './api';

type OwnerLike = { contact_id?: string | null; is_current?: boolean | null; contact?: { first_name?: string | null; last_name?: string | null; company_name?: string | null } | null };

const STATUS_BADGE: Record<DcsFieldStatus, { tone: StatusTone; label: string; icon: typeof CheckCircle2 }> = {
  certifie: { tone: 'success', label: 'dossier.dcsBlockStCertified', icon: ShieldCheck },
  conflit: { tone: 'warning', label: 'dossier.dcsBlockStConflict', icon: AlertTriangle },
  saisi: { tone: 'info', label: 'dossier.dcsBlockStKept', icon: UserCheck },
  catalogue: { tone: 'info', label: 'dossier.dcsBlockStCatalog', icon: BookOpen },
  carte_grise: { tone: 'info', label: 'dossier.dcsBlockStCard', icon: FileCheck2 },
};

const CATALOG_LABEL: Record<string, string> = {
  antipollution: 'vehicles.antipollution', energy: 'vehicles.energy', power_cv: 'vehicles.powerCv', power_kw: 'vehicles.powerKw',
  cylinders: 'vehicles.cylinders', displacement: 'vehicles.displacement', category: 'vehicles.category', model_year: 'vehicles.modelYear',
};
const REASON_LABEL: Record<DcsMatch['reasons'][number], string> = {
  code: 'dossier.dcsBlockReasonCode', email: 'dossier.dcsBlockReasonEmail', phone: 'dossier.dcsBlockReasonPhone', name: 'dossier.dcsBlockReasonName',
};

const fmtDate = (v: string | null) => {
  if (!v) return '—';
  const d = new Date(`${v.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('fr-BE');
};
const fmtValue = (r: Pick<DcsBlockRow, 'kind'>, v: string | null) => {
  if (v === null || v === '') return '—';
  if (r.kind === 'date') return fmtDate(v);
  if (r.kind === 'km') return `${Number(v).toLocaleString('fr-BE')} km`;
  return v;
};

/** Message d'échec d'un clic, dans la langue de l'écran. */
function dcsActionError(e: unknown): string {
  const err = e as { message?: string; code?: string; hint?: string } | null;
  const message = err?.message ?? '';
  if (err?.code === 'PGRST202') return t('dossier.dcsBlockUnavailable');
  if (message.includes('dcs_stale')) return t('dossier.dcsBlockStale');
  if (err?.hint === 'dcs_plate_length') return t('dossier.dcsBlockPlateErr');
  return translateDbError(e) ?? t('dossier.dcsBlockErr');
}

export function DcsBlock({ vehicle, companyId, owners, onOpenHistory }: {
  vehicle: Vehicle;
  companyId: string;
  owners: OwnerLike[] | undefined;
  onOpenHistory: () => void;
}) {
  const qc = useQueryClient();
  const v = vehicle as unknown as Record<string, unknown>;
  const q = useQuery({ queryKey: ['vehicle-dcs', vehicle.id], queryFn: () => loadDcsBlock(vehicle.id) });
  const [busy, setBusy] = useState<string | null>(null);
  const [lowerKm, setLowerKm] = useState<string | null>(null);

  const syncedAt = (v.my_ducati_synced_at as string | null) ?? null;
  const statuses = q.data?.statuses ?? [];
  const client = q.data?.client ?? null;
  const byField = new Map(statuses.map((s) => [s.field, s]));
  const current = owners?.find((o) => o.is_current) ?? null;
  const currentOwnerId = current?.contact_id ?? null;
  const c = current?.contact;
  const ownerName = c ? (c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || null) : null;
  const columns = dcsBlockColumns(v, statuses, client, ownerName);
  const conflicts = dcsOpenConflicts(statuses);
  const catalog = dcsCatalogFields(statuses);
  const modelStatus = byField.get('model');
  const yearStatus = byField.get('ducati_model_year_id');
  const needsCandidates = modelStatus?.status === 'conflit' && !!yearStatus?.dcs_value;

  const candidatesQ = useQuery({
    queryKey: ['vehicle-dcs-candidates', vehicle.vin],
    queryFn: () => loadDcsModelCandidates(vehicle.vin as string),
    enabled: needsCandidates && !!vehicle.vin, staleTime: 300_000,
  });
  const choices = dcsModelChoices(yearStatus, candidatesQ.data ?? []);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['vehicle-dcs', vehicle.id] });
    void qc.invalidateQueries({ queryKey: ['vehicle-dcs-matches', vehicle.id] });
    void qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
    void qc.invalidateQueries({ queryKey: ['vehicle-owners', vehicle.id] });
    void qc.invalidateQueries({ queryKey: ['vehicles'] });
  };

  const resolve = async (input: Omit<DcsResolveInput, 'companyId' | 'vehicleId'>, id: string) => {
    setBusy(id);
    try {
      await resolveDcsField({ ...input, companyId, vehicleId: vehicle.id });
      setLowerKm(null);
      toast.success(t('dossier.dcsBlockDone'));
      refresh();
    } catch (e) {
      if ((e as { hint?: string } | null)?.hint === 'mileage_lower') setLowerKm(translateDbError(e) ?? t('dossier.dcsBlockErr'));
      else toast.error(dcsActionError(e));
    } finally {
      setBusy(null);
    }
  };

  if (!syncedAt && statuses.length === 0) {
    return (
      <section aria-label={t('dossier.dcsBlockTitle')} className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <h2 className="font-ui text-[15px] font-bold">{t('dossier.dcsBlockTitle')}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{t(canAskDcs(vehicle.vin) ? 'dossier.dcsBlockEmpty' : 'dossier.dcsBlockEmptyNoVin')}</p>
        <div className="mt-3"><DcsUpdateButton vin={vehicle.vin} syncedAt={null} size="sm" /></div>
      </section>
    );
  }

  const renderRow = (r: DcsBlockRow) => {
    const conflict = r.status === 'conflit' && isDcsResolvable(r.key);
    return (
      <div key={r.key} className="border-b border-border py-1.5 last:border-0">
        <div className="flex items-start justify-between gap-2">
          <span className="pt-0.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(r.labelKey)}</span>
          {r.status && <RowBadge status={r.status} />}
        </div>
        {!conflict && <p className={`break-words text-[13px] ${r.kind === 'mono' ? 'font-mono' : ''} ${r.kind === 'km' ? 'tabular-nums' : ''}`}>{fmtValue(r, r.value)}</p>}
        {r.status === 'saisi' && r.sheet !== null && r.sheet !== r.value && (
          <p className="break-words text-[12px] text-muted-foreground">{t('dossier.dcsBlockOnSheet')} {fmtValue(r, r.sheet)}</p>
        )}
        {conflict && r.key !== 'owner' && (
          <ConflictBox row={r}>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={!!busy}
                onClick={() => void resolve({ field: r.key, choice: 'keep', seen: r.sheet }, `${r.key}:keep`)}>
                {busy === `${r.key}:keep` ? <Loader2 className="animate-spin" /> : null} {t('dossier.dcsBlockKeep')}
              </Button>
              {r.key === 'model' && needsCandidates ? (
                <div className="w-full space-y-1">
                  <p className="text-[12px] text-muted-foreground">{t('dossier.dcsBlockPickModel')}</p>
                  {candidatesQ.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                  <div className="flex flex-wrap gap-2">
                    {choices.map((m) => (
                      <Button key={m.id} type="button" size="sm" variant="outline" disabled={!!busy}
                        onClick={() => void resolve({ field: 'model', choice: 'dcs', seen: r.sheet, candidate: m.id, modelLabel: m.label }, `model:${m.id}`)}>
                        {busy === `model:${m.id}` ? <Loader2 className="animate-spin" /> : null} {m.label}{m.year ? ` (${m.year})` : ''}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <Button type="button" size="sm" variant="outline" disabled={!!busy}
                  onClick={() => void resolve({ field: r.key, choice: 'dcs', seen: r.sheet }, `${r.key}:dcs`)}>
                  {busy === `${r.key}:dcs` ? <Loader2 className="animate-spin" /> : null} {t('dossier.dcsBlockTake')}
                </Button>
              )}
            </div>
            {r.key === 'mileage' && lowerKm && (
              <div className="mt-2 space-y-1">
                <p role="alert" className="text-[12px] font-medium text-warning">{lowerKm}</p>
                <Button type="button" size="sm" variant="outline" disabled={!!busy}
                  onClick={() => void resolve({ field: 'mileage', choice: 'dcs', seen: r.sheet, forceLower: true }, 'mileage:force')}>
                  {busy === 'mileage:force' ? <Loader2 className="animate-spin" /> : null} {t('dossier.dcsBlockForce')}
                </Button>
              </div>
            )}
          </ConflictBox>
        )}
        {conflict && r.key === 'owner' && <ConflictBox row={r} />}
      </div>
    );
  };

  return (
    <section aria-label={t('dossier.dcsBlockTitle')} className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="font-ui text-[15px] font-bold">{t('dossier.dcsBlockTitle')}</h2>
        {syncedAt && <span className="text-[12px] text-muted-foreground">{fillVars(t('dossier.dcsBlockReadAt'), { date: new Date(syncedAt).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) })}</span>}
        {conflicts > 0
          ? <StatusBadge tone="warning" icon={AlertTriangle} label={fillVars(t('dossier.dcsBlockConflicts'), { n: conflicts })} />
          : <StatusBadge tone="success" icon={CheckCircle2} label={t('dossier.dcsBlockNoConflict')} />}
        <span className="ml-auto flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onOpenHistory}>
            <History /> {fillVars(t('dossier.dcsBlockEvents'), { n: q.data?.events ?? 0 })}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onOpenHistory}>
            <FileCheck2 /> {fillVars(t('dossier.dcsBlockBulletins'), { n: q.data?.bulletins ?? 0 })}
          </Button>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Column title={t('dossier.dcsBlockColMoto')}>{columns.moto.map(renderRow)}</Column>
        <Column title={t('dossier.dcsBlockColWarranty')}>{columns.warranty.map(renderRow)}</Column>
        <Column title={t('dossier.dcsBlockColClient')}>
          {columns.client.map(renderRow)}
          <ClientActions
            companyId={companyId} vehicleId={vehicle.id} hasClient={!!client} ownerName={ownerName}
            situation={dcsClientSituation(client, byField.get('owner'), currentOwnerId)}
            ownerStatus={byField.get('owner')} onChanged={refresh}
            onKeep={() => void resolve({ field: 'owner', choice: 'keep' }, 'owner:keep')} busy={busy === 'owner:keep'}
          />
        </Column>
      </div>

      {catalog.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-[12px] text-muted-foreground">
          <BookOpen className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
          {fillVars(t('dossier.dcsBlockCatalogFilled'), { fields: catalog.map((f) => (CATALOG_LABEL[f] ? t(CATALOG_LABEL[f]) : f)).join(', ') })}
        </p>
      )}
    </section>
  );
}

function RowBadge({ status }: { status: DcsFieldStatus }) {
  const b = STATUS_BADGE[status];
  return <StatusBadge tone={b.tone} icon={b.icon} label={t(b.label)} className="shrink-0 text-[10px]" />;
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border p-3">
      <h3 className="mb-1 font-ui text-[13px] font-bold">{title}</h3>
      {children}
    </div>
  );
}

/** Les deux valeurs en orange, côte à côte. */
function ConflictBox({ row, children }: { row: DcsBlockRow; children?: ReactNode }) {
  return (
    <div className="mt-1 space-y-2 rounded-md border border-warning/40 bg-warning-bg p-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[13px]">
        <dt className="text-muted-foreground">{t('dossier.dcsBlockOnSheet')}</dt>
        <dd className="break-words font-medium text-warning">{fmtValue(row, row.sheet)}</dd>
        <dt className="text-muted-foreground">{t('dossier.dcsBlockOnDcs')}</dt>
        <dd className="break-words font-medium text-warning">{fmtValue(row, row.value)}</dd>
      </dl>
      {children}
    </div>
  );
}

function ClientActions({ companyId, vehicleId, hasClient, ownerName, situation, ownerStatus, onChanged, onKeep, busy }: {
  companyId: string; vehicleId: string; hasClient: boolean; ownerName: string | null;
  situation: ReturnType<typeof dcsClientSituation>; ownerStatus: DcsFieldRow | undefined;
  onChanged: () => void; onKeep: () => void; busy: boolean;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const [confirmDup, setConfirmDup] = useState(false);
  const offer = situation === 'no_owner' || situation === 'other';
  const matchesQ = useQuery({
    queryKey: ['vehicle-dcs-matches', vehicleId],
    queryFn: () => loadDcsMatches(companyId, vehicleId),
    enabled: hasClient && offer,
  });
  const matches = matchesQ.data ?? [];

  const attach = async (id: string) => {
    setWorking(id);
    try {
      await attachDcsClient(companyId, vehicleId, id);
      toast.success(t('dossier.dcsBlockAttached'));
      onChanged();
    } catch (e) { toast.error(dcsActionError(e)); } finally { setWorking(null); }
  };
  const create = async (force: boolean) => {
    setWorking('create');
    try {
      await createDcsClient(companyId, vehicleId, force);
      setConfirmDup(false);
      toast.success(t('dossier.dcsBlockCreated'));
      onChanged();
    } catch (e) {
      if ((e as { hint?: string } | null)?.hint === 'dcs_possible_duplicate') setConfirmDup(true);
      else toast.error(dcsActionError(e));
    } finally { setWorking(null); }
  };

  if (situation === 'none') {
    return (
      <div className="space-y-2 py-1.5">
        <p className="text-[12px] text-muted-foreground">{t('dossier.dcsBlockClientNone')}</p>
        {ownerStatus?.status === 'conflit' && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onKeep}>
            {busy ? <Loader2 className="animate-spin" /> : null} {t('dossier.dcsBlockKeep')}
          </Button>
        )}
      </div>
    );
  }
  if (situation === 'same') return <p className="flex items-center gap-1 pt-2 text-[12px] font-medium text-success"><CheckCircle2 className="size-3.5" aria-hidden />{t('dossier.dcsBlockClientSame')}</p>;
  if (situation === 'settled') return <p className="flex items-center gap-1 pt-2 text-[12px] font-medium text-info"><UserCheck className="size-3.5" aria-hidden />{t('dossier.dcsBlockClientSettled')}</p>;

  return (
    <div className="space-y-2 pt-2">
      <p className="text-[12px] text-muted-foreground">
        {situation === 'no_owner' ? t('dossier.dcsBlockClientNoOwner') : fillVars(t('dossier.dcsBlockClientOther'), { name: ownerName ?? '—' })}
      </p>
      {matchesQ.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {matches.length > 0 && (
        <div className="space-y-1">
          <p className="text-[12px] font-medium">{t('dossier.dcsBlockMatches')}</p>
          <ul className="space-y-1">
            {matches.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1 text-[12px]">
                <span className="font-medium">{m.name ?? '—'}</span>
                {m.code && <span className="font-mono text-muted-foreground">{m.code}</span>}
                {m.city && <span className="text-muted-foreground">{m.city}</span>}
                <span className="text-muted-foreground">{m.reasons.map((x) => t(REASON_LABEL[x])).join(', ')}</span>
                {!m.is_active && <StatusBadge tone="neutral" label={t('dossier.dcsBlockInactive')} />}
                <span className="ml-auto">
                  {m.is_owner
                    ? <StatusBadge tone="success" icon={UserCheck} label={t('dossier.dcsBlockAlreadyOwner')} />
                    : (
                      <Button type="button" size="sm" variant="outline" disabled={!!working} onClick={() => void attach(m.id)}>
                        {working === m.id ? <Loader2 className="animate-spin" /> : <UserCheck />} {t('dossier.dcsBlockAttach')}
                      </Button>
                    )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {confirmDup ? (
        <div role="alert" className="space-y-2 rounded-md border border-warning/40 bg-warning-bg p-2">
          <p className="flex items-start gap-1 text-[12px] font-medium text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {fillVars(t('dossier.dcsBlockDupWarn'), { n: matches.length })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={!!working} onClick={() => void create(true)}>
              {working === 'create' ? <Loader2 className="animate-spin" /> : <UserPlus />} {t('dossier.dcsBlockCreateAnyway')}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={!!working} onClick={() => setConfirmDup(false)}>{t('dossier.dcsBlockCancel')}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!!working || matchesQ.isLoading} onClick={() => void create(false)}>
            {working === 'create' ? <Loader2 className="animate-spin" /> : <UserPlus />} {t('dossier.dcsBlockCreate')}
          </Button>
          {ownerStatus?.status === 'conflit' && (
            <Button type="button" size="sm" variant="outline" disabled={busy || !!working} onClick={onKeep}>
              {busy ? <Loader2 className="animate-spin" /> : null} {t('dossier.dcsBlockKeep')}
            </Button>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{t('dossier.dcsBlockConsentNote')}</p>
    </div>
  );
}
