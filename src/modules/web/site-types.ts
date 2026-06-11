/**
 * M11 — Modèle de site e-shop (blocs éditables + thème). Le même contenu est rendu
 * par l'éditeur (aperçu) et par la vitrine publique (WYSIWYG).
 */
export type Theme = { primary: string; bg: string; text: string };

export type Block =
  | { id: string; type: 'hero'; title: string; subtitle: string; bg: string; color: string }
  | { id: string; type: 'banner'; text: string; bg: string; color: string }
  | { id: string; type: 'text'; heading: string; body: string }
  | { id: string; type: 'products'; heading: string }
  | { id: string; type: 'contact'; heading: string; phone: string; email: string; address: string };

export type BlockType = Block['type'];
export type SiteContent = { theme: Theme; blocks: Block[] };

let _k = 0;
export const newBlockId = () => `b${Date.now().toString(36)}${_k++}`;

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: 'Bannière d\'accueil', banner: 'Bandeau', text: 'Texte', products: 'Produits', contact: 'Contact',
};

export function makeBlock(type: BlockType, theme: Theme): Block {
  const id = newBlockId();
  switch (type) {
    case 'hero': return { id, type, title: 'Bienvenue', subtitle: 'Votre concession Ducati', bg: theme.primary, color: '#ffffff' };
    case 'banner': return { id, type, text: 'Livraison rapide · Pièces d\'origine', bg: '#111111', color: '#ffffff' };
    case 'text': return { id, type, heading: 'À propos', body: 'Présentez votre boutique ici.' };
    case 'products': return { id, type, heading: 'Nos produits' };
    case 'contact': return { id, type, heading: 'Nous contacter', phone: '', email: '', address: '' };
  }
}

export const DEFAULT_SITE: SiteContent = {
  theme: { primary: '#cc0000', bg: '#ffffff', text: '#1a1a1a' },
  blocks: [
    { id: newBlockId(), type: 'hero', title: 'Ducati Bruxelles', subtitle: 'Motos, pièces & accessoires', bg: '#cc0000', color: '#ffffff' },
    { id: newBlockId(), type: 'products', heading: 'Nos produits' },
    { id: newBlockId(), type: 'contact', heading: 'Nous contacter', phone: '', email: '', address: '' },
  ],
};

export function parseSite(content: unknown): SiteContent {
  const c = (content && typeof content === 'object' ? content : {}) as Partial<SiteContent>;
  if (!c.blocks || !Array.isArray(c.blocks) || c.blocks.length === 0) return DEFAULT_SITE;
  return { theme: { ...DEFAULT_SITE.theme, ...(c.theme ?? {}) }, blocks: c.blocks as Block[] };
}
