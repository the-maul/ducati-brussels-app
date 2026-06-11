/**
 * M11 — Modèle de site e-shop : multi-pages + blocs riches (type Strikingly).
 * Le même contenu est rendu par l'éditeur (aperçu) et la vitrine publique (WYSIWYG).
 */
export type Theme = { primary: string; bg: string; text: string };
export type Feature = { icon: string; title: string; text: string };
export type Faq = { q: string; a: string };

export type Block =
  | { id: string; type: 'hero'; title: string; subtitle: string; bg: string; color: string; image?: string }
  | { id: string; type: 'banner'; text: string; bg: string; color: string }
  | { id: string; type: 'text'; heading: string; body: string }
  | { id: string; type: 'image'; url: string; caption: string }
  | { id: string; type: 'gallery'; heading: string; images: string[] }
  | { id: string; type: 'features'; heading: string; items: Feature[] }
  | { id: string; type: 'cta'; text: string; buttonLabel: string; url: string; bg: string; color: string }
  | { id: string; type: 'video'; heading: string; url: string }
  | { id: string; type: 'map'; heading: string; address: string }
  | { id: string; type: 'faq'; heading: string; items: Faq[] }
  | { id: string; type: 'hours'; heading: string; lines: string[] }
  | { id: string; type: 'products'; heading: string }
  | { id: string; type: 'contact'; heading: string; phone: string; email: string; address: string }
  | { id: string; type: 'divider' };

export type BlockType = Block['type'];
export type Page = { id: string; slug: string; title: string; blocks: Block[] };
export type SiteContent = { theme: Theme; pages: Page[] };

let _k = 0;
export const uid = (p = 'b') => `${p}${Date.now().toString(36)}${_k++}`;

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: 'Bannière d\'accueil', banner: 'Bandeau', text: 'Texte', image: 'Image', gallery: 'Galerie',
  features: 'Colonnes / atouts', cta: 'Bouton d\'action', video: 'Vidéo', map: 'Carte', faq: 'FAQ',
  hours: 'Horaires', products: 'Produits', contact: 'Contact', divider: 'Séparateur',
};
// Ordre proposé dans le menu « Ajouter un bloc »
export const BLOCK_ORDER: BlockType[] = ['hero', 'banner', 'text', 'image', 'gallery', 'features', 'cta', 'video', 'map', 'faq', 'hours', 'products', 'contact', 'divider'];

export function makeBlock(type: BlockType, theme: Theme): Block {
  const id = uid();
  switch (type) {
    case 'hero': return { id, type, title: 'Bienvenue', subtitle: 'Votre concession Ducati', bg: theme.primary, color: '#ffffff' };
    case 'banner': return { id, type, text: 'Livraison rapide · Pièces d\'origine', bg: '#111111', color: '#ffffff' };
    case 'text': return { id, type, heading: 'À propos', body: 'Présentez votre boutique ici.' };
    case 'image': return { id, type, url: '', caption: '' };
    case 'gallery': return { id, type, heading: 'Galerie', images: [] };
    case 'features': return { id, type, heading: 'Nos atouts', items: [{ icon: '🏍️', title: 'Atelier expert', text: 'Mécaniciens certifiés Ducati.' }, { icon: '🚚', title: 'Livraison', text: 'Partout en Belgique.' }, { icon: '🛡️', title: 'Garantie', text: 'Pièces d\'origine garanties.' }] };
    case 'cta': return { id, type, text: 'Prenez rendez-vous', buttonLabel: 'Nous contacter', url: '#contact', bg: theme.primary, color: '#ffffff' };
    case 'video': return { id, type, heading: '', url: '' };
    case 'map': return { id, type, heading: 'Nous trouver', address: '' };
    case 'faq': return { id, type, heading: 'Questions fréquentes', items: [{ q: 'Quels sont vos horaires ?', a: 'Du mardi au samedi.' }] };
    case 'hours': return { id, type, heading: 'Horaires', lines: ['Mar–Ven : 9h–18h', 'Sam : 10h–17h'] };
    case 'products': return { id, type, heading: 'Nos produits' };
    case 'contact': return { id, type, heading: 'Nous contacter', phone: '', email: '', address: '' };
    case 'divider': return { id, type };
  }
}

export const DEFAULT_THEME: Theme = { primary: '#cc0000', bg: '#ffffff', text: '#1a1a1a' };
export function defaultSite(): SiteContent {
  return {
    theme: { ...DEFAULT_THEME },
    pages: [{
      id: uid('p'), slug: 'accueil', title: 'Accueil',
      blocks: [makeBlock('hero', DEFAULT_THEME), makeBlock('features', DEFAULT_THEME), makeBlock('products', DEFAULT_THEME), makeBlock('contact', DEFAULT_THEME)],
    }],
  };
}

/** Lit un contenu et migre les anciennes versions (blocs simples → page Accueil). */
export function parseSite(content: unknown): SiteContent {
  const c = (content && typeof content === 'object' ? content : {}) as Record<string, unknown>;
  const theme = { ...DEFAULT_THEME, ...((c.theme as Theme) ?? {}) };
  if (Array.isArray(c.pages) && c.pages.length > 0) return { theme, pages: c.pages as Page[] };
  if (Array.isArray(c.blocks) && (c.blocks as Block[]).length > 0) {
    return { theme, pages: [{ id: uid('p'), slug: 'accueil', title: 'Accueil', blocks: c.blocks as Block[] }] };
  }
  return defaultSite();
}
