/**
 * Mission 07, carte 3 — accès à la base pour le chargeur des manuels d'atelier.
 *
 * La clé de service n'est jamais écrite, ni affichée, ni passée en argument : elle est lue dans la
 * variable d'environnement SUPABASE_SERVICE_ROLE_KEY (sous Windows, aussi dans les variables
 * « Utilisateur », que le terminal ne voit pas toujours).
 *
 * PIÈGE CONNU (23/09) : PostgREST se connecte avec le rôle `authenticator`, qui porte
 * `statement_timeout = 8 s` — **même avec la clé de service**. Tout appel plus long est coupé
 * (code PostgreSQL 57014) et, côté Node, la connexion tombe : `fetch failed`, sans autre détail.
 * D'où, ici :
 *   * un délai explicite par requête (60 s) au lieu d'attendre indéfiniment ;
 *   * des réessais avec attente doublée sur erreur réseau, 5xx, 429 et 57014 ;
 *   * une erreur DÉTAILLÉE (méthode, statut HTTP, corps, code réseau) au lieu de « fetch failed » ;
 *   * un marqueur `tooSlow` sur l'erreur, pour que l'appelant coupe son lot en deux et recommence.
 */
import { execFileSync } from 'node:child_process';

export const PROJECT_URL = 'https://ujmrosbgkvgvwfnuryna.supabase.co';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 5; // 1 essai + 4 réessais

let cached;

/** Clé de service, ou null si elle n'est nulle part. */
export function serviceKey() {
  if (cached !== undefined) return cached;
  cached = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
  if (!cached && process.platform === 'win32') {
    try {
      const v = execFileSync('powershell.exe', ['-NoProfile', '-Command',
        "[Environment]::GetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY','User')"], { encoding: 'utf8' }).trim();
      if (v) cached = v;
    } catch { /* rien */ }
  }
  return cached;
}

export function baseUrl() {
  return (process.env.SUPABASE_URL || PROJECT_URL).replace(/\/$/, '');
}

function requireKey() {
  const k = serviceKey();
  if (!k) throw new Error('Clé de service absente : définir la variable SUPABASE_SERVICE_ROLE_KEY (elle ne sera pas affichée).');
  return k;
}

/** Chaîne des causes d'une erreur Node (undici range les vraies raisons dans `cause`). */
function causeChain(e) {
  const out = [];
  let c = e;
  for (let i = 0; c && i < 5; i++) {
    const bits = [c.name, c.code, c.message].filter(Boolean).join(' ');
    if (bits && !out.includes(bits)) out.push(bits);
    c = c.cause;
  }
  return out.join(' <- ');
}

/** Une erreur réseau mérite-t-elle un réessai ? (coupure, délai dépassé, DNS, socket fermée…) */
function isRetryableNetwork(e) {
  const s = causeChain(e);
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ERR_SOCKET|UND_ERR|TimeoutError|AbortError|socket hang up|terminated|other side closed/i.test(s);
}

/** La base a-t-elle coupé la requête pour dépassement de `statement_timeout` ? */
function isStatementTimeout(status, body) {
  return status === 504 || /57014|statement timeout|canceling statement due to statement timeout/i.test(String(body || ''));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Un appel HTTP à PostgREST, avec délai, réessais et erreur lisible.
 * @returns {Promise<any>} le corps décodé (ou null si vide)
 */
async function request(method, path, { body, headers } = {}) {
  const key = requireKey();
  const url = `${baseUrl()}/${path.replace(/^\/+/, '')}`;
  let last;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res, text;
    try {
      res = await fetch(url, {
        method,
        headers: { apikey: key, Authorization: `Bearer ${key}`, ...(headers || {}) },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      text = await res.text();
    } catch (e) {
      last = new Error(`${method} ${path} : erreur réseau — ${causeChain(e)}`);
      last.tooSlow = /TimeoutError|AbortError|terminated|other side closed|ECONNRESET/i.test(causeChain(e));
      last.retryable = isRetryableNetwork(e);
      if (!last.retryable || attempt === MAX_ATTEMPTS) throw last;
      await sleep(2000 * 2 ** (attempt - 1));
      continue;
    }
    if (res.ok) return text ? JSON.parse(text) : null;

    const slow = isStatementTimeout(res.status, text);
    const retry = slow || res.status === 429 || res.status >= 500;
    last = new Error(`${method} ${path} : HTTP ${res.status}${slow ? ' (statement_timeout, 8 s côté PostgREST)' : ''} — ${String(text).slice(0, 600)}`);
    last.status = res.status;
    last.tooSlow = slow;
    last.retryable = retry;
    if (!retry || attempt === MAX_ATTEMPTS) throw last;
    await sleep(2000 * 2 ** (attempt - 1));
  }
  throw last;
}

/** Appelle une fonction SQL (RPC PostgREST). */
export async function rpc(fn, args) {
  return request('POST', `rest/v1/rpc/${fn}`, {
    body: JSON.stringify(args),
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Lecture directe d'une table (PostgREST), pour les listes simples. */
export async function select(path) {
  return (await request('GET', `rest/v1/${path}`)) ?? [];
}

/** Envoie un fichier dans un bucket Supabase Storage (écrase s'il existe déjà). */
export async function putObject(bucket, objectPath, body, type) {
  try {
    await request('POST', `storage/v1/object/${bucket}/${objectPath}`, {
      body,
      headers: { 'Content-Type': type, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
    });
  } catch (e) {
    if (e.status !== 409) throw e; // 409 : l'objet est déjà là, c'est le résultat voulu
  }
  return 200;
}
