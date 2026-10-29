// M8 / M9 — Edge Function : signature d'une proposition d'intervention par le client
// (ATE008 / ATE009, decision client du 30/10/2026). Appelee par la page PUBLIQUE /signer/<jeton>
// (lien du mail, espace client) et par la tablette du comptoir (meme ecran, mode comptoir).
//
// POURQUOI UNE FONCTION SERVEUR : le client qui signe depuis le lien recu n'est pas connecte.
// Aucune table n'est ouverte a la cle publique : c'est ici, avec la cle de service, que l'on
// verifie le JETON (64 hexa, duree limitee, genere en base), lit la proposition, enregistre
// la signature EN UNE TRANSACTION (`proposal_apply_signature`), range le PDF signe en GED et
// l'envoie au client dans SA langue (Microsoft Graph, comme graph-send-email).
//
// Actions (POST JSON) :
//   { action: 'get',     token }                                   → la proposition (lignes, photos signees 1 h, etat)
//   { action: 'sign',    token, keptLineIds, signerName, mode, signatureData, acceptedText, hash, userAgent }
//                                                                  → signature enregistree (horodatage, IP, empreinte)
//   { action: 'archive', token, signatureId, pdf: { name, contentBytes } }
//                                                                  → PDF signe en GED (document + client) et mail au client
// Ce qu'on enregistre : nom, horodatage, adresse IP (x-forwarded-for), navigateur (user-agent),
// texte exact accepte + son empreinte SHA-256, lignes gardees ; au comptoir : l'image du trace.
// Secrets : SUPABASE_SERVICE_ROLE_KEY ; MS_GRAPH_TENANT_ID / CLIENT_ID / CLIENT_SECRET pour le mail
// (sans eux : signature enregistree, PDF range, mail non envoye — jamais d'erreur bloquante).
// deno-lint-ignore-file
import { buildGraphMessage, toGraphAttachments, attachmentsSummary } from '../_shared/mail-message.ts';
import { mailTexts, asMailLocale, DEFAULT_MAIL_LOCALE, fillMail, type MailLocale } from '../_shared/mail-i18n.ts';
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TENANT = Deno.env.get('MS_GRAPH_TENANT_ID');
const CID = Deno.env.get('MS_GRAPH_CLIENT_ID');
const CSECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const TOKEN_RE = /^[0-9a-f]{64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function db(path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
}

/** Appel d'une fonction SQL avec la cle de service ; { data } ou { error: message }. */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const r = await db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = String((await r.json())?.message ?? msg); } catch { /* corps illisible */ }
    return { data: null, error: msg };
  }
  const txt = await r.text();
  return { data: txt ? JSON.parse(txt) as T : null, error: null };
}

