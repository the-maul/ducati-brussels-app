/**
 * Saisie de téléphone avec préfixe pays (menu déroulant, +32 par défaut).
 * Composant PARTAGÉ (fiches clients, marchands, CRM…). Valeur unique combinée
 * « +32 470 12 34 56 » (préfixe + espace + numéro local). Découpage fiable via
 * dial-codes (plus longue correspondance). Uniformise la saisie dans tout l'ERP.
 *
 * À la sortie du champ, le numéro national est remis en forme (« 0470123456 » →
 * « 470 12 34 56 »). Une saisie qui n'est pas un numéro (lettres, « @ » : e-mail
 * glissé par le remplissage automatique du navigateur) est signalée (aria-invalid,
 * message sous le champ). L'appelant enregistre `toE164(valeur)` (src/lib/phone.ts).
 */
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DIAL_CODES, FAVORITE_DIAL_CODES, splitPhone, joinPhone, dialCodeName } from '@/lib/dial-codes';
import { formatLocalPart, isValidPhone } from '@/lib/phone';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function PhoneInput({ id, name, value, onChange, placeholder, autoComplete, className }: {
  /** id du champ du numéro (pour le <Label htmlFor>). */
  id?: string;
  /** name du champ du numéro : aide le navigateur à ne pas y mettre autre chose. */
  name?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Ex. 'off' sur la borne du comptoir (aucune suggestion du client précédent). */
  autoComplete?: string;
  /** Classes appliquées au menu du préfixe et au champ (ex. hauteur tactile). */
  className?: string;
}) {
  // Découpage FIABLE (plus longue correspondance sur indicatifs connus).
  const { prefix, local } = splitPhone(value);
  const others = DIAL_CODES.filter((d) => !FAVORITE_DIAL_CODES.includes(d.code));
  const known = DIAL_CODES.some((d) => d.code === prefix);
  const invalid = !isValidPhone(value);

  return (
    <div className="space-y-1">
    <div className="flex gap-1">
      <Select value={prefix} onValueChange={(p) => onChange(joinPhone(p, local))}>
        <SelectTrigger className={cn('w-[104px] shrink-0 font-mono sm:w-[124px]', className)} title={t('contacts.phonePrefixHint')}>
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
        id={id}
        name={name}
        className={cn('min-w-0 flex-1', className)}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        value={local}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(joinPhone(prefix, e.target.value))}
        onBlur={() => {
          const pretty = formatLocalPart(prefix, local);
          if (pretty !== local) onChange(joinPhone(prefix, pretty));
        }}
        placeholder={placeholder ?? '470 12 34 56'}
      />
    </div>
    {invalid && <p className="text-[12px] text-danger" role="alert">{t('contacts.phoneInvalid')}</p>}
    </div>
  );
}
