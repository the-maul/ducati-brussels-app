/**
 * M8 — Parcours mecanicien, lot C (19/11/2026) : la serie de photos guidee de la reception.
 *
 * Pensee pour la tablette de l'atelier : gros boutons, appareil photo du navigateur
 * (`<input capture="environment">`), une case par photo de la serie (reglage atelier), puis les
 * photos de degats en nombre. Chaque photo peut recevoir un commentaire, plus un commentaire
 * general sur l'etat de la moto. Une photo obligatoire manquante n'empeche jamais de continuer :
 * elle est signalee, et « Plus tard » remet la serie a plus tard.
 *
 *  - `ReceptionSheet` : la fenetre de la serie (fiche OR, et avant « Demarrer »).
 *  - `ReceptionPanel` : le bloc de la fiche OR (etat, vignettes, bouton).
 *  - `PhotoThumb` : vignette d'une photo de la GED (URL signee).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Camera, CheckCircle2, Clock, ImagePlus, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { fill } from '@/modules/catalog/format';
import { t } from '@/lib/i18n';
import {
  addReceptionPhoto, commentReceptionPhoto, getReception, getReceptionSlots, receptionPhotoUrl, receptionSchemaReady,
  removeReceptionPhoto, saveReception,
} from './api';
import {
  DAMAGE_SLOT, arrangePhotos, receptionSummary, receptionTone, slotLabel, type ReceptionPhoto, type ReceptionSlot,
  type ReceptionStatus,
} from './rules';

export type ReceptionAction = 'save' | 'complete' | 'later';

/** Etat de reception d'un OR (schema, serie, photos) : partage par le bloc, la fenetre et le « Demarrer ». */
export function useReception(orId: string, companyId: string | null) {
  const schema = useQuery({ queryKey: ['reception-schema'], queryFn: receptionSchemaReady, staleTime: Infinity });
  const ready = schema.data === true;
  const slots = useQuery({ queryKey: ['reception-slots', companyId], queryFn: () => getReceptionSlots(companyId!), enabled: ready && !!companyId, staleTime: 300_000 });
  const state = useQuery({ queryKey: ['reception', orId], queryFn: () => getReception(orId), enabled: ready });
  const summary = useMemo(
    () => receptionSummary(slots.data ?? [], state.data?.photos ?? []),
    [slots.data, state.data?.photos],
  );
  return {
    ready, loaded: ready && slots.isSuccess && state.isSuccess,
    slots: slots.data ?? [], photos: state.data?.photos ?? [], status: (state.data?.status ?? 'none') as ReceptionStatus,
    comment: state.data?.reception?.general_comment ?? '', summary,
  };
}

