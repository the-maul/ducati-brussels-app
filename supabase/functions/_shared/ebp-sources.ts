// M12 — Transfert comptable « EBP » façon G8 : paramètres, règles de comptes (G8 « Gestion des
// comptes »), résolution des comptes et lecture des documents à transférer.
//
// Partagé par l'écran (src/modules/accounting/ebp-api.ts) et la tâche planifiée
// (supabase/functions/accounting-auto-transfer). Seul import : la mise en forme pure.
// Les fonctions `resolve*` et `build*` sont pures (testées, tests/export-ebp-g8.test.ts) ;
// `loadEbpSources` lit la base avec le client Supabase fourni (navigateur ou service).
//
// Plan de comptes : celui de G8 par défaut (411000000 / 2000xx, 707000, 710000, 445000, 530000,
// 511300, 511400, 718000, journaux VE / RC / CA). « À trancher avec le comptable » : tout est
// modifiable dans Comptabilité → Paramétrage des comptes, rien n'est figé dans le code.

import {
  autoThirdAccount, onTheFlyAccount, vatIncluded,
  type EbpCashMovement, type EbpGenericDoc, type EbpMovementStyle, type EbpPayment, type EbpSaleDoc, type EbpSource, type EbpThird, type EbpSourceKind,
} from './ebp-format.ts';

// ------------------------------------------------------------------------------------------
// Paramètres du transfert (G8 « Paramètres transfert comptable », 7 onglets)
// ------------------------------------------------------------------------------------------

export type EbpFrequency = 'off' | 'daily' | 'weekly' | 'fortnightly' | 'monthly';

export type EbpSettings = {
  /** Export EBP = voie officielle vers le comptable (décision du 18/11 : actif tant que Falco n'est pas branché). */
  enabled: boolean;
  format: 'ebp';
  /** Répertoire cible (information : le navigateur télécharge les fichiers). */
  targetDir: string;
  entriesFile: string;
  accountsFile: string;
  byDepartment: boolean;
  selection: 'period' | 'number';
  writeMode: 'invoice' | 'semi_global';
  includeSales: boolean;
  includePayments: boolean;
  includePurchases: boolean;
  includeCessions: boolean;
  includeConsignments: boolean;
  paymentsFirst: boolean;
  dedupeThirds: boolean;
  auto: { frequency: EbpFrequency; sendEmail: boolean; email: string };
  sales: {
    defaultCustomerAccount: string; thirdType: string; collectiveAccount: string; defaultCustomerLabel: string;
    salesAccount: string; retroAccount: string; retroCategories: string; journal: string; creditJournal: string;
    vatAccount: string; deeeAccount: string;
    customerAutoBase: number; customerAutoWidth: number; onTheFlyPrefix: string; onTheFlyPad: number;
  };
  payments: {
    journal: string; cashJournal: string; paymentAccount: string; cashMovementAccount: string;
    depositAccount: string; exceptionalAccount: string; includeBankDeposits: boolean;
  };
  purchases: {
    supplierDefault: string; thirdType: string; purchaseAccount: string; journal: string; vatAccount: string;
    intracom: boolean; intracomVatDue: string; fnp: boolean; fnpAccount: string; fnpJournal: string;
    pieceNumber: 'receipt' | 'supplier_invoice'; supplierAutoBase: number; supplierAutoWidth: number;
  };
  cessions: { journal: string; account: string; counterAccount: string };
  consignments: { journal: string; commissionAccount: string; distinguishVat: boolean; vatCommissionAccount: string; vatRate: number; depositAccount: string };
  vatMargin: { distinguish: boolean; vatOccasionAccount: string; marginAccount: string; vatOnTradeInAccount: string };
};

