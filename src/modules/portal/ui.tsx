/**
 * Briques d'affichage du portail client (téléphone d'abord).
 * Couleurs uniquement via les tokens ; le rouge Ducati (primary) n'est utilisé que
 * pour les actions principales, jamais pour un statut (charte, CLAUDE.md règle 9).
 */
import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, ImageIcon, Loader2, Upload, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { signedFileUrl, uploadPortalFile, type UploadKind } from './api';

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

/** Barre de progression (couleur « succès » : la progression n'est pas une action). */
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-success transition-all" style={{ width: `${v}%` }} />
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
export function UploadButtons({ kind, vehicleId, onDone, photoOnly, compact }: {
  kind: UploadKind; vehicleId: string | null; onDone: () => void; photoOnly?: boolean; compact?: boolean;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      await uploadPortalFile(kind, vehicleId, f);
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
      <Button type="button" size={compact ? 'sm' : 'default'} variant="outline" disabled={busy} onClick={() => camRef.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Camera />} {t('portal.upload.camera')}
      </Button>
      <Button type="button" size={compact ? 'sm' : 'default'} variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
        {photoOnly ? <ImageIcon /> : <Upload />} {photoOnly ? t('portal.upload.gallery') : t('portal.upload.file')}
      </Button>
    </div>
  );
}
