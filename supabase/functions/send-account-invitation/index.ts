// M0 — Edge Function : inviter une personne à choisir son mot de passe.
//
// Demande client du 18/09 : « on leur crée un compte et on envoie une invitation par
// mail pour générer un mot de passe ». Envoi par Outlook (décision D4), pas Resend.
//
// Le lien ne passe PAS par la page de vérification de Supabase : il mène directement
// à /reset-password de l'application, avec un jeton à usage unique. La page ne
// consomme ce jeton qu'au moment où la personne valide son nouveau mot de passe :
// un antivirus qui « clique » sur les liens d'un mail ne peut donc pas le griller,
// et on ne dépend pas de la liste d'adresses de retour autorisées côté Supabase.
//
// Réservé à un administrateur de la société.
// Entrée : POST { companyId, userId, origin }   Sortie : { ok, to }
// Secrets : MS_GRAPH_* (envoi), clé de service injectée.
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

async function db(path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
}
async function graphToken(): Promise<string | null> {
  const form = new URLSearchParams({ client_id: CID!, client_secret: CSECRET!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  return r.ok ? (await r.json()).access_token : null;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!TENANT || !CID || !CSECRET) return J({ error: 'graph_not_configured' }, 501);

  // 1. L'appelant : connecté ET administrateur de la société.
  const auth = req.headers.get('Authorization') ?? '';
  const me = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: SVC!, Authorization: auth } });
  if (!me.ok) return J({ error: 'not_signed_in' }, 401);
  const caller = await me.json();

  const { companyId, userId, origin } = await req.json();
  if (!companyId || !userId || !origin) return J({ error: 'missing_params' }, 400);
  const o = String(origin);
  if (!/^https:\/\/[^/]+$/.test(o) && !/^http:\/\/localhost(:\d+)?$/.test(o)) return J({ error: 'bad_origin' }, 400);

  const admin = await (await db(`user_roles?select=role&user_id=eq.${caller.id}&company_id=eq.${companyId}&role=eq.admin&limit=1`)).json();
  if (!Array.isArray(admin) || admin.length === 0) return J({ error: 'admin_only' }, 403);

  // 2. La personne invitée doit appartenir à cette société (équipe ou client).
  const [roles, account] = await Promise.all([
    db(`user_roles?select=role&user_id=eq.${userId}&company_id=eq.${companyId}&limit=1`).then((r) => r.json()),
    db(`contact_accounts?select=contact_id&user_id=eq.${userId}&company_id=eq.${companyId}&limit=1`).then((r) => r.json()),
  ]);
  const isStaff = Array.isArray(roles) && roles.length > 0;
  const isClient = Array.isArray(account) && account.length > 0;
  if (!isStaff && !isClient) return J({ error: 'not_in_company' }, 403);

  const ur = await fetch(`${URL}/auth/v1/admin/users/${userId}`, { headers: H });
  if (!ur.ok) return J({ error: 'user_not_found' }, 404);
  const target = await ur.json();
  const email = String(target.email ?? '');
  const name = String(target.user_metadata?.full_name ?? '').trim();
  if (!email) return J({ error: 'no_email' }, 400);

  // 3. Jeton de réinitialisation à usage unique.
  const gl = await fetch(`${URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'recovery', email }) });
  if (!gl.ok) return J({ error: 'link_failed', detail: (await gl.text()).slice(0, 200) }, 502);
  const g = await gl.json();
  const hashed = g.hashed_token ?? g.properties?.hashed_token;
  if (!hashed) return J({ error: 'link_failed', detail: 'no hashed_token' }, 502);
  const link = `${o}/reset-password?token_hash=${encodeURIComponent(hashed)}&type=recovery`;

  // 4. Envoi par Outlook, depuis info@ si la société l'a, sinon sa boîte principale.
  const boxes = await (await db(`company_mailboxes?select=address&company_id=eq.${companyId}&is_active=eq.true`)).json();
  const list = (Array.isArray(boxes) ? boxes : []).map((b: { address: string }) => b.address);
  const co = await (await db(`companies?select=name,inbound_mailbox&id=eq.${companyId}`)).json();
  const sender = list.find((a: string) => a.toLowerCase().startsWith('info@')) ?? co?.[0]?.inbound_mailbox ?? list[0];
  if (!sender) return J({ error: 'no_mailbox' }, 400);

  const hello = name ? `Bonjour ${esc(name)},` : 'Bonjour,';
  const intro = isClient
    ? "Ducati Bruxelles vous a créé un espace client. Vous pourrez y retrouver vos informations, vos véhicules et vos achats."
    : "Un compte a été créé pour vous sur la plateforme de gestion de Ducati Bruxelles.";
  const html = `
    <p>${hello}</p>
    <p>${intro}</p>
    <p>Pour l'activer, choisissez votre mot de passe en cliquant sur ce lien :</p>
    <p><a href="${esc(link)}">Choisir mon mot de passe</a></p>
    <p>Votre identifiant de connexion est : <b>${esc(email)}</b></p>
    <p>Ce lien ne sert qu'une fois et n'est valable que peu de temps. S'il a expiré, demandez-en simplement un nouveau à la concession.</p>
    <p>Si vous n'attendiez pas ce message, vous pouvez l'ignorer.</p>
    <p>Ducati Bruxelles</p>`;

  const tok = await graphToken();
  if (!tok) return J({ error: 'graph_auth_failed' }, 502);
  const send = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: isClient ? 'Votre espace client Ducati Bruxelles' : 'Votre compte Ducati Bruxelles',
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: email } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!send.ok) return J({ error: 'send_failed', detail: (await send.text()).slice(0, 200) }, 502);
  return J({ ok: true, to: email, from: sender });
});
