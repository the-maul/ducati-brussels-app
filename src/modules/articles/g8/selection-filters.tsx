/**
 * M2 — Rattrapage G8 (18/11/2026) : filtres de sélection d'articles (G8 « Modification cascade
 * Art/Lib » et outils de prix) : fournisseur, marque, fichier (article / librairie), TVA,
 * rayon / sous-rayon / catégorie, année, référence, désignation, casier, PV / PPC, stocks,
 * type de gestion, « inutilisé depuis N mois », stock mini / maxi, éco-participation, tranche
 * de PA, et sélection par fichier (liste de références au format microfiches).
 */
import { useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileUp, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fillVars, t } from '@/lib/i18n';
import { listSuppliers, supplierName } from '@/modules/purchases/api';
import { MGMT_TYPES } from '../api';
import { RAYONS_SORTED, categoriesFor, sousRayonsFor } from '../product-families';
import { parseMicrofiche } from './microfiche';
import type { SelectionFilters } from './api';
import { FieldLabel } from './ui';

const ALL = '__all__';

export function useSuppliers(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ['g8-suppliers', companyId],
    queryFn: () => listSuppliers(companyId!, '', 1000),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function SupplierSelect({ companyId, value, onChange, allowAll = true, className = 'w-56' }: {
  companyId: string; value: string; onChange: (v: string) => void; allowAll?: boolean; className?: string;
}) {
  const { data } = useSuppliers(companyId);
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <SelectTrigger className={className}><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-72">
        {allowAll && <SelectItem value={ALL}>{t('g8a.filters.all')}</SelectItem>}
        {(data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{supplierName(s)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Trois menus en cascade Rayon › Sous-rayon › Catégorie (codes « RR », « SS », « CC »). */
export function FamilySelects({ rayon, sousRayon, categorie, onChange }: {
  rayon: string; sousRayon: string; categorie: string;
  onChange: (v: { rayon: string; sousRayon: string; categorie: string }) => void;
}) {
  return (
    <>
      <Box label={t('articles.rayon')}>
        <Select value={rayon || ALL} onValueChange={(v) => onChange({ rayon: v === ALL ? '' : v, sousRayon: '', categorie: '' })}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL}>{t('g8a.filters.all')}</SelectItem>
            {RAYONS_SORTED.map((r) => <SelectItem key={r.code} value={r.code}>{r.code} {r.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Box>
      <Box label={t('articles.subRayon')}>
        <Select value={sousRayon || ALL} disabled={!rayon} onValueChange={(v) => onChange({ rayon, sousRayon: v === ALL ? '' : v, categorie: '' })}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL}>{t('g8a.filters.all')}</SelectItem>
            {sousRayonsFor(rayon).map((s) => <SelectItem key={s.code} value={s.code}>{s.code} {s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Box>
      <Box label={t('articles.categoryLevel')}>
        <Select value={categorie || ALL} disabled={!sousRayon} onValueChange={(v) => onChange({ rayon, sousRayon, categorie: v === ALL ? '' : v })}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL}>{t('g8a.filters.all')}</SelectItem>
            {categoriesFor(rayon, sousRayon).map((c) => <SelectItem key={c.code} value={c.code}>{c.code} {c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Box>
    </>
  );
}

function Box({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><FieldLabel>{label}</FieldLabel>{children}</div>;
}

function Choice({ value, onChange, options, className = 'w-40' }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string;
}) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <SelectTrigger className={className}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t('g8a.filters.all')}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function SelectionFiltersForm({ companyId, value, onChange, compact = false }: {
  companyId: string; value: SelectionFilters; onChange: (f: SelectionFilters) => void; compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof SelectionFilters>(k: K, v: SelectionFilters[K]) => onChange({ ...value, [k]: v });
  const onFile = async (f: File | null) => {
    if (!f) return;
    const refs = parseMicrofiche(await f.text()).lines.map((l) => l.reference);
    onChange({ ...value, refs });
    if (fileRef.current) fileRef.current.value = '';
  };
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Box label={t('g8a.filters.supplier')}><SupplierSelect companyId={companyId} value={value.supplier_id ?? ''} onChange={(v) => set('supplier_id', v)} /></Box>
      <FamilySelects rayon={value.rayon ?? ''} sousRayon={value.sous_rayon ?? ''} categorie={value.categorie ?? ''}
        onChange={(v) => onChange({ ...value, rayon: v.rayon, sous_rayon: v.sousRayon, categorie: v.categorie })} />
      <Box label={t('g8a.filters.brand')}><Input value={value.brand ?? ''} onChange={(e) => set('brand', e.target.value)} className="w-36" /></Box>
      <Box label={t('g8a.filters.reference')}><Input value={value.reference ?? ''} onChange={(e) => set('reference', e.target.value)} className="w-36 font-mono" /></Box>
      <Box label={t('g8a.filters.designation')}><Input value={value.designation ?? ''} onChange={(e) => set('designation', e.target.value)} className="w-44" /></Box>
      {!compact && (
        <>
          <Box label={t('g8a.filters.file')}>
            <Choice value={value.file ?? ''} onChange={(v) => set('file', (v || undefined) as SelectionFilters['file'])}
              options={[{ value: 'article', label: t('g8a.filters.fileArticle') }, { value: 'library', label: t('g8a.filters.fileLibrary') }]} />
          </Box>
          <Box label={t('g8a.filters.mgmtType')}>
            <Choice value={value.mgmt_type ?? ''} onChange={(v) => set('mgmt_type', v)} className="w-52"
              options={MGMT_TYPES.map((m) => ({ value: m.value, label: m.label }))} />
          </Box>
          <Box label={t('g8a.filters.vat')}><Input value={value.vat_rate ?? ''} onChange={(e) => set('vat_rate', e.target.value)} className="w-20 text-right tabular-nums" placeholder="21" /></Box>
          <Box label={t('g8a.filters.year')}><Input value={value.year ?? ''} onChange={(e) => set('year', e.target.value)} className="w-24 tabular-nums" placeholder="2024" /></Box>
          <Box label={t('g8a.filters.bin')}><Input value={value.bin ?? ''} onChange={(e) => set('bin', e.target.value)} className="w-28 font-mono" /></Box>
          <Box label={t('g8a.filters.pvPpc')}>
            <Choice value={value.pv_ppc ?? ''} onChange={(v) => set('pv_ppc', v as SelectionFilters['pv_ppc'])} className="w-44"
              options={[
                { value: 'below', label: t('g8a.filters.pvBelow') }, { value: 'equal', label: t('g8a.filters.pvEqual') },
                { value: 'above', label: t('g8a.filters.pvAbove') }, { value: 'no_ppc', label: t('g8a.filters.noPpc') },
              ]} />
          </Box>
          <Box label={t('g8a.filters.stock')}>
            <Choice value={value.stock ?? ''} onChange={(v) => set('stock', v as SelectionFilters['stock'])}
              options={[
                { value: 'pos', label: t('g8a.filters.stockPos') }, { value: 'neg', label: t('g8a.filters.stockNeg') },
                { value: 'zero', label: t('g8a.filters.stockZero') }, { value: 'nonzero', label: t('g8a.filters.stockNonZero') },
              ]} />
          </Box>
          <Box label={t('g8a.filters.stockMin')}>
            <Choice value={value.stock_min ?? ''} onChange={(v) => set('stock_min', v as SelectionFilters['stock_min'])}
              options={[{ value: 'set', label: t('g8a.filters.minSet') }, { value: 'unset', label: t('g8a.filters.minUnset') }, { value: 'below', label: t('g8a.filters.minBelow') }]} />
          </Box>
          <Box label={t('g8a.filters.stockMax')}>
            <Choice value={value.stock_max ?? ''} onChange={(v) => set('stock_max', v as SelectionFilters['stock_max'])}
              options={[{ value: 'set', label: t('g8a.filters.maxSet') }, { value: 'unset', label: t('g8a.filters.maxUnset') }, { value: 'above', label: t('g8a.filters.maxAbove') }]} />
          </Box>
          <Box label={t('g8a.filters.unused')}>
            <Input value={value.unused_months ?? ''} onChange={(e) => set('unused_months', e.target.value.replace(/[^0-9]/g, ''))} className="w-24 text-right tabular-nums" placeholder={t('g8a.filters.months')} />
          </Box>
          <Box label={t('g8a.filters.paRange')}>
            <div className="flex items-center gap-1">
              <Input value={value.pa_from ?? ''} onChange={(e) => set('pa_from', e.target.value)} className="w-20 text-right tabular-nums" />
              <span className="text-muted-foreground">–</span>
              <Input value={value.pa_to ?? ''} onChange={(e) => set('pa_to', e.target.value)} className="w-20 text-right tabular-nums" />
            </div>
          </Box>
          <label className="flex h-9 items-center gap-2 text-sm">
            <Checkbox checked={!!value.eco} onCheckedChange={(v) => set('eco', v === true)} />{t('g8a.filters.eco')}
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <Checkbox checked={!!value.include_inactive} onCheckedChange={(v) => set('include_inactive', v === true)} />{t('g8a.filters.inactive')}
          </label>
        </>
      )}
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} title={t('g8a.filters.byFileHint')}>
          <FileUp /> {t('g8a.filters.byFile')}
        </Button>
        {value.refs && value.refs.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-[var(--radius-badge)] bg-info-bg px-2 py-1 text-[12px] text-info">
            {fillVars(t('g8a.filters.refsCount'), { n: value.refs.length })}
            <button type="button" onClick={() => set('refs', [])} aria-label={t('g8a.filters.reset')}><X className="size-3" /></button>
          </span>
        )}
      </div>
    </div>
  );
}
