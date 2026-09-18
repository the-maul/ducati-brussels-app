// M10 — Edge Function : relève les boîtes Outlook d'écoute (Microsoft Graph), journalise
// les mails entrants sur le contact correspondant et charge les PIÈCES JOINTES en GED.
// Appelée par pg_cron (toutes les 5 min). Dégradée proprement si les secrets manquent.
//
// LOT 1 du chantier « nouveau client » (docs/plan-nouveau-client.md) :
//   - plusieurs boîtes par société (table company_mailboxes), un curseur PAR BOÎTE ;
//   - le CORPS COMPLET du mail est relevé (avant : bodyPreview, 255 caractères) ;
//   - un expéditeur INCONNU n'est plus ignoré : le mail est analysé par
//     `classify-prospect-email`, et selon le verdict on crée un prospect + une tâche CRM
//     (`create_prospect_from_email`) ou on laisse une simple trace (`log_ignored_email`).
//     Décision client D1 : c'est l'analyse qui décide, il n'y a pas de liste d'exclusion.
//
// Secrets requis : MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET
//   (app Azure avec permission APPLICATION Mail.Read). SUPABASE_URL / SERVICE_ROLE injectés.
//   ANTHROPIC_API_KEY est consommé par classify-prospect-email, pas ici.
// Config : table `company_mailboxes` (Paramètres → Sociétés).
//
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TENANT = Deno.env.get('MS_GRAPH_TENANT_ID');
const CID = Deno.env.get('MS_GRAPH_CLIENT_ID');
const CSECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET');

// Le corps stocké est borné : un fil de discussion peut peser des centaines de Ko,
// et l'analyse n'a besoin que du début. 12 000 caractères = la limite côté analyse.
const MAX_BODY = 12000;

async function db(path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
}
// Détail de la dernière erreur d'appel SQL. Sans ça, un refus de PostgREST se
// résumait à « rien créé » et la cause restait invisible.
let lastRpcError = '';
async function rpc(fn: string, body: unknown) {
  const r = await db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) {
    lastRpcError = `${fn} ${r.status}: ${(await r.text()).slice(0, 300)}`;
    return null;
  }
  lastRpcError = '';
  const txt = await r.text();            // certaines RPC renvoient void (corps vide)
  return txt ? JSON.parse(txt) : null;
}

