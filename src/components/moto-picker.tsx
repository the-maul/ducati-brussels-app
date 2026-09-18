/**
 * Choix de la moto actuelle du client — composant PARTAGÉ (inscription en ligne,
 * borne du comptoir ; réutilisable dans le portail client et la fiche).
 *
 * Trois chemins :
 *   - Ducati : famille → modèle → année (années bornées par la commercialisation) ;
 *   - autre marque : marque (liste courte ou saisie libre) → modèle → année ;
 *   - pas encore de moto.
 * Données : `src/lib/ducati-models.ts`. Grandes cibles tactiles avec `size="kiosk"`.
 */
import { useState } from 'react';
import { Bike, Check, ChevronLeft, CircleOff, Tags } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import {
  DUCATI_FAMILIES, OTHER_BRANDS, findFamily, recentYears, yearsFor,
} from '@/lib/ducati-models';

export type MotoChoice =
  | { kind: 'ducati'; family: string; model: string; year: number | null }
  | { kind: 'other_brand'; brand: string; model: string; year: number | null }
  | { kind: 'none' };

/** Vrai quand la déclaration est complète (le modèle est connu, ou « pas de moto »). */
export function isMotoComplete(v: MotoChoice | null): boolean {
  if (!v) return false;
  if (v.kind === 'none') return true;
  if (v.kind === 'ducati') return !!v.family && !!v.model;
  return !!v.brand.trim() && !!v.model.trim();
}

/** Texte court : « Ducati Panigale V4 S · 2021 ». */
export function motoLabel(v: MotoChoice | null): string {
  if (!v) return '';
  if (v.kind === 'none') return t('signup.moto.none');
  const base = v.kind === 'ducati' ? `Ducati ${v.model}` : `${v.brand} ${v.model}`.trim();
  return v.year ? `${base} · ${v.year}` : base;
}

type Size = 'default' | 'kiosk';

