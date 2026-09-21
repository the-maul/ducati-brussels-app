/**
 * Borne /borne — lecture PUBLIQUE (sans connexion) des liens de l'écran d'accueil,
 * côté serveur avec la clé de service, comme app-client.functions.ts.
 * `select('*')` : fonctionne aussi tant que la migration 20260921180000 n'est pas
 * appliquée (colonnes absentes → adresses par défaut). En cas d'erreur : défauts.
 */
import { createServerFn } from '@tanstack/react-start';
import { resolveKioskLinks, type KioskLinks } from './kiosk-links';

export const getKioskLinks = createServerFn({ method: 'GET' })
  .handler(async (): Promise<KioskLinks> => {
    try {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data, error } = await supabaseAdmin
        .from('signup_settings').select('*').eq('id', true).maybeSingle();
      if (error) { console.error('[kiosk] links', error.message); return resolveKioskLinks(null); }
      return resolveKioskLinks(data as Record<string, unknown> | null);
    } catch (e) {
      console.error('[kiosk] links', e instanceof Error ? e.message : e);
      return resolveKioskLinks(null);
    }
  });