/** Défauts = paramétrage relevé dans G8 le 18/11/2026. À trancher avec le comptable. */
export const DEFAULT_EBP_SETTINGS: EbpSettings = {
  enabled: true,
  format: 'ebp',
  targetDir: '',
  entriesFile: 'ECRITURES.TXT',
  accountsFile: 'COMPTES.TXT',
  byDepartment: false,
  selection: 'period',
  writeMode: 'invoice',
  includeSales: true,
  includePayments: true,
  includePurchases: false,
  includeCessions: false,
  includeConsignments: false,
  paymentsFirst: false,
  dedupeThirds: false,
  auto: { frequency: 'off', sendEmail: false, email: '' },
  sales: {
    defaultCustomerAccount: '411000000', thirdType: 'C', collectiveAccount: '411000000', defaultCustomerLabel: 'CLIENT DIVERS',
    salesAccount: '707000', retroAccount: '710000', retroCategories: '', journal: 'VE', creditJournal: 'VE',
    vatAccount: '445000', deeeAccount: '',
    customerAutoBase: 200000, customerAutoWidth: 6, onTheFlyPrefix: '411', onTheFlyPad: 5,
  },
  payments: {
    journal: 'RC', cashJournal: 'CA', paymentAccount: '511200', cashMovementAccount: '530000',
    depositAccount: '', exceptionalAccount: '718000', includeBankDeposits: true,
  },
  purchases: {
    supplierDefault: '', thirdType: 'F', purchaseAccount: '', journal: '', vatAccount: '',
    intracom: false, intracomVatDue: '', fnp: false, fnpAccount: '', fnpJournal: '',
    pieceNumber: 'receipt', supplierAutoBase: 40100000, supplierAutoWidth: 8,
  },
  cessions: { journal: '', account: '', counterAccount: '' },
  consignments: { journal: '', commissionAccount: '', distinguishVat: false, vatCommissionAccount: '', vatRate: 21, depositAccount: '' },
  vatMargin: { distinguish: false, vatOccasionAccount: '', marginAccount: '', vatOnTradeInAccount: '' },
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Fusionne les paramètres enregistrés (jsonb) sur les défauts G8, en gardant les types. */
export function parseEbpSettings(raw: unknown): EbpSettings {
  const merge = (def: unknown, val: unknown): unknown => {
    if (isObj(def)) {
      const out: Obj = {};
      for (const k of Object.keys(def)) out[k] = merge(def[k], isObj(val) ? val[k] : undefined);
      return out;
    }
    if (val === undefined || val === null) return def;
    if (typeof def === 'boolean') return typeof val === 'boolean' ? val : def;
    if (typeof def === 'number') { const n = Number(val); return Number.isFinite(n) ? n : def; }
    if (typeof def === 'string') return typeof val === 'string' ? val.trim() : def;
    return def;
  };
  const s = merge(DEFAULT_EBP_SETTINGS, raw) as EbpSettings;
  if (!['period', 'number'].includes(s.selection)) s.selection = 'period';
  if (!['invoice', 'semi_global'].includes(s.writeMode)) s.writeMode = 'invoice';
  if (!['off', 'daily', 'weekly', 'fortnightly', 'monthly'].includes(s.auto.frequency)) s.auto.frequency = 'off';
  if (!['receipt', 'supplier_invoice'].includes(s.purchases.pieceNumber)) s.purchases.pieceNumber = 'receipt';
  return s;
}

// ------------------------------------------------------------------------------------------
// Règles de comptes (G8 « Gestion des comptes » : ventes, achats, cessions, TVA, règlements,
// mouvements de fond de caisse) — table accounting_account_rules
// ------------------------------------------------------------------------------------------

export type EbpRuleKind = 'sales' | 'purchase' | 'cession' | 'vat' | 'payment' | 'cash_movement';

export type EbpRule = {
  id?: string;
  kind: EbpRuleKind;
  /** Ventes / achats : référence d'article ; TVA : taux en texte ; règlements : code du mode ; mouvements : code du type. */
  key: string | null;
  /** Ventes / achats : famille (catégorie d'article). */
  family: string | null;
  vat_rate: number | null;
  tax_exempt: boolean | null;
  demo: boolean | null;
  customer_category: string | null;
  /** Compte général. */
  account: string;
  /** Ventes : compte rétrocession · TVA : compte occasion · achats : compte export · mouvements : compte TVA. */
  account2: string | null;
  /** TVA : compte TVA achat · achats : compte achat rétro. */
  account3: string | null;
  country: string | null;
  journal: string | null;
  label: string | null;
  /** Règlements : code écrit dans le libellé (ESP, CAR, VIR) ; mouvements : style (bank, deposit, generic). */
  mode_label: string | null;
  is_active: boolean;
  sort_order?: number;
};

/** Règlements G8 relevés (Gestion des comptes › Comptes règlements). VID / VIC : vides dans G8 (« 5 Visa »). */
export const G8_PAYMENT_RULES: Pick<EbpRule, 'key' | 'account' | 'journal' | 'mode_label' | 'label'>[] = [
  { key: 'ESP', account: '530000', journal: 'CA', mode_label: 'ESP', label: 'Espèces' },
  { key: 'MAE', account: '511300', journal: 'RC', mode_label: 'CAR', label: 'Carte débit' },
  { key: 'VIR', account: '511400', journal: 'RC', mode_label: 'VIR', label: 'Virement' },
  { key: 'VID', account: '', journal: 'RC', mode_label: 'CAR', label: 'Visa / Mastercard débit' },
  { key: 'VIC', account: '', journal: 'RC', mode_label: 'CAR', label: 'Visa / Mastercard crédit' },
];

/** Mouvements de fond de caisse G8 (01 à 07), comptes vides dans G8. */
export const G8_MOVEMENT_RULES: Pick<EbpRule, 'key' | 'label' | 'mode_label' | 'vat_rate'>[] = [
  { key: '01', label: 'REMISE EN BANQUE', mode_label: 'bank', vat_rate: 0 },
  { key: '02', label: 'ENCAISSEMENT DEPOT VTE', mode_label: 'deposit', vat_rate: 0 },
  { key: '03', label: 'DECAISSEMENT DEPOT VTE', mode_label: 'deposit', vat_rate: 0 },
  { key: '04', label: 'ACHAT DE CONSOM.', mode_label: 'generic', vat_rate: 21 },
  { key: '05', label: 'LA POSTE', mode_label: 'generic', vat_rate: 0 },
  { key: '06', label: 'DIVERS ENTREE ESPECES', mode_label: 'generic', vat_rate: 0 },
  { key: '07', label: 'DIVERS SORTIE ESPECES', mode_label: 'generic', vat_rate: 0 },
];

const eq = (a: unknown, b: unknown) => String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();
const sameRate = (a: number | null, b: number) => a === null || Math.abs(Number(a) - b) < 0.001;

export type SalesLineContext = {
  reference: string | null;
  family: string | null;
  vatRate: number;
  taxExempt: boolean;
  demo: boolean;
  customerCategory: string | null;
  articleSalesAccount: string | null;
  retro: boolean;
};

/**
 * Compte de vente d'une ligne (G8 : par référence ou famille × TVA × détaxe × démo × catégorie client).
 * Ordre : règle par référence > compte de la fiche article > règle par famille > règle générale > défaut.
 * Rétrocession : compte rétrocession de la règle, sinon 710000.
 */
export function resolveSalesAccount(rules: EbpRule[], ctx: SalesLineContext, settings: EbpSettings): string {
  const candidates = rules
    .filter((r) => r.kind === 'sales' && r.is_active)
    .filter((r) => !r.key || eq(r.key, ctx.reference))
    .filter((r) => !r.family || eq(r.family, ctx.family))
    .filter((r) => sameRate(r.vat_rate, ctx.vatRate))
    .filter((r) => r.tax_exempt === null || r.tax_exempt === ctx.taxExempt)
    .filter((r) => r.demo === null || r.demo === ctx.demo)
    .filter((r) => !r.customer_category || eq(r.customer_category, ctx.customerCategory))
    .map((r) => ({
      r,
      score: (r.key ? 1000 : 0) + (r.family ? 100 : 0) + (r.vat_rate !== null ? 4 : 0) + (r.tax_exempt !== null ? 4 : 0)
        + (r.demo !== null ? 4 : 0) + (r.customer_category ? 4 : 0),
    }))
    .sort((a, b) => b.score - a.score || (a.r.sort_order ?? 0) - (b.r.sort_order ?? 0));
  const byRef = candidates.find((c) => c.r.key);
  const pick = (r: EbpRule) => (ctx.retro ? (r.account2 || settings.sales.retroAccount) : r.account);
  if (byRef) return pick(byRef.r);
  if (ctx.articleSalesAccount && !ctx.retro) return ctx.articleSalesAccount;
  if (candidates.length) return pick(candidates[0].r);
  return ctx.retro ? settings.sales.retroAccount : settings.sales.salesAccount;
}

/** Compte de TVA collectée d'un taux (G8 « Comptes TVA ») ; TVA occasion si la distinction est cochée. */
export function resolveVatAccount(rules: EbpRule[], rate: number, occasion: boolean, settings: EbpSettings, country?: string | null): string {
  const list = rules.filter((r) => r.kind === 'vat' && r.is_active && (r.vat_rate !== null ? sameRate(r.vat_rate, rate) : eq(r.key, String(rate))));
  const rule = list.find((r) => r.country && eq(r.country, country)) ?? list.find((r) => !r.country);
  if (occasion && settings.vatMargin.distinguish) {
    return rule?.account2 || settings.vatMargin.vatOccasionAccount || rule?.account || settings.sales.vatAccount;
  }
  return rule?.account || settings.sales.vatAccount;
}

/** Compte de TVA déductible (achats). */
export function resolvePurchaseVatAccount(rules: EbpRule[], rate: number, settings: EbpSettings): string {
  const rule = rules.find((r) => r.kind === 'vat' && r.is_active && (r.vat_rate !== null ? sameRate(r.vat_rate, rate) : eq(r.key, String(rate))));
  return rule?.account3 || settings.purchases.vatAccount;
}

/** Mode de règlement → compte, journal, code du libellé (G8 « Comptes règlements »). */
export function resolvePayment(rules: EbpRule[], method: string, settings: EbpSettings): { account: string; journal: string; modeLabel: string } {
  const rule = rules.find((r) => r.kind === 'payment' && r.is_active && eq(r.key, method));
  const g8 = G8_PAYMENT_RULES.find((r) => eq(r.key, method));
  const src = rule ?? g8;
  return {
    account: src ? (src.account ?? '') : settings.payments.paymentAccount,
    journal: src?.journal || (method === 'ESP' ? settings.payments.cashJournal : settings.payments.journal),
    modeLabel: src?.mode_label || method.slice(0, 3).toUpperCase(),
  };
}

/** Type de mouvement de fond de caisse → libellé, comptes, TVA, style de libellé. */
export function resolveMovement(rules: EbpRule[], code: string, settings: EbpSettings): { label: string; account: string; vatAccount: string; vatRate: number; style: EbpMovementStyle } {
  const rule = rules.find((r) => r.kind === 'cash_movement' && r.is_active && eq(r.key, code));
  const g8 = G8_MOVEMENT_RULES.find((r) => eq(r.key, code));
  const style = ((rule?.mode_label || g8?.mode_label || 'generic') as EbpMovementStyle);
  return {
    label: rule?.label || g8?.label || code,
    account: rule?.account || settings.payments.cashMovementAccount,
    vatAccount: rule?.account2 || '',
    vatRate: Number(rule?.vat_rate ?? g8?.vat_rate ?? 0),
    style: ['bank', 'deposit', 'generic'].includes(style) ? style : 'generic',
  };
}

// ------------------------------------------------------------------------------------------
// Tiers (G8 « Comptes clients / fournisseurs »)
// ------------------------------------------------------------------------------------------

export type ContactRow = {
  id: string; code: string | null; company_name: string | null; first_name: string | null; last_name: string | null;
  address: string | null; street_number?: string | null; address_complement?: string | null; zip: string | null; city: string | null; country: string | null;
  phone: string | null; mobile?: string | null; gsm?: string | null; category?: string | null; accounting_account?: string | null;
};
export type ThirdAccountRow = { contact_id: string; kind: 'C' | 'F'; account: string; label: string | null };

/** Intitulé G8 : société, sinon « NOM PRÉNOM ». */
export function contactName(c: ContactRow | null | undefined): string {
  if (!c) return '';
  return (c.company_name || [c.last_name, c.first_name].filter(Boolean).join(' ')).trim();
}

/**
 * Compte d'un client (G8) : table des comptes clients, sinon compte de la fiche, sinon « 411 + code » créé
 * à la volée ; client de passage (aucun contact) : 411000000 « CLIENT DIVERS ».
 */
export function resolveCustomerThird(contact: ContactRow | null, accounts: Map<string, ThirdAccountRow>, settings: EbpSettings): EbpThird {
  if (!contact) return { account: settings.sales.defaultCustomerAccount, name: settings.sales.defaultCustomerLabel, country: 'BE' };
  const acc = accounts.get(`C:${contact.id}`)?.account
    || (contact.accounting_account ?? '').trim()
    || onTheFlyAccount(contact.code, settings.sales.onTheFlyPrefix, settings.sales.onTheFlyPad)
    || settings.sales.defaultCustomerAccount;
  return thirdOf(contact, acc, accounts.get(`C:${contact.id}`)?.label);
}

/** Compte d'un fournisseur (G8 : 40100000 + code), sinon compte fournisseur par défaut. */
export function resolveSupplierThird(contact: ContactRow | null, accounts: Map<string, ThirdAccountRow>, settings: EbpSettings): EbpThird {
  if (!contact) return { account: settings.purchases.supplierDefault, name: 'FOURNISSEUR DIVERS', country: 'BE' };
  const acc = accounts.get(`F:${contact.id}`)?.account
    || autoThirdAccount(contact.code, settings.purchases.supplierAutoBase, settings.purchases.supplierAutoWidth)
    || settings.purchases.supplierDefault;
  return thirdOf(contact, acc, accounts.get(`F:${contact.id}`)?.label);
}

function thirdOf(c: ContactRow, account: string, label?: string | null): EbpThird {
  return {
    account, name: label || contactName(c), name2: c.address_complement ?? null,
    address: [c.street_number, c.address].filter(Boolean).join(' ') || null,
    zip: c.zip, city: c.city, country: c.country || 'BE', phone: c.phone || c.mobile || c.gsm || null,
  };
}

/** Création automatique G8 des comptes clients : code 20 → 200020 (proposition, l'écran l'enregistre). */
export function proposeCustomerAccount(code: string | null, settings: EbpSettings): string | null {
  return autoThirdAccount(code, settings.sales.customerAutoBase, settings.sales.customerAutoWidth);
}

// ------------------------------------------------------------------------------------------
// Documents de vente → pièce VE (pure)
// ------------------------------------------------------------------------------------------

export type DocRow = {
  id: string; doc_type: string; status: string; number: string | null; issue_date: string; due_date: string | null;
  contact_id: string | null; total_ht: number | string; total_vat: number | string; total_ttc: number | string;
  tax_exempt: boolean | null; shipping_ht?: number | string | null; shipping_vat_rate?: number | string | null;
  vat_scheme?: string | null; created_at?: string;
  /** Colonne G8 « Compta » : un document repris de G8 déjà transféré par G8 ne repart pas. */
  compta_transferred?: boolean | null;
};
export type LineRow = {
  document_id: string; article_id: string | null; line_type: string | null; vat_rate: number | string;
  line_ht: number | string; line_ttc: number | string; reference: string | null; vat_scheme?: string | null;
};
export type ArticleRow = { id: string; reference: string | null; category_id: string | null; mgmt_type: string | null; vehicle_id: string | null; sales_account: string | null };

const num = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const MARGIN = ['margin', 'marge', 'margin_scheme', 'vo_margin'];
const isMargin = (v: unknown) => MARGIN.includes(String(v ?? '').toLowerCase());

/** N° externe : le n° du document sans séparateurs (FAC-2026-00012 → FAC202600012). */
export const externalNumber = (n: string | null | undefined) => String(n ?? '').replace(/[^A-Za-z0-9]/g, '');

export type SaleBuildContext = {
  doc: DocRow;
  lines: LineRow[];
  articles: Map<string, ArticleRow>;
  demoVehicles: Set<string>;
  contact: ContactRow | null;
  accounts: Map<string, ThirdAccountRow>;
  rules: EbpRule[];
  settings: EbpSettings;
  /** Acomptes déjà facturés (FAA) déduits de cette facture finale. */
  prepaid?: { ht: number; vat: number; ttc: number } | null;
};

/** Ajoute `delta` au plus gros poste (arrondis, remise globale) pour que la pièce colle aux totaux du document. */
function adjustTo(groups: Map<string, number>, target: number, fallbackKey: string): void {
  const sum = r2([...groups.values()].reduce((s, v) => s + v, 0));
  const delta = r2(target - sum);
  if (delta === 0) return;
  let key = fallbackKey;
  let best = -1;
  for (const [k, v] of groups) if (Math.abs(v) > best) { best = Math.abs(v); key = k; }
  groups.set(key, r2((groups.get(key) ?? 0) + delta));
}

export function buildSaleDoc(ctx: SaleBuildContext): EbpSaleDoc {
  const { doc, settings, rules } = ctx;
  const isCredit = doc.doc_type === 'AVO';
  const third = resolveCustomerThird(ctx.contact, ctx.accounts, settings);
  const retroCats = settings.sales.retroCategories.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const retro = !!ctx.contact?.category && retroCats.some((c) => eq(c, ctx.contact?.category));
  const docMargin = isMargin(doc.vat_scheme);
  const sales = new Map<string, number>();
  const vat = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, r2((m.get(k) ?? 0) + v));
  const depositAccount = settings.payments.depositAccount || settings.sales.salesAccount;

  for (const l of ctx.lines) {
    if (l.line_type && ['texte', 'vide'].includes(String(l.line_type))) continue;
    const art = l.article_id ? ctx.articles.get(l.article_id) ?? null : null;
    const rate = num(l.vat_rate);
    const margin = docMargin || isMargin(l.vat_scheme);
    const occasion = art?.mgmt_type === 'O' || art?.mgmt_type === 'P';
    if (doc.doc_type === 'FAA') {
      add(sales, depositAccount, num(l.line_ht));
      if (num(l.line_ttc) - num(l.line_ht)) add(vat, resolveVatAccount(rules, rate, false, settings), num(l.line_ttc) - num(l.line_ht));
      continue;
    }
    if (margin) {
      // Régime de la marge : la facture ne porte pas de TVA, tout le TTC va en vente (compte marge occasion si paramétré).
      add(sales, settings.vatMargin.marginAccount || resolveSalesAccount(rules, {
        reference: art?.reference ?? l.reference, family: art?.category_id ?? null, vatRate: 0, taxExempt: !!doc.tax_exempt,
        demo: false, customerCategory: ctx.contact?.category ?? null, articleSalesAccount: art?.sales_account ?? null, retro,
      }, settings), num(l.line_ttc));
      continue;
    }
    const account = resolveSalesAccount(rules, {
      reference: art?.reference ?? l.reference, family: art?.category_id ?? null, vatRate: rate, taxExempt: !!doc.tax_exempt,
      demo: !!(art?.vehicle_id && ctx.demoVehicles.has(art.vehicle_id)), customerCategory: ctx.contact?.category ?? null,
      articleSalesAccount: art?.sales_account ?? null, retro,
    }, settings);
    add(sales, account, num(l.line_ht));
    const v = r2(num(l.line_ttc) - num(l.line_ht));
    if (v) add(vat, resolveVatAccount(rules, rate, occasion, settings), v);
  }
  const shipping = num(doc.shipping_ht);
  if (shipping) {
    const rate = num(doc.shipping_vat_rate);
    add(sales, settings.sales.salesAccount, shipping);
    if (rate && !doc.tax_exempt) add(vat, resolveVatAccount(rules, rate, false, settings), r2(shipping * rate / 100));
  }
  // La pièce colle toujours aux totaux du document (remise globale, arrondis) : équilibre garanti.
  const ttc = num(doc.total_ttc);
  const totalVat = num(doc.total_vat);
  adjustTo(vat, totalVat, settings.sales.vatAccount);
  adjustTo(sales, r2(ttc - [...vat.values()].reduce((s, v) => s + v, 0)), settings.sales.salesAccount);

  const extraDebits: { account: string; amount: number }[] = [];
  let clientTtc = ttc;
  const p = ctx.prepaid;
  if (p && (p.ttc || p.ht)) {
    // Facture finale : l'acompte déjà facturé (FAA) est soldé — débit du compte acompte et de sa TVA.
    clientTtc = r2(ttc - p.ttc);
    extraDebits.push({ account: depositAccount, amount: r2(p.ht) });
    if (p.vat) extraDebits.push({ account: settings.sales.vatAccount, amount: r2(p.vat) });
  }
  const number = doc.number ?? doc.id.slice(0, 8);
  return {
    kind: 'sale', id: doc.id,
    journal: isCredit ? settings.sales.creditJournal : settings.sales.journal,
    labelRef: isCredit ? `AVOIR ${number}` : number,
    external: externalNumber(number),
    date: doc.issue_date,
    dueDate: doc.due_date || doc.issue_date,
    third,
    ttc: clientTtc,
    sales: [...sales].filter(([, v]) => v !== 0).map(([account, amount]) => ({ account, amount })),
    vat: [...vat].filter(([, v]) => v !== 0).map(([account, amount]) => ({ account, amount })),
    extraDebits,
  };
}

