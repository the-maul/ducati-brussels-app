/**
 * Parametres -> Ecrans clients (PDV020) : les tablettes appairees face au client.
 * Liste (nom, poste, vendeur suivi, dernier signe de vie, etat), renommer, revoquer ; mode d emploi.
 * La revocation est immediate : a sa relecture suivante (5 s au plus) la tablette efface son jeton
 * et revient a l ecran d appairage.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Loader2, MonitorSmartphone, Pencil, Wifi, WifiOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { t, fillVars, getLocale } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { deviceOnline, SCREEN_POLL_MS } from './customer-screen';
import { isMissingFunction, listDevices, renameDevice, revokeDevice, type DeviceRow } from './customer-screen-api';

export function CustomerDisplaysSettings({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({
    queryKey: ['screen-devices', companyId],
    queryFn: () => listDevices(companyId),
    refetchInterval: (query) => (query.state.error ? false : SCREEN_POLL_MS * 2),
    retry: (n, e) => !isMissingFunction(e) && n < 2,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['screen-devices', companyId] });
  const revoke = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => revokeDevice(id),
    onSuccess: () => { toast.success(t('customerScreen.revokedToast')); void refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(`${getLocale()}-BE`) : t('customerScreen.never'));

  return (
    <div className="space-y-6">
      {q.error && isMissingFunction(q.error) && (
        <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('customerScreen.unavailableHint')}</p>
      )}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr className="text-left text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              <th className="px-3 py-2">{t('customerScreen.colName')}</th>
              <th className="px-3 py-2">{t('customerScreen.colRegister')}</th>
              <th className="px-3 py-2">{t('customerScreen.colUser')}</th>
              <th className="px-3 py-2">{t('customerScreen.colLastSeen')}</th>
              <th className="px-3 py-2">{t('customerScreen.colStatus')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {q.data && q.data.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('customerScreen.empty')}</td></tr>}
            {(q.data ?? []).map((d) => (
              <DeviceLine
                key={d.id} d={d} when={when} onRenamed={refresh}
                onRevoke={async () => {
                  if (await confirm({ title: t('customerScreen.revoke'), message: fillVars(t('customerScreen.revokeConfirm'), { name: d.name }), confirmLabel: t('customerScreen.revoke'), variant: 'delete' })) revoke.mutate(d.id);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      <section className="space-y-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h2 className="flex items-center gap-2 font-ui text-[15px] font-bold"><MonitorSmartphone className="size-5 text-primary" /> {t('customerScreen.howTitle')}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>{fillVars(t('customerScreen.how1'), { url: `${origin}/ecran-client` })}</li>
          <li>{t('customerScreen.how2')}</li>
          <li>{t('customerScreen.how3')}</li>
          <li>{t('customerScreen.how4')}</li>
        </ol>
      </section>
    </div>
  );
}

function DeviceLine({ d, when, onRevoke, onRenamed }: { d: DeviceRow; when: (iso: string | null) => string; onRevoke: () => void; onRenamed: () => void }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(d.name);
  const [register, setRegister] = useState(d.register_code);
  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => renameDevice(d.id, name, register),
    onSuccess: () => { toast.success(t('customerScreen.renamed')); setEdit(false); onRenamed(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoked = !!d.revoked_at;
  const online = !revoked && deviceOnline(d.last_seen_at, d.server_now);
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2">{edit ? <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-8" /> : <span className="font-bold">{d.name}</span>}</td>
      <td className="px-3 py-2 font-mono">{edit ? <Input value={register} onChange={(e) => setRegister(e.target.value.toUpperCase())} maxLength={12} className="h-8 w-32 font-mono" /> : d.register_code}</td>
      <td className="px-3 py-2">{d.user_name ?? '—'}</td>
      <td className="px-3 py-2 tabular-nums">{when(d.last_seen_at)}</td>
      <td className="px-3 py-2">
        {revoked
          ? <StatusBadge tone="neutral" icon={Ban} label={t('customerScreen.statusRevoked')} />
          : online
            ? <StatusBadge tone="success" icon={Wifi} label={t('customerScreen.stateOnline')} />
            : <StatusBadge tone="warning" icon={WifiOff} label={t('customerScreen.stateOffline')} />}
      </td>
      <td className="px-3 py-2 text-right">
        {!revoked && (edit ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Check />}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEdit(false); setName(d.name); setRegister(d.register_code); }}><X /></Button>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEdit(true)}><Pencil /> {t('customerScreen.rename')}</Button>
            <Button size="sm" variant="ghost" onClick={onRevoke}><Ban className="text-danger" /> {t('customerScreen.revoke')}</Button>
          </div>
        ))}
      </td>
    </tr>
  );
}