async function graphToken(): Promise<string | null> {
  const form = new URLSearchParams({ client_id: CID!, client_secret: CSECRET!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  if (!res.ok) return null;
  return (await res.json()).access_token ?? null;
}
// `Prefer: outlook.body-content-type="text"` : Graph renvoie le corps en texte brut
// plutôt qu'en HTML. Sans ça il faudrait dé-baliser nous-mêmes.
const G = (tok: string, path: string) => fetch(`https://graph.microsoft.com/v1.0${path}`, {
  headers: { Authorization: `Bearer ${tok}`, Prefer: 'outlook.body-content-type="text"' },
});

async function sha256hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// upload un fichier (octets) en GED + ligne attachments, dossier "E-mails".
// Dédup : si une pièce de même contenu existe déjà pour ce contact, on saute.
async function gedUpload(companyId: string, contactId: string, name: string, ctype: string, bytes: Uint8Array): Promise<boolean> {
  const hash = await sha256hex(bytes);
  const ex = await (await db(`attachments?select=id&entity_type=eq.contact&entity_id=eq.${contactId}&content_hash=eq.${hash}&limit=1`)).json();
  if (Array.isArray(ex) && ex.length) return false; // déjà présent (même image au fil des échanges)
  const safe = name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${companyId}/contact/${contactId}/${Date.now()}_${safe}`;
  const up = await fetch(`${URL}/storage/v1/object/ged/${path}`, { method: 'POST', headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': ctype, 'x-upsert': 'true' }, body: bytes });
  if (!up.ok) throw new Error(`storage ${up.status}`);
  const ins = await db('attachments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ company_id: companyId, entity_type: 'contact', entity_id: contactId, file_name: name, storage_path: path, content_type: ctype, size_bytes: bytes.length, content_hash: hash, folder: 'E-mails', note: 'Pièce jointe e-mail (Outlook)' }) });
  if (!ins.ok) throw new Error(`attach insert ${ins.status}: ${(await ins.text()).slice(0, 120)}`);
  return true;
}

// Analyse d'un mail d'expéditeur inconnu. Renvoie null si l'analyse est indisponible :
// dans ce cas on ne crée rien et on ne marque pas le mail comme traité, il repassera.
async function classify(from: string, to: string, subject: string, body: string) {
  try {
    const r = await fetch(`${URL}/functions/v1/classify-prospect-email`, {
      method: 'POST',
      headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, body }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return (j?.data ?? null) as null | {
      is_prospect: boolean; reason: string; is_professional: boolean;
      first_name: string | null; last_name: string | null; company_name: string | null;
      vat_number: string | null; phone: string | null; interest: string | null;
      request_summary: string | null; sender_is_relay: boolean; contact_email: string | null;
      city: string | null; zip: string | null; country: string | null; vehicle_ref: string | null;
    };
  } catch { return null; }
}

// Réponses automatiques et messages système : jamais des prospects, et les analyser
// coûterait un appel pour rien.
function isAutomatic(subject: string, from: string): boolean {
  const s = (subject || '').toLowerCase();
  const f = (from || '').toLowerCase();
  return /^(re\s*:\s*)?(out of office|absence du bureau|automatic reply|réponse automatique|reponse automatique|undeliverable|delivery status|mail delivery)/.test(s)
    || /^(mailer-daemon|postmaster|no-?reply|ne-?pas-?repondre|donotreply)@/.test(f);
}

Deno.serve(async () => {
  if (!TENANT || !CID || !CSECRET) return new Response(JSON.stringify({ error: 'graph_not_configured' }), { status: 501, headers: { 'Content-Type': 'application/json' } });
  const tok = await graphToken();
  if (!tok) return new Response(JSON.stringify({ error: 'graph_auth_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } });

  let logged = 0, photos = 0, scanned = 0, prospects = 0, ignored = 0, mailboxRepaired = 0;
  const errors: string[] = [];
  try {
  // Toutes les boîtes actives, toutes sociétés confondues.
  const mbRes = await db('company_mailboxes?select=id,company_id,address,inbound_last_check,sent_last_check&is_active=eq.true');
  const mailboxes = await mbRes.json();
  if (!Array.isArray(mailboxes)) return new Response(JSON.stringify({ error: 'mailboxes_query', detail: mailboxes }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  // Nos propres adresses : un mail que l'on s'envoie entre boîtes n'est pas un prospect.
  const ownAddresses = new Set((mailboxes as Array<Record<string, string>>).map((m) => (m.address || '').toLowerCase()));

  const addr = (o: unknown) => (((o as Record<string, unknown>)?.emailAddress as Record<string, unknown>)?.address as string) || '';

  // Relève d'un dossier (inbox ou sentitems). Pour 'in' on matche l'expéditeur ;
  // pour 'out' on matche le 1er destinataire. Charge aussi les pièces jointes.
  async function processFolder(coId: string, mailbox: string, folder: string, direction: 'in' | 'out', since: string): Promise<string> {
    const q = `/users/${encodeURIComponent(mailbox)}/mailFolders/${folder}/messages?$top=25&$orderby=${direction === 'in' ? 'receivedDateTime' : 'sentDateTime'}%20desc&$select=id,subject,body,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime,hasAttachments`;
    const res = await G(tok!, q);
    if (!res.ok) { errors.push(`${folder} ${mailbox}: ${res.status}`); return since; }
    const msgs = (await res.json()).value ?? [];
    // Comparaison en millisecondes, JAMAIS en texte. Graph renvoie « 2026-09-14T13:45:29.1Z »
    // et PostgREST relit le curseur en « 2026-09-14T13:45:29.1+00:00 » : en comparaison de
    // chaînes, 'Z' (0x5A) est supérieur à '+' (0x2B), donc `ts <= since` était toujours faux
    // et chaque passage rescannait les mêmes messages.
    const sinceMs = Number.isFinite(Date.parse(since)) ? Date.parse(since) : 0;

    // Du PLUS ANCIEN au plus récent, et le curseur n'avance qu'APRÈS traitement réussi.
    // Auparavant il avançait dès qu'on décidait de traiter un message : une analyse en
    // échec consommait donc le mail définitivement, sans fiche, sans tâche et sans trace.
    // C'est exactement ce qui est arrivé le 14/09 à un mail reçu sur occasions@.
    // Désormais le premier échec arrête le dossier : le message repasse au tour suivant.
    const fresh = (msgs as Array<Record<string, unknown>>)
      .map((m) => ({ m, ts: (direction === 'in' ? m.receivedDateTime : (m.sentDateTime || m.receivedDateTime)) as string }))
      .filter((x) => { const n = Date.parse(x.ts); return Number.isFinite(n) && n > sinceMs; })
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

    let maxTs = since;
    for (const { m, ts } of fresh) {
      try {
        scanned++;
        const sender = addr(m.from);
        const recips = (m.toRecipients as unknown[] | undefined) ?? [];
        const matchEmail = direction === 'in' ? sender : (recips.length ? addr(recips[0]) : '');
        const displayFrom = direction === 'in' ? sender : mailbox;
        const subject = (m.subject ?? '') as string;
        // Corps complet (texte brut grâce à l'en-tête Prefer), replié sur l'aperçu si absent.
        const bodyFull = ((m.body as Record<string, unknown> | undefined)?.content as string | undefined) ?? (m.bodyPreview as string | undefined) ?? '';
        const body = bodyFull.slice(0, MAX_BODY);

        const ing = await rpc('ingest_email', { _company: coId, _direction: direction, _match_email: matchEmail, _display_from: displayFrom, _subject: subject, _body: body, _received: ts, _external_id: m.id });
        const row = Array.isArray(ing) ? ing[0] : ing;

        let contactId: string | null = row?.matched ? (row.contact_id as string) : null;

        // Déjà vu et délibérément écarté : `ingest_email` retrouve bien la communication par
        // son identifiant de message, mais sans fiche rattachée, donc il répond matched=false
        // comme pour un inconnu. Sans ce garde, un mail écarté serait réanalysé à chaque tour.
        if (!contactId && row?.communication_id) { ignored++; maxTs = ts; continue; }

        // --- Expéditeur inconnu : c'est ici que se jouait la perte du prospect. ---
        if (!contactId && direction === 'in' && matchEmail) {
          if (ownAddresses.has(matchEmail.toLowerCase()) || isAutomatic(subject, matchEmail)) {
            await rpc('log_ignored_email', { _company: coId, _email: matchEmail, _subject: subject, _received: ts, _external_id: m.id, _verdict: 'message automatique ou interne' });
            ignored++;
            maxTs = ts;
            continue;
          }
          const verdict = await classify(matchEmail, mailbox, subject, body);
          if (!verdict) {
            // Analyse indisponible : on NE consomme PAS le mail et on arrête ici. Le curseur
            // reste en arrière, le message repassera au prochain tour.
            errors.push(`analyse indisponible, message non consomme: ${String(m.id).slice(0, 24)}`);
            return maxTs;
          }
          if (!verdict.is_prospect) {
            await rpc('log_ignored_email', { _company: coId, _email: matchEmail, _subject: subject, _received: ts, _external_id: m.id, _verdict: verdict.reason });
            ignored++;
            maxTs = ts;
            continue;
          }
          const created = await rpc('create_prospect_from_email', {
            _company: coId, _email: matchEmail, _subject: subject, _body: body,
            _received: ts, _external_id: m.id,
            _extract: {
              first_name: verdict.first_name, last_name: verdict.last_name,
              company_name: verdict.company_name, vat_number: verdict.vat_number,
              phone: verdict.phone, is_professional: verdict.is_professional,
              interest: verdict.interest, request_summary: verdict.request_summary,
              // Message relayé (formulaire du site, Shopify) : l'expéditeur technique n'est pas
              // le prospect. La fiche doit porter l'adresse trouvée dans le corps du message,
              // et le canal devient « web » et non « mail ».
              sender_is_relay: verdict.sender_is_relay, contact_email: verdict.contact_email,
              city: verdict.city, zip: verdict.zip, country: verdict.country,
              vehicle_ref: verdict.vehicle_ref,
            },
          });
          const crow = Array.isArray(created) ? created[0] : created;
          if (!crow?.contact_id) {
            // Création refusée : on ne consomme pas non plus, sinon le prospect est perdu.
            errors.push(`prospect non cree, message non consomme: ${String(m.id).slice(0, 24)} — ${lastRpcError || 'cause inconnue'}`);
            return maxTs;
          }
          contactId = crow.contact_id as string;
          if (crow.created) prospects++;
        }

        if (!contactId) { maxTs = ts; continue; }
        logged++;

        // La boîte qui a reçu (ou envoyé) ce mail : c'est elle que la carte propose par
        // défaut pour répondre. Idempotent : on ne l'écrit que si elle manque.
        await db(`communications?company_id=eq.${coId}&external_id=eq.${encodeURIComponent(String(m.id))}&mailbox=is.null`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ mailbox }),
        });

        const at = await G(tok!, `/users/${encodeURIComponent(mailbox)}/messages/${m.id}/attachments`);
        if (at.ok) for (const a of ((await at.json()).value ?? []) as Array<Record<string, unknown>>) {
          if (a['@odata.type'] !== '#microsoft.graph.fileAttachment' || !a.contentBytes) continue;
          const ctype = String(a.contentType || 'application/octet-stream');
          const bin = Uint8Array.from(atob(a.contentBytes as string), (c) => c.charCodeAt(0));
          // On capture TOUS les documents (PDF, Word, images…). On ignore seulement les
          // petites images inline = logos/espaceurs de signature.
          if (ctype.startsWith('image/') && a.isInline === true && bin.length < 30000) continue;
          if (await gedUpload(coId, contactId, String(a.name || 'fichier'), ctype, bin)) photos++;
        }

        // Message entièrement traité : c'est seulement ici que le curseur avance.
        maxTs = ts;
      } catch (e) {
        // On n'avance pas le curseur : le message repassera plutôt que d'être perdu.
        errors.push(`msg ${m.id}: ${String(e).slice(0, 120)}`);
        return maxTs;
      }
    }
    return maxTs;
  }

  for (const mb of mailboxes as Array<Record<string, string>>) {
    const mailbox = mb.address;
    if (!mailbox) continue;
    const day = new Date(Date.now() - 864e5).toISOString();
    const inSince = mb.inbound_last_check || day;
    const sentSince = mb.sent_last_check || day;
    const maxIn = await processFolder(mb.company_id, mailbox, 'inbox', 'in', inSince);
    const maxSent = await processFolder(mb.company_id, mailbox, 'sentitems', 'out', sentSince);
    await rpc('set_mailbox_cursors', { _mailbox: mb.id, _in: maxIn !== inSince ? maxIn : null, _sent: maxSent !== sentSince ? maxSent : null });
  }

  // Rattrapage : les mails enregistrés avant qu'on retienne leur boîte. Un identifiant
  // de message Graph n'existe que dans la boîte qui le contient : on demande à chaque
  // boîte de la société, la bonne répond 200. Borné pour ne pas alourdir la relève.
  const orphans = await (await db(`communications?select=id,company_id,external_id&channel=eq.email&mailbox=is.null&external_id=not.is.null&occurred_at=gte.${new Date(Date.now() - 30 * 864e5).toISOString()}&order=occurred_at.desc&limit=15`)).json();
  if (Array.isArray(orphans)) for (const o of orphans as Array<Record<string, string>>) {
    for (const mb of (mailboxes as Array<Record<string, string>>).filter((x) => x.company_id === o.company_id)) {
      const r = await G(tok!, `/users/${encodeURIComponent(mb.address)}/messages/${encodeURIComponent(o.external_id)}?$select=id`);
      if (r.ok) {
        await db(`communications?id=eq.${o.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ mailbox: mb.address }) });
        mailboxRepaired++;
        break;
      }
    }
  }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'unhandled', detail: String(e).slice(0, 300), scanned, logged, photos, prospects, ignored, errors }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // Un paragraphe par échange dans la note de la demande (summarize-exchange).
  // Au mieux : un échec ici ne remet pas en cause la relève, et l'échange sera
  // repris au passage suivant puisqu'il n'est marqué qu'une fois résumé.
  let summaries: unknown = null;
  try {
    const s = await fetch(`${URL}/functions/v1/summarize-exchange`, {
      method: 'POST',
      headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 5 }),
    });
    summaries = await s.json();
  } catch (e) { summaries = { error: String(e).slice(0, 120) }; }

  return new Response(JSON.stringify({ scanned, logged, photos, prospects, ignored, mailboxRepaired, summaries, errors }), { headers: { 'Content-Type': 'application/json' } });
});