// ------------------------------------------------------------------------------------------
// Règlements et mouvements de caisse → pièces RC / CA (pure)
// ------------------------------------------------------------------------------------------

export type PaymentRow = {
  id: string; document_id: string; method: string; amount: number | string; paid_date: string;
  doc_number: string | null; doc_type: string | null; contact_id: string | null; created_at?: string | null;
};

/** Modes qui ne sont pas de la trésorerie (lettrage par avoir) : jamais transférés. */
export const NON_TREASURY_METHODS = ['AVO'];

export function buildPayment(p: PaymentRow, contact: ContactRow | null, accounts: Map<string, ThirdAccountRow>, rules: EbpRule[], settings: EbpSettings): EbpPayment {
  const mode = resolvePayment(rules, p.method, settings);
  const number = p.doc_number ?? p.document_id.slice(0, 8);
  return {
    kind: 'payment', id: p.id, journal: mode.journal, date: p.paid_date, modeLabel: mode.modeLabel,
    treasuryAccount: mode.account, third: resolveCustomerThird(contact, accounts, settings),
    labelRef: number, external: externalNumber(number), amount: num(p.amount),
  };
}

export type MovementRow = {
  id: string; kind: string; method: string | null; amount: number | string; reason: string | null; occurred_at: string;
  type_code?: string | null; movement_no?: number | null; vat_rate?: number | string | null; vat_amount?: number | string | null;
  account_code?: string | null;
};

