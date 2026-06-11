/**
 * M11 — Rendu d'un site e-shop multi-pages (blocs), design moderne (inspiration
 * Strikingly/Shopify Horizon) : typo Inter, héros plein écran, cartes à hover,
 * header sticky, sections aérées, responsive. Feuille de styles scopée `.ds-root`.
 * Utilisé par l'aperçu de l'éditeur ET la vitrine publique.
 */
import { useEffect, useState, type CSSProperties } from 'react';
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

const CSS = `
.ds-root{--radius:18px;line-height:1.6;font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.ds-root *{box-sizing:border-box}
.ds-root img{display:block}
.ds-head{position:sticky;top:0;z-index:50;backdrop-filter:blur(12px);background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:1px solid rgba(0,0,0,.06)}
.ds-head-in{max-width:1120px;margin:0 auto;display:flex;align-items:center;gap:20px;padding:16px 24px;flex-wrap:wrap}
.ds-brand{font-weight:800;font-size:20px;letter-spacing:-.02em}
.ds-nav{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
.ds-nav a{padding:8px 15px;border-radius:999px;font-weight:500;font-size:14px;color:inherit;text-decoration:none;transition:all .15s;cursor:pointer}
.ds-nav a:hover{background:rgba(0,0,0,.06)}
.ds-nav a.on{color:#fff;background:var(--primary)}
.ds-sec{max-width:1120px;margin:0 auto;padding:80px 24px}
.ds-h2{font-size:clamp(26px,3.4vw,38px);font-weight:800;letter-spacing:-.02em;margin:0 0 28px}
.ds-h2.c{text-align:center}
.ds-hero{position:relative;min-height:74vh;display:grid;place-items:center;text-align:center;padding:96px 24px;overflow:hidden}
.ds-hero h1{font-size:clamp(38px,6.4vw,72px);font-weight:800;letter-spacing:-.035em;margin:0;max-width:18ch}
.ds-hero p{font-size:clamp(17px,2.1vw,23px);opacity:.94;margin:18px auto 0;max-width:48ch}
.ds-grid{display:grid;gap:26px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
.ds-card{border-radius:var(--radius);overflow:hidden;background:#fff;border:1px solid rgba(0,0,0,.06);box-shadow:0 1px 2px rgba(0,0,0,.04);transition:transform .2s,box-shadow .2s;display:flex;flex-direction:column}
.ds-card:hover{transform:translateY(-5px);box-shadow:0 16px 40px rgba(0,0,0,.12)}
.ds-imgw{aspect-ratio:1;overflow:hidden;background:#f1f1f4}
.ds-imgw img{width:100%;height:100%;object-fit:cover;transition:transform .45s}
.ds-card:hover .ds-imgw img{transform:scale(1.07)}
.ds-cardbody{padding:16px;display:flex;flex-direction:column;gap:6px;flex:1}
.ds-ref{font:600 11px/1 ui-monospace,monospace;color:#9a9aa3;letter-spacing:.04em}
.ds-name{font-size:15px;font-weight:600}
.ds-price{font-size:18px;font-weight:800;letter-spacing:-.01em}
.ds-pill{font-size:11px;font-weight:700;padding:4px 11px;border-radius:999px}
.ds-pill.ok{background:#e7f7ed;color:#16794a}
.ds-pill.no{background:#fdecec;color:#b42318}
.ds-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--primary);color:#fff;border:none;border-radius:12px;padding:11px 20px;font-weight:600;font-size:14px;cursor:pointer;transition:filter .15s,transform .15s;text-decoration:none;width:100%}
.ds-btn:hover{filter:brightness(.93);transform:translateY(-1px)}
.ds-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.ds-btn-lg{width:auto;padding:14px 30px;font-size:16px;border-radius:14px}
.ds-feats{display:grid;gap:22px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.ds-feat{text-align:center;padding:28px 20px;border-radius:var(--radius);transition:background .2s}
.ds-feat:hover{background:rgba(0,0,0,.025)}
.ds-feat .ic{width:68px;height:68px;border-radius:50%;display:grid;place-items:center;margin:0 auto 14px;font-size:32px;background:color-mix(in srgb,var(--primary) 13%,transparent)}
.ds-feat h3{margin:0 0 6px;font-size:18px;font-weight:700}
.ds-feat p{margin:0;color:#666;font-size:14px}
.ds-cta{text-align:center;padding:88px 24px;color:#fff}
.ds-cta h2{font-size:clamp(26px,3.6vw,40px);font-weight:800;letter-spacing:-.02em;margin:0 0 22px}
.ds-faq details{border-bottom:1px solid rgba(0,0,0,.08);padding:16px 0}
.ds-faq summary{font-weight:600;cursor:pointer;list-style:none;display:flex;justify-content:space-between}
.ds-faq summary::-webkit-details-marker{display:none}
.ds-faq summary::after{content:'+';color:var(--primary);font-weight:800}
.ds-faq details[open] summary::after{content:'–'}
.ds-faq p{color:#555;margin:10px 0 0}
.ds-foot{background:#0e0e11;color:#b9b9c2;padding:54px 24px;text-align:center;font-size:14px}
.ds-foot b{color:#fff;font-size:16px;display:block;margin-bottom:6px}
@media(max-width:640px){.ds-sec{padding:56px 20px}.ds-hero{min-height:64vh;padding:72px 20px}}
`;

