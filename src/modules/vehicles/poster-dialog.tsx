/**
 * Rattrapage G8 (18/11/2026, lot parc) — « Edition d'affichette produit fini / article » de G8 :
 * modele a balises (palette cliquable), 1 ou 2 affichettes par page, PDF a imprimer.
 * Les modeles se gardent par societe (`poster_templates`) ; sans la migration, le modele propose
 * d'office et la saisie du moment servent quand meme (seul l'enregistrement est indisponible).
 */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Loader2, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { ArticleLinePicker } from '@/modules/sales/article-line-picker';
import { VehiclePicker } from './vehicle-picker';
import {
  ARTICLE_TAGS, VEHICLE_TAGS, articlePosterData, defaultPosterBody, fillTemplate, unknownTags, vehiclePosterData,
  type PosterKind,
} from './poster-rules';
import { deletePosterTemplate, listPosterTemplates, loadPosterArticles, loadPosterVehicles, savePosterTemplate } from './poster-api';
import { buildPosterPdf } from './poster-pdf';

const DEFAULT_ID = '__default__';

export function PosterDialog({ companyId, kind, initialIds, onClose }: {
  companyId: string; kind: PosterKind; initialIds: string[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { companies } = useAuth();
  const shopName = companies.find((c) => c.id === companyId)?.name ?? '';
  const [ids, setIds] = useState<string[]>(initialIds);
  const [articleText, setArticleText] = useState('');
  const defaultBody = useMemo(() => defaultPosterBody(kind, {
    firstRegistration: t('vehicles.firstRegistration'), mileage: t('vehicles.mileage'), displacement: t('vehicles.displacement'),
    color: t('vehicles.color'), warranty: t('parcG8.warranty'), reference: t('vehicles.reference'), policeBook: t('vehicles.policeBook'),
  }), [kind]);
  const [templateId, setTemplateId] = useState<string>(DEFAULT_ID);
  const [name, setName] = useState('');
  const [body, setBody] = useState(defaultBody);
  const [perPage, setPerPage] = useState<1 | 2>(1);
  const area = useRef<HTMLTextAreaElement | null>(null);

  const tq = useQuery({ queryKey: ['poster-templates', companyId, kind], queryFn: () => listPosterTemplates(companyId, kind) });
  const templates = tq.data?.rows ?? [];
  const ready = tq.data?.ready !== false;

  const vq = useQuery({ queryKey: ['poster-vehicles', ids], queryFn: () => loadPosterVehicles(ids), enabled: kind === 'vehicle' });
  const aq = useQuery({ queryKey: ['poster-articles', ids], queryFn: () => loadPosterArticles(ids), enabled: kind === 'article' });
  const items = kind === 'vehicle'
    ? (vq.data ?? []).map((v) => ({ id: v.id, label: [v.brand, v.model, v.vin].filter(Boolean).join(' - '),
        data: vehiclePosterData(v, { shopName, marge: v.mgmt_type === 'O', monthsLabel: t('parcG8.months') }) }))
    : (aq.data ?? []).map((a) => ({ id: a.id, label: `${a.reference} - ${a.designation}`, data: articlePosterData(a, { shopName }) }));
  const unknown = unknownTags(body, kind);
  const tags = kind === 'vehicle' ? VEHICLE_TAGS : ARTICLE_TAGS;

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    if (id === DEFAULT_ID) { setBody(defaultBody); setName(''); setPerPage(1); return; }
    const tpl = templates.find((x) => x.id === id);
    if (tpl) { setBody(tpl.body); setName(tpl.name); setPerPage(tpl.per_page === 2 ? 2 : 1); }
  };
  const insertTag = (tag: string) => {
    const el = area.current;
    const ins = `[${tag}]`;
    if (!el) { setBody((b) => b + ins); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + ins + body.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + ins.length, start + ins.length); });
  };

  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => savePosterTemplate(companyId, { id: templateId === DEFAULT_ID ? null : templateId, kind, name, body, perPage }),
    onSuccess: (id) => { setTemplateId(id); qc.invalidateQueries({ queryKey: ['poster-templates', companyId, kind] }); toast.success(t('feedback.saved')); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const del = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => deletePosterTemplate(templateId),
    onSuccess: () => { pickTemplate(DEFAULT_ID); qc.invalidateQueries({ queryKey: ['poster-templates', companyId, kind] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const pdf = useMutation({
    meta: { success: false, error: false },
    mutationFn: async () => {
      const blob = await buildPosterPdf(items.map((it) => fillTemplate(body, it.data)), perPage);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>{kind === 'vehicle' ? t('parcG8.posterVehicle') : t('parcG8.posterArticle')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1 space-y-1">
                <Label className="text-[12px]">{t('parcG8.posterTemplate')}</Label>
                <Select value={templateId} onValueChange={pickTemplate}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_ID}>{t('parcG8.posterDefault')}</SelectItem>
                    {templates.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[12px]">{t('parcG8.posterPerPage')}</Label>
                <Select value={String(perPage)} onValueChange={(v) => setPerPage(v === '2' ? 2 : 1)}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Textarea ref={area} value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="font-mono text-[13px]" />
            <p className="text-[12px] text-muted-foreground">{t('parcG8.posterSyntax')}</p>
            {unknown.length > 0 && (
              <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('parcG8.posterUnknownTags')} {unknown.map((u) => `[${u}]`).join(' ')}</p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1 space-y-1">
                <Label className="text-[12px]">{t('parcG8.posterName')}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Button variant="outline" onClick={() => save.mutate()} disabled={!ready || !name.trim() || save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('parcG8.posterSave')}
              </Button>
              {templateId !== DEFAULT_ID && (
                <Button variant="ghost" onClick={() => del.mutate()} disabled={del.isPending}><Trash2 className="text-danger" /></Button>
              )}
            </div>
            {!ready && <p className="text-[12px] text-muted-foreground">{t('parcG8.migrationMissing')}</p>}
          </div>
          <div className="space-y-2">
            <Label className="text-[12px]">{t('parcG8.posterTags')}</Label>
            <div className="flex max-h-[360px] flex-wrap gap-1 overflow-auto">
              {tags.map((tag) => (
                <button key={tag} type="button" onClick={() => insertTag(tag === 'NUMLIVREPOLICE' ? 'N° LIVRE DE POLICE' : tag)}
                  className="rounded-[var(--radius-badge)] border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent">
                  [{tag === 'NUMLIVREPOLICE' ? 'N° LIVRE DE POLICE' : tag}]
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-[12px]">{kind === 'vehicle' ? t('parcG8.posterVehicles') : t('parcG8.posterArticles')}</Label>
          <ul className="space-y-1">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                <span className="truncate">{it.label}</span>
                <button type="button" className="ml-auto text-muted-foreground hover:text-danger" onClick={() => setIds((x) => x.filter((i) => i !== it.id))}><X className="size-4" /></button>
              </li>
            ))}
          </ul>
          {kind === 'vehicle' ? (
            <VehiclePicker companyId={companyId} contactId={null} onPick={(v) => setIds((x) => (x.includes(v.id) ? x : [...x, v.id]))} placeholder={t('parcG8.posterAddVehicle')} />
          ) : (
            <ArticleLinePicker companyId={companyId} value={articleText} onText={setArticleText}
              onPick={(a) => { setArticleText(''); setIds((x) => (x.includes(a.id) ? x : [...x, a.id])); }} placeholder={t('parcG8.posterAddArticle')} className="h-9" />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => pdf.mutate()} disabled={items.length === 0 || pdf.isPending}>
            {pdf.isPending ? <Loader2 className="animate-spin" /> : <FileDown />} {t('parcG8.posterPdf')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
