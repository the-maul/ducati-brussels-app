/**
 * M8 — Fiche d'un dossier accident (mission 09, carte 5, ACH005) : moto / VIN, client, assurance,
 * n° de sinistre, expert, urgence ; devis lie (controle 1 500 € HTVA, remise prevue 15 %) ;
 * photos ; rapport de l'expert ; formulaire Excel Ducati ; checklist « Dossier complet ? » ;
 * « Envoyer le dossier » (mail Outlook, 4 pieces jointes) ; statut apres envoi.
 * Regle M08 : un dossier part complet ou ne part pas (bouton grise tant que la checklist a un ✗).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Archive, ArrowLeft, Check, CheckCircle2, ClipboardList, Download, ExternalLink, FilePen, FileSpreadsheet, FileText,
  Loader2, Mail, Package, RefreshCw, Save, Send, Upload, Wrench, X, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { errorMessage } from '@/lib/mutation-feedback';
import { t, fillVars } from '@/lib/i18n';
import { contactDisplayName } from '@/modules/contacts/api';
import { getDocumentFull } from '@/modules/sales/write-api';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import {
  accidentFileUrl, getAccidentFile, listAccidentPhotos, listVehicleQuotes, storeAccidentFile, updateAccidentFile,
  type AccidentFilePatch,
} from './api';
import { accidentPhotosKey, AccidentPhotos } from './accident-photos';
import { AccidentSendDialog } from './accident-send-dialog';
import { downloadBytes, XLSX_MIME } from './form-xlsx';
import { generateAccidentForm, loadQuoteParts, downloadStoredAccidentFile, accidentNames } from './send';
import {
  ACCIDENT_FILE_ENTITY, accidentAmounts, accidentChecklist, accidentNextStatuses, accidentStatusTone,
  accidentAttachmentNames, type AccidentFileStatus,
} from './rules';

const eur = (n: number) => `${new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`;
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '');

export const STATUS_ICON: Record<AccidentFileStatus, LucideIcon> = {
  brouillon: FilePen, envoye: Send, accorde: CheckCircle2, pieces_recues: Package, repare: Wrench, clos: Archive,
};

export function AccidentStatusBadge({ status }: { status: AccidentFileStatus }) {
  return <StatusBadge tone={accidentStatusTone(status)} icon={STATUS_ICON[status]} label={t(`accidentFile.status_${status}`)} />;
}

export const accidentFileKey = (id: string) => ['accident-file', id];

export function AccidentFileScreen({ fileId }: { fileId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeCompanyId, companies } = useAuth();
  const companyName = companies.find((c) => c.id === activeCompanyId)?.name ?? '';
  const fileQ = useQuery({ queryKey: accidentFileKey(fileId), queryFn: () => getAccidentFile(fileId) });
  const file = fileQ.data ?? null;
  const refresh = () => { qc.invalidateQueries({ queryKey: accidentFileKey(fileId) }); qc.invalidateQueries({ queryKey: ['accident-files'] }); };

  // ── Fiche ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState({ insurer: '', claim_number: '', expert_name: '', expert_email: '', is_urgent: false, urgent_note: '' });
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!file || loadedFor.current === file.id + file.updated_at) return;
    loadedFor.current = file.id + file.updated_at;
    setForm({
      insurer: file.insurer ?? '', claim_number: file.claim_number ?? '', expert_name: file.expert_name ?? '',
      expert_email: file.expert_email ?? '', is_urgent: file.is_urgent, urgent_note: file.urgent_note ?? '',
    });
  }, [file]);
  const save = useMutation({
    mutationFn: (patch: AccidentFilePatch) => updateAccidentFile(fileId, patch),
    meta: { success: false },
    onSuccess: () => { refresh(); toast.success(t('accidentFile.saved')); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveForm = () => save.mutate({
    insurer: form.insurer.trim() || null, claim_number: form.claim_number.trim() || null, expert_name: form.expert_name.trim() || null,
    expert_email: form.expert_email.trim() || null, is_urgent: form.is_urgent, urgent_note: form.urgent_note.trim() || null,
  });

  // ── Devis lie ────────────────────────────────────────────────────────────
  const quotesQ = useQuery({
    queryKey: ['accident-vehicle-quotes', file?.vehicle_id],
    queryFn: () => listVehicleQuotes(file!.company_id, file!.vehicle_id!),
    enabled: !!file?.vehicle_id,
  });
  const partsQ = useQuery({
    queryKey: ['accident-quote-parts', file?.quote_document_id],
    queryFn: async () => loadQuoteParts(await getDocumentFull(file!.quote_document_id!)),
    enabled: !!file?.quote_document_id,
  });
  const linkQuote = useMutation({
    mutationFn: (quoteId: string | null) => updateAccidentFile(fileId, { quote_document_id: quoteId, form_path: null }),
    meta: { success: false }, onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)),
  });

  // ── Photos (pour la checklist) ───────────────────────────────────────────
  const photosQ = useQuery({ queryKey: accidentPhotosKey(fileId), queryFn: () => listAccidentPhotos(fileId) });
  const photos = photosQ.data ?? [];

  // ── Rapport de l'expert ──────────────────────────────────────────────────
  const expertRef = useRef<HTMLInputElement>(null);
  const expertUpload = useMutation({
    mutationFn: async (f: File) => {
      const path = await storeAccidentFile(file!.company_id, fileId, f, f.name, f.type || 'application/pdf', t('accidentFile.sectionExpert'), 'Expert');
      await updateAccidentFile(fileId, { expert_report_path: path });
    },
    meta: { success: false },
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['attachments', ACCIDENT_FILE_ENTITY, fileId] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const openStored = async (path: string) => { const url = await accidentFileUrl(path); if (url) window.open(url, '_blank'); };

  // ── Formulaire Excel ─────────────────────────────────────────────────────
  const genForm = useMutation({
    mutationFn: () => generateAccidentForm(file!, { gedNote: t('accidentFile.gedNote') }),
    meta: { success: false },
    onSuccess: (r) => { downloadBytes(r.bytes, r.fileName, XLSX_MIME); refresh(); qc.invalidateQueries({ queryKey: ['attachments', ACCIDENT_FILE_ENTITY, fileId] }); toast.success(t('accidentFile.formGenerated')); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dlForm = useMutation({
    mutationFn: async () => downloadBytes(await downloadStoredAccidentFile(file!.form_path!), accidentAttachmentNames(accidentNames(file!)).form, XLSX_MIME),
    meta: { success: false }, onError: (e) => toast.error(errorMessage(e)),
  });

  // ── Statut ───────────────────────────────────────────────────────────────
  const setStatus = useMutation({
    mutationFn: (status: AccidentFileStatus) => updateAccidentFile(fileId, { status }),
    meta: { success: false },
    onSuccess: () => { refresh(); toast.success(t('accidentFile.statusChanged')); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [sendOpen, setSendOpen] = useState(false);

  if (fileQ.isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!file) return (
    <>
      <PageHeader title={t('accidentFile.title')} breadcrumbs={[{ label: t('nav.workshop'), to: '/workshop' }, { label: t('accidentFile.title'), to: '/workshop/accidents' }]} />
      <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('accidentFile.notFound')}</p>
    </>
  );

  const names = accidentNames(file);
  const quoteTotalHt = file.quote ? Number(file.quote.total_ht) : null;
  const amounts = accidentAmounts(quoteTotalHt ?? 0, partsQ.data ?? []);
  const checklist = accidentChecklist({
    hasQuote: !!file.quote_document_id, hasForm: !!file.form_path, photoCount: photos.length,
    hasVinPhoto: photos.some((p) => p.is_vin), quoteTotalHt,
  });
  const closed = file.status === 'clos';
  const title = [names.model, names.vin].filter(Boolean).join(' — ') || t('accidentFile.title');
  const nextStatuses = accidentNextStatuses(file.status);

  return (
    <>
      <PageHeader
        title={title}
        description={names.clientName ? `${t('accidentFile.client')} : ${names.clientName}` : undefined}
        breadcrumbs={[{ label: t('nav.workshop'), to: '/workshop' }, { label: t('accidentFile.title'), to: '/workshop/accidents' }, { label: title }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setSendOpen(true)} disabled={!checklist.complete || closed} title={!checklist.complete ? t('accidentFile.sendBlocked') : undefined}>
              <Mail /> {file.sent_at ? t('accidentFile.resend') : t('accidentFile.send')}
            </Button>
            {file.repair_order_id && <Button variant="outline" onClick={() => navigate({ to: '/workshop/$orId', params: { orId: file.repair_order_id! } })}><Wrench /> {t('accidentFile.linkOr')}</Button>}
            <Button variant="outline" onClick={() => navigate({ to: '/workshop/accidents' })}><ArrowLeft /> {t('accidentFile.back')}</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AccidentStatusBadge status={file.status} />
        {file.is_urgent && <StatusBadge tone="warning" label={t('accidentFile.urgent')} />}
        {file.sent_at && (
          <span className="font-data text-[13px] text-muted-foreground">
            {fillVars(t('accidentFile.sentAt'), { date: fmtDate(file.sent_at), to: file.sent_to ?? '' })}{file.sent_cc ? ` · ${fillVars(t('accidentFile.sentCc'), { cc: file.sent_cc })}` : ''}
          </span>
        )}
        <span className="font-data text-[12px] text-muted-foreground">{fillVars(t('accidentFile.createdAt'), { date: fmtDate(file.created_at) })}</span>
        {nextStatuses.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] text-muted-foreground">{t('accidentFile.setStatus')}</span>
            <Select value="" onValueChange={(v) => setStatus.mutate(v as AccidentFileStatus)}>
              <SelectTrigger className="h-9 w-48"><SelectValue placeholder="…" /></SelectTrigger>
              <SelectContent>{nextStatuses.map((s) => <SelectItem key={s} value={s}>{t(`accidentFile.status_${s}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
      </div>
      {!checklist.complete && !closed && <p className="mb-3 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('accidentFile.sendBlocked')}</p>}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {/* Fiche */}
          <Section title={t('accidentFile.sectionFile')}>
            {!file.vehicle && <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('accidentFile.noVehicle')}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('accidentFile.vehicle')}><Input value={names.model || '—'} readOnly /></Field>
              <Field label={t('accidentFile.vin')}><Input value={names.vin ?? '—'} readOnly className="font-data uppercase" /></Field>
              <Field label={t('accidentFile.client')}><Input value={file.contact ? contactDisplayName(file.contact) : '—'} readOnly /></Field>
              <Field label={t('accidentFile.insurer')}><Input value={form.insurer} onChange={(e) => setForm({ ...form, insurer: e.target.value })} disabled={closed} /></Field>
              <Field label={t('accidentFile.claimNumber')}><Input value={form.claim_number} onChange={(e) => setForm({ ...form, claim_number: e.target.value })} disabled={closed} className="font-data" /></Field>
              <Field label={t('accidentFile.expertName')}><Input value={form.expert_name} onChange={(e) => setForm({ ...form, expert_name: e.target.value })} disabled={closed} /></Field>
              <Field label={t('accidentFile.expertEmail')}><Input type="email" value={form.expert_email} onChange={(e) => setForm({ ...form, expert_email: e.target.value })} disabled={closed} /></Field>
              <div className="flex items-center gap-3 pt-6">
                <Switch id="accident-urgent" checked={form.is_urgent} onCheckedChange={(v) => setForm({ ...form, is_urgent: v })} disabled={closed} />
                <Label htmlFor="accident-urgent">{t('accidentFile.urgent')}</Label>
              </div>
              {form.is_urgent && (
                <div className="sm:col-span-2">
                  <Field label={t('accidentFile.urgentNote')}>
                    <Textarea rows={2} value={form.urgent_note} placeholder={t('accidentFile.urgentNotePlaceholder')} onChange={(e) => setForm({ ...form, urgent_note: e.target.value })} disabled={closed} />
                  </Field>
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <Button onClick={saveForm} disabled={save.isPending || closed}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('accidentFile.save')}</Button>
            </div>
          </Section>

          {/* Devis lie */}
          <Section title={t('accidentFile.sectionQuote')}>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1 space-y-1.5">
                <Label>{t('accidentFile.quoteChoose')}</Label>
                <Select value={file.quote_document_id ?? ''} onValueChange={(v) => linkQuote.mutate(v || null)} disabled={closed || !file.vehicle_id}>
                  <SelectTrigger><SelectValue placeholder={t('accidentFile.quoteNone')} /></SelectTrigger>
                  <SelectContent>
                    {(quotesQ.data ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.number ?? t('sales.draftSuffix')} · {new Date(d.issue_date).toLocaleDateString('fr-BE')} · {eur(Number(d.total_ht))} HT</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" disabled={closed} onClick={() => navigate({ to: '/sales/new', search: { contactId: file.contact_id ?? undefined, vehicleId: file.vehicle_id ?? undefined, docType: 'DEV', workshop: true, orNumber: undefined } })}>
                <ClipboardList /> {t('accidentFile.quoteCreate')}
              </Button>
              {file.quote_document_id && <Button variant="outline" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: file.quote_document_id! } })}><ExternalLink /> {t('accidentFile.quoteOpen')}</Button>}
            </div>
            {file.quote ? (
              <div className="space-y-1.5 rounded-md border border-border bg-card p-3">
                <Row label={t('accidentFile.quoteTotalHt')} value={eur(amounts.quoteTotalHt)} strong />
                <Row label={t('accidentFile.partsTotalHt')} value={partsQ.isLoading ? '…' : eur(amounts.partsTotalHt)} />
                {amounts.belowThreshold
                  ? <StatusBadge tone="warning" label={t('accidentFile.belowThreshold')} />
                  : <StatusBadge tone="success" label={fillVars(t('accidentFile.expectedDiscount'), { amount: eur(amounts.expectedDiscount).replace(' €', '') })} />}
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">{t('accidentFile.quoteMissing')}</p>
            )}
          </Section>

          {/* Photos */}
          <Section title={t('accidentFile.sectionPhotos')}>
            <AccidentPhotos companyId={file.company_id} fileId={fileId} disabled={closed} />
          </Section>

          {/* Rapport de l'expert */}
          <Section title={t('accidentFile.sectionExpert')}>
            <p className="text-[12px] text-muted-foreground">{t('accidentFile.expertHint')}</p>
            <div className="flex flex-wrap gap-2">
              <input ref={expertRef} type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) expertUpload.mutate(f); e.target.value = ''; }} />
              <Button variant="outline" onClick={() => expertRef.current?.click()} disabled={closed || expertUpload.isPending}>
                {expertUpload.isPending ? <Loader2 className="animate-spin" /> : <Upload />} {file.expert_report_path ? t('accidentFile.expertReplace') : t('accidentFile.expertUpload')}
              </Button>
              {file.expert_report_path && <Button variant="outline" onClick={() => openStored(file.expert_report_path!)}><FileText /> {t('accidentFile.expertOpen')}</Button>}
            </div>
          </Section>

          {/* Formulaire Excel */}
          <Section title={t('accidentFile.sectionForm')}>
            <p className="text-[12px] text-muted-foreground">{t('accidentFile.formHint')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => genForm.mutate()} disabled={!file.quote_document_id || genForm.isPending || closed}>
                {genForm.isPending ? <Loader2 className="animate-spin" /> : file.form_path ? <RefreshCw /> : <FileSpreadsheet />} {file.form_path ? t('accidentFile.formRegenerate') : t('accidentFile.formGenerate')}
              </Button>
              {file.form_path && <Button variant="outline" onClick={() => dlForm.mutate()} disabled={dlForm.isPending}><Download /> {t('accidentFile.formDownload')}</Button>}
              <span className="text-[12px] text-muted-foreground">{file.form_path ? t('accidentFile.formGenerated') : t('accidentFile.formNone')}</span>
            </div>
          </Section>

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ged.title')}</p>
            <AttachmentsPanel companyId={file.company_id} entityType={ACCIDENT_FILE_ENTITY} entityId={fileId} />
          </div>
        </div>

        {/* Checklist */}
        <div className="space-y-4">
          <Section title={t('accidentFile.sectionChecklist')}>
            <ul className="space-y-1.5 text-[13px]">
              <CheckItem ok={checklist.quote} label={t('accidentFile.checkQuote')} />
              <CheckItem ok={checklist.form} label={t('accidentFile.checkForm')} />
              <CheckItem ok={checklist.photos} label={`${t('accidentFile.checkPhotos')} (${photos.length})`} />
              <CheckItem ok={checklist.vinPhoto} label={t('accidentFile.checkVin')} />
              <CheckItem ok={checklist.amount} label={t('accidentFile.checkAmount')} />
            </ul>
            <div className="pt-1">
              {checklist.complete
                ? <StatusBadge tone="success" label={t('accidentFile.checkOk')} />
                : <StatusBadge tone="warning" label={t('accidentFile.checkKo')} />}
            </div>
          </Section>
        </div>
      </div>

      {sendOpen && <AccidentSendDialog file={file} companyName={companyName} onClose={() => setSendOpen(false)} onSent={() => { refresh(); qc.invalidateQueries({ queryKey: ['attachments', ACCIDENT_FILE_ENTITY, fileId] }); }} />}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-data tabular-nums ${strong ? 'font-bold' : ''}`}>{value}</span>
    </div>
  );
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-2 ${ok ? 'text-success' : 'text-muted-foreground'}`}>
      {ok ? <Check className="size-4 shrink-0" aria-hidden /> : <X className="size-4 shrink-0 text-warning" aria-hidden />}
      <span className={ok ? '' : 'text-foreground'}>{label}</span>
    </li>
  );
}