/** Vignette d'une photo de la GED (URL signee, 1 h). */
export function PhotoThumb({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const url = useQuery({ queryKey: ['reception-url', path], queryFn: () => receptionPhotoUrl(path), staleTime: 50 * 60_000 });
  if (!url.data) {
    return <div className={`grid place-items-center bg-accent text-muted-foreground ${className ?? ''}`}>{url.isLoading ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-6" aria-hidden />}</div>;
  }
  return (
    <a href={url.data} target="_blank" rel="noopener noreferrer" className={`block overflow-hidden ${className ?? ''}`}>
      <img src={url.data} alt={alt} className="size-full object-cover" loading="lazy" />
    </a>
  );
}

/** Statut de la reception : couleur + icone + libelle. */
export function ReceptionStatusBadge({ status, taken, total, missing }: { status: ReceptionStatus; taken: number; total: number; missing: number }) {
  const tone = receptionTone(status, missing);
  const icon = status === 'complete' ? (missing ? AlertTriangle : CheckCircle2) : status === 'plus_tard' ? Clock : Camera;
  const label = status === 'complete'
    ? (missing ? fill(t('reception.statusCompleteMissing'), { n: missing }) : t('reception.statusComplete'))
    : status === 'plus_tard' ? t('reception.statusLater')
    : status === 'en_cours' ? fill(t('reception.statusProgress'), { taken, total })
    : t('reception.statusNone');
  return <StatusBadge tone={tone} icon={icon} label={label} />;
}

export function ReceptionSheet({ open, orId, orNumber, companyId, startMode, onClose, onDone }: {
  open: boolean;
  orId: string;
  orNumber: string | null;
  companyId: string;
  /** Ouverte avant « Demarrer » : les boutons disent « Demarrer ensuite ». */
  startMode?: boolean;
  onClose: () => void;
  /** Apres « Terminer » ou « Plus tard » (le Demarrer continue). */
  onDone?: (action: ReceptionAction) => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const rec = useReception(orId, companyId);
  const [comment, setComment] = useState('');
  const [target, setTarget] = useState<{ code: string; label: string } | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) setComment(rec.comment); }, [open, rec.comment]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['reception', orId] });
    void qc.invalidateQueries({ queryKey: ['attachments'] });
  };
  const onErr = (e: unknown) => toast.error(e instanceof Error ? e.message : t('workshop.errSave'));

  const add = useMutation({
    mutationFn: (v: { code: string; label: string; file: File }) =>
      addReceptionPhoto({ companyId, orId, slot: v.code, label: v.label, file: v.file }),
    meta: { success: false },
    onSuccess: () => { toast.success(t('reception.photoSaved')); refresh(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeReceptionPhoto(id),
    meta: { success: false },
    onSuccess: refresh,
    onError: onErr,
  });
  const note = useMutation({
    mutationFn: (v: { id: string; comment: string }) => commentReceptionPhoto(v.id, v.comment.trim() || null),
    meta: { success: false },
    onSuccess: refresh,
    onError: onErr,
  });
  const save = useMutation({
    mutationFn: (action: ReceptionAction) => saveReception(orId, comment, action),
    meta: { success: false },
    onSuccess: (r, action) => {
      refresh();
      if (action === 'complete') toast.success(r.missing?.length ? fill(t('reception.completedMissing'), { n: r.missing.length }) : t('reception.completed'));
      else if (action === 'later') toast.success(t('reception.postponed'));
      else toast.success(t('feedback.saved'));
      if (action !== 'save') onDone?.(action);
      if (action !== 'save') onClose();
    },
    onError: onErr,
  });

  const shoot = (code: string, label: string) => {
    setTarget({ code, label });
    // L'input est le meme pour toutes les cases : on vide sa valeur pour reprendre la meme photo.
    if (camRef.current) { camRef.current.value = ''; camRef.current.click(); }
  };

  const arranged = arrangePhotos(rec.slots, rec.photos);
  const missingLabels = rec.summary.missing.map((c) => slotLabel(rec.slots.find((s) => s.code === c) ?? { code: c }, t));
  const busy = add.isPending || save.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Camera className="size-5" aria-hidden /> {fill(t('reception.sheetTitle'), { number: orNumber ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('reception.sheetHint')}</DialogDescription>
        </DialogHeader>

        <input
          ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-hidden tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && target) add.mutate({ code: target.code, label: target.label, file: f });
          }}
        />

        {!rec.loaded ? (
          <div className="grid place-items-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <ReceptionStatusBadge status={rec.status === 'none' ? 'en_cours' : rec.status} taken={rec.summary.taken} total={rec.summary.total} missing={rec.summary.missing.length} />
              {rec.summary.damages > 0 && <span className="text-[13px] text-muted-foreground">{fill(t('reception.damagesCount'), { n: rec.summary.damages })}</span>}
            </div>

            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {arranged.bySlot.map(({ slot, photo }) => (
                <SlotTile
                  key={slot.code} slot={slot} photo={photo} busy={busy && target?.code === slot.code}
                  onShoot={() => shoot(slot.code, slotLabel(slot, t))}
                  onRemove={photo ? async () => { if (await confirm({ message: t('reception.removeConfirm'), variant: 'delete' })) remove.mutate(photo.id); } : undefined}
                  onComment={photo ? (c) => note.mutate({ id: photo.id, comment: c }) : undefined}
                />
              ))}
              {arranged.others.map((photo) => (
                <SlotTile
                  key={photo.id} slot={{ code: photo.slot_code, required: false, label: photo.slot_code }} photo={photo} busy={false}
                  onRemove={async () => { if (await confirm({ message: t('reception.removeConfirm'), variant: 'delete' })) remove.mutate(photo.id); }}
                  onComment={(c) => note.mutate({ id: photo.id, comment: c })}
                />
              ))}
            </ul>

            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('reception.damagesTitle')}</p>
                  <p className="text-[12px] text-muted-foreground">{t('reception.damagesHint')}</p>
                </div>
                <Button variant="outline" className="h-14 text-[15px]" disabled={busy} onClick={() => shoot(DAMAGE_SLOT, t('reception.damage'))}>
                  {add.isPending && target?.code === DAMAGE_SLOT ? <Loader2 className="animate-spin" /> : <ImagePlus />} {t('reception.addDamage')}
                </Button>
              </div>
              {arranged.damages.length ? (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {arranged.damages.map((photo, i) => (
                    <SlotTile
                      key={photo.id} slot={{ code: DAMAGE_SLOT, required: false, label: fill(t('reception.damageN'), { n: i + 1 }) }} photo={photo} busy={false}
                      onRemove={async () => { if (await confirm({ message: t('reception.removeConfirm'), variant: 'delete' })) remove.mutate(photo.id); }}
                      onComment={(c) => note.mutate({ id: photo.id, comment: c })}
                    />
                  ))}
                </ul>
              ) : <p className="text-[13px] text-muted-foreground">{t('reception.noDamage')}</p>}
            </section>

            <section>
              <label htmlFor="reception-comment" className="mb-1 block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('reception.generalComment')}</label>
              <Textarea id="reception-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('reception.generalCommentHint')} className="text-[15px]" />
            </section>

            {rec.summary.missing.length > 0 && (
              <p className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {fill(t('reception.missingWarning'), { list: missingLabels.join(', ') })}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" className="h-14 text-[15px]" disabled={busy || !rec.loaded} onClick={() => save.mutate('later')}>
            <Clock /> {startMode ? t('reception.laterAndStart') : t('reception.later')}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-14 text-[15px]" disabled={busy || !rec.loaded} onClick={() => save.mutate('save')}>{t('action.save')}</Button>
            <Button className="h-14 text-[15px]" disabled={busy || !rec.loaded} onClick={() => save.mutate('complete')}>
              {save.isPending && save.variables === 'complete' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              {startMode ? t('reception.completeAndStart') : t('reception.complete')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SlotTile({ slot, photo, busy, onShoot, onRemove, onComment }: {
  slot: ReceptionSlot;
  photo: ReceptionPhoto | null;
  busy: boolean;
  onShoot?: () => void;
  onRemove?: () => void;
  onComment?: (comment: string) => void;
}) {
  const label = slotLabel(slot, t);
  const [text, setText] = useState(photo?.comment ?? '');
  useEffect(() => { setText(photo?.comment ?? ''); }, [photo?.id, photo?.comment]);
  return (
    <li className={`rounded-md border bg-card p-2 ${photo ? 'border-border' : slot.required ? 'border-warning/50' : 'border-dashed border-border'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[15px] font-bold">{label}</p>
        {photo
          ? <StatusBadge tone="success" icon={CheckCircle2} label={t('reception.taken')} />
          : slot.required ? <StatusBadge tone="warning" icon={AlertTriangle} label={t('reception.required')} />
          : <StatusBadge tone="neutral" icon={Camera} label={t('reception.optional')} />}
      </div>
      {photo ? (
        <>
          <PhotoThumb path={photo.storage_path} alt={label} className="aspect-[4/3] w-full rounded" />
          {onComment && (
            <Textarea
              rows={2} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { if ((photo.comment ?? '') !== text) onComment(text); }}
              placeholder={t('reception.photoCommentHint')} aria-label={fill(t('reception.photoComment'), { photo: label })} className="mt-2 text-[14px]"
            />
          )}
          <div className="mt-2 flex gap-2">
            {onShoot && <Button variant="outline" className="h-12 flex-1 text-[14px]" disabled={busy} onClick={onShoot}><RotateCcw /> {t('reception.retake')}</Button>}
            {onRemove && <Button variant="outline" className="h-12 text-[14px] text-danger" onClick={onRemove} aria-label={t('reception.remove')}><Trash2 /></Button>}
          </div>
        </>
      ) : (
        <Button className="h-20 w-full text-[16px]" variant={slot.required ? 'default' : 'outline'} disabled={busy} onClick={onShoot}>
          {busy ? <Loader2 className="animate-spin" /> : <Camera className="size-6" />} {t('reception.shoot')}
        </Button>
      )}
    </li>
  );
}

/** Bloc de la fiche OR : etat de la reception, vignettes, bouton vers la serie. */
export function ReceptionPanel({ orId, orStatus, companyId, onOpen }: {
  orId: string; orStatus: string; companyId: string; onOpen: () => void;
}) {
  const rec = useReception(orId, companyId);
  if (!rec.ready || !rec.loaded) return null;
  const closed = orStatus === 'facture' || orStatus === 'annule';
  const shown = rec.photos.slice(0, 8);
  return (
    <section className="mb-4 rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('reception.panelTitle')}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ReceptionStatusBadge status={rec.status} taken={rec.summary.taken} total={rec.summary.total} missing={rec.summary.missing.length} />
            {rec.summary.damages > 0 && <span className="text-[12px] text-muted-foreground">{fill(t('reception.damagesCount'), { n: rec.summary.damages })}</span>}
          </div>
        </div>
        {!closed && (
          <Button className="h-12 min-w-[160px] text-[15px]" variant={rec.status === 'complete' ? 'outline' : 'default'} onClick={onOpen}>
            <Camera /> {rec.photos.length ? t('reception.openContinue') : t('reception.open')}
          </Button>
        )}
      </div>
      {rec.comment && <p className="mt-2 whitespace-pre-line text-[14px]">{rec.comment}</p>}
      {shown.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {shown.map((p) => {
            const slot = rec.slots.find((s) => s.code === p.slot_code);
            const label = p.slot_code === DAMAGE_SLOT ? t('reception.damage') : slotLabel(slot ?? { code: p.slot_code }, t);
            return (
              <li key={p.id} className="w-28">
                <PhotoThumb path={p.storage_path} alt={label} className="aspect-[4/3] w-28 rounded border border-border" />
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={p.comment ?? label}>{label}{p.comment ? ` : ${p.comment}` : ''}</p>
              </li>
            );
          })}
          {rec.photos.length > shown.length && <li className="self-center text-[12px] text-muted-foreground">{fill(t('reception.morePhotos'), { n: rec.photos.length - shown.length })}</li>}
        </ul>
      )}
    </section>
  );
}