export function buildMovement(m: MovementRow, rules: EbpRule[], settings: EbpSettings): EbpCashMovement {
  const code = m.type_code || (m.kind === 'in' ? '06' : '07');
  const t = resolveMovement(rules, code, settings);
  const mode = resolvePayment(rules, m.method || 'ESP', settings);
  const amount = Math.abs(num(m.amount));
  const rate = m.vat_rate != null && m.vat_rate !== '' ? num(m.vat_rate) : t.vatRate;
  const vat = m.vat_amount != null && m.vat_amount !== '' ? Math.abs(num(m.vat_amount)) : (m.kind === 'out' ? vatIncluded(amount, rate) : 0);
  return {
    kind: 'cash_movement', id: m.id, journal: settings.payments.journal, date: m.occurred_at.slice(0, 10),
    direction: m.kind === 'in' ? 'in' : 'out', style: t.style,
    text: t.style === 'generic' ? `${t.label}${m.reason ?? ''}` : t.label,
    modeLabel: mode.modeLabel, modeAccount: mode.account,
    counterAccount: t.account === settings.payments.cashMovementAccount && m.account_code ? m.account_code : t.account,
    vatAccount: t.vatAccount, amount, vat, external: m.movement_no != null ? String(m.movement_no) : '',
  };
}

