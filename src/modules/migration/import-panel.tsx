/**
 * M14 — Migration G8 : panneau d'import CSV générique (coller/analyser/aperçu/importer),
 * réutilisé par les onglets Contacts / Articles / Véhicules de l'écran de migration.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, Upload, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/lib/i18n';

type ImportPreview = {
  headers: string[];
  rows: Record<string, string>[];
  mapped: { row: Record<string, string>; payload: Record<string, unknown>; error: string | null }[];
  toCreate: number;
  errors: number;
};

export type ImportColumn = { key: string; label: string; get: (payload: Record<string, unknown>) => string };

export function ImportPanel({ companyId, subtitle, placeholder, columns, parse, apply }: {
  companyId: string;
  subtitle: string;
  placeholder: string;
  columns: ImportColumn[];
  parse: (text: string) => ImportPreview;
  apply: (companyId: string, preview: ImportPreview) => Promise<number | { created: number; ignored: number }>;
}) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<number | { created: number; ignored: number } | null>(null);

  const doApply = useMutation({
    mutationFn: () => apply(companyId, preview!),
    onSuccess: (result) => { setDone(result); setPreview(null); setText(''); },
  });

  return (
    <>
      {done !== null && (
        <p className="mb-3 flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
          <CheckCircle2 className="size-4" />
          {typeof done === 'number'
            ? t('migration.done').replace('{n}', String(done))
            : `${t('migration.imported')} : ${done.created} · ${t('migration.ignored')} : ${done.ignored}`}
        </p>
      )}
      <p className="mb-2 text-[13px] text-muted-foreground">{subtitle}</p>
      <Textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} rows={8} placeholder={placeholder} className="font-mono text-[12px]" />
      <div className="mt-3 flex gap-2">
        <Button variant="outline" onClick={() => setPreview(parse(text))} disabled={!text.trim()}><Play /> {t('migration.analyze')}</Button>
        {preview && preview.toCreate > 0 && (
          <Button onClick={() => doApply.mutate()} disabled={doApply.isPending}>
            {doApply.isPending ? <Loader2 className="animate-spin" /> : <Upload />} {t('migration.apply')} ({preview.toCreate})
          </Button>
        )}
      </div>

      {preview && (
        <div className="mt-4">
          <p className="mb-2 text-sm"><b>{preview.toCreate}</b> {t('migration.toCreate')} · <b className={preview.errors ? 'text-danger' : ''}>{preview.errors}</b> {t('migration.errors')}</p>
          <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {columns.map((c) => <Th key={c.key}>{c.label}</Th>)}
                  <Th>{t('migration.colStatus')}</Th>
                </tr>
              </thead>
              <tbody>
                {preview.mapped.map((m, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {columns.map((c) => <td key={c.key} className="px-3 py-1.5">{c.get(m.payload) || '—'}</td>)}
                    <td className="px-3 py-1.5">{m.error ? <span className="text-danger">{m.error}</span> : <span className="text-success">{t('migration.ok')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</th>;
}
