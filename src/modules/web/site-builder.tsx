/**
 * M11 — Éditeur de site e-shop (constructeur par blocs) avec aperçu en direct,
 * thème, domaine/DNS et publication. Le rendu d'aperçu = exactement la vitrine publique.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, ChevronUp, ChevronDown, Save, Globe, ExternalLink, Rocket } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getShopSettings, saveShopSettings, saveSite, publishSite, listShop } from './eshop-api';
import { SiteRenderer, type ShopProduct } from './site-renderer';
import { parseSite, makeBlock, BLOCK_LABELS, type SiteContent, type Block, type BlockType } from './site-types';
import { t } from '@/lib/i18n';

export function SiteBuilder({ companyId }: { companyId: string }) {
  const settings = useQuery({ queryKey: ['shop-settings', companyId], queryFn: () => getShopSettings(companyId) });
  const shop = useQuery({ queryKey: ['shop', companyId], queryFn: () => listShop(companyId) });
  const [site, setSite] = useState<SiteContent | null>(null);
  const [slug, setSlug] = useState('');
  const [domain, setDomain] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data && site === null) {
      setSite(parseSite(settings.data.content));
      setSlug(settings.data.slug ?? '');
      setDomain(settings.data.custom_domain ?? '');
    }
  }, [settings.data, site]);

  const products: ShopProduct[] = useMemo(() => (shop.data ?? []).filter((p) => p.publishable).map((p) => ({ article_id: p.article_id, reference: p.reference, designation: p.designation, price_ttc: p.price_ttc, available: p.available, image_path: p.image_path })), [shop.data]);

  const save = useMutation({ mutationFn: async () => { await saveShopSettings(companyId, { slug, custom_domain: domain || null }); await saveSite(companyId, site!); }, onSuccess: () => setMsg(t('eshop.draftSaved')) });
  const publish = useMutation({ mutationFn: async () => { await saveShopSettings(companyId, { slug, custom_domain: domain || null }); await publishSite(companyId, site!); }, onSuccess: () => setMsg(t('eshop.published2')) });

  if (!site) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  const setTheme = (k: keyof SiteContent['theme'], v: string) => setSite((s) => ({ ...s!, theme: { ...s!.theme, [k]: v } }));
  const setBlock = (id: string, patch: Partial<Block>) => setSite((s) => ({ ...s!, blocks: s!.blocks.map((b) => (b.id === id ? { ...b, ...patch } as Block : b)) }));
  const move = (id: string, dir: -1 | 1) => setSite((s) => { const bs = [...s!.blocks]; const i = bs.findIndex((b) => b.id === id); const j = i + dir; if (j < 0 || j >= bs.length) return s!; [bs[i], bs[j]] = [bs[j], bs[i]]; return { ...s!, blocks: bs }; });
  const del = (id: string) => setSite((s) => ({ ...s!, blocks: s!.blocks.filter((b) => b.id !== id) }));
  const add = (type: BlockType) => setSite((s) => ({ ...s!, blocks: [...s!.blocks, makeBlock(type, s!.theme)] }));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_1fr]">
      {/* Contrôles */}
      <div className="space-y-4">
        {/* Domaine & publication */}
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground"><Globe className="size-4" /> {t('eshop.domainSection')}</p>
          <Lbl>{t('eshop.slug')}</Lbl><Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} className="font-mono" />
          <Lbl>{t('eshop.customDomain')}</Lbl><Input value={domain} onChange={(e) => setDomain(e.target.value.toLowerCase().trim())} className="font-mono" placeholder="boutique.ducati-bxl.be" />
          <div className="rounded-md bg-muted p-2 text-[12px] text-muted-foreground">
            {t('eshop.dnsHelp')}<br />
            <span className="font-mono">{domain || 'votre-domaine'} → CNAME → app.ducati-bruxelles</span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[12px] text-muted-foreground">{t('eshop.publicUrl')} :</span>
            <a href={`/shop/${slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-info underline">/shop/{slug} <ExternalLink className="size-3" /></a>
          </div>
        </div>

        {/* Thème */}
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('eshop.theme')}</p>
          <div className="flex gap-3">
            <div><Lbl>{t('eshop.primary')}</Lbl><Input type="color" value={site.theme.primary} onChange={(e) => setTheme('primary', e.target.value)} className="h-9 w-16" /></div>
            <div><Lbl>{t('eshop.bg')}</Lbl><Input type="color" value={site.theme.bg} onChange={(e) => setTheme('bg', e.target.value)} className="h-9 w-16" /></div>
            <div><Lbl>{t('eshop.textColor')}</Lbl><Input type="color" value={site.theme.text} onChange={(e) => setTheme('text', e.target.value)} className="h-9 w-16" /></div>
          </div>
        </div>

        {/* Blocs */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('eshop.blocks')}</p>
            <AddBlock onAdd={add} />
          </div>
          {site.blocks.map((b, i) => (
            <div key={b.id} className="space-y-2 rounded-md border border-border bg-card p-3">
              <div className="flex items-center gap-1">
                <span className="text-[12px] font-bold">{BLOCK_LABELS[b.type]}</span>
                <div className="ml-auto flex gap-0.5">
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(b.id, -1)}><ChevronUp className="size-4" /></Button>
                  <Button size="sm" variant="ghost" disabled={i === site.blocks.length - 1} onClick={() => move(b.id, 1)}><ChevronDown className="size-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => del(b.id)}><Trash2 className="size-4 text-danger" /></Button>
                </div>
              </div>
              <BlockFields block={b} onChange={(p) => setBlock(b.id, p)} />
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
          <SiteRenderer content={site} products={products} preview />
        </div>
      </div>
    </div>
  );
}

function AddBlock({ onAdd }: { onAdd: (t: BlockType) => void }) {
  return (
    <Select value="" onValueChange={(v) => v && onAdd(v as BlockType)}>
      <SelectTrigger className="h-8 w-44"><span className="flex items-center gap-1 text-[12px]"><Plus className="size-3.5" /> {t('eshop.addBlock')}</span></SelectTrigger>
      <SelectContent>{(Object.keys(BLOCK_LABELS) as BlockType[]).map((bt) => <SelectItem key={bt} value={bt}>{BLOCK_LABELS[bt]}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function BlockFields({ block, onChange }: { block: Block; onChange: (p: Partial<Block>) => void }) {
  switch (block.type) {
    case 'hero':
      return (<div className="space-y-2">
        <Input value={block.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Titre" />
        <Input value={block.subtitle} onChange={(e) => onChange({ subtitle: e.target.value })} placeholder="Sous-titre" />
        <div className="flex gap-2"><div><Lbl>Fond</Lbl><Input type="color" value={block.bg} onChange={(e) => onChange({ bg: e.target.value })} className="h-9 w-14" /></div><div><Lbl>Texte</Lbl><Input type="color" value={block.color} onChange={(e) => onChange({ color: e.target.value })} className="h-9 w-14" /></div></div>
      </div>);
    case 'banner':
      return (<div className="space-y-2"><Input value={block.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Texte du bandeau" /><div className="flex gap-2"><Input type="color" value={block.bg} onChange={(e) => onChange({ bg: e.target.value })} className="h-9 w-14" /><Input type="color" value={block.color} onChange={(e) => onChange({ color: e.target.value })} className="h-9 w-14" /></div></div>);
    case 'text':
      return (<div className="space-y-2"><Input value={block.heading} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Titre" /><Textarea value={block.body} onChange={(e) => onChange({ body: e.target.value })} rows={4} placeholder="Texte" /></div>);
    case 'products':
      return <Input value={block.heading} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Titre de la section produits" />;
    case 'contact':
      return (<div className="space-y-2"><Input value={block.heading} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Titre" /><Input value={block.phone} onChange={(e) => onChange({ phone: e.target.value })} placeholder="Téléphone" /><Input value={block.email} onChange={(e) => onChange({ email: e.target.value })} placeholder="E-mail" /><Input value={block.address} onChange={(e) => onChange({ address: e.target.value })} placeholder="Adresse" /></div>);
  }
}

function Lbl({ children }: { children: React.ReactNode }) { return <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>; }
