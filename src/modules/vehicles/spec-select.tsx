/**
 * Liste déroulante d'une caractéristique de moto. La valeur déjà sur la fiche reste toujours
 * proposée, et « Autre valeur » permet de saisir un cas particulier (moto bridée, couleur spéciale).
 */
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';

const OTHER = '__autre__';

export function SpecSelect({ value, options, onChange, className, numeric = false }: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  className?: string;
  numeric?: boolean;
}) {
  const [typing, setTyping] = useState(false);
  const raw = (value ?? '').trim();
  const shown = numeric && raw !== '' && Number.isFinite(Number(raw)) ? String(Number(raw)) : raw;
  if (typing) {
    return (
      <Input autoFocus type={numeric ? 'number' : 'text'} step={numeric ? '0.01' : undefined} value={value}
        onChange={(e) => onChange(e.target.value)} onBlur={() => setTyping(false)}
        className={`${numeric ? 'text-right tabular-nums' : ''} ${className ?? ''}`} />
    );
  }
  const all = [...new Set([...(shown ? [shown] : []), ...options])];
  return (
    <Select value={shown || undefined} onValueChange={(v) => { if (v === OTHER) setTyping(true); else onChange(v); }}>
      <SelectTrigger className={className}><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        {all.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        <SelectItem value={OTHER}>{t('motoClient.otherValue')}</SelectItem>
      </SelectContent>
    </Select>
  );
}
