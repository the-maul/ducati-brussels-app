/**
 * M6 — Éditeur de document de vente (FAC/DEV/TIK/BL).
 * En-tête (type, client, dates) + lignes (article ou texte libre) + totaux + brouillon/validation.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Plus, Trash2, Search, X, Save, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listContacts, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { createDocument, computeTotals, searchSaleArticles, type LineInput, type SaleArticle } from './write-api';

const DOC_TYPES = [
  { value: 'FAC', label: 'Facture' }, { value: 'DEV', label: 'Devis' },
  { value: 'TIK', label: 'Ticket' }, { value: 'BL', label: 'Bon de livraison' },
];
const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

type EditLine = LineInput & { _key: string };
let counter = 0;
const blankLine = (): EditLine => ({ _key: `l${counter++}`, article_id: null, designation: '', quantity: 1, unit_price_ht: 0, vat_rate: 21, discount_pct: 0 });

export function DocumentEditor({ companyId, initialContactId }: { companyId: string; initialContactId?: string }) {
  const navigate = useNavigate();
  const [docType, setDocType] = useState('FAC');
  const [contact, setContact] = useState<Contact | null>(null);
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<EditLine[]>([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // précharge le client si fourni
  const { data: preContact } = useQuery({
    queryKey: ['contact-pre', initialContactId],
    queryFn: async () => (initialContactId ? (await listContacts(companyId, '')).find((c) => c.id === initialContactId) ?? null : null),
    enabled: !!initialContactId,
  });
  useEffect(() => { if (preContact) setContact(preContact); }, [preContact]);

  const setLine = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l._key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l._key !== key) : ls));
  const totals = computeTotals(lines.map(({ _key, ...l }) => l));

  const save = async (status: 'brouillon' | 'validee') => {
    setBusy(true); setError(null);
    try {
      const payload = lines.filter((l) => l.designation.trim()).map(({ _key, ...l }) => l);
      if (payload.length === 0) { setError('Ajoutez au moins une ligne.'); setBusy(false); return; }
      const id = await createDocument({
        companyId, docType, contactId: contact?.id ?? null, issueDate, dueDate: dueDate || null, status, lines: payload,
      });
      navigate({ to: '/sales/$documentId', params: { documentId: id } });
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-4">
        <Field label="Type">
          <Select value={docType} onValueChange={setDocType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{DOC_TYPES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Client">
          {contact ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
              <span className="truncate">{contactDisplayName(contact)}</span>
              <button type="button" onClick={() => setContact(null)} className="ml-auto text-muted-foreground hover:text-danger"><X className="size-4" /></button>
            </div>
          ) : <ContactPicker companyId={companyId} onPick={setContact} />}
        </Field>
        <Field label="Date"><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
        <Field label="Échéance"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
      </div>

      {/* Lignes */}
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr><Th>Article / Désignation</Th><Th className="w-20 text-right">Qté</Th><Th className="w-28 text-right">PU HT</Th><Th className="w-16 text-right">TVA</Th><Th className="w-20 text-right">Rem.%</Th><Th className="w-28 text-right">Total HT</Th><Th className="w-10" /></tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const ht = l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100);
              return (
                <tr key={l._key} className="border-b border-border last:border-0">
                  <td className="px-2 py-1">
                    {l.article_id ? (
                      <Input value={l.designation} onChange={(e) => setLine(l._key, { designation: e.target.value })} className="h-8" />
                    ) : (
                      <LinePicker companyId={companyId} value={l.designation}
                        onText={(v) => setLine(l._key, { designation: v })}
                        onPick={(a) => setLine(l._key, { article_id: a.id, designation: a.designation, unit_price_ht: a.sale_price_ht, vat_rate: a.vat_rate })} />
                    )}
                  </td>
                  <td className="px-2 py-1"><Input type="number" step="0.001" value={String(l.quantity)} onChange={(e) => setLine(l._key, { quantity: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.01" value={String(l.unit_price_ht)} onChange={(e) => setLine(l._key, { unit_price_ht: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.vat_rate)} onChange={(e) => setLine(l._key, { vat_rate: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.discount_pct)} onChange={(e) => setLine(l._key, { discount_pct: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-3 py-1 text-right tabular-nums">{eur(ht)}</td>
                  <td className="px-2 py-1 text-center"><Button size="sm" variant="ghost" onClick={() => removeLine(l._key)}><Trash2 className="size-4 text-danger" /></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus /> Ajouter une ligne</Button>
        <div className="flex gap-6 rounded-md border border-border bg-card px-4 py-2 font-data text-sm tabular-nums">
          <span>HT <b>{eur(totals.total_ht)}</b></span>
          <span className="text-muted-foreground">TVA {eur(totals.total_vat)}</span>
          <span className="text-base">TTC <b>{eur(totals.total_ttc)}</b></span>
        </div>
      </div>

      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => save('brouillon')} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />} Brouillon</Button>
        <Button onClick={() => save('validee')} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Valider</Button>
      </div>
    </div>
  );
}

/* ---------------- Pickers ---------------- */
function ContactPicker({ companyId, onPick }: { companyId: string; onPick: (c: Contact) => void }) {
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({ queryKey: ['contact-pick', companyId, deb], queryFn: () => listContacts(companyId, deb), enabled: deb.length >= 2 });
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Client…" className="h-9 pl-9" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.slice(0, 8).map((c) => (
            <button key={c.id} type="button" onClick={() => onPick(c)} className="block w-full px-3 py-2 text-left text-sm hover:bg-accent">{contactDisplayName(c)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function LinePicker({ companyId, value, onText, onPick }: { companyId: string; value: string; onText: (v: string) => void; onPick: (a: SaleArticle) => void }) {
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(value.trim()), 250); return () => clearTimeout(id); }, [value]);
  const { data } = useQuery({ queryKey: ['sale-art', companyId, deb], queryFn: () => searchSaleArticles(companyId, deb), enabled: deb.length >= 2 });
  return (
    <div className="relative">
      <Input value={value} onChange={(e) => onText(e.target.value)} placeholder="Article ou texte libre…" className="h-8" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.map((a) => (
            <button key={a.id} type="button" onClick={() => onPick(a)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
              <span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span><span className="ml-auto tabular-nums text-muted-foreground">{eur(a.sale_price_ht)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
