/**
 * Parametres → Postes et peripheriques (PDV030, decision de Simon du 03/11/2026 : « permettre de
 * connecter n'importe quel device pour chaque besoin »). Admin uniquement (garde de _app.settings).
 *  - « Ce poste est : ... » : poste du navigateur courant, memorise localement ;
 *  - reglage de la societe : largeur du ticket, impression automatique, tiroir sur especes, pied ;
 *  - postes (caisse 1, comptoir atelier, tablette...) et, par poste, un appareil par role avec son
 *    type de connexion, ses reglages (IP, HTTPS, largeur, tiroir...), « Tester » et le dernier test ;
 *  - le guide « Quel materiel ? » (options classees, sources dans docs/bible/modules/M06).
 * Avant la migration 20261103250000 : bandeau, rien n'est modifiable, la caisse imprime en A4.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, BookOpen, CheckCircle2, Loader2, Monitor, Pencil, Plus, Printer, Save, Settings2, Trash2, Usb, XCircle, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import {
  DEVICE_ROLES, ROLE_CONNECTIONS, WORKSTATION_KINDS, NETWORK_CONNECTIONS, browserCaps, connectionProblem, isPlanned,
  type CompanyDeviceSettings, type Connection, type DeviceConfig, type DeviceRole, type Workstation, type WorkstationDevice,
  type WorkstationKind,
} from '@/lib/devices/types';
import {
  deleteWorkstation, logDeviceEvent, recordDeviceTest, saveCompanyDeviceSettings, saveDevice, saveWorkstation,
} from '@/lib/devices/api';
import { deviceSetupKey, useDeviceSetup } from '@/lib/devices/use-devices';
import { openDrawer, printRawLabels, printReceipt, type DeviceContext, type DeviceResult } from '@/lib/devices';
import { authorizeSerial, authorizeUsb } from '@/lib/devices/drivers';
import { deviceOrigin } from '@/lib/devices/protocols';
import { buildTestReceipt } from '@/modules/sales/receipt-ticket';
import { printLabels } from '@/modules/articles/label-print';

const NONE = '__none';

function Section({ icon, title, children, actions }: { icon: ReactNode; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-ui text-[15px] font-bold">{icon}{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

const trReceipt = (key: string, vars?: Record<string, string | number>) => fillVars(t(`devices.receipt.${key}`), vars ?? {});
const resultText = (r: DeviceResult) => `${t(`devices.result.${r.code}`)}${r.detail ? ` (${r.detail})` : ''}`;

export function DevicesScreen({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { setup, available, isLoading, localId, setWorkstation } = useDeviceSetup(companyId);
  const [editing, setEditing] = useState<Workstation | 'new' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: deviceSetupKey(companyId) });

  const del = useMutation({
    mutationFn: (id: string) => deleteWorkstation(id),
    onSuccess: () => { refresh(); toast.success(t('devices.saved')); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  const workstations = setup?.workstations ?? [];

  return (
    <div className="space-y-4">
      {!available && (
        <p className="flex gap-2 rounded-md border border-warning bg-warning-bg px-4 py-3 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t('devices.notApplied')}
        </p>
      )}

      <Section icon={<Monitor className="size-5 text-primary" />} title={t('devices.thisStation')}>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={localId ?? NONE} onValueChange={(v) => setWorkstation(v === NONE ? null : v)} disabled={!available}>
            <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('devices.noStation')}</SelectItem>
              {workstations.filter((w) => w.is_active).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-[13px] text-muted-foreground">{t('devices.thisStationHint')}</span>
        </div>
      </Section>

      <CompanySettingsCard companyId={companyId} settings={setup?.settings} disabled={!available} onSaved={refresh} />

      <Section
        icon={<Settings2 className="size-5 text-primary" />}
        title={t('devices.stations')}
        actions={<Button size="sm" onClick={() => setEditing('new')} disabled={!available}><Plus /> {t('devices.addStation')}</Button>}
      >
        {workstations.length === 0 && <p className="text-sm text-muted-foreground">{t('devices.noStations')}</p>}
        <div className="space-y-4">
          {workstations.map((w) => (
            <div key={w.id} className="space-y-3 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-ui text-[15px] font-bold">{w.name}</span>
                <span className="text-[13px] text-muted-foreground">{t(`devices.kind_${w.kind}`)}{w.register_code ? ` · ${w.register_code}` : ''}</span>
                {w.is_active
                  ? <StatusBadge tone="success" icon={CheckCircle2} label={t('devices.active')} />
                  : <StatusBadge tone="neutral" icon={XCircle} label={t('devices.inactive')} />}
                {localId === w.id && <StatusBadge tone="info" icon={Monitor} label={t('devices.thisOne')} />}
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(w)}><Pencil /> {t('devices.editStation')}</Button>
                  <Button size="sm" variant="outline" disabled={del.isPending} onClick={async () => {
                    if (await confirm({ variant: 'delete', message: fillVars(t('devices.deleteConfirm'), { name: w.name }) })) del.mutate(w.id);
                  }}><Trash2 className="text-danger" /> {t('devices.deleteStation')}</Button>
                </div>
              </div>
              <div className="divide-y divide-border">
                {DEVICE_ROLES.map((role) => (
                  <DeviceRow
                    key={role} companyId={companyId} station={w} role={role}
                    stationDevices={(setup?.devices ?? []).filter((d) => d.workstation_id === w.id)}
                    settings={setup!.settings} onSaved={refresh}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section icon={<BookOpen className="size-5 text-primary" />} title={t('devices.guideTitle')}>
        <ul className="space-y-2 text-[13px] leading-relaxed">
          {(['guide1', 'guide2', 'guide3', 'guide4', 'guide5'] as const).map((k) => <li key={k}>{t(`devices.${k}`)}</li>)}
        </ul>
      </Section>

      {editing && (
        <StationDialog
          companyId={companyId} station={editing === 'new' ? null : editing} count={workstations.length}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function CompanySettingsCard({ companyId, settings, disabled, onSaved }: {
  companyId: string; settings: CompanyDeviceSettings | undefined; disabled: boolean; onSaved: () => void;
}) {
  const [s, setS] = useState<CompanyDeviceSettings | null>(settings ?? null);
  useEffect(() => { if (settings) setS(settings); }, [settings]);
  const save = useMutation({
    mutationFn: () => saveCompanyDeviceSettings(companyId, s!),
    onSuccess: () => { onSaved(); toast.success(t('devices.saved')); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!s) return null;
  return (
    <Section icon={<Printer className="size-5 text-primary" />} title={t('devices.companySettings')}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label>{t('devices.receiptWidth')}</Label>
          <Select value={String(s.receipt_width_mm)} onValueChange={(v) => setS({ ...s, receipt_width_mm: v === '58' ? 58 : 80 })} disabled={disabled}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="80">{t('devices.width80')}</SelectItem>
              <SelectItem value="58">{t('devices.width58')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><Switch checked={s.auto_print_receipt} onCheckedChange={(v) => setS({ ...s, auto_print_receipt: v })} disabled={disabled} /> {t('devices.autoPrint')}</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={s.open_drawer_on_cash} onCheckedChange={(v) => setS({ ...s, open_drawer_on_cash: v })} disabled={disabled} /> {t('devices.drawerOnCash')}</label>
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label>{t('devices.receiptFooter')}</Label>
          <Textarea rows={2} value={s.receipt_footer ?? ''} placeholder={t('devices.receiptFooterPh')} onChange={(e) => setS({ ...s, receipt_footer: e.target.value })} disabled={disabled} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={disabled || save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('devices.save')}</Button>
      </div>
    </Section>
  );
}

function StationDialog({ companyId, station, count, onClose, onSaved }: {
  companyId: string; station: Workstation | null; count: number; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(station?.name ?? '');
  const [kind, setKind] = useState<WorkstationKind>(station?.kind ?? 'caisse');
  const [code, setCode] = useState(station?.register_code ?? '');
  const [active, setActive] = useState(station?.is_active ?? true);
  const save = useMutation({
    mutationFn: () => saveWorkstation({
      id: station?.id, companyId, name, kind, registerCode: code || null, isActive: active, sortOrder: station?.sort_order ?? count,
    }),
    onSuccess: () => { toast.success(t('devices.saved')); onSaved(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{station ? t('devices.editStation') : t('devices.addStation')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>{t('devices.stationName')}</Label><Input value={name} maxLength={60} placeholder={t('devices.stationNamePh')} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>{t('devices.stationKind')}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as WorkstationKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{WORKSTATION_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`devices.kind_${k}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>{t('devices.registerCode')}</Label><Input value={code} maxLength={20} placeholder={t('devices.registerCodePh')} onChange={(e) => setCode(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} /> {t('devices.active')}</label>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('devices.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DEFAULT_CONFIG: Partial<Record<Connection, DeviceConfig>> = {
  epson_epos: { https: true, deviceId: 'local_printer', paperWidth: 80 },
  star_webprnt: { https: true, paperWidth: 80 },
  escpos_network: { port: 9100, paperWidth: 80 },
  web_serial: { baudRate: 9600, paperWidth: 80 },
  web_usb: { paperWidth: 80 },
  browser: { paperWidth: 80 },
  zebra_zpl_network: { https: true, dpi: 203, labelWidthMm: 50, labelHeightMm: 30 },
};

function DeviceRow({ companyId, station, role, stationDevices, settings, onSaved }: {
  companyId: string; station: Workstation; role: DeviceRole; stationDevices: WorkstationDevice[];
  settings: CompanyDeviceSettings; onSaved: () => void;
}) {
  const saved = stationDevices.find((d) => d.role === role) ?? null;
  const [connection, setConnection] = useState<Connection>(saved?.connection ?? 'none');
  const [label, setLabel] = useState(saved?.label ?? '');
  const [cfg, setCfg] = useState<DeviceConfig>(saved?.config ?? {});
  const [testing, setTesting] = useState(false);
  const [scan, setScan] = useState('');
  const [scanned, setScanned] = useState<string | null>(null);
  useEffect(() => { setConnection(saved?.connection ?? 'none'); setLabel(saved?.label ?? ''); setCfg(saved?.config ?? {}); }, [saved]);

  const caps = useMemo(() => browserCaps(), []);
  const problem = connection === 'none' ? null : connectionProblem(connection, cfg, caps);
  const isPrinter = role === 'receipt_printer';
  const isLabel = role === 'label_printer';
  const network = NETWORK_CONNECTIONS.includes(connection);
  const setC = (patch: Partial<DeviceConfig>) => setCfg((c) => ({ ...c, ...patch }));

  const save = useMutation({
    mutationFn: () => saveDevice({ companyId, workstationId: station.id, role, connection, label, config: cfg, isActive: true }),
    onSuccess: () => { toast.success(t('devices.saved')); onSaved(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Test sur la configuration affichee (meme non enregistree) ; resultat garde si l'appareil existe.
  const test = async () => {
    setTesting(true);
    const current: WorkstationDevice = {
      id: saved?.id ?? 'unsaved', company_id: companyId, workstation_id: station.id, role, connection, label, config: cfg,
      is_active: true, last_test_at: null, last_test_ok: null, last_test_message: null,
    };
    const ctx: DeviceContext = { workstation: station, devices: [...stationDevices.filter((d) => d.role !== role), current], settings };
    let r: DeviceResult;
    try {
      if (role === 'receipt_printer') r = await printReceipt(ctx, buildTestReceipt(trReceipt, station.name));
      else if (role === 'cash_drawer') r = await openDrawer(ctx);
      else {
        const lbl = { reference: t('devices.testLabel.reference'), designation: t('devices.testLabel.designation'), price: t('devices.testLabel.price'), barcode: t('devices.testLabel.reference'), qty: 1 };
        const raw = await printRawLabels(ctx, [lbl]);
        if (raw) r = raw;
        else { printLabels([{ code: lbl.reference, designation: lbl.designation, price: 12.5, withPrice: true }], 1); r = { ok: true, code: 'printed' }; }
      }
    } catch (e) { r = { ok: false, code: 'printerError', detail: errorMessage(e) }; }
    setTesting(false);
    if (r.ok) toast.success(`${t('devices.testOk')} : ${resultText(r)}`); else toast.error(`${t('devices.testFail')} : ${resultText(r)}`);
    if (saved) {
      await recordDeviceTest(saved.id, r.ok, r.ok ? null : resultText(r)).catch(() => undefined);
      void logDeviceEvent(companyId, 'device_tested', station.id, { role, connection, ok: r.ok, code: r.code });
      onSaved();
    }
  };

  const authorize = async () => {
    const res = connection === 'web_usb' ? await authorizeUsb() : await authorizeSerial();
    if (!res.result.ok) { toast.error(resultText(res.result)); return; }
    setC({ usbVendorId: res.vendorId, usbProductId: res.productId });
  };

  const testable = ['receipt_printer', 'cash_drawer', 'label_printer'].includes(role) && connection !== 'none' && !problem;
  const hex = (n?: number) => (n == null ? '' : n.toString(16).padStart(4, '0'));

  return (
    <div className="grid gap-3 py-3 lg:grid-cols-[220px_1fr]">
      <div>
        <p className="font-ui text-[14px] font-bold">{t(`devices.role_${role}`)}</p>
        {saved?.last_test_at
          ? <span className="mt-1 inline-block">
              <StatusBadge tone={saved.last_test_ok ? 'success' : 'danger'} icon={saved.last_test_ok ? CheckCircle2 : XCircle}
                label={fillVars(t('devices.lastTest'), { date: new Date(saved.last_test_at).toLocaleDateString('fr-BE') })} />
            </span>
          : saved && connection !== 'none' ? <span className="mt-1 inline-block"><StatusBadge tone="neutral" label={t('devices.neverTested')} /></span> : null}
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[12px]">{t('devices.connection')}</Label>
            <Select value={connection} onValueChange={(v) => { const c = v as Connection; setConnection(c); if (!saved || saved.connection !== c) setCfg({ ...(DEFAULT_CONFIG[c] ?? {}), ...(isPrinter ? { paperWidth: settings.receipt_width_mm } : {}) }); }}>
              <SelectTrigger className="w-80"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_CONNECTIONS[role].map((c) => <SelectItem key={c} value={c} disabled={isPlanned(c)}>{t(`devices.conn_${c}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {connection !== 'none' && (
            <div className="space-y-1">
              <Label className="text-[12px]">{t('devices.model')}</Label>
              <Input className="w-56" value={label} maxLength={80} placeholder={t('devices.modelPh')} onChange={(e) => setLabel(e.target.value)} />
            </div>
          )}
          {network && (
            <>
              <div className="space-y-1">
                <Label className="text-[12px]">{t('devices.host')}</Label>
                <Input className="w-40 font-data" value={cfg.host ?? ''} placeholder={t('devices.hostPh')} onChange={(e) => setC({ host: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-[12px]">{t('devices.port')}</Label>
                <Input className="w-24 font-data" inputMode="numeric" value={cfg.port ?? ''} onChange={(e) => setC({ port: e.target.value ? Number(e.target.value) : null })} />
              </div>
            </>
          )}
          {connection === 'epson_epos' && (
            <div className="space-y-1">
              <Label className="text-[12px]">{t('devices.deviceId')}</Label>
              <Input className="w-36 font-data" value={cfg.deviceId ?? 'local_printer'} onChange={(e) => setC({ deviceId: e.target.value })} />
            </div>
          )}
          {isPrinter && connection !== 'none' && (
            <div className="space-y-1">
              <Label className="text-[12px]">{t('devices.paperWidth')}</Label>
              <Select value={String(cfg.paperWidth ?? settings.receipt_width_mm)} onValueChange={(v) => setC({ paperWidth: v === '58' ? 58 : 80 })}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="80">{t('devices.width80')}</SelectItem><SelectItem value="58">{t('devices.width58')}</SelectItem></SelectContent>
              </Select>
            </div>
          )}
          {connection === 'web_serial' && (
            <div className="space-y-1">
              <Label className="text-[12px]">{t('devices.baudRate')}</Label>
              <Select value={String(cfg.baudRate ?? 9600)} onValueChange={(v) => setC({ baudRate: Number(v) })}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{[9600, 19200, 38400, 57600, 115200].map((b) => <SelectItem key={b} value={String(b)}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {isLabel && ['zebra_zpl_network', 'web_serial', 'web_usb'].includes(connection) && (
            <>
              <div className="space-y-1"><Label className="text-[12px]">{t('devices.labelWidth')}</Label><Input className="w-24 font-data" inputMode="numeric" value={cfg.labelWidthMm ?? ''} onChange={(e) => setC({ labelWidthMm: Number(e.target.value) || undefined })} /></div>
              <div className="space-y-1"><Label className="text-[12px]">{t('devices.labelHeight')}</Label><Input className="w-24 font-data" inputMode="numeric" value={cfg.labelHeightMm ?? ''} onChange={(e) => setC({ labelHeightMm: Number(e.target.value) || undefined })} /></div>
              <div className="space-y-1">
                <Label className="text-[12px]">{t('devices.dpi')}</Label>
                <Select value={String(cfg.dpi ?? 203)} onValueChange={(v) => setC({ dpi: v === '300' ? 300 : 203 })}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="203">203 dpi</SelectItem><SelectItem value="300">300 dpi</SelectItem></SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {network && (
            <label className="flex items-center gap-2 text-sm"><Switch checked={!!cfg.https} onCheckedChange={(v) => setC({ https: v })} /> {t('devices.https')}</label>
          )}
          {isPrinter && ['browser', 'epson_epos', 'star_webprnt', 'web_serial', 'web_usb'].includes(connection) && (
            <label className="flex items-center gap-2 text-sm"><Switch checked={!!cfg.drawerViaPrinter} onCheckedChange={(v) => setC({ drawerViaPrinter: v })} /> {t('devices.drawerViaPrinter')}</label>
          )}
          {(role === 'cash_drawer' && connection === 'via_receipt_printer') || (isPrinter && cfg.drawerViaPrinter) ? (
            <Select value={String(cfg.drawerPin ?? 2)} onValueChange={(v) => setC({ drawerPin: v === '5' ? 5 : 2 })}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="2">{t('devices.pin2')}</SelectItem><SelectItem value="5">{t('devices.pin5')}</SelectItem></SelectContent>
            </Select>
          ) : null}
          {(connection === 'web_serial' || connection === 'web_usb') && (
            <>
              <Button size="sm" variant="outline" onClick={authorize}><Usb /> {t('devices.authorize')}</Button>
              {cfg.usbVendorId != null && <span className="font-data text-[12px] text-muted-foreground">{fillVars(t('devices.authorized'), { id: `${hex(cfg.usbVendorId)}:${hex(cfg.usbProductId)}` })}</span>}
            </>
          )}
          {network && cfg.host && (
            <a className="inline-flex items-center gap-1 text-[13px] text-primary underline-offset-2 hover:underline" href={deviceOrigin(cfg)} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> {t('devices.openPrinterPage')}</a>
          )}
          {role === 'scanner' && connection === 'hid_keyboard' && (
            <>
              <Input className="w-64" value={scan} placeholder={t('devices.scannerTestPh')} onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { setScanned(scan); setScan(''); } }} />
              {scanned != null && <span className="font-data text-[13px]">{fillVars(t('devices.scannerRead'), { code: scanned })}</span>}
            </>
          )}
          {role === 'customer_display' && connection === 'second_window' && (
            <Button size="sm" variant="outline" onClick={() => window.open('/ecran-client', 'ecran-client')}><Monitor /> {t('devices.openDisplay')}</Button>
          )}
        </div>

        {problem && <p className="flex gap-2 text-[13px] text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t(`devices.why_${problem}`)}</p>}

        <div className="flex gap-2">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('devices.saveDevice')}</Button>
          {testable && <Button size="sm" variant="outline" onClick={test} disabled={testing}>{testing ? <Loader2 className="animate-spin" /> : <Printer />} {t('devices.test')}</Button>}
        </div>
      </div>
    </div>
  );
}
