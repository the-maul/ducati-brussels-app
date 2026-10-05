/**
 * Choix de la moto actuelle du client — composant PARTAGÉ (inscription en ligne,
 * borne du comptoir ; réutilisable dans le portail client et la fiche).
 *
 * Trois chemins :
 *   - Ducati : famille → modèle → année (années bornées par la commercialisation) ;
 *   - autre marque : marque → modèle → année, avec RECHERCHE dans la liste toutes
 *     marques (tables `vehicle_brands` / `vehicle_models`, retour client du 21/09) ;
 *     « Je ne trouve pas ma moto » garde la saisie libre en dernier recours ;
 *   - pas encore de moto.
 *
 * Données : gamme Ducati dans `src/lib/ducati-models.ts` (statique) ; marques et modèles
 * des autres marques par `searchMotoBrands` / `searchMotoModels` (server functions
 * publiques, clé de service). Si la liste n'est pas encore chargée ou que le réseau
 * tombe, on retombe sur la liste courte `OTHER_BRANDS` : l'écran reste utilisable.
 * Grandes cibles tactiles avec `size="kiosk"`.
 */
import { useEffect, useRef, useState } from 'react';
import { Bike, Check, ChevronLeft, CircleOff, Loader2, Search, Tags } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import {
  DUCATI_FAMILIES, OTHER_BRANDS, findFamily, recentYears, yearsFor,
} from '@/lib/ducati-models';
import {
  searchMotoBrands, searchMotoModels, type VehicleBrand, type VehicleModel,
} from '@/modules/signup/vehicle-catalog.functions';

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

  const pickKind = (k: MotoChoice['kind']) => {
    if (k === kind) return;
    setBrowseFamilies(false);
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
        <OtherBrandPath value={value} onChange={onChange} size={size} autoComplete={autoComplete} />
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

// --------------------------------------------------------------- Autres marques (21/09)

/** Liste courte de secours quand la base n'a rien renvoyé (liste non chargée, réseau coupé). */
const fallbackBrands = (): VehicleBrand[] =>
  OTHER_BRANDS.map((name) => ({ id: `fallback:${name}`, name, modelCount: 0 }));

/** Petit champ de recherche au-dessus d'une grille de tuiles. */
function SearchField({ id, label, value, onChange, placeholder, size, busy, autoComplete }: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  placeholder: string; size: Size; busy: boolean; autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id={id}
          autoComplete={autoComplete}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn('pl-9', size === 'kiosk' ? 'h-12 text-[16px]' : 'h-11 lg:h-10')}
        />
        {busy && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      </div>
    </div>
  );
}

/**
 * Marque → modèle → année pour toutes les marques, avec recherche.
 * La saisie libre (« Je ne trouve pas ma moto ») reste accessible à chaque étape :
 * elle enregistre la marque telle que tapée, et la file « marques à valider » la relit.
 */
