/**
 * Choix de langue en quatre boutons (FR / NL / EN / IT), pour les écrans où le CLIENT choisit
 * lui-même : inscription en ligne, borne du comptoir (I18N004). Chaque bouton porte le nom de
 * la langue dans cette langue (« Nederlands », « English »…), lisible quel que soit l'écran.
 * Même rendu que le bloc « Langue » de Mon profil dans l'espace client.
 */
import { LOCALES, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Nom de chaque langue dans sa propre langue : ne dépend pas de la langue active. */
const NATIVE_NAMES: Record<Locale, string> = { fr: 'Français', nl: 'Nederlands', en: 'English', it: 'Italiano' };

export function LocaleButtons({ value, onChange, size = 'default', className }: {
  value: Locale;
  onChange: (locale: Locale) => void;
  size?: 'default' | 'kiosk';
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', className)} role="group">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={value === l}
          onClick={() => onChange(l)}
          className={cn(
            'rounded-md border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            size === 'kiosk' ? 'h-14 text-[17px]' : 'h-11 text-[14px]',
            value === l ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground hover:border-foreground/40',
          )}
        >
          {NATIVE_NAMES[l]}
        </button>
      ))}
    </div>
  );
}
