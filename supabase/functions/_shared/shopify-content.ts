// Mission 03 — Reprise unique des photos et textes Shopify dans le DMS (décision W-4).
//
// Module PUR (aucun accès réseau ni base) : partagé par la fonction serveur
// shopify-import-content, l'écran (affichage sûr du texte web) et les tests (`bun test`).
//
// 1. sanitizeShopifyHtml : garde un HTML simple et sûr (paragraphes, titres, listes, gras,
//    italique, liens http/https/mailto). Tout le reste est retiré : scripts, styles, iframes,
//    attributs (style, class, on*…), images intégrées, commentaires.
// 2. planContentImport : règle « ne jamais écraser » — le texte déjà saisi dans le DMS est gardé,
//    le texte Shopify est alors seulement noté à côté ; les images déjà reprises (clé = id
//    d'image Shopify) ne sont jamais dupliquées ; l'image principale passe en premier.

/** Balises gardées telles quelles (sans attribut, sauf href sur a). */
const KEEP = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'u', 'h2', 'h3', 'h4', 'blockquote', 'a']);
/** Balises renommées vers un équivalent simple. */
const RENAME: Record<string, string> = { b: 'strong', i: 'em', h1: 'h2', h5: 'h4', h6: 'h4', div: 'p', section: 'p', article: 'p' };
/** Balises supprimées AVEC leur contenu. */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'form', 'select', 'textarea', 'button']);
const VOID = new Set(['br']);
/** Balises de bloc : une balise de bloc ouverte ferme un paragraphe en cours. */
const BLOCK = new Set(['p', 'ul', 'ol', 'h2', 'h3', 'h4', 'blockquote']);

function escapeText(s: string): string {
  // Le texte Shopify contient déjà des entités (&amp; &nbsp; …) : on les garde ; on neutralise
  // seulement les chevrons isolés.
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeHref(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.replace(/&amp;/g, '&').trim();
  if (!/^(https?:|mailto:)/i.test(v)) return null;
  return v.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

/**
 * Nettoie le HTML d'une description Shopify. Renvoie '' si rien d'utile.
 * Résultat : balises de la liste KEEP seulement, correctement fermées, sans attribut
 * (liens : href http/https/mailto, ouverts dans un nouvel onglet, rel="noopener noreferrer nofollow").
 */
export function sanitizeShopifyHtml(input: string | null | undefined): string {
  if (!input) return '';
  let html = String(input).replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  // Retire les blocs dangereux avec leur contenu.
  for (const tag of DROP_WITH_CONTENT) {
    html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>`, 'gi'), '');
  }

  const out: string[] = [];
  const stack: string[] = [];
  const close = (tag: string) => {
    const idx = stack.lastIndexOf(tag);
    if (idx < 0) return;
    while (stack.length > idx) out.push(`</${stack.pop()}>`);
  };

  const re = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|<|>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) out.push(escapeText(html.slice(last, m.index)));
    last = re.lastIndex;
    if (!m[2]) { out.push(m[0] === '<' ? '&lt;' : '&gt;'); continue; }
    const closing = m[1] === '/';
    const raw = m[2].toLowerCase();
    const tag = RENAME[raw] ?? raw;
    if (!KEEP.has(tag)) {
      // Balise inconnue (span, font, img, table…) : on garde le texte, pas la balise.
      // Une fin de cellule / ligne de tableau devient un espace pour ne pas coller les mots.
      if (/^(td|th|tr|table|tbody|thead)$/.test(raw)) out.push(' ');
      continue;
    }
    if (closing) { close(tag); continue; }
    if (VOID.has(tag)) { out.push('<br>'); continue; }
    if (BLOCK.has(tag) && stack.includes('p')) close('p');
    if (tag === 'li' && stack[stack.length - 1] === 'li') close('li');
    if (tag === 'a') {
      const href = safeHref(attr(m[3] ?? '', 'href'));
      if (!href) continue;               // lien sans adresse sûre : texte seul
      out.push(`<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">`);
      stack.push('a');
      continue;
    }
    out.push(`<${tag}>`);
    stack.push(tag);
  }
  if (last < html.length) out.push(escapeText(html.slice(last)));
  while (stack.length) out.push(`</${stack.pop()}>`);

  let res = out.join('')
    // Balises vides (y compris ne contenant que des espaces / &nbsp; / <br>) : retirées.
    .replace(/<(p|h2|h3|h4|li|strong|em|u|blockquote)>(?:\s|&nbsp;|<br>)*<\/\1>/gi, '')
    .replace(/<(ul|ol)>\s*<\/\1>/gi, '')
    .replace(/(<br>\s*){3,}/gi, '<br><br>')
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/\s*(<\/?(?:p|ul|ol|li|h2|h3|h4|blockquote)>)\s*/gi, '$1')
    .trim();
  // Deuxième passe pour les conteneurs devenus vides.
  res = res.replace(/<(p|li|ul|ol)>\s*<\/\1>/gi, '');
  return htmlToText(res) === '' ? '' : res;
}

