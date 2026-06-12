/**
 * M11 — Constructeur de site e-shop (type Strikingly) : multi-pages, blocs riches,
 * upload d'images, thème, domaine/DNS, aperçu en direct, publication.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, ChevronUp, ChevronDown, Save, Globe, ExternalLink, Rocket, Upload, X, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getShopSettings, saveShopSettings, saveSite, publishSite, listShop, uploadShopAsset } from './eshop-api';
import { SiteRenderer, type ShopProduct } from './site-renderer';
import { parseSite, makeBlock, uid, BLOCK_LABELS, BLOCK_ORDER, type SiteContent, type Block, type BlockType, type Page } from './site-types';
import { t } from '@/lib/i18n';

export function SiteBuilder({ companyId }: { companyId: string }) {
  const settings = useQuery({ queryKey: ['shop-settings', companyId], queryFn: () => getShopSettings(companyId) });
  const shop = useQuery({ queryKey: ['shop', companyId], queryFn: () => listShop(companyId) });
  const [site, setSite] = useState<SiteContent | null>(null);
  const [pageId, setPageId] = useState<string>('');
  const [slug, setSlug] = useState('');
  const [domain, setDomain] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data && site === null) {
      const s = parseSite(settings.data.content);
      setSite(s); setPageId(s.pages[0].id);
      setSlug(settings.data.slug ?? ''); setDomain(settings.data.custom_domain ?? '');
    }
  }, [settings.data, site]);

  const products: ShopProduct[] = useMemo(() => (shop.data ?? []).filter((p) => p.publishable).map((p) => ({ article_id: p.article_id, reference: p.reference, designation: p.designation, price_ttc: p.price_ttc, available: p.available, image_path: p.image_path })), [shop.data]);

  const save = useMutation({ mutationFn: async () => { await saveShopSettings(companyId, { slug, custom_domain: domain || null }); await saveSite(companyId, site!); }, onSuccess: () => setMsg(t('eshop.draftSaved')) });
  const publish = useMutation({ mutationFn: async () => { await saveShopSettings(companyId, { slug, custom_domain: domain || null }); await publishSite(companyId, site!); }, onSuccess: () => setMsg(t('eshop.published2')) });

  if (!site) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  const page = site.pages.find((p) => p.id === pageId) ?? site.pages[0];
  const setTheme = (k: keyof SiteContent['theme'], v: string) => setSite((s) => ({ ...s!, theme: { ...s!.theme, [k]: v } }));
  const updatePage = (fn: (p: Page) => Page) => setSite((s) => ({ ...s!, pages: s!.pages.map((p) => (p.id === page.id ? fn(p) : p)) }));
  const setBlock = (id: string, patch: Partial<Block>) => updatePage((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } as Block : b)) }));
  const moveBlock = (id: string, dir: -1 | 1) => updatePage((p) => { const bs = [...p.blocks]; const i = bs.findIndex((b) => b.id === id); const j = i + dir; if (j < 0 || j >= bs.length) return p; [bs[i], bs[j]] = [bs[j], bs[i]]; return { ...p, blocks: bs }; });
  const delBlock = (id: string) => updatePage((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== id) }));
  const addBlock = (type: BlockType) => updatePage((p) => ({ ...p, blocks: [...p.blocks, makeBlock(type, site.theme)] }));

  // Pages
  const addPage = () => { const np: Page = { id: uid('p'), slug: `page-${site.pages.length + 1}`, title: `Page ${site.pages.length + 1}`, blocks: [makeBlock('text', site.theme)] }; setSite((s) => ({ ...s!, pages: [...s!.pages, np] })); setPageId(np.id); };
  const delPage = (id: string) => { if (site.pages.length <= 1) return; setSite((s) => ({ ...s!, pages: s!.pages.filter((p) => p.id !== id) })); setPageId(site.pages.find((p) => p.id !== id)!.id); };
  const renamePage = (id: string, title: string) => setSite((s) => ({ ...s!, pages: s!.pages.map((p) => (p.id === id ? { ...p, title, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-') } : p)) }));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[440px_1fr]">
      <div className="space-y-4">
        {/* Pages */}
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground"><FileText className="size-4" /> {t('eshop.pages')}</p>
            <Button size="sm" variant="outline" onClick={addPage}><Plus /> {t('eshop.addPage')}</Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {site.pages.map((p) => (
              <button key={p.id} onClick={() => setPageId(p.id)} className={`rounded-md border px-2 py-1 text-[12px] ${p.id === page.id ? 'border-ring bg-accent' : 'border-border hover:bg-accent'}`}>{p.title}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input value={page.title} onChange={(e) => renamePage(page.id, e.target.value)} className="h-8" />
            <span className="font-mono text-[11px] text-muted-foreground">/{page.slug}</span>
            {site.pages.length > 1 && <Button size="sm" variant="ghost" onClick={() => delPage(page.id)}><Trash2 className="size-4 text-danger" /></Button>}
          </div>
        </div>

        {/* Domaine & publication */}
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground"><Globe className="size-4" /> {t('eshop.domainSection')}</p>
          <Lbl>{t('eshop.slug')}</Lbl><Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} className="font-mono" />
          <Lbl>{t('eshop.customDomain')}</Lbl><Input value={domain} onChange={(e) => setDomain(e.target.value.toLowerCase().trim())} className="font-mono" placeholder="boutique.ducati-bxl.be" />
          <div className="rounded-md bg-muted p-2 text-[12px] text-muted-foreground">{t('eshop.dnsHelp')}<br /><span className="font-mono">{domain || 'votre-domaine'} → CNAME → app.ducati-bruxelles</span></div>
          <a href={`/shop/${slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-info underline">/shop/{slug} <ExternalLink className="size-3" /></a>
        </div>

        {/* Thème */}
        <div className="flex gap-3 rounded-md border border-border bg-card p-3">
          <div><Lbl>{t('eshop.primary')}</Lbl><Input type="color" value={site.theme.primary} onChange={(e) => setTheme('primary', e.target.value)} className="h-9 w-16" /></div>
          <div><Lbl>{t('eshop.bg')}</Lbl><Input type="color" value={site.theme.bg} onChange={(e) => setTheme('bg', e.target.value)} className="h-9 w-16" /></div>
          <div><Lbl>{t('eshop.textColor')}</Lbl><Input type="color" value={site.theme.text} onChange={(e) => setTheme('text', e.target.value)} className="h-9 w-16" /></div>
        </div>

        {/* Blocs de la page courante */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('eshop.blocks')} — {page.title}</p>
            <AddBlock onAdd={addBlock} />
          </div>
          {page.blocks.map((b, i) => (
            <div key={b.id} className="space-y-2 rounded-md border border-border bg-card p-3">
              <div className="flex items-center gap-1">
                <span className="text-[12px] font-bold">{BLOCK_LABELS[b.type]}</span>
                <div className="ml-auto flex gap-0.5">
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => moveBlock(b.id, -1)}><ChevronUp className="size-4" /></Button>
                  <Button size="sm" variant="ghost" disabled={i === page.blocks.length - 1} onClick={() => moveBlock(b.id, 1)}><ChevronDown className="size-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => delBlock(b.id)}><Trash2 className="size-4 text-danger" /></Button>
                </div>
              </div>
              <BlockFields block={b} companyId={companyId} onChange={(p) => setBlock(b.id, p)} />
            </div>
          ))}
        </div>

        {msg && <p className="rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">{msg}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => { setMsg(null); save.mutate(); }} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('eshop.saveDraft')}</Button>
          <Button className="flex-1" onClick={() => { setMsg(null); publish.mutate(); }} disabled={publish.isPending}>{publish.isPending ? <Loader2 className="animate-spin" /> : <Rocket />} {t('eshop.publishSite')}</Button>
        </div>
      </div>

      {/* Aperçu en direct */}
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('eshop.preview')}</p>
        <div className="overflow-hidden rounded-md border border-border">
          <SiteRenderer content={site} products={products} preview siteName={slug} pageSlug={page.slug} onNavigate={(s) => { const p = site.pages.find((x) => x.slug === s); if (p) setPageId(p.id); }} />
        </div>
      </div>
    </div>
  );
}

function AddBlock({ onAdd }: { onAdd: (t: BlockType) => void }) {
  return (
    <Select value="" onValueChange={(v) => v && onAdd(v as BlockType)}>
      <SelectTrigger className="h-8 w-44"><span className="flex items-center gap-1 text-[12px]"><Plus className="size-3.5" /> {t('eshop.addBlock')}</span></SelectTrigger>
      <SelectContent>{BLOCK_ORDER.map((bt) => <SelectItem key={bt} value={bt}>{BLOCK_LABELS[bt]}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function BlockFields({ block, companyId, onChange }: { block: Block; companyId: string; onChange: (p: Partial<Block>) => void }) {
  switch (block.type) {
    case 'hero':
      return (<div className="space-y-2">
        <Input value={block.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Titre" />
        <Input value={block.subtitle} onChange={(e) => onChange({ subtitle: e.target.value })} placeholder="Sous-titre" />
        <div className="flex items-end gap-2"><div><Lbl>Fond</Lbl><Input type="color" value={block.bg} onChange={(e) => onChange({ bg: e.target.value })} className="h-9 w-14" /></div><div><Lbl>Texte</Lbl><Input type="color" value={block.color} onChange={(e) => onChange({ color: e.target.value })} className="h-9 w-14" /></div><ImageInput companyId={companyId} url={block.image ?? ''} onChange={(u) => onChange({ image: u })} label="Image de fond" /></div>
      </div>);
    case 'banner':
      return (<div className="space-y-2"><Input value={block.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Texte" /><div className="flex gap-2"><Input type="color" value={block.bg} onChange={(e) => onChange({ bg: e.target.value })} className="h-9 w-14" /><Input type="color" value={block.color} onChange={(e) => onChange({ color: e.target.value })} className="h-9 w-14" /></div></div>);
    case 'text':
      return (<div className="space-y-2"><Input value={block.heading} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Titre" /><Textarea value={block.body} onChange={(e) => onChange({ body: e.target.value })} rows={4} placeholder="Texte" /></div>);
    case 'image':
      return (<div className="space-y-2"><ImageInput companyId={companyId} url={block.url} onChange={(u) => onChange({ url: u })} label="Image" /><Input value={block.caption} onChange={(e) => onChange({ caption: e.target.value })} placeholder="Légende" /></div>);
    case 'gallery':
      return (<div className="space-y-2"><Input value={block.heading} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Titre" />
        <div className="flex flex-wrap gap-2">{block.images.map((u, i) => <div key={i} className="relative"><img src={u} alt="" className="size-16 rounded object-cover" /><button onClick={() => onChange({ images: block.images.filter((_, j) => j !== i) })} className="absolute -right-1 -top-1 rounded-full bg-danger p-0.5 text-white"><X className="size-3" /></button></div>)}</div>
        <ImageInput companyId={companyId} url="" onChange={(u) => onChange({ images: [...block.images, u] })} label="Ajouter une image" />
      </div>);
    case 'features':
      return (<ListEditor items={block.items} onChange={(items) => onChange({ items })} make={() => ({ icon: '⭐', title: 'Titre', text: 'Texte' })} render={(it, set) => (<div className="space-y-1"><IconPicker companyId={companyId} value={it.icon} onChange={(icon) => set({ ...it, icon })} /><Input value={it.title} onChange={(e) => set({ ...it, title: e.target.value })} placeholder="Titre" className="h-8" /><Input value={it.text} onChange={(e) => set({ ...it, text: e.target.value })} placeholder="Texte" className="h-8" /></div>)} heading={block.heading} onHeading={(h) => onChange({ heading: h })} />);
    case 'cta':
      return (<div className="space-y-2"><Input value={block.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Accroche" /><div className="flex gap-2"><Input value={block.buttonLabel} onChange={(e) => onChange({ buttonLabel: e.target.value })} placeholder="Libellé bouton" /><Input value={block.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="Lien (#contact ou URL)" /></div><div className="flex gap-2"><Input type="color" value={block.bg} onChange={(e) => onChange({ bg: e.target.value })} className="h-9 w-14" /><Input type="color" value={block.color} onChange={(e) => onChange({ color: e.target.value })} className="h-9 w-14" /></div></div>);
    case 'video':
      return (<div className="space-y-2"><Input value={block.heading} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Titre" /><Input value={block.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="Lien YouTube / Vimeo" /></div>);
    case 'map':
      return (<div className="space-y-2"><Input value={block.heading} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Titre" /><Input value={block.address} onChange={(e) => onChange({ address: e.target.value })} placeholder="Adresse (pour la carte)" /></div>);
    case 'faq':
      return (<ListEditor items={block.items} onChange={(items) => onChange({ items })} make={() => ({ q: 'Question ?', a: 'Réponse.' })} render={(it, set) => (<div className="space-y-1"><Input value={it.q} onChange={(e) => set({ ...it, q: e.target.value })} placeholder="Question" className="h-8" /><Input value={it.a} onChange={(e) => set({ ...it, a: e.target.value })} placeholder="Réponse" className="h-8" /></div>)} heading={block.heading} onHeading={(h) => onChange({ heading: h })} />);
    case 'hours':
      return (<div className="space-y-2"><Input value={block.heading} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Titre" /><Textarea value={block.lines.join('\n')} onChange={(e) => onChange({ lines: e.target.value.split('\n') })} rows={3} placeholder="Une ligne par horaire" /></div>);
    case 'products':
      return <Input value={block.heading} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Titre de la section produits" />;
    case 'contact':
      return (<div className="space-y-2"><Input value={block.heading} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Titre" /><Input value={block.phone} onChange={(e) => onChange({ phone: e.target.value })} placeholder="Téléphone" /><Input value={block.email} onChange={(e) => onChange({ email: e.target.value })} placeholder="E-mail" /><Input value={block.address} onChange={(e) => onChange({ address: e.target.value })} placeholder="Adresse" /></div>);
    case 'divider':
      return <p className="text-[12px] text-muted-foreground">Ligne de séparation.</p>;
  }
}

function ListEditor<T>({ items, onChange, make, render, heading, onHeading }: { items: T[]; onChange: (v: T[]) => void; make: () => T; render: (it: T, set: (v: T) => void) => React.ReactNode; heading: string; onHeading: (h: string) => void }) {
  return (
    <div className="space-y-2">
      <Input value={heading} onChange={(e) => onHeading(e.target.value)} placeholder="Titre" />
      {items.map((it, i) => (
        <div key={i} className="flex gap-1 rounded border border-dashed border-border p-2">
          <div className="flex-1">{render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}</div>
          <Button size="sm" variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="size-4 text-danger" /></Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...items, make()])}><Plus /> Ajouter</Button>
    </div>
  );
}

const EMOJIS = ['🏍️', '🛵', '🏁', '🔧', '🛠️', '⚙️', '🛞', '🪖', '🧰', '🔩', '⭐', '✅', '🚚', '🛡️', '🏆', '🔥', '💳', '🎁', '♻️', '📍', '📞', '✉️', '⏱️', '💬', '👍', '❤️', '🇧🇪', '⚡'];
function IconPicker({ companyId, value, onChange }: { companyId: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const isImg = /^https?:\/\//.test(value);
  const up = async (file: File) => { setBusy(true); try { onChange(await uploadShopAsset(companyId, file)); setOpen(false); } finally { setBusy(false); if (ref.current) ref.current.value = ''; } };
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2 text-sm">
        <span className="grid size-6 place-items-center text-lg">{isImg ? <img src={value} alt="" className="size-5 object-contain" /> : (value || '＋')}</span>
        <span className="text-[12px] text-muted-foreground">{t('eshop.chooseIcon')}</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 rounded-md border border-border bg-popover p-2 shadow-[var(--shadow-modal)]">
          <div className="grid grid-cols-7 gap-1">
            {EMOJIS.map((e) => <button key={e} type="button" onClick={() => { onChange(e); setOpen(false); }} className="grid size-8 place-items-center rounded text-lg hover:bg-accent">{e}</button>)}
          </div>
          <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) up(e.target.files[0]); }} />
          <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => ref.current?.click()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Upload />} {t('eshop.iconUpload')}</Button>
            {value && <Button size="sm" variant="ghost" onClick={() => { onChange(''); setOpen(false); }}><X className="size-4 text-danger" /></Button>}
          </div>
        </div>
      )}
    </div>
  );
}

function ImageInput({ companyId, url, onChange, label }: { companyId: string; url: string; onChange: (u: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const up = async (file: File) => { setBusy(true); try { onChange(await uploadShopAsset(companyId, file)); } finally { setBusy(false); if (ref.current) ref.current.value = ''; } };
  return (
    <div className="flex items-center gap-2">
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) up(e.target.files[0]); }} />
      {url && <img src={url} alt="" className="size-9 rounded object-cover" />}
      <Button size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Upload />} {label}</Button>
    </div>
  );
}

function Lbl({ children }: { children: React.ReactNode }) { return <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>; }
