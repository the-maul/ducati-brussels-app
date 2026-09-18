/**
 * Page publique /app-client — le lien du site Shopify vers l'application client
 * (décision W-5, 19/09). Server functions PUBLIQUES (aucune connexion requise),
 * exécutées côté serveur avec la clé de service, comme signup.functions.ts.
 *
 *   - getAppClientStatus : lit l'interrupteur `signup_settings.client_app_open`
 *     (false = page « bientôt disponible », true = redirection vers /inscription).
 *     Aucune fonction SQL ouverte à anon : depuis le lot sécurité, anon n'exécute rien.
 *   - startAppClientNotify / submitAppClientNotify : formulaire FACULTATIF
 *     « Prévenez-moi à l'ouverture » (e-mail + consentement explicite), enregistré
 *     dans `app_client_waitlist` (migration 20260919240000).
 *
 * ANTI-ABUS (simple) : champ piège invisible (`website`), ticket signé délivré à
 * l'affichage (délai minimal, expiration), limite par appareil (empreinte salée de
 * l'adresse IP, 5 par heure) et limite globale (200 par heure). La réponse ne dit
 * jamais si l'adresse était déjà inscrite.
 */
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const MIN_FILL_MS = 2_000;
const MAX_FILL_MS = 12 * 60 * 60 * 1000;
const PER_CLIENT_PER_HOUR = 5;
const GLOBAL_PER_HOUR = 200;

export type AppClientNotifyErrorCode = 'too_fast' | 'expired' | 'rate_limited' | 'closed' | 'generic';
export type AppClientNotifyResult = { status: 'ok' } | { status: 'error'; code: AppClientNotifyErrorCode };

async function hmac(purpose: string, payload: string): Promise<string> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquant');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(`${purpose}:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Application client ouverte ? En cas de doute (erreur), on reste sur « bientôt ». */
export const getAppClientStatus = createServerFn({ method: 'GET' })
  .handler(async (): Promise<{ open: boolean }> => {
    try {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { data, error } = await supabaseAdmin
        .from('signup_settings').select('client_app_open, is_open').eq('id', true).maybeSingle();
      if (error) { console.error('[app-client] status', error.message); return { open: false }; }
      // Ouverte seulement si l'inscription elle-même est ouverte : sinon on renverrait
      // le client vers un formulaire fermé.
      return { open: !!data?.client_app_open && !!data?.is_open };
    } catch (e) {
      console.error('[app-client] status', e instanceof Error ? e.message : e);
      return { open: false };
    }
  });

/** Ticket délivré à l'affichage du formulaire : « horodatage.signature ». */
export const startAppClientNotify = createServerFn({ method: 'POST' })
  .handler(async () => {
    const issued = String(Date.now());
    return { ticket: `${issued}.${await hmac('app-client-ticket', issued)}` };
  });

const notifyInput = z.object({
  ticket: z.string().max(200),
  website: z.string().max(200).optional(), // champ piège : doit rester vide
  email: z.string().trim().toLowerCase().email().max(200),
  consent: z.literal(true),
  // Texte exact de la case cochée, conservé comme preuve du consentement.
  consent_text: z.string().trim().min(1).max(500),
});

export const submitAppClientNotify = createServerFn({ method: 'POST' })
  .inputValidator(notifyInput)
  .handler(async ({ data }): Promise<AppClientNotifyResult> => {
    // 1. Anti-abus.
    if (data.website && data.website.trim() !== '') return { status: 'ok' };
    const [issued, sig] = data.ticket.split('.');
    if (!issued || !sig || sig !== (await hmac('app-client-ticket', issued))) return { status: 'error', code: 'expired' };
    const age = Date.now() - Number(issued);
    if (!Number.isFinite(age) || age > MAX_FILL_MS) return { status: 'error', code: 'expired' };
    if (age < MIN_FILL_MS) return { status: 'error', code: 'too_fast' };

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { getRequestHeader, getRequestIP } = await import('@tanstack/react-start/server');

    // 2. Société : celle qui reçoit les inscriptions publiques (réglage, jamais devinée).
    const { data: settings } = await supabaseAdmin
      .from('signup_settings').select('company_id').eq('id', true).maybeSingle();
    if (!settings?.company_id) return { status: 'error', code: 'closed' };

    // 3. Limites : par appareil (empreinte salée de l'IP, jamais l'IP en clair) et globale.
    const ip = getRequestHeader('x-nf-client-connection-ip')
      ?? getRequestIP({ xForwardedFor: true })
      ?? 'unknown';
    const clientHash = await hmac('app-client-ip', ip);
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [perClient, global] = await Promise.all([
      supabaseAdmin.from('app_client_waitlist').select('id', { count: 'exact', head: true })
        .eq('client_hash', clientHash).gte('created_at', since),
      supabaseAdmin.from('app_client_waitlist').select('id', { count: 'exact', head: true })
        .gte('created_at', since),
    ]);
    if ((perClient.count ?? 0) >= PER_CLIENT_PER_HOUR || (global.count ?? 0) >= GLOBAL_PER_HOUR) {
      return { status: 'error', code: 'rate_limited' };
    }

    // 4. Enregistrement. Adresse déjà inscrite : on ne touche à rien, même réponse.
    const { error } = await supabaseAdmin.from('app_client_waitlist').upsert(
      {
        company_id: settings.company_id,
        email: data.email,
        consent_text: data.consent_text,
        client_hash: clientHash,
      },
      { onConflict: 'company_id,email', ignoreDuplicates: true },
    );
    if (error) { console.error('[app-client] notify', error.message); return { status: 'error', code: 'generic' }; }
    return { status: 'ok' };
  });
