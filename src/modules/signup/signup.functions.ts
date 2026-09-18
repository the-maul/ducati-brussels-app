/**
 * Mission 01, lot 4 — Inscription client, en ligne (/inscription) et sur la borne
 * du comptoir (/borne). Server functions PUBLIQUES (aucune connexion requise),
 * exécutées côté serveur avec la clé de service, comme admin.functions.ts.
 *
 * Décisions appliquées (docs/bible/decisions.md) :
 *   - P-4 / K-1 : étape 1 « Créer mon compte » (identité, e-mail, téléphone, moto,
 *     intérêts, consentement marketing) ;
 *   - K-2 : carte CRM + tâche SEULEMENT si le client demande à être recontacté ;
 *   - D3 : l'e-mail décide (fiche existante sans compte → rattachée, champs vides
 *     complétés ; compte existant → « connectez-vous » ; sinon nouvelle fiche prospect,
 *     origine `web` ou `comptoir`) ;
 *   - C-1 / C-2 : « Recontacter le client » à J+2, jamais de carte en double ;
 *   - U-2 : compte CLIENT rattaché à sa fiche (contact_accounts), sans rôle ;
 *   - S-1 : la société cible est lue dans le réglage `signup_settings`, jamais devinée.
 *
 * MOT DE PASSE :
 *   - en ligne, pour une NOUVELLE fiche, le client choisit son mot de passe ;
 *   - sur la borne (tablette partagée) : jamais de mot de passe saisi ;
 *   - si l'e-mail correspond à une fiche EXISTANTE, le mot de passe saisi est ignoré :
 *     sinon n'importe qui pourrait ouvrir le compte d'un client connu (et voir un
 *     jour ses factures) en tapant son adresse. Le client reçoit alors l'invitation
 *     « choisir mon mot de passe », qui prouve qu'il possède bien la boîte mail.
 *
 * ANTI-ABUS (simple) : champ piège invisible (`website`), et un ticket signé délivré
 * à l'affichage du formulaire, qui impose un délai minimal de saisie et expire.
 * La logique de base (fiche, compte, moto, carte, tâche) est dans la fonction SQL
 * `signup_register`, en une transaction (migration 20260919110000).
 */
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

export const SIGNUP_INTERESTS = ['neuf', 'occasion', 'atelier', 'accessoires', 'evenements'] as const;

/** Délai minimal entre l'affichage du formulaire et l'envoi (un humain ne va pas plus vite). */
const MIN_FILL_MS = 4_000;
/** Durée de validité d'un formulaire affiché. */
const MAX_FILL_MS = 12 * 60 * 60 * 1000;

export type SignupErrorCode =
  | 'account_exists' | 'too_fast' | 'expired' | 'closed' | 'invalid' | 'generic';

export type SignupResult =
  | { status: 'ok'; invite: 'sent' | 'failed' | 'none'; existing: boolean; recontact: boolean }
  | { status: 'error'; code: SignupErrorCode };

async function hmac(payload: string): Promise<string> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquant');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(`signup-ticket:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Ticket délivré à l'affichage du formulaire : « horodatage.signature ». */
export const startSignup = createServerFn({ method: 'POST' })
  .handler(async () => {
    const issued = String(Date.now());
    return { ticket: `${issued}.${await hmac(issued)}` };
  });

const motoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ducati'),
    family: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(80),
    year: z.number().int().min(1920).max(2100).nullable(),
  }),
  z.object({
    kind: z.literal('other_brand'),
    brand: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(80),
    year: z.number().int().min(1920).max(2100).nullable(),
  }),
  z.object({ kind: z.literal('none') }),
]);

const signupInput = z.object({
  mode: z.enum(['web', 'kiosk']),
  ticket: z.string().max(200),
  website: z.string().max(200).optional(), // champ piège : doit rester vide
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(40).optional(),
  password: z.string().min(8).max(72).optional(),
  moto: motoSchema,
  interests: z.array(z.enum(SIGNUP_INTERESTS)).max(SIGNUP_INTERESTS.length).default([]),
  marketing_consent: z.boolean(),
  recontact: z.boolean(),
  message: z.string().trim().max(1000).optional(),
  // Adresse de l'application client (VITE_CLIENT_APP_URL ou origine du site) pour le lien d'invitation.
  origin: z.string().regex(/^https:\/\/[^/\s]+$|^http:\/\/localhost(:\d+)?$/),
});

