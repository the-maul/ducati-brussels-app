/**
 * Bandeau « Société de test » (lot ItalTest, COM005) : visible en haut de toutes les pages tant que
 * la société active est une société de test. Couleur d'avertissement de la charte (pas le rouge
 * Ducati), icône + libellé + explication (statut = couleur + icône + libellé).
 */
import { FlaskConical } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars } from '@/lib/i18n';

export function TestCompanyBanner() {
  const { activeCompany } = useAuth();
  if (!activeCompany?.is_test) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning bg-warning-bg px-4 py-2 text-[13px] text-warning md:px-6"
    >
      <span className="inline-flex items-center gap-2 font-bold uppercase tracking-[0.04em]">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        {t('testCompany.bannerTitle')}
      </span>
      <span className="text-foreground">{fillVars(t('testCompany.bannerText'), { name: activeCompany.name })}</span>
    </div>
  );
}
