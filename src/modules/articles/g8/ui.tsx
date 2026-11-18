/**
 * M2 — Rattrapage G8 : petits éléments d'écran partagés (tableaux denses, bandeau
 * « mise à jour de la base à appliquer », formats de nombres).
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import { G8SchemaMissingError } from './api';

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`px-3 py-1.5 ${className}`}>{children}</td>;
}

export function Spinner() {
  return <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-border bg-card py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

/** Erreur de lecture : bandeau explicite (migration non appliquée) ou message de l'erreur. */
export function QueryError({ error }: { error: unknown }) {
  if (!error) return null;
  const missing = error instanceof G8SchemaMissingError;
  return (
    <p className={`flex items-center gap-2 rounded-md px-3 py-2 text-[13px] ${missing ? 'bg-warning-bg text-warning' : 'bg-danger-bg text-danger'}`}>
      <AlertTriangle className="size-4 shrink-0" />
      {missing ? t('g8a.schemaMissing') : (error instanceof Error ? error.message : String(error))}
    </p>
  );
}

export function errorText(e: unknown): string {
  if (e instanceof G8SchemaMissingError) return t('g8a.schemaMissing');
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

export const eur = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
export const qty = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('fr-BE', { maximumFractionDigits: 3 });
export const pct = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toLocaleString('fr-BE', { maximumFractionDigits: 2 })} %`;
export const dateFr = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('fr-BE') : '—');
export const dateTimeFr = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('fr-BE') : '—');

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>;
}
