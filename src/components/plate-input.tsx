/** Champ plaque : 7 lettres ou chiffres en majuscules, sauf plaque personnalisée (Simon, 23/11/2026). */
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';
import { plateInput } from '@/lib/plate';

export function PlateInput({ value, onChange, className = '' }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [custom, setCustom] = useState(false);
  return (
    <div className="space-y-1">
      <Input value={value} onChange={(e) => onChange(plateInput(e.target.value, custom))} className={`font-mono ${className}`}
        autoCapitalize="characters" spellCheck={false} />
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <input type="checkbox" checked={custom} className="size-3.5 accent-[var(--ducati-red)] pointer-coarse:size-5"
          onChange={(e) => { const next = e.target.checked; setCustom(next); if (!next) onChange(plateInput(value, false)); }} />
        {t('dossier.plateCustom')}
      </label>
    </div>
  );
}
