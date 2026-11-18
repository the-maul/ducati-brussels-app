// M12 — Export comptable au format « EBP » identique à G8 (ECRITURES.TXT + COMPTES.TXT).
//
// Logique PURE (aucun import) : partagée par l'écran Comptabilité → Transfert comptable
// (src/modules/accounting/ebp-api.ts) et par la tâche planifiée « transfert automatique »
// (supabase/functions/accounting-auto-transfer). Testée caractère par caractère contre le
// fichier réel relevé dans G8 le 18/11/2026 (docs/g8-inventaire/export-comptable-g8.md,
// tests/export-ebp-g8.test.ts).
//
// Structure d'une ligne d'ECRITURES.TXT (relevé G8) :
//   N° pièce (5 chiffres) , "JJMMAAAA" , Journal (4) , Compte (12) , (vide) , "Libellé" ,
//   "N° externe" , "Montant (10, aligné à droite)" , D|C , "Échéance" ,
// - pièce : séquentielle dans le transfert, une par document ;
// - journaux de ventes (VE) : montant SIGNÉ (débit positif, crédit négatif) et sens D/C tiré du signe ;
//   journaux de trésorerie (RC, CA) : montant positif et sens explicite ;
// - échéance JJMMAAAA pour les ventes, AAAAMMJJ pour les règlements et mouvements de caisse ;
// - libellé complété par des espaces jusqu'à 35 caractères (jamais coupé en dessous de 40) ;
// - lignes séparées par CR LF, chaque ligne finit par une virgule.

export type EbpSide = 'D' | 'C';
export type EbpDueFormat = 'dmy' | 'ymd';

/** Une ligne d'écriture prête à écrire. `amount` est toujours positif sauf `signed`. */
export type EbpLine = {
  pieceNo: number;
  /** Date de la pièce, ISO AAAA-MM-JJ. */
  date: string;
  journal: string;
  account: string;
  label: string;
  external: string;
  /** Montant positif (le sens est dans `side`). */
  amount: number;
  side: EbpSide;
  /** Journaux de ventes : montant écrit avec signe (crédit négatif). */
  signed: boolean;
  dueDate: string;
  dueFormat: EbpDueFormat;
  /** Identifiant du document source (pour le marquage « transféré »), non écrit dans le fichier. */
  sourceKind: EbpSourceKind;
  sourceId: string;
};

export type EbpSourceKind = 'document' | 'payment' | 'cash_movement' | 'purchase' | 'cession' | 'consignment';

/** Fiche de tiers (COMPTES.TXT). */
export type EbpThird = {
  account: string; name: string; name2?: string | null; address?: string | null; zip?: string | null;
  city?: string | null; country?: string | null; phone?: string | null;
};

// ------------------------------------------------------------------------------------------
// Mise en forme élémentaire
// ------------------------------------------------------------------------------------------

/** Texte G8 : majuscules, sans accents, sans guillemets (le guillemet délimite le champ). */
export function ebpText(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[Ææ]/g, 'AE').replace(/[Œœ]/g, 'OE').replace(/ß/g, 'SS')
    .replace(/"/g, ' ').replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '')
    .toUpperCase();
}

