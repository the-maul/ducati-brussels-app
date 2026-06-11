/**
 * M0 — Éditeur générique d'une table de paramètres (reference_values).
 * Grille éditable : code, libellé, colonnes spécifiques, actif. Ajout/suppression/enregistrement.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Save, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listRef, upsertRef, deleteRef, type RefExtra } from './reference-api';
import type { RefTableDef } from './reference-tables';
import { t } from '@/lib/i18n';

type EditRow = {
  id?: string;
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
  extra: RefExtra;
  _key: string; // clé React stable
};

let counter = 0;
const newKey = () => `tmp-${counter++}`;

export function ReferenceEditor({ def, companyId }: { def: RefTableDef; companyId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['ref', companyId, def.key],
    queryFn: () => listRef(companyId, def.key),
  });

  const [rows, setRows] = useState<EditRow[]>([]);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setRows(data.map((r) => ({
        id: r.id, code: r.code, label: r.label, sort_order: r.sort_order,
        is_active: r.is_active, extra: (r.extra as RefExtra) ?? {}, _key: r.id,
      })));
      setDeleted([]);
    }
  }, [data]);

  const update = (key: string, patch: Partial<EditRow>) =>
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  const updateExtra = (key: string, col: string, value: unknown) =>
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, extra: { ...r.extra, [col]: value as never } } : r)));

  const addRow = () =>
    setRows((rs) => [...rs, { code: '', label: '', sort_order: (rs.at(-1)?.sort_order ?? 0) + 1, is_active: true, extra: {}, _key: newKey() }]);
  const removeRow = (row: EditRow) => {
    if (row.id) setDeleted((d) => [...d, row.id!]);
    setRows((rs) => rs.filter((r) => r._key !== row._key));
  };

  const save = useMutation({
    mutationFn: async () => {
      for (const id of deleted) await deleteRef(id);
      for (const r of rows) {
        if (!r.code.trim() || !r.label.trim()) continue;
        await upsertRef({
          id: r.id, company_id: companyId, table_key: def.key,
          code: r.code.trim(), label: r.label.trim(), sort_order: r.sort_order,
          is_active: r.is_active, extra: r.extra,
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ref', companyId, def.key] }),
    onError: (e) => setError(e instanceof Error ? e.message : 'Erreur'),
  });

  if (isLoading) return <div className="grid place-items-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th className="w-32">Code</Th>
              <Th>Libellé</Th>
              {def.extraColumns.map((c) => <Th key={c.key} className="w-40">{c.label}</Th>)}
              <Th className="w-16 text-center">Actif</Th>
              <Th className="w-12"></Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4 + def.extraColumns.length} className="px-3 py-6 text-center text-muted-foreground">Aucune valeur — ajoutez une ligne.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r._key} className="border-b border-border last:border-0">
                <td className="px-2 py-1">
                  <Input value={r.code} onChange={(e) => update(r._key, { code: e.target.value })} className="h-8 font-mono text-[12px]" />
                </td>
                <td className="px-2 py-1">
                  <Input value={r.label} onChange={(e) => update(r._key, { label: e.target.value })} className="h-8" />
                </td>
                {def.extraColumns.map((c) => (
                  <td key={c.key} className="px-2 py-1">
                    <ExtraCell col={c} value={r.extra[c.key]} onChange={(v) => updateExtra(r._key, c.key, v)} />
                  </td>
                ))}
                <td className="px-2 py-1 text-center">
                  <Checkbox checked={r.is_active} onCheckedChange={(v) => update(r._key, { is_active: v === true })} />
                </td>
                <td className="px-2 py-1 text-center">
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeRow(r)} aria-label="Supprimer">
                    <Trash2 className="size-4 text-danger" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={addRow}><Plus /> Ajouter une ligne</Button>
        <Button onClick={() => { setError(null); save.mutate(); }} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('action.save')}
        </Button>
      </div>
      {save.isSuccess && !save.isPending && (
        <p className="flex items-center gap-1 text-[13px] text-success"><Check className="size-4" /> Enregistré.</p>
      )}
    </div>
  );
}

function ExtraCell({ col, value, onChange }: { col: RefTableDef['extraColumns'][number]; value: unknown; onChange: (v: unknown) => void }) {
  if (col.type === 'bool') {
    return <Checkbox checked={value === true} onCheckedChange={(v) => onChange(v === true)} />;
  }
  if (col.type === 'number') {
    return <Input type="number" value={value != null ? String(value) : ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className="h-8 text-right tabular-nums" />;
  }
  if (col.type === 'select') {
    return (
      <Select value={(value as string) || undefined} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>{col.options?.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className="h-8" />;
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-2 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
