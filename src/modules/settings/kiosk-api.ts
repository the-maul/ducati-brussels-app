/**
 * M0 — Paramètres → Borne d'inscription : les deux adresses de l'écran d'accueil de
 * la borne (retour client du 21/09). Colonnes `signup_settings.kiosk_configurator_url`
 * et `kiosk_used_url` (migration 20260921180000, pas encore dans types.ts).
 * Écriture réservée aux administrateurs (RLS `signup_settings_admin_write`) ; trace
 * dans `events` par le trigger existant `trg_signup_settings_audit`.
 */
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';

export interface KioskLinkSettings {
  /** false = migration pas encore appliquée : lecture seule, adresses par défaut. */
  available: boolean;
  /** Valeurs brutes : null = défaut, '' = tuile masquée. */
  configurator: string | null;
  used: string | null;
}

export async function getKioskLinkSettings(): Promise<KioskLinkSettings> {
  const { data, error } = await supabase.from('signup_settings').select('*').eq('id', true).maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  const available = 'kiosk_configurator_url' in row && 'kiosk_used_url' in row;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return { available, configurator: str(row.kiosk_configurator_url), used: str(row.kiosk_used_url) };
}

export async function setKioskLinks(
  links: { configurator: string | null; used: string | null },
  userId: string | null,
): Promise<void> {
  const patch = {
    kiosk_configurator_url: links.configurator,
    kiosk_used_url: links.used,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  const { data, error } = await supabase
    .from('signup_settings')
    // Colonnes ajoutées par la migration 20260921180000, absentes du types.ts généré.
    .update(patch as never)
    .eq('id', true)
    .select('id');
  if (error) {
    // Colonne inconnue : la migration n'est pas encore appliquée.
    if (/kiosk_(configurator|used)_url/.test(error.message)) throw new Error(t('kiosk.linksNotMigrated'));
    throw error;
  }
  if (!data || data.length === 0) throw new Error(t('kiosk.linksNotAllowed'));
}
