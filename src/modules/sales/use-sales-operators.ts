/** M6 — Opérateurs de la société et défaut G8 (Q63) pour les écrans de vente. */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/auth-context';
import { defaultOperatorId } from './operators';
import { listSalesOperators } from './operators-api';

/** Opérateurs de la société + défaut (l'utilisateur connecté s'il est opérateur). */
export function useSalesOperators(companyId: string | null | undefined) {
  const { profile, user } = useAuth();
  const q = useQuery({
    queryKey: ['sales-operators', companyId],
    queryFn: () => listSalesOperators(companyId!),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const operators = q.data ?? [];
  const email = profile?.email ?? user?.email ?? null;
  return { operators, defaultId: defaultOperatorId(operators, email), isLoading: q.isLoading };
}
