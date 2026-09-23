/**
 * M2 — Vignette d'un article (liste, fiche, rapprochements).
 *
 * Les URL sont EXTERNES (e-catalog.ducati.com, cdn.shopify.com) : rien n'est
 * téléchargé ni recopié. Si l'image ne se charge pas (lien mort, hors ligne),
 * on retombe sur l'emplacement vide sobre plutôt que sur une icône cassée.
 *
 * Ordre de préférence décidé côté base (décision M-27, fonction
 * `_article_thumbnail`) : photo Ducati du produit > photo du site > vue
 * éclatée > rien.
 */
import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { ImageSource } from './list-api';

const SOURCE_KEY: Record<ImageSource, string> = {
  ducati_product: 'articles.imgFromDucati',
  shopify: 'articles.imgFromShopify',
  ducati_drawing: 'articles.imgFromDrawing',
};

export function imageSourceLabel(src: ImageSource | null | undefined): string {
  return src ? t(SOURCE_KEY[src]) : t('articles.imgNone');
}

/** Emplacement vide : même encombrement que la vignette, sans bruit visuel. */
function Empty({ size, title }: { size: number; title: string }) {
  return (
    <span
      title={title}
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-[4px] border border-border bg-muted text-muted-foreground"
      style={{ width: size, height: size }}
    >
      <ImageOff style={{ width: Math.round(size / 2.5), height: Math.round(size / 2.5) }} />
    </span>
  );
}

export function ArticleThumb({ url, source, alt, size = 40 }: {
  url: string | null | undefined;
  source?: ImageSource | null;
  /** Texte alternatif = désignation de l'article. */
  alt: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  // Nouvelle ligne réutilisant le même composant (pagination) : on réarme l'image.
  useEffect(() => { setBroken(false); }, [url]);

  if (!url || broken) return <Empty size={size} title={t('articles.imgNone')} />;
  return (
    <img
      src={url}
      alt={alt}
      title={imageSourceLabel(source)}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="shrink-0 rounded-[4px] border border-border bg-card object-contain"
      style={{ width: size, height: size }}
    />
  );
}
