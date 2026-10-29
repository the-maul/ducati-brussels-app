/**
 * Kilométrage actuel et dernier entretien déclarés par le CLIENT — composant PARTAGÉ
 * (inscription en ligne, borne du comptoir, espace client « Ajouter ma moto » et « Mes motos »).
 * Mission 07, carte 5 : « quand le client enregistre sa moto, on peut lui demander quand il a
 * fait les derniers entretiens prévus, et ses km, pour savoir quoi lui proposer ».
 * Tout est facultatif ; « Je ne sais pas » reste possible pour le lieu du dernier entretien.
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export type ServiceWhere = 'ici' | 'ailleurs' | 'unknown';
export type ServiceDeclarationValue = { km: string; lastDate: string; lastKm: string; where: ServiceWhere };
export const EMPTY_SERVICE_DECLARATION: ServiceDeclarationValue = { km: '', lastDate: '', lastKm: '', where: 'unknown' };

export type ServiceDeclarationPayload = {
  mileage_km: number | null;
  last_services: { date: string | null; km: number | null; where: 'ici' | 'ailleurs' | null }[];
};

const num = (s: string): number | null => (s.trim() === '' ? null : Number.isFinite(Number(s)) ? Math.trunc(Number(s)) : null);
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Vrai si le client a rempli au moins un champ. */
export function hasServiceDeclaration(v: ServiceDeclarationValue): boolean {
  return v.km.trim() !== '' || v.lastDate !== '' || v.lastKm.trim() !== '' || v.where !== 'unknown';
}

/** Ce qui part en base (contact_declared_vehicles.mileage_km / last_services, ou portal_vehicle_service_declare). */
export function serviceDeclarationPayload(v: ServiceDeclarationValue): ServiceDeclarationPayload {
  const date = v.lastDate || null; const km = num(v.lastKm);
  const where = v.where === 'ici' || v.where === 'ailleurs' ? v.where : null;
  return {
    mileage_km: num(v.km),
    last_services: date || km != null || where ? [{ date, km, where }] : [],
  };
}

export function serviceDeclarationErrors(v: ServiceDeclarationValue): { km?: string; date?: string } {
  const e: { km?: string; date?: string } = {};
  const bad = (s: string) => s.trim() !== '' && (num(s) == null || Number(s) < 0 || Number(s) > 999999);
  if (bad(v.km) || bad(v.lastKm)) e.km = t('serviceDecl.errKm');
  if (v.lastDate && v.lastDate > todayIso()) e.date = t('serviceDecl.errDate');
  return e;
}

const WHERE_OPTIONS: ServiceWhere[] = ['ici', 'ailleurs', 'unknown'];

export function ServiceDeclarationFields({ value, onChange, size = 'default', idPrefix = 'sd', errors, showTitle = true }: {
  value: ServiceDeclarationValue;
  onChange: (v: ServiceDeclarationValue) => void;
  size?: 'default' | 'kiosk';
  idPrefix?: string;
  errors?: { km?: string; date?: string };
  showTitle?: boolean;
}) {
  const kiosk = size === 'kiosk';
  const inputCls = kiosk ? 'h-12 text-[16px]' : 'h-11 lg:h-10';
  const labelCls = kiosk ? 'text-[15px]' : 'text-[13px] font-medium';
  const set = (p: Partial<ServiceDeclarationValue>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-3">
      {showTitle && (
        <div>
          <p className={cn('font-medium', kiosk ? 'text-[16px]' : 'text-[14px]')}>{t('serviceDecl.title')}</p>
          <p className="text-[12px] text-muted-foreground">{t('serviceDecl.hint')}</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-km`} className={labelCls}>{t('serviceDecl.km')}</Label>
          <Input id={`${idPrefix}-km`} type="number" inputMode="numeric" min={0} max={999999} value={value.km}
            onChange={(e) => set({ km: e.target.value })} className={cn(inputCls, 'tabular-nums')} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-date`} className={labelCls}>{t('serviceDecl.lastDate')}</Label>
          <Input id={`${idPrefix}-date`} type="date" max={todayIso()} value={value.lastDate}
            onChange={(e) => set({ lastDate: e.target.value })} className={inputCls} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-lastkm`} className={labelCls}>{t('serviceDecl.lastKm')}</Label>
          <Input id={`${idPrefix}-lastkm`} type="number" inputMode="numeric" min={0} max={999999} value={value.lastKm}
            onChange={(e) => set({ lastKm: e.target.value })} className={cn(inputCls, 'tabular-nums')} autoComplete="off" />
        </div>
      </div>
      <div className="space-y-1.5">
        <p className={labelCls}>{t('serviceDecl.where')}</p>
        <div className="grid grid-cols-3 gap-2" role="group">
          {WHERE_OPTIONS.map((w) => (
            <button key={w} type="button" aria-pressed={value.where === w} onClick={() => set({ where: w })}
              className={cn(
                'rounded-md border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                kiosk ? 'h-12 text-[15px]' : 'h-10 text-[13px]',
                value.where === w ? 'border-primary bg-[var(--ducati-red-tint)] text-foreground' : 'border-border bg-card text-foreground hover:border-foreground/40',
              )}>
              {t(`serviceDecl.where_${w}`)}
            </button>
          ))}
        </div>
      </div>
      {errors?.km && <p className="text-[13px] text-danger">{errors.km}</p>}
      {errors?.date && <p className="text-[13px] text-danger">{errors.date}</p>}
    </div>
  );
}
