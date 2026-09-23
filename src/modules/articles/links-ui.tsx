/**
 * Un seul catalogue (décision M-25) — éléments d'écran partagés : badges G8 / Shopify / Ducati,
 * libellés de méthode, formats.
 */
import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
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
 * « Référencé sur » — provenance de l'article, plusieurs sources possibles.
 *
 * Logos officiels validés par le client (23/09/2026, décision M-26) pour le
 * catalogue Ducati et le site Shopify ; G8 n'a pas de logo et garde un badge
 * texte sobre. Hauteur unique de 18 px, ratio d'origine conservé
 * (`object-contain`, jamais de logo déformé), infobulle et texte alternatif
 * explicites. Les fichiers sont servis par l'application (`public/brands/`).
 */
const LOGO_H = 18;

function BrandLogo({ src, alt, tip }: { src: string; alt: string; tip: string }) {
  return (
    <img
      src={src} alt={alt} title={tip} loading="lazy" decoding="async"
      className="w-auto shrink-0 object-contain align-middle"
      style={{ height: LOGO_H }}
    />
  );
}

/** Badge texte sobre pour G8 (pas de logo) — fond sombre, texte clair. */
function G8Badge() {
  return (
    <span
      title={t('links.tipG8')}
      className="inline-flex items-center rounded-[4px] bg-sidebar px-1.5 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-sidebar-foreground"
      style={{ height: LOGO_H }}
    >
      {t('links.badgeG8')}
    </span>
  );
}

/** Rendu à partir des drapeaux déjà calculés (liste paginée : `article_list_page`). */
export function SourceLogos({ flags }: { flags: SourceFlags }) {
  if (!flags.g8 && !flags.shopify && !flags.ducati) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {flags.ducati && <BrandLogo src="/brands/ducati.webp" alt={t('links.badgeDucati')} tip={t('links.tipDucati')} />}
      {flags.shopify && <BrandLogo src="/brands/shopify.png" alt={t('links.badgeShopify')} tip={t('links.tipShopify')} />}
      {flags.g8 && <G8Badge />}
    </span>
  );
}

/** Même rendu à partir des liens bruts (fiche article). */
export function SourceBadges({ links }: { links?: { target_kind: string; status: string }[] | null }) {
  return <SourceLogos flags={sourceFlags(links)} />;
}