function OtherBrandPath({ value, onChange, size, autoComplete }: {
  value: Extract<MotoChoice, { kind: 'other_brand' }>;
  onChange: (v: MotoChoice) => void;
  size: Size;
  autoComplete?: string;
}) {
  const [free, setFree] = useState(false);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [brandQuery, setBrandQuery] = useState('');
  const [brands, setBrands] = useState<VehicleBrand[] | null>(null);
  const [brandsBusy, setBrandsBusy] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [models, setModels] = useState<VehicleModel[] | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [freeModel, setFreeModel] = useState(false);

  // Dernière requête gagnante : une réponse en retard ne doit pas écraser l'affichage.
  const brandSeq = useRef(0);
  const modelSeq = useRef(0);

  useEffect(() => {
    const seq = ++brandSeq.current;
    const q = brandQuery.trim();
    setBrandsBusy(true);
    const timer = setTimeout(() => {
      searchMotoBrands({ data: { q: q || undefined, limit: 48 } })
        .then((r) => { if (seq === brandSeq.current) setBrands(r.length ? r : (q ? [] : fallbackBrands())); })
        .catch(() => { if (seq === brandSeq.current) setBrands(q ? [] : fallbackBrands()); })
        .finally(() => { if (seq === brandSeq.current) setBrandsBusy(false); });
    }, brandQuery ? 200 : 0);
    return () => clearTimeout(timer);
  }, [brandQuery]);

  useEffect(() => {
    if (!brandId || brandId.startsWith('fallback:')) { setModels(null); return; }
    const seq = ++modelSeq.current;
    const q = modelQuery.trim();
    setModelsBusy(true);
    const timer = setTimeout(() => {
      searchMotoModels({ data: { brandId, q: q || undefined, limit: 120 } })
        .then((r) => { if (seq === modelSeq.current) setModels(r); })
        .catch(() => { if (seq === modelSeq.current) setModels([]); })
        .finally(() => { if (seq === modelSeq.current) setModelsBusy(false); });
    }, modelQuery ? 200 : 0);
    return () => clearTimeout(timer);
  }, [brandId, modelQuery]);

  const chosenModel = models?.find((m) => m.name === value.model) ?? null;
  const years = chosenModel && chosenModel.yearFrom
    ? yearsFor({ name: chosenModel.name, from: chosenModel.yearFrom, to: chosenModel.yearTo })
    : recentYears();

  const yearField = (
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
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );

  // -------- Dernier recours : marque et modèle tapés à la main.
  if (free) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => { setFree(false); onChange({ ...value, brand: '', model: '' }); }}
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-1 py-1 text-[14px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t('signup.moto.backToBrands')}
        </button>
        <p className="text-[13px] text-muted-foreground">{t('signup.moto.freeHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="moto-brand-free" className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('signup.moto.brand')}</label>
            <Input
              id="moto-brand-free" autoFocus autoComplete={autoComplete} value={value.brand}
              placeholder={t('signup.moto.brandOtherPlaceholder')} maxLength={60}
              onChange={(e) => onChange({ ...value, brand: e.target.value })}
              className={size === 'kiosk' ? 'h-12 text-[16px]' : 'h-11 lg:h-10'}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="moto-model-free" className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('signup.moto.model')}</label>
            <Input
              id="moto-model-free" autoComplete={autoComplete} value={value.model}
              placeholder={t('signup.moto.modelPlaceholder')} maxLength={80}
              onChange={(e) => onChange({ ...value, model: e.target.value })}
              className={size === 'kiosk' ? 'h-12 text-[16px]' : 'h-11 lg:h-10'}
            />
          </div>
          <div className="sm:max-w-[180px]">{yearField}</div>
        </div>
      </div>
    );
  }

  // -------- Étape 1 : la marque.
  if (!brandId) {
    const list = brands ?? [];
    return (
      <div className="space-y-3">
        <SearchField
          id="moto-brand-search" label={t('signup.moto.brand')} value={brandQuery} onChange={setBrandQuery}
          placeholder={t('signup.moto.brandSearchPlaceholder')} size={size} busy={brandsBusy && brands === null}
          autoComplete={autoComplete === 'off' ? 'off' : undefined}
        />
        {brands === null ? (
          <p className="text-[13px] text-muted-foreground">{t('signup.moto.loading')}</p>
        ) : list.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('signup.moto.noBrand')}</p>
        ) : (
          <div className={cn('grid gap-2', size === 'kiosk' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4')}>
            {list.map((b) => (
              <Tile key={b.id} size={size} selected={false}
                onClick={() => {
                  setModelQuery(''); setFreeModel(false); setModels(null);
                  if (b.id.startsWith('fallback:')) { setFree(true); onChange({ ...value, brand: b.name, model: '', year: null }); return; }
                  setBrandId(b.id);
                  onChange({ ...value, brand: b.name, model: '', year: null });
                }}>
                <span>{b.name}</span>
              </Tile>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => { setFree(true); onChange({ ...value, brand: brandQuery.trim(), model: '', year: null }); }}
          className="min-h-11 text-left text-[14px] text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('signup.moto.notFound')}
        </button>
      </div>
    );
  }

  // -------- Étape 2 : le modèle, puis l'année.
  const list = models ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setBrandId(null); setFreeModel(false); onChange({ ...value, brand: '', model: '', year: null }); }}
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-1 py-1 text-[14px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t('signup.moto.backToBrands')}
        </button>
        <span className="text-muted-foreground" aria-hidden>/</span>
        <span className="font-display text-[14px] font-bold uppercase">{value.brand}</span>
      </div>

      {freeModel ? (
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <div className="space-y-1.5">
            <label htmlFor="moto-model" className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('signup.moto.model')}</label>
            <Input
              id="moto-model" autoFocus autoComplete={autoComplete} value={value.model}
              placeholder={t('signup.moto.modelPlaceholder')} maxLength={80}
              onChange={(e) => onChange({ ...value, model: e.target.value })}
              className={size === 'kiosk' ? 'h-12 text-[16px]' : 'h-11 lg:h-10'}
            />
          </div>
          {yearField}
        </div>
      ) : (
        <div className="space-y-3">
          <SearchField
            id="moto-model-search" label={t('signup.moto.model')} value={modelQuery} onChange={setModelQuery}
            placeholder={t('signup.moto.modelSearchPlaceholder')} size={size} busy={modelsBusy && models === null}
            autoComplete={autoComplete === 'off' ? 'off' : undefined}
          />
          {models === null ? (
            <p className="text-[13px] text-muted-foreground">{t('signup.moto.loading')}</p>
          ) : list.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{t('signup.moto.noModel')}</p>
          ) : (
            <div className={cn('grid gap-2', size === 'kiosk' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3')}>
              {list.map((m) => (
                <Tile key={m.id} size={size} selected={value.model === m.name}
                  onClick={() => onChange({ ...value, model: m.name, year: null })}>
                  <span className="flex flex-col">
                    <span className="font-medium leading-tight">{m.name}</span>
                    {m.yearFrom && (
                      <span className="text-[12px] text-muted-foreground tabular-nums">
                        {m.yearTo === null ? `${m.yearFrom} –` : m.yearFrom === m.yearTo ? `${m.yearFrom}` : `${m.yearFrom} – ${m.yearTo}`}
                      </span>
                    )}
                  </span>
                </Tile>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => { setFreeModel(true); onChange({ ...value, model: modelQuery.trim(), year: null }); }}
            className="min-h-11 text-left text-[14px] text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('signup.moto.modelNotFound')}
          </button>
          {!!value.model && <div className="sm:max-w-[180px]">{yearField}</div>}
        </div>
      )}
    </div>
  );
}
