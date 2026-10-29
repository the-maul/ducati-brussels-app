/**
 * M9 — Ecran de signature d'une proposition d'intervention (ATE008 / ATE009) : UN ecran, DEUX usages.
 *   - a distance (lien du mail, espace client) : le client coche ce qu'il garde, tape son nom et
 *     clique « J'accepte et je signe » → nom, horodatage, adresse IP, navigateur, empreinte du
 *     texte accepte ;
 *   - au comptoir (« Faire signer sur la tablette ») : meme ecran + signature tracee au doigt,
 *     stockee en image et imprimee dans le PDF.
 * Tout est dans la LANGUE DU CLIENT (fiche contact, I18N004). Pense tablette / telephone.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, CheckCircle2, Loader2, PenLine, ShieldCheck, XCircle, Clock, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchImageForPdf } from '@/lib/image-tools';
import { tIn, fillVars } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { buildSalesDocumentPdf, type SalesPdfInput } from '@/modules/sales/document-pdf';
import { partitionProposal, sha256Hex, type ProposalGroup } from '@/modules/workshop/checkup/rules';
import { SignaturePad } from './signature-pad';
import { archiveSignedPdf, fetchProposal, proposalErrorKey, signProposal } from './proposal-sign-api';
import {
  acceptedText, clientName, defaultKept, groupsFor, proposalLocale, proposalPdfInput, signedPdfFileName, vehicleLabel,
  type ProposalPayload, type SignatureRecord,
} from './proposal-sign';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const hoursText = (h: number) => String(Math.round(h * 100) / 100).replace('.', ',');
const fmtWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '');

type Step = 'idle' | 'signing' | 'pdf' | 'sending' | 'done';

export function ProposalSignScreen({ token, mode, backToOrId }: { token: string; mode: 'distance' | 'comptoir'; backToOrId: string | null }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['proposal-sign', token], queryFn: () => fetchProposal(token), retry: false });
  const p = q.data ?? null;
  const locale = proposalLocale(p);
  const t = (key: string) => tIn(locale, key);
  const groups = useMemo(() => (p ? groupsFor(p) : []), [p]);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (groups.length && !touched) setKept(defaultKept(groups)); }, [groups, touched]);
  const [signerName, setSignerName] = useState('');
  useEffect(() => { if (p && !signerName) setSignerName(clientName(p.contact)); }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ink, setInk] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [result, setResult] = useState<{ record: SignatureRecord; mailed: boolean; deferred: ProposalGroup[]; keptGroups: ProposalGroup[] } | null>(null);
  const part = partitionProposal(groups, kept);

  const toggle = (id: string) => { setTouched(true); setKept((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };

  const sign = useMutation({
    meta: { success: false, error: false },
    mutationFn: async () => {
      if (!p) throw new Error('unknown_link');
      setStep('signing');
      const text = acceptedText(p, groups, kept, signerName);
      const hash = await sha256Hex(text);
      const record = await signProposal({ token, keptLineIds: part.keptLineIds, signerName, mode, signatureData: mode === 'comptoir' ? ink : null, acceptedText: text, hash });
      // PDF signe : photos et logo charges, signature enregistree par la base (horodatage, IP, empreinte).
      setStep('pdf');
      let mailed = false;
      try {
        const photos = new Map<string, { dataUrl: string; w: number; h: number }>();
        await Promise.all(p.lines.filter((l) => l.photo_url).map(async (l) => {
          const img = await fetchImageForPdf(l.photo_url as string, { maxPx: 480, quality: 0.7 });
          if (img) photos.set(l.id, img);
        }));
        const logoImg = p.company?.logo_url ? await fetchImageForPdf(p.company.logo_url, 'pdf') : null;
        const logo: SalesPdfInput['company']['logo'] = logoImg ? { dataUrl: logoImg.dataUrl, format: 'JPEG', w: logoImg.w, h: logoImg.h } : null;
        const input = proposalPdfInput(p, {
          keptLineIds: new Set(part.keptLineIds), photos, logo,
          signature: { signerName, signedAt: record.signed_at, mode, ip: record.ip ?? null, hash: record.hash, imageDataUrl: mode === 'comptoir' ? ink : null },
        });
        const bytes = await buildSalesDocumentPdf(input);
        setStep('sending');
        const a = await archiveSignedPdf({ token, signatureId: record.signature_id, fileName: signedPdfFileName(p), bytes });
        mailed = a.mailed;
      } catch {
        mailed = false; // la signature est enregistree : l'envoi du PDF ne la remet pas en cause
      }
      return { record, mailed };
    },
    onSuccess: (r) => { setResult({ record: r.record, mailed: r.mailed, deferred: part.deferred, keptGroups: part.kept }); setStep('done'); },
    onError: () => setStep('idle'),
  });

  const back = backToOrId ? (
    <Button variant="outline" className="h-12 text-[15px]" onClick={() => navigate({ to: '/workshop/$orId', params: { orId: backToOrId } })}>
      <ArrowLeft /> {t('checkup.signBackToOr')}
    </Button>
  ) : null;

  if (q.isLoading) return <Frame><div className="grid place-items-center py-24"><Loader2 className="size-7 animate-spin text-muted-foreground" /></div></Frame>;
  if (q.isError || !p) {
    return (
      <Frame>
        <Notice icon={XCircle} tone="danger" title={t('checkup.signErrTitle')} text={t(proposalErrorKey(q.error))} />
        {back}
      </Frame>
    );
  }

  const header = (
    <div className="space-y-1">
      <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{p.company?.name ?? ''}</p>
      <h1 className="text-[22px] font-bold leading-tight">{t('checkup.pdfTitle')} <span className="font-data text-[16px] font-normal text-muted-foreground">{p.number ?? ''}</span></h1>
      <p className="text-[14px] text-muted-foreground">
        {clientName(p.contact)}{vehicleLabel(p.vehicle) ? ` · ${vehicleLabel(p.vehicle)}` : ''}{p.repair_order?.number ? ` · OR ${p.repair_order.number}` : ''}
      </p>
    </div>
  );

  // Deja signee (ou resultat de la signature qu'on vient de faire).
  if (result || p.status === 'accepte') {
    const record = result?.record;
    const sig = p.signature;
    const keptGroups = result ? result.keptGroups : groups.filter((g) => g.accepted !== false);
    const deferredGroups = result ? result.deferred : groups.filter((g) => g.accepted === false);
    return (
      <Frame>
        {header}
        <Notice icon={CheckCircle2} tone="success" title={t('checkup.signDoneTitle')}
          text={fillVars(t('checkup.signDoneText'), { who: record ? signerName : sig?.signer_name ?? '', when: fmtWhen(record?.signed_at ?? sig?.signed_at) })} />
        {result && (
          <p className="text-[13px] text-muted-foreground">
            {result.mailed ? fillVars(t('checkup.signMailed'), { email: p.contact?.email ?? '' }) : t('checkup.signNotMailed')}
          </p>
        )}
        <GroupList title={t('checkup.signKeptTitle')} groups={keptGroups} tone="success" t={t} />
        {deferredGroups.length > 0 && (
          <>
            <GroupList title={t('checkup.signDeferredTitle')} groups={deferredGroups} tone="neutral" t={t} />
            <p className="flex items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info"><CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('checkup.signDeferredHint')}</p>
          </>
        )}
        <p className="font-data text-[18px] font-bold tabular-nums">{t('checkup.signTotal')} {eur(result ? part.totalTtc : Number(p.total_ttc))}</p>
        {(record?.hash ?? sig?.accepted_text_hash) && (
          <p className="break-all font-mono text-[11px] text-muted-foreground"><ShieldCheck className="mr-1 inline size-3.5" aria-hidden />{t('checkup.pdfSignedHash')} {record?.hash ?? sig?.accepted_text_hash}</p>
        )}
        {back}
      </Frame>
    );
  }

  if (p.status === 'expire' || p.status === 'annulee') {
    return (
      <Frame>
        {header}
        <Notice icon={Clock} tone="warning" title={t('checkup.signErrTitle')} text={t(p.status === 'expire' ? 'checkup.signErr_expired' : 'checkup.signErr_cancelled')} />
        {back}
      </Frame>
    );
  }

  const canSign = signerName.trim().length > 1 && kept.size > 0 && (mode === 'distance' || !!ink) && step === 'idle';

  return (
    <Frame>
      {header}
      <p className="text-[14px]">{t('checkup.signIntro')}</p>

      {/* Une case par carte : le client decoche ce qu'il ne veut pas tout de suite. */}
      <ul className="space-y-3">
        {groups.map((g) => {
          const on = kept.has(g.id);
          const parts = g.lines.filter((l) => l.line_type !== 'main_oeuvre');
          return (
            <li key={g.id}>
              <label className={cn('flex cursor-pointer gap-3 rounded-md border p-4', on ? 'border-success bg-card' : 'border-border bg-muted')}>
                <input type="checkbox" checked={on} onChange={() => toggle(g.id)} className="mt-1 size-6 shrink-0 accent-[var(--ducati-red)]" aria-label={g.label} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className={cn('text-[16px] font-medium', !on && 'text-muted-foreground line-through')}>{g.label}</p>
                    <p className="shrink-0 font-data text-[16px] font-bold tabular-nums">{eur(g.totalTtc)}</p>
                  </div>
                  {g.hours > 0 && <p className="text-[12px] text-muted-foreground">{fillVars(t('checkup.signHours'), { h: hoursText(g.hours) })}</p>}
                  {parts.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[13px] text-muted-foreground">
                      {parts.map((l) => <li key={l.id}>{Number(l.quantity)} x {l.designation}</li>)}
                    </ul>
                  )}
                  {g.photo_path && <PhotoOf line={g.lines.find((l) => l.photo_path) as { photo_url?: string | null } | undefined} alt={g.label} />}
                  {!on && <p className="mt-1 flex items-center gap-1 text-[12px] text-info"><CalendarClock className="size-3.5" aria-hidden /> {t('checkup.signDeferredLine')}</p>}
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="rounded-md border border-border bg-card p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('checkup.signTotal')}</p>
        <p className="font-data text-[26px] font-bold tabular-nums leading-tight">{eur(part.totalTtc)} <span className="text-[13px] font-normal text-muted-foreground">TTC</span></p>
        {part.deferred.length > 0 && <p className="text-[13px] text-muted-foreground">{fillVars(t('checkup.signDeferredCount'), { n: String(part.deferred.length), amount: eur(part.deferredTtc) })}</p>}
      </div>

      <div className="space-y-3 rounded-md border border-border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="sign-name">{t('checkup.signName')}</Label>
          <Input id="sign-name" value={signerName} onChange={(e) => setSignerName(e.target.value)} className="h-12 text-[16px]" autoComplete="name" />
        </div>
        {mode === 'comptoir' && (
          <div className="space-y-1.5">
            <Label>{t('checkup.signDraw')}</Label>
            <SignaturePad onChange={setInk} />
          </div>
        )}
        <p className="text-[12px] text-muted-foreground">{t('checkup.signSentence')}</p>
        <p className="text-[12px] text-muted-foreground">{t(mode === 'comptoir' ? 'checkup.signRecordCounter' : 'checkup.signRecordRemote')}</p>
        {sign.isError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t(proposalErrorKey(sign.error))}</p>}
        <Button className="h-14 w-full text-[16px]" onClick={() => sign.mutate()} disabled={!canSign}>
          {step !== 'idle' ? <Loader2 className="animate-spin" /> : <PenLine />}
          {step === 'signing' ? t('checkup.signStepSigning') : step === 'pdf' ? t('checkup.signStepPdf') : step === 'sending' ? t('checkup.signStepSending') : t('checkup.signButton')}
        </Button>
        {kept.size === 0 && <p className="text-center text-[12px] text-muted-foreground">{t('checkup.signNothingKept')}</p>}
      </div>
      {back}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6 pb-16">{children}</div>
    </main>
  );
}

