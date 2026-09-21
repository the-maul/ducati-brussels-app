/**
 * « Mon profil » : photo de profil, coordonnées modifiables, société (compte pro),
 * permis, préférences de contact. Seuls les champs de la liste blanche de
 * portal_update_profile sont envoyés ; l'e-mail de connexion n'est pas modifiable ici.
 *
 * Retour client du 21/09 :
 *  - l'e-mail est affiché dans son propre champ (lecture seule : c'est l'identifiant
 *    de connexion), jamais dans le GSM ;
 *  - GSM et téléphone fixe : menu de préfixe pays + numéro (PhoneInput), enregistrés au
 *    format E.164 (+32470123456) ; une saisie qui n'est pas un numéro bloque l'envoi ;
 *  - permis : deux photos, RECTO (dépôt `permis`) et VERSO (dépôt `permis_verso`).
 *
 * TVA : le bouton « Vérifier » réutilise la vérification VIES du module Contacts
 * (Edge Function vies-check, service public sans donnée du DMS). Le résultat sert
 * seulement à préremplir : la base remet « vérifié » à vide à chaque changement de
 * numéro, c'est le personnel qui valide.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, KeyRound, Loader2, Save, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { checkVat, parseViesAddress, type ViesResult } from '@/modules/contacts/vies-api';
import { isValidIban } from '@/lib/contact-normalize';
import { toE164 } from '@/lib/phone';
import { PhoneInput } from '@/components/phone-input';
import { ZipCitySuggest } from '@/components/zip-city-suggest';
import {
  CONTACT_PREFERENCES, getProfile, openFile, updateProfile, type PortalProfile, type ProfilePatch, type UploadKind,
} from './api';
import { Avatar, Card, ErrorBox, Loading, PortalPage, SectionTitle, UploadButtons } from './ui';

type FormState = Required<{ [K in keyof ProfilePatch]: NonNullable<ProfilePatch[K]> }>;

function toForm(p: PortalProfile): FormState {
  return {
    civility: p.civility ?? '', first_name: p.first_name ?? '', last_name: p.last_name ?? '',
    mobile: p.mobile ?? '', phone: p.phone ?? '', address: p.address ?? '', street_number: p.street_number ?? '',
    address_complement: p.address_complement ?? '', zip: p.zip ?? '', city: p.city ?? '', country: p.country ?? 'BE',
    birth_date: p.birth_date ?? '', birth_place: p.birth_place ?? '', iban: p.iban ?? '', bic: p.bic ?? '',
    company_name: p.company_name ?? '', vat_number: p.vat_number ?? '',
    contact_preference: p.contact_preference ?? ('' as never), marketing_opt_out: !!p.marketing_opt_out,
    license_number: p.license_number ?? '',
  };
}

function Field({ id, label, children, className }: { id: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function ProfileView() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['portal', 'profile'], queryFn: getProfile });
  const [form, setForm] = useState<FormState | null>(null);
  const [vies, setVies] = useState<ViesResult | null>(null);

  useEffect(() => { if (data) setForm(toForm(data)); }, [data]);
  const initial = useMemo(() => (data ? toForm(data) : null), [data]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['portal'] });
  };

  const save = useMutation({
    mutationFn: (patch: ProfilePatch) => updateProfile(patch),
    meta: { success: t('portal.profile.saved') },
    onSuccess: (p) => {
      qc.setQueryData(['portal', 'profile'], p);
      refreshAll();
    },
  });

  const viesCheck = useMutation({
    mutationFn: (raw: string) => checkVat(raw),
    meta: { success: false, error: t('portal.profile.viesUnavailable') },
    onSuccess: (r) => {
      setVies(r);
      if (r?.status === 'valid' && form) {
        const addr = parseViesAddress(r.address);
        setForm({
          ...form,
          company_name: form.company_name || r.name || '',
          address: form.address || addr.street,
          street_number: form.street_number || addr.number,
          zip: form.zip || addr.zip,
          city: form.city || addr.city,
        });
      }
    },
  });

  if (isLoading || (data && !form)) return <Loading />;
  if (error || !data || !form || !initial) return <ErrorBox error={error} />;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  // Téléphones : comparés au format E.164 (la remise en forme à l'écran n'est pas un changement).
  const same = (k: keyof FormState) =>
    (k === 'mobile' || k === 'phone')
      ? (toE164(form[k]) ?? form[k]) === (toE164(initial[k]) ?? initial[k])
      : form[k] === initial[k];
  const changed = (Object.keys(form) as (keyof FormState)[]).filter((k) => !same(k));
  const ibanInvalid = !!form.iban.trim() && form.iban !== initial.iban && !isValidIban(form.iban);
  // Seul un numéro MODIFIÉ bloque l'envoi (une ancienne valeur reprise de G8 reste affichée, signalée).
  const phoneInvalid = (['mobile', 'phone'] as const).some((k) => !same(k) && toE164(form[k]) === null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    for (const k of changed) {
      // Mission 04, carte 5 : le n° de TVA est ouvert aux particuliers, pas la raison sociale.
      if (!data.is_pro && k === 'company_name') continue;
      const v = form[k];
      if (k === 'country' && !String(v).trim()) continue; // pays obligatoire en base
      // Téléphones au format E.164 (+32470123456), comme à l'inscription et au comptoir.
      const clean = (k === 'mobile' || k === 'phone') && typeof v === 'string' ? (toE164(v) ?? v) : v;
      patch[k] = typeof clean === 'string' ? (clean.trim() === '' ? null : clean.trim()) : clean;
    }
    if (patch.iban && !isValidIban(String(patch.iban))) return; // message affiché sous le champ
    if (phoneInvalid) return; // message affiché sous le champ
    if (Object.keys(patch).length) save.mutate(patch as ProfilePatch);
  };

  const name = [data.first_name, data.last_name].filter(Boolean).join(' ');
  const input = (k: keyof FormState, props: Record<string, unknown> = {}) => (
    <Input id={`pf-${k}`} className="h-11" value={String(form[k] ?? '')}
      onChange={(e) => set(k, e.target.value as never)} {...props} />
  );

  return (
    <PortalPage title={t('portal.profile.title')} subtitle={data.dealer ? t('portal.profile.subtitle').replace('{dealer}', data.dealer) : undefined}>
      {/* Photo de profil */}
      <Card>
        <div id="photo" className="flex flex-wrap items-center gap-4">
          <Avatar path={data.avatar_path} name={name} size="lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[15px] font-bold">{name}</p>
            <p className="text-[13px] text-muted-foreground">{data.email}</p>
            <UploadButtons kind="avatar" vehicleId={null} onDone={refreshAll} photoOnly compact />
          </div>
        </div>
      </Card>

      <form onSubmit={submit} className="space-y-4">
        {/* Coordonnées */}
        <Card>
          <div id="coordonnees" />
          <SectionTitle>{t('portal.profile.contactInfo')}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pf-first_name" label={t('portal.profile.firstName')}>{input('first_name', { autoComplete: 'given-name' })}</Field>
            <Field id="pf-last_name" label={t('portal.profile.lastName')}>{input('last_name', { autoComplete: 'family-name' })}</Field>
            {/* E-mail : champ distinct, en lecture seule (identifiant de connexion). */}
            <Field id="pf-email" label={t('portal.profile.email')} className="sm:col-span-2">
              <Input id="pf-email" className="h-11 bg-muted" type="email" value={data.email ?? ''} readOnly
                aria-describedby="pf-email-hint" autoComplete="off" />
              <p id="pf-email-hint" className="text-[12px] text-muted-foreground">{t('portal.profile.emailLoginHint')}</p>
            </Field>
            <Field id="pf-mobile" label={t('portal.profile.mobile')}>
              <PhoneInput id="pf-mobile" name="tel-national" value={form.mobile} onChange={(v) => set('mobile', v)}
                autoComplete="tel-national" className="h-11" />
            </Field>
            <Field id="pf-phone" label={t('portal.profile.phone')}>
              <PhoneInput id="pf-phone" name="tel-fixe" value={form.phone} onChange={(v) => set('phone', v)}
                autoComplete="off" placeholder="2 123 45 67" className="h-11" />
            </Field>
            <Field id="pf-address" label={t('portal.profile.street')} className="sm:col-span-2">{input('address', { autoComplete: 'address-line1' })}</Field>
            <Field id="pf-street_number" label={t('portal.profile.number')}>{input('street_number')}</Field>
            <Field id="pf-address_complement" label={t('portal.profile.complement')}>{input('address_complement', { autoComplete: 'address-line2' })}</Field>
            <Field id="pf-zip" label={t('portal.profile.zip')}>{input('zip', { inputMode: 'numeric', autoComplete: 'postal-code' })}</Field>
            <Field id="pf-city" label={t('portal.profile.city')}>
              {input('city', { autoComplete: 'address-level2' })}
              {/* Mission 04, carte 4 : le code postal propose la localité. */}
              <ZipCitySuggest zip={form.zip} country={form.country} city={form.city} onPick={(c) => set('city', c)} large />
            </Field>
            <Field id="pf-country" label={t('portal.profile.country')}>{input('country', { maxLength: 2, autoComplete: 'country' })}</Field>
            <Field id="pf-birth_date" label={t('portal.profile.birthDate')}>{input('birth_date', { type: 'date', autoComplete: 'bday' })}</Field>
            <Field id="pf-birth_place" label={t('portal.profile.birthPlace')}>{input('birth_place')}</Field>
          </div>
        </Card>

        {/* Mission 04, carte 5 : coordonnées bancaires (et TVA pour un particulier) */}
        <Card>
          <div id="banque" />
          <SectionTitle>{t('portal.profile.bank')}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pf-iban" label={t('portal.profile.iban')} className="sm:col-span-2">
              {input('iban', { placeholder: 'BE68 5390 0754 7034', className: 'h-11 font-mono', 'aria-invalid': ibanInvalid })}
              {ibanInvalid && <p className="text-[13px] text-danger">{t('portal.errors.invalidIban')}</p>}
            </Field>
            <Field id="pf-bic" label={t('portal.profile.bic')}>{input('bic', { className: 'h-11 font-mono' })}</Field>
            {!data.is_pro && (
              <Field id="pf-vat_number" label={t('portal.profile.vatNumberPrivate')}>
                {input('vat_number', { placeholder: t('portal.profile.vatPlaceholder') })}
              </Field>
            )}
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">{t('portal.profile.ibanHint')}</p>
        </Card>

        {/* Société (comptes professionnels) */}
        {data.is_pro && (
          <Card>
            <div id="societe" />
            <SectionTitle>{t('portal.profile.company')}</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="pf-company_name" label={t('portal.profile.companyName')} className="sm:col-span-2">{input('company_name', { autoComplete: 'organization' })}</Field>
              <Field id="pf-vat_number" label={t('portal.profile.vatNumber')} className="sm:col-span-2">
                <div className="flex gap-2">
                  {input('vat_number', { placeholder: t('portal.profile.vatPlaceholder') })}
                  <Button type="button" variant="outline" className="h-11 shrink-0" disabled={!form.vat_number || viesCheck.isPending}
                    onClick={() => viesCheck.mutate(form.vat_number)}>
                    {viesCheck.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t('portal.profile.viesCheck')}
                  </Button>
                </div>
              </Field>
            </div>
            {vies && (
              <p className={cn('mt-2 text-[13px]', vies.status === 'valid' ? 'text-success' : 'text-warning')}>
                {vies.status === 'valid'
                  ? `${t('portal.profile.viesValid')}${vies.name ? ` : ${vies.name}` : ''}`
                  : vies.status === 'invalid' ? t('portal.profile.viesInvalid') : t('portal.profile.viesUnavailable')}
              </p>
            )}
            {data.vies_valid === true && !vies && (
              <p className="mt-2 flex items-center gap-1 text-[13px] text-success"><CheckCircle2 className="size-4" /> {t('portal.profile.viesChecked')}</p>
            )}
            <p className="mt-2 text-[12px] text-muted-foreground">{t('portal.profile.companyHint')}</p>
          </Card>
        )}

        {/* Permis */}
        <Card>
          <div id="permis" />
          <SectionTitle>{t('portal.profile.license')}</SectionTitle>
          <Field id="pf-license_number" label={t('portal.profile.licenseNumber')}>{input('license_number')}</Field>
          <p className="mt-3 text-[13px] text-muted-foreground">{t('portal.profile.licenseScan')}</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <LicenseSide kind="permis" label={t('portal.profile.licenseFront')} path={data.license_path} onDone={refreshAll} />
            <LicenseSide kind="permis_verso" label={t('portal.profile.licenseBack')} path={data.license_back_path ?? null} onDone={refreshAll} />
          </div>
        </Card>

        {/* Préférences de contact */}
        <Card>
          <div id="preferences" />
          <SectionTitle>{t('portal.profile.preferences')}</SectionTitle>
          <p className="mb-2 text-[13px]">{t('portal.profile.preferredChannel')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CONTACT_PREFERENCES.map((c) => (
              <button key={c} type="button" onClick={() => set('contact_preference', c)} aria-pressed={form.contact_preference === c}
                className={cn('h-11 rounded-md border text-[14px]',
                  form.contact_preference === c ? 'border-foreground bg-foreground text-background' : 'border-border bg-card')}>
                {t(`portal.channels.${c}`)}
              </button>
            ))}
          </div>
          <label className="mt-4 flex items-start justify-between gap-3">
            <span className="text-[14px]">
              {t('portal.profile.marketing')}
              <span className="block text-[12px] text-muted-foreground">{t('portal.profile.marketingHint')}</span>
            </span>
            <Switch checked={!form.marketing_opt_out} onCheckedChange={(v) => set('marketing_opt_out', !v)} />
          </label>
        </Card>

        <div className="sticky bottom-20 z-20 md:bottom-4">
          <Button type="submit" className="h-11 w-full shadow-[var(--shadow-card)]" disabled={changed.length === 0 || save.isPending || ibanInvalid || phoneInvalid}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('portal.profile.save')}
          </Button>
        </div>
      </form>

      {/* Compte */}
      <Card>
        <SectionTitle>{t('portal.profile.account')}</SectionTitle>
        <p className="text-[13px] text-muted-foreground">{t('portal.profile.emailHint')}</p>
        <Button asChild variant="outline" className="mt-3">
          <Link to="/reset-password"><KeyRound /> {t('portal.profile.changePassword')}</Link>
        </Button>
      </Card>
    </PortalPage>
  );
}

/**
 * Une face du permis (recto ou verso) : état (couleur + icône + libellé), lien « Voir »
 * et les deux boutons « Prendre une photo » / « Choisir un fichier ».
 */
function LicenseSide({ kind, label, path, onDone }: {
  kind: Extract<UploadKind, 'permis' | 'permis_verso'>; label: string; path: string | null; onDone: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-medium">{label}</p>
        {path
          ? <span className="flex items-center gap-1 text-[12px] text-success"><CheckCircle2 className="size-4" aria-hidden /> {t('portal.profile.licenseSideDone')}</span>
          : <span className="flex items-center gap-1 text-[12px] text-muted-foreground"><Circle className="size-4" aria-hidden /> {t('portal.profile.licenseSideMissing')}</span>}
      </div>
      {path && (
        <button type="button" className="text-[13px] font-medium text-info underline-offset-2 hover:underline"
          onClick={() => openFile(path)}>
          {t('portal.profile.licenseSideOpen')}
        </button>
      )}
      <UploadButtons kind={kind} vehicleId={null} onDone={onDone} compact />
    </div>
  );
}
