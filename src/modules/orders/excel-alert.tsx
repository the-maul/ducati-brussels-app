/**
 * Alerte verte de la barre du haut (spécification §1.6, point 2) : un onglet du classeur
 * Excel Ducati ouvert a atteint le seuil (2 000 € HTVA par défaut, paramétré dans
 * reference_values order_threshold / excel). Visible des rôles magasinier, vendeur, admin.
 * Rafraîchie toutes les 60 s et à chaque modification faite dans l'écran Commande Excel.
 */
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { supabase } from '@/integrations/supabase/client';
import type { ExcelTab } from './thresholds';

// Volontairement indépendant de excel-api.ts : la barre du haut est chargée sur toutes
// les pages et ne doit pas embarquer la bibliothèque xlsx.
const sb = supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => any };

/** Rôles qui voient l'alerte verte. */
export const EXCEL_ALERT_ROLES = ['magasinier', 'vendeur', 'admin'] as const;

type TabTotal = { tab: ExcelTab; total_value: number; threshold: number; reached: boolean };

async function getExcelTabTotals(companyId: string): Promise<TabTotal[]> {
  const { data, error } = await sb.rpc('excel_order_tab_totals', { _company: companyId });
  if (error) throw error;
  return (data ?? []) as TabTotal[];
}

export function ExcelThresholdAlert() {
  const { activeCompanyId, rolesForActiveCompany } = useAuth();
  const allowed = rolesForActiveCompany.some((r) => (EXCEL_ALERT_ROLES as readonly string[]).includes(r));
  const { data } = useQuery({
    queryKey: ['excel-topbar', activeCompanyId],
    queryFn: () => getExcelTabTotals(activeCompanyId!),
    enabled: !!activeCompanyId && allowed,
    refetchInterval: 60_000,
  });
  const reached = (data ?? []).filter((r) => r.reached);
  if (!allowed || reached.length === 0) return null;
  const tabs = reached.map((r) => t(`orders.tab_${r.tab}`)).join(', ');
  const label = t('orders.excelTopbar').replace('{tabs}', tabs);
  return (
    <Link
      to="/orders/excel"
      title={label}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-success-bg px-2.5 text-[12px] font-semibold text-success hover:opacity-90"
    >
      <CheckCircle2 className="size-4 shrink-0" />
      <span className="hidden max-w-56 truncate md:inline">{label}</span>
    </Link>
  );
}
