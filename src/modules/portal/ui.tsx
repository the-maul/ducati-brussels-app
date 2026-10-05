/**
 * Briques d'affichage du portail client (téléphone d'abord).
 * Couleurs uniquement via les tokens ; le rouge Ducati (primary) n'est utilisé que
 * pour les actions principales, jamais pour un statut (charte, CLAUDE.md règle 9).
 */
import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, ChevronDown, FileText, ImageIcon, Loader2, Upload, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { openFile, signedFileUrl, uploadPortalFile, type PortalFile, type UploadKind } from './api';
import { MAX_UPLOAD_LABEL } from './image';

// ---------------------------------------------------------------- formats
export const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(Number(n ?? 0));
export const dateFr = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
export const dateLongFr = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
export const timeFr = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '';
export const km = (n: number | null | undefined) =>
  n == null ? '' : `${new Intl.NumberFormat('fr-BE').format(n)} km`;
export const vehicleName = (v: { brand?: string | null; model?: string | null } | null | undefined) =>
  [v?.brand, v?.model].filter(Boolean).join(' ') || t('portal.vehicles.unnamed');

// ---------------------------------------------------------------- statuts
const APPT_TONES: Record<string, StatusTone> = {
  demande: 'warning', prevu: 'info', arrive: 'info', en_cours: 'info', termine: 'success', annule: 'neutral',
};
export function AppointmentStatus({ status }: { status: string }) {
  return <StatusBadge tone={APPT_TONES[status] ?? 'neutral'} label={t(`portal.apptStatus.${status}`)} />;
}

const REPAIR_TONES: Record<string, StatusTone> = {
  a_faire: 'info', en_cours: 'info', pret: 'success', facture: 'success', annule: 'neutral',
};
export function RepairStatus({ status }: { status: string }) {
  return <StatusBadge tone={REPAIR_TONES[status] ?? 'neutral'} label={t(`portal.repairStatus.${status}`)} />;
}

export function InvoiceStatus({ status, docType, due }: { status: string; docType: string; due: number }) {
  if (docType === 'AVO') return <StatusBadge tone="neutral" label={t('portal.invoices.creditNote')} />;
  if (status === 'annulee') return <StatusBadge tone="neutral" label={t('portal.invoices.status_annulee')} />;
  if (status !== 'payee' && due > 0.005) return <StatusBadge tone="warning" label={t('portal.invoices.status_due')} />;
  return <StatusBadge tone="success" label={t('portal.invoices.status_paid')} />;
}

// ---------------------------------------------------------------- mise en page
export function PortalPage({ title, subtitle, actions, children }: {
  title: string; subtitle?: string; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-7 text-foreground">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-md border border-border bg-card p-4', className)}>{children}</section>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</h2>
      {action}
    </div>
  );
}

/**
 * Carte repliable : sur un téléphone, les longues sections (documents du
 * véhicule, entretiens) doivent pouvoir se replier. Le choix du client est
 * retenu sur son appareil ; `hint` donne un repère quand c'est replié
 * (nombre de documents, dernier entretien…).
 */
