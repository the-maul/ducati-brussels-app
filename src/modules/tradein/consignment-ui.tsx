/**
 * M7 — Dépôt-vente : petits composants partagés de l'écran (recherche de client, champ montant,
 * badge de statut). Composants `src/components/ui/`, tokens de la charte, libellés i18n.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Clock, CheckCircle2, Undo2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { listContacts, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { t } from '@/lib/i18n';
import { statusTone } from './consignment-rules';

export const num = (s: string | number | null | undefined): number => {
  const n = Number(String(s ?? '').trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
export const eur = (n: number | null | undefined): string =>
  `${(Math.round(Number(n ?? 0) * 100) / 100).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
export const dateFr = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '—');

export function ConsignmentStatusBadge({ status }: { status: string }) {
  const icon = status === 'vendu' ? CheckCircle2 : status === 'en_depot' ? Clock : Undo2;
  return <StatusBadge tone={statusTone(status)} icon={icon} label={t(`consign.st_${status}`)} />;
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function MoneyInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="relative">
      <Input inputMode="decimal" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-9 pr-7 text-right tabular-nums" />
      <span className="pointer-events-none absolute right-2.5 top-2 text-sm text-muted-foreground">€</span>
    </div>
  );
}

/** Recherche d'une fiche client (déposant, acquéreur) ; la fiche choisie s'affiche avec une croix. */
export function ContactSearch({ companyId, picked, onPick, placeholder }: {
  companyId: string; picked: { id: string; label: string } | null;
  onPick: (c: { id: string; label: string } | null) => void; placeholder?: string;
}) {
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({
    queryKey: ['consign-contact-search', companyId, deb],
    queryFn: () => listContacts(companyId, deb),
    enabled: deb.length >= 2, staleTime: 30_000,
  });
  if (picked) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
        <span className="truncate">{picked.label}</span>
        <button type="button" aria-label={t('action.close')} onClick={() => onPick(null)} className="ml-auto text-muted-foreground hover:text-danger"><X className="size-4" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={placeholder ?? t('consign.searchClient')} className="h-9 pl-9" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.slice(0, 10).map((c: Contact) => (
            <button key={c.id} type="button" onClick={() => { onPick({ id: c.id, label: contactDisplayName(c) }); setTerm(''); }}
              className="block w-full border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-accent">
              {contactDisplayName(c)}{c.code ? <span className="ml-2 font-mono text-xs text-muted-foreground">{c.code}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
