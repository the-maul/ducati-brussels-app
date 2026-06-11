/**
 * M11 — Rendu d'un site e-shop multi-pages (blocs). Utilisé par l'aperçu de l'éditeur
 * ET par la vitrine publique. Styles inline (fonctionne hors app, sans dépendances).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { SiteContent, Block, Theme } from './site-types';

export type ShopProduct = { article_id: string; reference: string; designation: string; price_ttc: number; available: number; image_path: string | null };
const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

function embedUrl(url: string): string {
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vi = url.match(/vimeo\.com\/(\d+)/);
  if (vi) return `https://player.vimeo.com/video/${vi[1]}`;
  return url;
}

export function SiteRenderer({ content, products, onAdd, preview, siteName, pageSlug, onNavigate }: {
  content: SiteContent; products: ShopProduct[]; onAdd?: (p: ShopProduct) => void; preview?: boolean;
  siteName?: string; pageSlug?: string; onNavigate?: (slug: string) => void;
}) {
  const { theme, pages } = content;
  const page = pages.find((p) => p.slug === pageSlug) ?? pages[0];
  return (
    <div style={{ background: theme.bg, color: theme.text, fontFamily: 'Arial, sans-serif', minHeight: preview ? 'auto' : '100vh' }}>
      {/* En-tête / navigation multi-pages */}
      {(siteName || pages.length > 1) && (
        <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', borderBottom: `2px solid ${theme.primary}`, maxWidth: 1000, margin: '0 auto', flexWrap: 'wrap' }}>
          {siteName && <strong style={{ fontSize: 18 }}>{siteName}</strong>}
          <nav style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>
            {pages.map((p) => (
              <a key={p.id} onClick={(e) => { e.preventDefault(); onNavigate?.(p.slug); }} href={`#${p.slug}`}
                style={{ cursor: 'pointer', textDecoration: 'none', color: p.slug === page.slug ? theme.primary : theme.text, fontWeight: p.slug === page.slug ? 700 : 400, fontSize: 14 }}>
                {p.title}
              </a>
            ))}
          </nav>
        </header>
      )}
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        {page.blocks.map((b) => <BlockView key={b.id} block={b} theme={theme} products={products} onAdd={onAdd} />)}
      </div>
    </div>
  );
}

