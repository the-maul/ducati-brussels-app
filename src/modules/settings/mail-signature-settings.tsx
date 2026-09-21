/**
 * M10 — Paramètres → Sociétés → « Signature des e-mails » (retour client du 21/09).
 * Coordonnées de la société ajoutées sous chaque e-mail envoyé par l'application, et nom
 * de chaque boîte partagée (en tête de signature quand on envoie depuis cette boîte).
 * Enregistrement séparé du reste de la fiche société (`set_company_mail_signature`,
 * administrateur seulement, trace `events`).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/phone-input';
import { toE164 } from '@/lib/phone';
import { PUBLIC_SITE_URL } from '@/modules/signup/app-client-page';
import { getCompanySignature, setCompanySignature, type CompanySignature, type MailboxSignature } from './mail-signature-api';
import { t } from '@/lib/i18n';

const EMPTY: CompanySignature = { brand: '', address: '', phone: '', site_url: '', site_label: '' };

export function MailSignatureSettings({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['company-mail-signature', companyId], queryFn: () => getCompanySignature(companyId), retry: false });
  const [f, setF] = useState<CompanySignature>(EMPTY);
  const [boxes, setBoxes] = useState<MailboxSignature[]>([]);
  useEffect(() => {
    if (!q.data) return;
    setF({ ...q.data.company, site_url: q.data.company.site_url || PUBLIC_SITE_URL });
    setBoxes(q.data.mailboxes);
  }, [q.data]);
  const set = (k: keyof CompanySignature, v: string) => { setF((p) => ({ ...p, [k]: v })); setMsg(null); };

  const phoneE164 = toE164(f.phone);
  const phoneInvalid = phoneE164 === null;
  const urlInvalid = f.site_url.trim() !== '' && !/^https:\/\/\S+$/.test(f.site_url.trim());

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () => setCompanySignature(companyId, { ...f, phone: phoneE164 || '' }, boxes),
    onSuccess: () => { setMsg({ ok: true, text: t('mailSignature.saved') }); qc.invalidateQueries({ queryKey: ['company-mail-signature', companyId] }); },
    onError: (e) => setMsg({ ok: false, text: t('mailSignature.saveError').replace('{error}', e instanceof Error ? e.message : String(e)) }),
  });

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('mailSignature.title')}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">{t('mailSignature.companyIntro')}</p>
      </div>
      {q.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
      {q.isError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('mailSignature.loadError')}</p>}
      {q.data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('mailSignature.brand')}><Input value={f.brand} maxLength={80} placeholder={t('mailSignature.brandPlaceholder')} onChange={(e) => set('brand', e.target.value)} /></Field>
            <Field label={t('mailSignature.address')}><Input value={f.address} maxLength={200} placeholder={t('mailSignature.addressPlaceholder')} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label={t('mailSignature.phone')}><PhoneInput name="company-phone" autoComplete="off" value={f.phone} onChange={(v) => set('phone', v)} placeholder="2 123 45 67" /></Field>
            <Field label={t('mailSignature.siteUrl')}>
              <Input value={f.site_url} maxLength={300} className="font-mono" onChange={(e) => set('site_url', e.target.value)} aria-invalid={urlInvalid || undefined} />
              {urlInvalid && <p className="text-[12px] text-danger" role="alert">{t('mailSignature.siteUrlInvalid')}</p>}
            </Field>
            <Field label={t('mailSignature.siteLabel')}><Input value={f.site_label} maxLength={120} onChange={(e) => set('site_label', e.target.value)} /></Field>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('mailSignature.mailboxes')}</p>
            <p className="text-[12px] text-muted-foreground">{t('mailSignature.mailboxesHint')}</p>
            {boxes.length === 0 && <p className="text-[13px] text-muted-foreground">{t('mailSignature.noMailbox')}</p>}
            {boxes.map((b) => (
              <div key={b.id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <span className="truncate font-mono text-[12px]">{b.address}</span>
                <Input
                  aria-label={`${t('mailSignature.mailboxName')} — ${b.address}`}
                  placeholder={t('mailSignature.mailboxName')}
                  value={b.signature_name}
                  maxLength={80}
                  onChange={(e) => { const v = e.target.value; setBoxes((all) => all.map((x) => (x.id === b.id ? { ...x, signature_name: v } : x))); setMsg(null); }}
                />
              </div>
            ))}
          </div>
        </>
      )}
      {msg && <p className={`rounded-md px-3 py-2 text-[13px] ${msg.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>{msg.text}</p>}
      <div className="flex justify-end">
        <Button onClick={() => { setMsg(null); save.mutate(); }} disabled={!q.data || save.isPending || phoneInvalid || urlInvalid}>
          {save.isPending && <Loader2 className="animate-spin" />} {t('mailSignature.save')}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
