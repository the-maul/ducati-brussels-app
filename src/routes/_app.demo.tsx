import { createFileRoute } from '@tanstack/react-router';
import { Plus, Euro, Wrench, Gauge, Bike } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/kpi-card';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import type { ReactNode } from 'react';

export const Route = createFileRoute('/_app/demo')({
  head: () => ({ meta: [{ title: 'Charte — Ducati Bruxelles' }] }),
  component: DemoCharte,
});

/* ---------- Données synthétiques (déterministes : pas de mismatch SSR) ---------- */
const MODELS = [
  'Panigale V4', 'Monster', 'Multistrada V4', 'Streetfighter V4',
  'Diavel V4', 'Hypermotard 950', 'Scrambler Icon', 'SuperSport 950',
];
const VEH_STATUS: { tone: StatusTone; key: string }[] = [
  { tone: 'success', key: 'status.veh_instock' },
  { tone: 'warning', key: 'status.veh_reserved' },
  { tone: 'info', key: 'status.veh_prep' },
  { tone: 'neutral', key: 'status.veh_sold' },
  { tone: 'info', key: 'status.veh_ordered' },
];

function fmtEur(n: number): string {
  const s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${s} €`;
}

function buildVin(i: number): string {
  return ('ZDM' + String(10000 + i) + 'B9W7HV' + String(100000 + i)).slice(0, 17).toUpperCase();
}

const ROWS = Array.from({ length: 50 }, (_, i) => ({
  vin: buildVin(i),
  model: MODELS[i % MODELS.length],
  status: VEH_STATUS[i % VEH_STATUS.length],
  price: 8000 + i * 137,
}));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 font-ui text-[17px] font-bold leading-[24px] text-foreground">{title}</h2>
      <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        {children}
      </div>
    </section>
  );
}

function DemoCharte() {
  return (
    <>
      <PageHeader title={t('demo.title')} description={t('demo.subtitle')} />

      {/* Typographie */}
      <Section title={t('demo.sectionTypography')}>
        <div className="space-y-2">
          <p className="font-display text-[28px] font-bold uppercase leading-[34px]">Atelier &amp; SAV</p>
          <p className="font-ui text-[22px] font-bold leading-[28px]">Ordre de réparation #2026-0412</p>
          <p className="font-ui text-[17px] font-bold leading-[24px]">Section de formulaire</p>
          <p className="font-ui text-[14px] leading-[20px]">Texte courant — corps de formulaire en Ducati Style.</p>
          <p className="font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">Label de champ</p>
          <p className="font-data text-[13px] leading-[18px]">Donnée dense en Ducati Style Cond — tableaux et listes.</p>
          <p className="mono text-[13px]">VIN ZDMABCDEF12345678 · réf. 96480471A</p>
        </div>
      </Section>

      {/* Boutons */}
      <Section title={t('demo.sectionButtons')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="default"><Plus /> {t('demo.btnPrimary')}</Button>
          <Button variant="outline">{t('demo.btnSecondary')}</Button>
          <Button variant="ghost">{t('demo.btnGhost')}</Button>
          <Button variant="destructive">{t('demo.btnDanger')}</Button>
          <Button variant="default" disabled>{t('demo.btnDisabled')}</Button>
        </div>
      </Section>

      {/* Badges de statut */}
      <Section title={t('demo.sectionBadges')}>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="info" label={t('status.or_planned')} />
          <StatusBadge tone="info" label={t('status.or_inprogress')} />
          <StatusBadge tone="warning" label={t('status.or_waitingparts')} />
          <StatusBadge tone="warning" label={t('status.or_tobill')} />
          <StatusBadge tone="success" label={t('status.or_closed')} />
          <StatusBadge tone="danger" label={t('status.or_blocked')} />
          <StatusBadge tone="success" label={t('status.inv_paid')} />
          <StatusBadge tone="danger" label={t('status.inv_unpaid')} />
          <StatusBadge tone="neutral" label={t('status.inv_draft')} />
        </div>
      </Section>

      {/* KPI */}
      <Section title={t('demo.sectionKpi')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label={t('demo.kpiRevenueDay')} value="4 280 €" delta="+12 %" deltaTone="success" icon={Euro} />
          <KpiCard label={t('demo.kpiOrOpen')} value="7" delta="-2" deltaTone="danger" icon={Wrench} />
          <KpiCard label={t('demo.kpiOccupancy')} value="82 %" delta="+5 %" deltaTone="success" icon={Gauge} />
          <KpiCard label={t('demo.kpiStockVehicles')} value="23" icon={Bike} />
        </div>
      </Section>

      {/* Tableau dense (50 lignes, Cond) */}
      <Section title={t('demo.sectionTable')}>
        <div className="overflow-hidden rounded-md border border-border">
          <div className="max-h-96 overflow-auto">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <Th>{t('demo.colVin')}</Th>
                  <Th>{t('demo.colModel')}</Th>
                  <Th>{t('demo.colStatus')}</Th>
                  <Th className="text-right">{t('demo.colPrice')}</Th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.vin} className="border-b border-border last:border-0 hover:bg-accent">
                    <td className="px-3 py-2 font-mono text-[12px]">{r.vin}</td>
                    <td className="px-3 py-2">{r.model}</td>
                    <td className="px-3 py-2"><StatusBadge tone={r.status.tone} label={t(r.status.key)} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtEur(r.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* Couleurs */}
      <Section title={t('demo.sectionColors')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          <Swatch className="bg-primary text-primary-foreground" name="Rouge Ducati" />
          <Swatch className="bg-success text-white" name="Success" />
          <Swatch className="bg-warning text-white" name="Warning" />
          <Swatch className="bg-danger text-white" name="Danger" />
          <Swatch className="bg-info text-white" name="Info" />
          <Swatch className="bg-sidebar text-white" name="Noir Ducati" />
          <Swatch className="bg-job-entretien text-white" name="Entretien" />
          <Swatch className="bg-job-reparation text-white" name="Réparation" />
          <Swatch className="bg-job-garantie text-white" name="Garantie" />
          <Swatch className="bg-job-pneus text-white" name="Pneus" />
          <Swatch className="bg-job-prepa text-white" name="Préparation" />
          <Swatch className="bg-job-carrosserie text-white" name="Carrosserie" />
        </div>
      </Section>
    </>
  );
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}
    >
      {children}
    </th>
  );
}

function Swatch({ className, name }: { className: string; name: string }) {
  return (
    <div className={`flex h-16 items-end rounded-md p-2 text-[12px] font-medium ${className}`}>
      {name}
    </div>
  );
}
