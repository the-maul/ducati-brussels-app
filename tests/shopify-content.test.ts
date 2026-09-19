/**
 * Mission 03 — reprise unique des photos et textes Shopify (décision W-4) :
 * nettoyage du HTML Shopify et règle « ne jamais écraser » un texte ou une photo du DMS.
 * Exécution : `bun test`.
 */
import { describe, expect, test } from 'bun:test';
import {
  sanitizeShopifyHtml, htmlToText, planContentImport, orderImages, imageFileName,
  type ArticleContentState, type ShopifyContent,
} from '../supabase/functions/_shared/shopify-content';

describe('sanitizeShopifyHtml', () => {
  test('garde un HTML simple (paragraphes, listes, gras, italique)', () => {
    const html = '<p>Rétroviseur <strong>homologué</strong> <em>CE</em></p><ul><li>Aluminium</li><li>Noir</li></ul>';
    expect(sanitizeShopifyHtml(html)).toBe(html);
  });

  test('retire scripts, styles, iframes avec leur contenu', () => {
    const out = sanitizeShopifyHtml('<p>OK</p><script>alert(1)</script><style>p{color:red}</style><iframe src="https://x"></iframe>');
    expect(out).toBe('<p>OK</p>');
  });

  test('retire tous les attributs (style, class, on*) et les images intégrées', () => {
    const out = sanitizeShopifyHtml('<p style="color:red" class="x" onclick="evil()">Texte<img src="x" onerror="evil()"></p>');
    expect(out).toBe('<p>Texte</p>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('style');
  });

  test('convertit b/i/h1/div et déballe span/font', () => {
    const out = sanitizeShopifyHtml('<h1>Titre</h1><div><b>Gras</b> <i>ital</i> <span style="x">normal</span> <font color="red">rouge</font></div>');
    expect(out).toBe('<h2>Titre</h2><p><strong>Gras</strong> <em>ital</em> normal rouge</p>');
  });

  test('liens : seulement http/https/mailto, ouverts à part', () => {
    expect(sanitizeShopifyHtml('<a href="javascript:alert(1)">clic</a>')).toBe('clic');
    expect(sanitizeShopifyHtml('<a href="https://ducati.com/fr" title="x">site</a>'))
      .toBe('<a href="https://ducati.com/fr" target="_blank" rel="noopener noreferrer nofollow">site</a>');
  });

  test('ferme les balises oubliées et ignore les fermetures orphelines', () => {
    expect(sanitizeShopifyHtml('<p>Un <strong>deux')).toBe('<p>Un <strong>deux</strong></p>');
    expect(sanitizeShopifyHtml('trois</em></p>')).toBe('trois');
  });

  test('retire les paragraphes vides et les commentaires ; vide → chaîne vide', () => {
    expect(sanitizeShopifyHtml('<p>&nbsp;</p><!-- note --><p>Texte</p><p> <br> </p>')).toBe('<p>Texte</p>');
    expect(sanitizeShopifyHtml('<p> </p><div></div>')).toBe('');
    expect(sanitizeShopifyHtml(null)).toBe('');
  });

  test('neutralise les chevrons isolés, garde les entités', () => {
    expect(sanitizeShopifyHtml('<p>5 < 6 &amp; 7 > 3</p>')).toBe('<p>5 &lt; 6 &amp; 7 &gt; 3</p>');
  });

  test('htmlToText donne le texte brut', () => {
    expect(htmlToText('<p>Un&nbsp;<strong>deux</strong></p><ul><li>trois</li></ul>')).toBe('Un deux trois');
  });
});

const IMG = (n: number, alt: string | null = null) => ({ media_id: `gid://shopify/MediaImage/${n}`, url: `https://cdn.shopify.com/${n}.jpg`, alt });
const EMPTY: ArticleContentState = { web_title: null, web_description: null, imported_media_ids: [], existing_photo_count: 0 };
const SHOP: ShopifyContent = {
  title: 'Rétroviseur Scrambler',
  description_html: '<p>Rétroviseur <b>aluminium</b></p><script>x</script>',
  featured_media_id: 'gid://shopify/MediaImage/2',
  images: [IMG(1, 'Vue de côté'), IMG(2), IMG(3)],
};

describe('planContentImport — ne jamais écraser', () => {
  test('fiche vide : titre, description nettoyée et toutes les images, principale en premier', () => {
    const p = planContentImport(EMPTY, SHOP, 'REF');
    expect(p.set_web_title).toBe('Rétroviseur Scrambler');
    expect(p.set_web_description).toBe('<p>Rétroviseur <strong>aluminium</strong></p>');
    expect(p.kept_dms_title).toBe(false);
    expect(p.kept_dms_description).toBe(false);
    expect(p.images_to_add.map((i) => i.media_id)).toEqual([
      'gid://shopify/MediaImage/2', 'gid://shopify/MediaImage/1', 'gid://shopify/MediaImage/3',
    ]);
    expect(p.images_to_add.map((i) => i.position)).toEqual([0, 1, 2]);
    // texte alternatif : celui de Shopify, sinon le titre du produit
    expect(p.images_to_add[0].alt_text).toBe('Rétroviseur Scrambler');
    expect(p.images_to_add[1].alt_text).toBe('Vue de côté');
  });

  test('texte déjà saisi dans le DMS : gardé, le texte Shopify est seulement noté à côté', () => {
    const p = planContentImport({ ...EMPTY, web_title: 'Titre DMS', web_description: '<p>Texte DMS</p>' }, SHOP);
    expect(p.set_web_title).toBeNull();
    expect(p.set_web_description).toBeNull();
    expect(p.kept_dms_title).toBe(true);
    expect(p.kept_dms_description).toBe(true);
    expect(p.shopify_description).toBe('<p>Rétroviseur <strong>aluminium</strong></p>');
  });

  test('description DMS vide en apparence (<p>&nbsp;</p>) : considérée vide, remplie', () => {
    const p = planContentImport({ ...EMPTY, web_description: '<p>&nbsp;</p>' }, SHOP);
    expect(p.set_web_description).toBe('<p>Rétroviseur <strong>aluminium</strong></p>');
  });

  test('photos déjà présentes : on ajoute seulement les images manquantes, après les photos du DMS', () => {
    const p = planContentImport({ ...EMPTY, existing_photo_count: 3, imported_media_ids: ['gid://shopify/MediaImage/2'] }, SHOP);
    expect(p.images_to_add.map((i) => i.media_id)).toEqual(['gid://shopify/MediaImage/1', 'gid://shopify/MediaImage/3']);
    expect(p.images_already).toBe(1);
    // 2 photos DMS (3 − 1 déjà reprise) : les images Shopify gardent leur ordre derrière
    expect(p.images_to_add.map((i) => i.position)).toEqual([3, 4]);
  });

  test('relance : tout est déjà repris → rien à écrire, rien à ajouter', () => {
    const done: ArticleContentState = {
      web_title: 'Rétroviseur Scrambler', web_description: '<p>Rétroviseur <strong>aluminium</strong></p>',
      imported_media_ids: SHOP.images.map((i) => i.media_id), existing_photo_count: 3,
    };
    const p = planContentImport(done, SHOP);
    expect(p.set_web_title).toBeNull();
    expect(p.set_web_description).toBeNull();
    expect(p.kept_dms_title).toBe(false);
    expect(p.kept_dms_description).toBe(false);
    expect(p.images_to_add).toHaveLength(0);
    expect(p.images_already).toBe(3);
  });

  test('produit Shopify sans description : la fiche n\'est pas touchée', () => {
    const p = planContentImport(EMPTY, { ...SHOP, description_html: '<p> </p>' });
    expect(p.set_web_description).toBeNull();
    expect(p.kept_dms_description).toBe(false);
  });
});

describe('orderImages / imageFileName', () => {
  test('supprime les doublons d\'id et place la principale en tête', () => {
    expect(orderImages([IMG(1), IMG(2), IMG(1)], 'gid://shopify/MediaImage/2').map((i) => i.media_id))
      .toEqual(['gid://shopify/MediaImage/2', 'gid://shopify/MediaImage/1']);
  });
  test('nom de fichier stable (même image → même chemin)', () => {
    expect(imageFileName('gid://shopify/MediaImage/123', 'https://cdn.shopify.com/a.png?v=1', 'image/png')).toBe('shopify_123.png');
    expect(imageFileName('gid://shopify/MediaImage/123', 'https://cdn.shopify.com/a.JPG?v=1', null)).toBe('shopify_123.jpg');
    expect(imageFileName('gid://shopify/MediaImage/9', 'https://cdn.shopify.com/a', 'image/jpeg')).toBe('shopify_9.jpg');
  });
});
