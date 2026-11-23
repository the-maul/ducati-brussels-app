/**
 * M8 — Les points G8 « Elements a verifier (V) ou a remplacer (R) » sur l'OR (18/11/2026).
 * Un clic sur V ou R coche le point ; recliquer sur la meme marque la retire. Imprime sur l'OR
 * (points coches) et sur la fiche de travail (grille complete).
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t, fillVars } from '@/lib/i18n';
import { CHECK_POINTS, countCheckPoints, toggleCheckPoint, type CheckMark, type CheckPoints } from './rules';

export function CheckPointsPanel({ value, onChange, disabled = false, defaultOpen = false }: { value: CheckPoints; onChange: (v: CheckPoints) => void; disabled?: boolean; defaultOpen?: boolean }) {
  const counts = countCheckPoints(value);
  const [open, setOpen] = useState(defaultOpen || counts.v + counts.r > 0);
  const mark = (code: (typeof CHECK_POINTS)[number], m: CheckMark) => onChange(toggleCheckPoint(value, code, m));
  return (
    <div className="rounded-md border border-border bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        <ListChecks className="size-4 text-muted-foreground" aria-hidden />
        <span className="font-ui text-[13px] font-bold">{t('orBase.checksTitle')}</span>
        <span className="ml-auto font-data text-[12px] tabular-nums text-muted-foreground">{fillVars(t('orBase.checksCount'), { v: counts.v, r: counts.r })}</span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {CHECK_POINTS.map((code) => {
              const cur = value[code];
              return (
                <div key={code} className="flex items-center gap-2 py-0.5">
                  <MarkButton active={cur === 'V'} disabled={disabled} onClick={() => mark(code, 'V')} title={t('orBase.checkVHint')}>{t('orBase.checkV')}</MarkButton>
                  <MarkButton active={cur === 'R'} disabled={disabled} onClick={() => mark(code, 'R')} title={t('orBase.checkRHint')}>{t('orBase.checkR')}</MarkButton>
                  <span className={cn('text-[13px]', cur ? 'font-medium text-foreground' : 'text-muted-foreground')}>{t(`pointsVr.${code}`)}</span>
                </div>
              );
            })}
          </div>
          {counts.v + counts.r > 0 && !disabled && (
            <div className="mt-2 flex justify-end">
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange({})}>{t('orBase.checksClear')}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MarkButton({ active, disabled, onClick, title, children }: { active: boolean; disabled: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={active}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-[var(--radius-badge)] border font-data text-[12px] font-bold',
        active ? 'border-foreground bg-foreground text-background' : 'border-input bg-background text-muted-foreground hover:bg-accent',
        disabled && 'opacity-60',
      )}
    >
      {children}
    </button>
  );
}