export function CollapsibleCard({
  id, title, hint, defaultOpen = true, className, children,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const key = `ducati.portal.section.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) return v === '1';
    } catch { /* navigation privée : on garde le défaut */ }
    return defaultOpen;
  });
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(key, o ? '0' : '1'); } catch { /* idem */ }
      return !o;
    });
  };
  return (
    <Card className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <h2 className="flex-1 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{title}</h2>
        {hint != null && <span className="shrink-0 text-[12px] text-muted-foreground">{hint}</span>}
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </Card>
  );
}

export function Loading() {
  return (
    <div className="grid place-items-center py-12">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : t('portal.errors.generic');
  return <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger" role="alert">{msg}</p>;
}

export function EmptyState({ icon, text, action }: { icon?: ReactNode; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card px-4 py-8 text-center">
      {icon && <div className="text-muted-foreground">{icon}</div>}
      <p className="text-[14px] text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

/** Couleur d'une progression : jamais le rouge Ducati (réservé aux actions). */
export type ProgressTone = 'warning' | 'info' | 'success';

/** Moins de la moitié : à faire (orange) ; en cours (bleu) ; complet (vert). */
export function progressTone(value: number): ProgressTone {
  if (value >= 100) return 'success';
  if (value >= 50) return 'info';
  return 'warning';
}

const BAR_TONES: Record<ProgressTone, string> = {
  warning: 'bg-warning',
  info: 'bg-info',
  success: 'bg-success',
};

/** Barre de progression, colorée selon l'avancement (tokens de la charte). */
export function ProgressBar({ value, label, tone }: { value: number; label?: string; tone?: ProgressTone }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cn('h-full rounded-full transition-all', BAR_TONES[tone ?? progressTone(v)])} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- images signées
/** Image du bucket privé, via une URL signée de 5 minutes (renouvelée par la requête). */
export function SignedImage({ path, alt, className, fallback }: {
  path: string | null | undefined; alt: string; className?: string; fallback?: ReactNode;
}) {
  const { data } = useQuery({
    queryKey: ['portal', 'signed', path],
    queryFn: () => signedFileUrl(path!),
    enabled: !!path,
    staleTime: 4 * 60_000,
    retry: false,
  });
  if (!path || !data) return <>{fallback ?? null}</>;
  return <img src={data} alt={alt} className={className} loading="lazy" />;
}

export function Avatar({ path, name, size = 'md' }: { path: string | null | undefined; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'size-20' : size === 'sm' ? 'size-8' : 'size-12';
  return (
    <div className={cn('grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-muted-foreground', dim)}>
      <SignedImage
        path={path}
        alt={name}
        className="size-full object-cover"
        fallback={<User className={size === 'sm' ? 'size-4' : 'size-6'} aria-hidden />}
      />
    </div>
  );
}

// ---------------------------------------------------------------- dépôt de fichier
/**
 * Bouton de dépôt : « Prendre une photo » (appareil photo du téléphone) et
 * « Choisir un fichier » (galerie ou fichiers). onDone est appelé après indexation.
 */
export function UploadButtons({ kind, vehicleId, onDone, photoOnly, compact, label, disabled }: {
  kind: UploadKind; vehicleId: string | null; onDone: () => void;
  photoOnly?: boolean; compact?: boolean;
  /** Libellé saisi par le client (type « autre »). */
  label?: string | null;
  disabled?: boolean;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      // Les fichiers trop lourds et les formats refusés lèvent une erreur dont le
      // message est déjà le texte à montrer au client (portal/image.ts).
      await uploadPortalFile(kind, vehicleId, f, label);
      toast.success(t('portal.upload.done'));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('portal.errors.generic'));
    } finally {
      setBusy(false);
      if (camRef.current) camRef.current.value = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className={cn('flex flex-wrap gap-2', compact && 'gap-1.5')}>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0])} />
      <input ref={fileRef} type="file" accept={photoOnly ? 'image/*' : 'image/*,application/pdf'} className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0])} />
      <Button type="button" size={compact ? 'sm' : 'default'} variant="outline" disabled={busy || disabled} onClick={() => camRef.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Camera />} {t('portal.upload.camera')}
      </Button>
      <Button type="button" size={compact ? 'sm' : 'default'} variant="outline" disabled={busy || disabled} onClick={() => fileRef.current?.click()}>
        {photoOnly ? <ImageIcon /> : <Upload />} {photoOnly ? t('portal.upload.gallery') : t('portal.upload.file')}
      </Button>
    </div>
  );
}

/** Rappel de la limite de taille, AVANT le choix du fichier (retour Simon 05/10). */
export function UploadLimitHint({ photoOnly }: { photoOnly?: boolean }) {
  return (
    <p className="text-[12px] text-muted-foreground">
      {t(photoOnly ? 'portal.upload.limitPhoto' : 'portal.upload.limit').replace('{max}', MAX_UPLOAD_LABEL)}
    </p>
  );
}

// ---------------------------------------------------------------- miniatures et plein écran
const isImageFile = (f: PortalFile) => (f.content_type ?? '').startsWith('image/');

/**
 * Miniature d'un document déposé (retour Simon 05/10 : une vignette, pas le nom
 * du fichier). Image : la photo réduite. PDF : l'icône de son type — pdf.js n'est
 * pas une dépendance du projet, la première page n'est pas « faisable simplement ».
 */
export function DocThumb({ file, className }: { file: PortalFile; className?: string }) {
  const box = cn('flex size-16 shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border border-border bg-muted', className);
  if (!isImageFile(file)) {
    return (
      <div className={box} aria-hidden>
        <FileText className="size-6 text-muted-foreground" />
        <span className="max-w-full truncate px-1 text-[10px] font-bold uppercase text-muted-foreground">{t('portal.upload.pdf')}</span>
      </div>
    );
  }
  return (
    <div className={box}>
      <SignedImage path={file.path} alt={file.label || file.file_name} className="size-full object-cover"
        fallback={<ImageIcon className="size-6 text-muted-foreground" aria-hidden />} />
    </div>
  );
}

/**
 * Consultation d'un document : une image s'ouvre en plein écran dans l'application,
 * un PDF dans un nouvel onglet (lecteur du téléphone ou du navigateur).
 */
export function useDocViewer() {
  const [shown, setShown] = useState<PortalFile | null>(null);
  const open = (f: PortalFile) => {
    if (isImageFile(f)) setShown(f);
    else openFile(f.path).catch((e) => toast.error(e instanceof Error ? e.message : t('portal.errors.generic')));
  };
  const viewer = (
    <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate text-[15px]">{shown?.label || shown?.file_name}</DialogTitle>
        </DialogHeader>
        {shown && (
          <SignedImage path={shown.path} alt={shown.label || shown.file_name}
            className="max-h-[70vh] w-full rounded-md object-contain"
            fallback={<p className="text-[13px] text-muted-foreground">{t('portal.errors.fileUnavailable')}</p>} />
        )}
      </DialogContent>
    </Dialog>
  );
  return { open, viewer };
}
