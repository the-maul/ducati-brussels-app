/**
 * Un seul catalogue (décision M-25) — éléments d'écran partagés : badges G8 / Shopify / Ducati,
 * libellés de méthode, formats.
 */
import { BookOpen, CheckCircle2, CircleDashed, Database, Store, XCircle } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { scoreTone, type LinkMethod, type LinkStatus } from './links-rules';

const METHOD_KEY: Record<LinkMethod, string> = {
  ref_exacte: 'links.mRefExacte',
  prefixe_suffixe: 'links.mPrefixeSuffixe',
  revision: 'links.mRevision',
  remplacement_dms: 'links.mRemplacementDms',
  sku_exact: 'links.mSkuExact',
  code_barres: 'links.mCodeBarres',
  sku_normalise: 'links.mSkuNormalise',
  code_barres_ref: 'links.mCodeBarresRef',
  ref_dans_titre: 'links.mRefDansTitre',
  manuel: 'links.mManuel',
  occasion: 'links.mOccasion',
  sku_ambigu: 'links.mSkuAmbigu',
  creation: 'links.mCreation',
  creation_sans_sku: 'links.mCreationSansSku',
  import_g8: 'links.mImportG8',
};

export const LINK_METHODS = Object.keys(METHOD_KEY) as LinkMethod[];

export function methodLabel(m: string): string {
  const k = METHOD_KEY[m as LinkMethod];
  return k ? t(k) : m;
}

export function fill(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);
}

export function fmtEur(n: number | null | undefined): string {
  if (n == null) return '—';
  const s = (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!,))/g, ' ');
  return `${s} €`;
}

export function fmtInt(n: number | null | undefined): string {
  return n == null ? '—' : Number(n).toLocaleString('fr-BE');
}

export function LinkStatusBadge({ status }: { status: LinkStatus }) {
  if (status === 'lie') return <StatusBadge tone="success" icon={CheckCircle2} label={t('links.stLie')} />;
  if (status === 'rejete') return <StatusBadge tone="neutral" icon={XCircle} label={t('links.stRejete')} />;
  return <StatusBadge tone="warning" icon={CircleDashed} label={t('links.stAValider')} />;
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = scoreTone(score);
  const icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? CircleDashed : CircleDashed;
  return <StatusBadge tone={tone} icon={icon} label={`${score} %`} />;
}

/** Où l'article est référencé : G8 (repris de G8), Shopify (sur le site), Ducati (catalogue Ducati). */
export type SourceFlags = { g8: boolean; shopify: boolean; ducati: boolean };

export function sourceFlags(links?: { target_kind: string; status: string }[] | null): SourceFlags {
  const lie = (links ?? []).filter((l) => l.status === 'lie');
  return {
    g8: lie.some((l) => l.target_kind === 'g8'),
    shopify: lie.some((l) => l.target_kind === 'shopify_variant'),
    ducati: lie.some((l) => l.target_kind === 'ducati_part' || l.target_kind === 'ducati_product'),
  };
}

/**
 * Petits badges sobres « G8 », « Shopify », « Ducati » (charte : badge 4 px, couleur + icône + libellé,
 * infobulle), plusieurs possibles. Pas de logo de marque.
 */
export function SourceBadges({ links }: { links?: { target_kind: string; status: string }[] | null }) {
  const f = sourceFlags(links);
  if (!f.g8 && !f.shopify && !f.ducati) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {f.g8 && <span title={t('links.tipG8')}><StatusBadge tone="neutral" icon={Database} label={t('links.badgeG8')} /></span>}
      {f.shopify && <span title={t('links.tipShopify')}><StatusBadge tone="success" icon={Store} label={t('links.badgeShopify')} /></span>}
      {f.ducati && <span title={t('links.tipDucati')}><StatusBadge tone="info" icon={BookOpen} label={t('links.badgeDucati')} /></span>}
    </span>
  );
}
