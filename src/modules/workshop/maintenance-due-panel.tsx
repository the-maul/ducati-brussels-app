/**
 * M3 / M8 — « Prochain entretien » sur la fiche moto (mission 07, cartes 4, 5, 6).
 *
 * Trois choses, dans cet ordre d'importance :
 *  1. l'entretien dû, au premier atteint (km ou mois), avec sa date ou son km
 *     prévisionnel, le temps officiel Ducati et le devis estimé ;
 *  2. le kilométrage, modifiable ici : c'est la donnée qui manque le plus ;
 *  3. les entretiens connus de la moto — sans eux l'échéance reste une estimation.
 *
 * Aucune règle n'est recalculée dans l'écran : tout vient de
 * `maintenance_due_for_vehicle` et `maintenance_estimate_for_vehicle`.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Euro, Info, Loader2, Plus, Timer, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/lib/i18n';
import { fill, fmtInt, fmtMoney } from '@/modules/catalog/format';
import { fmtDate, fmtKm, fmtMinutes } from './maintenance-due';
import {
  addServiceHistory, createMaintenanceAppointment, deleteServiceHistory, getServiceEstimate,
  getVehicleDue, listDeclarableServices, listServiceHistory, setVehicleMileage,
  type ServiceEstimate, type VehicleDueService,
} from './maintenance-due-api';
import {
  ConfidenceBadge, DueBadge, DueDetail, OfficialTime, SourceLabel, dueLabel,
} from './maintenance-due-view';

type VehicleLike = {
  id: string;
  ducati_model_year_id?: string | null;
  mileage?: number | null;
  brand?: string | null;
  model?: string | null;
};

export function MaintenanceDuePanel({ vehicle }: { vehicle: VehicleLike }) {
  const qc = useQueryClient();
  const vid = vehicle.id;
  const due = useQuery({ queryKey: ['due', 'vehicle', vid], queryFn: () => getVehicleDue(vid) });
  const [rdvFor, setRdvFor] = useState<VehicleDueService | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['due'] });
    qc.invalidateQueries({ queryKey: ['vehicle', vid] });
  };

  if (!vehicle.ducati_model_year_id) {
    return <Note>{t('maintenanceDue.panelNoLink')}</Note>;
  }
  if (due.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (due.error) return <p className="text-sm text-danger">{t('maintenanceDue.loadErr')}</p>;

  const d = due.data!;
  const services = d.services ?? [];
  const next = services[0] ?? null;

  return (
    <div className="space-y-4">
      <MileageRow vehicleId={vid} mileage={d.mileage} onSaved={invalidate} />

      {!services.length ? (
        <Note>{d.mileage == null || d.mileage <= 0 ? t('maintenanceDue.panelNoKm') : t('maintenanceDue.panelNoProgram')}</Note>
      ) : (
        <>
          {/* L'entretien dû, mis en avant */}
          <div className="rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="font-semibold">{next!.label}</span>
              <DueBadge due={next!} />
              <ConfidenceBadge confidence={next!.confidence} />
              <span className="ml-auto"><SourceLabel source={next!.source} /></span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="tabular-nums font-medium">{dueLabel(next!)}</span>
              <OfficialTime ut={next!.ut} />
            </div>
            <div className="mt-1"><DueDetail due={next!} /></div>
            {next!.confidence === 'estime' && (
              <p className="mt-2 text-[12px] text-muted-foreground">{t('maintenanceDue.confEstimeHint')}</p>
            )}
            <div className="mt-3">
              <EstimateBlock vehicleId={vid} serviceCode={next!.code} onRdv={() => setRdvFor(next!)} />
            </div>
          </div>

          {/* Toutes les échéances */}
          {services.length > 1 && (
            <section className="space-y-1.5">
              <h4 className="font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                {t('maintenanceDue.panelAllServices')}
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('maintenanceDue.colService')}</TableHead>
                    <TableHead>{t('maintenanceDue.colDue')}</TableHead>
                    <TableHead>{t('maintenanceDue.colTime')}</TableHead>
                    <TableHead>{t('maintenanceDue.colState')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((s) => (
                    <TableRow key={s.code}>
                      <TableCell className="font-medium">{s.label}</TableCell>
                      <TableCell className="tabular-nums">
                        {dueLabel(s)}
                        <div><DueDetail due={s} /></div>
                      </TableCell>
                      <TableCell><OfficialTime ut={s.ut} /></TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <DueBadge due={s} />
                          <ConfidenceBadge confidence={s.confidence} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => setRdvFor(s)}>
                          <CalendarPlus /> {t('maintenanceDue.rdvBtn')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </>
      )}

      <HistoryBlock vehicleId={vid} modelYearId={vehicle.ducati_model_year_id}
        open={addOpen} setOpen={setAddOpen} onChanged={invalidate} />

      {rdvFor && (
        <RdvDialog vehicleId={vid} service={rdvFor} onClose={() => setRdvFor(null)} onCreated={invalidate} />
      )}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {children}
    </p>
  );
}

