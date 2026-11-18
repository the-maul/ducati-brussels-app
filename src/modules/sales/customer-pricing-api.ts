/**
 * M1 / M6 — Tarifs clients : acces base (tarifs communs, regles par client) et « pricer » utilise
 * par la vente, la caisse, le devis et l'OR. Le calcul est dans `customer-pricing.ts` (pur, teste).
 *
 * Tables `price_lists` / `price_list_rules` et colonnes `contacts.price_list_id`,
 * `contacts.credit_limit_blocking` : migration 20261118190000 (a appliquer). Tant qu'elle ne l'est
 * pas, les tarifs communs sont ignores sans erreur (les regles par client continuent de marcher).
 */
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  resolveSalePrice, priceListChain, clientPriceListId, fromPriceListRule, fromCustomerPriceRule, fromClientPriceRule,
  type PricingRule, type PricingArticle, type ResolvedSalePrice, type PriceListRow, type PriceListRuleRow,
  type CustomerPriceRuleRow, type ClientPriceRuleRow, type PriceKind, type PriceTier,
} from './customer-pricing';

// Tables hors types.ts tant que la migration n'est pas posee (types.ts n'est pas regenere a la main).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (table: string): any => (supabase.from as unknown as (t: string) => unknown)(table);
const rpcLoose = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;

/** Table / colonne / fonction absente : migration pas encore appliquee. */
export function isMissingObject(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return ['PGRST205', '42P01', 'PGRST204', '42703', 'PGRST202', '42883'].includes(e.code ?? '')
    || /does not exist|Could not find the (table|function)|schema cache/i.test(e.message ?? '');
}

/** Champs de la fiche client lus par la vente (dont les colonnes de la migration 20261118190000). */
export type PricingContact = {
  id: string; company_id?: string; price_list?: string | null; price_list_id?: string | null;
  show_discounts_pos?: boolean | null;
};

export type PriceList = PriceListRow & { company_id: string; created_at?: string | null };
export type PriceListRule = PriceListRuleRow & { company_id: string; note?: string | null };

/* ------------------------------------------------------------------ tarifs communs (ecran de gestion) */

/** Tarifs de la societe ; `null` si la migration n'est pas appliquee. */
export async function listPriceLists(companyId: string): Promise<PriceList[] | null> {
  const { data, error } = await loose('price_lists').select('*').eq('company_id', companyId).order('code');
  if (error) { if (isMissingObject(error)) return null; throw error; }
  return (data ?? []) as PriceList[];
}

export type PriceListInput = {
  id?: string; company_id: string; code: string; label?: string | null; base_list_id?: string | null;
  is_promo?: boolean; show_discount?: boolean; is_active?: boolean;
};
export async function savePriceList(row: PriceListInput): Promise<string> {
  const payload = {
    company_id: row.company_id, code: row.code.trim(), label: row.label?.trim() || null, base_list_id: row.base_list_id || null,
    is_promo: !!row.is_promo, show_discount: row.show_discount !== false, is_active: row.is_active !== false,
  };
  const q = row.id ? loose('price_lists').update(payload).eq('id', row.id).select('id').single() : loose('price_lists').insert(payload).select('id').single();
  const { data, error } = await q;
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deletePriceList(id: string): Promise<void> {
  const { error } = await loose('price_lists').delete().eq('id', id);
  if (error) throw error;
}

/** Nombre de clients rattaches a chaque tarif (colonne « clients » de la liste). */
export async function countClientsByList(companyId: string): Promise<Map<string, number>> {
  const { data, error } = await loose('contacts').select('price_list_id').eq('company_id', companyId).not('price_list_id', 'is', null).limit(10000);
  if (error) { if (isMissingObject(error)) return new Map(); throw error; }
  const m = new Map<string, number>();
  for (const r of (data ?? []) as { price_list_id: string }[]) m.set(r.price_list_id, (m.get(r.price_list_id) ?? 0) + 1);
  return m;
}

export async function listPriceListRules(listId: string): Promise<PriceListRule[]> {
  const { data, error } = await loose('price_list_rules').select('*').eq('price_list_id', listId).order('scope').order('created_at');
  if (error) throw error;
  return (data ?? []) as PriceListRule[];
}

export type PriceListRuleInput = {
  company_id: string; price_list_id: string; scope: string; article_id?: string | null; supplier_id?: string | null;
  family_code?: string | null; brand?: string | null; kind: PriceKind; tiers: PriceTier[];
  date_from?: string | null; date_to?: string | null; note?: string | null;
};
export async function addPriceListRules(rows: PriceListRuleInput[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await loose('price_list_rules').insert(chunk);
    if (error) throw error;
    n += chunk.length;
  }
  return n;
}

export async function updatePriceListRules(ids: string[], patch: Partial<Pick<PriceListRuleInput, 'kind' | 'tiers' | 'date_from' | 'date_to'>>): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await loose('price_list_rules').update(patch).in('id', ids.slice(i, i + 200));
    if (error) throw error;
  }
}