function BlockView({ block, theme, products, onAdd }: { block: Block; theme: Theme; products: ShopProduct[]; onAdd?: (p: ShopProduct) => void }) {
  switch (block.type) {
    case 'hero':
      return (
        <section style={{ background: block.image ? `linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)), url(${block.image}) center/cover` : block.bg, color: block.color, padding: '64px 24px', textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 38 }}>{block.title}</h1>
          {block.subtitle && <p style={{ fontSize: 18, marginTop: 10, opacity: 0.95 }}>{block.subtitle}</p>}
        </section>
      );
    case 'banner':
      return <div style={{ background: block.bg, color: block.color, padding: '10px 24px', textAlign: 'center', fontSize: 14 }}>{block.text}</div>;
    case 'text':
      return <section style={{ padding: '32px 24px' }}>{block.heading && <h2 style={hh}>{block.heading}</h2>}<p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: '#444' }}>{block.body}</p></section>;
    case 'image':
      return <section style={{ padding: '24px' }}>{block.url ? <img src={block.url} alt={block.caption} style={{ width: '100%', borderRadius: 8 }} /> : <Placeholder />}{block.caption && <p style={{ textAlign: 'center', color: '#888', fontSize: 13, marginTop: 6 }}>{block.caption}</p>}</section>;
    case 'gallery':
      return (
        <section style={{ padding: '32px 24px' }}>{block.heading && <h2 style={hh}>{block.heading}</h2>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {block.images.length === 0 ? <Placeholder /> : block.images.map((u, i) => <img key={i} src={u} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8 }} />)}
          </div>
        </section>
      );
    case 'features':
      return (
        <section style={{ padding: '32px 24px' }}>{block.heading && <h2 style={{ ...hh, textAlign: 'center' }}>{block.heading}</h2>}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(200px, 1fr))`, gap: 20 }}>
            {block.items.map((it, i) => (
              <div key={i} style={{ textAlign: 'center', padding: 12 }}>
                <div style={{ fontSize: 34 }}>{it.icon}</div>
                <h3 style={{ margin: '8px 0 4px', fontSize: 16 }}>{it.title}</h3>
                <p style={{ color: '#666', fontSize: 14, margin: 0 }}>{it.text}</p>
              </div>
            ))}
          </div>
        </section>
      );
    case 'cta':
      return (
        <section style={{ background: block.bg, color: block.color, padding: '40px 24px', textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 24 }}>{block.text}</h2>
          <a href={block.url || '#'} style={{ background: '#fff', color: block.bg, padding: '12px 24px', borderRadius: 8, textDecoration: 'none', fontWeight: 700 }}>{block.buttonLabel}</a>
        </section>
      );
    case 'video':
      return <section style={{ padding: '32px 24px' }}>{block.heading && <h2 style={hh}>{block.heading}</h2>}{block.url ? <div style={{ position: 'relative', paddingTop: '56.25%' }}><iframe src={embedUrl(block.url)} title="video" allowFullScreen style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 8 }} /></div> : <Placeholder />}</section>;
    case 'map':
      return <section style={{ padding: '32px 24px' }}>{block.heading && <h2 style={hh}>{block.heading}</h2>}{block.address ? <iframe title="map" src={`https://www.google.com/maps?q=${encodeURIComponent(block.address)}&output=embed`} style={{ width: '100%', height: 300, border: 0, borderRadius: 8 }} /> : <Placeholder />}</section>;
    case 'faq':
      return <section style={{ padding: '32px 24px' }}>{block.heading && <h2 style={hh}>{block.heading}</h2>}{block.items.map((f, i) => <div key={i} style={{ borderBottom: '1px solid #eee', padding: '10px 0' }}><b>{f.q}</b><p style={{ color: '#555', margin: '4px 0 0' }}>{f.a}</p></div>)}</section>;
    case 'hours':
      return <section style={{ padding: '32px 24px' }}>{block.heading && <h2 style={hh}>{block.heading}</h2>}<div style={{ color: '#444', lineHeight: 1.9 }}>{block.lines.map((l, i) => <div key={i}>🕑 {l}</div>)}</div></section>;
    case 'products':
      return (
        <section style={{ padding: '32px 24px' }}>{block.heading && <h2 style={hh}>{block.heading}</h2>}
          {products.length === 0 ? <p style={{ color: '#999' }}>Aucun produit publié.</p> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
              {products.map((p) => (
                <div key={p.article_id} style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <ProductImage path={p.image_path} />
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <span style={{ fontSize: 11, color: '#999', fontFamily: 'monospace' }}>{p.reference}</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{p.designation}</span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <b>{eur(p.price_ttc)}</b><span style={{ fontSize: 12, color: p.available > 0 ? '#0a0' : '#c00' }}>{p.available > 0 ? 'En stock' : 'Rupture'}</span>
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
      return <section id="contact" style={{ padding: '32px 24px', borderTop: '1px solid #eee' }}>{block.heading && <h2 style={hh}>{block.heading}</h2>}<div style={{ color: '#444', lineHeight: 1.8 }}>{block.address && <div>📍 {block.address}</div>}{block.phone && <div>📞 {block.phone}</div>}{block.email && <div>✉️ {block.email}</div>}</div></section>;
    case 'divider':
      return <hr style={{ border: 0, borderTop: '1px solid #eee', margin: '8px 24px' }} />;
  }
}

const hh: React.CSSProperties = { fontSize: 22, marginTop: 0 };
function Placeholder() { return <div style={{ aspectRatio: '3/1', background: '#f4f4f4', borderRadius: 8, display: 'grid', placeItems: 'center', color: '#ccc' }}>image</div>; }

function ProductImage({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; if (path) supabase.storage.from('ged').createSignedUrl(path, 3600).then(({ data }) => { if (on) setUrl(data?.signedUrl ?? null); }).catch(() => {}); return () => { on = false; }; }, [path]);
  return <div style={{ aspectRatio: '1', background: '#f4f4f4', display: 'grid', placeItems: 'center' }}>{url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#ccc', fontSize: 12 }}>—</span>}</div>;
}