/** Le kilométrage, modifiable ici : sans lui rien n'est calculable. */
function MileageRow({ vehicleId, mileage, onSaved }: { vehicleId: string; mileage: number | null; onSaved: () => void }) {
  const [km, setKm] = useState(mileage != null && mileage > 0 ? String(mileage) : '');
  const save = useMutation({
    mutationFn: () => setVehicleMileage(vehicleId, Number(km)),
    onSuccess: () => { toast.success(t('maintenanceDue.panelKmSaved')); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('maintenanceDue.saveErr')),
  });
  const n = Number(km);
  const valid = km.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 2_000_000;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-40 space-y-1">
        <Label htmlFor="due-km">{t('maintenanceDue.panelKm')}</Label>
        <Input id="due-km" type="number" inputMode="numeric" min={0} max={2000000}
          className="tabular-nums" value={km} onChange={(e) => setKm(e.target.value)} />
      </div>
      <Button variant="outline" disabled={!valid || save.isPending || n === (mileage ?? -1)}
        onClick={() => save.mutate()}>
        {save.isPending ? <Loader2 className="animate-spin" /> : null} {t('maintenanceDue.panelKmSave')}
      </Button>
    </div>
  );
}

/** Devis estimé : main-d'œuvre (temps officiel × taux HT) + pièces du kit. */
function EstimateBlock({ vehicleId, serviceCode, onRdv }: { vehicleId: string; serviceCode: string; onRdv: () => void }) {
  const est = useQuery({
    queryKey: ['due', 'estimate', vehicleId, serviceCode],
    queryFn: () => getServiceEstimate(vehicleId, serviceCode),
  });
  if (est.isLoading) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  const e = est.data;
  if (!e || !e.found) return null;
  return (
    <div className="space-y-2">
      <EstimateSummary estimate={e} />
      <Button onClick={onRdv}><CalendarPlus /> {t('maintenanceDue.rdvBtn')}</Button>
    </div>
  );
}

