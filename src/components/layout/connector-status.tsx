/**
 * Voyant DCS à côté du nom de la société (Simon, 26/11/2026). Vert : une page DCS connectée est
 * ouverte dans ce Chrome. Rouge : le survol dit quoi faire ; un clic ouvre le portail DCS.
 */
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { connectorOk, dcsConnectorState, type DcsConnectorState } from '@/lib/connector-status-rules';
import { sendDcsNightCommand } from '@/modules/vehicles/dcs-night-api';

const DCS_PORTAL_URL = 'https://ducati.my.site.com/dealer/s/';

const HINT: Record<DcsConnectorState, Parameters<typeof t>[0]> = {
  connected: 'dossier.connDcsOk',
  login: 'dossier.connDcsLogin',
  none: 'dossier.connDcsNone',
  no_extension: 'dossier.connDcsNoExt',
  old_extension: 'dossier.connDcsOldExt',
};

export function DcsConnectorStatus() {
  const { activeCompanyId } = useAuth();
  const q = useQuery({
    queryKey: ['connector-status', 'dcs'],
    queryFn: async () => dcsConnectorState(await sendDcsNightCommand('status', activeCompanyId ?? '')),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
  if (!q.data) return null;
  const state = q.data;
  const ok = connectorOk(state);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // Rouge : un clic ouvre le DCS (sa page de connexion si la session n'est pas ouverte).
            onClick={() => { if (!ok) window.open(DCS_PORTAL_URL, '_blank', 'noopener'); }}
            aria-label={`DCS : ${t(HINT[state])}`}
            className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-bold ${ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}
          >
            {ok ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
            DCS
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 text-[12px] leading-snug">{t(HINT[state])}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
