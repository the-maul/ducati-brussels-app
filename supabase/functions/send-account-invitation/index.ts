// M0 — Edge Function : les e-mails de compte, envoyés par Outlook (décision D4), pas Resend.
//
// Trois sortes de mails (paramètre `kind`) :
//   - 'invite' (par défaut) : « choisissez votre mot de passe ». Demande client du 18/09 :
//     « on leur crée un compte et on envoie une invitation par mail pour générer un mot
//     de passe ». Après une inscription d'un client déjà connu, le mail reprend aussi le
//     message de bienvenue.
//   - 'welcome' (décision U-5) : après une inscription réussie avec mot de passe choisi
//     (en ligne ou à la borne) : « Bienvenue chez Ducati Bruxelles », identifiant de
//     connexion, lien vers l'espace client, texte du message de bienvenue K.
//   - 'password_changed' (décision U-5) : « Votre mot de passe a été modifié », mail de
//     sécurité, jamais le mot de passe lui-même.
//
// Le lien d'invitation ne passe PAS par la page de vérification de Supabase : il mène
// directement à /reset-password de l'application, avec un jeton à usage unique. La page
// ne consomme ce jeton qu'au moment où la personne valide son nouveau mot de passe :
// un antivirus qui « clique » sur les liens d'un mail ne peut donc pas le griller,
// et on ne dépend pas de la liste d'adresses de retour autorisées côté Supabase.
//
// QUI PEUT APPELER :
//   - 'invite' et 'welcome' : un administrateur de la société (connecté), OU le serveur
//     de l'application avec la CLÉ DE SERVICE et purpose = 'signup' (inscription
//     publique /inscription et /borne). Dans ce second cas la personne doit être un
//     compte CLIENT de la société (contact_accounts), jamais un membre de l'équipe.
//   - 'password_changed' : la personne CONNECTÉE, pour elle-même uniquement (le
//     destinataire est toujours le compte de l'appelant, `userId` est ignoré) ; ou le
//     serveur avec la clé de service pour un `userId` donné.
// Entrée : POST { kind?, companyId?, userId?, origin, purpose? }   Sortie : { ok, to, from }
// Secrets : MS_GRAPH_* (envoi), clé de service injectée.
//
// Rappel (18/09) : l'invitation de la borne testée à 13:36 UTC a reçu un 401
// `not_signed_in` : c'était encore l'ancienne version de cette fonction (réservée aux
// administrateurs), la version acceptant la clé de service a été déployée 40 s après.
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TENANT = Deno.env.get('MS_GRAPH_TENANT_ID');
const CID = Deno.env.get('MS_GRAPH_CLIENT_ID');
const CSECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const H = { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Kind = 'invite' | 'welcome' | 'password_changed';

async function db(path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
}
async function graphToken(): Promise<string | null> {
  const form = new URLSearchParams({ client_id: CID!, client_secret: CSECRET!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  return r.ok ? (await r.json()).access_token : null;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Message de bienvenue K (écran de fin d'inscription, src/lib/i18n/fr.ts `signup.welcome*`). */
function welcomeBlock(o: string): string {
  const host = o.replace(/^https?:\/\//, '');
  return `
    <p><b>Bravo et merci pour votre enregistrement.</b> Bienvenue chez Ducati Bruxelles.</p>
    <p>Vous pourrez désormais retrouver vos informations et celles de vos achats et de vos véhicules directement sur <a href="${esc(o)}">${esc(host)}</a>.</p>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!TENANT || !CID || !CSECRET) return J({ error: 'graph_not_configured' }, 501);

  const auth = req.headers.get('Authorization') ?? '';
  const internal = !!SVC && auth === `Bearer ${SVC}`;

  const body = await req.json().catch(() => ({}));
  const kind: Kind = body.kind === 'welcome' || body.kind === 'password_changed' ? body.kind : 'invite';
  const purpose = body.purpose;
  let companyId: string | null = typeof body.companyId === 'string' && UUID.test(body.companyId) ? body.companyId : null;
  let userId: string | null = typeof body.userId === 'string' && UUID.test(body.userId) ? body.userId : null;
  const o = String(body.origin ?? '');
  if (!/^https:\/\/[^/]+$/.test(o) && !/^http:\/\/localhost(:\d+)?$/.test(o)) return J({ error: 'bad_origin' }, 400);

  // 1. L'appelant.
  let callerId: string | null = null;
  if (!internal) {
    const me = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: SVC!, Authorization: auth } });
    if (!me.ok) return J({ error: 'not_signed_in' }, 401);
    callerId = (await me.json()).id ?? null;
    if (!callerId) return J({ error: 'not_signed_in' }, 401);
  }

  const selfSignup = internal && purpose === 'signup';

  if (kind === 'password_changed') {
    // Toujours le compte de l'appelant (sauf appel serveur explicite).
    if (!internal) userId = callerId;
    if (!userId) return J({ error: 'missing_params' }, 400);
    if (!companyId) {
      // Société d'envoi : celle du compte (rôle d'équipe, sinon fiche client).
      const [r, a] = await Promise.all([
        db(`user_roles?select=company_id&user_id=eq.${userId}&limit=1`).then((x) => x.json()),
        db(`contact_accounts?select=company_id&user_id=eq.${userId}&limit=1`).then((x) => x.json()),
      ]);
      companyId = (Array.isArray(r) && r[0]?.company_id) || (Array.isArray(a) && a[0]?.company_id) || null;
    }
    if (!companyId) return J({ error: 'not_in_company' }, 403);
  } else {
    if (!companyId || !userId) return J({ error: 'missing_params' }, 400);
    if (!internal) {
      const admin = await (await db(`user_roles?select=role&user_id=eq.${callerId}&company_id=eq.${companyId}&role=eq.admin&limit=1`)).json();
      if (!Array.isArray(admin) || admin.length === 0) return J({ error: 'admin_only' }, 403);
    } else if (!selfSignup) {
      return J({ error: 'bad_purpose' }, 400);
    }
  }

  // 2. La personne visée doit appartenir à cette société (équipe ou client).
  const [roles, account] = await Promise.all([
    db(`user_roles?select=role&user_id=eq.${userId}&company_id=eq.${companyId}&limit=1`).then((r) => r.json()),
    db(`contact_accounts?select=contact_id&user_id=eq.${userId}&company_id=eq.${companyId}&limit=1`).then((r) => r.json()),
  ]);
  const isStaff = Array.isArray(roles) && roles.length > 0;
  const isClient = Array.isArray(account) && account.length > 0;
  if (!isStaff && !isClient) return J({ error: 'not_in_company' }, 403);
  // Inscription publique : uniquement un compte client, jamais un compte de l'équipe.
  if (selfSignup && (isStaff || !isClient)) return J({ error: 'not_a_client' }, 403);

  const ur = await fetch(`${URL}/auth/v1/admin/users/${userId}`, { headers: H });
  if (!ur.ok) return J({ error: 'user_not_found' }, 404);
  const target = await ur.json();
  const email = String(target.email ?? '');
  const name = String(target.user_metadata?.full_name ?? '').trim();
  if (!email) return J({ error: 'no_email' }, 400);

  // 3. Expéditeur : Outlook, depuis info@ si la société l'a, sinon sa boîte principale.
  const boxes = await (await db(`company_mailboxes?select=address&company_id=eq.${companyId}&is_active=eq.true`)).json();
  const list = (Array.isArray(boxes) ? boxes : []).map((b: { address: string }) => b.address);
  const co = await (await db(`companies?select=name,inbound_mailbox&id=eq.${companyId}`)).json();
  const sender = list.find((a: string) => a.toLowerCase().startsWith('info@')) ?? co?.[0]?.inbound_mailbox ?? list[0];
  if (!sender) return J({ error: 'no_mailbox' }, 400);

  // 4. Contenu.
  const hello = name ? `Bonjour ${esc(name)},` : 'Bonjour,';
  const home = isClient && !isStaff ? `${o}/mon-espace` : `${o}/login`;
  let subject: string;
  let html: string;

  if (kind === 'invite') {
    const gl = await fetch(`${URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'recovery', email }) });
    if (!gl.ok) return J({ error: 'link_failed', detail: (await gl.text()).slice(0, 200) }, 502);
    const g = await gl.json();
    const hashed = g.hashed_token ?? g.properties?.hashed_token;
    if (!hashed) return J({ error: 'link_failed', detail: 'no hashed_token' }, 502);
    const link = `${o}/reset-password?token_hash=${encodeURIComponent(hashed)}&type=recovery`;

    const intro = selfSignup
      ? `${welcomeBlock(o)}
    <p>Nous vous connaissions déjà : pour protéger votre compte, le mot de passe saisi lors de l'inscription n'a pas été utilisé.</p>`
      : isClient
      ? '<p>Ducati Bruxelles vous a créé un espace client. Vous pourrez y retrouver vos informations, vos véhicules et vos achats.</p>'
      : '<p>Un compte a été créé pour vous sur la plateforme de gestion de Ducati Bruxelles.</p>';
    subject = selfSignup ? 'Bienvenue chez Ducati Bruxelles' : isClient ? 'Votre espace client Ducati Bruxelles' : 'Votre compte Ducati Bruxelles';
    html = `
    <p>${hello}</p>
    ${intro}
    <p>Pour activer votre compte, choisissez votre mot de passe en cliquant sur ce lien :</p>
    <p><a href="${esc(link)}">Choisir mon mot de passe</a></p>
    <p>Votre identifiant de connexion est : <b>${esc(email)}</b></p>
    <p>Ce lien ne sert qu'une fois et n'est valable que peu de temps. S'il a expiré, demandez-en simplement un nouveau à la concession.</p>
    <p>${selfSignup
      ? "Si vous n'êtes pas à l'origine de cette inscription, ignorez simplement ce message : sans mot de passe choisi, le compte reste inutilisable."
      : "Si vous n'attendiez pas ce message, vous pouvez l'ignorer."}</p>
    <p>Ducati Bruxelles</p>`;
  } else if (kind === 'welcome') {
    subject = 'Bienvenue chez Ducati Bruxelles';
    html = `
    <p>${hello}</p>
    ${welcomeBlock(o)}
    <p>Votre identifiant de connexion est : <b>${esc(email)}</b>, avec le mot de passe que vous avez choisi.</p>
    <p><a href="${esc(home)}">Accéder à mon espace client</a></p>
    <p>Si vous n'êtes pas à l'origine de cette inscription, répondez simplement à ce message et nous fermerons le compte.</p>
    <p>À très bientôt,<br>Ducati Bruxelles</p>`;
  } else {
    const when = new Date().toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', dateStyle: 'long', timeStyle: 'short' });
    subject = 'Votre mot de passe a été modifié';
    html = `
    <p>${hello}</p>
    <p>Le mot de passe de votre compte Ducati Bruxelles (identifiant <b>${esc(email)}</b>) a été modifié le ${esc(when)}.</p>
    <p>Si c'est bien vous, vous n'avez rien à faire.</p>
    <p><b>Si ce n'est pas vous</b>, contactez-nous immédiatement en répondant à ce message ou en appelant la concession : nous bloquerons l'accès et vous enverrons un nouveau lien.</p>
    <p><a href="${esc(home)}">Me connecter</a></p>
    <p>Pour votre sécurité, ce message ne contient jamais votre mot de passe.</p>
    <p>Ducati Bruxelles</p>`;
  }

  // 5. Envoi.
  const tok = await graphToken();
  if (!tok) return J({ error: 'graph_auth_failed' }, 502);
  const send = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: email } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!send.ok) return J({ error: 'send_failed', detail: (await send.text()).slice(0, 200) }, 502);
  return J({ ok: true, kind, to: email, from: sender });
});