/** Le détail chiffré d'une estimation, réutilisé par la fenêtre de RDV. */
export function EstimateSummary({ estimate: e }: { estimate: ServiceEstimate }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Euro className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
          {t('maintenanceDue.estimateTitle')}
        </span>
        <span className="ml-auto text-[12px] text-muted-foreground">
          {e.complete ? t('maintenanceDue.estimateComplete') : t('maintenanceDue.estimatePartial')}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-muted-foreground">{t('maintenanceDue.estimateTime')}</dt>
        <dd className="tabular-nums">
          {e.minutes != null ? fmtMinutes(e.minutes) : '—'}
          {e.ut != null && <span className="ml-1 text-[12px] text-muted-foreground">({fill(t('maintenanceDue.estimateUt'), { ut: String(e.ut) })})</span>}
        </dd>
        <dt className="text-muted-foreground">{t('maintenanceDue.estimateLabour')}</dt>
        <dd className="tabular-nums">{e.labourHt != null ? fmtMoney(e.labourHt) : '—'}</dd>
        <dt className="text-muted-foreground">{t('maintenanceDue.estimateParts')}</dt>
        <dd className="tabular-nums">{e.kitId ? fmtMoney(e.partsHt ?? 0) : '—'}</dd>
        <dt className="font-medium">{t('maintenanceDue.estimateTotal')}</dt>
        <dd className="font-data font-bold tabular-nums">{fmtMoney(e.totalHt ?? 0)}</dd>
      </dl>
      {e.parts && e.parts.length > 0 && (
        <ul className="space-y-0.5 text-[12px] text-muted-foreground">
          {e.parts.map((p, i) => (
            <li key={`${p.reference ?? p.designation}-${i}`} className="tabular-nums">
              {fmtInt(p.quantity)}{p.unit ? ` ${p.unit}` : '×'} {p.designation}
              {p.reference && <span className="ml-1 font-data">{p.reference}</span>}
              {p.priced ? <span className="ml-1">{fmtMoney(p.lineHt)}</span> : <span className="ml-1 text-warning">—</span>}
            </li>
          ))}
        </ul>
      )}
      {e.minutes == null && <p className="text-[12px] text-warning">{t('maintenanceDue.estimateNoUt')}</p>}
      {e.hourlyRateHt == null && <p className="text-[12px] text-warning">{t('maintenanceDue.estimateNoRate')}</p>}
      {!e.kitId && <p className="text-[12px] text-warning">{t('maintenanceDue.estimateNoKit')}</p>}
      {!!e.partsWithoutPrice && (
        <p className="text-[12px] text-warning">{fill(t('maintenanceDue.estimatePartsMissing'), { n: String(e.partsWithoutPrice) })}</p>
      )}
      <p className="text-[12px] text-muted-foreground">{t('maintenanceDue.estimateNotInvoiced')}</p>
    </div>
  );
}

