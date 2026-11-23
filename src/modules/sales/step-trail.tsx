/**
 * Fil d'étapes cliquable (chantiers C6 caisse et C8 dépôt-vente) : chaque étape porte une couleur, une
 * icône et un libellé (charte §8), cible tactile de 44 px. Le fil guide : il ne verrouille aucune étape.
 */
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export type TrailItem = { key: string; label: string; state: 'done' | 'todo' | 'warning'; current?: boolean };

export function StepTrail({ items, selected, onSelect, ariaLabel }: {
  items: TrailItem[]; selected: string; onSelect: (key: string) => void; ariaLabel: string;
}) {
  return (
    <ol aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {items.map((s, i) => {
        const tone = s.state === 'done' ? 'text-success' : s.state === 'warning' ? 'text-warning' : 'text-muted-foreground';
        return (
          <li key={s.key}>
            <button type="button" onClick={() => onSelect(s.key)} aria-current={s.current ? 'step' : undefined} aria-pressed={selected === s.key}
              className={`flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-[13px] ${selected === s.key ? 'border-foreground bg-accent' : 'border-border hover:bg-accent'} ${s.current ? 'font-bold text-foreground' : tone}`}>
              {s.state === 'done' ? <CheckCircle2 className="size-4 text-success" aria-hidden />
                : s.state === 'warning' ? <AlertTriangle className="size-4 text-warning" aria-hidden />
                  : <span className="font-data tabular-nums">{i + 1}.</span>}
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
