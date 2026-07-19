/**
 * Saisie de téléphone avec préfixe pays (menu déroulant, +32 par défaut).
 * Composant PARTAGÉ (fiches clients, marchands, CRM…). Valeur unique combinée
 * « +32 470 12 34 56 » (préfixe + espace + numéro local). Découpage fiable via
 * dial-codes (plus longue correspondance). Uniformise la saisie dans tout l'ERP.
 */
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DIAL_CODES, FAVORITE_DIAL_CODES, splitPhone, joinPhone, dialCodeName } from '@/lib/dial-codes';
import { t } from '@/lib/i18n';

export function PhoneInput({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  // Découpage FIABLE (plus longue correspondance sur indicatifs connus).
  const { prefix, local } = splitPhone(value);
  const others = DIAL_CODES.filter((d) => !FAVORITE_DIAL_CODES.includes(d.code));
  const known = DIAL_CODES.some((d) => d.code === prefix);

  return (
    <div className="flex gap-1">
      <Select value={prefix} onValueChange={(p) => onChange(joinPhone(p, local))}>
        <SelectTrigger className="w-[124px] shrink-0 font-mono" title={t('contacts.phonePrefixHint')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {/* Indicatif inconnu (donnée héritée) rendu sélectionnable */}
          {!known && <SelectItem value={prefix}><span className="font-mono">{prefix}</span></SelectItem>}
          <SelectGroup>
            <SelectLabel>{t('contacts.phoneFavorites')}</SelectLabel>
            {FAVORITE_DIAL_CODES.map((c) => (
              <SelectItem key={`fav-${c}`} value={c}>
                <span className="font-mono">{c}</span>{' '}
                <span className="text-muted-foreground">{dialCodeName(c)}</span>
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>{t('contacts.phoneAllCountries')}</SelectLabel>
            {others.map((d) => (
              <SelectItem key={d.code} value={d.code}>
                <span className="font-mono">{d.code}</span>{' '}
                <span className="text-muted-foreground">{d.name}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Input
        className="flex-1"
        value={local}
        onChange={(e) => onChange(joinPhone(prefix, e.target.value))}
        placeholder={placeholder ?? '470 12 34 56'}
      />
    </div>
  );
}
