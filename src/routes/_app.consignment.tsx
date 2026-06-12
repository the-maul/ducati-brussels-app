import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, Plus, HandCoins } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { listConsignments, createConsignment, settleConsignment } from '@/modules/tradein/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/consignment')({
  head: () => ({ meta: [{ title: 'Dépôt-vente — Ducati Bruxelles' }] }),
  component: ConsignmentPage,
});

const eur = (n: number | null) => `${(Math.round(Number(n ?? 0) * 100) / 100).toFixed(2).replace('.', ',')} €`;

function ConsignmentPage() {
  const { activeCompanyId } = useAuth();
  const [form, setForm] = useState({ depositor_id: '', number: '', agreed_price: '', commission_pct: '10' });
  const [salePrice, setSalePrice] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const contacts = useQuery({ queryKey: ['consign-contacts', activeCompanyId], queryFn: async () => {
    const { data } = await supabase.from('contacts').select('id, first_name, last_name, company_name').eq('company_id', activeCompanyId!).order('last_name').limit(200);
    return data ?? [];
  }, enabled: !!activeCompanyId });
  const list = useQuery({ queryKey: ['consignments', activeCompanyId], queryFn: () => listConsignments(activeCompanyId!), enabled: !!activeCompanyId });

  const add = useMutation({
    mutationFn: () => createConsignment(activeCompanyId!, { depositor_id: form.depositor_id || null, number: form.number, agreed_price: Number(form.agreed_price.replace(',', '.')) || 0, commission_pct: Number(form.commission_pct.replace(',', '.')) || 0 }),
    onSuccess: () => { setForm({ depositor_id: '', number: '', agreed_price: '', commission_pct: '10' }); list.refetch(); },
  });
  const settle = useMutation({
    mutationFn: (v: { id: string; price: number }) => settleConsignment(v.id, v.price),
    onSuccess: (r) => { setMsg(t('consign.settled').replace('{c}', eur(r.commission)).replace('{r}', eur(r.reversal))); list.refetch(); },
  });
  const cname = (c: { first_name?: string | null; last_name?: string | null; company_name?: string | null }) => c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';

  return (
    <>
      <PageHeader title={t('consign.title')} description={t('consign.subtitle')} />
      {msg && <p className="mb-3 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">{msg}</p>}

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-3">
        <div className="w-56"><Select value={form.depositor_id} onValueChange={(v) => setForm({ ...form, depositor_id: v })}><SelectTrigger><SelectValue placeholder={t('consign.depositor')} /></SelectTrigger><SelectContent>{contacts.data?.map((c) => <SelectItem key={c.id} value={c.id}>{cname(c)}</SelectItem>)}</SelectContent></Select></div>
        <Input className="w-32" placeholder={t('consign.number')} value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
        <Input className="w-32" placeholder={t('consign.agreed')} value={form.agreed_price} onChange={(e) => setForm({ ...form, agreed_price: e.target.value })} />
        <Input className="w-24" placeholder={t('consign.commission')} value={form.commission_pct} onChange={(e) => setForm({ ...form, commission_pct: e.target.value })} />
        <Button onClick={() => add.mutate()} disabled={add.isPending}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('consign.add')}</Button>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>{t('consign.number')}</Th><Th>{t('consign.depositor')}</Th><Th className="text-right">{t('consign.agreed')}</Th><Th className="text-right">{t('consign.commission')}</Th><Th>{t('consign.status')}</Th><Th>{t('consign.settle')}</Th></tr></thead>
          <tbody>
            {list.data?.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('consign.empty')}</td></tr>}
            {list.data?.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono">{c.number ?? '—'}</td>
                <td className="px-3 py-2">{contacts.data?.find((x) => x.id === c.depositor_id) ? cname(contacts.data.find((x) => x.id === c.depositor_id)!) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(c.agreed_price)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.commission_pct} %</td>
                <td className="px-3 py-2">{t(`consign.st_${c.status}`)}{c.status === 'vendu' ? ` (${t('consign.commAmount')} ${eur(c.sold_commission)}, ${t('consign.reversal')} ${eur(c.sold_reversal)})` : ''}</td>
                <td className="px-3 py-2">
                  {c.status === 'en_depot' && (
                    <div className="flex gap-1">
                      <Input className="h-8 w-24" placeholder={t('consign.salePrice')} value={salePrice[c.id] ?? ''} onChange={(e) => setSalePrice((s) => ({ ...s, [c.id]: e.target.value }))} />
                      <Button size="sm" variant="outline" onClick={() => settle.mutate({ id: c.id, price: Number((salePrice[c.id] ?? '').replace(',', '.')) || Number(c.agreed_price) })}><HandCoins className="size-3.5" /></Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>; }
