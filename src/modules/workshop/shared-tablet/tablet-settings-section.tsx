/**
 * M8 — Q60 (20/11/2026) : Planning → Reglages → « Tablettes de l'atelier ».
 *  - Ce poste : « Cette tablette est partagee » (ce navigateur seulement) ;
 *  - Comptes : mode personnel ou partage, par compte (admin / chef d'atelier). Le compte
 *    « tablette atelier » est cree par l'administrateur (role mecanicien), jamais par le DMS ;
 *  - Codes des compagnons : 4 chiffres, poses par le chef d'atelier (jamais relus ni affiches) ;
 *  - Duree de l'identite collee (120 s par defaut).
 * Migration 20261120100000 absente : un message, rien d'autre.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Tablet, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { useAuth } from '@/lib/auth/auth-context';
import { fillVars, t } from '@/lib/i18n';
import { Field } from '../planning/ui-bits';
import { getTabletMode, listSharedMechanics, listTabletAccounts, saveSharedIdentitySeconds, setMechanicPin, setTabletMode } from './api';
import { isPinValue, type TabletMode } from './rules';
import { writePosteShared } from './store';
import { useSharedTablet } from './shared-tablet-provider';

export function TabletSettingsSection({ companyId }: { companyId: string; mechanics?: unknown[] }) {
  const { rolesForActiveCompany } = useAuth();
  const canManage = rolesForActiveCompany.includes('admin') || rolesForActiveCompany.includes('chef_atelier');
  const qc = useQueryClient();
  const tablet = useSharedTablet();
  const mode = useQuery({ queryKey: ['tablet-mode', companyId], queryFn: () => getTabletMode(companyId), staleTime: 60_000 });
  const accounts = useQuery({ queryKey: ['tablet-accounts', companyId], queryFn: () => listTabletAccounts(companyId), enabled: canManage && !!mode.data?.ready, retry: false });
  const mechs = useQuery({ queryKey: ['shared-mechanics', companyId], queryFn: () => listSharedMechanics(companyId), enabled: !!mode.data?.ready });
  const [ttl, setTtl] = useState('120');
  useEffect(() => { if (mode.data) setTtl(String(mode.data.ttlSeconds)); }, [mode.data]);
  const [pins, setPins] = useState<Record<string, string>>({});

  const setMode = useMutation({
    mutationFn: (v: { userId: string; mode: TabletMode }) => setTabletMode(companyId, v.userId, v.mode),
    onSuccess: (r) => {
      toast.success(r.mechanic_card_hidden ? t('sharedTablet.modeSavedHidden') : t('feedback.saved'));
      void accounts.refetch();
      for (const k of [['tablet-mode'], ['shared-mechanics'], ['planning-g8']]) void qc.invalidateQueries({ queryKey: k });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')),
  });
  const savePin = useMutation({
    mutationFn: (v: { id: string; pin: string | null }) => {
      if (v.pin !== null && !isPinValue(v.pin)) throw new Error(t('sharedTablet.pinInvalid'));
      return setMechanicPin(v.id, v.pin);
    },
    onSuccess: (r, v) => {
      toast.success(r.status === 'set' ? t('sharedTablet.pinSaved') : t('sharedTablet.pinCleared'));
      setPins((p) => ({ ...p, [v.id]: '' }));
      void mechs.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')),
  });
  const saveTtl = useMutation({
    mutationFn: () => saveSharedIdentitySeconds(companyId, Number(ttl)),
    onSuccess: () => { toast.success(t('feedback.saved')); void qc.invalidateQueries({ queryKey: ['tablet-mode'] }); },
    onError: () => toast.error(t('sharedTablet.ttlInvalid')),
  });

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-[17px] font-bold"><Tablet className="size-5" aria-hidden /> {t('sharedTablet.settingsTitle')}</h2>
      <p className="mb-3 text-[13px] text-muted-foreground">{t('sharedTablet.settingsHint')}</p>
      {mode.data && !mode.data.ready && <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('sharedTablet.migrationMissing')}</p>}
      {mode.data?.ready && (
        <div className="space-y-4">
          <label className="flex items-center gap-3 text-[15px]">
            <Checkbox checked={tablet.posteShared} onCheckedChange={(v) => writePosteShared(v === true)} />
            <span>{t('sharedTablet.posteLabel')}</span>
            {tablet.shared && <StatusBadge tone="info" icon={Tablet} label={t('sharedTablet.badge')} />}
          </label>
          <p className="-mt-2 text-[12px] text-muted-foreground">{t('sharedTablet.posteHint')}</p>

          {canManage && (
            <>
              <div>
                <h3 className="mb-1 text-[15px] font-bold">{t('sharedTablet.accountsTitle')}</h3>
                <p className="mb-2 text-[12px] text-muted-foreground">{t('sharedTablet.accountsHint')}</p>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t('sharedTablet.colAccount')}</TableHead>
                    <TableHead>{t('sharedTablet.colRoles')}</TableHead>
                    <TableHead className="w-[220px]">{t('sharedTablet.colMode')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(accounts.data ?? []).map((a) => (
                      <TableRow key={a.user_id}>
                        <TableCell><div className="font-medium">{a.name}</div>{a.email && <div className="text-[12px] text-muted-foreground">{a.email}</div>}</TableCell>
                        <TableCell className="text-[13px]">{a.roles.map((r) => t(`role.${r}`)).join(', ')}</TableCell>
                        <TableCell>
                          <Select value={a.mode} onValueChange={(v) => setMode.mutate({ userId: a.user_id, mode: v as TabletMode })} disabled={setMode.isPending}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="personal">{t('sharedTablet.mode_personal')}</SelectItem>
                              <SelectItem value="shared">{t('sharedTablet.mode_shared')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="mb-1 text-[15px] font-bold">{t('sharedTablet.pinsTitle')}</h3>
                <p className="mb-2 text-[12px] text-muted-foreground">{t('sharedTablet.pinsHint')}</p>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t('sharedTablet.colMechanic')}</TableHead>
                    <TableHead>{t('sharedTablet.colCode')}</TableHead>
                    <TableHead className="w-[320px]" />
                  </TableRow></TableHeader>
                  <TableBody>
                    {(mechs.data ?? []).map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell>
                          {m.has_pin ? <StatusBadge tone="success" icon={KeyRound} label={t('sharedTablet.pinSet')} />
                            : m.has_pointeuse_code ? <StatusBadge tone="info" icon={KeyRound} label={t('sharedTablet.pinPointeuse')} />
                            : <StatusBadge tone="warning" icon={KeyRound} label={t('sharedTablet.pinNone')} />}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Input value={pins[m.id] ?? ''} onChange={(e) => setPins((p) => ({ ...p, [m.id]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                              inputMode="numeric" autoComplete="off" type="password" placeholder="••••" className="w-24 text-center font-data tabular-nums"
                              aria-label={fillVars(t('sharedTablet.pinFor'), { name: m.name })} />
                            <Button size="sm" onClick={() => savePin.mutate({ id: m.id, pin: pins[m.id] ?? '' })} disabled={savePin.isPending || !isPinValue(pins[m.id] ?? '')}>
                              {t('sharedTablet.pinSave')}
                            </Button>
                            {m.has_pin && (
                              <Button size="sm" variant="ghost" onClick={() => savePin.mutate({ id: m.id, pin: null })} disabled={savePin.isPending} aria-label={t('sharedTablet.pinClear')}>
                                <Trash2 className="size-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Field label={t('sharedTablet.ttlLabel')}>
                  <Input type="number" min={30} max={900} step={10} inputMode="numeric" value={ttl} onChange={(e) => setTtl(e.target.value)} className="text-right tabular-nums" />
                </Field>
                <div className="self-end"><Button size="sm" onClick={() => saveTtl.mutate()} disabled={saveTtl.isPending}>{t('action.save')}</Button></div>
                <p className="col-span-2 self-end pb-2 text-[12px] text-muted-foreground md:col-span-3">{t('sharedTablet.ttlHint')}</p>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