export async function deletePriceListRules(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await loose('price_list_rules').delete().in('id', ids.slice(i, i + 200));
    if (error) throw error;
  }
}

/** Duplique un tarif et toutes ses lignes (G8 « Dupliquer ») ; retourne l'id du nouveau tarif. */
export async function duplicatePriceList(source: PriceList, newCode: string): Promise<string> {
  const id = await savePriceList({
    company_id: source.company_id, code: newCode, label: source.label ?? null, base_list_id: source.base_list_id ?? null,
    is_promo: !!source.is_promo, show_discount: source.show_discount !== false, is_active: source.is_active !== false,
  });
  const rules = await listPriceListRules(source.id);
  await addPriceListRules(rules.map((r) => ({
    company_id: r.company_id, price_list_id: id, scope: r.scope, article_id: r.article_id ?? null, supplier_id: r.supplier_id ?? null,
    family_code: r.family_code ?? null, brand: r.brand ?? null, kind: r.kind as PriceKind, tiers: (Array.isArray(r.tiers) ? r.tiers : []) as PriceTier[],
    date_from: r.date_from ?? null, date_to: r.date_to ?? null, note: r.note ?? null,
  })));
  return id;
}

/** Articles par reference (import d'un fichier de tarif), par paquets. */
export async function articlesByReference(companyId: string, refs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(refs.map((r) => r.trim()).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await supabase.from('articles').select('id, reference').eq('company_id', companyId).in('reference', uniq.slice(i, i + 200));
    if (error) throw error;
    for (const a of data ?? []) out.set(a.reference.trim().toUpperCase(), a.id);
  }
  return out;
}

/** References des articles vises par des lignes (affichage de la grille). */
export async function articleRefsByIds(ids: string[]): Promise<Map<string, { reference: string; designation: string }>> {
  const out = new Map<string, { reference: string; designation: string }>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await supabase.from('articles').select('id, reference, designation').in('id', uniq.slice(i, i + 200));
    if (error) throw error;
    for (const a of data ?? []) out.set(a.id, { reference: a.reference, designation: a.designation });
  }
  return out;
}

/* ------------------------------------------------------------------ prix a la vente */

type ArticleInfoRow = {
  id: string; reference: string; purchase_price: number | null; category_id: string | null; category_path: string | null;
  main_supplier_id: string | null; brand: string | null;
};

/**
 * Calcule le prix d'un article pour UN client. Les regles du client et de son tarif sont lues une
 * fois ; les lignes « par reference » d'un tarif (parfois des milliers, import) sont lues article
 * par article et gardees en memoire.
 */
export class CustomerPricer {
  private base: Promise<{ rules: PricingRule[]; chain: (PriceListRow & { depth: number })[]; needsSupplier: boolean }> | null = null;
  private perArticle = new Map<string, Promise<{ article: PricingArticle; rules: PricingRule[] }>>();

  /**
   * `insurerPriceList` : tarif associe au cabinet d'assurance d'un OR accident (G8 : la fiche
   * assurance porte un tarif applique automatiquement aux OR assurance). S'il designe un tarif
   * commun connu (code ou libelle), il REMPLACE le tarif et les regles du client sur cet OR ;
   * sinon le tarif du client s'applique comme d'habitude.
   */
  constructor(readonly companyId: string, readonly contact: PricingContact | null, readonly insurerPriceList: string | null = null) {}

  private get active(): boolean { return !!this.contact || !!this.insurerPriceList?.trim(); }

  /** Tarif commun du client (code + libelle), pour l'en-tete du document. */
  async priceList(): Promise<(PriceListRow & { depth: number }) | null> {
    if (!this.active) return null;
    const { chain } = await this.loadBase();
    return chain[0] ?? null;
  }

  private loadBase() {
    if (!this.base) this.base = this.fetchBase();
    return this.base;
  }

