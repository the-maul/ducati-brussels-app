/**
 * M7 (B2/B3/B5/B7) — Écritures de la VALIDATION de reprise.
 * Nouvelle logique : la création d'une reprise = demande / appel d'offres
 * (véhicule en statut « repris », PAS d'article ni de stock). L'entrée en
 * stock (article O/P + mouvement valorisé + statut stock_vo) ne se fait
 * qu'ici, à la validation.
 * Résilient : les métadonnées de validation (checklist, attestation, montants,
 * classement) vivent dans de nouvelles colonnes de `oro` — repli localStorage
 * tant que la migration n'est pas appliquée (pattern isMissingSchema).
 */
import { supabase } from '@/integrations/supabase/client';
import type { ValidationData } from './validate-data';
import { stockUnitCost } from './validate-data';

/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = supabase as any;

const isMissingSchema = (e: unknown): boolean => {
  const code = (e as { code?: string })?.code ?? '';
  return code === 'PGRST205' || code === '42P01' || code === '42703' || code === 'PGRST204';
};

export type TradeinStatus = 'ouvert' | 'valide' | 'annule';

export type ValidationMeta = ValidationData & {
  tradein_status: TradeinStatus;
  attestation?: { place: string; date: string; signed: boolean } | null;
  validated_at?: string | null;
  cancelled_at?: string | null;
};

const lsKey = (oroId: string) => `ducati.tradein-validation.${oroId}`;

function readLocal(oroId: string): Partial<ValidationMeta> | null {
  try {
    const s = localStorage.getItem(lsKey(oroId));
    return s ? JSON.parse(s) as Partial<ValidationMeta> : null;
  } catch { return null; }
}

function writeLocal(oroId: string, meta: Partial<ValidationMeta>): void {
  try { localStorage.setItem(lsKey(oroId), JSON.stringify({ ...readLocal(oroId), ...meta })); } catch { /* plein */ }
}

/** Métadonnées de validation d'un dossier (colonnes si migrées, sinon localStorage). */
export function readValidationMeta(oroRow: Record<string, unknown>, oroId: string): Partial<ValidationMeta> {
  // Colonnes présentes en base → prioritaires ; localStorage en complément
  const local = readLocal(oroId) ?? {};
  const db: Partial<ValidationMeta> = {};
  if (oroRow.tradein_status != null) db.tradein_status = oroRow.tradein_status as TradeinStatus;
  for (const k of ['checklist', 'seller_vat_status', 'attestation', 'vat_rate', 'buy_price_ttc', 'buy_price_ht',
    'sale_price', 'min_sale_price', 'classification', 'validated_at', 'cancelled_at'] as const) {
    if (oroRow[k] != null) (db as Record<string, unknown>)[k] = oroRow[k];
  }
  return { ...local, ...db };
}

/**
 * Statut de la reprise pour l'affichage liste/fiche.
 * Garde-fou tant que la migration n'est pas appliquée : si aucune métadonnée
 * n'existe (autre poste / autre navigateur) mais que le véhicule est déjà en
 * stock occasion avec un article lié, la reprise a forcément été VALIDÉE —
 * on l'infère pour ne pas réafficher « Ouvert » (et éviter une re-validation
 * à vide qui écraserait la valorisation).
 */
export function tradeinStatusOf(
  oroRow: Record<string, unknown>, oroId: string,
  vehicle?: { status?: string | null; article_id?: string | null } | null,
): TradeinStatus {
  const meta = readValidationMeta(oroRow, oroId);
  if (meta.tradein_status) return meta.tradein_status;
  if (vehicle?.status === 'stock_vo' && vehicle?.article_id) return 'valide';
  return 'ouvert';
}

/** Écrit les métadonnées sur oro ; repli localStorage si colonnes absentes. */
async function saveMeta(oroId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await raw.from('oro').update(patch).eq('id', oroId);
  if (error) {
    if (!isMissingSchema(error)) throw error;
    writeLocal(oroId, patch as Partial<ValidationMeta>);
  } else {
    // Garde une copie locale (utile si on relit avant rechargement du cache)
    writeLocal(oroId, patch as Partial<ValidationMeta>);
  }
}

export type ValidateArgs = {
  companyId: string;
  oroId: string;
  oroNumber: string;
  vehicleId: string;
  designation: string;
  data: ValidationData;
  attestation: { place: string; date: string; signed: boolean } | null;
};

/**
 * Validation finale (étape 3) : crée l'article occasion (O = TVA marge /
 * P = 21 %), l'entrée de stock valorisée (B5/B7), passe le véhicule en
 * stock occasion et fige les métadonnées sur le dossier.
 */
