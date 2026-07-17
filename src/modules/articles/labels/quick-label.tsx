/**
 * M2/M5 (B12) — Impression rapide d'une étiquette « texte libre » (style
 * P-touch Editor) : texte multi-lignes, police, taille, gras/italique/souligné,
 * proportions largeur/hauteur, alignement, copies — prévisualisation en direct.
 * Dimensions reprises d'un format d'étiquette enregistré.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, Bold, Italic, Underline } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listTemplates } from './templates-api';
import { renderFreeTextLabelSvg, printRawLabels, DEFAULT_QUICK_STYLE, type QuickLabelStyle } from './render';
import { t } from '@/lib/i18n';

const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export function QuickLabelDialog({ open, onOpenChange, companyId, initialText }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string | null;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText ?? '');
  const [style, setStyle] = useState<QuickLabelStyle>({ ...DEFAULT_QUICK_STYLE });
  const [copies, setCopies] = useState('1');
  const [templateId, setTemplateId] = useState<string | null>(null);

  const templatesQ = useQuery({
    queryKey: ['label-templates', companyId],
    queryFn: () => listTemplates(companyId!),
    enabled: !!companyId && open,
  });
  const templates = templatesQ.data ?? [];
  const template = templates.find((x) => x.id === templateId) ?? templates.find((x) => x.is_default) ?? templates[0] ?? null;

  const set = <K extends keyof QuickLabelStyle>(k: K, v: QuickLabelStyle[K]) => setStyle((p) => ({ ...p, [k]: v }));
  const lines = useMemo(() => text.split('\n'), [text]);
  const dims = template ? { widthMm: template.config.widthMm, heightMm: template.config.heightMm } : { widthMm: 62, heightMm: 29 };
  const previewSvg = useMemo(() => renderFreeTextLabelSvg(dims, lines, style, true), [dims, lines, style]);

  const doPrint = () => {
    if (!template || !text.trim()) return;
    const svg = renderFreeTextLabelSvg(dims, lines, style, false);
    printRawLabels(template.config, svg, num(copies) || 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('articles.quickTitle')}</DialogTitle>
          <DialogDescription>{t('articles.quickSubtitle')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* ── Texte + mise en forme ─────────────────────────────────────── */}
          <div className="space-y-3">
            <Field label={t('articles.quickText')}>
              <Textarea rows={4} className="font-data text-[15px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('articles.quickTextPlaceholder')} />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label={t('articles.labelsFormat')}>
                <Select value={template?.id ?? undefined} onValueChange={setTemplateId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{templates.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label={t('articles.quickFont')}>
                <Select value={style.font} onValueChange={(v) => set('font', v as QuickLabelStyle['font'])}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Arial">Arial</SelectItem>
                    <SelectItem value="Helvetica">Helvetica</SelectItem>
                    <SelectItem value="Courier">Courier</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('articles.quickSize')}>
                <Input className="h-9 text-right tabular-nums" inputMode="decimal" value={String(style.sizePt)} onChange={(e) => set('sizePt', Math.max(4, num(e.target.value)))} />
              </Field>
              <Field label={t('articles.quickAlign')}>
                <Select value={style.align} onValueChange={(v) => set('align', v as QuickLabelStyle['align'])}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">{t('articles.quickAlignLeft')}</SelectItem>
                    <SelectItem value="center">{t('articles.quickAlignCenter')}</SelectItem>
                    <SelectItem value="right">{t('articles.quickAlignRight')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {/* B / I / U */}
            <div className="flex items-center gap-1">
              <StyleToggle active={style.bold} onClick={() => set('bold', !style.bold)} title={t('articles.quickBold')}><Bold className="size-4" /></StyleToggle>
              <StyleToggle active={style.italic} onClick={() => set('italic', !style.italic)} title={t('articles.quickItalic')}><Italic className="size-4" /></StyleToggle>
              <StyleToggle active={style.underline} onClick={() => set('underline', !style.underline)} title={t('articles.quickUnderline')}><Underline className="size-4" /></StyleToggle>
              <div className="ml-3 flex items-center gap-2">
                <MiniNum label={t('articles.quickScaleX')} value={style.scaleX} onChange={(v) => set('scaleX', Math.max(10, v))} />
                <MiniNum label={t('articles.quickScaleY')} value={style.scaleY} onChange={(v) => set('scaleY', Math.max(10, v))} />
              </div>
            </div>
          </div>

          {/* ── Prévisualisation + impression ─────────────────────────────── */}
          <div className="space-y-3">
            <Field label={t('articles.tplPreview')}>
              <div
                className="overflow-auto rounded border border-border bg-muted/40 p-3"
                dangerouslySetInnerHTML={{ __html: previewSvg.replace('<svg ', '<svg style="width:100%;max-width:380px" ') }}
              />
            </Field>
            <div className="flex items-end gap-2">
              <Field label={t('articles.quickCopies')}>
                <Input className="h-9 w-24 text-right tabular-nums" inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value)} />
              </Field>
              <Button className="h-9 flex-1" onClick={doPrint} disabled={!template || !text.trim()}>
                <Printer /> {t('articles.quickPrint')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StyleToggle({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} title={title} aria-pressed={active}
      className={`grid size-9 place-items-center rounded-md border transition-colors ${active ? 'border-[var(--ducati-red)] bg-[var(--ducati-red-tint)] text-[var(--ducati-red)]' : 'border-border text-muted-foreground hover:bg-accent'}`}
    >
      {children}
    </button>
  );
}

function MiniNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="whitespace-nowrap text-[11px] font-bold uppercase text-muted-foreground">{label}</span>
      <Input className="h-9 w-20 text-right tabular-nums" inputMode="numeric" value={String(value)} onChange={(e) => onChange(num(e.target.value))} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