/** Poser le RDV au planning existant, avec le temps officiel bloqué (carte 6). */
export function RdvDialog({
  vehicleId, service, onClose, onCreated,
}: {
  vehicleId: string;
  service: { code: string; label: string; ut: number | null };
  onClose: () => void;
  onCreated: () => void;
}) {
  const [when, setWhen] = useState('');
  const [mechanic, setMechanic] = useState('');
  const [notes, setNotes] = useState('');
  const est = useQuery({
    queryKey: ['due', 'estimate', vehicleId, service.code],
    queryFn: () => getServiceEstimate(vehicleId, service.code),
  });
  const minutes = est.data?.minutes ?? 60;

  const create = useMutation({
    mutationFn: () => createMaintenanceAppointment({
      vehicleId, startsAt: new Date(when).toISOString(), serviceCode: service.code,
      mechanic, notes,
    }),
    onSuccess: () => { toast.success(t('maintenanceDue.rdvCreated')); onCreated(); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('maintenanceDue.saveErr')),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('maintenanceDue.rdvTitle')}</DialogTitle>
          <DialogDescription>{service.label}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="inline-flex items-center gap-1.5 text-sm tabular-nums">
            <Timer className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {fill(t('maintenanceDue.rdvBlocked'), { minutes: fmtMinutes(minutes) })}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="rdv-when">{t('maintenanceDue.rdvWhen')}</Label>
            <Input id="rdv-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rdv-mec">{t('maintenanceDue.rdvMechanic')}</Label>
            <Input id="rdv-mec" value={mechanic} onChange={(e) => setMechanic(e.target.value)} maxLength={80} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rdv-note">{t('maintenanceDue.rdvNotes')}</Label>
            <Textarea id="rdv-note" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
          </div>
          {est.data?.found && <EstimateSummary estimate={est.data} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.no')}</Button>
          <Button disabled={!when || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <CalendarPlus />} {t('maintenanceDue.rdvCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Les entretiens connus de la moto : la clé pour passer d'« estimation » à « exact ». */
function HistoryBlock({
  vehicleId, modelYearId, open, setOpen, onChanged,
}: {
  vehicleId: string; modelYearId: string | null | undefined;
  open: boolean; setOpen: (v: boolean) => void; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const hist = useQuery({ queryKey: ['due', 'history', vehicleId], queryFn: () => listServiceHistory(vehicleId) });
  const choices = useQuery({
    queryKey: ['due', 'declarable', modelYearId ?? null],
    queryFn: () => listDeclarableServices(modelYearId ?? null),
  });

  const [label, setLabel] = useState('');
  const [km, setKm] = useState('');
  const [date, setDate] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => addServiceHistory({
      vehicleId, label, km: km.trim() ? Number(km) : null, date: date.trim() || null,
    }),
    onSuccess: () => {
      toast.success(t('maintenanceDue.panelHistoryAdded'));
      setOpen(false); setLabel(''); setKm(''); setDate(''); setErr(null);
      qc.invalidateQueries({ queryKey: ['due'] }); onChanged();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : t('maintenanceDue.saveErr')),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteServiceHistory(id),
    onSuccess: () => {
      toast.success(t('maintenanceDue.panelHistoryDeleted'));
      qc.invalidateQueries({ queryKey: ['due'] }); onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('maintenanceDue.saveErr')),
  });

  const rows = hist.data ?? [];
  return (
    <section className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
          {t('maintenanceDue.panelHistory')}
        </h4>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus /> {t('maintenanceDue.panelAddHistory')}
        </Button>
      </div>
      {!rows.length ? (
        <p className="text-sm text-muted-foreground">{t('maintenanceDue.panelHistoryEmpty')}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.service_label}</span>
              <span className="tabular-nums text-muted-foreground">
                {[r.km != null ? fmtKm(r.km) : null, r.event_date ? fmtDate(r.event_date) : null].filter(Boolean).join(' · ')}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {t(`maintenanceDue.panelHistorySource_${r.source}`)}
              </span>
              <Button variant="ghost" size="sm" className="ml-auto" disabled={del.isPending}
                onClick={() => del.mutate(r.id)} aria-label={t('maintenanceDue.panelHistoryDeleted')}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('maintenanceDue.panelAddHistory')}</DialogTitle>
            <DialogDescription>{t('motoMaintenance.servicesHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t('maintenanceDue.histService')}</Label>
              <Select value={label} onValueChange={setLabel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(choices.data ?? []).map((c) => (
                    <SelectItem key={c.family} value={c.label}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hist-km">{t('maintenanceDue.histKm')}</Label>
                <Input id="hist-km" type="number" inputMode="numeric" min={0} max={2000000}
                  className="tabular-nums" value={km} onChange={(e) => setKm(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hist-date">{t('maintenanceDue.histDate')}</Label>
                <Input id="hist-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            {err && <p className="text-sm text-danger">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.no')}</Button>
            <Button disabled={!label || (!km.trim() && !date.trim()) || add.isPending}
              onClick={() => { setErr(null); if (!km.trim() && !date.trim()) { setErr(t('maintenanceDue.histNeedOne')); return; } add.mutate(); }}>
              {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('maintenanceDue.panelAddHistory')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Les entretiens dus des motos d'un client, sur la fiche client (carte 4). */
export function ContactMaintenanceDuePanel({ rows }: {
  rows: { vehicleId: string; label: string; vin: string | null; plate: string | null; mileage: number | null; next: VehicleDueService | null }[];
}) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t('maintenanceDue.contactEmpty')}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('maintenanceDue.colVehicle')}</TableHead>
          <TableHead>{t('maintenanceDue.colService')}</TableHead>
          <TableHead>{t('maintenanceDue.colDue')}</TableHead>
          <TableHead>{t('maintenanceDue.colState')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.vehicleId}>
            <TableCell>
              <Link to="/vehicles/$vehicleId" params={{ vehicleId: r.vehicleId }} className="font-medium text-primary hover:underline">
                {r.label || r.vin || r.plate || '—'}
              </Link>
              <div className="tabular-nums text-[12px] text-muted-foreground">
                {r.mileage != null && r.mileage > 0 ? fmtKm(r.mileage) : t('maintenanceDue.kpiMissingKm')}
              </div>
            </TableCell>
            <TableCell>{r.next ? r.next.label : <span className="text-muted-foreground">{t('maintenanceDue.contactNoDue')}</span>}</TableCell>
            <TableCell className="tabular-nums">
              {r.next ? dueLabel(r.next) : '—'}
              {r.next && <div><DueDetail due={r.next} /></div>}
            </TableCell>
            <TableCell>
              {r.next && (
                <div className="flex flex-wrap gap-1">
                  <DueBadge due={r.next} />
                  <ConfidenceBadge confidence={r.next.confidence} />
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
