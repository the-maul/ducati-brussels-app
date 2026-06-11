import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listCategories, upsertCategory, deleteCategory, categoryPath, depthOf } from '@/modules/articles/categories-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/parts/families')({
  head: () => ({ meta: [{ title: 'Familles — Ducati Bruxelles' }] }),
  component: FamiliesPage,
});

function FamiliesPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['categories', activeCompanyId],
    queryFn: () => listCategories(activeCompanyId!),
    enabled: !!activeCompanyId,
  });
  const [form, setForm] = useState({ name: '', parent_id: 'root', code: '', sales_account: '' });
  const inv = () => qc.invalidateQueries({ queryKey: ['categories', activeCompanyId] });

  const add = useMutation({
    mutationFn: () => upsertCategory({
      company_id: activeCompanyId!, name: form.name.trim(),
      parent_id: form.parent_id === 'root' ? null : form.parent_id,
      code: form.code ? Number(form.code) : null, sales_account: form.sales_account || null,
    }),
    onSuccess: () => { inv(); setForm({ name: '', parent_id: 'root', code: '', sales_account: '' }); },
  });
  const del = useMutation({ mutationFn: (id: string) => deleteCategory(id), onSuccess: inv });

  const all = data ?? [];
  const sorted = [...all].sort((a, b) => categoryPath(a, all).localeCompare(categoryPath(b, all)));

  return (
    <>
      <PageHeader
        title="Familles d'articles"
        description="Arborescence Rayon › Sous-rayon › Catégorie (max 3 niveaux). Comptes comptables rattachables."
        actions={<Button variant="outline" onClick={() => navigate({ to: '/parts' })}><ArrowLeft /> {t('articles.title')}</Button>}
      />

      {isLoading && <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}

      {!isLoading && (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th>Famille</Th><Th className="w-20">Code</Th><Th className="w-32">Compte vente</Th><Th className="w-12" /></tr></thead>
              <tbody>
                {sorted.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Aucune famille — ajoutez un rayon.</td></tr>}
                {sorted.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2" style={{ paddingLeft: `${12 + depthOf(c, all) * 20}px` }}>
                      <span className={depthOf(c, all) === 0 ? 'font-bold' : ''}>{c.name}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px]">{c.code ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{c.sales_account ?? '—'}</td>
                    <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => del.mutate(c.id)}><Trash2 className="size-4 text-danger" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-border p-3 sm:grid-cols-5">
            <Input placeholder="Nom de la famille" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <Select value={form.parent_id} onValueChange={(v) => setForm((f) => ({ ...f, parent_id: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="root">— Rayon (racine)</SelectItem>
                {sorted.filter((c) => depthOf(c, all) < 2).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{categoryPath(c, all)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} className="font-mono" />
            <Input placeholder="Compte vente" value={form.sales_account} onChange={(e) => setForm((f) => ({ ...f, sales_account: e.target.value }))} className="font-mono" />
            <Button onClick={() => add.mutate()} disabled={add.isPending || !form.name.trim()}><Plus /> Ajouter</Button>
          </div>
        </div>
      )}
    </>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
