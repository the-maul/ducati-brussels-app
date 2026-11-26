/**
 * Fiche réunie dans une autre (même VIN, Simon 26/11/2026) : la page renvoie vers la fiche gardée
 * au lieu de montrer une fiche vide sur laquelle plus rien ne peut s'enregistrer.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Info, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { t } from '@/lib/i18n';

async function mergedInto(vehicleId: string): Promise<string | null> {
  const { data, error } = await supabase.from('events').select('new_data')
    .eq('entity_type', 'vehicles').eq('entity_id', vehicleId).eq('action', 'vehicle_merged_into')
    .order('occurred_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  const target = (data?.new_data as { merged_into?: unknown } | null)?.merged_into;
  return typeof target === 'string' ? target : null;
}

export function MergedVehicleNotice({ vehicleId }: { vehicleId: string }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['vehicle-merged-into', vehicleId], queryFn: () => mergedInto(vehicleId) });
  const target = q.data ?? null;
  useEffect(() => {
    if (target) void navigate({ to: '/vehicles/$vehicleId', params: { vehicleId: target }, replace: true });
  }, [target, navigate]);
  return (
    <>
      <PageHeader title={t('vehicles.title')} />
      <p role="status" className="inline-flex items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
        {q.isLoading || target ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Info className="size-4" aria-hidden />}
        {t(q.isLoading || target ? 'vehicles.mergedRedirect' : 'vehicles.inactiveRecord')}
      </p>
    </>
  );
}
