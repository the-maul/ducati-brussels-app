/**
 * M10 — Diagnostic d'une boîte Outlook écoutée. LECTURE SEULE, aucune ingestion.
 *
 * Sert à répondre à « j'ai envoyé un mail et je ne le vois pas arriver ». La relève
 * ne lit que deux dossiers, Boîte de réception et Éléments envoyés. Si une règle
 * classe le message ailleurs, il est invisible pour elle. Cette fonction liste tous
 * les dossiers avec leur nombre de messages et la date du plus récent, ce qui montre
 * immédiatement où le courrier atterrit réellement.
 *
 * Ne renvoie JAMAIS le corps d'un message : objet, expéditeur et date suffisent.
 *
 * Déploiement : `supabase functions deploy mailbox-diag`
 * Entrée  : POST { mailbox: "occasions@ducatibxl.be" }
 * Sortie  : { mailbox, folders: [{ name, total, unread, newest }] }
 *
 * deno-lint-ignore-file
 */
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TENANT = Deno.env.get('MS_GRAPH_TENANT_ID');
const CID = Deno.env.get('MS_GRAPH_CLIENT_ID');
const CSECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET');

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function db(path: string) {
  return fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: SVC!, Authorization: `Bearer ${SVC}` } });
}
async function token(): Promise<string | null> {
  const form = new URLSearchParams({ client_id: CID!, client_secret: CSECRET!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  return r.ok ? (await r.json()).access_token : null;
}
const G = (tok: string, path: string) => fetch(`https://graph.microsoft.com/v1.0${path}`, {
  headers: { Authorization: `Bearer ${tok}`, Prefer: 'outlook.body-content-type="text"' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!TENANT || !CID || !CSECRET) return J({ error: 'graph_not_configured' }, 501);

  const { mailbox } = await req.json() as { mailbox?: string };
  if (!mailbox) return J({ error: 'no_mailbox' }, 400);

  // La boîte doit être une boîte écoutée : pas d'exploration arbitraire du tenant.
  const mb = await (await db(`company_mailboxes?select=address&address=eq.${encodeURIComponent(mailbox)}`)).json();
  if (!Array.isArray(mb) || mb.length === 0) return J({ error: 'unknown_mailbox' }, 400);

  const tok = await token();
  if (!tok) return J({ error: 'graph_auth_failed' }, 502);

  const fRes = await G(tok, `/users/${encodeURIComponent(mailbox)}/mailFolders?$top=60&$select=id,displayName,totalItemCount,unreadItemCount`);
  if (!fRes.ok) return J({ error: 'folders_failed', status: fRes.status, detail: (await fRes.text()).slice(0, 200) }, 502);
  const folders = ((await fRes.json()).value ?? []) as Array<Record<string, unknown>>;

  const out: Array<Record<string, unknown>> = [];
  for (const f of folders) {
    const total = Number(f.totalItemCount ?? 0);
    const entry: Record<string, unknown> = {
      name: f.displayName, total, unread: Number(f.unreadItemCount ?? 0), newest: null,
    };
    // Le plus récent, seulement là où il y a du courrier (on borne les appels).
    if (total > 0 && out.filter((o) => o.newest).length < 12) {
      const m = await G(tok, `/users/${encodeURIComponent(mailbox)}/mailFolders/${f.id}/messages?$top=1&$orderby=receivedDateTime%20desc&$select=receivedDateTime,subject,from`);
      if (m.ok) {
        const first = ((await m.json()).value ?? [])[0] as Record<string, unknown> | undefined;
        if (first) {
          entry.newest = {
            received: first.receivedDateTime,
            subject: String(first.subject ?? '').slice(0, 80),
            from: ((first.from as Record<string, Record<string, string>> | undefined)?.emailAddress?.address) ?? null,
          };
        }
      }
    }
    out.push(entry);
  }

  return J({ mailbox, folders: out.sort((a, b) => Number(b.total) - Number(a.total)) });
});
