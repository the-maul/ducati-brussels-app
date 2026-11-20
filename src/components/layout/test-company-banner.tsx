/**
 * Bandeau « Société de test » (lot ItalTest, COM005) : visible en haut de toutes les pages tant que
 * la société active est une société de test. Couleur d'avertissement de la charte (pas le rouge
 * Ducati), icône + libellé (statut = couleur + icône + libellé).
 *
 * Revue UX/UI (20/11/2026) : une seule ligne jaune au lieu de 70 px de texte permanent ; le « ? »
 * déplie l'explication (et la replie). Replié à l'ouverture de l'application : la ligne jaune suffit
 * à rappeler qu'on est dans la société de test.
 */
import { useId, useState } from 'react';
import { FlaskConical, HelpCircle, X } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars } from '@/lib/i18n';

export function TestCompanyBanner() {
  const { activeCompany } = useAuth();
  const [open, setOpen] = useState(false);
  const textId = useId();
  if (!activeCompany?.is_test) return null;
  return (
    <div role="status" className="border-b border-warning bg-warning-bg px-4 text-[13px] text-warning md:px-6">
      <div className="flex min-h-8 items-center gap-2">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate font-bold uppercase tracking-[0.04em]">
          {t('testCompany.bannerTitle')}
          <span className="font-normal normal-case tracking-normal text-foreground"> · {activeCompany.name}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={textId}
          title={open ? t('designTransverse.testBanner.less') : t('designTransverse.testBanner.more')}
          className="ml-auto grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-warning hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning pointer-coarse:size-11"
        >
          {open ? <X className="size-4" aria-hidden /> : <HelpCircle className="size-4" aria-hidden />}
          <span className="sr-only">{open ? t('designTransverse.testBanner.less') : t('designTransverse.testBanner.more')}</span>
        </button>
      </div>
      {open && (
        <p id={textId} className="pb-2 text-foreground">
          {fillVars(t('testCompany.bannerText'), { name: activeCompany.name })}
        </p>
      )}
    </div>
  );
}