export function SiteRenderer({ content, products, onAdd, preview, siteName, pageSlug, onNavigate }: {
  content: SiteContent; products: ShopProduct[]; onAdd?: (p: ShopProduct) => void; preview?: boolean;
  siteName?: string; pageSlug?: string; onNavigate?: (slug: string) => void;
}) {
  const { theme, pages } = content;
  const page = pages.find((p) => p.slug === pageSlug) ?? pages[0];
  const vars = { '--primary': theme.primary, '--bg': theme.bg, '--text': theme.text, background: theme.bg, color: theme.text, minHeight: preview ? 'auto' : '100vh' } as CSSProperties;
  return (
    <div className="ds-root" style={vars}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />
      <style>{CSS}</style>
      {(siteName || pages.length > 1) && (
        <header className="ds-head">
          <div className="ds-head-in">
            {siteName && <span className="ds-brand">{siteName}</span>}
            <nav className="ds-nav">
              {pages.map((p) => (
                <a key={p.id} className={p.slug === page.slug ? 'on' : ''} href={`#${p.slug}`} onClick={(e) => { e.preventDefault(); onNavigate?.(p.slug); }}>{p.title}</a>
              ))}
            </nav>
          </div>
        </header>
      )}
      {page.blocks.map((b) => <BlockView key={b.id} block={b} theme={theme} products={products} onAdd={onAdd} />)}
      <footer className="ds-foot"><b>{siteName || ''}</b>© {siteName || 'Boutique'} — propulsé par le DMS Ducati Bruxelles</footer>
    </div>
  );
}

