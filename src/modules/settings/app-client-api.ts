/**
 * M0 — Paramètres → Application client (décision W-5, 19/09).
 *
 * L'interrupteur `signup_settings.client_app_open` décide de ce que montre la page
 * publique /app-client (le lien du site Shopify) : « bientôt disponible » ou
 * redirection vers /inscription. Écriture réservée aux administrateurs par la RLS
 * (`signup_settings_admin_write`) ; chaque changement est tracé dans `events`.
 *
 * Les e-mails « Prévenez-moi à l'ouverture » (`app_client_waitlist`) ne sont lisibles
 * que par les administrateurs de la société (RLS), et exportables en CSV.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type WaitlistRow = Pick<
  Database['public']['Tables']['app_client_waitlist']['Row'],
  'id' | 'email' | 'consent_at' | 'consent_text' | 'notified_at' | 'created_at'
>;

export interface AppClientSettings {
  open: boolean;
  signupOpen: boolean;
  updatedAt: string;
}

export async function getAppClientSettings(): Promise<AppClientSettings | null> {
  const { data, error } = await supabase
    .from('signup_settings')
    .select('client_app_open, is_open, updated_at')
    .eq('id', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { open: data.client_app_open, signupOpen: data.is_open, updatedAt: data.updated_at };
}

export async function setAppClientOpen(open: boolean, userId: string | null): Promise<void> {
  const { data, error } = await supabase
    .from('signup_settings')
    .update({ client_app_open: open, updated_at: new Date().toISOString(), updated_by: userId })
    .eq('id', true)
    .select('id');
  if (error) throw error;
  // RLS : un non-administrateur de la société ne modifie aucune ligne, sans erreur.
  if (!data || data.length === 0) throw new Error('not_allowed');
}

export async function listWaitlist(): Promise<WaitlistRow[]> {
  const { data, error } = await supabase
    .from('app_client_waitlist')
    .select('id, email, consent_at, consent_text, notified_at, created_at')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data ?? [];
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function brusselsDateTime(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('fr-BE', {
    timeZone: 'Europe/Brussels', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(iso));
}

/** Même gabarit que les autres exports : séparateur ';', BOM UTF-8, Blob + <a download>. */
export function downloadWaitlistCsv(rows: WaitlistRow[], header: string[]): void {
  const lines = rows.map((r) => [
    r.email, brusselsDateTime(r.consent_at), r.consent_text, brusselsDateTime(r.notified_at),
  ].map(csvCell).join(';'));
  const csv = '﻿' + [header.map(csvCell).join(';'), ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `application-client_prevenez-moi_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
