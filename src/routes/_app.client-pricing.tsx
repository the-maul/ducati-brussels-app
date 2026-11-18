import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Calculator } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { listPriceRules, addPriceRule, deletePriceRule, type Tier } from '@/modules/contacts/pricing';
import { searchSaleArticles } from '@/modules/sales/write-api';
import { CustomerPricer, type PricingContact } from '@/modules/sales/customer-pricing-api';
import { PriceListsScreen } from '@/modules/contacts/price-lists-screen';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { effectiveSaleHt, useRoundSalePrices } from '@/lib/pricing';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/client-pricing')({
  head: () => ({ meta: [{ title: pageTitle('clientPricing') }] }),
  component: PricingPage,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

function parseTiers(s: string): Tier[] {
  return s.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const [q, d] = p.split(':');
    return { min_qty: Number(q), discount_pct: Number(d) };
  }).filter((t) => Number.isFinite(t.min_qty));
}

/** Tarifs clients : tarifs communs (G8, rattrapage du 18/11) et regles propres a un client. */
function PricingPage() {
  const { activeCompanyId } = useAuth();
  return (
    <>
      <PageHeader title={t('pricing.title')} description={t('priceLists.subtitle')} />
      <Tabs defaultValue="lists">
        <TabsList>
          <TabsTrigger value="lists">{t('priceLists.tabLists')}</TabsTrigger>
          <TabsTrigger value="clients">{t('priceLists.tabClients')}</TabsTrigger>
        </TabsList>
        <TabsContent value="lists" className="pt-4">{activeCompanyId && <PriceListsScreen companyId={activeCompanyId} />}</TabsContent>
        <TabsContent value="clients" className="pt-4"><ClientRules /></TabsContent>
      </Tabs>
    </>
  );
}