export async function validateReprise(a: ValidateArgs): Promise<{ articleId: string }> {
  const isPro = a.data.vat_rate > 0;
  const unitCost = stockUnitCost(a.data);

  // Déjà validé (modification) ? → pas de double article/stock
  const { data: veh } = await supabase.from('vehicles').select('article_id').eq('id', a.vehicleId).maybeSingle();
  let articleId = (veh?.article_id as string | null) ?? null;

  if (!articleId) {
    // 1) Article occasion (B1 : O particulier / P professionnel)
    const { data: art, error: ae } = await supabase.from('articles').insert({
      company_id: a.companyId, reference: a.oroNumber, designation: a.designation,
      mgmt_type: isPro ? 'P' : 'O', purchase_price: unitCost, pamp: unitCost,
      sale_price_ttc: a.data.sale_price, vat_rate: a.data.vat_rate,
      category_path: a.data.classification.rayon || null,
      note: `${a.data.classification.supplier} / ${a.data.classification.rayon} / ${a.data.classification.sub_rayon} / ${a.data.classification.category}`,
    }).select('id').single();
    if (ae) throw ae;
    articleId = art.id as string;

    // 2) Entrée de stock valorisée (PAMP = coût de reprise) — append-only
    const { error: me } = await supabase.rpc('record_stock_move', {
      _article: articleId, _type: 'entree', _qty: 1, _unit_cost: unitCost,
      _is_reservation: false, _bin: null, _origin: 'reception', _ref: a.oroNumber,
      _note: 'Reprise validée — entrée en stock occasion',
    });
    if (me) throw me;
  } else {
    // Modification après validation : ajuste les prix de l'article existant
    await supabase.from('articles').update({
      sale_price_ttc: a.data.sale_price, vat_rate: a.data.vat_rate,
      mgmt_type: isPro ? 'P' : 'O',
    }).eq('id', articleId);

    // Re-validation après une ANNULATION : la sortie d'annulation a vidé le
    // stock — ré-enregistrer une entrée valorisée, sinon la moto serait
    // affichée « en stock » avec un stock réel à zéro (violation B5).
    const { data: st } = await supabase.rpc('article_stock', { _article: articleId });
    const stRow = Array.isArray(st) ? st[0] : st;
    const realQty = Number((stRow as { real_qty?: number } | null)?.real_qty ?? 0);
    if (realQty <= 0) {
      const { error: re } = await supabase.rpc('record_stock_move', {
        _article: articleId, _type: 'entree', _qty: 1, _unit_cost: unitCost,
        _is_reservation: false, _bin: null, _origin: 'reception', _ref: a.oroNumber,
        _note: 'Reprise re-validée après annulation — ré-entrée en stock',
      });
      if (re) throw re;
    }
  }

  // 3) Véhicule → en stock occasion, prix à jour
  const { error: ve } = await supabase.from('vehicles').update({
    article_id: articleId, status: 'stock_vo',
    purchase_price: unitCost, cost_price: unitCost, display_price: a.data.sale_price || null,
  }).eq('id', a.vehicleId);
  if (ve) throw ve;

  // 4) Métadonnées de validation sur le dossier
  await saveMeta(a.oroId, {
    tradein_status: 'valide',
    checklist: a.data.checklist,
    seller_vat_status: a.data.seller_vat_status,
    attestation: a.attestation,
    vat_rate: a.data.vat_rate,
    buy_price_ttc: a.data.buy_price_ttc,
    buy_price_ht: a.data.buy_price_ht,
    sale_price: a.data.sale_price,
    min_sale_price: a.data.min_sale_price,
    classification: a.data.classification,
    validated_at: new Date().toISOString(),
    cancelled_at: null,
  });

  return { articleId };
}

/**
 * Annulation d'une reprise. Si elle était validée : sortie de stock (B7,
 * mouvement inverse tracé) et retour du véhicule en « demande de reprise ».
 */
export async function cancelReprise(companyId: string, oroId: string, oroNumber: string, vehicleId: string | null): Promise<void> {
  if (vehicleId) {
    const { data: veh } = await supabase.from('vehicles').select('article_id, status').eq('id', vehicleId).maybeSingle();
    const articleId = (veh?.article_id as string | null) ?? null;
    if (articleId && veh?.status === 'stock_vo') {
      // Erreur propagée AVANT tout changement d'état : jamais de sortie de
      // stock silencieusement perdue (B7) — l'annulation reste rejouable.
      const { error: me } = await supabase.rpc('record_stock_move', {
        _article: articleId, _type: 'sortie', _qty: -1, _unit_cost: null,
        _is_reservation: false, _bin: null, _origin: 'reception', _ref: oroNumber,
        _note: 'Annulation de la reprise — sortie de stock',
      });
      if (me) throw me;
    }
    const { error: ve } = await supabase.from('vehicles').update({ status: 'repris', display_price: null }).eq('id', vehicleId);
    if (ve) throw ve;
  }
  await saveMeta(oroId, { tradein_status: 'annule', cancelled_at: new Date().toISOString() });
}
