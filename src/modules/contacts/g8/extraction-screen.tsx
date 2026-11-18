/**
 * M1 / M10 — Extraction / mailing client (G8 « Fichiers > Clients > Extraction/Mailing client »).
 * Critères Client · Véhicule · Localisation · Ventes -> Valider -> liste à cocher -> Export Excel,
 * étiquettes, liste imprimable, Mailing e-mail / SMS EN MODE ESSAI (rien n'est envoyé).
 * Par défaut, comme G8 : opposés au marketing exclus ; et NPAI exclus.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Filter, Loader2, FileSpreadsheet, Tags, Printer, Mail, MessageSquare, FlaskConical, Ban, ShieldCheck, ShieldX, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { listRef } from '@/modules/settings/reference-api';
import { listContacts, contactDisplayName } from '../api';
import { PERSON_CIVILITIES, legalFormOptions } from '../civility';
import { extractContacts, listGroupDefs, listCampaigns, cancelCampaign, type ExtractRow } from './api';
import { emptyCriteria, criteriaPayload, BE_PROVINCES, BE_REGIONS, type ExtractionCriteria } from './rules';
import { downloadXlsx, downloadAddressLabels, downloadContactListPdf } from './list-export';
import { CampaignDialog } from './campaign-dialog';
import { Th, Empty, MissingMigration, g8ErrorMessage } from './client-g8-tabs';
import { formatPhone } from '@/lib/phone';

const SHOWN = 500;
const STATUSES = ['prospect', 'client', 'client_piece', 'client_atelier'] as const;
const TYPES = ['particulier', 'professionnel', 'employe', 'fournisseur', 'banque_leasing'] as const;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card p-3">
      <h3 className="mb-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>
    </section>
  );
}
function F({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`block text-[12px] ${wide ? 'sm:col-span-2' : ''}`}><span className="mb-0.5 block text-muted-foreground">{label}</span>{children}</label>;
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />{label}</label>;
}
function Multi({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="text-[12px] sm:col-span-2">
      <span className="mb-0.5 block text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-1.5 text-[13px]">
            <Checkbox checked={value.includes(o.value)} onCheckedChange={(v) => onChange(v === true ? [...value, o.value] : value.filter((x) => x !== o.value))} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function ExtractionScreen({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [c, setC] = useState<ExtractionCriteria>(emptyCriteria);
  const set = <K extends keyof ExtractionCriteria>(k: K, v: ExtractionCriteria[K]) => setC((p) => ({ ...p, [k]: v }));
  const [rows, setRows] = useState<ExtractRow[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [campaign, setCampaign] = useState<'email' | 'sms' | null>(null);

  const civQ = useQuery({ queryKey: ['ref', companyId, 'civility'], queryFn: () => listRef(companyId, 'civility') });
  const catQ = useQuery({ queryKey: ['ref', companyId, 'client_category'], queryFn: () => listRef(companyId, 'client_category') });
  const groupsQ = useQuery({ queryKey: ['g8-group-defs', companyId], queryFn: () => listGroupDefs(companyId) });
  const suppliersQ = useQuery({ queryKey: ['g8-suppliers', companyId], queryFn: () => listContacts(companyId, '', 'fournisseur') });
  const campaignsQ = useQuery({ queryKey: ['g8-campaigns', companyId], queryFn: () => listCampaigns(companyId) });

  const run = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => extractContacts(companyId, c),
    onSuccess: (r) => { setRows(r); setExcluded(new Set()); },
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });
  const cancel = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => cancelCampaign(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['g8-campaigns', companyId] }),
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });

  const civOptions = [
    ...PERSON_CIVILITIES.map((p) => ({ value: p.value, label: t(p.labelKey) })),
    ...legalFormOptions(civQ.data ?? []).map((o) => ({ value: o.code, label: o.label })),
  ];
  const selected = useMemo(() => (rows ?? []).filter((r) => !excluded.has(r.id)), [rows, excluded]);
  const toggle = (id: string) => setExcluded((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const stamp = new Date().toISOString().slice(0, 10);

  const exportXlsx = () => downloadXlsx(`extraction_clients_${stamp}.xlsx`, t('g8c.extract.sheet'),
    [t('g8c.list.colCode'), t('g8c.list.colType'), t('g8c.list.colStatus'), t('g8c.list.colCivility'), t('g8c.list.colLastName'), t('g8c.list.colFirstName'),
      t('g8c.list.colCompany'), t('g8c.list.colStreet'), t('g8c.list.colNumber'), t('g8c.list.colComplement'), t('g8c.list.colZip'), t('g8c.list.colCity'),
      t('g8c.list.colCountry'), t('g8c.list.colEmail'), t('g8c.list.colMobile'), t('g8c.list.colBirth'), t('g8c.list.colCategory'), t('g8c.list.colProvince'),
      t('g8c.list.colConsentEmail'), t('g8c.list.colConsentSms')],
    selected.map((r) => [r.code, t(`contacts.type_${r.type}`), t(`contacts.status_${r.status}`), r.civility ?? r.legal_form, r.last_name, r.first_name,
      r.company_name, r.address, r.street_number, r.address_complement, r.zip, r.city, r.country, r.email, r.mobile, r.birth_date, r.category,
      r.province ? t(`g8c.province.${r.province}`) : '', r.consent_email ? t(`g8c.rgpd.state_${r.consent_email}`) : '', r.consent_sms ? t(`g8c.rgpd.state_${r.consent_sms}`) : '']));

  const missing = campaignsQ.data?.missing;

  return (
    <div className="space-y-4">
      {missing && <MissingMigration />}
      <div className="grid gap-3 xl:grid-cols-2">
        <Card title={t('g8c.extract.secClient')}>
          <F label={t('g8c.extract.codeFrom')}><Input value={c.code_from} onChange={(e) => set('code_from', e.target.value)} /></F>
          <F label={t('g8c.extract.codeTo')}><Input value={c.code_to} onChange={(e) => set('code_to', e.target.value)} /></F>
          <F label={t('g8c.extract.name')} wide><Input value={c.name} onChange={(e) => set('name', e.target.value)} /></F>
          <Multi label={t('g8c.extract.types')} options={TYPES.map((x) => ({ value: x, label: t(`contacts.type_${x}`) }))} value={c.types} onChange={(v) => set('types', v)} />
          <Multi label={t('g8c.extract.statuses')} options={STATUSES.map((x) => ({ value: x, label: t(`contacts.status_${x}`) }))} value={c.statuses} onChange={(v) => set('statuses', v)} />
          <Multi label={t('g8c.extract.civilities')} options={civOptions} value={c.civilities} onChange={(v) => set('civilities', v)} />
          <F label={t('g8c.extract.createdFrom')}><Input type="date" value={c.created_from} onChange={(e) => set('created_from', e.target.value)} /></F>
          <F label={t('g8c.extract.createdTo')}><Input type="date" value={c.created_to} onChange={(e) => set('created_to', e.target.value)} /></F>
          <F label={t('g8c.extract.birthFrom')}><Input type="date" value={c.birth_from} onChange={(e) => set('birth_from', e.target.value)} /></F>
          <F label={t('g8c.extract.birthTo')}><Input type="date" value={c.birth_to} onChange={(e) => set('birth_to', e.target.value)} /></F>
          <F label={t('g8c.extract.birthdayFrom')}><Input placeholder="JJ/MM" value={c.birthday_from} onChange={(e) => set('birthday_from', e.target.value)} /></F>
          <F label={t('g8c.extract.birthdayTo')}><Input placeholder="JJ/MM" value={c.birthday_to} onChange={(e) => set('birthday_to', e.target.value)} /></F>
          {(catQ.data ?? []).length > 0 && (
            <Multi label={t('g8c.extract.categories')} options={(catQ.data ?? []).map((r) => ({ value: r.code, label: r.label }))} value={c.categories} onChange={(v) => set('categories', v)} />
          )}
          <F label={t('g8c.extract.priceList')}><Input value={c.price_lists[0] ?? ''} onChange={(e) => set('price_lists', e.target.value.trim() ? [e.target.value.trim()] : [])} /></F>
          <F label={t('g8c.extract.consent')}>
            <Select value={c.consent || 'all'} onValueChange={(v) => set('consent', (v === 'all' ? '' : v) as ExtractionCriteria['consent'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['all', 'email', 'sms', 'any', 'none_refused'] as const).map((k) => <SelectItem key={k} value={k}>{t(`g8c.extract.consent_${k}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </F>
          {(groupsQ.data ?? []).length > 0 && (
            <Multi label={t('g8c.extract.groups')} options={(groupsQ.data ?? []).filter((g) => g.is_active).map((g) => ({ value: g.code, label: g.label }))} value={c.groups} onChange={(v) => set('groups', v)} />
          )}
          <Check label={t('g8c.extract.excludeWithEmail')} checked={c.exclude_with_email} onChange={(v) => set('exclude_with_email', v)} />
          <Check label={t('g8c.extract.excludeWithMobile')} checked={c.exclude_with_mobile} onChange={(v) => set('exclude_with_mobile', v)} />
          <Check label={t('g8c.extract.excludeOptOut')} checked={c.exclude_opt_out} onChange={(v) => set('exclude_opt_out', v)} />
          <Check label={t('g8c.extract.includeArchived')} checked={c.include_archived} onChange={(v) => set('include_archived', v)} />
        </Card>

        <div className="space-y-3">
          <Card title={t('g8c.extract.secVehicle')}>
            <Check label={t('g8c.extract.hasVehicle')} checked={c.has_vehicle} onChange={(v) => set('has_vehicle', v)} />
            <Check label={t('g8c.extract.vehicleCurrentOnly')} checked={c.vehicle_current_only} onChange={(v) => set('vehicle_current_only', v)} />
            <F label={t('g8c.extract.vehicleBrand')}><Input value={c.vehicle_brand} onChange={(e) => set('vehicle_brand', e.target.value)} /></F>
            <F label={t('g8c.extract.vehicleModel')}><Input value={c.vehicle_model} onChange={(e) => set('vehicle_model', e.target.value)} /></F>
            <F label={t('g8c.extract.ctFrom')}><Input type="date" value={c.ct_from} onChange={(e) => set('ct_from', e.target.value)} /></F>
            <F label={t('g8c.extract.ctTo')}><Input type="date" value={c.ct_to} onChange={(e) => set('ct_to', e.target.value)} /></F>
          </Card>
          <Card title={t('g8c.extract.secLocation')}>
            <F label={t('g8c.extract.place')} wide><Input value={c.place} onChange={(e) => set('place', e.target.value)} placeholder={t('g8c.extract.placeHint')} /></F>
            <Multi label={t('g8c.extract.regions')} options={BE_REGIONS.map((r) => ({ value: r, label: t(`g8c.region.${r}`) }))} value={c.regions} onChange={(v) => set('regions', v)} />
            <Multi label={t('g8c.extract.provinces')} options={BE_PROVINCES.map((p) => ({ value: p, label: t(`g8c.province.${p}`) }))} value={c.provinces} onChange={(v) => set('provinces', v)} />
            <F label={t('g8c.extract.countries')} wide><Input value={c.countries.join(', ')} placeholder="BE, FR, LU" onChange={(e) => set('countries', e.target.value.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))} /></F>
            <Check label={t('g8c.extract.excludeNpai')} checked={c.exclude_npai} onChange={(v) => set('exclude_npai', v)} />
          </Card>
          <Card title={t('g8c.extract.secSales')}>
            <F label={t('g8c.extract.salesMode')} wide>
              <Select value={c.sales_mode || 'none'} onValueChange={(v) => set('sales_mode', (v === 'none' ? '' : v) as ExtractionCriteria['sales_mode'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['none', 'with_invoice', 'without_invoice', 'workshop'] as const).map((k) => <SelectItem key={k} value={k}>{t(`g8c.extract.sales_${k}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label={t('g8c.extract.salesFrom')}><Input type="date" value={c.sales_from} onChange={(e) => set('sales_from', e.target.value)} /></F>
            <F label={t('g8c.extract.salesTo')}><Input type="date" value={c.sales_to} onChange={(e) => set('sales_to', e.target.value)} /></F>
            <F label={t('g8c.extract.supplier')} wide>
              <Select value={c.supplier_id || 'none'} onValueChange={(v) => set('supplier_id', v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('g8c.extract.anySupplier')}</SelectItem>
                  {(suppliersQ.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{contactDisplayName(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label={t('g8c.extract.rayon')}><Input value={c.rayon} onChange={(e) => set('rayon', e.target.value)} /></F>
            <F label={t('g8c.extract.article')}><Input value={c.article} onChange={(e) => set('article', e.target.value)} /></F>
            <F label={t('g8c.extract.brand')}><Input value={c.brand} onChange={(e) => set('brand', e.target.value)} /></F>
            <p className="text-[12px] text-muted-foreground sm:col-span-2">{t('g8c.extract.salesHint')}</p>
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? <Loader2 className="animate-spin" /> : <Filter />} {t('g8c.extract.run')}</Button>
        <Button variant="outline" onClick={() => { setC(emptyCriteria()); setRows(null); }}><RotateCcw /> {t('g8c.extract.reset')}</Button>
        {rows && <span className="text-[13px] tabular-nums text-muted-foreground">{t('g8c.extract.count').replace('{sel}', String(selected.length)).replace('{n}', String(rows.length))}</span>}
      </div>

      {rows && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={selected.length === 0} onClick={exportXlsx}><FileSpreadsheet /> {t('g8c.extract.exportExcel')}</Button>
            <Button variant="outline" disabled={selected.length === 0} onClick={() => void downloadAddressLabels(selected, `etiquettes_clients_${stamp}.pdf`)}><Tags /> {t('g8c.extract.labels')}</Button>
            <Button variant="outline" disabled={selected.length === 0} onClick={() => void downloadContactListPdf(t('g8c.extract.listTitle'), selected, `liste_clients_${stamp}.pdf`)}><Printer /> {t('g8c.extract.printList')}</Button>
            <Button variant="outline" disabled={selected.length === 0} onClick={() => setCampaign('email')}><Mail /> {t('g8c.extract.mailingEmail')}</Button>
            <Button variant="outline" disabled={selected.length === 0} onClick={() => setCampaign('sms')}><MessageSquare /> {t('g8c.extract.mailingSms')}</Button>
          </div>
          {rows.length === 0 ? <Empty>{t('g8c.extract.none')}</Empty> : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[56rem] border-collapse font-data text-[13px]">
                <thead className="bg-muted"><tr>
                  <th className="w-10 px-3 py-2"><Checkbox checked={excluded.size === 0 ? true : excluded.size === rows.length ? false : 'indeterminate'}
                    onCheckedChange={() => setExcluded(excluded.size === 0 ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
                  <Th>{t('g8c.list.colCode')}</Th><Th>{t('g8c.list.colName')}</Th><Th>{t('g8c.list.colCity')}</Th><Th>{t('g8c.list.colEmail')}</Th>
                  <Th>{t('g8c.list.colMobile')}</Th><Th>{t('g8c.list.colConsent')}</Th><Th>{t('g8c.list.colFlags')}</Th>
                </tr></thead>
                <tbody>
                  {rows.slice(0, SHOWN).map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5"><Checkbox checked={!excluded.has(r.id)} onCheckedChange={() => toggle(r.id)} /></td>
                      <td className="px-3 py-1.5 font-mono text-muted-foreground"><a className="text-info underline" href={`/clients/${r.id}`} target="_blank" rel="noopener noreferrer">{r.code ?? '—'}</a></td>
                      <td className="px-3 py-1.5">{contactDisplayName(r)}</td>
                      <td className="px-3 py-1.5">{[r.zip, r.city].filter(Boolean).join(' ') || '—'}{r.province ? <span className="ml-1 text-[11px] text-muted-foreground">({t(`g8c.province.${r.province}`)})</span> : null}</td>
                      <td className="px-3 py-1.5">{r.email ?? '—'}</td>
                      <td className="px-3 py-1.5">{formatPhone(r.mobile) || '—'}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {r.consent_email && <StatusBadge tone={r.consent_email === 'accepte' ? 'success' : 'danger'} icon={r.consent_email === 'accepte' ? ShieldCheck : ShieldX} label={t('g8c.channel.email')} />}
                          {r.consent_sms && <StatusBadge tone={r.consent_sms === 'accepte' ? 'success' : 'danger'} icon={r.consent_sms === 'accepte' ? ShieldCheck : ShieldX} label={t('g8c.channel.sms')} />}
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {r.marketing_opt_out && <StatusBadge tone="danger" icon={Ban} label={t('g8c.rgpd.optOutFlag')} />}
                          {r.npai && <StatusBadge tone="warning" label={t('g8c.list.npai')} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > SHOWN && <p className="text-[12px] text-muted-foreground">{t('g8c.extract.shownLimit').replace('{n}', String(SHOWN))}</p>}
        </>
      )}

      {!missing && (campaignsQ.data?.rows ?? []).length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground"><FlaskConical className="size-4" /> {t('g8c.campaign.listTitle')}</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[40rem] border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th>{t('g8c.mailHistory.colDate')}</Th><Th>{t('g8c.mailHistory.colChannel')}</Th><Th>{t('g8c.mailHistory.colCampaign')}</Th><Th className="text-right">{t('g8c.campaign.colReady')}</Th><Th className="text-right">{t('g8c.campaign.colSkipped')}</Th><Th>{t('g8c.mailHistory.colStatus')}</Th><Th /></tr></thead>
              <tbody>
                {(campaignsQ.data?.rows ?? []).map((k) => (
                  <tr key={k.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5 tabular-nums">{new Date(k.created_at).toLocaleString('fr-BE')}</td>
                    <td className="px-3 py-1.5">{t(`g8c.channel.${k.channel}`)}</td>
                    <td className="px-3 py-1.5">{k.name}{k.subject ? <div className="text-[11px] text-muted-foreground">{k.subject}</div> : null}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{k.recipients_count}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{k.skipped_count}</td>
                    <td className="px-3 py-1.5"><StatusBadge tone={k.status === 'preparee' ? 'info' : 'neutral'} icon={FlaskConical} label={t(`g8c.campaign.status_${k.status}`)} /></td>
                    <td className="px-3 py-1.5 text-right">{k.status === 'preparee' && <Button variant="ghost" size="sm" onClick={() => cancel.mutate(k.id)}>{t('g8c.campaign.cancel')}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {campaign && (
        <CampaignDialog open={!!campaign} onOpenChange={(o) => { if (!o) setCampaign(null); }} companyId={companyId} channel={campaign}
          targets={selected} criteria={criteriaPayload(c)} />
      )}
    </div>
  );
}
