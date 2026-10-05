/**
 * Espace client — un document déposé par le client (retour de Simon du 05/10).
 *
 * Trois briques, réutilisées par « Mon profil » (permis, carte d'identité) et par
 * la fiche moto (carte grise, assurance, COC, contrôle technique, autres documents) :
 *
 *  - `DocFileTile` : un fichier déposé = une MINIATURE (l'image réduite ; pour un PDF
 *    l'icône de son type avec le nom en petit), « Voir » (image en plein écran, PDF
 *    dans un onglet) et « Supprimer » avec confirmation. La suppression est tracée
 *    dans `events` et le fichier est retiré du stockage (api.ts → portal_delete_upload).
 *  - `DocumentCard` : un document à DEUX FACES (recto + verso), un emplacement par
 *    face, l'état « complet » seulement quand les deux sont là. Un document qui n'a
 *    réellement qu'une face : le client coche « ce document n'a pas de verso » et
 *    l'étape est complète — on ne bloque jamais.
 *  - `OtherDocsCard` : le type « autre » accepte plusieurs fichiers, chacun avec un
 *    libellé saisi par le client.
 *
 * La limite de taille (10 Mo) est annoncée AVANT le choix du fichier ; les images
 * sont réduites à 1 200 px par le navigateur (portal/image.ts).
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Circle, FileQuestion, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/components/confirm-provider';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  backKind, deletePortalUpload, setDocNoBack,
  type DocKind, type PortalFile, type UploadKind,
} from './api';
import { DocThumb, UploadButtons, UploadLimitHint, dateFr, useDocViewer } from './ui';

/** Le dernier fichier vivant d'un type (la liste est déjà triée du plus récent au plus ancien). */
export const lastFileOf = (files: PortalFile[] | undefined, kind: UploadKind) =>
  files?.find((f) => f.kind === kind);

