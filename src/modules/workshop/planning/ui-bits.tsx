/**
 * M8 — Petits composants du planning (champ libelle, choix du client), partages par
 * l'assistant de planification, les motos de pret et l'ancien planning.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { listContacts, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { LinkedLines, useLinkedBrief } from '@/modules/contacts/linked-line';
import { t } from '@/lib/i18n';

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function Picked({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
      <span className="truncate">{label}</span>
      <button type="button" onClick={onClear} className="ml-auto text-muted-foreground" aria-label={t('planningG8.clear')}>×</button>
    </div>
  );
}

export function ContactPicker({ companyId, onPick }: { companyId: string; onPick: (c: Contact) => void }) {
  const [term, setTerm] = useState(''); const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({ queryKey: ['rdv-cpick', companyId, deb], queryFn: () => listContacts(companyId, deb), enabled: deb.length >= 2 });
  // Fiches liees des resultats affiches, en un appel (retour du 05/10).
  const linkedByContact = useLinkedBrief((data ?? []).slice(0, 8).map((c) => c.id));
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('workshop.clientPlaceholder')} className="h-9 pl-9" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.slice(0, 8).map((c) => (
            <div key={c.id} className="border-b border-border last:border-0">
              <button type="button" onClick={() => onPick(c)} className="block w-full px-3 pt-2 text-left text-sm hover:bg-accent">{contactDisplayName(c)}</button>
              {/* Fiche liee sous la ligne, en plus clair (retour du 05/10). */}
              <div className="px-3 pb-1.5"><LinkedLines links={linkedByContact.get(c.id)} clickable={false} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type ContactBits = { first_name: string | null; last_name: string | null; company_name: string | null; type?: string | null } | null | undefined;
export function contactLabel(c: ContactBits): string {
  if (!c) return '';
  return contactDisplayName({ first_name: c.first_name, last_name: c.last_name, company_name: c.company_name, type: c.type ?? null });
}
export function motoLabel(v: { brand: string | null; model: string | null; plate: string | null } | null | undefined): string {
  if (!v) return '';
  return [[v.brand, v.model].filter(Boolean).join(' '), v.plate].filter(Boolean).join(' · ');
}
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit', month: '2-digit' });
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
