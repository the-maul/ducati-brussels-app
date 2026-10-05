/**
 * Espace client — documents du client (retour de Simon du 05/10, migration
 * 20261005130000). Contrôle statique des migrations + la règle de taille côté
 * navigateur. Exécution : `bun test`.
 *
 * Ce que ces tests protègent :
 *  - carte d'identité et faces VERSO acceptées par la base (point 1 et 2) ;
 *  - un document n'est complet que recto + verso, ou « pas de verso » déclaré (point 2) ;
 *  - une déclaration de moto n'est validée d'office que si la moto est DÉJÀ au nom
 *    du client qui l'a déclarée — jamais celle d'un autre client (point 3) ;
 *  - la limite de 10 Mo est la même en base et dans le navigateur (point 5) ;
 *  - la suppression par le client est tracée dans events et n'atteint que ses
 *    propres dépôts (point 4) ;
 *  - un dépôt supprimé n'est plus lisible depuis le stockage (point 4).
 */
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, fileSizeLabel } from '../src/modules/portal/image';

const DIR = join(import.meta.dir, '..', 'supabase', 'migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const sql = FILES.map((f) => readFileSync(join(DIR, f), 'utf8')).join('\n');

/** Dernière définition de chaque fonction du schéma public (le texte entre ses délimiteurs). */
function definitions(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /create or replace function public\.(\w+)\s*\(([^)]*)\)([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\4\$/gi;
  for (const m of sql.matchAll(re)) out.set(m[1], m[3] + m[5]);
  return out;
}
const FN = definitions();

/** Dernière contrainte portal_uploads.kind écrite dans les migrations. */
function lastKindConstraint(): string {
  const all = [...sql.matchAll(/portal_uploads_kind_check\s*\n?\s*check \(kind in \(([\s\S]*?)\)\)/gi)];
  expect(all.length).toBeGreaterThan(0);
  return all[all.length - 1][1];
}

test('point 1 et 2 : la carte d\'identité et toutes les faces verso sont acceptées', () => {
  const kinds = lastKindConstraint();
  for (const k of [
    'avatar', 'permis', 'permis_verso', 'carte_identite', 'carte_identite_verso',
    'vehicle_photo', 'carte_grise', 'carte_grise_verso', 'assurance', 'assurance_verso',
    'coc', 'coc_verso', 'controle_technique', 'controle_technique_verso', 'autre',
  ]) {
    expect(kinds).toContain(`'${k}'`);
  }
});

test('point 1 et 2 : chaque type recto a son verso, rangé sur la bonne entité', () => {
  const prepare = FN.get('portal_prepare_upload')!;
  // Documents d'identité : sur la fiche du client.
  expect(prepare).toMatch(/if p_kind in \('avatar', 'permis', 'permis_verso', 'carte_identite', 'carte_identite_verso'\)/);
  // Documents du véhicule : la moto doit lui appartenir.
  expect(prepare).toContain("'carte_grise_verso'");
  expect(prepare).toContain("'controle_technique_verso'");
  expect(prepare).toMatch(/_portal_owns_vehicle\(_ctx\.contact_id, _ctx\.company_id, p_vehicle_id\)/);
});

test('point 2 : un document est complet recto + verso, ou « pas de verso » déclaré', () => {
  const complete = FN.get('_portal_doc_complete')!;
  expect(complete).toContain("_kind || '_verso'");
  expect(complete).toContain('portal_doc_no_back');
  // L'accueil utilise cette règle pour le permis, la carte d'identité et les documents moto.
  const home = FN.get('portal_home')!;
  for (const k of ['permis', 'carte_identite', 'carte_grise', 'assurance']) {
    expect(home).toContain(`'${k}'`);
  }
  expect(home).toMatch(/_portal_doc_complete\(_ctx\.contact_id, 'contact', _ctx\.contact_id, 'carte_identite'\)/);
});

test('point 2 : « pas de verso » ne s\'applique qu\'à un type recto du client', () => {
  const f = FN.get('portal_set_doc_no_back')!;
  expect(f).toMatch(/if p_kind in \('permis', 'carte_identite'\)/);
  expect(f).toMatch(/_portal_owns_vehicle\(_ctx\.contact_id, _ctx\.company_id, p_vehicle_id\)/);
  expect(f).toMatch(/raise exception 'portal: invalid kind'/);
});

test('point 3 : une déclaration n\'est validée d\'office que sur une moto DÉJÀ au nom du client', () => {
  const m = FN.get('_declared_vehicle_owned_match')!;
  // La jointure sur le propriétaire courant est la garantie : jamais la moto d'un autre.
  expect(m).toMatch(/vehicle_owners vo on vo\.vehicle_id = v\.id and vo\.is_current and vo\.contact_id = _d\.contact_id/);
  expect(m).toContain('v.company_id = _d.company_id');
  // Trois rapprochements : VIN, plaque, marque + modèle normalisé (+ année).
  expect(m).toContain('vin_normalize');
  expect(m).toContain('plate_normalize');
  expect(m).toContain('vehicle_model_normalize');
});

test('point 3 : le modèle du parc porte la couleur — la normalisation la coupe', () => {
  const n = FN.get('vehicle_model_normalize')!;
  expect(n).toContain("split_part(coalesce(_model, ''), '|', 1)");
  expect(n).toContain('upper(');
  expect(n).toContain("[^A-Za-z0-9]");
});

test('point 3 : la validation d\'office est tracée et la file de l\'équipe se vide', () => {
  const a = FN.get('_declared_vehicle_autoresolve')!;
  expect(a).toContain("status = 'rattachee'");
  expect(a).toContain("'vehicle_declaration_auto_attached'");
  expect(a).toContain('insert into public.events');
  // Elle ne touche qu'une déclaration réellement en attente.
  expect(a).toMatch(/_d\.status is distinct from 'a_valider'/);
  // Et la cloche ne sonne plus pour une déclaration déjà validée.
  expect(FN.get('trg_notify_team_vehicle_declared')!).toMatch(/new\.status is distinct from 'a_valider'/);
});

test('point 4 : la suppression est tracée, limitée à ses dépôts, et coupe la lecture', () => {
  const del = FN.get('portal_delete_upload')!;
  expect(del).toContain('contact_id = _ctx.contact_id');
  expect(del).toContain('company_id = _ctx.company_id');
  expect(del).toContain('deleted_at = now()');
  expect(del).toContain("'portal_upload_deleted'");
  expect(del).toContain('insert into public.events');
  // Un dépôt supprimé n'est plus lisible depuis le stockage.
  expect(FN.get('portal_can_read_object')!).toContain('pu.deleted_at is null');
  expect(FN.get('_portal_last_upload')!).toContain('pu.deleted_at is null');
  expect(FN.get('_portal_files')!).toContain('pu.deleted_at is null');
  // L'effacement du fichier n'est permis que sur un dépôt que la base vient de marquer.
  const can = FN.get('portal_can_delete_object')!;
  expect(can).toContain('pu.deleted_at is not null');
  expect(can).toContain("now() - interval '1 hour'");
  expect(sql).toContain('create policy ged_portal_delete on storage.objects');
});

test('point 5 : la limite de 10 Mo est la même en base et dans le navigateur', () => {
  expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  expect(MAX_UPLOAD_LABEL).toBe('10 Mo');
  for (const fn of ['portal_prepare_upload', 'portal_complete_upload', 'portal_prepare_declaration_upload']) {
    const body = FN.get(fn)!;
    expect(body).toContain('10 * 1024 * 1024');
    expect(body).not.toContain('15 * 1024 * 1024');
  }
});

test('point 5 : le poids est annoncé en français au client', () => {
  expect(fileSizeLabel(15 * 1024 * 1024)).toBe('15 Mo');
  expect(fileSizeLabel(Math.round(1.5 * 1024 * 1024))).toBe('1,5 Mo');
  expect(fileSizeLabel(200 * 1024)).toBe('200 Ko');
});

test('point 6 : le libellé d\'un « autre document » n\'est posé que sur son propre dépôt', () => {
  const f = FN.get('portal_set_upload_label')!;
  expect(f).toContain('contact_id = _ctx.contact_id');
  expect(f).toContain('company_id = _ctx.company_id');
  expect(f).toContain('deleted_at is null');
  // Le libellé remonte au client avec chaque fichier.
  expect(FN.get('_portal_files')!).toContain("'label', pu.label");
});

test('les nouvelles fonctions du portail restent fermées à public/anon', () => {
  for (const n of ['portal_delete_upload', 'portal_set_upload_label', 'portal_set_doc_no_back']) {
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${n}\\([^)]*\\) from public, anon`, 'i'));
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${n}\\([^)]*\\) to authenticated`, 'i'));
  }
});
