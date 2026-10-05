/**
 * « Mes factures » : factures, avoirs et tickets du client.
 *   - documents repris de G8 : on ouvre le PDF d'origine (pièce jointe du document) ;
 *   - documents créés dans le DMS : pas de PDF archivé (M6 imprime en HTML), on affiche
 *     la facture à l'écran avec un bouton « Imprimer / enregistrer en PDF » du navigateur.
 */
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Bike, Calendar, ChevronRight, Euro, FileDown, FileText, Printer, User, X, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import {
  ALL, NO_FILTER, buildInvoiceFilterOptions, filterInvoices, isFiltered, type InvoiceFilters,
} from './invoice-filters';
import { t } from '@/lib/i18n';
import { getInvoice, listInvoices, openFile } from './api';
import { Card, EmptyState, ErrorBox, InvoiceStatus, Loading, PortalPage, SectionTitle, dateFr, eur } from './ui';

const openPdf = (path: string) =>
  openFile(path).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));

/**
 * Un filtre = une puce compacte sur une seule ligne (l'écran du client est un
 * téléphone : quatre menus pleine largeur mangeaient toute la page).
 * La puce porte le nom du critère tant qu'on n'a rien choisi, puis la valeur.
 * Elle n'apparaît que s'il y a vraiment un choix à faire.
 */
