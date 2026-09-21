#!/usr/bin/env node
/**
 * Chargeur des plans d'entretien Ducati (mission 07, carte 1) : lit plans.json et temps.json
 * (extraction des documents d'entretien déposés par Simon) et les pousse en base par la fonction
 * idempotente maintenance_ingest. Relançable à volonté (quand Simon ajoute des documents et que
 * l'extraction est refaite) : un plan inchangé n'est pas réécrit, aucune ligne n'est dupliquée.
 *
 * Usage (depuis le dossier du dépôt) :
 *   node tools/maintenance-loader/load.mjs                   # dossier par défaut : ..\entretiens-extraits
 *   node tools/maintenance-loader/load.mjs --dir "D:\x"      # autre dossier
 *   node tools/maintenance-loader/load.mjs --dry-run         # vérifie les fichiers, n'écrit rien
 *   node tools/maintenance-loader/load.mjs --force           # réécrit aussi les plans inchangés
 *   node tools/maintenance-loader/load.mjs --stats           # affiche seulement ce qui est en base
 *   node tools/maintenance-loader/load.mjs --sql out.sql [--rollback]
 *        # écrit le SQL au lieu d'appeler l'API (à passer avec npx supabase db query -f) ;
 *        # --rollback : tout est annulé à la fin (essai)
 *
 * Accès base (mode normal) : clé de service lue dans la variable d'environnement
 * SUPABASE_SERVICE_ROLE_KEY (sous Windows, aussi dans les variables « Utilisateur »). Elle n'est
 * jamais écrite ni affichée. URL : SUPABASE_URL, sinon le projet ujmrosbgkvgvwfnuryna.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildPlans, slimSources, slimChecklists, chunk, dollarQuote } from './transform.mjs';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const DIR = opt('--dir', join(homedir(), 'Desktop', 'ducati', 'entretiens-extraits'));
const DRY = flag('--dry-run');
const FORCE = flag('--force');
const SQL_OUT = opt('--sql', null);
const ROLLBACK = flag('--rollback');
const PLANS_PER_CALL = Number(opt('--chunk', 5));
const PROJECT_URL = 'https://ujmrosbgkvgvwfnuryna.supabase.co';

const log = (...m) => console.log(...m);
const readJson = (f) => JSON.parse(readFileSync(join(DIR, f), 'utf8').replace(/^\uFEFF/, ''));

function serviceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.platform === 'win32') {
    try {
      const v = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY','User')"], { encoding: 'utf8' }).trim();
      if (v) return v;
    } catch { /* rien */ }
  }
  return null;
}

function apiTarget() {
  const key = serviceKey();
  if (!key) throw new Error('Clé de service absente : définir la variable SUPABASE_SERVICE_ROLE_KEY (elle ne sera pas affichée).');
  const url = (process.env.SUPABASE_URL || PROJECT_URL).replace(/\/$/, '');
  return {
    async call(fn, body) {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        if (res.ok) return text ? JSON.parse(text) : null;
        if (res.status >= 500 && attempt < 2) { await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); continue; }
        let msg = text;
        try { const j = JSON.parse(text); msg = j.message || text; } catch { /* texte brut */ }
        throw new Error(`${fn} : HTTP ${res.status} — ${String(msg).slice(0, 400)}`);
      }
    },
    async finish() {},
  };
}

function sqlTarget(file) {
  const parts = ['begin;', `select set_config('request.jwt.claims', '{"role":"service_role"}', true);`,
    'create temp table _loader(n serial, fn text, r jsonb);'];
  const arg = (v) => (v === null || v === undefined ? 'null' : typeof v === 'object' ? dollarQuote(JSON.stringify(v)) + '::jsonb' : typeof v === 'boolean' ? String(v) : typeof v === 'number' ? String(v) : dollarQuote(String(v)));
  return {
    async call(fn, body) {
      const params = Object.entries(body).map(([k, v]) => `${k} => ${arg(v)}`).join(', ');
      parts.push(`insert into _loader(fn, r) select '${fn}', to_jsonb(public.${fn}(${params}));`);
      return null;
    },
    async finish() {
      if (ROLLBACK) {
        parts.push(`do $r$ begin raise exception 'RESULTATS %', (select jsonb_build_object('calls', (select jsonb_agg(jsonb_build_object('fn', fn, 'r', r) order by n) from _loader), 'stats', public.maintenance_stats())); end $r$;`);
      } else {
        parts.push('commit;');
      }
      writeFileSync(file, parts.join('\n') + '\n', 'utf8');
      log(`SQL écrit : ${file}${ROLLBACK ? ' (annulé à la fin : essai)' : ''}`);
    },
  };
}

async function main() {
  if (flag('--stats')) { log(`Plans d'entretien en base : ${JSON.stringify(await apiTarget().call('maintenance_stats', {}))}`); return; }
  for (const f of ['plans.json', 'temps.json']) if (!existsSync(join(DIR, f))) throw new Error(`Fichier introuvable : ${join(DIR, f)}`);

  const plansJson = readJson('plans.json');
  const tempsJson = readJson('temps.json');
  const sources = slimSources(plansJson.meta);
  const checklists = slimChecklists(plansJson.listes_controles);
  const { plans, warnings, counts } = buildPlans(plansJson, tempsJson);
  const files = ['plans.json', 'temps.json'].map((f) => { const st = statSync(join(DIR, f)); return { name: f, size: st.size, mtime: st.mtime.toISOString() }; });

  log(`Dossier : ${DIR}`);
  log(`Lu : ${sources.length} documents sources, ${checklists.length} listes des contrôles, ${counts.plans} plans, ${counts.services} échéances, `
    + `${counts.intervals} intervalles (${counts.intervalsCurrent} en vigueur), ${counts.operations} opérations, ${counts.times} temps (${counts.timesCurrent} en vigueur)`);
  warnings.slice(0, 20).forEach((w) => log('  ! ' + w));
  if (warnings.length > 20) log(`  ! … ${warnings.length - 20} autre(s) avertissement(s)`);
  if (DRY) { log('Essai à blanc : rien n’a été écrit.'); return; }

  const target = SQL_OUT ? sqlTarget(SQL_OUT) : apiTarget();
  const run = `maintenance-${new Date().toISOString()}`;
  const total = { plans_new: 0, plans_updated: 0, plans_unchanged: 0, rows_removed: 0 };
  try {
    const parts = chunk(plans, PLANS_PER_CALL);
    for (let i = 0; i < parts.length; i++) {
      const payload = { run, files, plans: parts[i], ...(i === 0 ? { sources, checklists } : {}) };
      const r = await target.call('maintenance_ingest', { _payload: payload, _force: FORCE });
      if (r) for (const k of Object.keys(total)) total[k] += Number(r[k] || 0);
      if (!SQL_OUT) process.stdout.write(`\rPlans envoyés : ${Math.min((i + 1) * PLANS_PER_CALL, plans.length)} / ${plans.length}`);
    }
    if (!SQL_OUT) {
      process.stdout.write('\n');
      log(`Nouveaux : ${total.plans_new} · mis à jour : ${total.plans_updated} · inchangés : ${total.plans_unchanged} · lignes retirées : ${total.rows_removed}`);
      log(`En base : ${JSON.stringify(await target.call('maintenance_stats', {}))}`);
    }
  } finally {
    await target.finish();
  }
  log('Terminé.');
}

main().catch((e) => { console.error('ERREUR : ' + (e && e.message ? e.message : e)); process.exit(1); });
