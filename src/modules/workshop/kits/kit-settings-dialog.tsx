/**
 * Rattrapage G8 (19/11/2026, lot forfaits) — Atelier -> Kits -> « Reglages des kits ».
 *
 *  1. Liquide -> article : quel article du DMS sert d'huile moteur, de liquide de frein... avec son
 *     unite de vente (au litre, flacon de 0,5 l arrondi a l'unite superieure).
 *  2. Quantite d'huile par defaut selon la famille moteur (forfaits G8) : utilisee quand le manuel
 *     ne donne pas la quantite, pour un filtre introuvable et pour remplir un kit de vidange vide.
 *  3. Lignes ajoutees par defaut a chaque kit (DDS, controles, petites fournitures, CONTRI).
 *  4. Rattrapage des kits existants, par lots, avec apercu ; chaque kit change prend une version.
 * Ecriture reservee a l'administrateur, au chef d'atelier et au magasinier (controle serveur).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Save, Search, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { searchArticlesLite } from '@/modules/articles/subobjects-api';
import {
  getKitSettings, saveFluidMapping, saveEngineProfile, deleteEngineProfile, saveDefaultLine,
  previewKitsComplete, runKitsComplete, type EngineProfile, type FluidSetting,
} from './settings-api';

const toNum = (s: string): number | null => {
  const x = Number(String(s).replace(',', '.').trim());
  return s.trim() !== '' && Number.isFinite(x) ? x : null;
};
const fmt = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

type Picked = { id: string; reference: string; designation: string } | null;

/** Recherche d'un article de la societe (reference ou designation). */
function ArticlePicker({ companyId, value, onPick, disabled }: {
  companyId: string; value: string | null; onPick: (a: Picked) => void; disabled?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const hits = useQuery({
    queryKey: ['kit-settings-article', companyId, term],
    queryFn: () => searchArticlesLite(companyId, term),
    enabled: open && term.trim().length >= 2,
  });
  return (
    <div className="relative min-w-[12rem]">
      <div className="flex items-center gap-1">
        <span className="truncate font-mono text-[12px]">{value ?? t('kitSettings.none')}</span>
        {!disabled && (
          <Button type="button" size="icon" variant="ghost" aria-label={t('kitSettings.searchArticle')} onClick={() => setOpen((v) => !v)}>
            <Search className="size-4" />
          </Button>
        )}
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-72 space-y-1 rounded-md border border-border bg-background p-2 shadow-sm">
          <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('kitSettings.searchArticle')} />
          <ul className="max-h-48 overflow-y-auto">
            {(hits.data ?? []).map((h) => (
              <li key={h.id}>
                <button type="button" className="w-full rounded px-2 py-1 text-left text-[12px] hover:bg-accent"
                  onClick={() => { onPick(h); setOpen(false); setTerm(''); }}>
                  <span className="mr-2 font-mono">{h.reference}</span>{h.designation}
                </button>
              </li>
            ))}
          </ul>
          <Button type="button" size="sm" variant="ghost" onClick={() => { onPick(null); setOpen(false); }}>{t('kitSettings.clear')}</Button>
        </div>
      )}
    </div>
  );
}

function FluidRow({ companyId, f, canEdit, onSaved }: { companyId: string; f: FluidSetting; canEdit: boolean; onSaved: () => void }) {
  const [article, setArticle] = useState<{ id: string | null; reference: string | null }>({ id: f.articleId, reference: f.reference });
  const [unit, setUnit] = useState(f.saleUnit ?? '');
  const [lpu, setLpu] = useState(fmt(f.litersPerUnit));
  const [whole, setWhole] = useState(f.wholeUnits);
  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => saveFluidMapping({
      companyId, familyCode: f.familyCode, articleId: article.id, saleUnit: unit || null,
      litersPerUnit: toNum(lpu), wholeUnits: whole,
    }),
    onSuccess: () => { toast.success(t('kitSettings.saved')); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('kitSettings.errSave')),
  });
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-2 py-1.5">
        {f.familyLabel}
        {f.unlinked > 0 && <StatusBadge className="ml-2" tone="warning" label={t('kitSettings.unlinked').replace('{n}', String(f.unlinked))} />}
      </td>
      <td className="px-2 py-1.5">
        <ArticlePicker companyId={companyId} value={article.reference} disabled={!canEdit}
          onPick={(a) => setArticle({ id: a?.id ?? null, reference: a?.reference ?? null })} />
      </td>
      <td className="px-2 py-1.5"><Input className="h-8 w-20" value={unit} disabled={!canEdit} onChange={(e) => setUnit(e.target.value)} /></td>
      <td className="px-2 py-1.5"><Input className="h-8 w-20 text-right tabular-nums" inputMode="decimal" value={lpu} disabled={!canEdit} onChange={(e) => setLpu(e.target.value)} /></td>
      <td className="px-2 py-1.5 text-center"><Checkbox checked={whole} disabled={!canEdit} onCheckedChange={(v) => setWhole(v === true)} aria-label={t('kitSettings.colWhole')} /></td>
      <td className="px-2 py-1.5 text-right">
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('kitSettings.save')}
          </Button>
        )}
      </td>
    </tr>
  );
}

