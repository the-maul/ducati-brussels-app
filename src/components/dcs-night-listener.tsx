/** Answers the extension during the nightly DCS certification (VEH001). Mounted by MyDucatiListener. */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/auth-context';
import { handleDcsNightCall, isDcsNightCall, type DcsNightCall } from '@/modules/vehicles/dcs-night-bridge';

export function DcsNightListener() {
  const { activeCompanyId, isAdmin } = useAuth();
  const qc = useQueryClient();
  const ctxRef = useRef({ companyId: activeCompanyId, isAdmin: isAdmin() });
  ctxRef.current = { companyId: activeCompanyId, isAdmin: isAdmin() };

  useEffect(() => {
    const handler = async (ev: MessageEvent) => {
      if (!isDcsNightCall(ev, window)) return;
      const msg = ev.data as DcsNightCall;
      const reply = await handleDcsNightCall(msg, ctxRef.current);
      window.postMessage(reply, window.location.origin);
      if (msg.fn !== 'hello') qc.invalidateQueries({ queryKey: ['dcs-night'] });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [qc]);
  return null;
}
