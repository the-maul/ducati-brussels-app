/**
 * Hook React (PDV030) : postes de la societe, poste du navigateur (memorise localement) et
 * contexte materiel pret pour printReceipt / openDrawer / printRawLabels.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadDeviceSetup, type DeviceSetup } from './api';
import { getLocalWorkstationId, setLocalWorkstationId, WORKSTATION_EVENT } from './local';
import { EMPTY_DEVICE_CONTEXT, type DeviceContext } from './index';

export const deviceSetupKey = (companyId: string | null | undefined) => ['device-setup', companyId] as const;

export function useDeviceSetup(companyId: string | null | undefined) {
  const query = useQuery<DeviceSetup>({
    queryKey: deviceSetupKey(companyId),
    queryFn: () => loadDeviceSetup(companyId!),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const [localId, setLocalId] = useState<string | null>(() => getLocalWorkstationId(companyId));

  useEffect(() => {
    setLocalId(getLocalWorkstationId(companyId));
    const onChange = () => setLocalId(getLocalWorkstationId(companyId));
    window.addEventListener(WORKSTATION_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => { window.removeEventListener(WORKSTATION_EVENT, onChange); window.removeEventListener('storage', onChange); };
  }, [companyId]);

  const setup = query.data;
  const workstation = useMemo(
    () => setup?.workstations.find((w) => w.id === localId && w.is_active) ?? null,
    [setup, localId],
  );
  const ctx: DeviceContext = useMemo(() => (setup && workstation ? {
    workstation,
    devices: setup.devices.filter((d) => d.workstation_id === workstation.id),
    settings: setup.settings,
  } : { ...EMPTY_DEVICE_CONTEXT, settings: setup?.settings ?? EMPTY_DEVICE_CONTEXT.settings }), [setup, workstation]);

  return {
    ...query,
    setup,
    available: setup?.available ?? false,
    workstation,
    localId,
    ctx,
    setWorkstation: (id: string | null) => { if (companyId) setLocalWorkstationId(companyId, id); },
  };
}