/** Tuile sélectionnable (bouton), état « choisi » = bordure rouge + fond teinté + coche. */
function Tile({ selected, onClick, children, size, className }: {
  selected?: boolean; onClick: () => void; children: React.ReactNode; size: Size; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!selected}
      className={cn(
        'relative flex items-center gap-2 rounded-md border border-border bg-card text-left transition-colors',
        'hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        size === 'kiosk' ? 'min-h-14 px-4 py-3 text-[16px]' : 'min-h-11 px-3 py-2 text-[14px]',
        selected && 'border-primary bg-[var(--ducati-red-tint)]',
        className,
      )}
    >
      {children}
      {selected && <Check className="ml-auto size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}

export function MotoPicker({ value, onChange, size = 'default', autoComplete }: {
  value: MotoChoice | null;
  onChange: (v: MotoChoice | null) => void;
  size?: Size;
  /** 'off' sur la borne : aucune suggestion du client précédent. */
  autoComplete?: string;
}) {
  const kind = value?.kind ?? null;
  // Étape d'affichage du parcours Ducati : on peut revenir aux familles sans perdre le choix.
  const [browseFamilies, setBrowseFamilies] = useState(false);
  const [freeBrand, setFreeBrand] = useState(
    value?.kind === 'other_brand' && !!value.brand && !OTHER_BRANDS.includes(value.brand),
  );

  const pickKind = (k: MotoChoice['kind']) => {
    if (k === kind) return;
    setBrowseFamilies(false);
    setFreeBrand(false);
    if (k === 'none') onChange({ kind: 'none' });
    else if (k === 'ducati') onChange({ kind: 'ducati', family: '', model: '', year: null });
    else onChange({ kind: 'other_brand', brand: '', model: '', year: null });
  };

  const gridCols = size === 'kiosk' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3';

  return (
    <div className="space-y-4">
      {/* 1. Ducati / autre marque / pas de moto */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label={t('signup.sectionMoto')}>
        <Tile size={size} selected={kind === 'ducati'} onClick={() => pickKind('ducati')}>
          <Bike className="size-5 shrink-0" aria-hidden />
          <span className="font-medium">{t('signup.moto.ducati')}</span>
        </Tile>
        <Tile size={size} selected={kind === 'other_brand'} onClick={() => pickKind('other_brand')}>
          <Tags className="size-5 shrink-0" aria-hidden />
          <span className="font-medium">{t('signup.moto.otherBrand')}</span>
        </Tile>
        <Tile size={size} selected={kind === 'none'} onClick={() => pickKind('none')}>
          <CircleOff className="size-5 shrink-0" aria-hidden />
          <span className="font-medium">{t('signup.moto.none')}</span>
        </Tile>
      </div>

      {value?.kind === 'none' && (
        <p className="text-[14px] text-muted-foreground">{t('signup.moto.noneText')}</p>
      )}

      {value?.kind === 'ducati' && (
        <DucatiPath
          value={value}
          onChange={onChange}
          size={size}
          gridCols={gridCols}
          browseFamilies={browseFamilies || !value.family}
          setBrowseFamilies={setBrowseFamilies}
        />
      )}

      {value?.kind === 'other_brand' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('signup.moto.brand')}</p>
            <div className={cn('grid gap-2', size === 'kiosk' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4')}>
              {OTHER_BRANDS.map((b) => (
                <Tile key={b} size={size} selected={!freeBrand && value.brand === b}
                  onClick={() => { setFreeBrand(false); onChange({ ...value, brand: b }); }}>
                  <span>{b}</span>
                </Tile>
              ))}
              <Tile size={size} selected={freeBrand}
                onClick={() => { setFreeBrand(true); onChange({ ...value, brand: '' }); }}>
                <span>{t('signup.moto.brandOther')}</span>
              </Tile>
            </div>
            {freeBrand && (
              <Input
                autoFocus
                autoComplete={autoComplete}
                value={value.brand}
                placeholder={t('signup.moto.brandOtherPlaceholder')}
                onChange={(e) => onChange({ ...value, brand: e.target.value })}
                className={size === 'kiosk' ? 'h-12 text-[16px]' : 'h-11 lg:h-10'}
              />
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1.5">
              <label htmlFor="moto-model" className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('signup.moto.model')}</label>
              <Input
                id="moto-model"
                autoComplete={autoComplete}
                value={value.model}
                placeholder={t('signup.moto.modelPlaceholder')}
                onChange={(e) => onChange({ ...value, model: e.target.value })}
                className={size === 'kiosk' ? 'h-12 text-[16px]' : 'h-11 lg:h-10'}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="moto-year" className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('signup.moto.year')}</label>
              <select
                id="moto-year"
                value={value.year ?? ''}
                onChange={(e) => onChange({ ...value, year: e.target.value ? Number(e.target.value) : null })}
                className={cn(
                  'w-full rounded-md border border-input bg-background px-3 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  size === 'kiosk' ? 'h-12 text-[16px]' : 'h-11 text-[16px] md:text-[14px] lg:h-10',
                )}
              >
                <option value="">{t('signup.moto.yearUnknown')}</option>
                {recentYears().map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {value && isMotoComplete(value) && value.kind !== 'none' && (
        <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[14px] text-success">
          <Check className="size-4 shrink-0" aria-hidden />
          <span>{motoLabel(value)}</span>
        </p>
      )}
    </div>
  );
}

function DucatiPath({ value, onChange, size, gridCols, browseFamilies, setBrowseFamilies }: {
  value: Extract<MotoChoice, { kind: 'ducati' }>;
  onChange: (v: MotoChoice) => void;
  size: Size;
  gridCols: string;
  browseFamilies: boolean;
  setBrowseFamilies: (b: boolean) => void;
}) {
  const family = findFamily(value.family);
  const model = family?.models.find((m) => m.name === value.model);

  if (browseFamilies || !family) {
    return (
      <div className="space-y-2">
        <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('signup.moto.chooseFamily')}</p>
        <div className={cn('grid gap-2', gridCols)}>
          {DUCATI_FAMILIES.map((f) => (
            <Tile key={f.key} size={size} selected={value.family === f.key}
              onClick={() => {
                setBrowseFamilies(false);
                if (f.key !== value.family) onChange({ kind: 'ducati', family: f.key, model: '', year: null });
              }}>
              <span className="flex flex-col">
                <span className="font-display text-[14px] font-bold uppercase leading-tight">{f.name}</span>
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {f.models.length} {t('signup.moto.modelsCount')}
                </span>
              </span>
            </Tile>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setBrowseFamilies(true)}
            className="inline-flex min-h-11 items-center gap-1 rounded-md px-1 py-1 text-[14px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t('signup.moto.families')}
          </button>
          <span className="text-muted-foreground" aria-hidden>/</span>
          <span className="font-display text-[14px] font-bold uppercase">{family.name}</span>
        </div>
        <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('signup.moto.chooseModel')}</p>
        <div className={cn('grid gap-2', gridCols)}>
          {family.models.map((m) => (
            <Tile key={m.name} size={size} selected={value.model === m.name}
              onClick={() => onChange({ ...value, model: m.name, year: null })}>
              <span className="flex flex-col">
                <span className="font-medium leading-tight">{m.name}</span>
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {m.to === null ? `${m.from} –` : m.from === m.to ? `${m.from}` : `${m.from} – ${m.to}`}
                </span>
              </span>
            </Tile>
          ))}
        </div>
      </div>

      {model && (
        <div className="space-y-2">
          <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('signup.moto.chooseYear')}</p>
          <div className={cn('grid gap-2', size === 'kiosk' ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-4 sm:grid-cols-6')}>
            {yearsFor(model).map((y) => (
              <Tile key={y} size={size} selected={value.year === y}
                onClick={() => onChange({ ...value, year: y })} className="justify-center">
                <span className="tabular-nums">{y}</span>
              </Tile>
            ))}
            <Tile size={size} selected={value.year === null && !!value.model}
              onClick={() => onChange({ ...value, year: null })} className="col-span-2 justify-center">
              <span>{t('signup.moto.yearUnknown')}</span>
            </Tile>
          </div>
        </div>
      )}
    </div>
  );
}
