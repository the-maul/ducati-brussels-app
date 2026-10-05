/**
 * « Mes factures » : factures, avoirs et tickets du client.
 *   - documents repris de G8 : on ouvre le PDF d'origine (pièce jointe du document) ;
 *   - documents créés dans le DMS : pas de PDF archivé (M6 imprime en HTML), on affiche
 *     la facture à l'écran avec un bouton « Imprimer / enregistrer en PDF » du navigateur.
 */
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileDown, FileText, Printer, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { getInvoice, listInvoices, openFile } from './api';
import { Card, EmptyState, ErrorBox, InvoiceStatus, Loading, PortalPage, SectionTitle, dateFr, eur } from './ui';

const openPdf = (path: string) =>
  openFile(path).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));

/** Valeur « pas de filtre » d'un <Select> (une valeur vide est interdite). */
const ALL = '__all__';
/** Factures au nom du client lui-même (pas d'une fiche liée ni d'un financement). */
const MINE = '__mine__';

/** Tranches de montant, de la plus petite à la plus grande. `max` est exclu. */
const AMOUNTS: { key: string; min: number; max: number }[] = [
  { key: 'lt100', min: 0, max: 100 },
  { key: 'r100', min: 100, max: 500 },
  { key: 'r500', min: 500, max: 2000 },
  { key: 'gt2000', min: 2000, max: Infinity },
];

/** Un filtre n'est proposé que s'il y a vraiment un choix à faire. */
function FilterSelect({
  value, onChange, allLabel, options,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
}) {
  if (options.length < 2) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10 w-full min-w-0 sm:w-auto sm:min-w-[11rem]"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function InvoiceListView() {
  const { data, isLoading, error } = useQuery({ queryKey: ['portal', 'invoices'], queryFn: listInvoices });
  const [vehicle, setVehicle] = useState(ALL);
  const [profile, setProfile] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [amount, setAmount] = useState(ALL);

  // Les choix proposés viennent des factures du client : jamais un filtre qui
  // ne donnerait aucun résultat.
  const opts = useMemo(() => {
    const uniq = (xs: (string | null | undefined)[]) =>
      [...new Set(xs.filter((x): x is string => !!x))].sort();
    const list = data ?? [];
    return {
      vehicles: uniq(list.map((d) => d.vehicle_label)).map((v) => ({ value: v, label: v })),
      profiles: [
        ...(list.some((d) => !d.on_behalf) ? [{ value: MINE, label: t('portal.invoices.filterMine') }] : []),
        ...uniq(list.map((d) => d.on_behalf)).map((v) => ({ value: v, label: v })),
      ],
      years: uniq(list.map((d) => d.issue_date?.slice(0, 4))).reverse().map((y) => ({ value: y, label: y })),
      amounts: AMOUNTS.filter((a) => list.some((d) => Number(d.total_ttc) >= a.min && Number(d.total_ttc) < a.max))
        .map((a) => ({ value: a.key, label: t(`portal.invoices.amount_${a.key}`) })),
    };
  }, [data]);

  const rows = useMemo(() => (data ?? []).filter((d) => {
    if (vehicle !== ALL && d.vehicle_label !== vehicle) return false;
    if (profile === MINE && d.on_behalf) return false;
    if (profile !== ALL && profile !== MINE && d.on_behalf !== profile) return false;
    if (year !== ALL && d.issue_date?.slice(0, 4) !== year) return false;
    if (amount !== ALL) {
      const a = AMOUNTS.find((x) => x.key === amount)!;
      const n = Number(d.total_ttc);
      if (n < a.min || n >= a.max) return false;
    }
    return true;
  }), [data, vehicle, profile, year, amount]);

  const filtered = vehicle !== ALL || profile !== ALL || year !== ALL || amount !== ALL;
  const reset = () => { setVehicle(ALL); setProfile(ALL); setYear(ALL); setAmount(ALL); };
  const total = rows.reduce((s, d) => s + Number(d.total_ttc), 0);

  return (
    <PortalPage title={t('portal.invoices.title')} subtitle={t('portal.invoices.subtitle')}>
      {isLoading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && data.length === 0 && <EmptyState icon={<FileText className="size-8" />} text={t('portal.invoices.empty')} />}
      {data && data.length > 0 && (
        <>
          {/* Filtres : une colonne sur téléphone, en ligne dès que l'écran le permet. */}
          <div className="mb-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <FilterSelect value={vehicle} onChange={setVehicle} allLabel={t('portal.invoices.filterVehicle')} options={opts.vehicles} />
            <FilterSelect value={profile} onChange={setProfile} allLabel={t('portal.invoices.filterProfile')} options={opts.profiles} />
            <FilterSelect value={year} onChange={setYear} allLabel={t('portal.invoices.filterYear')} options={opts.years} />
            <FilterSelect value={amount} onChange={setAmount} allLabel={t('portal.invoices.filterAmount')} options={opts.amounts} />
            {filtered && (
              <Button variant="ghost" size="sm" onClick={reset} className="justify-self-start">
                <X className="size-4" /> {t('portal.invoices.filterReset')}
              </Button>
            )}
          </div>

          <p className="mb-2 text-[13px] text-muted-foreground">
            {rows.length} {rows.length > 1 ? t('portal.invoices.countMany') : t('portal.invoices.countOne')}
            {' · '}{eur(total)}
          </p>

          {rows.length === 0 && (
            <EmptyState
              icon={<FileText className="size-8" />}
              text={t('portal.invoices.noMatch')}
              action={<Button variant="outline" onClick={reset}>{t('portal.invoices.filterReset')}</Button>}
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