// ------------------------------------------------------------------------------------------
// Achats, cessions internes, commissions de dépôt-vente (options, désactivées par défaut comme dans G8)
// ------------------------------------------------------------------------------------------

export type PurchaseRow = {
  id: string; number: string | null; supplier_id: string | null; supplier_invoice_no: string | null; receipt_date: string | null;
  invoice_date: string | null; created_at: string; total_ht: number | string; total_vat: number | string; total_ttc: number | string; vat_regime: string | null;
};

export function buildPurchase(p: PurchaseRow, supplier: ContactRow | null, accounts: Map<string, ThirdAccountRow>, rules: EbpRule[], settings: EbpSettings): EbpGenericDoc {
  const s = settings.purchases;
  const third = resolveSupplierThird(supplier, accounts, settings);
  const date = (p.invoice_date || p.receipt_date || p.created_at).slice(0, 10);
  const fnp = s.fnp && !p.supplier_invoice_no;
  const ht = num(p.total_ht), tva = num(p.total_vat), ttc = num(p.total_ttc);
  const ref = s.pieceNumber === 'supplier_invoice' && p.supplier_invoice_no ? p.supplier_invoice_no : (p.number ?? p.id.slice(0, 8));
  // Compte d'achat : règle générale « Comptes achats » (sans référence ni famille : l'en-tête de réception
  // ne détaille pas les familles), sinon le compte achat des paramètres.
  const general = rules.find((r) => r.kind === 'purchase' && r.is_active && !r.key && !r.family && (r.vat_rate === null || sameRate(r.vat_rate, 21)));
  const lines: EbpGenericDoc['lines'] = [
    { account: general?.account || s.purchaseAccount, amount: ht },
    { account: resolvePurchaseVatAccount(rules, 21, settings), amount: tva },
    { account: fnp ? s.fnpAccount : third.account, amount: -ttc },
  ];
  if (s.intracom && p.vat_regime === 'intracom') {
    const due = r2(ht * 0.21);
    lines.push({ account: resolvePurchaseVatAccount(rules, 21, settings), amount: due }, { account: s.intracomVatDue, amount: -due });
  }
  return {
    kind: 'purchase', id: p.id, journal: fnp ? (s.fnpJournal || s.journal) : s.journal, date, dueDate: date,
    labelRef: ref, external: externalNumber(ref), third, lines,
  };
}

