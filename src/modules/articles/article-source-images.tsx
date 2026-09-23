/**
 * M2 — Fiche article : les images de l'article venues des catalogues.
 *
 * Une image en grand + une galerie quand plusieurs sources en ont une
 * (photo Ducati du produit, photo du site, vue éclatée). Les photos prises
 * par le magasin restent dans la carte « Photos » juste en dessous : elles
 * vivent dans la GED du DMS, ces images-ci sont des liens externes
 * (e-catalog.ducati.com, cdn.shopify.com) et rien n'est téléchargé.
 *
 * Ordre de préférence : le même qu'en liste (décision M-27).
 */
import { useEffect, useMemo, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { t } from '@/lib/i18n';
import { imageSourceLabel } from './article-thumb';
import type { ImageSource } from './list-api';
import { listArticleLinks, type ArticleLink, type DucatiPartInfo, type DucatiProductInfo, type ShopifyVariantInfo } from './links-api';
import { useQuery } from '@tanstack/react-query';

type SourceImage = { url: string; source: ImageSource; alt: string };

/** Les images disponibles, dans l'ordre de préférence. */
export function sourceImages(links: ArticleLink[] | undefined, designation: string): SourceImage[] {
  const lie = (links ?? []).filter((l) => l.status === 'lie');
  const out: SourceImage[] = [];
  const push = (url: string | null | undefined, source: ImageSource) => {
    if (url && !out.some((o) => o.url === url)) out.push({ url, source, alt: designation });
  };
  for (const l of lie.filter((l) => l.target_kind === 'ducati_product')) {
    push((l.info as DucatiProductInfo | null)?.image_url, 'ducati_product');
  }
  for (const l of lie.filter((l) => l.target_kind === 'shopify_variant')) {
    push((l.info as ShopifyVariantInfo | null)?.image_url, 'shopify');
  }
  for (const l of lie.filter((l) => l.target_kind === 'ducati_part')) {
    const d = (l.info as DucatiPartInfo | null)?.drawing;
    push(d?.image_url ?? d?.thumbnail_url, 'ducati_drawing');
  }
  return out;
}

const card = 'rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]';

export function ArticleSourceImages({ companyId, articleId, designation }: {
  companyId: string; articleId: string; designation: string;
}) {
  const q = useQuery({
    queryKey: ['article-links', 'article', companyId, articleId],
    queryFn: () => listArticleLinks(companyId, articleId),
    retry: false,
  });
  const images = useMemo(() => sourceImages(q.data, designation), [q.data, designation]);
  const [current, setCurrent] = useState(0);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  useEffect(() => { setCurrent(0); }, [articleId]);

  // Rien à montrer (article sans lien, ou base pas à jour) : la carte disparaît
  // plutôt que d'occuper la page avec un cadre vide.
  if (!images.length) return null;
  const shown = images[Math.min(current, images.length - 1)];

  return (
    <div className={`${card} mb-4`}>
      <h2 className="font-ui text-[15px] font-bold">{t('articles.sourceImagesTitle')}</h2>
      <div className="mt-2 flex flex-wrap items-start gap-4">
        {broken[shown.url] ? (
          <span className="grid size-56 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
            <ImageOff className="size-6" />
          </span>
        ) : (
          <img
            src={shown.url}
            alt={shown.alt}
            title={imageSourceLabel(shown.source)}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setBroken((b) => ({ ...b, [shown.url]: true }))}
            className="size-56 rounded-md border border-border bg-background object-contain"
          />
        )}
        <div className="space-y-2">
          <p className="text-[13px] text-muted-foreground">{imageSourceLabel(shown.source)}</p>
          {images.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {images.map((im, i) => (
                <button
                  key={im.url}
                  type="button"
                  onClick={() => setCurrent(i)}
                  title={imageSourceLabel(im.source)}
                  aria-label={imageSourceLabel(im.source)}
                  aria-current={i === current}
                  className={`rounded-[4px] border p-0.5 ${i === current ? 'border-primary' : 'border-border'}`}
                >
                  {broken[im.url]
                    ? <span className="grid size-12 place-items-center text-muted-foreground"><ImageOff className="size-4" /></span>
                    : <img
                        src={im.url} alt={im.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer"
                        onError={() => setBroken((b) => ({ ...b, [im.url]: true }))}
                        className="size-12 object-contain"
                      />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
