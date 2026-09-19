/**
 * Mission 04, carte 8 — écran équipe « Motos déclarées à valider » (Véhicules).
 * Pour chaque moto déclarée par un client : la moto du parc qui porte le même VIN ou la
 * même plaque (sinon rien), et trois choix : « Rattacher à cette moto », « Créer la fiche
 * moto » (formulaire de la carte 6 pré-rempli + lien propriétaire), « Ignorer ».
 * Tout est tracé dans events ; la moto n'entre jamais dans le parc sans ce choix.
 */
import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, Clock, EyeOff, FileText, Link2, Loader2, Plus, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { signedUrl } from '@/modules/documents/ged-api';
import { t } from '@/lib/i18n';
import { vehicleLabel } from './api';
import {
  attachDeclaration, ignoreDeclaration, listPendingDeclarations, type PendingDeclaration,
} from './declarations-api';

const fmtDate = (iso: string) => new Date(iso).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' });

export function DeclaredVehiclesView({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['declared-vehicles', companyId],
    queryFn: () => listPendingDeclarations(companyId),
  });
  const [ignoring, setIgnoring] = useState<PendingDeclaration | null>(null);
  const [note, setNote] = useState('');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['declared-vehicles'] });
    qc.invalidateQueries({ queryKey: ['vehicles'] });
    qc.invalidateQueries({ queryKey: ['client-parc'] });
  };
  const attach = useMutation({
    mutationFn: ({ d, vehicleId }: { d: PendingDeclaration; vehicleId: string }) => attachDeclaration(d.id, vehicleId),
    onSuccess: () => { refresh(); toast.success(t('motoClient.attached')); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const ignore = useMutation({
    mutationFn: ({ d, n }: { d: PendingDeclaration; n: string }) => ignoreDeclaration(d.id, n.trim() || null),
    onSuccess: () => { refresh(); setIgnoring(null); setNote(''); toast.success(t('motoClient.declIgnored')); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const openScan = async (path: string) => {
    const win = window.open('', '_blank');
    try {
      const url = await signedUrl(path);
      if (win && url) win.location.href = url;
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  if (isLoading) return <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error instanceof Error ? error.message : String(error)}</p>;
  if (!data || data.length === 0) {
    return <div className="rounded-md border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">{t('motoClient.declEmpty')}</div>;
  }

  return (
    <div className="space-y-3">
      {data.map((d) => (
        <section key={d.id} className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-start gap-3">
            <Bike className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-[15px] font-bold">
                {[d.brand, d.model].filter(Boolean).join(' ') || '—'}
                {d.model_year ? <span className="font-normal text-muted-foreground"> · {t('motoClient.declYear')}{d.model_year}</span> : null}
              </p>
              <p className="flex flex-wrap items-center gap-1 text-[13px]">
                <User className="size-3.5 text-muted-foreground" aria-hidden />
                <Link to="/clients/$contactId" params={{ contactId: d.contact_id }} className="font-medium text-info underline-offset-2 hover:underline">
                  {d.contact_name ?? '—'}
                </Link>
                <span className="text-muted-foreground">
                  · {t('motoClient.declDeclaredOn')}{fmtDate(d.created_at)} ({t(`motoClient.declSource_${d.source}`)})
                </span>
              </p>
              <p className="font-mono text-[12px] text-muted-foreground">
                {d.vin || d.plate
                  ? [d.vin && `${t('motoClient.declVin')}${d.vin}`, d.plate && `${t('motoClient.declPlate')}${d.plate}`].filter(Boolean).join(' · ')
                  : t('motoClient.declNoVinPlate')}
              </p>
            </div>
            <StatusBadge tone="warning" icon={Clock} label={t('motoClient.declStatus')} />
          </div>

          {d.registration && (
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => openScan(d.registration!.path)}>
              <FileText /> {t('motoClient.declSeeCg')}
            </Button>
          )}

          <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('motoClient.declCandidates')}</p>
            {d.candidates.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{t('motoClient.declNoCandidate')}</p>
            ) : (
              <ul className="space-y-2">
                {d.candidates.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <StatusBadge tone="info" icon={Link2} label={t(`motoClient.declMatch_${c.match}`)} />
                    <Link to="/vehicles/$vehicleId" params={{ vehicleId: c.id }} className="font-medium text-info underline-offset-2 hover:underline">
                      {vehicleLabel(c)}
                    </Link>
                    <span className="font-mono text-[12px]">{[c.vin, c.plate].filter(Boolean).join(' · ')}</span>
                    <span className="text-[12px] text-muted-foreground">
                      {t('motoClient.declAttachConfirm')}{c.owner_name ?? t('motoClient.noOwner')}
                    </span>
                    <Button type="button" size="sm" className="ml-auto" disabled={attach.isPending}
                      onClick={() => attach.mutate({ d, vehicleId: c.id })}>
                      {attach.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} {t('motoClient.declAttach')}
                    </Button>
                    {c.owner_id && c.owner_id !== d.contact_id && (
                      <span className="w-full text-[12px] text-muted-foreground">{t('motoClient.attachReplaces')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setIgnoring(d); setNote(''); }}>
              <EyeOff /> {t('motoClient.declIgnore')}
            </Button>
            <Button type="button" onClick={() => navigate({ to: '/vehicles/new', search: { contact: d.contact_id, declaration: d.id } })}>
              <Plus /> {t('motoClient.declCreate')}
            </Button>
          </div>
        </section>
      ))}

      <Dialog open={!!ignoring} onOpenChange={(o) => { if (!o) setIgnoring(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('motoClient.declIgnoreTitle')}</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">{t('motoClient.declIgnoreHint')}</p>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('motoClient.declIgnoreNote')}</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIgnoring(null)}>{t('action.cancel')}</Button>
            <Button type="button" disabled={ignore.isPending} onClick={() => ignoring && ignore.mutate({ d: ignoring, n: note })}>
              {ignore.isPending ? <Loader2 className="animate-spin" /> : <EyeOff />} {t('motoClient.declIgnore')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