/** Texte brut d'un HTML simple (comparaisons, aperçus, « le texte est-il vide ? »). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|li|h2|h3|h4|blockquote)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export type ShopifyImage = { media_id: string; url: string; alt: string | null };

export type ArticleContentState = {
  web_title: string | null;
  web_description: string | null;
  /** Ids d'images Shopify déjà reprises pour cet article (attachments.external_id). */
  imported_media_ids: string[];
  /** Nombre de photos déjà présentes dans la fiche (toutes origines). */
  existing_photo_count: number;
};

export type ShopifyContent = {
  title: string | null;
  description_html: string | null;
  featured_media_id: string | null;
  images: ShopifyImage[];
};

export type ContentPlan = {
  /** Valeur à écrire dans articles.web_title, ou null = ne pas toucher. */
  set_web_title: string | null;
  /** Valeur à écrire dans articles.web_description, ou null = ne pas toucher. */
  set_web_description: string | null;
  /** Texte Shopify NON appliqué parce que la fiche a déjà son texte : noté à côté. */
  kept_dms_title: boolean;
  kept_dms_description: boolean;
  shopify_title: string | null;
  shopify_description: string;
  /** Images à télécharger et ajouter, dans l'ordre (principale d'abord), avec leur rang. */
  images_to_add: (ShopifyImage & { position: number; alt_text: string })[];
  images_already: number;
};

const blank = (s: string | null | undefined) => (s ?? '').trim() === '';

/** Images dans l'ordre Shopify, image principale en premier, sans doublon d'id. */
export function orderImages(images: ShopifyImage[], featuredId: string | null): ShopifyImage[] {
  const seen = new Set<string>();
  const uniq = images.filter((im) => im.media_id && im.url && !seen.has(im.media_id) && seen.add(im.media_id));
  const i = featuredId ? uniq.findIndex((im) => im.media_id === featuredId) : -1;
  if (i > 0) uniq.unshift(...uniq.splice(i, 1));
  return uniq;
}

/**
 * Règle « ne jamais écraser » (W-4) :
 * - titre web / description web : écrits seulement s'ils sont vides dans le DMS ; sinon le texte
 *   DMS est gardé et le texte Shopify est noté à côté (kept_dms_* = true) ;
 * - images : ajoutées seulement si leur id Shopify n'est pas déjà repris ; jamais de suppression ;
 *   rang = position Shopify (principale = 0), après les photos déjà présentes dans la fiche.
 */
export function planContentImport(article: ArticleContentState, shop: ShopifyContent, fallbackAlt = ''): ContentPlan {
  const title = (shop.title ?? '').trim() || null;
  const desc = sanitizeShopifyHtml(shop.description_html);
  const ordered = orderImages(shop.images, shop.featured_media_id);
  const already = new Set(article.imported_media_ids);
  const base = Math.max(0, article.existing_photo_count - article.imported_media_ids.length);
  const images_to_add = ordered
    .map((im, idx) => ({ ...im, position: base + idx, alt_text: (im.alt ?? '').trim() || title || fallbackAlt }))
    .filter((im) => !already.has(im.media_id));
  return {
    set_web_title: title && blank(article.web_title) ? title : null,
    set_web_description: desc && blank(htmlToText(article.web_description)) ? desc : null,
    kept_dms_title: !!title && !blank(article.web_title) && article.web_title!.trim() !== title,
    kept_dms_description: !!desc && !blank(htmlToText(article.web_description)) && article.web_description!.trim() !== desc,
    shopify_title: title,
    shopify_description: desc,
    images_to_add,
    images_already: ordered.length - images_to_add.length,
  };
}

/** Nom de fichier stable pour une image Shopify (même id → même chemin : relancer ne duplique rien). */
export function imageFileName(mediaId: string, url: string, contentType: string | null): string {
  const num = (mediaId.match(/(\d+)\s*$/)?.[1]) ?? mediaId.replace(/[^\w]+/g, '_').slice(-40);
  const fromType = contentType?.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg');
  const fromUrl = url.split('?')[0].match(/\.([a-z0-9]{3,4})$/i)?.[1]?.toLowerCase();
  const ext = (fromType && /^[a-z0-9]{2,5}$/.test(fromType) ? fromType : fromUrl) ?? 'jpg';
  return `shopify_${num}.${ext}`;
}
