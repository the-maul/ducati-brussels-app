import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, GitMerge, Link2, Loader2, Search, Trash2, Unlink, CornerDownRight } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { useReadOnly } from '@/lib/auth/read-only-context';
import { fillVars, t, pageTitle } from '@/lib/i18n';
import {
  listReplacements, replacementAction, type ReplacementAction, type ReplacementFilters, type ReplacementRow,
} from '@/modules/articles/g8/api';
import { FamilySelects, SupplierSelect } from '@/modules/articles/g8/selection-filters';
import { FieldLabel, QueryError, Td, Th, dateTimeFr, errorText, qty } from '@/modules/articles/g8/ui';

/**
 * M2 — Gestion des remplacements (rattrapage G8 du 18/11/2026).
 * G8 : filtres sur la référence source et la référence cible, date de remplacement, état
 * Tous / Liaison / Redirection ; Supprimer source · Supprimer liaison · Fusionner.
 *   - Redirection : l'ancienne référence renvoie vers la nouvelle (comportement d'origine du DMS) ;
 *   - Liaison : les deux fiches restent consultables, la nouvelle est proposée.
 *   - Fusionner : stock et PAMP passent sur la cible (deux mouvements « transfert », B5 / B7),
 *     codes-barres de la source repris, source désactivée.
 */
export const Route = createFileRoute('/_app/parts/replacements')({
  head: () => ({ meta: [{ title: pageTitle('partsReplacements') }] }),
  component: ReplacementsPage,
});

const PAGE = 200;
const ALL = '__all__';

function ReplacementsPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const readOnly = useReadOnly();
  const [f, setF] = useState<ReplacementFilters>({});
  const [applied, setApplied] = useState<ReplacementFilters | null>(null);
  const [rows, setRows] = useState<ReplacementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof ReplacementFilters>(k: K, v: ReplacementFilters[K]) => setF((p) => ({ ...p, [k]: v }));

  const load = async (filters: ReplacementFilters, off: number) => {
    if (!activeCompanyId) return;
    setLoading(true); setError(null);
    try {
      const r = await listReplacements(activeCompanyId, filters, PAGE, off);
      setRows(r.rows); setTotal(r.total); setOffset(off); setApplied(filters);
    } catch (e) { setError(e); } finally { setLoading(false); }
  };

  const act = useMutation({
    meta: { success: false, error: false },
    mutationFn: ({ row, action }: { row: ReplacementRow; action: ReplacementAction }) => replacementAction(row.source_id, action),
    onSuccess: (r) => {
      toast.success(t(`g8a.repl.result_${r?.result ?? 'done'}`));
      qc.invalidateQueries({ queryKey: ['articles'] });
      if (applied) void load(applied, offset);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const ask = async (row: ReplacementRow, action: ReplacementAction) => {
    if (action === 'merge' || action === 'delete_source' || action === 'unlink') {
      const ok = await confirm({
        title: t(`g8a.repl.confirm_${action}_title`),
        message: fillVars(t(`g8a.repl.confirm_${action}`), { src: row.source_reference, tgt: row.target_reference, qty: qty(row.source_real_qty) }),
        variant: action === 'delete_source' ? 'delete' : 'default',
      });
      if (!ok) return;
    }
    act.mutate({ row, action });
  };

  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('g8a.repl.title')}
        description={t('g8a.repl.description')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/parts' })}><ArrowLeft /> {t('articles.title')}</Button>}
      />
      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <Side title={t('g8a.repl.source')}>
          <div className="space-y-1"><FieldLabel>{t('g8a.filters.supplier')}</FieldLabel><SupplierSelect companyId={activeCompanyId} value={f.src_supplier_id ?? ''} onChange={(v) => set('src_supplier_id', v)} /></div>
          <FamilySelects rayon={f.src_rayon ?? ''} sousRayon={f.src_sous_rayon ?? ''} categorie={f.src_categorie ?? ''}
            onChange={(v) => setF((p) => ({ ...p, src_rayon: v.rayon, src_sous_rayon: v.sousRayon, src_categorie: v.categorie }))} />
          <div className="space-y-1"><FieldLabel>{t('g8a.filters.reference')}</FieldLabel><Input value={f.src_reference ?? ''} onChange={(e) => set('src_reference', e.target.value)} className="w-40 font-mono" /></div>
          <div className="space-y-1"><FieldLabel>{t('g8a.filters.designation')}</FieldLabel><Input value={f.src_designation ?? ''} onChange={(e) => set('src_designation', e.target.value)} className="w-48" /></div>
        </Side>
        <Side title={t('g8a.repl.target')}>
          <div className="space-y-1"><FieldLabel>{t('g8a.filters.supplier')}</FieldLabel><SupplierSelect companyId={activeCompanyId} value={f.tgt_supplier_id ?? ''} onChange={(v) => set('tgt_supplier_id', v)} /></div>
          <FamilySelects rayon={f.tgt_rayon ?? ''} sousRayon={f.tgt_sous_rayon ?? ''} categorie={f.tgt_categorie ?? ''}
            onChange={(v) => setF((p) => ({ ...p, tgt_rayon: v.rayon, tgt_sous_rayon: v.sousRayon, tgt_categorie: v.categorie }))} />
          <div className="space-y-1"><FieldLabel>{t('g8a.filters.reference')}</FieldLabel><Input value={f.tgt_reference ?? ''} onChange={(e) => set('tgt_reference', e.target.value)} className="w-40 font-mono" /></div>
          <div className="space-y-1"><FieldLabel>{t('g8a.filters.designation')}</FieldLabel><Input value={f.tgt_designation ?? ''} onChange={(e) => set('tgt_designation', e.target.value)} className="w-48" /></div>
        </Side>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
        <div className="space-y-1"><FieldLabel>{t('g8a.repl.dateFrom')}</FieldLabel><Input type="date" value={f.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} className="w-40" /></div>
        <div className="space-y-1">
          <FieldLabel>{t('g8a.repl.state')}</FieldLabel>
          <Select value={f.state || ALL} onValueChange={(v) => set('state', (v === ALL ? '' : v) as ReplacementFilters['state'])}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('g8a.filters.all')}</SelectItem>
              <SelectItem value="liaison">{t('g8a.repl.stateLink')}</SelectItem>
              <SelectItem value="redirection">{t('g8a.repl.stateRedirect')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" onClick={() => setF({})}>{t('g8a.filters.reset')}</Button>
        <Button onClick={() => void load(f, 0)} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <Search />} {t('g8a.cascade.list')}</Button>
      </div>
      <QueryError error={error} />
      {applied && (
        <>
          <div className="mb-2 flex items-center justify-between text-[13px] text-muted-foreground">
            <span>{total === 0 ? t('g8a.repl.none') : fillVars(t('g8a.common.range'), { from: offset + 1, to: offset + rows.length, n: total })}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={loading || offset === 0} onClick={() => void load(applied, Math.max(0, offset - PAGE))}><ChevronLeft /> {t('articles.pagePrev')}</Button>
              <Button variant="outline" size="sm" disabled={loading || offset + rows.length >= total} onClick={() => void load(applied, offset + PAGE)}>{t('articles.pageNext')} <ChevronRight /></Button>
            </div>
          </div>
          <div className="overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted">
                <tr>
                  <Th>{t('g8a.repl.colSource')}</Th><Th>{t('g8a.filters.supplier')}</Th><Th className="text-right">{t('g8a.repl.colStock')}</Th>
                  <Th>{t('g8a.repl.state')}</Th><Th />
                  <Th>{t('g8a.repl.colTarget')}</Th><Th>{t('g8a.filters.supplier')}</Th><Th>{t('g8a.repl.colDate')}</Th><Th className="text-right">{t('g8a.repl.colActions')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.source_id} className="border-b border-border last:border-0 hover:bg-accent">
                    <Td>
                      <button type="button" className="font-mono text-[12px] hover:underline" onClick={() => navigate({ to: '/parts/$articleId', params: { articleId: r.source_id }, search: { ancienne: 1 } })}>{r.source_reference}</button>
                      <span className="block max-w-[16rem] truncate text-[11px] text-muted-foreground">{r.source_designation}</span>
                      {!r.source_active && <span className="text-[11px] text-muted-foreground">{t('g8a.repl.inactive')}</span>}
                    </Td>
                    <Td>{r.source_supplier ?? '—'}</Td>
                    <Td className={`text-right tabular-nums ${Number(r.source_real_qty) !== 0 ? 'font-bold text-warning' : ''}`}>{qty(r.source_real_qty)}</Td>
                    <Td>
                      {r.state === 'liaison'
                        ? <StatusBadge tone="info" icon={Link2} label={t('g8a.repl.stateLink')} />
                        : <StatusBadge tone="neutral" icon={CornerDownRight} label={t('g8a.repl.stateRedirect')} />}
                    </Td>
                    <Td><ArrowRight className="size-4 text-muted-foreground" /></Td>
                    <Td>
                      <button type="button" className="font-mono text-[12px] hover:underline" onClick={() => navigate({ to: '/parts/$articleId', params: { articleId: r.target_id } })}>{r.target_reference}</button>
                      <span className="block max-w-[16rem] truncate text-[11px] text-muted-foreground">{r.target_designation}</span>
                    </Td>
                    <Td>{r.target_supplier ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{dateTimeFr(r.replaced_at)}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" disabled={readOnly || act.isPending} title={t(r.state === 'liaison' ? 'g8a.repl.toRedirect' : 'g8a.repl.toLink')}
                          onClick={() => void ask(r, r.state === 'liaison' ? 'set_redirect' : 'set_link')}>
                          {r.state === 'liaison' ? <CornerDownRight className="size-4" /> : <Link2 className="size-4" />}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={readOnly || act.isPending} title={t('g8a.repl.merge')} onClick={() => void ask(r, 'merge')}><GitMerge className="size-4" /></Button>
                        <Button size="sm" variant="ghost" disabled={readOnly || act.isPending} title={t('g8a.repl.unlink')} onClick={() => void ask(r, 'unlink')}><Unlink className="size-4" /></Button>
                        <Button size="sm" variant="ghost" disabled={readOnly || act.isPending} title={t('g8a.repl.deleteSource')} onClick={() => void ask(r, 'delete_source')}><Trash2 className="size-4 text-danger" /></Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Side({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <h3 className="mb-2 font-ui text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </div>
  );
}
