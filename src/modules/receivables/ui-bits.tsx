/**
 * Encaissements (rattrapage G8, 18/11/2026) — petits éléments d'écran partagés : en-têtes de
 * tableau, recherche de client, badge d'échéance (couleur + icône + libellé, charte §5.4).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, AlertTriangle, Ban, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { searchContacts, type ContactPick } from './api';

export function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`whitespace-nowrap px-2 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
export function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</span>;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

/** Badge d'une échéance : encaissée, annulée, échue (danger), à venir. */
export function DeferredBadge({ status, overdue }: { status: string; overdue: boolean }) {
  if (status === 'recu') return <StatusBadge tone="success" icon={CheckCircle2} label={t('receivables.stReceived')} />;
  if (status === 'annule') return <StatusBadge tone="neutral" icon={Ban} label={t('receivables.stCancelled')} />;
  if (overdue) return <StatusBadge tone="danger" icon={AlertTriangle} label={t('receivables.stOverdue')} />;
  return <StatusBadge tone="warning" icon={Clock} label={t('receivables.stUpcoming')} />;
}

/** Recherche d'un client (nom, société, code) ; vide = tous. */
export function ContactPicker({ companyId, value, onChange, className = 'w-64' }: {
  companyId: string; value: ContactPick | null; onChange: (c: ContactPick | null) => void; className?: string;
}) {
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => { const id = setTimeout(() => setDeb(term), 250); return () => clearTimeout(id); }, [term]);
  const q = useQuery({ queryKey: ['receivables-contacts', companyId, deb], queryFn: () => searchContacts(companyId, deb), enabled: open && deb.trim().length >= 2 });
  if (value) {
    return (
      <div className={`flex h-9 items-center justify-between gap-2 rounded-md border border-border bg-card px-2 text-[13px] ${className}`}>
        <span className="truncate">{value.code ? `${value.code} · ` : ''}{value.name}</span>
        <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => onChange(null)} title={t('receivables.allClients')}><X className="size-3.5" /></Button>
      </div>
    );
  }
  return (
    <div className={`relative ${className}`}>
      <Input value={term} placeholder={t('receivables.searchClient')} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setTerm(e.target.value)} />
      {open && (q.data?.length ?? 0) > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover shadow-sm">
          {q.data!.map((c) => (
            <button key={c.id} type="button" className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-muted" onMouseDown={(e) => { e.preventDefault(); onChange(c); setTerm(''); setOpen(false); }}>
              {c.code ? <span className="font-mono text-[11px] text-muted-foreground">{c.code} · </span> : null}{c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