function BlockView({ block, theme, products, onAdd }: { block: Block; theme: Theme; products: ShopProduct[]; onAdd?: (p: ShopProduct) => void }) {
  switch (block.type) {
    case 'hero':
      return (
        <section className="ds-hero" style={{ background: block.image ? `linear-gradient(rgba(0,0,0,.42),rgba(0,0,0,.42)), url(${block.image}) center/cover` : block.bg, color: block.color }}>
          <div>
            <h1>{block.title}</h1>
            {block.subtitle && <p>{block.subtitle}</p>}
          </div>
        </section>
      );
    case 'banner':
      return <div style={{ background: block.bg, color: block.color, padding: '12px 24px', textAlign: 'center', fontSize: 14, fontWeight: 500 }}>{block.text}</div>;
    case 'text':
      return <section className="ds-sec">{block.heading && <h2 className="ds-h2">{block.heading}</h2>}<p style={{ whiteSpace: 'pre-wrap', fontSize: 17, color: 'color-mix(in srgb,var(--text) 75%,transparent)', maxWidth: 720 }}>{block.body}</p></section>;
    case 'image':
      return <section className="ds-sec" style={{ paddingTop: 40, paddingBottom: 40 }}>{block.url ? <img src={block.url} alt={block.caption} style={{ width: '100%', borderRadius: 18 }} /> : <Ph />}{block.caption && <p style={{ textAlign: 'center', color: '#8a8a93', fontSize: 14, marginTop: 10 }}>{block.caption}</p>}</section>;
    case 'gallery':
      return (
        <section className="ds-sec">{block.heading && <h2 className="ds-h2 c">{block.heading}</h2>}
          <div className="ds-grid">{block.images.length === 0 ? <Ph /> : block.images.map((u, i) => <img key={i} src={u} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 14 }} />)}</div>
        </section>
      );
    case 'features':
      return (
        <section className="ds-sec">{block.heading && <h2 className="ds-h2 c">{block.heading}</h2>}
          <div className="ds-feats">{block.items.map((it, i) => <div className="ds-feat" key={i}><div className="ic">{it.icon}</div><h3>{it.title}</h3><p>{it.text}</p></div>)}</div>
        </section>
      );
    case 'cta':
      return <section className="ds-cta" style={{ background: block.bg, color: block.color }}><h2>{block.text}</h2><a className="ds-btn ds-btn-lg" href={block.url || '#'} style={{ background: '#fff', color: block.bg }}>{block.buttonLabel}</a></section>;
    case 'video':
      return <section className="ds-sec">{block.heading && <h2 className="ds-h2 c">{block.heading}</h2>}{block.url ? <div style={{ position: 'relative', paddingTop: '56.25%', borderRadius: 16, overflow: 'hidden' }}><iframe src={embedUrl(block.url)} title="video" allowFullScreen style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} /></div> : <Ph />}</section>;
    case 'map':
      return <section className="ds-sec">{block.heading && <h2 className="ds-h2 c">{block.heading}</h2>}{block.address ? <iframe title="map" src={`https://www.google.com/maps?q=${encodeURIComponent(block.address)}&output=embed`} style={{ width: '100%', height: 360, border: 0, borderRadius: 16 }} /> : <Ph />}</section>;
    case 'faq':
      return <section className="ds-sec ds-faq" style={{ maxWidth: 760 }}>{block.heading && <h2 className="ds-h2 c">{block.heading}</h2>}{block.items.map((f, i) => <details key={i}><summary>{f.q}</summary><p>{f.a}</p></details>)}</section>;
    case 'hours':
      return <section className="ds-sec" style={{ maxWidth: 600, textAlign: 'center' }}>{block.heading && <h2 className="ds-h2 c">{block.heading}</h2>}<div style={{ fontSize: 17, lineHeight: 2.1 }}>{block.lines.map((l, i) => <div key={i}>{l}</div>)}</div></section>;
    case 'products':
      return (
        <section className="ds-sec">{block.heading && <h2 className="ds-h2 c">{block.heading}</h2>}
          {products.length === 0 ? <p style={{ textAlign: 'center', color: '#9a9aa3' }}>Aucun produit publié pour l'instant.</p> : (
            <div className="ds-grid">{products.map((p) => (
              <div className="ds-card" key={p.article_id}>
                <div className="ds-imgw"><ProductImage path={p.image_path} /></div>
                <div className="ds-cardbody">
                  <span className="ds-ref">{p.reference}</span>
                  <span className="ds-name">{p.designation}</span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '2px 0 8px' }}>
                    <span className="ds-price">{eur(p.price_ttc)}</span>
                    <span className={`ds-pill ${p.available > 0 ? 'ok' : 'no'}`}>{p.available > 0 ? 'En stock' : 'Rupture'}</span>
                  </div>
                  {onAdd && <button className="ds-btn" onClick={() => onAdd(p)} disabled={p.available <= 0}>Ajouter au panier</button>}
                </div>
              </div>
            ))}</div>
          )}
        </section>
      );
    case 'contact':
      return (
        <section id="contact" className="ds-sec" style={{ textAlign: 'center', maxWidth: 640 }}>{block.heading && <h2 className="ds-h2 c">{block.heading}</h2>}
          <div style={{ fontSize: 17, lineHeight: 2 }}>{block.address && <div>📍 {block.address}</div>}{block.phone && <div>📞 {block.phone}</div>}{block.email && <div>✉️ {block.email}</div>}</div>
        </section>
      );
    case 'divider':
      return <div style={{ maxWidth: 1120, margin: '0 auto' }}><hr style={{ border: 0, borderTop: '1px solid rgba(0,0,0,.08)', margin: '8px 24px' }} /></div>;
  }
}

function Ph() { return <div style={{ aspectRatio: '3/1', background: '#f1f1f4', borderRadius: 16, display: 'grid', placeItems: 'center', color: '#c8c8cf', fontSize: 14 }}>image</div>; }

function ProductImage({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; if (path) supabase.storage.from('ged').createSignedUrl(path, 3600).then(({ data }) => { if (on) setUrl(data?.signedUrl ?? null); }).catch(() => {}); return () => { on = false; }; }, [path]);
  return url ? <img src={url} alt="" /> : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#c8c8cf' }}>—</div>;
}