type ProfileDraft = Omit<EngineProfile, 'id' | 'g8Forfait'> & { id: string | null; g8Forfait: string | null };

const blankProfile = (): ProfileDraft => ({
  id: null, code: '', label: '', priority: 100, matchPattern: '', excludePattern: null, yearFrom: null, yearTo: null,
  oilArticleId: null, oilReference: null, oilQuantity: null, filterArticleId: null, filterReference: null,
  washerArticleId: null, washerReference: null, g8Forfait: null, isActive: true,
});

function ProfileRow({ companyId, p, canEdit, onSaved }: { companyId: string; p: ProfileDraft; canEdit: boolean; onSaved: () => void }) {
  const [d, setD] = useState<ProfileDraft>(p);
  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => saveEngineProfile(companyId, d),
    onSuccess: () => { toast.success(t('kitSettings.saved')); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('kitSettings.errSave')),
  });
  const del = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => deleteEngineProfile(companyId, d.id as string),
    onSuccess: onSaved,
    onError: (e) => toast.error(e instanceof Error ? e.message : t('kitSettings.errSave')),
  });
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="px-2 py-1.5">
        <Input className="h-8 min-w-[14rem]" value={d.label} disabled={!canEdit} onChange={(e) => set('label', e.target.value)} />
        {d.g8Forfait && <span className="mt-0.5 block text-[11px] text-muted-foreground">{t('kitSettings.fromG8').replace('{f}', d.g8Forfait)}</span>}
        <Input className="mt-1 h-8 font-mono text-[11px]" value={d.matchPattern} disabled={!canEdit} placeholder={t('kitSettings.colPattern')}
          onChange={(e) => set('matchPattern', e.target.value)} />
        <Input className="mt-1 h-8 font-mono text-[11px]" value={d.excludePattern ?? ''} disabled={!canEdit} placeholder={t('kitSettings.colExclude')}
          onChange={(e) => set('excludePattern', e.target.value || null)} />
      </td>
      <td className="px-2 py-1.5">
        <div className="flex gap-1">
          <Input className="h-8 w-16 tabular-nums" inputMode="numeric" value={fmt(d.yearFrom)} disabled={!canEdit} onChange={(e) => set('yearFrom', toNum(e.target.value))} />
          <Input className="h-8 w-16 tabular-nums" inputMode="numeric" value={fmt(d.yearTo)} disabled={!canEdit} onChange={(e) => set('yearTo', toNum(e.target.value))} />
        </div>
        <Input className="mt-1 h-8 w-16 tabular-nums" inputMode="numeric" value={String(d.priority)} disabled={!canEdit} aria-label={t('kitSettings.colPriority')}
          onChange={(e) => set('priority', toNum(e.target.value) ?? 100)} />
      </td>
      <td className="px-2 py-1.5">
        <Input className="h-8 w-20 text-right tabular-nums" inputMode="decimal" value={fmt(d.oilQuantity)} disabled={!canEdit} onChange={(e) => set('oilQuantity', toNum(e.target.value))} />
        <ArticlePicker companyId={companyId} value={d.oilReference} disabled={!canEdit}
          onPick={(a) => setD((x) => ({ ...x, oilArticleId: a?.id ?? null, oilReference: a?.reference ?? null }))} />
      </td>
      <td className="px-2 py-1.5">
        <ArticlePicker companyId={companyId} value={d.filterReference} disabled={!canEdit}
          onPick={(a) => setD((x) => ({ ...x, filterArticleId: a?.id ?? null, filterReference: a?.reference ?? null }))} />
        <ArticlePicker companyId={companyId} value={d.washerReference} disabled={!canEdit}
          onPick={(a) => setD((x) => ({ ...x, washerArticleId: a?.id ?? null, washerReference: a?.reference ?? null }))} />
      </td>
      <td className="px-2 py-1.5 text-center"><Checkbox checked={d.isActive} disabled={!canEdit} onCheckedChange={(v) => set('isActive', v === true)} aria-label={t('kitSettings.colActive')} /></td>
      <td className="px-2 py-1.5 text-right">
        {canEdit && (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('kitSettings.save')}
            </Button>
            {d.id && (
              <Button size="icon" variant="ghost" aria-label={t('action.delete')} onClick={() => del.mutate()} disabled={del.isPending}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-2 py-1.5 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}

function Section({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-ui text-[14px] font-bold">{title}</h3>
      <p className="text-[12px] text-muted-foreground">{intro}</p>
      {children}
    </section>
  );
}

export function KitSettingsDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ['kit-settings', companyId], queryFn: () => getKitSettings(companyId) });
  const previewQ = useQuery({ queryKey: ['kit-settings-preview', companyId], queryFn: () => previewKitsComplete(companyId), enabled: settingsQ.data?.canEdit === true });
  const [newProfile, setNewProfile] = useState(false);
  const [addPick, setAddPick] = useState<Picked>(null);
  const [addQty, setAddQty] = useState('1');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['kit-settings', companyId] });
    qc.invalidateQueries({ queryKey: ['kit-settings-preview', companyId] });
  };

  const saveDefault = useMutation({
    meta: { success: false, error: false },
    mutationFn: (p: { articleId: string; quantity: number | null }) => saveDefaultLine(companyId, p.articleId, p.quantity),
    onSuccess: () => { setAddPick(null); setAddQty('1'); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('kitSettings.errSave')),
  });

  /** Tous les kits, par lots (delai serveur 8 s) ; relancer ne double rien. */
  const complete = useMutation({
    meta: { success: false, error: false },
    mutationFn: async () => {
      let offset = 0; let changed = 0; let filled = 0; let fluids = 0; let defaults = 0;
      for (let pass = 0; pass < 200; pass += 1) {
        const r = await runKitsComplete(companyId, offset);
        changed += r.kitsChanged; filled += r.filled; fluids += r.fluids; defaults += r.defaults;
        offset = r.nextOffset;
        setProgress({ done: offset, total: r.total });
        if (r.done) break;
      }
      return { changed, filled, fluids, defaults };
    },
    onSuccess: (r) => {
      setProgress(null);
      toast.success(t('kitSettings.catchupDone').replace('{c}', String(r.changed)).replace('{fi}', String(r.filled))
        .replace('{fl}', String(r.fluids)).replace('{d}', String(r.defaults)));
      refresh();
      qc.invalidateQueries({ queryKey: ['maintenance-kits'] });
      qc.invalidateQueries({ queryKey: ['maintenance-kit-detail'] });
    },
    onError: (e) => { setProgress(null); toast.error(e instanceof Error ? e.message : t('kitSettings.errSave')); },
  });

  const s = settingsQ.data;
  const canEdit = s?.canEdit === true;
  const pv = previewQ.data;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
        <DialogHeader><DialogTitle>{t('kitSettings.title')}</DialogTitle></DialogHeader>
        {settingsQ.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {settingsQ.isError && (
          <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
            {settingsQ.error instanceof Error ? settingsQ.error.message : t('kitSettings.errSave')}
          </p>
        )}
        {s && (
          <div className="space-y-6">
            {!canEdit && <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('kitSettings.readOnly')}</p>}
            <p className="flex flex-wrap gap-2 text-[12px] text-muted-foreground">
              <span className="tabular-nums">{t('kitSettings.kitsCount').replace('{n}', String(s.kits))}</span>
              {s.emptyKits > 0 && <StatusBadge tone="warning" label={t('kitSettings.emptyKits').replace('{n}', String(s.emptyKits))} />}
              {s.linesWithoutArticle > 0 && <StatusBadge tone="warning" label={t('kitSettings.linesWithoutArticle').replace('{n}', String(s.linesWithoutArticle))} />}
            </p>

            <Section title={t('kitSettings.fluidsTitle')} intro={t('kitSettings.fluidsIntro')}>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse font-data text-[13px]">
                  <thead className="bg-muted"><tr>
                    <Th>{t('kitSettings.colFamily')}</Th><Th>{t('kitSettings.colArticle')}</Th><Th>{t('kitSettings.colSaleUnit')}</Th>
                    <Th>{t('kitSettings.colLitersPerUnit')}</Th><Th>{t('kitSettings.colWhole')}</Th><Th />
                  </tr></thead>
                  <tbody>
                    {s.fluids.map((f) => (
                      <FluidRow key={`${f.familyCode}:${f.articleId}:${f.saleUnit}`} companyId={companyId} f={f} canEdit={canEdit} onSaved={refresh} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title={t('kitSettings.profilesTitle')} intro={t('kitSettings.profilesIntro')}>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse font-data text-[13px]">
                  <thead className="bg-muted"><tr>
                    <Th>{t('kitSettings.colProfile')}</Th><Th>{t('kitSettings.colYears')}</Th><Th>{t('kitSettings.colOil')}</Th>
                    <Th>{t('kitSettings.colFilterWasher')}</Th><Th>{t('kitSettings.colActive')}</Th><Th />
                  </tr></thead>
                  <tbody>
                    {s.profiles.map((p) => (
                      <ProfileRow key={`${p.id}:${p.oilQuantity}:${p.label}`} companyId={companyId} p={p} canEdit={canEdit} onSaved={refresh} />
                    ))}
                    {newProfile && <ProfileRow companyId={companyId} p={blankProfile()} canEdit={canEdit} onSaved={() => { setNewProfile(false); refresh(); }} />}
                  </tbody>
                </table>
              </div>
              {canEdit && !newProfile && (
                <Button size="sm" variant="outline" onClick={() => setNewProfile(true)}><Plus /> {t('kitSettings.addProfile')}</Button>
              )}
            </Section>

            <Section title={t('kitSettings.defaultsTitle')} intro={t('kitSettings.defaultsIntro')}>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse font-data text-[13px]">
                  <thead className="bg-muted"><tr>
                    <Th>{t('kitSettings.colArticle')}</Th><Th>{t('kitSettings.colType')}</Th>
                    <Th className="text-right">{t('kitSettings.colQty')}</Th><Th className="text-right">{t('kitSettings.colPriceTtc')}</Th><Th />
                  </tr></thead>
                  <tbody>
                    {s.defaults.map((d) => (
                      <tr key={d.articleId} className="border-b border-border last:border-0">
                        <td className="px-2 py-1.5"><span className="mr-2 font-mono text-[12px] text-muted-foreground">{d.reference}</span>{d.designation}</td>
                        <td className="px-2 py-1.5">{d.mgmtType}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(d.quantity)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{d.salePriceTtc != null ? `${d.salePriceTtc.toFixed(2).replace('.', ',')} €` : ''}</td>
                        <td className="px-2 py-1.5 text-right">
                          {canEdit && (
                            <Button size="icon" variant="ghost" aria-label={t('action.delete')}
                              onClick={() => saveDefault.mutate({ articleId: d.articleId, quantity: null })} disabled={saveDefault.isPending}>
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <ArticlePicker companyId={companyId} value={addPick ? `${addPick.reference} ${addPick.designation}` : null} onPick={setAddPick} />
                  <Input className="h-8 w-20 text-right tabular-nums" inputMode="decimal" value={addQty} onChange={(e) => setAddQty(e.target.value)} aria-label={t('kitSettings.colQty')} />
                  <Button size="sm" disabled={!addPick || saveDefault.isPending}
                    onClick={() => saveDefault.mutate({ articleId: addPick!.id, quantity: toNum(addQty) ?? 1 })}>
                    <Plus /> {t('kitSettings.addDefault')}
                  </Button>
                </div>
              )}
            </Section>

            {canEdit && (
              <Section title={t('kitSettings.catchupTitle')} intro={t('kitSettings.catchupIntro')}>
                {pv && (
                  <p className="text-[13px] tabular-nums">
                    {t('kitSettings.catchupPreview').replace('{k}', String(pv.kits)).replace('{e}', String(pv.emptyKits))
                      .replace('{f}', String(pv.fluidLines)).replace('{d}', String(pv.defaultLines))}
                  </p>
                )}
                {progress && (
                  <div className="space-y-1" role="status" aria-live="polite">
                    <Progress value={progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0} />
                    <p className="text-[12px] tabular-nums text-muted-foreground">
                      {t('kitSettings.catchupRunning').replace('{n}', String(progress.done)).replace('{t}', String(progress.total))}
                    </p>
                  </div>
                )}
                <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
                  {complete.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} {t('kitSettings.catchupRun')}
                </Button>
              </Section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