/** Un fichier déposé : miniature, libellé, « Voir », « Supprimer » (avec confirmation). */
export function DocFileTile({ file, onView, onDone, compact }: {
  file: PortalFile; onView: (f: PortalFile) => void; onDone: () => void; compact?: boolean;
}) {
  const confirm = useConfirm();
  // Le toast vient du MutationCache global (`meta`) : ne pas en émettre un second ici.
  const del = useMutation({
    mutationFn: () => deletePortalUpload(file.id),
    meta: { success: t('portal.upload.deleted') },
    onSuccess: onDone,
  });

  const remove = async () => {
    const ok = await confirm({
      variant: 'delete',
      title: t('portal.upload.deleteTitle'),
      message: t('portal.upload.deleteText').replace('{name}', file.label || file.file_name),
      confirmLabel: t('portal.upload.deleteConfirm'),
    });
    if (ok) del.mutate();
  };

  return (
    <div className={cn('flex items-center gap-3 rounded-md border border-border bg-card p-2', compact && 'p-1.5')}>
      <button type="button" onClick={() => onView(file)} className="shrink-0 rounded-md"
        aria-label={t('portal.upload.view')}>
        <DocThumb file={file} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{file.label || file.file_name}</p>
        <p className="text-[12px] text-muted-foreground">{dateFr(file.created_at)}</p>
        <button type="button" onClick={() => onView(file)}
          className="text-[13px] font-medium text-info underline-offset-2 hover:underline">
          {t('portal.upload.view')}
        </button>
      </div>
      <Button type="button" variant="ghost" size="icon" className="shrink-0 text-danger"
        aria-label={t('portal.upload.delete')} title={t('portal.upload.delete')}
        disabled={del.isPending} onClick={remove}>
        {del.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
      </Button>
    </div>
  );
}

/** Une face d'un document : le fichier déposé, ou les boutons de dépôt. */
function Side({ kind, vehicleId, title, file, onView, onDone }: {
  kind: UploadKind; vehicleId: string | null; title: string;
  file: PortalFile | undefined; onView: (f: PortalFile) => void; onDone: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-medium">{title}</p>
        {file
          ? <span className="flex items-center gap-1 text-[12px] text-success"><CheckCircle2 className="size-4" aria-hidden /> {t('portal.docs.sideDone')}</span>
          : <span className="flex items-center gap-1 text-[12px] text-muted-foreground"><Circle className="size-4" aria-hidden /> {t('portal.docs.sideMissing')}</span>}
      </div>
      {file
        ? <DocFileTile file={file} onView={onView} onDone={onDone} compact />
        : <UploadButtons kind={kind} vehicleId={vehicleId} onDone={onDone} compact />}
    </div>
  );
}

/**
 * Un document à deux faces. `kind` est la face RECTO (`permis`, `carte_identite`,
 * `carte_grise`, `assurance`, `coc`, `controle_technique`) ; le verso est `${kind}_verso`.
 */
export function DocumentCard({ kind, vehicleId, files, noBack, onDone, onView }: {
  kind: DocKind; vehicleId: string | null; files: PortalFile[] | undefined;
  noBack: DocKind[] | undefined; onDone: () => void; onView: (f: PortalFile) => void;
}) {
  const front = lastFileOf(files, kind);
  const back = lastFileOf(files, backKind(kind));
  const declaredNoBack = !!noBack?.includes(kind);
  const complete = !!front && (!!back || declaredNoBack);

  // L'emplacement du verso change à vue : pas de notification de succès.
  const flag = useMutation({
    mutationFn: (v: boolean) => setDocNoBack(kind, vehicleId, v),
    meta: { success: false },
    onSuccess: onDone,
  });

  return (
    <li id={kind} className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {complete
          ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
          : <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="flex-1 text-[14px] font-medium">{t(`portal.docKinds.${kind}`)}</span>
        <span className={cn('text-[12px]', complete ? 'text-success' : 'text-warning')}>
          {complete ? t('portal.docs.complete') : t('portal.docs.incomplete')}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Side kind={kind} vehicleId={vehicleId} title={t('portal.docs.front')}
          file={front} onView={onView} onDone={onDone} />
        {declaredNoBack ? (
          <div className="space-y-2 rounded-md border border-dashed border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[14px] font-medium">{t('portal.docs.back')}</p>
              <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                <FileQuestion className="size-4" aria-hidden /> {t('portal.docs.noBackSet')}
              </span>
            </div>
            <p className="text-[12px] text-muted-foreground">{t('portal.docs.noBackHint')}</p>
          </div>
        ) : (
          <Side kind={backKind(kind)} vehicleId={vehicleId} title={t('portal.docs.back')}
            file={back} onView={onView} onDone={onDone} />
        )}
      </div>

      <UploadLimitHint />

      {/* « Pas de verso » : jamais proposé si un verso est déjà déposé. */}
      {!back && (
        <label className="flex items-start justify-between gap-3">
          <span className="text-[13px]">
            {t('portal.docs.noBack')}
            <span className="block text-[12px] text-muted-foreground">{t('portal.docs.noBackLead')}</span>
          </span>
          <Switch checked={declaredNoBack} disabled={flag.isPending}
            onCheckedChange={(v) => flag.mutate(v)}
            aria-label={t('portal.docs.noBack')} />
        </label>
      )}
    </li>
  );
}

/**
 * « Autres documents » : autant de fichiers que voulu, chacun avec un libellé
 * saisi par le client (retour Simon 05/10, point 6).
 */
export function OtherDocsCard({ vehicleId, files, onDone, onView }: {
  vehicleId: string | null; files: PortalFile[] | undefined; onDone: () => void; onView: (f: PortalFile) => void;
}) {
  const [label, setLabel] = useState('');
  const others = (files ?? []).filter((f) => f.kind === 'autre');

  return (
    <li id="autre" className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-[14px] font-medium">{t('portal.docKinds.autre')}</span>
        {others.length > 0 && (
          <span className="text-[12px] text-muted-foreground">
            {t('portal.docs.otherCount').replace('{n}', String(others.length))}
          </span>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground">{t('portal.docs.otherHint')}</p>

      {others.length > 0 && (
        <ul className="space-y-2">
          {others.map((f) => (
            <li key={f.id}>
              <DocFileTile file={f} onView={onView} onDone={onDone} />
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`other-label-${vehicleId ?? 'me'}`} className="text-[13px] font-medium">
          {t('portal.docs.otherLabel')}
        </Label>
        <Input id={`other-label-${vehicleId ?? 'me'}`} className="h-11" value={label} maxLength={120}
          placeholder={t('portal.docs.otherLabelPlaceholder')} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <UploadButtons kind="autre" vehicleId={vehicleId} label={label}
        onDone={() => { setLabel(''); onDone(); }} compact />
      <UploadLimitHint />
    </li>
  );
}

/** Fournit le visualiseur plein écran aux écrans qui affichent des documents. */
export { useDocViewer };
