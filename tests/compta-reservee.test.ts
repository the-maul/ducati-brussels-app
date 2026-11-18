/**
 * M12 — Fonctions comptables réservées à l'administrateur et au comptable (rattrapage G8,
 * 18/11/2026 ; bloquant n° 4, carte F1 de la mission 13).
 *
 * Trois listes doivent dire la même chose :
 *   1. la grille signée (`PAGE_RULES`, pages Comptabilité / clôture / SEPA) ;
 *   2. l'écran (`ACCOUNTING_ROLES`, garde `AccountingGate`) ;
 *   3. la base (`can_manage_accounting`, migration 20261118182000).
 * Et toute migration POSTÉRIEURE qui redéfinit une fonction protégée doit remettre la protection
 * (sinon la redéfinition remplace l'enveloppe et le contrôle disparaît sans bruit).
 * L'essai à blanc en base est supabase/tests/m12_compta_reservee.sql. Exécution : `bun test`.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_RULES, accessLevel } from '../src/lib/auth/permissions';
import { ACCOUNTING_ROLES, canManageAccounting, isAccountingForbidden } from '../src/lib/auth/accounting-access';
import type { AppRole } from '../src/lib/auth/auth-context';

const ROOT = join(import.meta.dir, '..');
const MIG_DIR = join(ROOT, 'supabase', 'migrations');
const GUARD_FILE = '20261118182000_m12_compta_reservee.sql';
const sql = readFileSync(join(MIG_DIR, GUARD_FILE), 'utf8');
const ROLES: AppRole[] = ['admin', 'vendeur', 'magasinier', 'mecanicien', 'chef_atelier', 'comptable', 'marketing'];

/** Fonctions enveloppées par la migration (nom seul). */
const GUARDED = [...sql.matchAll(/\('public\.([a-z_]+)\(/g)].map((m) => m[1]);

describe('qui fait de la comptabilité', () => {
  test("l'écran : administrateur et comptable seulement", () => {
    expect([...ACCOUNTING_ROLES].sort()).toEqual(['admin', 'comptable']);
    for (const r of ROLES) expect(canManageAccounting([r])).toBe(r === 'admin' || r === 'comptable');
    expect(canManageAccounting(['vendeur', 'comptable'])).toBe(true);
    expect(canManageAccounting([])).toBe(false);
  });

  test("la grille signée : seuls l'administrateur et le comptable ouvrent les trois pages", () => {
    for (const page of ['/accounting', '/accounting-closure', '/accounting-sepa']) {
      const rule = PAGE_RULES.find((r) => r.to === page)!;
      expect(rule.write).toEqual(['comptable']);
      expect(rule.read).toEqual([]);
      for (const r of ROLES) expect(accessLevel(page, [r]) !== 'none').toBe(canManageAccounting([r]));
    }
  });

  test('les fonctions SEPA protégées existent bien dans les migrations (signatures exactes)', () => {
    const all = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql') && f < GUARD_FILE).map((f) => readFileSync(join(MIG_DIR, f), 'utf8')).join(' ');
    for (const fn of ['sepa_batch_create', 'sepa_batch_set_xml', 'sepa_batch_archive', 'sepa_batch_cancel', 'sepa_item_unpaid', 'sepa_collectable_installments']) {
      expect(all).toContain(`function public.${fn}(`);
    }
  });

  test('la base : can_manage_accounting = mêmes rôles', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.can_manage_accounting'), sql.indexOf('$$;'));
    expect(fn).toContain("ur.role::text in ('admin', 'comptable')");
    // sans utilisateur : cle de service ou tache interne seulement, jamais anon
    expect(fn).toContain("= 'service_role'");
  });

  test("refus de la base reconnu par l'écran", () => {
    expect(isAccountingForbidden({ code: '42501', message: 'x' })).toBe(true);
    expect(isAccountingForbidden({ message: 'accounting_forbidden: reserve' })).toBe(true);
    expect(isAccountingForbidden({ code: '23514', message: 'autre' })).toBe(false);
  });
});

describe('fonctions comptables protégées en base', () => {
  test('clôture, écritures, SEPA, date de bascule et journaux sont enveloppés', () => {
    for (const fn of [
      'close_fiscal_year', 'pending_deposits', 'pending_effects',
      'generate_accounting_entries', 'generate_sales_entries', 'generate_payment_entries', 'generate_margin_period_entries', 'generate_auxiliary_accounts',
      'set_accounting_cutover',
      'sepa_collectable', 'record_sepa_collection', 'record_sepa_unpaid',
      'sepa_collectable_installments', 'sepa_batch_create', 'sepa_batch_set_xml', 'sepa_batch_archive', 'sepa_batch_cancel', 'sepa_item_unpaid',
      'sales_journal', 'vat_register',
    ]) expect(GUARDED).toContain(fn);
  });

  test('la fiche client garde la liste des débiteurs (lue hors comptabilité)', () => {
    expect(GUARDED).not.toContain('debtors_list');
    const clientPage = readFileSync(join(ROOT, 'src', 'routes', '_app.clients.$contactId.tsx'), 'utf8');
    expect(clientPage).toContain('getDebtorsList');
  });

  test('les tables comptables suivent la même règle (RLS)', () => {
    for (const table of ['accounting_entries', 'accounting_entry_lines', 'chart_of_accounts', 'account_mappings', 'sepa_mandates', 'sepa_batches', 'sepa_batch_items', 'accounting_exports', 'fiscal_closures']) {
      expect(sql).toContain(`on public.${table}`);
    }
    // l'export UBL d'une facture (vente) reste inscriptible par un membre
    expect(sql).toContain("kind = 'ubl' and public.is_member(company_id)");
  });

  test('les écrans de comptabilité passent par la garde', () => {
    for (const f of ['_app.accounting.tsx', '_app.accounting-closure.tsx', '_app.accounting-sepa.tsx']) {
      const src = readFileSync(join(ROOT, 'src', 'routes', f), 'utf8');
      expect(src).toContain('<AccountingGate>');
    }
  });

  test('une migration postérieure qui redéfinit une fonction protégée remet la protection', () => {
    const later = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql') && f > GUARD_FILE).sort();
    const offenders: string[] = [];
    for (const f of later) {
      const body = readFileSync(join(MIG_DIR, f), 'utf8');
      for (const fn of GUARDED) {
        const redefines = new RegExp(`create (or replace )?function public\\.${fn}\\(`).test(body);
        if (redefines && !new RegExp(`_install_accounting_guard\\('public\\.${fn}\\(`).test(body)) offenders.push(`${f} : ${fn}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
