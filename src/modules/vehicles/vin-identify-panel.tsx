/**
 * Mission 06, carte 4 — « Reconnaître exactement la moto par son VIN » : encart affiché sous
 * chaque saisie de VIN (fiche moto, moto de client, reprise, « Ajouter ma moto » de l'espace client).
 *
 * Dès que le VIN fait 17 caractères valides : reconnaissance hors ligne (`vin_identify`), niveau
 * de confiance (couleur + icône + libellé), champs VIDES remplis automatiquement (jamais une saisie
 * écrasée : « D'après le VIN : … — Utiliser »), liste des versions possibles à choisir, lien vers
 * les vues éclatées et le plan d'entretien du modèle-année (côté équipe).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { BookOpen, Check, Layers, Loader2, ScanSearch, Unlink, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { fill } from '@/modules/catalog/format';
import { normalizeVin } from '@/lib/vin';
import {
  isFullVin, vinCandidateLabel, vinNeedsChoice, vinSuggestedFields, ducatiCommercialName,
  type VinConfidence, type VinIdentifyResult, type VinSuggestKey,
} from '@/lib/vin-identify';
import { useVinIdentify } from './vin-identify-api';

export type VinValues = Partial<Record<VinSuggestKey, string>>;

const TONE: Record<VinConfidence, StatusTone> = {
  unique: 'success', probable: 'info', plusieurs: 'warning', modele: 'warning', famille: 'warning', inconnu: 'neutral',
};

const same = (a: string, b: string) => {
  const x = a.trim().toUpperCase().replace(/\s+/g, ' ');
  const y = b.trim().toUpperCase().replace(/\s+/g, ' ');
  if (x === y) return true;
  return x !== '' && y !== '' && !Number.isNaN(Number(x)) && Number(x) === Number(y);
};

export function VinIdentifyPanel({
  vin, values, onApply, modelYearId, onModelYearChange, autoApply = true, variant = 'staff', onAutoFilled,
}: {
  vin: string;
  /** Valeurs actuelles des champs du formulaire (clés métier). */
  values: VinValues;
  /** Écrit des valeurs dans le formulaire. */
  onApply: (patch: VinValues) => void;
  /** Modèle-année du catalogue enregistré sur la fiche (équipe). */
  modelYearId?: string | null;
  onModelYearChange?: (id: string | null) => void;
  /** Remplir tout seul (VIN saisi maintenant) ; sinon bouton « Compléter » (fiche existante). */
  autoApply?: boolean;
  variant?: 'staff' | 'portal';
  /** Champs remplis automatiquement (pour les surligner). */
  onAutoFilled?: (keys: VinSuggestKey[]) => void;
}) {
  const v = normalizeVin(vin);
  const q = useVinIdentify(v);
  const r = q.data ?? null;
  const staff = variant === 'staff';

  // Version choisie : celle de la fiche (équipe) ou un choix local (espace client, reprise).
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { setPicked(null); }, [v]);
  const chosenId = (onModelYearChange ? modelYearId : picked) ?? null;
  const chosenInList = !!r && !!chosenId && r.candidates.some((c) => c.model_year_id === chosenId);

  const sug = useMemo(() => vinSuggestedFields(r, chosenInList ? chosenId : null), [r, chosenId, chosenInList]);

  // Valeurs écrites par nous : on peut les remplacer (autre version choisie), jamais une saisie.
  const auto = useRef<VinValues>({});
  const valuesRef = useRef(values);
  valuesRef.current = values;
  useEffect(() => { auto.current = {}; }, [v]);

  const apply = () => {
    const cur = valuesRef.current;
    const patch: VinValues = {};
    for (const [k, val] of Object.entries(sug) as [VinSuggestKey, string][]) {
      const c = (cur[k] ?? '').trim();
      const ours = auto.current[k];
      if (c === '' || (ours != null && c === ours && !same(c, val))) patch[k] = val;
    }
    const keys = Object.keys(patch) as VinSuggestKey[];
    if (!keys.length) return;
    auto.current = { ...auto.current, ...patch };
    onApply(patch);
    onAutoFilled?.(keys);
  };

  // Remplissage automatique quand le résultat (ou la version choisie) change.
  useEffect(() => {
    if (!r || !autoApply) return;
    apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sug, autoApply]);

  // Reconnaissance certaine : la fiche est rattachée au catalogue (si rien n'est choisi).
  useEffect(() => {
    if (!r || !onModelYearChange || modelYearId || !autoApply) return;
    if (r.confidence === 'unique' && r.model_year_id) onModelYearChange(r.model_year_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r]);

  if (!isFullVin(v)) return null;
  if (q.isLoading) {
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />{t('vinId.searching')}
      </p>
    );
  }
  if (q.error || !r) {
    return <p className="text-[12px] text-muted-foreground">{t('vinId.err')}</p>;
  }

  // Constructeur autre que Ducati : marque et année seulement.
  if (!r.ducati) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 text-[12px]">
        <p className="flex flex-wrap items-center gap-2">
          <ScanSearch className="size-4 text-muted-foreground" />
          {fill(t('vinId.notDucati'), { brand: sug.brand ?? t('vinId.unknownBrand'), year: r.vin_year ?? '—' })}
        </p>
      </div>
    );
  }

  const conflicts = (Object.entries(sug) as [VinSuggestKey, string][])
    .filter(([k, val]) => {
      const c = (values[k] ?? '').trim();
      return c !== '' && !same(c, val) && auto.current[k] !== c;
    });
  const missing = (Object.entries(sug) as [VinSuggestKey, string][]).filter(([k]) => !(values[k] ?? '').trim()).length;

  const chosen = chosenInList ? r.candidates.find((c) => c.model_year_id === chosenId)! : null;
  const shownId = chosen?.model_year_id ?? (r.confidence === 'unique' || r.confidence === 'probable' ? r.model_year_id : null);
  const shown = chosen ?? (shownId ? r : null);
  const title = shown
    ? [ducatiCommercialName(shown.family ?? null, shown.supermodel ?? null, shown.model ?? null), shown.year].filter(Boolean).join(' ')
    : [r.family, r.supermodel && r.supermodel !== r.family ? r.supermodel : null, r.vin_year].filter(Boolean).join(' ');
  const specs = [
    sug.displacement ? `${sug.displacement} cm³` : null,
    sug.power_cv ? `${sug.power_cv} CV` : null,
    sug.cylinders ? fill(t('vinId.cyl'), { n: sug.cylinders }) : null,
    sug.antipollution ?? null,
    r.plant ? fill(t('vinId.plant'), { plant: r.plant }) : null,
  ].filter(Boolean).join(' · ');
  const drawings = chosen ? chosen.drawings_count : shownId === r.model_year_id ? r.drawings_count ?? 0 : 0;
  // Plans d'entretien : connus pour le modèle-année reconnu (les autres versions : fiche moto).
  const plans = shownId && shownId === r.model_year_id ? r.maintenance_plans : null;
  const showChoice = vinNeedsChoice(r);
  const confLabel = chosen && chosen.model_year_id !== r.model_year_id ? t('vinId.chosen') : t(`vinId.conf_${r.confidence}`);
  const confTone: StatusTone = chosen && chosen.model_year_id !== r.model_year_id ? 'info' : TONE[r.confidence];

  const choose = (id: string | null) => {
    if (onModelYearChange) onModelYearChange(id); else setPicked(id);
  };

  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <ScanSearch className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-[12px] font-medium text-muted-foreground">{staff ? t('vinId.title') : t('vinId.portalFound')}</span>
        <StatusBadge tone={confTone} label={confLabel} />
      </div>
      {title && <p className="text-[14px] font-bold">{title}</p>}
      {specs && <p className="text-[12px] text-muted-foreground tabular-nums">{specs}</p>}
      {staff && <p className="text-[12px] text-muted-foreground">
        {r.confidence === 'unique' ? t('vinId.hintUnique')
          : r.confidence === 'probable' && !chosen ? t('vinId.hintProbable')
          : r.confidence === 'famille' ? t('vinId.hintFamily')
          : r.confidence === 'inconnu' ? t('vinId.hintUnknown') : null}
      </p>}

      {showChoice && (
        <div className="space-y-1.5">
          <p className="text-[12px] font-medium">{staff ? t('vinId.hintChoose') : t('vinId.portalChoose')}</p>
          <ul className="flex flex-col gap-1">
            {r.candidates.map((c) => {
              const active = c.model_year_id === chosenId;
              return (
                <li key={c.model_year_id}>
                  <button type="button" onClick={() => choose(active ? null : c.model_year_id)}
                    className={`flex w-full flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-left ${active ? 'border-info bg-info-bg' : 'border-border hover:bg-muted/50'}`}>
                    {active ? <Check className="size-4 text-info" /> : <span className="size-4" />}
                    <span className="font-medium">{vinCandidateLabel(c)}</span>
                    {staff && c.samples > 0 && (
                      <span className="text-[11px] text-muted-foreground tabular-nums">{fill(t('vinId.seen'), { n: c.samples })}</span>
                    )}
                    {c.in_range && <span className="text-[11px] text-info">{t('vinId.inRange')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {(r.candidates_total ?? 0) > r.candidates.length && (
            <p className="text-[11px] text-muted-foreground">{fill(t('vinId.more'), { n: (r.candidates_total ?? 0) - r.candidates.length })}</p>
          )}
        </div>
      )}

      {onModelYearChange && r.confidence === 'probable' && !showChoice && r.model_year_id && modelYearId !== r.model_year_id && (
        <Button type="button" size="sm" variant="outline" onClick={() => choose(r.model_year_id)}>
          <Check /> {t('vinId.confirm')}
        </Button>
      )}

      {conflicts.length > 0 && (
        <ul className="space-y-0.5">
          {conflicts.map(([k, val]) => (
            <li key={k} className="flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
              {t(`vinId.field_${k}`)} — {t('vinId.fromVin')}<span className="font-mono text-foreground">{val}</span>
              <button type="button" className="font-medium text-info underline-offset-2 hover:underline"
                onClick={() => { auto.current = { ...auto.current, [k]: val }; onApply({ [k]: val }); }}>
                {t('vinId.use')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!autoApply && missing > 0 && (
        <Button type="button" size="sm" variant="outline" onClick={() => apply()}>
          <Wand2 /> {fill(t('vinId.complete'), { n: missing })}
        </Button>
      )}

      {staff && (
        <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[12px]">
          {shownId && drawings > 0 ? (
            <Link to="/parts/catalog" search={{ my: shownId }} target="_blank" className="inline-flex items-center gap-1 font-medium text-info hover:underline">
              <Layers className="size-3.5" />{fill(t('vinId.drawings'), { n: drawings })}
            </Link>
          ) : shownId ? <span className="text-muted-foreground">{t('vinId.noDrawings')}</span> : null}
          {plans && shownId && (
            plans.length > 0 ? (
              <Link to="/workshop/maintenance-plans" target="_blank" className="inline-flex items-center gap-1 font-medium text-info hover:underline">
                <BookOpen className="size-3.5" />
                {fill(t('vinId.plan'), { list: plans.map((p) => `${p.model_text} (${t(`maintenance.usage_${p.usage}`)})`).join(', ') })}
              </Link>
            ) : <span className="text-muted-foreground">{t('vinId.noPlan')}</span>
          )}
          {onModelYearChange && modelYearId && (
            <button type="button" onClick={() => choose(null)} className="inline-flex items-center gap-1 text-muted-foreground hover:underline">
              <Unlink className="size-3.5" />{t('vinId.unlink')}
            </button>
          )}
        </div>
      )}
      {onModelYearChange && modelYearId && !r.candidates.some((c) => c.model_year_id === modelYearId) && modelYearId !== r.model_year_id && (
        <p className="text-[12px] text-muted-foreground">{t('vinId.keptLink')}</p>
      )}
    </div>
  );
}

export type { VinIdentifyResult };