  private async fetchBase() {
    const rules: PricingRule[] = [];
    let chain: (PriceListRow & { depth: number })[] = [];
    const c = this.contact;
    if (!this.active) return { rules, chain, needsSupplier: false };
    const lists = await listPriceLists(this.companyId);
    // OR accident : tarif du cabinet d'assurance, s'il designe un tarif connu.
    const insurerListId = lists && this.insurerPriceList ? clientPriceListId({ price_list: this.insurerPriceList }, lists) : null;
    const clientId = c?.id ?? '00000000-0000-0000-0000-000000000000';
    // 1. Regles propres au client (sauf OR accident au tarif du cabinet) et regles generales.
    const { data: cpr, error: e1 } = await supabase.from('customer_price_rules').select('*')
      .eq('company_id', this.companyId).eq('is_active', true).or(`contact_id.eq.${clientId},contact_id.is.null`).limit(2000);
    if (e1 && !isMissingObject(e1)) throw e1;
    for (const r of (cpr ?? []) as CustomerPriceRuleRow[]) {
      if (insurerListId && r.contact_id) continue;
      const x = fromCustomerPriceRule(r, clientId); if (x) rules.push(x);
    }
    // 2. Onglet « Tarifs » de la fiche client.
    if (c && !insurerListId) {
      const { data: clr, error: e2 } = await supabase.from('client_price_rules').select('*').eq('contact_id', c.id).limit(2000);
      if (e2 && !isMissingObject(e2)) throw e2;
      for (const r of (clr ?? []) as ClientPriceRuleRow[]) { const x = fromClientPriceRule(r); if (x) rules.push(x); }
    }
    // 3. Tarif commun (du cabinet sur un OR accident, sinon du client) et ses tarifs de base.
    if (lists) {
      chain = priceListChain(lists, insurerListId ?? (c ? clientPriceListId(c, lists) : null));
      if (chain.length) {
        const { data: plr, error: e3 } = await loose('price_list_rules').select('*')
          .in('price_list_id', chain.map((l) => l.id)).neq('scope', 'reference').limit(5000);
        if (e3 && !isMissingObject(e3)) throw e3;
        const byId = new Map(chain.map((l) => [l.id, l]));
        for (const r of (plr ?? []) as PriceListRuleRow[]) { const l = byId.get(r.price_list_id); const x = l && fromPriceListRule(r, l); if (x) rules.push(x); }
      }
    }
    // Articles qui portent seulement le fournisseur ecrit en texte : il faudra son code / nom.
    const needsSupplier = rules.some((r) => r.scope === 'supplier' && !r.supplierId && !!r.supplierText);
    return { rules, chain, needsSupplier };
  }

  private loadArticle(articleId: string) {
    let p = this.perArticle.get(articleId);
    if (!p) { p = this.fetchArticle(articleId); this.perArticle.set(articleId, p); p.catch(() => this.perArticle.delete(articleId)); }
    return p;
  }

  private async fetchArticle(articleId: string) {
    const { chain, needsSupplier } = await this.loadBase();
    const { data: a, error } = await supabase.from('articles')
      .select('id, reference, purchase_price, category_id, category_path, main_supplier_id, brand').eq('id', articleId).maybeSingle();
    if (error) throw error;
    const row = a as ArticleInfoRow | null;
    const article: PricingArticle = {
      id: articleId, reference: row?.reference ?? null, purchasePrice: row?.purchase_price ?? null,
      categoryId: row?.category_id ?? null, categoryPath: row?.category_path ?? null, supplierId: row?.main_supplier_id ?? null, brand: row?.brand ?? null,
    };
    if (needsSupplier && row?.main_supplier_id) {
      const { data: s } = await supabase.from('contacts').select('code, company_name, last_name').eq('id', row.main_supplier_id).maybeSingle();
      article.supplierCode = s?.code ?? null;
      article.supplierName = s?.company_name || s?.last_name || null;
    }
    const rules: PricingRule[] = [];
    if (chain.length) {
      const { data: plr, error: e } = await loose('price_list_rules').select('*')
        .in('price_list_id', chain.map((l) => l.id)).eq('scope', 'reference').eq('article_id', articleId);
      if (e && !isMissingObject(e)) throw e;
      const byId = new Map(chain.map((l) => [l.id, l]));
      for (const r of (plr ?? []) as PriceListRuleRow[]) { const l = byId.get(r.price_list_id); const x = l && fromPriceListRule(r, l); if (x) rules.push(x); }
    }
    return { article, rules };
  }

  /** Prix d'un article pour ce client (sans client : prix catalogue, sans aller-retour). */
  async price(articleId: string, baseHt: number, qty = 1, date = todayIso()): Promise<ResolvedSalePrice> {
    if (!this.active) return resolveSalePrice({ article: { id: articleId }, baseHt, qty, date, rules: [] });
    const [{ rules }, { article, rules: refRules }] = await Promise.all([this.loadBase(), this.loadArticle(articleId)]);
    return resolveSalePrice({
      article, baseHt, qty, date, rules: [...rules, ...refRules], showDiscounts: this.contact?.show_discounts_pos !== false,
    });
  }

