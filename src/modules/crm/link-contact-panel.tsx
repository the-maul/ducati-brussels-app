/**
 * M10 — Relier une carte sans fiche à une fiche client (migration 20260919180000).
 *
 * Une carte créée à la main avant le 19/09, ou sans e-mail, n'est reliée à aucune fiche :
 * pas d'onglet « Échanges avec le client », donc pas de réponse par mail. Ce bloc propose
 * de chercher une fiche (nom, e-mail, téléphone) ou d'en créer une avec les infos de la carte.
 * La liaison se fait en base (`crm_link_lead_contact`) : si une fiche porte déjà l'e-mail de
 * la carte, c'est elle qui est prise (D3) ; jamais de fusion automatique.
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link2, Loader2, Search, UserPlus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchContactsForLead, linkLeadContact, type Lead, type LinkLeadResult } from './api';
import { t } from '@/lib/i18n';

const display = (c: { company_name: string | null; first_name: string | null; last_name: string | null }) =>
  c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';

export function LinkContactPanel({ lead, companyId, onLinked }: {
  lead: Lead; companyId: string; onLinked: (r: LinkLeadResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(lead.email || lead.name || '');
  const [term, setTerm] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const found = useQuery({
    queryKey: ['crm-link-search', companyId, term],
    queryFn: () => searchContactsForLead(companyId, term),
    enabled: open && term.trim().length >= 2,
  });

  const link = useMutation({
    mutationFn: (contactId: string | null) => linkLeadContact(lead.id, contactId),
    onSuccess: (r) => { setOpen(false); onLinked(r); },
    onError: (e) => setErr(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)),
  });

  if (!open) {
    return (
      <div className="rounded-md border border-[var(--warning)] p-2.5 text-[12px]">
        <p className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]" />
          <span>{t('crm.noContactWarn')}</span>
        </p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => { setErr(null); setTerm(q); setOpen(true); }}>
          <Link2 className="size-4" /> {t('crm.linkContact')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-2.5 text-[12px]">
      <p className="text-[13px] font-medium">{t('crm.linkContact')}</p>
      <p className="text-muted-foreground">{t('crm.linkHelp')}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(q); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('crm.linkSearchPlaceholder')} />
        <Button type="submit" variant="outline" size="sm"><Search className="size-4" /> {t('crm.linkSearch')}</Button>
      </form>

      {found.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {found.data && found.data.length === 0 && <p className="text-muted-foreground">{t('crm.linkNoResult')}</p>}
      <div className="max-h-56 space-y-1 overflow-auto">
        {found.data?.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded border border-border px-2 py-1">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{display(c)}{!c.is_active && <span className="text-muted-foreground"> · {t('crm.linkArchived')}</span>}</p>
              <p className="truncate text-muted-foreground">{[c.email, c.mobile || c.phone].filter(Boolean).join(' · ') || '—'}</p>
            </div>
            <Button size="sm" onClick={() => { setErr(null); link.mutate(c.id); }} disabled={link.isPending}>
              {t('crm.linkThis')}
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <Button size="sm" variant="outline" onClick={() => { setErr(null); link.mutate(null); }} disabled={link.isPending}>
          {link.isPending ? <Loader2 className="animate-spin" /> : <UserPlus className="size-4" />} {t('crm.linkCreate')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('crm.cancel')}</Button>
      </div>
      <p className="text-muted-foreground">{t('crm.linkCreateHelp')}</p>
      {err && <p className="text-[var(--danger)]">{err}</p>}
    </div>
  );
}
