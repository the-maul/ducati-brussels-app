import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save, Check } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/lib/auth/auth-context';
import { listSequences, updateSequence, previewNumber, type DocSequence } from '@/modules/settings/sequences-api';

export const Route = createFileRoute('/_app/settings/numbering')({
  head: () => ({ meta: [{ title: 'Numérotation — Ducati Bruxelles' }] }),
  component: NumberingPage,
});

type Row = DocSequence & { _dirty?: boolean };

function NumberingPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sequences', activeCompanyId],
    queryFn: () => listSequences(activeCompanyId!),
    enabled: !!activeCompanyId,
  });

  useEffect(() => { if (data) setRows(data.map((d) => ({ ...d }))); }, [data]);

  const upd = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, _dirty: true } : r)));

  const save = useMutation({
    mutationFn: async () => {
      for (const r of rows.filter((x) => x._dirty)) {
        await updateSequence(r.id, {
          prefix: r.prefix, separator: r.separator, padding: r.padding,
          reset_yearly: r.reset_yearly, suffix: r.suffix, label: r.label,
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sequences', activeCompanyId] }),
    onError: (e) => setError(e instanceof Error ? e.message : 'Erreur'),
  });

  if (!activeCompanyId) return null;

  return (
    <>
      <PageHeader
        title="Numérotation des documents"
        description="Préfixe, format et remise à zéro annuelle par type de document. L'aperçu montre le prochain numéro."
        actions={<Button variant="outline" onClick={() => navigate({ to: '/settings' })}><ArrowLeft /> Paramètres</Button>}
      />

      {isLoading && <div className="grid place-items-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}

      {!isLoading && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th>Type</Th><Th>Libellé</Th><Th className="w-24">Préfixe</Th><Th className="w-16">Sépar.</Th>
                <Th className="w-20">Longueur</Th><Th className="w-20 text-center">Reset an.</Th><Th className="w-24">Suffixe</Th>
                <Th>Aperçu</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-1 font-mono text-[12px] font-bold">{r.doc_type}</td>
                  <td className="px-2 py-1"><Input value={r.label} onChange={(e) => upd(r.id, { label: e.target.value })} className="h-8" /></td>
                  <td className="px-2 py-1"><Input value={r.prefix} onChange={(e) => upd(r.id, { prefix: e.target.value })} className="h-8 font-mono" /></td>
                  <td className="px-2 py-1"><Input value={r.separator} onChange={(e) => upd(r.id, { separator: e.target.value })} className="h-8 text-center font-mono" /></td>
                  <td className="px-2 py-1"><Input type="number" min={1} max={10} value={String(r.padding)} onChange={(e) => upd(r.id, { padding: Number(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1 text-center"><Checkbox checked={r.reset_yearly} onCheckedChange={(v) => upd(r.id, { reset_yearly: v === true })} /></td>
                  <td className="px-2 py-1"><Input value={r.suffix ?? ''} onChange={(e) => upd(r.id, { suffix: e.target.value || null })} className="h-8 font-mono" /></td>
                  <td className="px-2 py-1"><span className="rounded bg-muted px-2 py-1 font-mono text-[12px]">{previewNumber(r)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="mt-3 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => { setError(null); save.mutate(); }} disabled={save.isPending || !rows.some((r) => r._dirty)}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Enregistrer
        </Button>
        {save.isSuccess && !save.isPending && <span className="flex items-center gap-1 text-[13px] text-success"><Check className="size-4" /> Enregistré.</span>}
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`px-2 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