export type CessionRow = { id: string; number: string | null; cession_type?: string | null; type_label: string | null; account: string | null; journal: string | null; total_cost: number | string; validated_at: string | null; created_at: string };

/** Cession interne : compte du type (fiche cession, sinon « Comptes cessions »), contrepartie (rétrocession / stock). */
export function buildCession(c: CessionRow, rules: EbpRule[], settings: EbpSettings): EbpGenericDoc {
  const date = (c.validated_at || c.created_at).slice(0, 10);
  const ref = c.number ?? c.id.slice(0, 8);
  const cost = num(c.total_cost);
  const rule = rules.find((r) => r.kind === 'cession' && r.is_active && eq(r.key, c.cession_type));
  return {
    kind: 'cession', id: c.id, journal: c.journal || rule?.journal || settings.cessions.journal, date, dueDate: date,
    labelRef: `${ref} ${c.type_label ?? ''}`.trim(), external: externalNumber(ref), third: null,
    lines: [
      { account: c.account || rule?.account || settings.cessions.account, amount: cost },
      { account: rule?.account2 || settings.cessions.counterAccount, amount: -cost },
    ],
  };
}

export type ConsignmentRow = { id: string; number: string | null; depositor_id: string | null; sold_at: string | null; sold_commission: number | string | null };

export function buildConsignment(c: ConsignmentRow, depositor: ContactRow | null, accounts: Map<string, ThirdAccountRow>, settings: EbpSettings): EbpGenericDoc {
  const s = settings.consignments;
  const date = (c.sold_at ?? new Date().toISOString()).slice(0, 10);
  const ttc = num(c.sold_commission);
  const vat = s.distinguishVat ? vatIncluded(ttc, s.vatRate) : 0;
  const ref = c.number ?? c.id.slice(0, 8);
  const lines: EbpGenericDoc['lines'] = [
    { account: s.depositAccount, amount: ttc },
    { account: s.commissionAccount, amount: -r2(ttc - vat) },
  ];
  if (vat) lines.push({ account: s.vatCommissionAccount, amount: -vat });
  return {
    kind: 'consignment', id: c.id, journal: s.journal, date, dueDate: date, labelRef: ref, external: externalNumber(ref),
    third: resolveCustomerThird(depositor, accounts, settings), lines,
  };
}

// ------------------------------------------------------------------------------------------
// Lecture en base (navigateur ou service)
// ------------------------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EbpDbClient = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

export type EbpSelection = {
  from: string;
  to: string;
  selection: 'period' | 'number';
  numberFrom?: string | null;
  numberTo?: string | null;
  includeSales: boolean;
  includePayments: boolean;
  includePurchases: boolean;
  includeCessions: boolean;
  includeConsignments: boolean;
};

export type EbpLoadResult = {
  sources: EbpSource[];
  cutover: string | null;
  /** Documents de vente antérieurs à la période, jamais transférés (G8 les oublierait : on les signale). */
  earlierPending: number;
  warnings: string[];
};

