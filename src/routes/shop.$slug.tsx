/**
 * M11 — Storefront PUBLIC (hors authentification) : /shop/{slug}.
 * Vitrine consultable par n'importe qui (RPC anon, aucun champ sensible), panier,
 * commande en ligne (place_web_order) puis paiement Stripe (si configuré).
 * Un domaine OVH peut être rattaché à cette page (voir docs/integrations-cles-api.md).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { startCheckout } from '@/modules/web/checkout';

export const Route = createFileRoute('/shop/$slug')({
  head: () => ({ meta: [{ title: 'Boutique — Ducati Bruxelles' }] }),
  component: Storefront,
});

type ShopInfo = { company_id: string; name: string | null; description: string | null; hero_text: string | null; theme_color: string | null; phone: string | null; email: string | null; address: string | null };
type Product = { article_id: string; reference: string; designation: string; price_ttc: number; available: number; image_path: string | null };
type CartLine = { article_id: string; designation: string; quantity: number; unit_price_ttc: number };

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

function Storefront() {
  const { slug } = Route.useParams();
  const [info, setInfo] = useState<ShopInfo | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cust, setCust] = useState({ name: '', email: '', phone: '', address: '' });
  const [placing, setPlacing] = useState(false);
  const [orderMsg, setOrderMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      const [{ data: i }, { data: c }] = await Promise.all([
        supabase.rpc('shop_public_info', { _slug: slug }),
        supabase.rpc('shop_public_catalog', { _slug: slug }),
      ]);
      if (!on) return;
      const inf = (Array.isArray(i) ? i[0] : i) as ShopInfo | undefined;
      setInfo(inf ?? null);
      setProducts(((c ?? []) as Product[]).map((p) => ({ ...p, price_ttc: Number(p.price_ttc), available: Number(p.available) })));
      setLoading(false);
    })();
    return () => { on = false; };
  }, [slug]);

  const theme = info?.theme_color || '#cc0000';
  const total = useMemo(() => cart.reduce((s, l) => s + l.quantity * l.unit_price_ttc, 0), [cart]);

  const add = (p: Product) => setCart((c) => {
    const ex = c.find((l) => l.article_id === p.article_id);
    if (ex) return c.map((l) => (l.article_id === p.article_id ? { ...l, quantity: l.quantity + 1 } : l));
    return [...c, { article_id: p.article_id, designation: `${p.reference} ${p.designation}`, quantity: 1, unit_price_ttc: p.price_ttc }];
  });

  const placeOrder = async () => {
    setPlacing(true); setError(null); setOrderMsg(null);
    try {
      const { data, error: e } = await supabase.rpc('place_web_order', {
        _slug: slug, _name: cust.name, _email: cust.email || null, _phone: cust.phone || null, _address: cust.address || null,
        _lines: cart.map((l) => ({ article_id: l.article_id, quantity: l.quantity, unit_price_ttc: l.unit_price_ttc })),
      });
      if (e) throw e;
      const row = (Array.isArray(data) ? data[0] : data) as { order_id: string; number: string } | undefined;
      // Tentative de paiement Stripe (si configuré côté serveur)
      const paid = await startCheckout(row?.order_id ?? '', total, cust.email);
      if (!paid) setOrderMsg(`Commande ${row?.number ?? ''} enregistrée. Nous vous contactons pour le paiement.`);
      setCart([]);
    } catch (err) { setError(err instanceof Error ? err.message : 'Commande impossible'); }
    setPlacing(false);
  };

  if (loading) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>Chargement…</div>;
  if (!info) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', color: '#666' }}>Boutique introuvable ou non publiée.</div>;

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#1a1a1a', maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <header style={{ borderBottom: `3px solid ${theme}`, paddingBottom: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>{info.name}</h1>
        {info.hero_text && <p style={{ fontSize: 18, color: '#444', margin: '8px 0 0' }}>{info.hero_text}</p>}
        {info.description && <p style={{ color: '#666', margin: '4px 0 0' }}>{info.description}</p>}
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
          {products.length === 0 && <p style={{ color: '#888' }}>Aucun produit disponible.</p>}
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
                <button onClick={() => add(p)} disabled={p.available <= 0} style={{ marginTop: 8, background: theme, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 0', cursor: 'pointer', opacity: p.available <= 0 ? 0.5 : 1 }}>Ajouter au panier</button>
              </div>
            </div>
          ))}
        </div>

        <aside style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, alignSelf: 'start', position: 'sticky', top: 16 }}>
          <h3 style={{ marginTop: 0 }}>Panier</h3>
          {orderMsg && <p style={{ background: '#e6f7e6', padding: 8, borderRadius: 6, fontSize: 13 }}>{orderMsg}</p>}
          {error && <p style={{ background: '#fde8e8', color: '#c00', padding: 8, borderRadius: 6, fontSize: 13 }}>{error}</p>}
          {cart.length === 0 ? <p style={{ color: '#888' }}>Votre panier est vide.</p> : (
            <>
              {cart.map((l) => (
                <div key={l.article_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span>{l.quantity} × {l.designation}</span><b>{eur(l.quantity * l.unit_price_ttc)}</b>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #eee', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 16 }}><b>Total</b><b>{eur(total)}</b></div>
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                <input value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} placeholder="Nom complet" style={inp} />
                <input value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} placeholder="E-mail" style={inp} />
                <input value={cust.address} onChange={(e) => setCust({ ...cust, address: e.target.value })} placeholder="Adresse de livraison" style={inp} />
              </div>
              <button onClick={placeOrder} disabled={placing || !cust.name.trim()} style={{ marginTop: 12, width: '100%', background: theme, color: '#fff', border: 'none', borderRadius: 6, padding: '12px 0', cursor: 'pointer', fontSize: 15 }}>{placing ? 'Traitement…' : 'Commander & payer'}</button>
            </>
          )}
        </aside>
      </div>

      <footer style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid #eee', color: '#888', fontSize: 13 }}>
        {info.name} · {[info.address, info.phone, info.email].filter(Boolean).join(' · ')}
      </footer>
    </div>
  );
}

const inp: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 6, padding: '8px 10px', fontSize: 14 };

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
