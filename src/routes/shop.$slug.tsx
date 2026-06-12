/**
 * M11 — Vitrine PUBLIQUE (hors authentification) : /shop/{slug}.
 * Rend le SITE éditable (blocs + thème) publié + panier + commande (place_web_order)
 * + paiement Stripe (si configuré). Un domaine OVH peut pointer ici.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SiteRenderer, type ShopProduct } from '@/modules/web/site-renderer';
import { parseSite, type SiteContent } from '@/modules/web/site-types';
import { startCheckout } from '@/modules/web/checkout';

export const Route = createFileRoute('/shop/$slug')({
  head: () => ({ meta: [{ title: 'Boutique — Ducati Bruxelles' }] }),
  component: Storefront,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
type CartLine = { article_id: string; designation: string; quantity: number; unit_price_ttc: number };

function Storefront() {
  const { slug } = Route.useParams();
  const [site, setSite] = useState<SiteContent | null>(null);
  const [siteName, setSiteName] = useState('');
  const [pageSlug, setPageSlug] = useState('');
  const [found, setFound] = useState<boolean | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cust, setCust] = useState({ name: '', email: '', address: '' });
  const [placing, setPlacing] = useState(false);
  const [orderMsg, setOrderMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Confirmation du paiement au retour de Stripe (?paid=1&order=… / ?canceled=1)
  const [payState, setPayState] = useState<{ kind: 'confirming' | 'paid' | 'pending' | 'canceled'; number?: string } | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      const [{ data: s }, { data: c }] = await Promise.all([
        supabase.rpc('shop_public_site', { _slug: slug }),
        supabase.rpc('shop_public_catalog', { _slug: slug }),
      ]);
      if (!on) return;
      const row = (Array.isArray(s) ? s[0] : s) as { content: unknown; name: string | null } | undefined;
      if (!row) { setFound(false); return; }
      const parsed = parseSite(row.content);
      setSite(parsed); setSiteName(row.name ?? ''); setPageSlug(parsed.pages[0].slug);
      setProducts(((c ?? []) as ShopProduct[]).map((p) => ({ ...p, price_ttc: Number(p.price_ttc), available: Number(p.available) })));
      setFound(true);
    })();
    return () => { on = false; };
  }, [slug]);

  // Retour de paiement Stripe : on confirme le statut RÉEL de la commande (le webhook
  // la passe « payée » côté serveur). On poll quelques secondes le temps qu'il s'exécute.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('canceled') === '1') { setPayState({ kind: 'canceled' }); return; }
    const orderId = params.get('order');
    if (params.get('paid') !== '1' || !orderId) return;
    let on = true, tries = 0;
    setPayState({ kind: 'confirming' });
    const poll = async () => {
      const { data } = await supabase.rpc('web_order_public_status', { _order: orderId });
      const r = (Array.isArray(data) ? data[0] : data) as { number: string | null; status: string } | undefined;
      if (!on) return;
      if (r?.status === 'payee') { setPayState({ kind: 'paid', number: r.number ?? undefined }); return; }
      if (++tries >= 6) { setPayState({ kind: 'pending', number: r?.number ?? undefined }); return; }
      setTimeout(poll, 1500);
    };
    poll();
    return () => { on = false; };
  }, []);

  const total = useMemo(() => cart.reduce((acc, l) => acc + l.quantity * l.unit_price_ttc, 0), [cart]);
  const add = (p: ShopProduct) => setCart((c) => {
    const ex = c.find((l) => l.article_id === p.article_id);
    if (ex) return c.map((l) => (l.article_id === p.article_id ? { ...l, quantity: l.quantity + 1 } : l));
    return [...c, { article_id: p.article_id, designation: `${p.reference} ${p.designation}`, quantity: 1, unit_price_ttc: p.price_ttc }];
  });

  const placeOrder = async () => {
    setPlacing(true); setError(null); setOrderMsg(null);
    try {
      const { data, error: e } = await supabase.rpc('place_web_order', { _slug: slug, _name: cust.name, _email: cust.email || null, _phone: null, _address: cust.address || null, _lines: cart.map((l) => ({ article_id: l.article_id, quantity: l.quantity, unit_price_ttc: l.unit_price_ttc })) });
      if (e) throw e;
      const row = (Array.isArray(data) ? data[0] : data) as { order_id: string; number: string } | undefined;
      const paid = await startCheckout(row?.order_id ?? '', total, cust.email);
      if (!paid) setOrderMsg(`Commande ${row?.number ?? ''} enregistrée. Nous vous contactons pour le paiement.`);
      setCart([]);
    } catch (err) { setError(err instanceof Error ? err.message : 'Commande impossible'); }
    setPlacing(false);
  };

  if (found === false) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', color: '#666', fontFamily: 'Arial' }}>Boutique introuvable ou non publiée.</div>;
  if (!site) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', fontFamily: 'Arial' }}>Chargement…</div>;

  const dismissPay = () => {
    setPayState(null);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname);
  };

  return (
    <div style={{ position: 'relative' }}>
      <SiteRenderer content={site} products={products} onAdd={add} siteName={siteName} pageSlug={pageSlug} onNavigate={setPageSlug} />
      {/* Bannière de retour de paiement Stripe */}
      {payState && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 100, fontFamily: 'Arial' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 380, maxWidth: '90vw', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,.25)' }}>
            {payState.kind === 'confirming' && (<><h2 style={{ margin: '0 0 8px' }}>Confirmation du paiement…</h2><p style={{ color: '#666', fontSize: 14 }}>Merci de patienter quelques instants.</p></>)}
            {payState.kind === 'paid' && (<><div style={{ fontSize: 40 }}>✓</div><h2 style={{ margin: '8px 0' }}>Paiement confirmé</h2><p style={{ color: '#444', fontSize: 14 }}>Votre commande{payState.number ? ` ${payState.number}` : ''} est payée. Un e-mail de confirmation vous sera envoyé.</p></>)}
            {payState.kind === 'pending' && (<><h2 style={{ margin: '8px 0' }}>Paiement en cours de confirmation</h2><p style={{ color: '#444', fontSize: 14 }}>Votre paiement a été reçu. La commande{payState.number ? ` ${payState.number}` : ''} sera confirmée sous peu.</p></>)}
            {payState.kind === 'canceled' && (<><h2 style={{ margin: '8px 0' }}>Paiement annulé</h2><p style={{ color: '#444', fontSize: 14 }}>Votre commande n'a pas été réglée. Vous pouvez réessayer.</p></>)}
            <button onClick={dismissPay} style={{ marginTop: 16, background: site.theme.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 22px', cursor: 'pointer', fontSize: 14 }}>Fermer</button>
          </div>
        </div>
      )}
      {/* Panier flottant */}
      {cart.length > 0 && (
        <aside style={{ position: 'fixed', right: 16, bottom: 16, width: 320, background: '#fff', border: '1px solid #ddd', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.15)', padding: 16, fontFamily: 'Arial', zIndex: 50 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Panier</h3>
          {cart.map((l) => (
            <div key={l.article_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}><span>{l.quantity} × {l.designation}</span><b>{eur(l.quantity * l.unit_price_ttc)}</b></div>
          ))}
          <div style={{ borderTop: '1px solid #eee', paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}><b>Total</b><b>{eur(total)}</b></div>
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            <input value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} placeholder="Nom" style={inp} />
            <input value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} placeholder="E-mail" style={inp} />
            <input value={cust.address} onChange={(e) => setCust({ ...cust, address: e.target.value })} placeholder="Adresse" style={inp} />
          </div>
          {orderMsg && <p style={{ background: '#e6f7e6', padding: 8, borderRadius: 6, fontSize: 12, marginTop: 8 }}>{orderMsg}</p>}
          {error && <p style={{ background: '#fde8e8', color: '#c00', padding: 8, borderRadius: 6, fontSize: 12, marginTop: 8 }}>{error}</p>}
          <button onClick={placeOrder} disabled={placing || !cust.name.trim()} style={{ marginTop: 10, width: '100%', background: site.theme.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 0', cursor: 'pointer', fontSize: 14 }}>{placing ? 'Traitement…' : 'Commander & payer'}</button>
        </aside>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 6, padding: '7px 9px', fontSize: 13 };
