import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, Copy, Trash2, Save, Eye, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import {
  ELEMENT_KEYS, defaultTemplateConfig, normalizeTemplateConfig, sampleLabelData, sheetLayout,
  makeCustomElement,
  type LabelTemplateConfig, type LabelElement, type LabelFont, type ElementKey, type LabelCustomElement,
} from '@/modules/articles/labels/template-types';
import { listTemplates, saveTemplate, deleteTemplate } from '@/modules/articles/labels/templates-api';
import { renderLabelSvg, printLabelsWithTemplate } from '@/modules/articles/labels/render';
import { QuickLabelDialog } from '@/modules/articles/labels/quick-label';
import { useConfirm } from '@/components/confirm-provider';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/parts/labels')({
  head: () => ({ meta: [{ title: 'Étiquettes personnalisées — Ducati Bruxelles' }] }),
  component: LabelEditorPage,
});

const FONTS: LabelFont[] = ['Arial', 'Helvetica', 'Courier'];
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

function LabelEditorPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const imgRef = useRef<HTMLInputElement>(null);

  const templatesQ = useQuery({
    queryKey: ['label-templates', activeCompanyId],
    queryFn: () => listTemplates(activeCompanyId!),
    enabled: !!activeCompanyId,
  });
  const templates = templatesQ.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Mode explicite : 'view' = format existant sélectionné ; 'new' = création/duplication
  // en cours (l'auto-sélection ne doit alors JAMAIS écraser le formulaire).
  const [mode, setMode] = useState<'view' | 'new'>('view');
  const [name, setName] = useState('');
  const [cfg, setCfg] = useState<LabelTemplateConfig>(defaultTemplateConfig());
  const [testBarcode, setTestBarcode] = useState('1234567890128');
  const [quickOpen, setQuickOpen] = useState(false);

  const pick = (id: string) => {
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    setMode('view');
    setSelectedId(id);
    setName(tpl.name);
    setCfg(normalizeTemplateConfig(tpl.config));
  };

  // Auto-sélection : uniquement en mode 'view', quand rien n'est sélectionné ou que
  // la sélection a disparu (suppression) — jamais pendant une création/duplication.
  useEffect(() => {
    if (mode !== 'view' || !templates.length) return;
    if (selectedId && templates.some((x) => x.id === selectedId)) return;
    const first = templates.find((x) => x.is_default) ?? templates[0];
    pick(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, selectedId, mode]);

  const set = <K extends keyof LabelTemplateConfig>(k: K, v: LabelTemplateConfig[K]) => setCfg((p) => ({ ...p, [k]: v }));
  const setEl = (key: ElementKey, patch: Partial<LabelElement>) =>
    setCfg((p) => ({ ...p, elements: p.elements.map((e) => (e.key === key ? { ...e, ...patch } : e)) }));

  // Lignes personnalisées : ajout / édition / suppression.
  const addCustom = () => setCfg((p) => ({ ...p, custom: [...(p.custom ?? []), makeCustomElement()] }));
  const setCustom = (id: string, patch: Partial<LabelCustomElement>) =>
    setCfg((p) => ({ ...p, custom: (p.custom ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const removeCustom = (id: string) =>
    setCfg((p) => ({ ...p, custom: (p.custom ?? []).filter((c) => c.id !== id) }));

  const save = useMutation({
    mutationFn: () => saveTemplate(activeCompanyId!, {
      id: mode === 'new' ? null : selectedId,
      name: name.trim() || 'Format',
      config: cfg,
      is_default: mode === 'new' ? undefined : templates.find((x) => x.id === selectedId)?.is_default,
    }),
    onSuccess: (id) => {
      setMode('view');
      setSelectedId(id);
      toast.success(t('articles.tplSaved'));
      qc.invalidateQueries({ queryKey: ['label-templates', activeCompanyId] });
    },
    onError: () => toast.error(t('articles.errSave')),
  });
  const del = useMutation({
    mutationFn: () => deleteTemplate(activeCompanyId!, selectedId!),
    onSuccess: () => {
      setMode('view');
      setSelectedId(null); // l'auto-sélection reprendra le premier format restant
      toast.success('Élément supprimé');
      qc.invalidateQueries({ queryKey: ['label-templates', activeCompanyId] });
    },
  });

  const newFormat = () => { setMode('new'); setSelectedId(null); setName('Nouveau format'); setCfg(defaultTemplateConfig()); };
  const duplicate = () => { setMode('new'); setSelectedId(null); setName(`${name} (copie)`); };

  const sample = useMemo(() => {
    const d = sampleLabelData(t('app.name'));
    return { ...d, barcode_value: testBarcode || d.barcode_value };
  }, [testBarcode]);
  const previewSvg = useMemo(() => renderLabelSvg(cfg, sample, new Date(), true), [cfg, sample]);
  const layout = useMemo(() => sheetLayout(cfg), [cfg]);

  const previewPrint = () => {
    printLabelsWithTemplate(cfg, [{ data: sample, qty: cfg.sheetA4 ? layout.perSheet : 3 }]);
  };

  const onImage = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        // Réduction (max 400 px) pour garder un format léger, incorporé au JSON.
        const scale = Math.min(1, 400 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        set('image', { ...cfg.image, visible: true, dataUrl: canvas.toDataURL('image/png') });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(f);
  };

  if (!activeCompanyId) return null;

  return (
    <>
      <PageHeader
        title={t('articles.tplTitle')}
        description={t('articles.tplSubtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/parts' })}><ArrowLeft /> {t('articles.title')}</Button>}
      />

      {/* Barre formats : sélection + nouveau / dupliquer / supprimer / aperçu / enregistrer */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={selectedId ?? undefined} onValueChange={pick}>
          <SelectTrigger className="w-64"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>{templates.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={newFormat}><Plus className="size-4" /> {t('articles.tplNew')}</Button>
        <Button variant="outline" size="sm" onClick={duplicate}><Copy className="size-4" /> {t('articles.tplDuplicate')}</Button>
        <Button variant="outline" size="sm" disabled={!selectedId || del.isPending} onClick={async () => { if (await confirm({ variant: 'delete', message: t('articles.tplDeleteConfirm') })) del.mutate(); }}>
          <Trash2 className="size-4" /> {t('articles.tplDelete')}
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setQuickOpen(true)}>{t('articles.quickTitle')}</Button>
          <Button variant="outline" size="sm" onClick={previewPrint}><Eye className="size-4" /> {t('articles.tplPreviewPrint')}</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {t('articles.tplSave')}
          </Button>
        </div>
      </div>
      <QuickLabelDialog open={quickOpen} onOpenChange={setQuickOpen} companyId={activeCompanyId} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* ── Colonne gauche : dimensions + éléments ─────────────────────────── */}
        <div className="space-y-4 xl:col-span-2">
          <Card title={t('articles.tplName')}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label={t('articles.tplName')} wide2>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Checkbox checked={cfg.sheetA4} onCheckedChange={(v) => set('sheetA4', v === true)} /> {t('articles.tplSheetA4')}
              </label>
              {cfg.sheetA4 && (
                <p className="self-end pb-2 text-[12px] tabular-nums text-muted-foreground">
                  {t('articles.tplSheetInfo').replace('{cols}', String(layout.cols)).replace('{rows}', String(layout.rows))}
                </p>
              )}
              <NumField label={t('articles.tplWidth')} value={cfg.widthMm} onChange={(v) => set('widthMm', v)} />
              <NumField label={t('articles.tplHeight')} value={cfg.heightMm} onChange={(v) => set('heightMm', v)} />
              {!cfg.sheetA4 && <NumField label={t('articles.tplPaperWidth')} value={cfg.paperWidthMm} onChange={(v) => set('paperWidthMm', v)} />}
              {!cfg.sheetA4 && <NumField label={t('articles.tplPaperHeight')} value={cfg.paperHeightMm} onChange={(v) => set('paperHeightMm', v)} />}
              {cfg.sheetA4 && <NumField label={t('articles.tplGapX')} value={cfg.gapXMm} onChange={(v) => set('gapXMm', v)} />}
              {cfg.sheetA4 && <NumField label={t('articles.tplGapY')} value={cfg.gapYMm} onChange={(v) => set('gapYMm', v)} />}
            </div>
          </Card>

          <Card title={t('articles.tplElements')}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-data text-[12.5px]">
                <thead className="bg-muted">
                  <tr>
                    <Th>{t('articles.tplColVisible')}</Th>
                    <Th>{t('articles.tplColElement')}</Th>
                    <Th>{t('articles.tplColFont')}</Th>
                    <Th>{t('articles.tplColSize')}</Th>
                    <Th>{t('articles.tplColStyle')}</Th>
                    <Th>{t('articles.tplColX')}</Th>
                    <Th>{t('articles.tplColY')}</Th>
                    <Th>{t('articles.tplColOrientation')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {ELEMENT_KEYS.map((key) => {
                    const el = cfg.elements.find((e) => e.key === key)!;
                    if (!el) return null;
                    return (
                      <tr key={key} className={`border-b border-border last:border-0 ${el.visible ? '' : 'opacity-50'}`}>
                        <td className="px-2 py-1 text-center">
                          <Checkbox checked={el.visible} onCheckedChange={(v) => setEl(key, { visible: v === true })} />
                        </td>
                        <td className="px-2 py-1 font-medium">{t(`articles.tplEl_${key}`)}</td>
                        <td className="px-2 py-1">
                          <Select value={el.font} onValueChange={(v) => setEl(key, { font: v as LabelFont })}>
                            <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>{FONTS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1">
                          <NumInput className="h-8 w-16 text-right tabular-nums" value={el.sizePt} onChange={(v) => setEl(key, { sizePt: v })} />
                        </td>
                        <td className="px-2 py-1">
                          <Select value={el.bold ? 'bold' : 'normal'} onValueChange={(v) => setEl(key, { bold: v === 'bold' })}>
                            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="normal">{t('articles.tplStyleNormal')}</SelectItem>
                              <SelectItem value="bold">{t('articles.tplStyleBold')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1">
                          <NumInput className="h-8 w-20 text-right tabular-nums" value={el.xMm} onChange={(v) => setEl(key, { xMm: v })} />
                        </td>
                        <td className="px-2 py-1">
                          <NumInput className="h-8 w-20 text-right tabular-nums" value={el.yMm} onChange={(v) => setEl(key, { yMm: v })} />
                        </td>
                        <td className="px-2 py-1">
                          <Select value={el.vertical ? 'v' : 'h'} onValueChange={(v) => setEl(key, { vertical: v === 'v' })}>
                            <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="h">{t('articles.tplHorizontal')}</SelectItem>
                              <SelectItem value="v">{t('articles.tplVertical')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Lignes personnalisées : ajout / édition texte / suppression */}
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-ui text-[13px] font-bold text-foreground">{t('articles.tplCustomLines')}</h3>
                <Button type="button" variant="outline" size="sm" onClick={addCustom}>
                  <Plus className="size-4" /> {t('articles.tplCustomAdd')}
                </Button>
              </div>
              {(cfg.custom ?? []).length === 0 ? (
                <p className="text-[11px] text-muted-foreground">{t('articles.tplCustomEmpty')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse font-data text-[12.5px]">
                    <thead className="bg-muted">
                      <tr>
                        <Th>{t('articles.tplColVisible')}</Th>
                        <Th>{t('articles.tplCustomText')}</Th>
                        <Th>{t('articles.tplColFont')}</Th>
                        <Th>{t('articles.tplColSize')}</Th>
                        <Th>{t('articles.tplColStyle')}</Th>
                        <Th>{t('articles.tplColX')}</Th>
                        <Th>{t('articles.tplColY')}</Th>
                        <Th>{t('articles.tplColOrientation')}</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {(cfg.custom ?? []).map((c) => (
                        <tr key={c.id} className={`border-b border-border last:border-0 ${c.visible ? '' : 'opacity-50'}`}>
                          <td className="px-2 py-1 text-center">
                            <Checkbox checked={c.visible} onCheckedChange={(v) => setCustom(c.id, { visible: v === true })} />
                          </td>
                          <td className="px-2 py-1">
                            <Input className="h-8 min-w-40" value={c.text} onChange={(e) => setCustom(c.id, { text: e.target.value })} placeholder={t('articles.tplCustomText')} />
                          </td>
                          <td className="px-2 py-1">
                            <Select value={c.font} onValueChange={(v) => setCustom(c.id, { font: v as LabelFont })}>
                              <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                              <SelectContent>{FONTS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <NumInput className="h-8 w-16 text-right tabular-nums" value={c.sizePt} onChange={(v) => setCustom(c.id, { sizePt: v })} />
                          </td>
                          <td className="px-2 py-1">
                            <Select value={c.bold ? 'bold' : 'normal'} onValueChange={(v) => setCustom(c.id, { bold: v === 'bold' })}>
                              <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="normal">{t('articles.tplStyleNormal')}</SelectItem>
                                <SelectItem value="bold">{t('articles.tplStyleBold')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <NumInput className="h-8 w-20 text-right tabular-nums" value={c.xMm} onChange={(v) => setCustom(c.id, { xMm: v })} />
                          </td>
                          <td className="px-2 py-1">
                            <NumInput className="h-8 w-20 text-right tabular-nums" value={c.yMm} onChange={(v) => setCustom(c.id, { yMm: v })} />
                          </td>
                          <td className="px-2 py-1">
                            <Select value={c.vertical ? 'v' : 'h'} onValueChange={(v) => setCustom(c.id, { vertical: v === 'v' })}>
                              <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="h">{t('articles.tplHorizontal')}</SelectItem>
                                <SelectItem value="v">{t('articles.tplVertical')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1 text-center">
                            <Button type="button" variant="ghost" size="sm" aria-label={t('articles.tplCustomRemove')} onClick={() => removeCustom(c.id)}>
                              <Trash2 className="size-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Code-barres + image (positions/dimensions) */}
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-28 items-center gap-2 pb-2 text-sm font-bold">
                  <Checkbox checked={cfg.barcode.visible} onCheckedChange={(v) => set('barcode', { ...cfg.barcode, visible: v === true })} /> {t('articles.tplBarcode')}
                </label>
                <MiniNum label="L" value={cfg.barcode.widthMm} onChange={(v) => set('barcode', { ...cfg.barcode, widthMm: v })} />
                <MiniNum label="H" value={cfg.barcode.heightMm} onChange={(v) => set('barcode', { ...cfg.barcode, heightMm: v })} />
                <MiniNum label="X" value={cfg.barcode.xMm} onChange={(v) => set('barcode', { ...cfg.barcode, xMm: v })} />
                <MiniNum label="Y" value={cfg.barcode.yMm} onChange={(v) => set('barcode', { ...cfg.barcode, yMm: v })} />
                <Select value={cfg.barcode.vertical ? 'v' : 'h'} onValueChange={(v) => set('barcode', { ...cfg.barcode, vertical: v === 'v' })}>
                  <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="h">{t('articles.tplHorizontal')}</SelectItem>
                    <SelectItem value="v">{t('articles.tplVertical')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-28 items-center gap-2 pb-2 text-sm font-bold">
                  <Checkbox checked={cfg.image.visible} onCheckedChange={(v) => set('image', { ...cfg.image, visible: v === true })} /> {t('articles.tplImage')}
                </label>
                <MiniNum label="L" value={cfg.image.widthMm} onChange={(v) => set('image', { ...cfg.image, widthMm: v })} />
                <MiniNum label="H" value={cfg.image.heightMm} onChange={(v) => set('image', { ...cfg.image, heightMm: v })} />
                <MiniNum label="X" value={cfg.image.xMm} onChange={(v) => set('image', { ...cfg.image, xMm: v })} />
                <MiniNum label="Y" value={cfg.image.yMm} onChange={(v) => set('image', { ...cfg.image, yMm: v })} />
                <input ref={imgRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { onImage(e.target.files?.[0]); if (imgRef.current) imgRef.current.value = ''; }} />
                <Button type="button" variant="outline" size="sm" onClick={() => imgRef.current?.click()}>
                  <Upload className="size-4" /> {t('articles.tplImageImport')}
                </Button>
                {cfg.image.dataUrl && (
                  <>
                    <img src={cfg.image.dataUrl} alt="" className="h-9 rounded border border-border object-contain px-1" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => set('image', { ...cfg.image, dataUrl: null, visible: false })}>
                      <X className="size-4" /> {t('articles.tplImageRemove')}
                    </Button>
                  </>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">{t('articles.tplImageHint')}</p>
            </div>
          </Card>
        </div>

        {/* ── Colonne droite : données de test + prévisualisation ───────────── */}
        <div className="space-y-4">
          <Card title={t('articles.tplTestData')}>
            <div className="space-y-2">
              <Field label={t('articles.tplTestBarcode')}>
                <Input className="font-mono" value={testBarcode} onChange={(e) => setTestBarcode(e.target.value)} />
              </Field>
              <Field label={t('articles.tplFreeText')}>
                <Input value={cfg.freeTexts.free1} onChange={(e) => set('freeTexts', { ...cfg.freeTexts, free1: e.target.value })} />
              </Field>
              <Field label={t('articles.tplFreeText2')}>
                <Input value={cfg.freeTexts.free2} onChange={(e) => set('freeTexts', { ...cfg.freeTexts, free2: e.target.value })} />
              </Field>
              <Field label={t('articles.tplFreeText3')}>
                <Input value={cfg.freeTexts.free3} onChange={(e) => set('freeTexts', { ...cfg.freeTexts, free3: e.target.value })} />
              </Field>
              <Field label={t('articles.tplDateFormat')}>
                <Input className="font-mono" value={cfg.dateFormat} onChange={(e) => set('dateFormat', e.target.value)} placeholder="JJ/MM/AAAA" />
              </Field>
            </div>
          </Card>

          <Card title={t('articles.tplPreview')}>
            {/* SVG généré par le moteur d'impression → WYSIWYG (échelle ~4×) */}
            <div
              className="overflow-auto rounded border border-border bg-muted/40 p-3 [&_svg]:h-auto"
              style={{ maxWidth: '100%' }}
              dangerouslySetInnerHTML={{ __html: previewSvg.replace('<svg ', '<svg style="width:100%;max-width:420px" ') }}
            />
            <div className="mt-3">
              <Button variant="outline" size="sm" className="w-full" onClick={previewPrint}>
                <Eye className="size-4" /> {t('articles.tplPreviewPrint')}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <h2 className="mb-3 font-ui text-[15px] font-bold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children, wide2 }: { label: string; children: React.ReactNode; wide2?: boolean }) {
  return (
    <div className={`space-y-1 ${wide2 ? 'col-span-2' : ''}`}>
      <Label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * Champ numérique à saisie libre : conserve la frappe brute (« 13, » puis « 13,3 »
 * reste affiché tel quel — la virgule ne disparaît plus), pousse la valeur parsée
 * en continu (aperçu live) et se resynchronise hors focus si la valeur change.
 */
function NumInput({ value, onChange, className }: { value: number; onChange: (v: number) => void; className?: string }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(value)); }, [value, focused]);
  return (
    <Input
      className={className} inputMode="decimal" value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => { setText(e.target.value); onChange(num(e.target.value)); }}
      onBlur={() => { setFocused(false); setText(String(num(text))); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <NumInput className="text-right tabular-nums" value={value} onChange={onChange} />
    </Field>
  );
}

function MiniNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] font-bold uppercase text-muted-foreground">{label}</span>
      <NumInput className="h-8 w-20 text-right tabular-nums" value={value} onChange={onChange} />
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-2 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</th>;
}
