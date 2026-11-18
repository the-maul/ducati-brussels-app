/**
 * Nouvelle cession interne / O.R.O (G8 : Creation → type de cession, operateur, produit fini
 * par n° de serie). La moto est facultative (vol / casse, besoin atelier) ; une remise en etat
 * est possible sur n'importe quelle moto du parc (pas seulement une reprise).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { listRef } from '@/modules/settings/reference-api';
import { listVehicles } from '@/modules/vehicles/api';
import { listCompanyTeam } from '@/modules/workshop/or-page-api';
import { openCession, readCessionSettings } from './api';

export type PresetVehicle = { id: string; label: string };

export function CessionNewDialog({ open, onOpenChange, companyId, vehicle, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string;
  vehicle?: PresetVehicle | null;
  onCreated: (id: string) => void;
}) {
  const { user } = useAuth();
  const types = useQuery({ queryKey: ['cession-types', companyId], queryFn: () => listRef(companyId, 'cession_type'), enabled: open });
  const team = useQuery({ queryKey: ['company-team', companyId], queryFn: () => listCompanyTeam(companyId), enabled: open });
  const settings = useQuery({ queryKey: ['cession-settings', companyId], queryFn: () => readCessionSettings(companyId), enabled: open });

  const [type, setType] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [work, setWork] = useState('');
  const [veh, setVeh] = useState<PresetVehicle | null>(vehicle ?? null);
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const found = useQuery({ queryKey: ['cession-veh-search', companyId, deb], queryFn: () => listVehicles(companyId, deb), enabled: open && deb.length >= 3 });

  // Type par defaut : celui de la reprise (01 Cession VO) quand une moto est donnee.
  useEffect(() => {
    if (!type && settings.data && types.data?.length) {
      const preset = vehicle ? settings.data.values.reprise_cession_type : '';
      const ok = types.data.find((r) => r.code === preset && r.is_active);
      if (ok) setType(ok.code);
    }
  }, [type, settings.data, types.data, vehicle]);
  useEffect(() => {
    if (!operatorId && user && team.data?.some((m) => m.user_id === user.id)) setOperatorId(user.id);
  }, [operatorId, user, team.data]);

  const create = useMutation({
    meta: { success: false },
    mutationFn: () => openCession({
      companyId, type, vehicleId: veh?.id ?? null, operatorId: operatorId || null,
      operatorName: team.data?.find((m) => m.user_id === operatorId)?.name ?? null, work,
    }),
    onSuccess: (id) => { onOpenChange(false); onCreated(id); },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('cession.newTitle')}</DialogTitle>
          <DialogDescription>{t('cession.newHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('cession.type')}>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue placeholder={t('cession.choose')} /></SelectTrigger>
              <SelectContent>
                {(types.data ?? []).filter((r) => r.is_active).map((r) => (
                  <SelectItem key={r.code} value={r.code}>{r.code} · {r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('cession.operator')}>
            <Select value={operatorId} onValueChange={setOperatorId}>
              <SelectTrigger><SelectValue placeholder={t('cession.choose')} /></SelectTrigger>
              <SelectContent>{(team.data ?? []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('cession.vehicle')}>
            {veh ? (
              <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                <span className="truncate">{veh.label}</span>
                {!vehicle && <button type="button" className="ml-auto text-muted-foreground" onClick={() => setVeh(null)} aria-label={t('cession.clear')}><X className="size-4" /></button>}
              </div>
            ) : (
              <div className="relative">
                <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('cession.vehicleSearch')} />
                {deb.length >= 3 && (found.data ?? []).length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
                    {(found.data ?? []).slice(0, 15).map((v) => {
                      const label = [v.brand, v.model, v.vin ?? v.plate].filter(Boolean).join(' · ');
                      return (
                        <button key={v.id} type="button" onClick={() => { setVeh({ id: v.id, label }); setTerm(''); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <p className="mt-1 text-[12px] text-muted-foreground">{t('cession.vehicleOptional')}</p>
          </Field>
          <Field label={t('cession.work')}>
            <Textarea value={work} onChange={(e) => setWork(e.target.value)} rows={2} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cession.cancelBtn')}</Button>
          <Button onClick={() => create.mutate()} disabled={!type || create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('cession.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