function FilterChip({
  value, onChange, name, allLabel, options, icon: Icon,
}: {
  value: string;
  onChange: (v: string) => void;
  name: string;
  allLabel: string;
  options: { value: string; label: string }[];
  icon: LucideIcon;
}) {
  if (options.length < 2) return null;
  const active = value !== ALL;
  const label = active ? (options.find((o) => o.value === value)?.label ?? name) : name;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={name}
        title={name}
        className={`h-8 w-auto max-w-[9rem] shrink-0 gap-1 rounded-full px-2.5 text-[12px] sm:max-w-none ${
          active ? 'border-foreground font-medium text-foreground' : 'text-muted-foreground'
        }`}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {/* Sur téléphone, le nom du critère laisse la place à l'icone seule ;
            une fois un filtre choisi, c'est la valeur qui s'affiche. */}
        <span className={`truncate ${active ? '' : 'hidden sm:inline'}`}>{label}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function InvoiceListView() {
  const { data, isLoading, error } = useQuery({ queryKey: ['portal', 'invoices'], queryFn: listInvoices });
  const [filters, setFilters] = useState<InvoiceFilters>(NO_FILTER);
  const set = (k: keyof InvoiceFilters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));

  const opts = useMemo(
    () => buildInvoiceFilterOptions(data ?? [], t('portal.invoices.filterMine'),
      (key) => t(`portal.invoices.amount_${key}`)),
    [data],
  );
  const rows = useMemo(() => filterInvoices(data ?? [], filters), [data, filters]);
  const filtered = isFiltered(filters);
  const total = rows.reduce((s, d) => s + Number(d.total_ttc), 0);

  return (
    <PortalPage title={t('portal.invoices.title')} subtitle={t('portal.invoices.subtitle')}>
      {isLoading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && data.length === 0 && <EmptyState icon={<FileText className="size-8" />} text={t('portal.invoices.empty')} />}
      {data && data.length > 0 && (
        <>
          {/* Une seule ligne, qui défile latéralement si les puces débordent. */}
          <div className="-mx-1 mb-2 flex items-center gap-1.5 overflow-x-auto px-1 pb-1">
            <FilterChip
              value={filters.vehicle} onChange={set('vehicle')}
              name={t('portal.invoices.chipVehicle')} allLabel={t('portal.invoices.filterVehicle')}
              options={opts.vehicles} icon={Bike}
            />
            <FilterChip
              value={filters.profile} onChange={set('profile')}
              name={t('portal.invoices.chipProfile')} allLabel={t('portal.invoices.filterProfile')}
              options={opts.profiles} icon={User}
            />
            <FilterChip
              value={filters.year} onChange={set('year')}
              name={t('portal.invoices.chipYear')} allLabel={t('portal.invoices.filterYear')}
              options={opts.years} icon={Calendar}
            />
            <FilterChip
              value={filters.amount} onChange={set('amount')}
              name={t('portal.invoices.chipAmount')} allLabel={t('portal.invoices.filterAmount')}
              options={opts.amounts} icon={Euro}
            />
            {filtered && (
              <button
                type="button"
                onClick={() => setFilters(NO_FILTER)}
                aria-label={t('portal.invoices.filterReset')}
                title={t('portal.invoices.filterReset')}
                className="flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
                <span className="hidden sm:inline">{t('portal.invoices.filterReset')}</span>
              </button>
            )}
          </div>

          <p className="mb-2 text-[12px] text-muted-foreground">
            {rows.length} {rows.length > 1 ? t('portal.invoices.countMany') : t('portal.invoices.countOne')}
            {' · '}{eur(total)}
          </p>

          {rows.length === 0 && (
            <EmptyState
              icon={<FileText className="size-8" />}
              text={t('portal.invoices.noMatch')}
              action={<Button variant="outline" onClick={() => setFilters(NO_FILTER)}>{t('portal.invoices.filterReset')}</Button>}
            />
          )}

          {rows.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border bg-card">
              {rows.map((d) => {
                const due = Number(d.total_ttc) - Number(d.paid_amount);
                return (
                  <li key={d.id} className="flex items-center gap-2 px-3 py-3">
                    <Link to="/mon-espace/factures/$documentId" params={{ documentId: d.id }} className="flex min-w-0 flex-1 items-center gap-3">
                      <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">
                          {t(`portal.docTypes.${d.doc_type}`)} {d.number ?? ''}
                        </p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {[dateFr(d.issue_date), d.vehicle_label].filter(Boolean).join(' · ')}
                        </p>
                        {/* Facture au nom d'une autre fiche (fiche liée, organisme de
                            financement de la moto) : on le dit, sinon le client ne
                            comprend pas pourquoi elle est dans sa liste. */}
                        {d.on_behalf && (
                          <p className="truncate text-[12px] text-muted-foreground">
                            {t('portal.invoices.onBehalf')} {d.on_behalf}
                          </p>
                        )}
                        <div className="mt-1"><InvoiceStatus status={d.status} docType={d.doc_type} due={due} /></div>
                      </div>
                      <span className="shrink-0 font-data text-[15px] font-bold tabular-nums">{eur(d.total_ttc)}</span>
                    </Link>
                    {d.pdf_path ? (
                      <Button variant="ghost" size="icon" onClick={() => openPdf(d.pdf_path!)} aria-label={t('portal.invoices.openPdf')} title={t('portal.invoices.openPdf')}>
                        <FileDown className="size-5" />
                      </Button>
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </PortalPage>
  );
}

export function InvoiceDetailView({ documentId }: { documentId: string }) {
  const { data: d, isLoading, error } = useQuery({
    queryKey: ['portal', 'invoice', documentId],
    queryFn: () => getInvoice(documentId),
  });
  if (isLoading) return <Loading />;
  if (error || !d) return <ErrorBox error={error} />;

  const due = Number(d.total_ttc) - Number(d.paid_amount);
  const customer = d.customer.company_name
    || [d.customer.first_name, d.customer.last_name].filter(Boolean).join(' ');
  const received = d.payments.filter((p) => p.status !== 'attendu');

  return (
    <PortalPage
      title={`${t(`portal.docTypes.${d.doc_type}`)} ${d.number ?? ''}`}
      subtitle={dateFr(d.issue_date)}
    >
      <div className="flex flex-wrap gap-2 print:hidden">
        {d.pdf_path && (
          <Button onClick={() => openPdf(d.pdf_path!)}><FileDown /> {t('portal.invoices.openPdf')}</Button>
        )}
        <Button variant="outline" onClick={() => window.print()}><Printer /> {t('portal.invoices.print')}</Button>
      </div>
      {d.imported && d.lines.length === 0 && (
        <p className="text-[13px] text-muted-foreground print:hidden">{t('portal.invoices.importedHint')}</p>
      )}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-[13px]">
            <p className="font-bold">{d.company.legal_name || d.company.name}</p>
            <p className="text-muted-foreground">{[d.company.address, [d.company.zip, d.company.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>
            {d.company.vat_number && <p className="text-muted-foreground">{t('portal.invoices.vat')} {d.company.vat_number}</p>}
          </div>
          <InvoiceStatus status={d.status} docType={d.doc_type} due={due} />
        </div>

        <div className="text-[13px]">
          <SectionTitle>{t('portal.invoices.billedTo')}</SectionTitle>
          <p className="font-medium">{customer}</p>
          <p className="text-muted-foreground">
            {[[d.customer.address, d.customer.street_number].filter(Boolean).join(' '), [d.customer.zip, d.customer.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
          </p>
          {d.customer.vat_number && <p className="text-muted-foreground">{t('portal.invoices.vat')} {d.customer.vat_number}</p>}
          {d.vehicle && (
            <p className="mt-1 text-muted-foreground">
              {[d.vehicle.brand, d.vehicle.model].filter(Boolean).join(' ')}
              {d.vehicle.vin ? <> · <span className="font-mono">{d.vehicle.vin}</span></> : null}
              {d.vehicle.plate ? ` · ${d.vehicle.plate}` : ''}
            </p>
          )}
        </div>

        {d.lines.length > 0 && (
          <div>
            <SectionTitle>{t('portal.invoices.lines')}</SectionTitle>
            <ul className="divide-y divide-border">
              {d.lines.map((l, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[14px]">{l.designation}</p>
                    <p className="font-data text-[12px] tabular-nums text-muted-foreground">
                      {[l.reference, `${Number(l.quantity)} × ${eur(l.unit_price_ht)} ${t('portal.invoices.ht')}`,
                        l.discount_pct ? `-${Number(l.discount_pct)} %` : null, `${t('portal.invoices.vatShort')} ${Number(l.vat_rate)} %`]
                        .filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className="shrink-0 font-data text-[14px] tabular-nums">{eur(l.line_ttc)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <dl className="space-y-1 border-t border-border pt-3 font-data text-[14px] tabular-nums">
          <div className="flex justify-between"><dt className="text-muted-foreground">{t('portal.invoices.totalHt')}</dt><dd>{eur(d.total_ht)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">{t('portal.invoices.totalVat')}</dt><dd>{eur(d.total_vat)}</dd></div>
          <div className="flex justify-between text-[16px] font-bold"><dt>{t('portal.invoices.totalTtc')}</dt><dd>{eur(d.total_ttc)}</dd></div>
          {received.length > 0 && (
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('portal.invoices.paid')}</dt><dd>{eur(d.paid_amount)}</dd></div>
          )}
          {due > 0.005 && d.status !== 'annulee' && (
            <div className="flex justify-between font-bold text-warning"><dt>{t('portal.invoices.remaining')}</dt><dd>{eur(due)}</dd></div>
          )}
        </dl>

        {due > 0.005 && d.status !== 'annulee' && d.company.iban && (
          <p className="rounded-md bg-muted px-3 py-2 text-[13px]">
            {t('portal.invoices.payBy')} <span className="font-mono">{d.company.iban}</span>
            {d.company.bic ? ` (${d.company.bic})` : ''} · {t('portal.invoices.reference')} {d.number}
          </p>
        )}
        {d.tax_exempt && <p className="text-[12px] text-muted-foreground">{t('portal.invoices.taxExempt')}</p>}
        {d.company.invoice_footer && <p className="whitespace-pre-line text-[11px] text-muted-foreground">{d.company.invoice_footer}</p>}
      </Card>

      <Link to="/mon-espace/factures" className="inline-block text-[13px] font-medium text-info print:hidden">
        {t('portal.invoices.back')}
      </Link>
    </PortalPage>
  );
}