/** URL signee (1 h) d'un fichier du bucket prive ged, null si absent. */
async function signUrl(path: string): Promise<string | null> {
  try {
    const r = await fetch(`${URL}/storage/v1/object/sign/ged/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST', headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.signedURL ? `${URL}/storage/v1${j.signedURL}` : null;
  } catch { return null; }
}

/** L'utilisateur derriere le jeton (tablette du comptoir connectee), ou null (client, cle publique). */
async function caller(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const r = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: SVC!, Authorization: auth } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id && UUID_RE.test(u.id) ? u.id : null;
  } catch { return null; }
}

function clientIp(req: Request): string | null {
  const xf = req.headers.get('x-forwarded-for') ?? '';
  const first = xf.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || null;
}

/** Message d'erreur SQL → code renvoye a l'ecran. */
function sqlErrorCode(msg: string): string {
  if (/lien inconnu/i.test(msg)) return 'unknown_link';
  if (/lien expire/i.test(msg)) return 'expired';
  if (/deja signee/i.test(msg)) return 'already_signed';
  if (/annulee/i.test(msg)) return 'cancelled';
  return 'sign_failed';
}

async function token(): Promise<string | null> {
  if (!TENANT || !CID || !CSECRET) return null;
  const form = new URLSearchParams({ client_id: CID, client_secret: CSECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  return r.ok ? (await r.json()).access_token : null;
}

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} EUR`;

type Proposal = {
  document_id: string; number: string | null; status: string; total_ttc: number;
  company: { id: string; name: string | null; inbound_mailbox: string | null } | null;
  contact: { id: string; first_name: string | null; last_name: string | null; email: string | null; locale: string | null } | null;
  repair_order: { id: string; number: string | null } | null;
  lines: { id: string; designation: string; line_type: string; line_ttc: number; checkup_key: string | null; accepted: boolean | null; photo_path: string | null; photo_url?: string | null }[];
  signature: { id: string; signer_name: string | null; signed_at: string; mode: string | null } | null;
};

async function loadProposal(tok: string): Promise<Proposal | null> {
  const { data } = await rpc<Proposal>('proposal_by_token', { _token: tok });
  return data ?? null;
}

/** Corps HTML du mail « votre proposition signee », dans la langue du client. */
function signedMailHtml(p: Proposal, locale: MailLocale): { subject: string; html: string } {
  const T = mailTexts(locale).proposal;
  const name = [p.contact?.first_name, p.contact?.last_name].filter(Boolean).join(' ').trim();
  // Une ligne par carte : la main-d'oeuvre porte le libelle de la carte ; une ligne isolee compte pour elle-meme.
  const heads = p.lines.filter((l) => l.line_type === 'main_oeuvre' || !l.checkup_key);
  const kept = heads.filter((l) => l.accepted !== false);
  const deferred = heads.filter((l) => l.accepted === false);
  const li = (rows: typeof kept) => rows.map((l) => `<li>${esc(l.designation)}</li>`).join('');
  const vars = { name: name || esc(mailTexts(locale).account.helloAnonymous), number: p.number ?? '', or: p.repair_order?.number ?? '', total: eur(p.total_ttc), company: p.company?.name ?? '' };
  const html = [
    `<p>${esc(fillMail(name ? mailTexts(locale).account.hello : mailTexts(locale).account.helloAnonymous, { name }))}</p>`,
    `<p>${esc(fillMail(T.signedIntro, vars))}</p>`,
    kept.length ? `<p><b>${esc(T.signedKept)}</b></p><ul>${li(kept)}</ul>` : '',
    deferred.length ? `<p><b>${esc(T.signedDeferred)}</b></p><ul>${li(deferred)}</ul><p>${esc(T.signedDeferredHint)}</p>` : '',
    `<p><b>${esc(fillMail(T.signedTotal, vars))}</b></p>`,
    `<p>${esc(T.signedAttached)}</p>`,
    `<p>${esc(T.signedBye)}<br>${esc(p.company?.name ?? mailTexts(locale).account.signature)}</p>`,
  ].join('');
  return { subject: fillMail(T.signedSubject, vars), html };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!URL || !SVC) return J({ error: 'not_configured' }, 501);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? '');
  const tok = typeof body?.token === 'string' ? body.token.trim().toLowerCase() : '';
  if (!TOKEN_RE.test(tok)) return J({ error: 'unknown_link' }, 404);

  // ---- get : la proposition derriere le jeton --------------------------------------------
  if (action === 'get') {
    const p = await loadProposal(tok);
    if (!p) return J({ error: 'unknown_link' }, 404);
    for (const l of p.lines) l.photo_url = l.photo_path ? await signUrl(l.photo_path) : null;
    return J({ ok: true, proposal: p });
  }

  // ---- sign : enregistrement en une transaction -------------------------------------------
  if (action === 'sign') {
    const mode = body?.mode === 'comptoir' ? 'comptoir' : 'distance';
    const signerName = String(body?.signerName ?? '').trim().slice(0, 200);
    const kept = Array.isArray(body?.keptLineIds) ? (body.keptLineIds as unknown[]).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : [];
    const signatureData = typeof body?.signatureData === 'string' && body.signatureData.startsWith('data:image/png;base64,') && body.signatureData.length < 400_000 ? body.signatureData : null;
    const acceptedText = typeof body?.acceptedText === 'string' ? body.acceptedText.slice(0, 20_000) : '';
    if (!signerName || !acceptedText) return J({ error: 'missing_params' }, 400);
    if (mode === 'comptoir' && !signatureData) return J({ error: 'missing_params' }, 400);
    const signedBy = await caller(req);
    const { data, error } = await rpc<Record<string, unknown>>('proposal_apply_signature', {
      _token: tok, _kept: kept, _signer_name: signerName, _mode: mode, _signature_data: signatureData,
      _ip: clientIp(req), _user_agent: String(body?.userAgent ?? req.headers.get('user-agent') ?? '').slice(0, 500),
      _accepted_text: acceptedText, _signed_by: signedBy,
    });
    if (error || !data) return J({ error: sqlErrorCode(error ?? '') }, 400);
    return J({
      ok: true,
      signature: {
        signature_id: data.signature_id, signed_at: data.signed_at, hash: data.hash, ip: clientIp(req),
        kept: data.kept, deferred: data.deferred, contact_email: data.contact_email ?? null, locale: data.locale ?? DEFAULT_MAIL_LOCALE,
      },
    });
  }

  // ---- archive : PDF signe en GED + mail au client ----------------------------------------
  if (action === 'archive') {
    const p = await loadProposal(tok);
    if (!p) return J({ error: 'unknown_link' }, 404);
    const sigId = typeof body?.signatureId === 'string' ? body.signatureId : '';
    if (p.status !== 'accepte' || !p.signature || p.signature.id !== sigId) return J({ error: 'sign_failed' }, 400);
    const pdf = body?.pdf;
    const b64 = typeof pdf?.contentBytes === 'string' ? pdf.contentBytes : '';
    const name = String(pdf?.name ?? `proposition_${p.number ?? ''}_signee.pdf`).replace(/[^\w.-]+/g, '_');
    if (!b64 || b64.length > 20_000_000) return J({ error: 'missing_params' }, 400);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const companyId = p.company?.id;
    if (!companyId) return J({ error: 'archive_failed' }, 400);

    // 1. GED : un fichier sur le document, un sur le client (deux lignes, comme document-mail-api).
    let archived = true;
    const stamp = Date.now();
    const note = `Signe par ${p.signature.signer_name ?? ''} le ${new Date(p.signature.signed_at).toLocaleString('fr-BE')} (${p.signature.mode ?? 'distance'})`;
    const targets: { type: string; id: string | null; folder: string | null }[] = [
      { type: 'document', id: p.document_id, folder: null },
      { type: 'contact', id: p.contact?.id ?? null, folder: 'Documents de vente' },
    ];
    for (const tg of targets) {
      if (!tg.id) continue;
      const path = `${companyId}/${tg.type}/${tg.id}/${stamp}_${name}`;
      try {
        const up = await fetch(`${URL}/storage/v1/object/ged/${path}`, {
          method: 'POST', headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: bytes,
        });
        if (!up.ok) { archived = false; continue; }
        const ins = await db('attachments', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ company_id: companyId, entity_type: tg.type, entity_id: tg.id, file_name: name, storage_path: path, content_type: 'application/pdf', size_bytes: bytes.length, note, folder: tg.folder }),
        });
        if (!ins.ok) archived = false;
      } catch { archived = false; }
    }

    // 2. Mail au client, dans sa langue, avec le PDF signe (best-effort).
    let mailed = false;
    const to = String(p.contact?.email ?? '').trim().toLowerCase();
    const single = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to);
    const tk = single ? await token() : null;
    if (tk) {
      try {
        let mailbox = String(p.company?.inbound_mailbox ?? '').toLowerCase();
        if (!mailbox) {
          const boxes = await (await db(`company_mailboxes?select=address&company_id=eq.${companyId}&is_active=eq.true&limit=1`)).json();
          mailbox = Array.isArray(boxes) && boxes[0]?.address ? String(boxes[0].address).toLowerCase() : '';
        }
        if (mailbox) {
          const locale = asMailLocale(p.contact?.locale) ?? DEFAULT_MAIL_LOCALE;
          const { subject, html } = signedMailHtml(p, locale);
          const atts = toGraphAttachments([{ name, contentType: 'application/pdf', contentBytes: b64 }]);
          const msg = buildGraphMessage({ subject, bodyHtml: html, signature: '', footer: '', to, attachments: atts });
          const sendRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
            method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }, body: JSON.stringify(msg),
          });
          mailed = sendRes.ok;
          if (mailed) {
            await db('events', {
              method: 'POST', headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({
                company_id: companyId, action: 'email_sent', entity_type: 'documents', entity_id: p.document_id, origin: 'system',
                new_data: { to, from: mailbox, subject, contact_id: p.contact?.id ?? null, attachments: attachmentsSummary(atts), footer: null, reason: 'proposal_signed' },
              }),
            });
          }
        }
      } catch { mailed = false; }
    }
    return J({ ok: true, archived, mailed });
  }

  return J({ error: 'missing_params' }, 400);
});