function ClientRules() {
  const { activeCompanyId } = useAuth();
  const roundUp = useRoundSalePrices(activeCompanyId);
  const [client, setClient] = useState('');
  const [kind, setKind] = useState('discount_pct');
  const [value, setValue] = useState('');
  const [tiers, setTiers] = useState('');
  const [label, setLabel] = useState('');
  const [artId, setArtId] = useState('');
  const [artSearch, setArtSearch] = useState('');
  const [simArt, setSimArt] = useState('');
  const [simQty, setSimQty] = useState('1');
  const [resolved, setResolved] = useState<{ ht: number; ttc: number; kind: string; pct: number; list: string | null } | null>(null);

  const contacts = useQuery({ queryKey: ['pricing-contacts', activeCompanyId], queryFn: async () => {
    const { data } = await supabase.from('contacts').select('*').eq('company_id', activeCompanyId!).order('last_name').limit(200);
    return data ?? [];
  }, enabled: !!activeCompanyId });

  const arts = useQuery({ queryKey: ['pricing-arts', activeCompanyId, artSearch], queryFn: () => searchSaleArticles(activeCompanyId!, artSearch), enabled: !!activeCompanyId && artSearch.length > 1 });
  const rules = useQuery({ queryKey: ['price-rules', activeCompanyId, client], queryFn: () => listPriceRules(activeCompanyId!, client), enabled: !!activeCompanyId && !!client });

  const add = useMutation({
    mutationFn: () => addPriceRule(activeCompanyId!, { contact_id: client, article_id: artId || null, kind, value: Number(value.replace(',', '.')) || 0, tiers: kind === 'quantity_tiers' ? parseTiers(tiers) : null, label }),
    onSuccess: () => { setValue(''); setTiers(''); setLabel(''); setArtId(''); rules.refetch(); },
  });
  const del = useMutation({ mutationFn: (id: string) => deletePriceRule(id), onSuccess: () => rules.refetch() });
  const sim = useMutation({
    // Simulation de prix : une lecture, pas une écriture — pas de toast.
    meta: { success: false },
    // Meme calcul que la vente, la caisse et l'OR (tarif commun, regles du client, paliers, dates).
    mutationFn: async () => {
      const a = arts.data?.find((x) => x.id === simArt);
      const c = contacts.data?.find((x) => x.id === client) as PricingContact | undefined;
      if (!a || !c) return null;
      const r = await new CustomerPricer(activeCompanyId!, c).price(a.id, effectiveSaleHt(a.sale_price_ht, a.vat_rate, roundUp), Number(simQty) || 1);
      const net = r.unitPriceHt * (1 - r.discountPct / 100);
      return { ht: net, ttc: net * (1 + a.vat_rate / 100), kind: r.rule ? `${r.rule.source}:${r.rule.kind}` : 'base', pct: r.discountPct, list: r.listCode };
    },
    onSuccess: (r) => setResolved(r),
  });

  const cname = (c: { first_name?: string | null; last_name?: string | null; company_name?: string | null }) => c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';

  return (
    <>
      <p className="mb-3 text-[12px] text-muted-foreground">{t('pricing.subtitle')}</p>
      <div className="mb-4 max-w-md">
        <Select value={client} onValueChange={setClient}>
          <SelectTrigger><SelectValue placeholder={t('pricing.pickClient')} /></SelectTrigger>
          <SelectContent>{contacts.data?.map((c) => <SelectItem key={c.id} value={c.id}>{cname(c)}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {client && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Règles */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('pricing.rules')}</p>
            <div className="mb-3 grid gap-2 rounded-md border border-border bg-card p-3">
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="discount_pct">{t('pricing.kind_discount_pct')}</SelectItem>
                  <SelectItem value="coefficient">{t('pricing.kind_coefficient')}</SelectItem>
                  <SelectItem value="quantity_tiers">{t('pricing.kind_quantity_tiers')}</SelectItem>
                </SelectContent>
              </Select>
              {kind === 'quantity_tiers'
                ? <Input placeholder={t('pricing.tierHint')} value={tiers} onChange={(e) => setTiers(e.target.value)} />
                : <Input placeholder={t('pricing.value')} value={value} onChange={(e) => setValue(e.target.value)} />}
              <Input placeholder={`${t('pricing.article')} (recherche, optionnel)`} value={artSearch} onChange={(e) => setArtSearch(e.target.value)} />
              {arts.data && arts.data.length > 0 && (
                <Select value={artId} onValueChange={setArtId}>
                  <SelectTrigger><SelectValue placeholder={t('pricing.allArticles')} /></SelectTrigger>
                  <SelectContent>{arts.data.map((a) => <SelectItem key={a.id} value={a.id}>{a.reference} — {a.designation}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <Input placeholder={t('pricing.label')} value={label} onChange={(e) => setLabel(e.target.value)} />
              <Button onClick={() => add.mutate()} disabled={add.isPending}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('pricing.addRule')}</Button>
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full border-collapse font-data text-[12px]">
                <thead className="bg-muted"><tr><Th>{t('pricing.kind')}</Th><Th>{t('pricing.value')}</Th><Th>{t('pricing.label')}</Th><Th /></tr></thead>
                <tbody>
                  {rules.data?.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">{t('pricing.noRules')}</td></tr>}
                  {rules.data?.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5">{t(`pricing.kind_${r.kind}`)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{r.kind === 'quantity_tiers' ? JSON.stringify(r.tiers) : r.value}</td>
                      <td className="px-3 py-1.5">{r.label}{r.article_id ? ' (article)' : ''}</td>
                      <td className="px-3 py-1.5 text-right"><Button variant="ghost" size="sm" onClick={() => del.mutate(r.id)}><Trash2 className="size-3.5" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Simulateur */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('pricing.simulator')}</p>
            <div className="grid gap-2 rounded-md border border-border bg-card p-3">
              <Input placeholder={`${t('pricing.article')} (recherche)`} value={artSearch} onChange={(e) => setArtSearch(e.target.value)} />
              {arts.data && arts.data.length > 0 && (
                <Select value={simArt} onValueChange={setSimArt}>
                  <SelectTrigger><SelectValue placeholder={t('pricing.article')} /></SelectTrigger>
                  <SelectContent>{arts.data.map((a) => <SelectItem key={a.id} value={a.id}>{a.reference} — {a.designation}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <Input type="number" placeholder={t('pricing.qty')} value={simQty} onChange={(e) => setSimQty(e.target.value)} />
              <Button onClick={() => sim.mutate()} disabled={sim.isPending || !simArt}>{sim.isPending ? <Loader2 className="animate-spin" /> : <Calculator className="size-4" />} {t('pricing.simulate')}</Button>
              {resolved && (
                <div className="rounded-md bg-muted p-3 text-[13px]">
                  <div className="flex justify-between"><span>{t('pricing.resolvedHt')}</span><strong className="tabular-nums">{eur(resolved.ht)}</strong></div>
                  <div className="flex justify-between"><span>{t('pricing.resolvedTtc')}</span><strong className="tabular-nums">{eur(resolved.ttc)}</strong></div>
                  <div className="mt-1 text-[12px] text-muted-foreground">{t('pricing.applied')} : {resolved.kind === 'base' ? t('priceLists.simBase') : t(`priceLists.simSource_${resolved.kind.split(':')[0]}`)}{resolved.list ? ` ${resolved.list}` : ''} {resolved.pct ? `(−${resolved.pct}%)` : ''}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>; }
