/**
 * M7 — Marchands partenaires (occasions) + offres reçues + mode d'envoi.
 * Tables : tradein_partners / tradein_offers (migration 20260716) ;
 * companies.tradein_dispatch_mode ('auto' | 'semi_auto', défaut semi).
 *
 * RÉSILIENCE : tant que la migration n'est pas appliquée, les lectures renvoient
 * vide (bannière côté écran) et le mode d'envoi bascule sur localStorage.
 * NB : tables hors types Supabase auto-générés — casts localisés.
 */
import { supabase } from '@/integrations/supabase/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = supabase as any;

/** Erreur « schéma manquant » : table absente (PGRST205/42P01) ou colonne absente (42703). */
export function isMissingSchema(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01' || code === '42703';
}

export type TradeinPartner = {
  id: string; company_id: string; name: string; email: string;
  brands: string[]; is_active: boolean; created_at: string;
};

export type TradeinOffer = {
  id: string; company_id: string; oro_id: string; partner_id: string | null;
  partner_name: string | null; amount: number; message: string | null;
  seen: boolean; created_at: string;
};

/** Le schéma partenaires/offres est-il présent en base ? (bannière migration) */
export async function checkPartnersSchema(): Promise<boolean> {
  const { error } = await raw.from('tradein_partners').select('id').limit(1);
  if (!error) return true;
  return !isMissingSchema(error);
}

// ── Marchands partenaires ─────────────────────────────────────────────────────

export async function listPartners(companyId: string): Promise<TradeinPartner[]> {
  try {
    const { data, error } = await raw
      .from('tradein_partners').select('*')
      .eq('company_id', companyId).order('name');
    if (error) throw error;
    return (data as TradeinPartner[]) ?? [];
  } catch (e) {
    if (isMissingSchema(e)) return [];
    throw e;
  }
}

export async function addPartner(companyId: string, p: { name: string; email: string; brands: string[] }): Promise<void> {
  const { error } = await raw.from('tradein_partners').insert({
    company_id: companyId, name: p.name.trim(), email: p.email.trim().toLowerCase(), brands: p.brands,
  });
  if (error) throw error;
}

export async function updatePartner(id: string, patch: Partial<Pick<TradeinPartner, 'name' | 'email' | 'brands' | 'is_active'>>): Promise<void> {
  const { error } = await raw.from('tradein_partners').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deletePartner(id: string): Promise<void> {
  const { error } = await raw.from('tradein_partners').delete().eq('id', id);
  if (error) throw error;
}

/** Partenaires actifs intéressés par une marque (brands vide = toutes marques). */
export function partnersForBrand(partners: TradeinPartner[], brand: string | null | undefined): TradeinPartner[] {
  const b = (brand ?? '').trim().toLowerCase();
  return partners.filter((p) => p.is_active && (
    p.brands.length === 0 || (b !== '' && p.brands.some((x) => x.trim().toLowerCase() === b))
  ));
}

// ── Offres des marchands ──────────────────────────────────────────────────────

/** Offres d'une reprise, triées de la plus haute à la plus basse. */
export async function listOffers(oroId: string): Promise<TradeinOffer[]> {
  try {
    const { data, error } = await raw
      .from('tradein_offers').select('*')
      .eq('oro_id', oroId).order('amount', { ascending: false });
    if (error) throw error;
    return (data as TradeinOffer[]) ?? [];
  } catch (e) {
    if (isMissingSchema(e)) return [];
    throw e;
  }
}

export async function addOffer(companyId: string, oroId: string, o: { partnerId?: string | null; partnerName: string; amount: number; message?: string }): Promise<void> {
  const { error } = await raw.from('tradein_offers').insert({
    company_id: companyId, oro_id: oroId, partner_id: o.partnerId ?? null,
    partner_name: o.partnerName.trim() || null, amount: o.amount, message: o.message?.trim() || null,
  });
  if (error) throw error;
}

export async function deleteOffer(id: string): Promise<void> {
  const { error } = await raw.from('tradein_offers').delete().eq('id', id);
  if (error) throw error;
}

/** Nombre d'offres par reprise (aperçu liste) — Map oro_id → count. */
export async function offerCountsByOro(companyId: string): Promise<Map<string, number>> {
  try {
    const { data, error } = await raw
      .from('tradein_offers').select('oro_id')
      .eq('company_id', companyId);
    if (error) throw error;
    const m = new Map<string, number>();
    for (const r of (data as { oro_id: string }[]) ?? []) m.set(r.oro_id, (m.get(r.oro_id) ?? 0) + 1);
    return m;
  } catch (e) {
    if (isMissingSchema(e)) return new Map();
    throw e;
  }
}

/** Offres non vues (pastille de notification du menu). */
export async function countUnseenOffers(companyId: string): Promise<number> {
  try {
    const { count, error } = await raw
      .from('tradein_offers').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('seen', false);
    if (error) throw error;
    return Number(count ?? 0);
  } catch (e) {
    if (isMissingSchema(e)) return 0;
    throw e;
  }
}

/** Marque toutes les offres comme vues (ouverture de la page Reprises). */
export async function markOffersSeen(companyId: string): Promise<void> {
  try {
    const { error } = await raw
      .from('tradein_offers').update({ seen: true })
      .eq('company_id', companyId).eq('seen', false);
    if (error) throw error;
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
  }
}

// ── Mode d'envoi aux marchands ────────────────────────────────────────────────

export type DispatchMode = 'auto' | 'semi_auto';
const kDispatch = (companyId: string) => `ducati.tradein-dispatch.${companyId}`;

export async function getDispatchMode(companyId: string): Promise<DispatchMode> {
  try {
    const { data, error } = await raw
      .from('companies').select('tradein_dispatch_mode').eq('id', companyId).maybeSingle();
    if (error) throw error;
    return (data?.tradein_dispatch_mode === 'auto' ? 'auto' : 'semi_auto');
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
    if (typeof window !== 'undefined') {
      const v = window.localStorage.getItem(kDispatch(companyId));
      if (v === 'auto') return 'auto';
    }
    return 'semi_auto';
  }
}

export async function setDispatchMode(companyId: string, mode: DispatchMode): Promise<void> {
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(kDispatch(companyId), mode); } catch { /* quota */ }
  }
  try {
    const { error } = await raw.from('companies').update({ tradein_dispatch_mode: mode }).eq('id', companyId);
    if (error) throw error;
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
  }
}

// ── Mailto de diffusion (semi-auto / auto sans backend e-mail) ────────────────

export function buildDispatchMailto(partners: TradeinPartner[], subject: string, body: string): string | null {
  if (partners.length === 0) return null;
  const bcc = partners.map((p) => p.email).join(',');
  return `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
