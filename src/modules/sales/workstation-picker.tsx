/**
 * Caisse — « Ce poste est : ... » (PDV030) : choix du poste du navigateur directement au comptoir,
 * et rappel de l'imprimante ticket utilisee. Masque tant que la migration des postes n'est pas
 * appliquee ou qu'aucun poste n'existe (la caisse imprime alors en A4, comme avant).
 */
import { Link } from '@tanstack/react-router';
import { Monitor, Printer } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { useDeviceSetup } from '@/lib/devices/use-devices';
import { deviceFor } from '@/lib/devices/resolve';
import { t } from '@/lib/i18n';

const NONE = '__none';

export function WorkstationPicker({ companyId }: { companyId: string }) {
  const { isAdmin } = useAuth();
  const { setup, available, localId, workstation, ctx, setWorkstation } = useDeviceSetup(companyId);
  const stations = (setup?.workstations ?? []).filter((w) => w.is_active);
  if (!available || stations.length === 0) return null;
  const printer = deviceFor(ctx.devices, 'receipt_printer');
  const printerText = !workstation
    ? t('devices.posNone')
    : printer
      ? `${t(`devices.conn_${printer.connection}`)}${printer.connection !== 'none' ? ` · ${printer.config.paperWidth ?? ctx.settings.receipt_width_mm} mm` : ''}${printer.label ? ` · ${printer.label}` : ''}`
      : t('devices.posNone');
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-4 py-2 text-[13px]">
      <Monitor className="size-4 text-muted-foreground" />
      <span className="text-muted-foreground">{t('devices.thisStation')}</span>
      <Select value={localId && workstation ? localId : NONE} onValueChange={(v) => setWorkstation(v === NONE ? null : v)}>
        <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('devices.noStation')}</SelectItem>
          {stations.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <span className="flex items-center gap-1 text-muted-foreground"><Printer className="size-4" /> {t('devices.posPrinter')} : {printerText}</span>
      {isAdmin() && <Link to="/settings/devices" className="ml-auto text-primary underline-offset-2 hover:underline">{t('devices.posSettings')}</Link>}
    </div>
  );
}
