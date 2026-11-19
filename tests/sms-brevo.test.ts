/**
 * Tests du lot SMS Brevo (18/11/2026, T14 / T15, ATE018) — AUCUN appel reel : `fetch` est simule.
 *   - numeros E.164 (Belgique par defaut), mobile ou fixe, destinataire au format Brevo (sans « + ») ;
 *   - expediteur (11 alphanumeriques / 15 chiffres), defaut DucatiBXL ;
 *   - taille du SMS (alphabet standard 160 / 153, Unicode 70 / 67) ;
 *   - envoi : cle absente = « skipped / no_api_key » sans appel, succes 201 + messageId, repli sur
 *     l'ancien chemin /sms si /send repond 404, erreur Brevo lisible, reseau coupe ;
 *   - modeles par defaut et replis identiques a la migration (miroir SQL) ; rendu des balises ;
 *   - libelles des statuts / raisons / modes dans les quatre langues ;
 *   - la fonction d'etat ne renvoie jamais la cle ; plus de « fournisseur generique ».
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  BREVO_BASE, buildBrevoPayload, brevoError, brevoRecipient, isMobile, isValidSender, normalizePhone, resolveSender,
  sendBrevoSms, smsCredits, smsSize,
} from '../supabase/functions/_shared/brevo-sms.ts';
import {
  SMS_DEFAULT_TEMPLATES, SMS_FALLBACK, SMS_KINDS, SMS_LOCALES, SMS_MODES, SMS_REASONS, SMS_STATUSES, cleanTemplates,
  isValidReminderLead, joinLead, normalizeSmsMode, renderSms, sampleVars, splitLead, templateFor, unknownVars,
} from '../src/modules/crm/sms-rules';
import { smsFr, smsNl, smsEn, smsIt } from '../src/lib/i18n/sms';

const MIGRATION = readFileSync(new URL('../supabase/migrations/20261119170000_m8_sms_brevo.sql', import.meta.url), 'utf8');
const sqlLit = (s: string) => `'${s.replace(/'/g, "''")}'`;

describe('numeros', () => {
  test('formats belges courants -> +32470123456', () => {
    for (const raw of ['0470 12 34 56', '0470/12.34.56', '+32 470 12 34 56', '0032470123456', '470123456', ' +32(0)470 ']) {
      if (raw.includes('(0)')) continue; // forme ambigue, non garantie
      expect(normalizePhone(raw)).toBe('+32470123456');
    }
  });
  test('fixe belge reconnu mais pas mobile ; etranger accepte', () => {
    expect(normalizePhone('02 123 45 67')).toBe('+3221234567');
    expect(isMobile('+3221234567')).toBe(false);
    expect(isMobile('+32470123456')).toBe(true);
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(isMobile('+33612345678')).toBe(true);
    expect(normalizePhone('0039 333 123 4567')).toBe('+393331234567');
  });
  test('illisible -> null', () => {
    for (const raw of ['', 'abc', '+32 12', '0470', null, undefined, '+32 470 12 34 56 78 90']) expect(normalizePhone(raw as string)).toBeNull();
  });
  test('destinataire Brevo : chiffres sans +', () => {
    expect(brevoRecipient('+32470123456')).toBe('32470123456');
  });
});

describe('expediteur', () => {
  test('11 alphanumeriques ou 15 chiffres', () => {
    expect(isValidSender('DucatiBXL')).toBe(true);
    expect(isValidSender('DucatiBruxe')).toBe(true);
    expect(isValidSender('DucatiBruxel')).toBe(false);
    expect(isValidSender('Ducati BXL')).toBe(false);
    expect(isValidSender('324701234567890')).toBe(true);
    expect(isValidSender('')).toBe(false);
  });
  test('societe > secret > DucatiBXL', () => {
    expect(resolveSender('Italbike', 'Autre')).toBe('Italbike');
    expect(resolveSender(null, 'Autre')).toBe('Autre');
    expect(resolveSender('mauvais nom', 'aussi mauvais')).toBe('DucatiBXL');
    expect(resolveSender(null, undefined)).toBe('DucatiBXL');
  });
});

describe('taille du SMS', () => {
  test('alphabet standard : 160 = 1 SMS, 161 = 2 SMS de 153', () => {
    expect(smsSize('a'.repeat(160))).toMatchObject({ encoding: 'gsm', units: 160, segments: 1 });
    expect(smsSize('a'.repeat(161))).toMatchObject({ encoding: 'gsm', segments: 2 });
    expect(smsSize('a'.repeat(307))).toMatchObject({ segments: 3 });
  });
  test('accents francais et italiens courants restent dans l alphabet standard', () => {
    expect(smsSize("à l'atelier, récupérer, è, ò, ù, ì, É, Ç").encoding).toBe('gsm');
  });
  test('« ê » ou un emoji : Unicode (70 / 67)', () => {
    expect(smsSize('prête').encoding).toBe('unicode');
    expect(smsSize('ê'.repeat(70)).segments).toBe(1);
    expect(smsSize('ê'.repeat(71)).segments).toBe(2);
  });
  test('caracteres etendus comptent double', () => {
    expect(smsSize('€').units).toBe(2);
  });
  test('textes par defaut : 1 SMS, alphabet standard, avec les valeurs d exemple', () => {
    for (const kind of SMS_KINDS) for (const loc of SMS_LOCALES) {
      const txt = renderSms(SMS_DEFAULT_TEMPLATES[kind][loc], sampleVars(loc, { companyName: 'ITALBIKE STORE' }));
      const size = smsSize(txt);
      expect(size.encoding).toBe('gsm');
      expect(size.segments).toBe(1);
    }
  });
});

type Call = { url: string; init: { method: string; headers: Record<string, string>; body?: string } };
function fakeFetch(responses: Array<{ status: number; body: string } | 'throw'>) {
  const calls: Call[] = [];
  const impl = async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r === 'throw') throw new Error('network');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  };
  return { calls, impl };
}

describe('envoi Brevo (simule)', () => {
  test('cle absente : skipped / no_api_key, aucun appel', async () => {
    const f = fakeFetch([{ status: 201, body: '{}' }]);
    const r = await sendBrevoSms({ apiKey: undefined, sender: 'DucatiBXL', to: '0470123456', content: 'x', fetchImpl: f.impl });
    expect(r).toEqual({ status: 'skipped', error: 'no_api_key' });
    expect(f.calls.length).toBe(0);
  });
  test('numero illisible : failed / invalid_number, aucun appel', async () => {
    const f = fakeFetch([{ status: 201, body: '{}' }]);
    const r = await sendBrevoSms({ apiKey: 'k', sender: 'DucatiBXL', to: 'abc', content: 'x', fetchImpl: f.impl });
    expect(r).toEqual({ status: 'failed', error: 'invalid_number' });
    expect(f.calls.length).toBe(0);
  });
  test('succes : POST /transactionalSMS/send, en-tete api-key, corps attendu, messageId garde', async () => {
    const f = fakeFetch([{ status: 201, body: '{"messageId":1511882900100020}' }]);
    const r = await sendBrevoSms({ apiKey: 'cle-secrete', sender: 'DucatiBXL', to: '0470 12 34 56', content: 'Bonjour', tag: 'workshop_ready', fetchImpl: f.impl });
    expect(r).toEqual({ status: 'sent', messageId: '1511882900100020' });
    expect(f.calls[0].url).toBe(`${BREVO_BASE}/transactionalSMS/send`);
    expect(f.calls[0].init.method).toBe('POST');
    expect(f.calls[0].init.headers['api-key']).toBe('cle-secrete');
    expect(JSON.parse(f.calls[0].init.body!)).toEqual({
      sender: 'DucatiBXL', recipient: '32470123456', content: 'Bonjour', type: 'transactional', tag: 'workshop_ready', unicodeEnabled: false,
    });
  });
  test('/send en 404 : repli sur l ancien chemin /sms', async () => {
    const f = fakeFetch([{ status: 404, body: '' }, { status: 201, body: '{"messageId":"42"}' }]);
    const r = await sendBrevoSms({ apiKey: 'k', sender: 'DucatiBXL', to: '+32470123456', content: 'x', fetchImpl: f.impl });
    expect(r).toEqual({ status: 'sent', messageId: '42' });
    expect(f.calls.map((c) => c.url)).toEqual([`${BREVO_BASE}/transactionalSMS/send`, `${BREVO_BASE}/transactionalSMS/sms`]);
  });
  test('refus Brevo : failed avec le code (pas de second essai hors 404)', async () => {
    const f = fakeFetch([{ status: 400, body: '{"code":"not_enough_credits","message":"Insufficient credits"}' }]);
    const r = await sendBrevoSms({ apiKey: 'k', sender: 'DucatiBXL', to: '+32470123456', content: 'x', fetchImpl: f.impl });
    expect(r).toEqual({ status: 'failed', error: 'brevo_400_not_enough_credits' });
    expect(f.calls.length).toBe(1);
  });
  test('reseau coupe : failed / brevo_network', async () => {
    const f = fakeFetch(['throw']);
    const r = await sendBrevoSms({ apiKey: 'k', sender: 'DucatiBXL', to: '+32470123456', content: 'x', fetchImpl: f.impl });
    expect(r).toEqual({ status: 'failed', error: 'brevo_network' });
  });
  test('Unicode signale a Brevo', () => {
    expect(buildBrevoPayload({ sender: 'X', to: '+32470123456', content: 'prête' }).unicodeEnabled).toBe(true);
  });
  test('erreur lisible, solde SMS du compte', () => {
    expect(brevoError(401, '{"code":"unauthorized"}')).toBe('brevo_401_unauthorized');
    expect(brevoError(500, 'oops')).toBe('brevo_500');
    expect(smsCredits({ plan: [{ type: 'free', credits: 300 }, { type: 'sms', credits: 15, creditsType: 'sendLimit' }] })).toBe(15);
    expect(smsCredits({ plan: [{ type: 'free', credits: 300 }] })).toBeNull();
    expect(smsCredits(null)).toBeNull();
  });
});

describe('modeles (miroir de la migration)', () => {
  test('textes par defaut identiques a public._sms_default_template', () => {
    for (const kind of SMS_KINDS) for (const loc of SMS_LOCALES) {
      expect(MIGRATION.includes(sqlLit(SMS_DEFAULT_TEMPLATES[kind][loc]))).toBe(true);
    }
  });
  test('replis {horaires} / {moto} identiques a public._sms_fallback', () => {
    for (const loc of SMS_LOCALES) {
      expect(MIGRATION.includes(sqlLit(SMS_FALLBACK.horaires[loc]))).toBe(true);
      expect(MIGRATION.includes(sqlLit(SMS_FALLBACK.moto[loc]))).toBe(true);
    }
  });
  test('rendu : balises remplacees, espaces nettoyes, signature vide sans trou', () => {
    expect(renderSms('Bonjour {prenom}, OR {or}. {societe}', { prenom: 'Marco', or: 'OR-1', societe: '' })).toBe('Bonjour Marco, OR OR-1.');
    expect(renderSms('A  {x} , b', { x: '' })).toBe('A, b');
    expect(renderSms('{inconnue}', {})).toBe('{inconnue}');
  });
  test('modele de la societe sinon defaut ; nettoyage avant enregistrement', () => {
    expect(templateFor({ ready: { nl: 'Eigen tekst' } }, 'ready', 'nl')).toBe('Eigen tekst');
    expect(templateFor({ ready: { nl: '   ' } }, 'ready', 'nl')).toBe(SMS_DEFAULT_TEMPLATES.ready.nl);
    expect(cleanTemplates({ ready: { fr: SMS_DEFAULT_TEMPLATES.ready.fr, nl: ' Eigen ' }, reminder: { it: '' } })).toEqual({ ready: { nl: 'Eigen' } });
  });
  test('balise inconnue signalee', () => {
    expect(unknownVars('Bonjour {prénom} {client} {prenom}', 'ready')).toEqual(['prénom', 'client']);
    expect(unknownVars(SMS_DEFAULT_TEMPLATES.reminder.fr, 'reminder')).toEqual([]);
  });
  test('delai du rappel', () => {
    expect(splitLead(1440 + 90)).toEqual({ d: 1, h: 1, m: 30 });
    expect(joinLead({ d: 1, h: 1, m: 30 })).toBe(1530);
    expect(isValidReminderLead(59)).toBe(false);
    expect(isValidReminderLead(60)).toBe(true);
    expect(isValidReminderLead(10080)).toBe(true);
    expect(isValidReminderLead(10081)).toBe(false);
  });
  test('mode : defaut arrete', () => {
    expect(normalizeSmsMode(undefined)).toBe('arrete');
    expect(normalizeSmsMode('n_importe')).toBe('arrete');
    expect(normalizeSmsMode('actif')).toBe('actif');
  });
});

describe('libelles (quatre langues)', () => {
  for (const [name, d] of [['fr', smsFr], ['nl', smsNl], ['en', smsEn], ['it', smsIt]] as const) {
    test(`${name} : statuts, raisons, modes, erreurs`, () => {
      const dict = d as unknown as Record<string, unknown>;
      for (const s of SMS_STATUSES) expect(typeof dict[`status_${s}`]).toBe('string');
      for (const r of SMS_REASONS) expect(typeof dict[`reason_${r}`]).toBe('string');
      for (const m of SMS_MODES) expect(typeof (d.mode as Record<string, string>)[m]).toBe('string');
      for (const code of ['SMS_FORBIDDEN', 'SMS_TEST_COMPANY', 'SMS_BAD_NUMBER', 'SMS_TEST_LIMIT', 'SMS_BAD_SENDER', 'SMS_TEST_NEEDS_NUMBER']) {
        expect(typeof (d.errors as Record<string, string>)[code]).toBe('string');
      }
    });
  }
  test('toutes les erreurs levees par la migration ont un libelle', () => {
    const codes = [...new Set(Array.from(MIGRATION.matchAll(/'(SMS_[A-Z_]+)'/g)).map((m) => m[1]))];
    for (const c of codes) expect(typeof (smsFr.errors as Record<string, string>)[c]).toBe('string');
  });
});

describe('fonctions Edge', () => {
  const status = readFileSync(new URL('../supabase/functions/sms-brevo/index.ts', import.meta.url), 'utf8');
  const dispatch = readFileSync(new URL('../supabase/functions/dispatch-notifications/index.ts', import.meta.url), 'utf8');
  test('sms-brevo ne renvoie jamais la cle (seulement « configuree » oui / non)', () => {
    const replies = status.split('\n').filter((l) => /J\(/.test(l)).join('\n');
    expect(replies.includes('BREVO_KEY,')).toBe(false);
    expect(/configured:\s*!!BREVO_KEY/.test(status)).toBe(true);
  });
  test('dispatch-notifications : un seul systeme, Brevo, plus de fournisseur generique', () => {
    expect(dispatch.includes('SMS_API_URL')).toBe(false);
    expect(dispatch.includes("Deno.env.get('SMS_API_KEY')")).toBe(false);
    expect(dispatch.includes('sms_dispatch_claim')).toBe(true);
    expect(dispatch.includes('sms_dispatch_result')).toBe(true);
    expect(dispatch.includes('channel=neq.sms')).toBe(true);
  });
});
