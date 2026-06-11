import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listCessions, recordCession } from '@/modules/stock/stock-api';
import { searchPurchaseArticles, type PurchaseArticle } from '@/modules/purchases/api';
import { listRef } from '@/modules/settings/reference-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/stock/cessions')({
  head: () => ({ meta: [{ title: 'Cessions internes — Ducati Bruxelles' }] }),
  component: CessionsPage,
});

const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

function CessionsPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: cessions } = useQuery({ queryKey: ['cessions', activeCompanyId], queryFn: () => listCessions(activeCompanyId!), enabled: !!activeCompanyId });
  const { data: types } = useQuery({ queryKey: ['cession-types', activeCompanyId], queryFn: () => listRef(activeCompanyId!, 'cession_type'), enabled: !!activeCompanyId });

  const [articleId, setArticleId] = useState<string | null>(null);
  const [articleLabel, setArticleLabel] = useState('');
  const [qty, setQty] = useState('1');
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => recordCession(articleId!, num(qty), type, note),
    onSuccess: () => { setArticleId(null); setArticleLabel(''); setQty('1'); setNote(''); qc.invalidateQueries({ queryKey: ['cessions', activeCompanyId] }); },
    onError: (e) => setError(e instanceof Error ? e.message : t('stock.cessionErr')),
  });

  return (
    <>
      <PageHeader
        title={t('stock.cessionsTitle')}
        description={t('stock.cessionsSubtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/stock' })}><ArrowLeft /> {t('stock.title')}</Button>}
      />
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
        <Field label={t('stock.cessionArticle')}>
          {articleId
            ? <div className="flex h-9 w-64 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"><span className="truncate">{articleLabel}</span><button type="button" className="ml-auto text-muted-foreground" onClick={() => { setArticleId(null); setArticleLabel(''); }}>×</button></div>
            : <ArticlePicker companyId={activeCompanyId!} onPick={(a) => { setArticleId(a.id); setArticleLabel(`${a.reference} ${a.designation}`); }} />}
        </Field>
        <Field label={t('stock.cessionQty')}><Input type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className="w-24 text-right tabular-nums" /></Field>
        <Field label={t('stock.cessionType')}>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{(types ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={t('stock.cessionNote')}><Input value={note} onChange={(e) => setNote(e.target.value)} className="w-48" /></Field>
        <Button onClick={() => add.mutate()} disabled={add.isPending || !articleId || !type || num(qty) <= 0}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('stock.cessionAdd')}</Button>
      </div>
      {error && <p className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>{t('stock.colDate')}</Th><Th>{t('stock.cessionType')}</Th><Th className="text-right">{t('stock.colQty')}</Th><Th>{t('stock.cessionNote')}</Th></tr></thead>
          <tbody>
            {cessions && cessions.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">—</td></tr>}
            {cessions?.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono text-[12px]">{new Date(m.occurred_at).toLocaleString('fr-BE')}</td>
                <td className="px-3 py-2">{m.ref ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-danger">{Number(m.qty_delta)}</td>
                <td className="px-3 py-2">{m.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ArticlePicker({ companyId, onPick }: { companyId: string; onPick: (a: PurchaseArticle) => void }) {
  const [value, setValue] = useState('');
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(value.trim()), 250); return () => clearTimeout(id); }, [value]);
  const { data } = useQuery({ queryKey: ['cession-art', companyId, deb], queryFn: () => searchPurchaseArticles(companyId, deb), enabled: deb.length >= 2 });
  return (
    <div className="relative">
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('stock.cessionArticlePlaceholder')} className="w-64" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.map((a) => (
            <button key={a.id} type="button" onClick={() => onPick(a)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
              <span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
