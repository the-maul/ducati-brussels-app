/**
 * Mission 07, carte 5 — « Demander km et derniers entretiens quand une moto est enregistrée ».
 *
 * Partagé par l'inscription en ligne (`signup-form`, qui sert aussi la borne) et par
 * « Ajouter ma moto » de l'espace client (`portal/declare-vehicle`).
 *
 * Deux questions, sans jargon :
 *  1. le kilométrage actuel, même approximatif ;
 *  2. les derniers entretiens faits — une liste courte (Oil Service, Desmo…), et pour
 *     chacun la DATE **ou** le KILOMÉTRAGE, au choix. Tout est facultatif : « Je ne sais
 *     pas » est une réponse valable, et c'est la plus fréquente.
 *
 * Ces réponses alimentent le calcul de l'entretien dû (carte 4) : sans elles, l'échéance
 * reste une estimation ; avec elles, elle devient exacte.
 */
import { useId, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** Un entretien déclaré par le client. `km` ou `date` — au moins un des deux. */
export type DeclaredService = { label: string; km: number | null; date: string | null };

export type MotoMaintenanceValue = {
  /** Kilométrage au compteur ; null = inconnu. */
  km: number | null;
  /** Derniers entretiens connus ; vide = inconnu. */
  services: DeclaredService[];
};

export const EMPTY_MAINTENANCE: MotoMaintenanceValue = { km: null, services: [] };

/**
 * La liste courte proposée au client. On ne descend pas dans la base ici : les quatre
 * entretiens qu'un propriétaire de Ducati reconnaît suffisent à l'enregistrement, et
 * l'atelier affine ensuite sur la fiche moto avec le programme réel du modèle.
 */
export const COMMON_SERVICES = [
  { family: 'premier_1000', label: 'Révision des 1 000 km' },
  { family: 'oil', label: 'Oil Service' },
  { family: 'desmo', label: 'Desmo Service' },
  { family: 'annual', label: 'Entretien annuel' },
] as const;

export function isMaintenanceKmValid(v: MotoMaintenanceValue): boolean {
  return v.km == null || (Number.isFinite(v.km) && v.km >= 0 && v.km <= 2_000_000);
}

/** Ne garde que les entretiens qui apprennent quelque chose (une date ou un km). */
export function cleanDeclaredServices(v: MotoMaintenanceValue): DeclaredService[] {
  return v.services.filter((s) => s.km != null || (s.date != null && s.date !== ''));
}

export function MotoMaintenanceFields({
  value, onChange, size = 'default', inputClassName, autoComplete,
}: {
  value: MotoMaintenanceValue;
  onChange: (v: MotoMaintenanceValue) => void;
  size?: 'default' | 'kiosk';
  inputClassName?: string;
  autoComplete?: string;
}) {
  const uid = useId();
  const kiosk = size === 'kiosk';
  const cls = cn(inputClassName, kiosk && 'h-12 text-[16px]');
  const [open, setOpen] = useState(false);

  const kmStr = value.km == null ? '' : String(value.km);
  const setKm = (raw: string) => {
    const s = raw.replace(/[^\d]/g, '');
    onChange({ ...value, km: s === '' ? null : Number(s) });
  };

  const entry = (family: string) => value.services.find((s) => s.label === labelOf(family)) ?? null;
  const setEntry = (family: string, patch: Partial<DeclaredService> | null) => {
    const label = labelOf(family);
    const rest = value.services.filter((s) => s.label !== label);
    if (patch === null) { onChange({ ...value, services: rest }); return; }
    const cur = entry(family) ?? { label, km: null, date: null };
    onChange({ ...value, services: [...rest, { ...cur, ...patch, label }] });
  };

  const declared = cleanDeclaredServices(value).length;

  return (
    <div className="space-y-4">
      {/* 1. le kilométrage */}
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-km`} className="text-[13px] font-medium">{t('motoMaintenance.kmLabel')}</Label>
        <Input id={`${uid}-km`} type="text" inputMode="numeric" className={cn(cls, 'tabular-nums')}
          placeholder={t('motoMaintenance.kmPlaceholder')} value={kmStr}
          onChange={(e) => setKm(e.target.value)} maxLength={7} autoComplete={autoComplete} />
        <p className="text-[12px] text-muted-foreground">{t('motoMaintenance.kmHint')}</p>
        {!isMaintenanceKmValid(value) && <p className="text-[12px] text-danger">{t('motoMaintenance.kmInvalid')}</p>}
      </div>

      {/* 2. les derniers entretiens — replié par défaut, pour ne pas alourdir l'inscription */}
      <div className="space-y-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 text-left text-[13px] font-medium"
          aria-expanded={open}>
          <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
          {t('motoMaintenance.servicesTitle')}
          {declared > 0 && (
            <span className="ml-1 inline-flex items-center gap-1 text-[12px] text-success">
              <Check className="size-3.5" aria-hidden /> {declared}
            </span>
          )}
        </button>
        <p className="text-[12px] text-muted-foreground">{t('motoMaintenance.servicesHint')}</p>

        {open && (
          <div className="space-y-3 rounded-md border border-border p-3">
            {COMMON_SERVICES.map((s) => {
              const e = entry(s.family);
              const on = !!e;
              return (
                <div key={s.family} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant={on ? 'default' : 'outline'} size={kiosk ? 'lg' : 'sm'}
                      onClick={() => setEntry(s.family, on ? null : {})}>
                      {on && <Check />} {s.label}
                    </Button>
                    {!on && <span className="text-[12px] text-muted-foreground">{t('motoMaintenance.serviceNone')}</span>}
                  </div>
                  {on && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`${uid}-${s.family}-km`} className="text-[12px] text-muted-foreground">
                          {t('motoMaintenance.serviceKm')}
                        </Label>
                        <Input id={`${uid}-${s.family}-km`} type="text" inputMode="numeric"
                          className={cn(cls, 'tabular-nums')} maxLength={7} autoComplete="off"
                          value={e?.km == null ? '' : String(e.km)}
                          onChange={(ev) => {
                            const v = ev.target.value.replace(/[^\d]/g, '');
                            setEntry(s.family, { km: v === '' ? null : Number(v) });
                          }} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`${uid}-${s.family}-date`} className="text-[12px] text-muted-foreground">
                          {t('motoMaintenance.serviceDate')}
                        </Label>
                        <Input id={`${uid}-${s.family}-date`} type="date" className={cls} autoComplete="off"
                          max={new Date().toISOString().slice(0, 10)}
                          value={e?.date ?? ''}
                          onChange={(ev) => setEntry(s.family, { date: ev.target.value || null })} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function labelOf(family: string): string {
  return COMMON_SERVICES.find((s) => s.family === family)?.label ?? family;
}
