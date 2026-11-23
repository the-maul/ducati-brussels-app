/**
 * Client rapide (G8 : « Nouveau client » depuis la saisie) : civilité, nom et prénom obligatoires
 * (décision Q67, comme G8), en MAJUSCULES ; la fiche se complète plus tard.
 * Partagé par la caisse et la prise de rendez-vous. Une fiche au même nom est signalée avant de
 * créer un doublon, sans jamais bloquer (règle de la fiche client).
 */
import { useState, type ReactNode } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { identityFieldsLabel } from '@/lib/db-error-i18n';
import { normalizeEmail, normalizeMobile } from '@/lib/contact-normalize';
import { createContact, contactDisplayName, listContacts, type Contact } from './api';
import { identityMissing } from './identity-rules';
import { PERSON_CIVILITIES } from './civility';
import { quickClientNames } from './search-order';

function QuickField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function QuickClientDialog({ companyId, initialTerm = '', onClose, onCreated }: {
  companyId: string;
  /** Ce qui était tapé dans la recherche : prérempli comme nom et prénom. */
  initialTerm?: string;
  onClose: () => void;
  onCreated: (c: Contact) => void;
}) {
  const [f, setF] = useState(() => ({ civility: '', ...quickClientNames(initialTerm), mobile: '', email: '' }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dupes, setDupes] = useState<Contact[] | null>(null);
  const missing = identityMissing({ type: 'particulier', civility: f.civility, first_name: f.first, last_name: f.last });

  const save = async () => {
    const c = await createContact({
      company_id: companyId, type: 'particulier', status: 'client', civility: f.civility,
      last_name: f.last.trim().toUpperCase(), first_name: f.first.trim().toUpperCase(),
      mobile: f.mobile.trim() ? normalizeMobile(f.mobile) : null, email: f.email.trim() ? normalizeEmail(f.email) : null,
    });
    onCreated(c);
  };
  const create = async (force: boolean) => {
    if (missing.length) { setErr(fillVars(t('q67.errRequired'), { fields: identityFieldsLabel(missing) })); return; }
    setBusy(true); setErr(null);
    try {
      if (!force) {
        const same = await listContacts(companyId, `${f.last.trim()} ${f.first.trim()}`, undefined, 5);
        if (same.length > 0) { setDupes(same); setBusy(false); return; }
      }
      await save();
    } catch (e) { setErr(errorMessage(e)); }
    setBusy(false);
  };
  const field = (k: 'last' | 'first' | 'mobile' | 'email', label: string, type = 'text') => (
    <QuickField label={label}>
      <Input type={type} value={f[k]} onChange={(e) => { setDupes(null); setF((x) => ({ ...x, [k]: e.target.value })); }} />
    </QuickField>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="size-5" /> {t('posDetail.quickClientTitle')}</DialogTitle>
          <DialogDescription>{t('posDetail.quickClientHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <QuickField label={`${t('q67.civility')} *`}>
            <Select value={f.civility} onValueChange={(v) => setF((x) => ({ ...x, civility: v }))}>
              <SelectTrigger><SelectValue placeholder={t('q67.civility')} /></SelectTrigger>
              <SelectContent>{PERSON_CIVILITIES.map((c) => <SelectItem key={c.value} value={c.value}>{t(c.labelKey)}</SelectItem>)}</SelectContent>
            </Select>
          </QuickField>
          <div />
          {field('last', t('posDetail.lastName'))}
          {field('first', t('posDetail.firstName'))}
          {field('mobile', t('posDetail.mobile'), 'tel')}
          {field('email', t('posDetail.email'), 'email')}
        </div>
        {dupes && (
          <div className="rounded-md bg-warning-bg px-3 py-2 text-[13px]">
            <p className="font-bold text-warning">{t('dossier.quickDupTitle')}</p>
            <ul className="mt-1 space-y-1">
              {dupes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{contactDisplayName(c)}{c.city ? ` · ${c.city}` : ''}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => onCreated(c)}>{t('dossier.quickDupUse')}</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {err && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => create(!!dupes)} disabled={busy || missing.length > 0}>
            {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} {dupes ? t('dossier.quickDupCreate') : t('posDetail.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