export const submitSignup = createServerFn({ method: 'POST' })
  .inputValidator(signupInput)
  .handler(async ({ data }): Promise<SignupResult> => {
    // 1. Anti-abus.
    if (data.website && data.website.trim() !== '') {
      // Un robot a rempli le champ invisible : on fait comme si tout allait bien.
      return { status: 'ok', invite: 'none', existing: false, recontact: false };
    }
    const [issued, sig] = data.ticket.split('.');
    if (!issued || !sig || sig !== (await hmac(issued))) return { status: 'error', code: 'expired' };
    const age = Date.now() - Number(issued);
    if (!Number.isFinite(age) || age > MAX_FILL_MS) return { status: 'error', code: 'expired' };
    if (age < MIN_FILL_MS) return { status: 'error', code: 'too_fast' };

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    // 2. Société cible : réglage explicite en base.
    const { data: settings } = await supabaseAdmin
      .from('signup_settings').select('company_id, is_open').eq('id', true).maybeSingle();
    if (!settings?.is_open) return { status: 'error', code: 'closed' };
    const companyId = settings.company_id;
    const { data: company } = await supabaseAdmin
      .from('companies').select('id, is_active').eq('id', companyId).maybeSingle();
    if (!company?.is_active) return { status: 'error', code: 'closed' };

    // 3. Que dit l'e-mail ? (D3)
    const { data: pre, error: preErr } = await supabaseAdmin
      .rpc('signup_precheck', { _company: companyId, _email: data.email });
    if (preErr) { console.error('[signup] precheck', preErr.message); return { status: 'error', code: 'generic' }; }
    if (pre === 'account_exists') return { status: 'error', code: 'account_exists' };

    const origin = data.mode === 'kiosk' ? 'comptoir' : 'web';
    const usePassword = data.mode === 'web' && pre === 'new';
    if (usePassword && !data.password) return { status: 'error', code: 'invalid' };

    // 4. Compte de connexion.
    const fullName = `${data.first_name} ${data.last_name}`;
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: usePassword ? data.password! : `${crypto.randomUUID()}${crypto.randomUUID()}`,
      email_confirm: true,
      user_metadata: { full_name: fullName, account_kind: 'client', signup_origin: origin },
    });
    if (createErr || !created?.user) {
      const msg = createErr?.message ?? '';
      if (/already|registered|exists/i.test(msg)) return { status: 'error', code: 'account_exists' };
      console.error('[signup] createUser', msg);
      return { status: 'error', code: 'generic' };
    }
    const userId = created.user.id;

    // 5. Fiche, rattachement, consentement, moto, carte et tâche : une transaction.
    const { data: reg, error: regErr } = await supabaseAdmin.rpc('signup_register', {
      _company: companyId,
      _user: userId,
      _email: data.email,
      _origin: origin,
      _p: {
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone ?? null,
        interests: data.interests,
        marketing_consent: data.marketing_consent,
        recontact: data.recontact,
        message: data.recontact ? (data.message ?? null) : null,
        moto: data.moto,
      },
    });
    if (regErr || !reg || (Array.isArray(reg) && reg.length === 0)) {
      // Pas de compte à moitié créé.
      await supabaseAdmin.auth.admin.deleteUser(userId);
      if (regErr && /account_exists/.test(regErr.message)) return { status: 'error', code: 'account_exists' };
      console.error('[signup] register', regErr?.message);
      return { status: 'error', code: 'generic' };
    }
    const row = Array.isArray(reg) ? reg[0] : reg;
    await supabaseAdmin.from('profiles').upsert({ id: userId, email: data.email, full_name: fullName, is_active: true });

    // 6. Invitation « choisir mon mot de passe » (borne, ou fiche déjà connue).
    let invite: 'sent' | 'failed' | 'none' = 'none';
    if (!usePassword) {
      invite = 'failed';
      try {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const r = await fetch(`${url}/functions/v1/send-account-invitation`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, apikey: key!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId, userId, origin: data.origin, purpose: 'signup' }),
        });
        if (r.ok) invite = 'sent';
        else console.error('[signup] invitation', r.status, (await r.text()).slice(0, 200));
      } catch (e) {
        console.error('[signup] invitation', e instanceof Error ? e.message : e);
      }
    }

    return {
      status: 'ok',
      invite,
      existing: !row.contact_created,
      recontact: data.recontact,
    };
  });
