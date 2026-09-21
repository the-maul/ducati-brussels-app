/**
 * Écoute les appels de l'extension « DMS Ducati » pour l'import du catalogue Ducati
 * (mission 06) et y répond. Monté une fois dans le shell authentifié, comme MyDucatiListener.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/auth-context';
import { handleCatalogCall, isCatalogCall, type CatalogCallMessage } from '@/modules/catalog/bridge';

export function CatalogImportListener() {
  const { activeCompanyId, activeCompany, isAdmin } = useAuth();
  const qc = useQueryClient();
  const ctxRef = useRef({ companyId: activeCompanyId, companyName: activeCompany?.name ?? null, isAdmin: isAdmin() });
  ctxRef.current = { companyId: activeCompanyId, companyName: activeCompany?.name ?? null, isAdmin: isAdmin() };

  useEffect(() => {
    const handler = async (ev: MessageEvent) => {
      if (!isCatalogCall(ev, window)) return;
      const msg = ev.data as CatalogCallMessage;
      const reply = await handleCatalogCall(msg, ctxRef.current);
      window.postMessage(reply, window.location.origin);
      if (reply.ok && msg.fn !== 'hello') qc.invalidateQueries({ queryKey: ['ducati-catalog'] });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [qc]);
  return null;
}