/** Ville de COMPTES.TXT : comme G8, sans tirets ni espaces (COURT-SAINT-ETIENNE → COURTSAINTETIENNE). */
export function ebpCity(s: string | null | undefined): string {
  return ebpText(s).replace(/[-'\s]/g, '');
}

/** Montant : point décimal, 2 décimales, aligné à droite sur 10 caractères. */
export function ebpAmount(n: number): string {
  const v = Math.round(n * 100) / 100;
  return (Object.is(v, -0) ? 0 : v).toFixed(2).padStart(10, ' ');
}

/** ISO AAAA-MM-JJ → JJMMAAAA. */
export function ebpDmy(iso: string): string {
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
}
/** ISO AAAA-MM-JJ → AAAAMMJJ. */
export function ebpYmd(iso: string): string {
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;
}

export const EBP_LABEL_WIDTH = 35;
export const EBP_LABEL_MAX = 40;

/** Libellé : complété à 35, coupé à 40 (G8 : « libellé ≈ 40 car. »). */
export function ebpLabel(s: string): string {
  return ebpText(s).padEnd(EBP_LABEL_WIDTH, ' ').slice(0, Math.max(EBP_LABEL_MAX, 0));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Une ligne d'ECRITURES.TXT (sans fin de ligne). */
export function ebpLineText(l: EbpLine): string {
  const amount = l.signed ? (l.side === 'C' ? -l.amount : l.amount) : l.amount;
  return [
    String(l.pieceNo).padStart(5, '0'),
    `"${ebpDmy(l.date)}"`,
    ebpText(l.journal).padEnd(4, ' '),
    ebpText(l.account).padEnd(12, ' '),
    '',
    `"${l.label}"`,
    `"${l.external}"`,
    `"${ebpAmount(amount)}"`,
    l.side,
    `"${l.dueFormat === 'ymd' ? ebpYmd(l.dueDate) : ebpDmy(l.dueDate)}"`,
    '',
  ].join(',');
}

/** Une fiche de COMPTES.TXT : champ renseigné entre guillemets, champ vide = une espace (relevé G8). */
export function ebpThirdText(t: EbpThird): string {
  const q = (v: string) => (v ? `"${v}"` : ' ');
  return [
    q(ebpText(t.account)), q(ebpText(t.name).slice(0, EBP_LABEL_MAX)), q(ebpText(t.name2).slice(0, EBP_LABEL_MAX)),
    q(ebpText(t.address).slice(0, EBP_LABEL_MAX)), q(ebpText(t.zip)), q(ebpCity(t.city)), q(ebpText(t.country || 'BE')),
    q(ebpText(t.phone).replace(/[^0-9+]/g, '')),
  ].join(',');
}

// ------------------------------------------------------------------------------------------
// Documents sources (déjà résolus en comptes) → pièces
// ------------------------------------------------------------------------------------------

/** Facture, ticket, facture d'acompte ou avoir (journal des ventes). Montants SIGNÉS (avoir négatif). */
export type EbpSaleDoc = {
  kind: 'sale';
  id: string;
  journal: string;
  /** « F22701456 », « AVOIR 22701458 », « FAC-2026-00012 »… */
  labelRef: string;
  external: string;
  date: string;
  dueDate: string;
  third: EbpThird;
  /** TTC au compte client (signé : avoir < 0). */
  ttc: number;
  /** Lignes de produit HT par compte (signées comme le document : facture > 0, avoir < 0). */
  sales: { account: string; amount: number }[];
  /** TVA par compte (signée comme le document). */
  vat: { account: string; amount: number }[];
  /** Lignes au débit hors client (acompte déduit sur la facture finale : compte acompte, TVA de l'acompte). */
  extraDebits?: { account: string; amount: number }[];
};

/** Règlement d'un document (journal CA pour les espèces, RC pour le reste). */
export type EbpPayment = {
  kind: 'payment';
  id: string;
  journal: string;
  date: string;
  /** Code du mode dans le libellé : ESP, CAR, VIR… */
  modeLabel: string;
  treasuryAccount: string;
  third: EbpThird;
  /** « F22701454 » (facture) ou « R3000002 » (acompte de réservation). */
  labelRef: string;
  external: string;
  /** Signé : un remboursement est négatif (sens inversés). */
  amount: number;
};

/**
 * Style de libellé des mouvements de fond de caisse, relevé dans G8 :
 * - `bank` (01 remise en banque) : texte sur 31 + mode, n° externe brut ;
 * - `deposit` (02 / 03 encaissement / décaissement dépôt-vente) : texte sur 32 + mode, n° externe sur 8 ;
 * - `generic` (autres) : texte sur 32 + mode (une espace si le texte remplit la zone), n° externe brut.
 */
export type EbpMovementStyle = 'bank' | 'deposit' | 'generic';

export type EbpCashMovement = {
  kind: 'cash_movement';
  id: string;
  journal: string;
  date: string;
  direction: 'in' | 'out';
  style: EbpMovementStyle;
  /** Libellé du type (« ACHAT DE CONSOM. ») + commentaire saisi. */
  text: string;
  modeLabel: string;
  /** Compte du mode (espèces 530000, virement 511400…). */
  modeAccount: string;
  /** Compte du type de mouvement (charge, banque, dépôt-vente…). */
  counterAccount: string;
  vatAccount: string;
  /** TTC positif. */
  amount: number;
  /** TVA comprise dans le TTC (sortie avec TVA déductible), 0 sinon. */
  vat: number;
  /** N° du mouvement. */
  external: string;
};

/** Pièce « générique » signée (achats, cessions, commissions de dépôt-vente) : lignes déjà équilibrées. */
export type EbpGenericDoc = {
  kind: 'purchase' | 'cession' | 'consignment';
  id: string;
  journal: string;
  date: string;
  dueDate: string;
  labelRef: string;
  external: string;
  third?: EbpThird | null;
  /** Montants signés : débit > 0, crédit < 0. */
  lines: { account: string; amount: number; label?: string }[];
};

export type EbpSource = EbpSaleDoc | EbpPayment | EbpCashMovement | EbpGenericDoc;

export type EbpBuildOptions = {
  /** Écriture facture par facture (G8 par défaut) ou semi-globale (une pièce par jour, ventes et TVA cumulées par compte). */
  writeMode: 'invoice' | 'semi_global';
  /** G8 « règlements en début de fichier ». */
  paymentsFirst: boolean;
  /** COMPTES.TXT : une fiche par compte (au lieu d'une par pièce comme G8). */
  dedupeThirds: boolean;
  /** Libellé de la pièce cumulée en semi-globale. */
  semiGlobalLabel: string;
};

export const DEFAULT_EBP_BUILD_OPTIONS: EbpBuildOptions = {
  writeMode: 'invoice', paymentsFirst: false, dedupeThirds: false, semiGlobalLabel: 'VENTES DU',
};

export type EbpResult = {
  lines: EbpLine[];
  thirds: EbpThird[];
  ecritures: string;
  comptes: string;
  pieces: number;
  totalDebit: number;
  totalCredit: number;
  /** Pièces dont débit ≠ crédit (ne devrait jamais arriver). */
  unbalanced: number[];
  /** Lignes sans compte (compte non paramétré : G8 l'écrit vide, on le signale). */
  missingAccounts: EbpLine[];
  /**
   * Documents sans aucune écriture (facture entièrement à 0 €, ex. OR 100 % garantie) : aucune pièce,
   * aucun n° consommé, mais ils sont marqués « transférés » pour ne pas revenir à chaque transfert.
   */
  emptySources: { kind: EbpSourceKind; id: string }[];
  /** Tous les documents d'origine du transfert (pièce, ou null si rien n'a été écrit) : marquage « transféré ». */
  items: { kind: EbpSourceKind; id: string; piece: number | null }[];
};

function saleLines(doc: EbpSaleDoc, pieceNo: number): EbpLine[] {
  const base = { pieceNo, date: doc.date, journal: doc.journal, external: doc.external, signed: true, dueDate: doc.dueDate, dueFormat: 'dmy' as const, sourceKind: 'document' as const, sourceId: doc.id };
  const name = ebpText(doc.third.name);
  const ref = ebpText(doc.labelRef);
  const out: EbpLine[] = [];
  const push = (account: string, signedAmount: number, label: string) => {
    if (round2(signedAmount) === 0) return;
    out.push({ ...base, account, label, amount: Math.abs(round2(signedAmount)), side: signedAmount >= 0 ? 'D' : 'C' });
  };
  // G8 : ligne TTC « F… NOM », lignes HT « F…  NOM » (deux espaces), lignes TVA « F… NOM ».
  push(doc.third.account, doc.ttc, ebpLabel(`${ref} ${name}`));
  for (const d of doc.extraDebits ?? []) push(d.account, d.amount, ebpLabel(`${ref} ${name}`));
  for (const s of doc.sales) push(s.account, -s.amount, ebpLabel(`${ref}  ${name}`));
  for (const v of doc.vat) push(v.account, -v.amount, ebpLabel(`${ref} ${name}`));
  return out;
}

function paymentLines(p: EbpPayment, pieceNo: number): EbpLine[] {
  const label = ebpLabel(`${ebpText(p.modeLabel)} ${ebpText(p.labelRef)}-${ebpText(p.third.name)}`);
  const base = { pieceNo, date: p.date, journal: p.journal, external: p.external, signed: false, dueDate: p.date, dueFormat: 'ymd' as const, label, sourceKind: 'payment' as const, sourceId: p.id };
  const amt = Math.abs(round2(p.amount));
  if (amt === 0) return [];
  const refund = p.amount < 0;
  return [
    { ...base, account: p.treasuryAccount, amount: amt, side: refund ? 'C' : 'D' },
    { ...base, account: p.third.account, amount: amt, side: refund ? 'D' : 'C' },
  ];
}

/** Libellé d'un mouvement de fond de caisse, au caractère près comme G8 (voir `EbpMovementStyle`). */
export function movementLabel(text: string, modeLabel: string, style: EbpMovementStyle): string {
  const t = ebpText(text);
  const width = style === 'bank' ? 31 : 32;
  const zone = t.length < width ? t.padEnd(width, ' ') : `${t} `;
  return `${zone}${ebpText(modeLabel)}`;
}

export function movementExternal(n: string, style: EbpMovementStyle): string {
  return style === 'deposit' ? ebpText(n).padEnd(8, ' ') : ebpText(n);
}

function movementLines(m: EbpCashMovement, pieceNo: number): EbpLine[] {
  const label = movementLabel(m.text, m.modeLabel, m.style);
  const base = { pieceNo, date: m.date, journal: m.journal, external: movementExternal(m.external, m.style), signed: false, dueDate: m.date, dueFormat: 'ymd' as const, label, sourceKind: 'cash_movement' as const, sourceId: m.id };
  const ttc = Math.abs(round2(m.amount));
  if (ttc === 0) return [];
  const vat = Math.abs(round2(m.vat));
  if (m.direction === 'in') {
    // Entrée : débit du mode (espèces / virement), crédit du compte du mouvement.
    return [
      { ...base, account: m.modeAccount, amount: ttc, side: 'D' },
      { ...base, account: m.counterAccount, amount: ttc, side: 'C' },
    ];
  }
  // Sortie : crédit du mode, débit du compte du mouvement (HT) et de la TVA déductible.
  const out: EbpLine[] = [
    { ...base, account: m.modeAccount, amount: ttc, side: 'C' },
    { ...base, account: m.counterAccount, amount: round2(ttc - vat), side: 'D' },
  ];
  if (vat !== 0) out.push({ ...base, account: m.vatAccount, amount: vat, side: 'D' });
  return out;
}

function genericLines(g: EbpGenericDoc, pieceNo: number): EbpLine[] {
  const name = g.third ? ebpText(g.third.name) : '';
  const base = { pieceNo, date: g.date, journal: g.journal, external: g.external, signed: true, dueDate: g.dueDate, dueFormat: 'dmy' as const, sourceKind: g.kind, sourceId: g.id };
  return g.lines
    .filter((l) => round2(l.amount) !== 0)
    .map((l) => ({
      ...base, account: l.account, amount: Math.abs(round2(l.amount)), side: (l.amount >= 0 ? 'D' : 'C') as EbpSide,
      label: ebpLabel(l.label ?? `${ebpText(g.labelRef)} ${name}`.trim()),
    }));
}

/** Semi-globale : une pièce par jour et par journal ; lignes client détaillées, ventes et TVA cumulées par compte. */
function semiGlobalLines(docs: EbpSaleDoc[], pieceNo: number, label: string): EbpLine[] {
  const first = docs[0];
  const out: EbpLine[] = [];
  const cumul = new Map<string, number>();
  for (const d of docs) {
    for (const l of saleLines({ ...d, sales: [], vat: [], extraDebits: d.extraDebits }, pieceNo)) out.push(l);
    for (const s of d.sales) cumul.set(s.account, round2((cumul.get(s.account) ?? 0) - s.amount));
    for (const v of d.vat) cumul.set(`\u0000${v.account}`, round2((cumul.get(`\u0000${v.account}`) ?? 0) - v.amount));
  }
  const lbl = ebpLabel(`${label} ${ebpDmy(first.date).replace(/(\d{2})(\d{2})(\d{4})/, '$1/$2/$3')}`);
  for (const [key, amount] of cumul) {
    if (amount === 0) continue;
    out.push({
      pieceNo, date: first.date, journal: first.journal, account: key.replace('\u0000', ''), label: lbl, external: ebpYmd(first.date),
      amount: Math.abs(amount), side: amount >= 0 ? 'D' : 'C', signed: true, dueDate: first.date, dueFormat: 'dmy',
      sourceKind: 'document', sourceId: first.id,
    });
  }
  return out.map((l) => ({ ...l, pieceNo }));
}

/** Contrôle d'équilibre par pièce (montants positifs, sens D/C). */
export function unbalancedPieces(lines: EbpLine[]): number[] {
  const sums = new Map<number, number>();
  for (const l of lines) sums.set(l.pieceNo, round2((sums.get(l.pieceNo) ?? 0) + (l.side === 'D' ? l.amount : -l.amount)));
  return [...sums].filter(([, s]) => s !== 0).map(([p]) => p);
}

/**
 * Construit ECRITURES.TXT et COMPTES.TXT. Les sources sont prises DANS L'ORDRE donné (ventes,
 * puis trésorerie, sauf « règlements en début de fichier ») ; une pièce par document.
 */
export function buildEbpTransfer(sources: EbpSource[], options: Partial<EbpBuildOptions> = {}): EbpResult {
  const o = { ...DEFAULT_EBP_BUILD_OPTIONS, ...options };
  const sales = sources.filter((s): s is EbpSaleDoc => s.kind === 'sale');
  const treasury = sources.filter((s) => s.kind === 'payment' || s.kind === 'cash_movement');
  const others = sources.filter((s): s is EbpGenericDoc => s.kind === 'purchase' || s.kind === 'cession' || s.kind === 'consignment');
  const ordered: (EbpSource | EbpSaleDoc[])[] = [];
  const saleBlock: (EbpSource | EbpSaleDoc[])[] = [];
  if (o.writeMode === 'semi_global') {
    const byDay = new Map<string, EbpSaleDoc[]>();
    for (const s of sales) {
      const k = `${s.date}|${s.journal}`;
      byDay.set(k, [...(byDay.get(k) ?? []), s]);
    }
    for (const group of byDay.values()) saleBlock.push(group);
  } else {
    saleBlock.push(...sales);
  }
  if (o.paymentsFirst) ordered.push(...treasury, ...saleBlock, ...others);
  else ordered.push(...saleBlock, ...treasury, ...others);

  const lines: EbpLine[] = [];
  const thirds: EbpThird[] = [];
  const emptySources: { kind: EbpSourceKind; id: string }[] = [];
  const items: { kind: EbpSourceKind; id: string; piece: number | null }[] = [];
  const kindOf = (s: EbpSource): EbpSourceKind => (s.kind === 'sale' ? 'document' : s.kind);
  let pieceNo = 0;
  for (const item of ordered) {
    pieceNo += 1;
    let ls: EbpLine[] = [];
    const itemThirds: EbpThird[] = [];
    if (Array.isArray(item)) {
      ls = semiGlobalLines(item, pieceNo, o.semiGlobalLabel);
      for (const d of item) itemThirds.push(d.third);
    } else if (item.kind === 'sale') { ls = saleLines(item, pieceNo); itemThirds.push(item.third); }
    else if (item.kind === 'payment') { ls = paymentLines(item, pieceNo); itemThirds.push(item.third); }
    else if (item.kind === 'cash_movement') ls = movementLines(item, pieceNo);
    else { ls = genericLines(item, pieceNo); if (item.third) itemThirds.push(item.third); }
    // Un document à 0 € (garantie à 100 %) n'écrit rien : pas de pièce vide, pas de n° consommé,
    // mais il est quand même marqué « transféré ».
    const sourcesOfItem = Array.isArray(item) ? item : [item];
    for (const src of sourcesOfItem) items.push({ kind: kindOf(src), id: src.id, piece: ls.length ? pieceNo : null });
    if (!ls.length) for (const src of sourcesOfItem) emptySources.push({ kind: kindOf(src), id: src.id });
    if (!ls.length) { pieceNo -= 1; continue; }
    thirds.push(...itemThirds);
    lines.push(...ls);
  }
  const usedThirds = o.dedupeThirds
    ? [...new Map(thirds.filter((t) => t.account).map((t) => [t.account, t])).values()]
    : thirds.filter((t) => t.account);
  const totalDebit = round2(lines.filter((l) => l.side === 'D').reduce((s, l) => s + l.amount, 0));
  const totalCredit = round2(lines.filter((l) => l.side === 'C').reduce((s, l) => s + l.amount, 0));
  return {
    lines,
    thirds: usedThirds,
    ecritures: lines.map((l) => ebpLineText(l) + '\r\n').join(''),
    comptes: usedThirds.map((t) => ebpThirdText(t) + '\r\n').join(''),
    pieces: pieceNo,
    totalDebit,
    totalCredit,
    unbalanced: unbalancedPieces(lines),
    missingAccounts: lines.filter((l) => !l.account.trim()),
    emptySources,
    items,
  };
}

// ------------------------------------------------------------------------------------------
// Comptes de tiers (G8 « Gestion des comptes › Comptes clients / fournisseurs »)
// ------------------------------------------------------------------------------------------

/** Création automatique G8 : code client 20 → 200020, 1000 → 201000 (base + code). Null si code non numérique ou hors plage. */
export function autoThirdAccount(code: string | null | undefined, base: number, width: number): string | null {
  const c = String(code ?? '').trim();
  if (!/^\d+$/.test(c)) return null;
  const n = base + Number(c);
  const s = String(n);
  return s.length === width ? s : null;
}

/** Compte « à la volée » G8 d'un client sans compte : 411 + code sur 5 (client 6003 → 41106003). */
export function onTheFlyAccount(code: string | null | undefined, prefix: string, pad: number): string | null {
  const c = String(code ?? '').trim();
  if (!c) return null;
  return `${prefix}${c.padStart(pad, '0')}`;
}

/** TVA comprise dans un TTC (sortie de caisse avec TVA). */
export function vatIncluded(ttc: number, rate: number): number {
  if (!rate) return 0;
  const ht = round2(ttc / (1 + rate / 100));
  return round2(ttc - ht);
}
