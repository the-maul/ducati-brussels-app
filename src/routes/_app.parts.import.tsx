import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Loader2, Play, Check, ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listArticles, type Article } from '@/modules/articles/api';
import {
  parseCsv, guessMapping, buildRows, IMPORT_FIELDS,
  type ColumnMapping, type ImportField, type ParsedCsv,
} from '@/modules/articles/import/parse';
import { buildDiff, summarize, type DiffResult, type ExistingArticle, type DiffSummary } from '@/modules/articles/import/rules';
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
  barcode: 'Code-barres',
  purchase_price: t('articles.purchasePrice'),
  sale_price_ttc: t('articles.salePriceTtc'),
  coefficient: t('articles.coefficient'),
  vat_rate: t('articles.vatRate'),
};

function toExisting(a: Article): ExistingArticle {
  return {
    id: a.id, reference: a.reference, designation: a.designation, brand: a.brand,
    category_path: a.category_path, supplier_ref: a.supplier_ref,
    purchase_price: a.purchase_price, sale_price_ttc: a.sale_price_ttc,
    coefficient: a.coefficient, superseded_by_id: a.superseded_by_id, is_library: a.is_library,
  };
}

function ImportPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<'input' | 'preview' | 'done'>('input');
  const [raw, setRaw] = useState('');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [diff, setDiff] = useState<DiffResult[]>([]);
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed: ParsedCsv = useMemo(() => parseCsv(raw), [raw]);

  const onRawChange = (text: string) => {
    setRaw(text);
    const p = parseCsv(text);
    if (p.headers.length) setMapping(guessMapping(p.headers));
  };

  const analyze = async () => {
    setError(null);
    if (mapping.reference == null) { setError(t('articles.importNeedRef')); return; }
    if (!activeCompanyId) return;
    setBusy(true);
    try {
      const rows = buildRows(parsed, mapping);
      const existing = await listArticles(activeCompanyId);
      const map = new Map(existing.map((a) => [a.reference, toExisting(a)]));
      const d = buildDiff(rows, map);
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
    try {
      const res = await applyImport(diff, activeCompanyId);
      setResult(res);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('articles.importTitle')}
        description={t('articles.importSubtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/parts' })}><ArrowLeft /> {t('articles.title')}</Button>}
      />

      <p className="mb-4 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('articles.importRules')}</p>

      {step === 'input' && (
        <div className="space-y-4">
          <Card title={t('articles.importPaste')}>
            <Textarea
              value={raw}
              onChange={(e) => onRawChange(e.target.value)}
              rows={8}
              className="font-mono text-[12px]"
              placeholder="Référence;Désignation;PA;PV TTC;Marque&#10;96480471A;Levier;12,5;29,90;Rizoma"
            />
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
              <p className="mt-3 text-[12px] text-muted-foreground">{parsed.rows.length} ligne(s) détectée(s).</p>
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
          {diff.length > 300 && <p className="text-[12px] text-muted-foreground">Affichage des 300 premières lignes sur {diff.length}.</p>}

          {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('input')}><ArrowLeft /> {t('articles.importBack')}</Button>
            <Button onClick={apply} disabled={busy || (summary.creates === 0 && summary.updates === 0)}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} {busy ? t('articles.importApplying') : t('articles.importApply')}
            </Button>
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
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12px] text-danger">
              {result.errors.slice(0, 20).map((e, i) => (
                <li key={i}>Ligne {e.rowIndex} ({e.reference}) : {e.message}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex gap-2">
            <Button onClick={() => navigate({ to: '/parts' })}>{t('articles.title')}</Button>
            <Button variant="outline" onClick={() => { setStep('input'); setRaw(''); setDiff([]); setResult(null); }}>
              {t('articles.import')}
            </Button>
          </div>
        </Card>
      )}
    </>
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
      <div className={`font-data text-[28px] font-extrabold tabular-nums ${tone === 'warn' && value > 0 ? 'text-warning' : 'text-foreground'}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</th>;
}
