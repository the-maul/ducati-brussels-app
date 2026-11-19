// M10 — Edge Function : dispatch de la file de notifications (e-mail via Microsoft Graph, SMS via Brevo).
// Appelee par pg_cron (toutes les 10 min) via pg_net. verify_jwt=false.
//
// E-MAIL (Q53, 19/11/2026, migration 20261119220000) : les mails de la file partent par Microsoft
// Graph depuis la boite partagee de la societe choisie dans « Mise en production » (defaut info@), et
// restent dans ses « Elements envoyes ». Resend est RETIRE (jamais configure : rien n'est jamais parti).
// La base choisit ce qui part (public.mail_dispatch_claim : societe de test, interrupteur du modele
// - rappel de RDV, relance automatique des factures, confirmation de commande -, arrete -> 'skipped /
// mail_off', test -> adresse de test + objet « [TEST pour <client>] », actif -> client ; RDV deplace,
// facture payee entre-temps), la fonction envoie puis rend le resultat (public.mail_dispatch_result).
// Secrets : MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET (absents : chaque mail
// pris en charge finit 'failed / graph_not_configured', rien ne part). Migration pas encore appliquee :
// la partie mail ne fait rien (aucun retour a Resend).
//
// SMS (lot SMS Brevo, 18/11/2026) : la base choisit ce qui part (public.sms_dispatch_claim : societe
// de test, mode arrete / test / actif, refus SMS, RDV deplace, OR revenu en arriere -> 'skipped' avec
// la raison), la fonction envoie par Brevo puis rend le resultat (public.sms_dispatch_result).
// Secrets : BREVO_API_KEY (absente : chaque SMS pris en charge finit 'skipped / no_api_key', aucune
// erreur), BREVO_SMS_SENDER (facultatif, defaut DucatiBXL ; l'expediteur de la societe passe avant).
// L'ancien « fournisseur generique » (secrets SMS_API_*) est remplace : un seul systeme.
//
// ACCÈS (lot sécurité S, 19/09) : pg_cron (en-tête x-cron-secret = secret CRON_SECRET) ou clé
// de service. Avant : déclenchable par n'importe qui avec la clé publique.
//
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { identify } from '../_shared/acces.ts';
import { resolveSender, sendBrevoSms } from '../_shared/brevo-sms.ts';
import { testCompanyIds } from '../_shared/test-company.ts';
import { buildGraphMessage } from '../_shared/mail-message.ts';
import { plainToHtml, sendGraphMail, sharedBoxSignature } from '../_shared/graph-mail.ts';

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BREVO_KEY = Deno.env.get('BREVO_API_KEY');
const BREVO_SENDER = Deno.env.get('BREVO_SMS_SENDER');

async function db(path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn}_${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}

type Claimed = { id: number; company_id: string; send_to: string; body: string; sender: string | null; is_test: boolean; template: string | null };
type ClaimedMail = { id: number; company_id: string; send_to: string; subject: string; body: string; sender_mailbox: string; is_test: boolean; template: string | null };

async function dispatchMail(tests: Set<string>): Promise<{ processed: number; sent: number; skipped: number; failed: number; mail_error?: string }> {
  let sent = 0, skipped = 0, failed = 0;
  let batch: ClaimedMail[] = [];
  try {
    batch = (await rpc<ClaimedMail[]>('mail_dispatch_claim', { _limit: 50 })) ?? [];
  } catch (e) {
    // Migration 20261119220000 pas encore appliquee : on ne touche a rien (plus de Resend).
    return { processed: 0, sent: 0, skipped: 0, failed: 0, mail_error: String((e as Error).message).slice(0, 200) };
  }
  const signatures = new Map<string, string>();
  for (const n of batch) {
    // SOCIETE DE TEST (lot ItalTest) : filet de securite, mail_dispatch_claim ne devrait jamais en remettre une.
    if (tests.has(String(n.company_id ?? ''))) {
      skipped++;
      await rpc('mail_dispatch_result', { _id: n.id, _status: 'skipped', _error: 'test_company', _provider_id: null }).catch(() => undefined);
      continue;
    }
    const sigKey = `${n.company_id}|${n.sender_mailbox}`;
    if (!signatures.has(sigKey)) signatures.set(sigKey, await sharedBoxSignature(db, n.company_id, n.sender_mailbox));
    const message = buildGraphMessage({
      subject: n.subject, bodyHtml: plainToHtml(n.body), signature: signatures.get(sigKey), footer: '', to: n.send_to, attachments: [],
    });
    const r = await sendGraphMail(n.sender_mailbox, message);
    if (r.ok) sent++; else failed++;
    await rpc('mail_dispatch_result', { _id: n.id, _status: r.ok ? 'sent' : 'failed', _error: r.ok ? null : r.error, _provider_id: null })
      .catch(() => { /* la prise en charge expirera en 'failed / stuck_sending' : jamais de second envoi */ });
  }
  return { processed: batch.length, sent, skipped, failed };
}

async function dispatchSms(tests: Set<string>): Promise<{ sms_sent: number; sms_skipped: number; sms_failed: number; sms_error?: string }> {
  let sent = 0, skipped = 0, failed = 0;
  let batch: Claimed[] = [];
  try {
    batch = (await rpc<Claimed[]>('sms_dispatch_claim', { _limit: 50 })) ?? [];
  } catch (e) {
    // Migration du lot SMS pas encore appliquee : on ne touche a rien.
    return { sms_sent: 0, sms_skipped: 0, sms_failed: 0, sms_error: String((e as Error).message).slice(0, 200) };
  }
  for (const n of batch) {
    // SOCIETE DE TEST (lot ItalTest) : filet de securite, la base ne devrait jamais en remettre une.
    if (tests.has(String(n.company_id ?? ''))) {
      skipped++;
      await rpc('sms_dispatch_result', { _id: n.id, _status: 'skipped', _error: 'test_company', _provider_id: null }).catch(() => undefined);
      continue;
    }
    const r = await sendBrevoSms({
      apiKey: BREVO_KEY, sender: resolveSender(n.sender, BREVO_SENDER), to: n.send_to, content: n.body,
      tag: n.template || 'dms', fetchImpl: fetch as never,
    });
    if (r.status === 'sent') sent++; else if (r.status === 'skipped') skipped++; else failed++;
    await rpc('sms_dispatch_result', {
      _id: n.id, _status: r.status,
      _error: r.status === 'sent' ? null : r.error,
      _provider_id: r.status === 'sent' ? r.messageId : null,
    }).catch(() => { /* la prise en charge expirera en 'failed / stuck_sending' : jamais de second envoi */ });
  }
  return { sms_sent: sent, sms_skipped: skipped, sms_failed: failed };
}

Deno.serve(async (req: Request) => {
  const caller = await identify(req);
  if (!caller || caller.kind === 'user') {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  // E-mails en attente arrives a echeance (les SMS passent par sms_dispatch_claim).
  // SOCIETE DE TEST (lot ItalTest, 19/11/2026) : ses notifications ne partent jamais (la base les enregistre deja
  // « skipped » ; filet de securite ici). Controle impossible : rien ne part ce passage-ci.
  let tests: Set<string>;
  try { tests = await testCompanyIds(); } catch {
    return new Response(JSON.stringify({ error: 'test_company_check_failed' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  const mail = await dispatchMail(tests);
  const sms = await dispatchSms(tests);
  return new Response(JSON.stringify({ ...mail, ...sms }), { headers: { 'Content-Type': 'application/json' } });
});
