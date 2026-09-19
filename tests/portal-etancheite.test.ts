/**
 * Étanchéité du portail client (/mon-espace) — contrôle statique des migrations.
 *
 * Règle (migration 20260919120000, repris par la mission 04 carte 8) : toute fonction
 * `public.portal_*` est SECURITY DEFINER, retrouve le client par `_portal_ctx()`
 * (contact_accounts.user_id = auth.uid(), jamais un identifiant du navigateur),
 * et porte `revoke all … from public, anon` + `grant execute … to authenticated`.
 * Les fonctions « équipe » de la carte 8 contrôlent is_member().
 * Le test en base (clients A et B, transaction annulée) est
 * supabase/tests/m4_motos_declarees_etancheite.sql. Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dir, '..', 'supabase', 'migrations');
const sql = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(join(DIR, f), 'utf8')).join('\n');

/** Dernière définition de chaque fonction (le texte jusqu'au délimiteur de fin). */
function definitions(prefix: RegExp): Map<string, { body: string; args: string }> {
  const out = new Map<string, { body: string; args: string }>();
  const re = /create or replace function public\.(\w+)\s*\(([^)]*)\)([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\4\$/gi;
  for (const m of sql.matchAll(re)) {
    if (!prefix.test(m[1])) continue;
    out.set(m[1], { args: m[2], body: m[3] + m[5] });
  }
  return out;
}

const PORTAL = definitions(/^portal_/);

test('les fonctions du portail existent (dont celles de la carte 8)', () => {
  for (const f of ['portal_vehicles', 'portal_declare_vehicle', 'portal_prepare_declaration_upload', 'portal_declared_vehicles']) {
    expect(PORTAL.has(f)).toBe(true);
  }
});

test('chaque fonction portal_* est SECURITY DEFINER et passe par _portal_ctx()', () => {
  const bad = [...PORTAL].filter(([, d]) => !/security definer/i.test(d.body) || !/_portal_ctx\(\)/.test(d.body)).map(([n]) => n);
  expect(bad).toEqual([]);
});

test('chaque fonction portal_* est fermée à public/anon et ouverte aux connectés', () => {
  const bad = [...PORTAL.keys()].filter((n) => {
    const revoke = new RegExp(`revoke all on function public\\.${n}\\([^)]*\\) from public, anon`, 'i');
    const grant = new RegExp(`grant execute on function public\\.${n}\\([^)]*\\) to authenticated`, 'i');
    return !revoke.test(sql) || !grant.test(sql);
  });
  expect(bad).toEqual([]);
});

test('carte 8 : une déclaration n\'est acceptée que si elle appartient au client connecté', () => {
  const body = PORTAL.get('portal_prepare_declaration_upload')!.body;
  expect(body).toMatch(/d\.contact_id = _ctx\.contact_id/);
  expect(body).toMatch(/d\.company_id = _ctx\.company_id/);
  // Le chemin de stockage est fixé par la base, sur la fiche du client, jamais par le navigateur.
  expect(body).toMatch(/_path := _ctx\.company_id::text \|\| '\/contact\/' \|\| _ctx\.contact_id::text/);
});

test('carte 8 : les fonctions de l\'équipe contrôlent l\'appartenance à la société', () => {
  const team = definitions(/^(declared_vehicles_pending|_declared_vehicle_lock|vehicle_create_for_contact|vehicle_attach_owner|vehicles_find_by_vin)$/);
  expect(team.size).toBe(5);
  for (const [, d] of team) expect(d.body).toMatch(/is_member\(/);
});
