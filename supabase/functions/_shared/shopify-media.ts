// Mission 03 — Copie d'une image du CDN Shopify vers le Storage du DMS (bucket prive « ged »).
// Meme chemin a chaque relance ({societe}/article/{article}/shopify_{id}.{ext}) : rien n'est duplique.
// Meme logique que dans shopify-import-content/index.ts ; partagee ici pour la bascule d'une
// reference remplacee (shopify-publish, action « switch »), qui reprend le contenu du produit de
// l'ancienne reference dans la fiche de la nouvelle.
// deno-lint-ignore-file
import { imageFileName, type ShopifyImage } from './shopify-content.ts';

const BUCKET = 'ged';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type CopiedImage = { storage_path: string; file_name: string; content_type: string; size_bytes: number };

/** Images d'un produit lu par PRODUCT_CONTENT_QUERY (shopify-switch.ts). */
export function imagesOfProduct(p: { media?: { nodes?: any[] } } | null | undefined): ShopifyImage[] {
  return (p?.media?.nodes ?? [])
    .filter((m: any) => m?.mediaContentType === 'IMAGE' && m?.image?.url)
    .map((m: any) => ({ media_id: String(m.id), url: String(m.image.url), alt: (m.alt ?? m.image.altText ?? null) || null }));
}

export async function copyShopifyImage(
  sbUrl: string, serviceKey: string, companyId: string, articleId: string, im: { media_id: string; url: string },
): Promise<CopiedImage> {
  let resp: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    resp = await fetch(im.url, { signal: AbortSignal.timeout(20_000) });
    if (resp.ok) break;
    if (resp.status < 500 && resp.status !== 429) break;
    await sleep(1000 * (attempt + 1));
  }
  if (!resp || !resp.ok) throw new Error(`download ${resp?.status ?? 'ko'}`);
  const contentType = (resp.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
  if (!contentType.startsWith('image/')) throw new Error(`not_image ${contentType}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`size ${bytes.byteLength}`);
  const fileName = imageFileName(im.media_id, im.url, contentType);
  const path = `${companyId}/article/${articleId}/${fileName}`;
  const up = await fetch(`${sbUrl}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 120)}`);
  return { storage_path: path, file_name: fileName, content_type: contentType, size_bytes: bytes.byteLength };
}

/** Lance `fn` sur chaque element, au plus `n` a la fois ; chaque resultat ou erreur est garde a sa place. */
export async function inPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const res: PromiseSettledResult<R>[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { res[k] = { status: 'fulfilled', value: await fn(items[k]) }; } catch (e) { res[k] = { status: 'rejected', reason: e }; }
    }
  }));
  return res;
}
