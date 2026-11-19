/**
 * Bandeau « Liste de la nuit » des achats et des paniers (réassort minimax en proposition manuelle,
 * décision client Q52 du 19/11/2026). En mode manuel, la tâche de nuit ne met plus rien au panier :
 * elle prépare la liste des pièces passées sous leur minimum. Le lendemain, à l'ouverture d'un écran
 * des achats, la fenêtre « Pièces passées sous leur minimum » s'ouvre d'elle-même (une fois par jour
 * et par poste), et ce bandeau permet de la rouvrir tant qu'il reste des pièces à décider.
 * Mode automatique ou liste vide : rien ne s'affiche. Statut = couleur + icône + libellé.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars } from '@/lib/i18n';
import { getMinimaxNightCount, minimaxNightKey } from './minimax-api';
import { useMinimaxMode } from './minimax-mode-card';
import { nightAutoOpenKey, requestMinimaxNightList, shouldAutoOpenNightList } from './minimax-immediate';

function openedToday(key: string): boolean {
  try { return window.sessionStorage.getItem(key) === '1'; } catch { return false; }
}
function markOpened(key: string): void {
  try { window.sessionStorage.setItem(key, '1'); } catch { /* stockage indisponible : sans effet */ }
}

export function MinimaxNightNotice() {
  const { activeCompanyId } = useAuth();
  const companyId = activeCompanyId ?? '';
  const modeQ = useMinimaxMode(companyId);
  const manual = modeQ.data === 'manuel';
  const countQ = useQuery({
    queryKey: minimaxNightKey(companyId),
    queryFn: () => getMinimaxNightCount(companyId),
    enabled: !!companyId && manual,
  });
  const count = countQ.data ?? 0;

  useEffect(() => {
    if (!companyId || !modeQ.data || countQ.data == null) return;
    const key = nightAutoOpenKey(companyId);
    if (shouldAutoOpenNightList({ mode: modeQ.data, count: countQ.data, alreadyOpenedToday: openedToday(key) })) {
      markOpened(key);
      requestMinimaxNightList(companyId);
    }
  }, [companyId, modeQ.data, countQ.data]);

  if (!manual || count <= 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-warning-bg px-3 py-2 text-[13px] text-warning" role="status">
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span className="font-bold">{fillVars(t('minimax.nightNotice'), { n: count })}</span>
      <Button size="sm" variant="outline" className="ml-auto h-8" onClick={() => requestMinimaxNightList(companyId)}>
        <ListChecks /> {t('minimax.nightOpen')}
      </Button>
    </div>
  );
}
