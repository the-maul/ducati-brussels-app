/**
 * PDV020 (03/11/2026) -- Ecran client sur tablette appairee (mission 12, carte P2).
 * Regles pures de src/modules/sales/customer-screen.ts + controles statiques de la migration
 * 20261103240000_m6_ecran_client.sql (droits de la tablette sans compte, jeton jamais stocke,
 * Realtime). L essai a blanc en base est supabase/tests/m6_ecran_client.sql.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  THANKS_EMAIL_SECONDS, THANKS_SECONDS, amountToPay, canChooseLocale, deviceOnline, documentForScreen,
  initialSaleFlow, isPairingCode, isScreenEmail, keepDeviceToken, nextSaleFlow, normalizePairingCode,
  pairingCodeFromSearch, pairingUrl, parseDeviceRead, parseSnapshot, resolveScreen, screenLinkState,
  screenLocale, screenModeForFlow, ticketForScreen, type SaleEvent, type SaleFlow, type ScreenSnapshot,
} from '../src/modules/sales/customer-screen';

const NOW = Date.parse('2026-11-03T10:00:00Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const snap = (p: Partial<ScreenSnapshot>): ScreenSnapshot => ({
  mode: 'accueil', payload: {}, version: 1, mode_changed_at: iso(0), reply_kind: null, company_name: 'ITALBIKE STORE',
  bank: { beneficiary: 'ITALBIKE STORE', iban: 'BE68539007547034', bic: null }, payment: null, ...p,
});

describe('parcours de la vente : accueil -> ticket -> paiement -> signature -> merci -> accueil', () => {
  const run = (events: SaleEvent[], from: SaleFlow = initialSaleFlow) => events.reduce(nextSaleFlow, from);

  test('vente complete sans signature', () => {
    const steps: string[] = [];
    let s = initialSaleFlow;
    for (const e of [{ type: 'cart', lines: 1 }, { type: 'checkout' }, { type: 'paid' }, { type: 'timeout' }] as SaleEvent[]) {
      s = nextSaleFlow(s, e); steps.push(s.step);
    }
    expect(steps).toEqual(['ticket', 'paiement', 'merci', 'accueil']);
  });

  test('avec signature : le merci attend la signature', () => {
    const s = run([{ type: 'cart', lines: 2 }, { type: 'checkout', needsSignature: true }, { type: 'paid' }]);
    expect(s.step).toBe('signature');
    expect(screenModeForFlow(s)).toBe('signature');
    expect(nextSaleFlow(s, { type: 'signed' }).step).toBe('merci');
    expect(nextSaleFlow(s, { type: 'timeout' }).step).toBe('signature');
  });

  test('carte -> terminal ; QR -> qr ; sans moyen -> montant a payer', () => {
    const pay = run([{ type: 'cart', lines: 1 }, { type: 'checkout' }]);
    expect(screenModeForFlow(pay)).toBe('ticket');
    expect(screenModeForFlow(nextSaleFlow(pay, { type: 'method', method: 'card' }))).toBe('terminal');
    expect(screenModeForFlow(nextSaleFlow(pay, { type: 'method', method: 'qr' }))).toBe('qr');
  });

  test('panier vide = retour a l accueil ; nouvelle vente = accueil de partout ; pas de saut d etape', () => {
    expect(run([{ type: 'cart', lines: 1 }, { type: 'cart', lines: 0 }]).step).toBe('accueil');
    expect(run([{ type: 'cart', lines: 1 }, { type: 'checkout' }, { type: 'newSale' }])).toEqual(initialSaleFlow);
    expect(run([{ type: 'paid' }]).step).toBe('accueil');
    expect(run([{ type: 'cart', lines: 1 }, { type: 'paid' }]).step).toBe('ticket');
    expect(run([{ type: 'checkout' }]).step).toBe('accueil');
  });
});

describe('ticket montre au client', () => {
  test('TTC par ligne, remise, TVA par taux, lignes texte sans montant', () => {
    const t = ticketForScreen([
      { designation: 'Huile 10W40', quantity: 2, unit_price_ht: 10, vat_rate: 21 },
      { designation: 'Casque', quantity: 1, unit_price_ht: 100, vat_rate: 21, discount_pct: 10 },
      { designation: 'Livre', quantity: 1, unit_price_ht: 20, vat_rate: 6 },
      { designation: 'Offert par la maison', quantity: 0, unit_price_ht: 0, vat_rate: 0, line_type: 'texte' },
      { designation: '', quantity: 0, unit_price_ht: 0, vat_rate: 0, line_type: 'vide' },
    ]);
    expect(t.lines?.map((l) => [l.designation, l.total_ttc])).toEqual([
      ['Huile 10W40', 24.2], ['Casque', 108.9], ['Livre', 21.2], ['Offert par la maison', 0],
    ]);
    expect(t.lines?.[3].text).toBe(true);
    expect(t.totals).toEqual({ ht: 130, vat: 24.3, ttc: 154.3, discount: 12.1 });
    expect(t.vat).toEqual([{ rate: 6, base: 20, vat: 1.2 }, { rate: 21, base: 110, vat: 23.1 }]);
  });

  test('regime de la marge / detaxe : aucune TVA', () => {
    const t = ticketForScreen([{ designation: 'Monster', quantity: 1, unit_price_ht: 9000, vat_rate: 21 }], { noVat: true });
    expect(t.totals?.ttc).toBe(9000);
    expect(t.totals?.vat).toBe(0);
  });

  test('document : totaux du document (remise globale), detail de TVA retire s il ne retombe pas juste', () => {
    const lines = [{ designation: 'Pneu', quantity: 2, unit_price_ht: 100, vat_rate: 21 }];
    const exact = documentForScreen({ number: 'FAC-1', total_ht: 200, total_vat: 42, total_ttc: 242 }, lines, { due: 100 });
    expect(exact.vat).toHaveLength(1);
    expect(exact.due).toBe(100);
    const remise = documentForScreen({ number: 'FAC-2', total_ht: 180, total_vat: 37.8, total_ttc: 217.8 }, lines);
    expect(remise.totals).toEqual({ ht: 180, vat: 37.8, ttc: 217.8, discount: 24.2 });
    expect(remise.vat).toEqual([]);
  });

  test('montant a payer : reste du, sinon montant, sinon TTC', () => {
    expect(amountToPay({ due: 40, amount: 100, totals: { ht: 0, vat: 0, ttc: 120, discount: 0 } })).toBe(40);
    expect(amountToPay({ amount: 100 })).toBe(100);
    expect(amountToPay({ totals: { ht: 0, vat: 0, ttc: 120, discount: 0 } })).toBe(120);
  });

  test('aucune donnee du client au-dela du ticket : la charge utile n a pas de champ adresse / telephone / e-mail', () => {
    const p = documentForScreen({ total_ht: 1, total_vat: 0, total_ttc: 1 }, [{ designation: 'x', quantity: 1, unit_price_ht: 1, vat_rate: 0 }], { customerName: 'Jean', locale: 'nl' });
    expect(Object.keys(p).sort()).toEqual(['customer_name', 'doc_type', 'document_number', 'lines', 'locale', 'totals', 'vat']);
  });
});

describe('ce que la tablette affiche', () => {
  test('rien lu -> accueil ; ticket vide -> accueil ; ticket -> ticket', () => {
    expect(resolveScreen(null, NOW).mode).toBe('accueil');
    expect(resolveScreen(snap({ mode: 'ticket', payload: { lines: [] } }), NOW).mode).toBe('accueil');
    const r = resolveScreen(snap({ mode: 'ticket', payload: { lines: [{ designation: 'x', quantity: 1, unit_ttc: 1, discount_pct: 0, total_ttc: 1 }], stage: 'a_payer' } }), NOW);
    expect(r).toEqual({ mode: 'ticket', stage: 'a_payer' });
  });

  test('QR de virement existant : attendu -> qr (meme si le mode est ticket), recu -> merci puis accueil', () => {
    const payment = { id: 'p', status: 'attendu', method: 'VIRQR', amount: 50, reference: '+++000/0000/09797+++', received_at: null, document_number: 'FAC-9', customer_name: 'Jean' };
    expect(resolveScreen(snap({ mode: 'accueil', payment }), NOW).mode).toBe('qr');
    const recu = { ...payment, status: 'recu', received_at: iso(-2000) };
    const m = resolveScreen(snap({ mode: 'accueil', payment: recu }), NOW);
    expect(m.mode).toBe('merci');
    expect(m.mode === 'merci' && m.amount).toBe(50);
    expect(resolveScreen(snap({ mode: 'accueil', payment: { ...recu, received_at: iso(-(THANKS_SECONDS + 1) * 1000) } }), NOW).mode).toBe('accueil');
  });

  test('merci : 10 s, 90 s si le client peut taper son e-mail ; mesure sur l horloge du serveur', () => {
    const merci = (age: number, allow = false) => resolveScreen(snap({ mode: 'merci', mode_changed_at: iso(-age), payload: { amount: 10, allow_email: allow } }), NOW).mode;
    expect(merci(5000)).toBe('merci');
    expect(merci(THANKS_SECONDS * 1000 + 1)).toBe('accueil');
    expect(merci(60_000, true)).toBe('merci');
    expect(merci(THANKS_EMAIL_SECONDS * 1000 + 1, true)).toBe('accueil');
  });

  test('merci : adresse deja envoyee -> plus de champ de saisie', () => {
    const r = resolveScreen(snap({ mode: 'merci', reply_kind: 'email', payload: { allow_email: true } }), NOW);
    expect(r.mode === 'merci' && r.emailSent).toBe(true);
  });

  test('terminal : montant du ; signature : texte requis, signee apres reponse', () => {
    expect(resolveScreen(snap({ mode: 'terminal', payload: { due: 99.5 } }), NOW)).toEqual({ mode: 'terminal', amount: 99.5 });
    expect(resolveScreen(snap({ mode: 'signature', payload: {} }), NOW).mode).toBe('accueil');
    const sig = { title: 'BL', text: 'Recu', document_id: 'd' };
    const r = resolveScreen(snap({ mode: 'signature', payload: { signature: sig }, reply_kind: 'signature' }), NOW);
    expect(r).toEqual({ mode: 'signature', signature: sig, signed: true });
  });

  test('QR Stripe prevu dans le modele : affiche tant qu il n a pas expire', () => {
    const qr = { kind: 'stripe' as const, url: 'https://checkout.stripe.com/c/pay/cs_test', expires_at: iso(60_000) };
    expect(resolveScreen(snap({ mode: 'qr', payload: { qr, amount: 20 } }), NOW).mode).toBe('qr');
    expect(resolveScreen(snap({ mode: 'qr', payload: { qr: { ...qr, expires_at: iso(-1) }, amount: 20 } }), NOW)).toEqual({ mode: 'ticket', stage: 'a_payer' });
    expect(resolveScreen(snap({ mode: 'qr', payload: {} }), NOW).mode).toBe('accueil');
  });

  test('lecture defensive du JSON de la base', () => {
    const s = parseSnapshot({ mode: 'pirate', payload: null, version: '3' });
    expect(s?.mode).toBe('accueil');
    expect(s?.payload).toEqual({});
    expect(s?.version).toBe(3);
    expect(parseSnapshot(null)).toBeNull();
  });
});

describe('appairage et jeton', () => {
  test('code : 6 caracteres sans 0 / O / 1 / I / L, saisie tolerante', () => {
    expect(normalizePairingCode(' ab3-k7q ')).toBe('AB3K7Q');
    expect(isPairingCode('AB3K7Q')).toBe(true);
    expect(isPairingCode('AB3K7')).toBe(false);
    expect(isPairingCode('AB0K7Q')).toBe(false);
    expect(isPairingCode('ABIK7Q')).toBe(false);
  });

  test('QR de la tablette : ouvre la caisse avec le code ; code relu dans l adresse', () => {
    expect(pairingUrl('https://dms.example.be/', 'AB3K7Q')).toBe('https://dms.example.be/pos?ecran=AB3K7Q');
    expect(pairingCodeFromSearch('ab3k7q')).toBe('AB3K7Q');
    expect(pairingCodeFromSearch('nope')).toBeNull();
    expect(pairingCodeFromSearch(42)).toBeNull();
  });

  test('etats renvoyes a la tablette : on garde le jeton seulement en attente ou appaire', () => {
    expect(keepDeviceToken(parseDeviceRead({ status: 'pending', code: 'AB3K7Q', expires_at: iso(1), now: iso(0) }))).toBe(true);
    const paired = parseDeviceRead({ status: 'paired', now: iso(0), device: { name: 'T', register_code: 'CAISSE-1', channel: 'ecran-client-x' }, screen: { mode: 'ticket' } });
    expect(paired.status).toBe('paired');
    expect(keepDeviceToken(paired)).toBe(true);
    for (const status of ['revoked', 'expired', 'unknown', 'n importe quoi']) expect(keepDeviceToken(parseDeviceRead({ status }))).toBe(false);
    expect(keepDeviceToken(parseDeviceRead(null))).toBe(false);
  });

  test('connecte = signe de vie de moins de 30 s (horloge du serveur)', () => {
    expect(deviceOnline(iso(-10_000), iso(0))).toBe(true);
    expect(deviceOnline(iso(-31_000), iso(0))).toBe(false);
    expect(deviceOnline(null, iso(0))).toBe(false);
    expect(screenLinkState([], iso(0), true)).toBe('none');
    expect(screenLinkState([{ last_seen_at: iso(-60_000) }, { last_seen_at: iso(-1000) }], iso(0), true)).toBe('online');
    expect(screenLinkState([{ last_seen_at: iso(-60_000) }], iso(0), true)).toBe('offline');
    expect(screenLinkState(null, null, false)).toBe('unavailable');
  });

  test('adresse e-mail tapee sur la tablette', () => {
    expect(isScreenEmail(' Client@Example.be ')).toBe(true);
    expect(isScreenEmail('pas-une-adresse')).toBe(false);
    expect(isScreenEmail(`${'a'.repeat(250)}@b.be`)).toBe(false);
  });
});

describe('langue de l ecran (I18N004)', () => {
  test('langue du client si connue, sinon choix de la tablette, sinon FR', () => {
    expect(screenLocale('nl', 'it')).toBe('nl');
    expect(screenLocale(null, 'it')).toBe('it');
    expect(screenLocale('xx', null)).toBe('fr');
    expect(canChooseLocale('en')).toBe(false);
    expect(canChooseLocale(null)).toBe(true);
  });
});

describe('migration 20261103240000 : securite du jeton et droits de la tablette', () => {
  const sql = readFileSync(join(import.meta.dir, '..', 'supabase', 'migrations', '20261103240000_m6_ecran_client.sql'), 'utf8');

  test('seules trois fonctions sont ouvertes a anon : demander un code, lire par jeton, repondre', () => {
    const anon = [...sql.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to anon/g)].map((m) => m[1]).sort();
    expect(anon).toEqual(['customer_display_pair_begin', 'customer_display_read', 'customer_display_reply']);
  });

  test('le jeton n est jamais stocke : empreinte SHA-256 seulement, colonnes secretes non lisibles', () => {
    expect(sql).toMatch(/token_hash\s+text not null unique/);
    expect(sql).not.toMatch(/\btoken\s+text\b/);
    expect(sql).toMatch(/grant select \(id, company_id, user_id, name, register_code, created_at, paired_at, last_seen_at, revoked_at\)/);
    expect(sql).toMatch(/revoke all on public\.customer_display_devices from anon, authenticated/);
  });

  test('la table des appareils n est pas publiee en Realtime ; le signal ne porte aucune donnee', () => {
    expect(sql).not.toMatch(/supabase_realtime add table public\.customer_display_devices/);
    expect(sql).toMatch(/realtime\.send\(jsonb_build_object\('v', new\.version\)/);
  });

  test('le ticket pousse est filtre : pas d adresse, de telephone ni d e-mail dans les cles admises', () => {
    const allowed = sql.match(/allowed constant text\[\] := array\[([\s\S]*?)\];/)?.[1] ?? '';
    expect(allowed).toContain("'lines'");
    for (const k of ['address', 'phone', 'email', 'iban', 'contact_id']) expect(allowed).not.toContain(`'${k}'`);
  });

  test('la reponse du client ne revient pas a la tablette (seulement son type)', () => {
    const json = sql.match(/function public\._counter_display_json[\s\S]*?\$\$;/)?.[0] ?? '';
    expect(json).toContain("'reply_kind', cd.reply ->> 'kind'");
    expect(json).not.toMatch(/'reply',/);
  });

  test('RLS active, aucune ecriture directe, l ecran QR existant n est pas modifie', () => {
    expect(sql).toMatch(/alter table public\.customer_display_devices enable row level security/);
    expect(sql).not.toMatch(/create policy \w+ on public\.customer_display_devices for (insert|update|delete)/);
    for (const fn of ['qr_payment_start', 'qr_payment_confirm', 'qr_payment_cancel', 'counter_display_show', 'counter_display_current']) {
      expect(sql).not.toMatch(new RegExp(`create or replace function public\\.${fn}\\(`));
    }
  });
});