  /** Oublie ce qui est en memoire (apres « Tarifications »). */
  reset(articleId?: string) {
    if (articleId) this.perArticle.delete(articleId); else this.perArticle.clear();
    this.base = null;
  }
}

const todayIso = () => {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Un pricer par client (recree quand le client, son tarif ou le tarif du cabinet change). */
export function useCustomerPricer(companyId: string, contact: PricingContact | null, insurerPriceList: string | null = null): CustomerPricer {
  const key = `${contact ? `${contact.id}|${contact.price_list_id ?? ''}|${contact.price_list ?? ''}|${contact.show_discounts_pos !== false}` : ''}|${insurerPriceList ?? ''}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new CustomerPricer(companyId, contact, insurerPriceList), [companyId, key]);
}

/**
 * Tarif associe au cabinet d'assurance du dossier accident d'un OR (migration 20261118130000 du lot
 * garantie / accident) ; null sans dossier, sans cabinet, sans tarif ou sans la migration.
 */
export async function insurerPriceListForOr(orId: string): Promise<string | null> {
  const { data, error } = await loose('accident_files').select('insurer_id').eq('repair_order_id', orId).not('insurer_id', 'is', null).limit(1);
  if (error) { if (isMissingObject(error) || error.code === 'PGRST200') return null; throw error; }
  const insurerId = ((data ?? []) as { insurer_id: string | null }[])[0]?.insurer_id;
  if (!insurerId) return null;
  const { data: p, error: e2 } = await loose('insurance_parties').select('price_list').eq('id', insurerId).maybeSingle();
  if (e2) { if (isMissingObject(e2)) return null; throw e2; }
  const txt = ((p ?? null) as { price_list: string | null } | null)?.price_list?.trim();
  return txt || null;
}

/**
 * « Tarifications » (G8, bouton de la saisie) : fixe a la volee le prix HT d'un article pour ce
 * client. Client avec un tarif commun : ligne « par reference » de ce tarif (creee ou remplacee,
 * prix net, palier 1). Sans tarif : regle propre au client (onglet Tarifs de la fiche, prix net).
 * Retourne ou le prix a ete pose.
 */
export async function setArticlePriceForClient(p: {
  companyId: string; contactId: string; pricer: CustomerPricer; articleId: string; reference: string; netHt: number;
}): Promise<{ target: 'list' | 'client'; listCode: string | null }> {
  const netHt = Math.round(p.netHt * 100) / 100;
  if (!(netHt > 0)) throw new Error('Prix invalide');
  const list = await p.pricer.priceList();
  if (list && list.depth === 1) {
    const { data, error } = await loose('price_list_rules').select('id')
      .eq('price_list_id', list.id).eq('scope', 'reference').eq('article_id', p.articleId);
    if (error) throw error;
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    const tiers = [{ min_qty: 1, value: netHt }];
    if (ids.length) await updatePriceListRules(ids, { kind: 'net', tiers, date_from: null, date_to: null });
    else await addPriceListRules([{ company_id: p.companyId, price_list_id: list.id, scope: 'reference', article_id: p.articleId, kind: 'net', tiers }]);
    p.pricer.reset(p.articleId);
    return { target: 'list', listCode: list.code };
  }
  // Sans tarif commun : regle propre au client, par reference.
  const { data: existing, error: e1 } = await supabase.from('client_price_rules').select('id')
    .eq('contact_id', p.contactId).eq('target_type', 'reference').eq('target_value', p.reference);
  if (e1) throw e1;
  const rows = existing ?? [];
  if (rows.length) {
    const { error } = await supabase.from('client_price_rules').update({ mode: 'net', value1: netHt, qty2: null, value2: null, qty3: null, value3: null, date_from: null, date_to: null }).in('id', rows.map((r) => r.id));
    if (error) throw error;
  } else {
    const { error } = await supabase.from('client_price_rules').insert({ company_id: p.companyId, contact_id: p.contactId, target_type: 'reference', target_value: p.reference, mode: 'net', value1: netHt });
    if (error) throw error;
  }
  p.pricer.reset();
  return { target: 'client', listCode: null };
}

/** Encours reel du client (migration 20261118190000) ; repli sur l'ancienne fonction sinon. */
export async function contactOpenBalance(contactId: string, excludeDocumentId?: string | null): Promise<number> {
  const { data, error } = await rpcLoose('contact_open_balance', { _contact: contactId, _exclude: excludeDocumentId ?? null });
  if (!error) return Number(data ?? 0);
  if (!isMissingObject(error)) throw error;
  const { data: old, error: e2 } = await supabase.rpc('contact_encours', { _contact: contactId });
  if (e2) throw e2;
  const row = (Array.isArray(old) ? old[0] : old) as { current_due?: number } | undefined;
  return Number(row?.current_due ?? 0);
}
