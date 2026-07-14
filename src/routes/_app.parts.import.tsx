import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, Check, ArrowLeft, Upload, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listAllArticlesLite, type ArticleLite } from '@/modules/articles/api';
import {
  parseCsv, guessMapping, buildRows, IMPORT_FIELDS,
  type ColumnMapping, type ImportField, type ParsedCsv,
} from '@/modules/articles/import/parse';
import { parseTariffFile } from '@/modules/articles/import/parse-xlsx';
import {
  buildDiff, summarize, applyPpcRules, DEFAULT_IMPORT_SETTINGS,
  type DiffResult, type ExistingArticle, type DiffSummary, type ImportSettings, type PpcRule,
} from '@/modules/articles/import/rules';
import {
  getImportSettings, saveImportSettings, listPpcRules, addPpcRule, deletePpcRule, getPriceFloor,
} from '@/modules/articles/import/settings-api';
import { translateRows } from '@/modules/articles/import/translate';
import { applyImport, type ApplyResult } from '@/modules/articles/import/apply';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/parts/import')({
  head: () => ({ meta: [{ title: 'Import tarif — Ducati Bruxelles' }] }),
  component: ImportPage,
});

const FIELD_LABELS: Record<ImportField, string> = {
  reference: t('articles.reference'),
  designation: t('articles.designation'),
  brand: t('articles.brand'),
  category_path: t('articles.categoryPath'),
  supplier_ref: t('articles.supplierRef'),
  supplier_name: t('articles.importSupplierName'),
  barcode: 'Code-barres',
  purchase_price: t('articles.purchasePrice'),
  sale_price_ttc: t('articles.salePriceTtc'),
  ppc_ht: t('articles.ppcHt'),
  ppc_ttc: t('articles.ppcTtc'),
  coefficient: t('articles.coefficient'),
  vat_rate: t('articles.vatRate'),
  bin_location: t('articles.binLocation'),
  pack_qty: t('articles.packQty'),
  color: t('articles.color'),
  size: t('articles.size'),
};

function toExisting(a: ArticleLite): ExistingArticle {
  return {
    id: a.id, reference: a.reference, designation: a.designation, brand: a.brand,
    category_path: a.category_path, supplier_ref: a.supplier_ref,
    purchase_price: a.purchase_price, sale_price_ttc: a.sale_price_ttc,
    coefficient: a.coefficient, superseded_by_id: a.superseded_by_id, is_library: a.is_library,
    ppc_ht: a.ppc_ht, ppc_ttc: a.ppc_ttc,
  };
}

function ImportPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<'input' | 'preview' | 'done'>('input');
  const [parsed, setParsed] = useState<ParsedCsv>({ headers: [], rows: [] });
  const [fileName, setFileName] = useState<string | null>(null);
  const [raw, setRaw] = useState('');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [diff, setDiff] = useState<DiffResult[]>([]);
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [ppcApplied, setPpcApplied] = useState(0);
  const [translated, setTranslated] = useState(0);
  const [refIds, setRefIds] = useState<Map<string, string>>(new Map());
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Réglages d'intégration + règles PPC (persistés par société) ─────────────
  const qc = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ['import-settings', activeCompanyId],
    queryFn: () => getImportSettings(activeCompanyId!),
    enabled: !!activeCompanyId,
  });
  const settings = settingsQ.data ?? DEFAULT_IMPORT_SETTINGS;
  const saveSettings = useMutation({
    mutationFn: (s: ImportSettings) => saveImportSettings(activeCompanyId!, s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-settings', activeCompanyId] }),
    onError: () => toast.error(t('articles.errSave')),
  });
  const setSetting = <K extends keyof ImportSettings>(k: K, v: ImportSettings[K]) =>
    saveSettings.mutate({ ...settings, [k]: v });

  const rulesQ = useQuery({
    queryKey: ['ppc-rules', activeCompanyId],
    queryFn: () => listPpcRules(activeCompanyId!),
    enabled: !!activeCompanyId,
  });
  const ppcRules: PpcRule[] = rulesQ.data ?? [];

  const applyMapping = (p: ParsedCsv) => {
    setParsed(p);
    if (p.headers.length) setMapping(guessMapping(p.headers));
  };

  const onFile = async (f: File | null) => {
    if (!f) return;
    setError(null);
    setBusy(true);
    try {
      const p = await parseTariffFile(f);
      setFileName(f.name);
      setRaw('');
      applyMapping(p);
      toast.success(
        t('articles.importFileLoaded').replace('{n}', String(p.rows.length)).replace('{file}', f.name),
      );
    } catch {
      setError(t('articles.importFileError'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onRawChange = (text: string) => {
    setRaw(text);
    setFileName(null);
    applyMapping(parseCsv(text));
  };

  const analyze = async () => {
    setError(null);
    if (mapping.reference == null) { setError(t('articles.importNeedRef')); return; }
    if (!activeCompanyId) return;
    setBusy(true);
    try {
      const rows = buildRows(parsed, mapping);
      // 1. Traduction FR des désignations (IT/EN → FR, réglage)
      setTranslated(settings.translate_designations ? translateRows(rows) : 0);
      // 2. Calcul PV selon PPC (règles paramétrées)
      const nPpc = applyPpcRules(rows, ppcRules);
      setPpcApplied(nPpc);
      // 3. Plancher de prix société + réglages d'intégration
      const floor = await getPriceFloor(activeCompanyId);
      // 4. Référentiel COMPLET (paginé — pas le listArticles plafonné à 500)
      const existing = await listAllArticlesLite(activeCompanyId);
      setRefIds(new Map(existing.map((a) => [a.reference, a.id])));
      const map = new Map(existing.map((a) => [a.reference, toExisting(a)]));
      const d = buildDiff(rows, map, { settings, floorThreshold: floor.threshold, floorMin: floor.min });
      setDiff(d);
      setSummary(summarize(d));
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!activeCompanyId) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const res = await applyImport(diff, activeCompanyId, (done, total) => setProgress({ done, total }), refIds);
      setResult(res);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t('articles.importTitle')}
        description={t('articles.importSubtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/parts' })}><ArrowLeft /> {t('articles.title')}</Button>}
      />

      {step === 'input' && (
        <div className="space-y-4">
          {/* ── Fichier Excel / CSV ─────────────────────────────────────────── */}
          <Card title={t('articles.importFile')}>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv,text/csv"
                className="sr-only"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Upload />} {t('articles.importFile')}
              </Button>
              {fileName && (
                <span className="text-[13px] text-muted-foreground">
                  {fileName} — {parsed.rows.length.toLocaleString('fr-BE')} ligne(s)
                </span>
              )}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">{t('articles.importFileHint')}</p>
          </Card>

          <Card title={t('articles.importPaste')}>
            <Textarea
              value={raw}
              onChange={(e) => onRawChange(e.target.value)}
              rows={6}
              className="font-mono text-[12px]"
              placeholder="Référence;Désignation;PA;PV TTC;Marque&#10;96480471A;Levier;12,5;29,90;Rizoma"
            />
          </Card>

          {/* ── Paramètres d'intégration (cases G8) ─────────────────────────── */}
          <Card title={t('articles.importSettings')}>
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <SettingCheck label={t('articles.setDesignation')} checked={settings.accept_designation} onChange={(v) => setSetting('accept_designation', v)} />
              <SettingCheck label={t('articles.setPurchasePrice')} checked={settings.accept_purchase_price} onChange={(v) => setSetting('accept_purchase_price', v)} />
              <SettingCheck label={t('articles.setPa3dec')} checked={settings.purchase_price_3dec} onChange={(v) => setSetting('purchase_price_3dec', v)} />
              <div className="flex items-center gap-2 text-sm">
                <span className="whitespace-nowrap">{t('articles.setSaleMode')}</span>
                <Select value={settings.sale_price_mode} onValueChange={(v) => setSetting('sale_price_mode', v as ImportSettings['sale_price_mode'])}>
                  <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="increase_only">{t('articles.saleMode_increase_only')}</SelectItem>
                    <SelectItem value="always">{t('articles.saleMode_always')}</SelectItem>
                    <SelectItem value="never">{t('articles.saleMode_never')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <SettingCheck label={t('articles.setKeepCoef')} checked={settings.keep_coefficient} onChange={(v) => setSetting('keep_coefficient', v)} />
              <SettingCheck label={t('articles.setSupplier')} checked={settings.accept_supplier_ref} onChange={(v) => setSetting('accept_supplier_ref', v)} />
              <SettingCheck label={t('articles.setCategory')} checked={settings.accept_category} onChange={(v) => setSetting('accept_category', v)} />
              <SettingCheck label={t('articles.setBrand')} checked={settings.accept_brand} onChange={(v) => setSetting('accept_brand', v)} />
              <SettingCheck label={t('articles.setNoRecreate')} checked={settings.no_recreate_replaced} onChange={(v) => setSetting('no_recreate_replaced', v)} />
              <SettingCheck label={t('articles.setReplacedEquiv')} checked={settings.replaced_to_equivalences} onChange={(v) => setSetting('replaced_to_equivalences', v)} />
              <SettingCheck label={t('articles.setNewLibrary')} checked={settings.new_refs_in_library} onChange={(v) => setSetting('new_refs_in_library', v)} />
              <SettingCheck label={t('articles.setBarcodes')} checked={settings.integrate_supplier_barcodes} onChange={(v) => setSetting('integrate_supplier_barcodes', v)} />
              <SettingCheck label={t('articles.setTranslate')} checked={settings.translate_designations} onChange={(v) => setSetting('translate_designations', v)} />
            </div>
          </Card>

          {/* ── Calcul PV selon PPC ─────────────────────────────────────────── */}
          <Card title={t('articles.ppcTitle')}>
            <PpcRulesEditor companyId={activeCompanyId} rules={rulesQ.data ?? []} />
          </Card>

          {parsed.headers.length > 0 && (
            <Card title={t('articles.importMapping')}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {IMPORT_FIELDS.map((field) => (
                  <div key={field} className="space-y-1.5">
                    <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                      {FIELD_LABELS[field]}{field === 'reference' && ' *'}
                    </Label>
                    <Select
                      value={mapping[field] != null ? String(mapping[field]) : 'none'}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [field]: v === 'none' ? undefined : Number(v) }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('articles.importNone')}</SelectItem>
                        {parsed.headers.map((h, i) => (
                          <SelectItem key={i} value={String(i)}>{h || `Colonne ${i + 1}`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[12px] text-muted-foreground">{parsed.rows.length.toLocaleString('fr-BE')} ligne(s) détectée(s).</p>
            </Card>
          )}

          {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

          <div className="flex justify-end">
            <Button onClick={analyze} disabled={busy || parsed.rows.length === 0}>
              {busy ? <Loader2 className="animate-spin" /> : <Play />} {t('articles.importAnalyze')}
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label={t('articles.importCreates')} value={summary.creates} />
            <Kpi label={t('articles.importUpdates')} value={summary.updates} />
            <Kpi label={t('articles.importSkips')} value={summary.skips} />
            <Kpi label={t('articles.importAnomalies')} value={summary.anomalies} tone={summary.anomalies > 0 ? 'warn' : undefined} />
          </div>

          {(ppcApplied > 0 || translated > 0) && (
            <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
              {[
                ppcApplied > 0 ? t('articles.ppcApplied').replace('{n}', String(ppcApplied)) : null,
                translated > 0 ? t('articles.translatedApplied').replace('{n}', String(translated)) : null,
              ].filter(Boolean).join(' · ')}
            </p>
          )}

          <div className="overflow-hidden rounded-md border border-border">
            <div className="max-h-[26rem] overflow-auto">
              <table className="w-full border-collapse font-data text-[13px]">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <Th>{t('articles.importColAction')}</Th>
                    <Th>{t('articles.importColRef')}</Th>
                    <Th>{t('articles.importColChanges')}</Th>
                    <Th>{t('articles.importColAnomalies')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {diff.slice(0, 300).map((d, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        {d.action === 'create' && <StatusBadge tone="success" label="CRÉER" />}
                        {d.action === 'update' && <StatusBadge tone="info" label="MAJ" />}
                        {d.action === 'skip' && <StatusBadge tone="neutral" label="—" />}
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px]">{d.reference}</td>
                      <td className="px-3 py-2 text-[12px]">
                        {d.changes.map((c) => `${c.field}: ${fmt(c.from)}→${fmt(c.to)}`).join(' · ')}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-warning">{d.anomalies.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {diff.length > 300 && <p className="text-[12px] text-muted-foreground">Affichage des 300 premières lignes sur {diff.length.toLocaleString('fr-BE')}.</p>}

          {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep('input')} disabled={busy}><ArrowLeft /> {t('articles.importBack')}</Button>
            <div className="flex items-center gap-3">
              {busy && progress && (
                <span className="text-[13px] tabular-nums text-muted-foreground">
                  {t('articles.importProgress')
                    .replace('{done}', progress.done.toLocaleString('fr-BE'))
                    .replace('{total}', progress.total.toLocaleString('fr-BE'))}
                </span>
              )}
              <Button onClick={apply} disabled={busy || (summary.creates === 0 && summary.updates === 0)}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />} {busy ? t('articles.importApplying') : t('articles.importApply')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <Card title={t('articles.importDone')}>
          <p className="text-sm">
            {t('articles.importResult')
              .replace('{created}', String(result.created))
              .replace('{updated}', String(result.updated))
              .replace('{errors}', String(result.errors.length))}
          </p>
          {result.replaced > 0 && (
            <p className="mt-1 text-sm">
              {t('articles.importReplaced').replace('{n}', result.replaced.toLocaleString('fr-BE'))}
            </p>
          )}
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12px] text-danger">
              {result.errors.slice(0, 20).map((e, i) => (
                <li key={i}>Ligne {e.rowIndex} ({e.reference}) : {e.message}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex gap-2">
            <Button onClick={() => navigate({ to: '/parts' })}>{t('articles.title')}</Button>
            <Button variant="outline" onClick={() => { setStep('input'); setRaw(''); setFileName(null); setParsed({ headers: [], rows: [] }); setDiff([]); setResult(null); }}>
              {t('articles.import')}
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

/* ── Éditeur des règles PV/PPC (comme l'écran G8) ─────────────────────────── */
function PpcRulesEditor({ companyId, rules }: { companyId: string | null; rules: (PpcRule & { id: string })[] }) {
  const qc = useQueryClient();
  const [pct, setPct] = useState('');
  const [supplier, setSupplier] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');

  const add = useMutation({
    mutationFn: () => addPpcRule(companyId!, {
      pct: Number(pct.replace(',', '.')) || 0,
      supplier_name: supplier || null,
      category_path: category || null,
      brand: brand || null,
    }),
    onSuccess: () => {
      setPct(''); setSupplier(''); setCategory(''); setBrand('');
      qc.invalidateQueries({ queryKey: ['ppc-rules', companyId] });
    },
    onError: () => toast.error(t('articles.errSave')),
  });
  const del = useMutation({
    mutationFn: (id: string) => deletePpcRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ppc-rules', companyId] }),
  });

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">{t('articles.ppcHint')}</p>

      {rules.length === 0
        ? <p className="text-[13px] text-muted-foreground">{t('articles.ppcNone')}</p>
        : (
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th>{t('articles.ppcPct')}</Th>
                <Th>{t('articles.ppcSupplier')}</Th>
                <Th>{t('articles.ppcCategory')}</Th>
                <Th>{t('articles.ppcBrand')}</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.pct).toLocaleString('fr-BE', { minimumFractionDigits: 2 })} %</td>
                  <td className="px-3 py-1.5">{r.supplier_name ?? '—'}</td>
                  <td className="px-3 py-1.5">{r.category_path ?? '—'}</td>
                  <td className="px-3 py-1.5">{r.brand ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => del.mutate(r.id)} title={t('articles.ppcDelete')}>
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('articles.ppcPct')}</Label>
          <Input className="w-24 text-right tabular-nums" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="-6,00" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('articles.ppcSupplier')}</Label>
          <Input className="w-44" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="DUCATI WEST EUROPE" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('articles.ppcCategory')}</Label>
          <Input className="w-44" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="PIECES DE RECHANGE" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('articles.ppcBrand')}</Label>
          <Input className="w-36" value={brand} onChange={(e) => setBrand(e.target.value)} />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => add.mutate()} disabled={!companyId || add.isPending || pct.trim() === ''}>
          {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} {t('articles.ppcAdd')}
        </Button>
      </div>
    </div>
  );
}

function SettingCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

function fmt(v: unknown): string {
  if (v == null) return '∅';
  return String(v);
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <h2 className="mb-3 font-ui text-[15px] font-bold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className="rounded-md border border-border bg-card p-3 text-center shadow-[var(--shadow-card)]">
      <div className={`font-data text-[28px] font-extrabold tabular-nums ${tone === 'warn' && value > 0 ? 'text-warning' : 'text-foreground'}`}>{value.toLocaleString('fr-BE')}</div>
      <div className="text-[11px] uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</th>;
}