async function all<T>(q: () => { range: (a: number, b: number) => Promise<{ data: T[] | null; error: unknown }> }): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await q().range(start, start + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function byIds<T>(db: EbpDbClient, table: string, cols: string, ids: string[], col = 'id'): Promise<T[]> {
  const out: T[] = [];
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await db.from(table).select(cols).in(col, uniq.slice(i, i + 200));
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

export async function loadEbpRules(db: EbpDbClient, companyId: string): Promise<EbpRule[]> {
  const { data, error } = await db.from('accounting_account_rules').select('*').eq('company_id', companyId).order('sort_order');
  if (error) throw error;
  return ((data ?? []) as EbpRule[]).map((r) => ({ ...r, vat_rate: r.vat_rate === null || r.vat_rate === undefined ? null : Number(r.vat_rate) }));
}

export async function loadEbpSettings(db: EbpDbClient, companyId: string): Promise<EbpSettings> {
  const { data, error } = await db.from('accounting_transfer_settings').select('params').eq('company_id', companyId).maybeSingle();
  if (error) throw error;
  return parseEbpSettings((data as { params?: unknown } | null)?.params ?? {});
}

async function loadThirdAccounts(db: EbpDbClient, companyId: string): Promise<Map<string, ThirdAccountRow>> {
  const rows = await all<ThirdAccountRow>(() => db.from('accounting_third_accounts').select('contact_id, kind, account, label').eq('company_id', companyId));
  return new Map(rows.map((r) => [`${r.kind}:${r.contact_id}`, r]));
}

async function transferredSet(db: EbpDbClient, companyId: string): Promise<Set<string>> {
  const rows = await all<{ source_kind: EbpSourceKind; source_id: string }>(
    () => db.from('accounting_transfer_items').select('source_kind, source_id').eq('company_id', companyId).eq('cancelled', false),
  );
  return new Set(rows.map((r) => `${r.source_kind}:${r.source_id}`));
}

const CONTACT_COLS = 'id, code, company_name, first_name, last_name, address, street_number, address_complement, zip, city, country, phone, mobile, gsm, category, accounting_account';

/**
 * Lit les documents à transférer (non encore transférés, depuis la date de bascule) et les met en pièces.
 * Ventes : documents validés FAC / TIK / AVO / FAA de la période (ou de la plage de numéros).
 * Règlements et mouvements de caisse : tout ce qui n'a pas été transféré jusqu'à la fin de la période (G8 reprend
 * les règlements plus anciens jamais transférés). Achats, cessions, dépôts-vente : si cochés.
 */
export async function loadEbpSources(db: EbpDbClient, companyId: string, sel: EbpSelection, settings: EbpSettings, rules: EbpRule[]): Promise<EbpLoadResult> {
  const warnings: string[] = [];
  const { data: co } = await db.from('companies').select('accounting_start_date').eq('id', companyId).maybeSingle();
  const cutover: string | null = (co as { accounting_start_date?: string } | null)?.accounting_start_date ?? null;
  const floor = cutover ?? '1900-01-01';
  const done = await transferredSet(db, companyId);
  const accounts = await loadThirdAccounts(db, companyId);
  const sales: EbpSaleDoc[] = [];
  const treasury: { at: string; src: EbpSource }[] = [];
  const others: EbpGenericDoc[] = [];
  let earlierPending = 0;

  // ---- Ventes
  let saleDocIds: string[] = [];
  if (sel.includeSales) {
    const base = () => {
      let q = db.from('documents').select('*').eq('company_id', companyId).in('doc_type', ['FAC', 'TIK', 'AVO', 'FAA'])
        .not('status', 'in', '(brouillon,annulee)').gte('issue_date', floor);
      if (sel.selection === 'number') {
        if (sel.numberFrom) q = q.gte('number', sel.numberFrom);
        if (sel.numberTo) q = q.lte('number', sel.numberTo);
      } else {
        q = q.gte('issue_date', sel.from).lte('issue_date', sel.to);
      }
      return q.order('issue_date').order('number');
    };
    const docs = (await all<DocRow>(base)).filter((d) => !done.has(`document:${d.id}`) && !d.compta_transferred);
    saleDocIds = docs.map((d) => d.id);
    if (sel.selection === 'period') {
      const earlier = await all<{ id: string; compta_transferred?: boolean | null }>(() => db.from('documents').select('id, compta_transferred').eq('company_id', companyId)
        .in('doc_type', ['FAC', 'TIK', 'AVO', 'FAA']).not('status', 'in', '(brouillon,annulee)').gte('issue_date', floor).lt('issue_date', sel.from));
      earlierPending = earlier.filter((d) => !done.has(`document:${d.id}`) && !d.compta_transferred).length;
    }
    const lines = await byIds<LineRow>(db, 'document_lines', '*', saleDocIds, 'document_id');
    const articles = new Map((await byIds<ArticleRow>(db, 'articles', 'id, reference, category_id, mgmt_type, vehicle_id, sales_account', lines.map((l) => l.article_id ?? ''))).map((a) => [a.id, a]));
    const vehIds = [...articles.values()].map((a) => a.vehicle_id ?? '');
    const demo = new Set((await byIds<{ id: string; status: string }>(db, 'vehicles', 'id, status', vehIds)).filter((v) => v.status === 'demo').map((v) => v.id));
    const contacts = new Map((await byIds<ContactRow>(db, 'contacts', CONTACT_COLS, docs.map((d) => d.contact_id ?? ''))).map((c) => [c.id, c]));
    // Acomptes déjà facturés (FAA) reportés sur la facture finale (colonne `deposit_invoice_id`, lot facture légale).
    const prepaid = new Map<string, { ht: number; vat: number; ttc: number }>();
    try {
      const pays = await byIds<{ document_id: string; deposit_invoice_id?: string | null }>(db, 'document_payments', 'document_id, deposit_invoice_id', saleDocIds, 'document_id');
      const faaIds = pays.map((p) => p.deposit_invoice_id ?? '').filter(Boolean);
      const faas = new Map((await byIds<DocRow>(db, 'documents', 'id, total_ht, total_vat, total_ttc', faaIds)).map((d) => [d.id, d]));
      for (const p of pays) {
        const f = p.deposit_invoice_id ? faas.get(p.deposit_invoice_id) : null;
        if (!f) continue;
        const cur = prepaid.get(p.document_id) ?? { ht: 0, vat: 0, ttc: 0 };
        prepaid.set(p.document_id, { ht: r2(cur.ht + num(f.total_ht)), vat: r2(cur.vat + num(f.total_vat)), ttc: r2(cur.ttc + num(f.total_ttc)) });
      }
    } catch {
      warnings.push('prepaid_unavailable');
    }
    const byDoc = new Map<string, LineRow[]>();
    for (const l of lines) byDoc.set(l.document_id, [...(byDoc.get(l.document_id) ?? []), l]);
    for (const d of docs) {
      sales.push(buildSaleDoc({
        doc: d, lines: byDoc.get(d.id) ?? [], articles, demoVehicles: demo, contact: d.contact_id ? contacts.get(d.contact_id) ?? null : null,
        accounts, rules, settings, prepaid: d.doc_type === 'FAC' ? prepaid.get(d.id) ?? null : null,
      }));
    }
  }

  // ---- Règlements (fonction SQL : jointure document, garde de rôle)
  if (sel.includePayments) {
    const { data, error } = await db.rpc('ebp_payments_to_transfer', {
      _company: companyId, _to: sel.to, _doc_ids: sel.selection === 'number' ? saleDocIds : null,
    });
    if (error) throw error;
    const pays = ((data ?? []) as PaymentRow[]).filter((p) => !done.has(`payment:${p.id}`) && !NON_TREASURY_METHODS.includes(p.method));
    const contacts = new Map((await byIds<ContactRow>(db, 'contacts', CONTACT_COLS, pays.map((p) => p.contact_id ?? ''))).map((c) => [c.id, c]));
    for (const p of pays) {
      treasury.push({ at: p.created_at || p.paid_date, src: buildPayment(p, p.contact_id ? contacts.get(p.contact_id) ?? null : null, accounts, rules, settings) });
    }
    // Mouvements de fond de caisse (types 01 à 07 si le lot caisse est posé ; sinon entrée / sortie diverses).
    if (sel.selection === 'period') {
      const moves = await all<MovementRow>(() => db.from('cash_movements').select('*').eq('company_id', companyId)
        .gte('occurred_at', `${floor}T00:00:00`).lte('occurred_at', `${sel.to}T23:59:59.999`).order('occurred_at'));
      for (const m of moves) {
        if (done.has(`cash_movement:${m.id}`)) continue;
        if (!settings.payments.includeBankDeposits && m.type_code === '01') continue;
        treasury.push({ at: m.occurred_at, src: buildMovement(m, rules, settings) });
      }
    }
  }

  // ---- Achats (G8 : désactivé par défaut)
  if (sel.includePurchases) {
    const rows = await all<PurchaseRow & { status: string }>(() => db.from('purchase_orders').select('*').eq('company_id', companyId)
      .eq('doc_type', 'REC').in('status', ['validee', 'recue']).gte('created_at', `${floor}T00:00:00`).lte('created_at', `${sel.to}T23:59:59.999`).order('created_at'));
    const todo = rows.filter((p) => !done.has(`purchase:${p.id}`) && (p.invoice_date || p.receipt_date || p.created_at).slice(0, 10) >= (sel.selection === 'period' ? sel.from : floor));
    const sups = new Map((await byIds<ContactRow>(db, 'contacts', CONTACT_COLS, todo.map((p) => p.supplier_id ?? ''))).map((c) => [c.id, c]));
    for (const p of todo) others.push(buildPurchase(p, p.supplier_id ? sups.get(p.supplier_id) ?? null : null, accounts, rules, settings));
  }

  // ---- Cessions internes (table du lot cessions ; absente = rien)
  if (sel.includeCessions) {
    try {
      const rows = await all<CessionRow & { status: string; accounted: boolean }>(() => db.from('internal_cessions').select('*').eq('company_id', companyId)
        .in('status', ['valide', 'archive']).eq('accounted', true).gte('created_at', `${floor}T00:00:00`).order('created_at'));
      for (const c of rows) {
        const d = (c.validated_at || c.created_at).slice(0, 10);
        if (done.has(`cession:${c.id}`) || d > sel.to || (sel.selection === 'period' && d < sel.from)) continue;
        others.push(buildCession(c, rules, settings));
      }
    } catch {
      warnings.push('cessions_unavailable');
    }
  }

  // ---- Commissions de dépôt-vente
  if (sel.includeConsignments) {
    const rows = await all<ConsignmentRow & { status: string }>(() => db.from('consignments').select('*').eq('company_id', companyId)
      .eq('status', 'vendu').order('sold_at'));
    const todo = rows.filter((c) => {
      const d = (c.sold_at ?? '').slice(0, 10);
      return !done.has(`consignment:${c.id}`) && d && d >= floor && d <= sel.to && (sel.selection !== 'period' || d >= sel.from);
    });
    const deps = new Map((await byIds<ContactRow>(db, 'contacts', CONTACT_COLS, todo.map((c) => c.depositor_id ?? ''))).map((c) => [c.id, c]));
    for (const c of todo) others.push(buildConsignment(c, c.depositor_id ? deps.get(c.depositor_id) ?? null : null, accounts, settings));
  }

  treasury.sort((a, b) => a.at.localeCompare(b.at));
  return { sources: [...sales, ...treasury.map((t) => t.src), ...others], cutover, earlierPending, warnings };
}

/** Prochaine date de transfert automatique (G8 : tous les soirs / semaines / 15 jours / mois). */
export function autoTransferDue(frequency: EbpFrequency, lastAuto: string | null, today: string): boolean {
  if (frequency === 'off') return false;
  if (!lastAuto) return true;
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastAuto.slice(0, 10)}T00:00:00Z`)) / 86400000;
  const need = { daily: 1, weekly: 7, fortnightly: 15, monthly: 28 }[frequency];
  if (frequency === 'monthly') return today.slice(0, 7) !== lastAuto.slice(0, 7);
  return days >= need;
}
