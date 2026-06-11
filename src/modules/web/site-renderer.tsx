/**
 * M11 — Rendu d'un site e-shop (blocs). Utilisé par l'aperçu de l'éditeur ET par la
 * vitrine publique. Styles inline (fonctionne hors app, sans dépendances).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { SiteContent, Block } from './site-types';

export type ShopProduct = { article_id: string; reference: string; designation: string; price_ttc: number; available: number; image_path: string | null };
const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

export function SiteRenderer({ content, products, onAdd, preview }: {
  content: SiteContent; products: ShopProduct[]; onAdd?: (p: ShopProduct) => void; preview?: boolean;
}) {
  const { theme, blocks } = content;
  return (
    <div style={{ background: theme.bg, color: theme.text, fontFamily: 'Arial, sans-serif', minHeight: preview ? 'auto' : '100vh' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        {blocks.map((b) => <BlockView key={b.id} block={b} theme={theme} products={products} onAdd={onAdd} />)}
      </div>
    </div>
  );
}

function BlockView({ block, theme, products, onAdd }: { block: Block; theme: SiteContent['theme']; products: ShopProduct[]; onAdd?: (p: ShopProduct) => void }) {
  switch (block.type) {
    case 'hero':
      return (
        <section style={{ background: block.bg, color: block.color, padding: '56px 24px', textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 36 }}>{block.title}</h1>
          {block.subtitle && <p style={{ fontSize: 18, marginTop: 10, opacity: 0.95 }}>{block.subtitle}</p>}
        </section>
      );
    case 'banner':
      return <div style={{ background: block.bg, color: block.color, padding: '10px 24px', textAlign: 'center', fontSize: 14 }}>{block.text}</div>;
    case 'text':
      return (
        <section style={{ padding: '32px 24px' }}>
          {block.heading && <h2 style={{ fontSize: 22, marginTop: 0 }}>{block.heading}</h2>}
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: '#444' }}>{block.body}</p>
        </section>
      );
    case 'products':
      return (
        <section style={{ padding: '32px 24px' }}>
          {block.heading && <h2 style={{ fontSize: 22, marginTop: 0 }}>{block.heading}</h2>}
          {products.length === 0 ? <p style={{ color: '#999' }}>Aucun produit publié.</p> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
              {products.map((p) => (
                <div key={p.article_id} style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <ProductImage path={p.image_path} />
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <span style={{ fontSize: 11, color: '#999', fontFamily: 'monospace' }}>{p.reference}</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{p.designation}</span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <b>{eur(p.price_ttc)}</b>
                      <span style={{ fontSize: 12, color: p.available > 0 ? '#0a0' : '#c00' }}>{p.available > 0 ? 'En stock' : 'Rupture'}</span>
                    </div>
                    {onAdd && <button onClick={() => onAdd(p)} disabled={p.available <= 0} style={{ marginTop: 8, background: theme.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 0', cursor: 'pointer', opacity: p.available <= 0 ? 0.5 : 1 }}>Ajouter au panier</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      );
    case 'contact':
      return (
        <section style={{ padding: '32px 24px', borderTop: '1px solid #eee' }}>
          {block.heading && <h2 style={{ fontSize: 22, marginTop: 0 }}>{block.heading}</h2>}
          <div style={{ color: '#444', lineHeight: 1.8 }}>
            {block.address && <div>📍 {block.address}</div>}
            {block.phone && <div>📞 {block.phone}</div>}
            {block.email && <div>✉️ {block.email}</div>}
          </div>
        </section>
      );
  }
}

function ProductImage({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    if (path) supabase.storage.from('ged').createSignedUrl(path, 3600).then(({ data }) => { if (on) setUrl(data?.signedUrl ?? null); }).catch(() => {});
    return () => { on = false; };
  }, [path]);
  return (
    <div style={{ aspectRatio: '1', background: '#f4f4f4', display: 'grid', placeItems: 'center' }}>
      {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#ccc', fontSize: 12 }}>—</span>}
    </div>
  );
}