function Notice({ icon: Icon, tone, title, text }: { icon: typeof CheckCircle2; tone: 'success' | 'warning' | 'danger'; title: string; text: string }) {
  const cls = tone === 'success' ? 'border-success bg-success-bg text-success' : tone === 'warning' ? 'border-warning bg-warning-bg text-warning' : 'border-danger bg-danger-bg text-danger';
  return (
    <div className={cn('flex items-start gap-3 rounded-md border p-4', cls)}>
      <Icon className="mt-0.5 size-6 shrink-0" aria-hidden />
      <div><p className="text-[16px] font-bold">{title}</p><p className="text-[14px]">{text}</p></div>
    </div>
  );
}

function GroupList({ title, groups, tone, t }: { title: string; groups: ProposalGroup[]; tone: 'success' | 'neutral'; t: (k: string) => string }) {
  if (!groups.length) return null;
  const Icon = tone === 'success' ? CheckCircle2 : CalendarClock;
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{title}</p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {groups.map((g) => (
          <li key={g.id} className="flex items-center gap-2 px-3 py-2 text-[14px]">
            <Icon className={cn('size-4 shrink-0', tone === 'success' ? 'text-success' : 'text-muted-foreground')} aria-hidden />
            <span className="min-w-0 flex-1">{g.label}</span>
            <span className="font-data tabular-nums">{eur(g.totalTtc)}</span>
          </li>
        ))}
      </ul>
      <span className="sr-only">{t('checkup.signTotal')}</span>
    </div>
  );
}

function PhotoOf({ line, alt }: { line: { photo_url?: string | null } | undefined; alt: string }) {
  if (!line?.photo_url) return <p className="mt-1 flex items-center gap-1 text-[12px] text-muted-foreground"><Camera className="size-3.5" aria-hidden /> {alt}</p>;
  return <img src={line.photo_url} alt={alt} className="mt-2 max-h-48 rounded-md border border-border object-cover" />;
}
