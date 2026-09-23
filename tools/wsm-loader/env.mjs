/**
 * Mission 07, carte 3 — accès à la base pour le chargeur des manuels d'atelier.
 *
 * La clé de service n'est jamais écrite, ni affichée, ni passée en argument : elle est lue dans la
 * variable d'environnement SUPABASE_SERVICE_ROLE_KEY (sous Windows, aussi dans les variables
 * « Utilisateur », que le terminal ne voit pas toujours).
 */
import { execFileSync } from 'node:child_process';

export const PROJECT_URL = 'https://ujmrosbgkvgvwfnuryna.supabase.co';

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

/** Appelle une fonction SQL (RPC PostgREST), avec deux reprises sur erreur serveur. */
export async function rpc(fn, body) {
  const key = requireKey();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${baseUrl()}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : null;
    if (res.status >= 500 && attempt < 2) { await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); continue; }
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch { /* texte brut */ }
    throw new Error(`${fn} : HTTP ${res.status} — ${String(msg).slice(0, 400)}`);
  }
}

/** Lecture directe d'une table (PostgREST), pour les listes simples. */
export async function select(path) {
  const key = requireKey();
  const res = await fetch(`${baseUrl()}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`select ${path} : HTTP ${res.status} — ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}

/** Envoie un fichier dans un bucket Supabase Storage (écrase s'il existe déjà). */
export async function putObject(bucket, objectPath, body, type) {
  const key = requireKey();
  const res = await fetch(`${baseUrl()}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': type, 'x-upsert': 'true', 'cache-control': 'max-age=31536000',
    },
    body,
  });
  if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
  return res.status;
}
