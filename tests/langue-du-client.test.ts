/**
 * Tests I18N004 — le client reçoit ses documents et messages dans SA langue (décision M-71) :
 *   - le PDF d'un document de vente rendu en NL porte les libellés NL (reste à payer, validité,
 *     bon pour accord, mention TVA marge), la désignation traduite des lignes, le nom de fichier ;
 *   - langue du contact → langue de l'e-mail (objet / corps du mail de document, pied de mail
 *     des fonctions Edge, mails de compte) ; FR par défaut ; les quatre langues des textes
 *     serveur ont les mêmes clés et les mêmes variables ;
 *   - cohérence contact / compte : une seule source (`contacts.locale`), le profil suit
 *     (déclencheurs et fonction portal_set_locale de la migration 20261030160000).
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tIn, fillVars, t, setLocale, getLocale } from '../src/lib/i18n';
import { contactLocale, designationFor } from '../src/lib/i18n/client-locale';
import {
  buildSalesDocumentPdfUncompressed, salesPdfFileName, validityMention, type SalesPdfInput,
} from '../src/modules/sales/document-pdf';
import { footerHtml, buildGraphMessage } from '../supabase/functions/_shared/mail-message.ts';
import {
  MAIL_LOCALES, MAIL_TEXTS, mailTexts, pickMailLocale, fillMail, asMailLocale,
} from '../supabase/functions/_shared/mail-i18n.ts';

const pdfInput = (locale: SalesPdfInput['locale']): SalesPdfInput => ({
  docType: 'DEV', number: 'DEV-2026-0042', issueDate: '2026-10-30', createdAt: '2026-10-30T09:00:00Z',
  dueDate: null, condition: null, operator: 'Domenico', clientCode: 'C42',
  company: { name: 'ITALBIKE STORE', vatNumber: 'BE0000000000', cgv: 'Artikel 1' },
  clientLines: ['JANSSENS PIET', 'Teststraat 1', '1000 Brussel'],
  vehicleLines: [],
  lines: [
    { lineType: 'article', reference: '96481331AA', designation: 'Verwarmde handvatten', quantity: 1, unitPriceHt: 100, vatRate: 21, discountPct: 0, lineTtc: 121 },
    { lineType: 'main_oeuvre', reference: 'MO', designation: 'Werkplaats', quantity: 1.5, unitPriceHt: 80, vatRate: 21, discountPct: 0, lineTtc: 145.2 },
  ],
  payments: [{ date: '2026-10-30', label: 'VOORSCHOT overschrijving', amount: 100, received: true }],
  taxExempt: false, isMarge: true, pied: {},
  totals: { ht: 220, vat: 46.2, ttc: 266.2, paid: 100 },
  validity: validityMention('DEV', '2026-10-30', [], locale),
  locale,
});

describe('langue du client — tIn et fiche contact', () => {
  test('tIn traduit dans la langue demandée sans changer la langue de l\'écran', () => {
    setLocale('fr');
    expect(tIn('nl', 'salesPdf.due')).toBe('NOG TE BETALEN');
    expect(tIn('en', 'salesPdf.due')).toBe('BALANCE DUE');
    expect(tIn('it', 'salesPdf.due')).toBe('RESTA DA PAGARE');
    expect(tIn('fr', 'salesPdf.due')).toBe('RESTE À PAYER');
    expect(getLocale()).toBe('fr');
    expect(t('salesPdf.due')).toBe('RESTE À PAYER');
    // Langue inconnue ou absente : FR.
    expect(tIn('de', 'salesPdf.due')).toBe('RESTE À PAYER');
    expect(tIn(null, 'salesPdf.due')).toBe('RESTE À PAYER');
  });

  test('la langue vient de la fiche du client, FR par défaut', () => {
    expect(contactLocale({ locale: 'nl' })).toBe('nl');
    expect(contactLocale({ locale: 'xx' })).toBe('fr');
    expect(contactLocale({})).toBe('fr');
    expect(contactLocale(null)).toBe('fr');
  });

  test('désignation des lignes : designation_i18n[langue] si elle existe, sinon la ligne', () => {
    const i18n = { fr: 'Poignées chauffantes', nl: 'Verwarmde handvatten', en: 'Heated grips', it: '' };
    expect(designationFor('nl', 'Poignées chauffantes', i18n)).toBe('Verwarmde handvatten');
    expect(designationFor('en', 'Poignées chauffantes', i18n)).toBe('Heated grips');
    expect(designationFor('it', 'Poignées chauffantes', i18n)).toBe('Poignées chauffantes'); // IT vide → ligne
    expect(designationFor('fr', 'Poignées chauffantes (modifiée)', i18n)).toBe('Poignées chauffantes (modifiée)'); // FR = ligne
    expect(designationFor('nl', 'Poignées chauffantes', null)).toBe('Poignées chauffantes');
  });

  test('fillVars remplace les variables, même répétées', () => {
    expect(fillVars('{type} {number} — {company}', { type: 'Offerte', number: 'DEV-1', company: 'X' })).toBe('Offerte DEV-1 — X');
    expect(fillVars('{a}{a}', { a: 'b' })).toBe('bb');
  });
});

describe('langue du client — PDF du document de vente', () => {
  test('devis rendu en NL : libellés, validité, bon pour accord, mention TVA marge, pied de page', async () => {
    const raw = new TextDecoder('latin1').decode(await buildSalesDocumentPdfUncompressed(pdfInput('nl')));
    for (const s of [
      'OFFERTE / PRO FORMA',        // titre du document (sales.type_DEV en NL, en capitales)
      'NOG TE BETALEN', 'NETTO INCL. BTW', 'REEDS BETAALD', // totaux
      'OMSCHRIJVING', 'AANTAL',     // colonnes
      'Offerte 1 maand geldig',     // validité par défaut traduite
      'Voor akkoord',               // case signature
      'Algemene verkoopvoorwaarden', // CGV au verso
      'Verwarmde handvatten', '1,50 u', // désignation de la ligne et heures de main-d'œuvre
      'Pagina 1 / 2',
    ]) expect(raw).toContain(s);
    // La mention TVA marge (texte légal) est bien la version NL, et pas la FR.
    expect(raw).toContain('art. 58 §4 W.Btw');
    expect(raw).not.toContain('RESTE À PAYER');
    expect(raw).not.toContain('Bon pour accord');
  });

  test('sans langue : FR, comme avant', async () => {
    const raw = new TextDecoder('latin1').decode(await buildSalesDocumentPdfUncompressed({ ...pdfInput(undefined), locale: undefined }));
    expect(raw).toContain('RESTE À PAYER');
    expect(raw).toContain('Bon pour accord');
    expect(raw).toContain('Devis valable 1 mois');
  });

  test('nom de fichier et validité dans la langue du client', () => {
    expect(salesPdfFileName('DEV', 'DEV-2026-0042', 'nl')).toBe('Offerte-pro-forma_DEV-2026-0042.pdf');
    expect(salesPdfFileName('FAC', 'FAC-2026-0001', 'en')).toBe('Invoice_FAC-2026-0001.pdf');
    expect(salesPdfFileName('DEV', 'DEV-2026-0042')).toBe('Devis-proforma_DEV-2026-0042.pdf');
    expect(validityMention('DEV', '2026-10-30', [], 'nl')).toBe('Offerte 1 maand geldig (tot 30/11/2026)');
    // Une règle saisie en Paramètres (texte libre de la société) garde la main.
    expect(validityMention('DEV', '2026-10-30', [{ docType: 'DEV', text: 'Offre valable 15 jours', months: 0, active: true }], 'nl'))
      .toBe('Offre valable 15 jours');
  });
});

describe('langue du contact → langue de l\'e-mail', () => {
  test('objet et corps du mail de document proposés dans la langue de la fiche', () => {
    const contact = { locale: 'nl' };
    const loc = contactLocale(contact);
    const vars = { type: tIn(loc, 'sales.type_DEV'), number: 'DEV-2026-0042', company: 'ITALBIKE STORE', client: 'Piet' };
    expect(fillVars(tIn(loc, 'salesMail.subjectDefault'), vars)).toBe('Offerte / pro forma DEV-2026-0042 — ITALBIKE STORE');
    expect(fillVars(tIn(loc, 'salesMail.bodyDefault'), vars)).toContain('In bijlage vindt u uw Offerte / pro forma nr. DEV-2026-0042');
    expect(tIn(contactLocale({ locale: 'it' }), 'sales.smsBodyDefault')).toContain('il suo ordine');
    expect(tIn(contactLocale({}), 'sales.smsBodyDefault')).toContain('votre commande');
  });

  test('pied de mail des fonctions Edge dans la langue du client (FR par défaut)', () => {
    const nl = footerHtml('join', 'https://app.example.be', 'piet@example.be', null, 'nl');
    expect(nl).toContain('Mijn Ducati Bruxelles-ruimte');
    expect(nl).toContain('inscription?email=piet%40example.be');
    expect(nl).not.toContain('Mon espace Ducati Bruxelles');
    const en = footerHtml('login', 'https://app.example.be', 'john@example.be', null, 'en');
    expect(en).toContain('Your account is waiting for you:');
    expect(en).toContain('/login');
    // Appelant d'avant (sans langue) : FR inchangé.
    expect(footerHtml('join', 'https://app.example.be', 'x@example.be')).toContain('Mon espace Ducati Bruxelles');
    const msg = buildGraphMessage({ subject: 'Offerte', bodyHtml: 'Beste,', footer: nl, to: 'piet@example.be', attachments: [] });
    expect(msg.message.body.content).toContain('Mijn Ducati Bruxelles-ruimte');
  });

  test('mails de compte : la fiche du client prime sur le profil, puis FR', () => {
    expect(pickMailLocale({ contactLocale: 'it', profileLocale: 'nl' })).toBe('it');
    expect(pickMailLocale({ contactLocale: null, profileLocale: 'nl' })).toBe('nl');
    expect(pickMailLocale({ contactLocale: 'xx', profileLocale: undefined })).toBe('fr');
    expect(pickMailLocale({})).toBe('fr');
    expect(asMailLocale('en')).toBe('en');
    expect(asMailLocale(42)).toBeNull();
    expect(mailTexts('nl').account.welcomeSubject).toBe('Welkom bij Ducati Bruxelles');
    expect(mailTexts('de').account.welcomeSubject).toBe('Bienvenue chez Ducati Bruxelles');
    expect(fillMail(mailTexts('en').account.identifier, { email: 'john@example.be' })).toBe('Your login is: john@example.be');
  });

  test('les quatre langues des textes serveur ont les mêmes clés, aucune vide, mêmes variables', () => {
    const flat = (o: Record<string, unknown>, prefix = ''): Map<string, string> => {
      const out = new Map<string, string>();
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object') for (const [kk, vv] of flat(v as Record<string, unknown>, `${prefix}${k}.`)) out.set(kk, vv);
        else out.set(`${prefix}${k}`, String(v));
      }
      return out;
    };
    const vars = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
    const ref = flat(MAIL_TEXTS.fr as unknown as Record<string, unknown>);
    expect(ref.size).toBeGreaterThan(30);
    for (const l of MAIL_LOCALES) {
      const d = flat(MAIL_TEXTS[l] as unknown as Record<string, unknown>);
      expect([...ref.keys()].filter((k) => !d.has(k))).toEqual([]);
      expect([...d].filter(([, v]) => v.trim() === '').map(([k]) => k)).toEqual([]);
      expect([...ref].filter(([k, v]) => vars(v) !== vars(d.get(k)!)).map(([k]) => k)).toEqual([]);
    }
    const src = readFileSync(join(import.meta.dir, '..', 'supabase', 'functions', '_shared', 'mail-i18n.ts'), 'utf8');
    const curly = String.fromCharCode(0x2018, 0x2019, 0x201c, 0x201d);
    expect(src.match(new RegExp('[' + curly + ']', 'g')) ?? []).toEqual([]);
  });
});

describe('cohérence contact / compte client (migration 20261030160000)', () => {
  const sql = readFileSync(join(import.meta.dir, '..', 'supabase', 'migrations', '20261030160000_m1_langue_du_client.sql'), 'utf8');

  test('une seule source : contacts.locale (fr par défaut, fr/nl/en/it)', () => {
    expect(sql).toMatch(/alter table public\.contacts\s+add column if not exists locale text not null default 'fr'/);
    expect(sql).toMatch(/contacts_locale_check check \(locale in \('fr', 'nl', 'en', 'it'\)\)/);
  });

  test('le profil du compte lié suit la fiche (déclencheur fiche → profil, et à la liaison du compte)', () => {
    expect(sql).toMatch(/create trigger trg_contacts_locale_to_profile\s+after insert or update of locale on public\.contacts/);
    expect(sql).toMatch(/update public\.profiles p\s+set locale = new\.locale\s+from public\.contact_accounts ca\s+where ca\.contact_id = new\.id\s+and p\.id = ca\.user_id/);
    expect(sql).toMatch(/create trigger trg_contact_accounts_locale\s+after insert or update of contact_id on public\.contact_accounts/);
  });

  test('l\'espace client écrit la fiche (portal_set_locale), jamais le profil directement', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.portal_set_locale'));
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/_portal_ctx\(\)/);
    expect(fn).toMatch(/update public\.contacts c\s+set locale = p_locale\s+where c\.id = _ctx\.contact_id/);
    expect(fn).not.toMatch(/update public\.profiles/);
    expect(fn).toMatch(/p_locale not in \('fr', 'nl', 'en', 'it'\)/);
  });
});
