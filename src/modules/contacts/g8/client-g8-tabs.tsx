/**
 * M1 — Onglets G8 de la fiche client (rattrapage du 18/11/2026) :
 * RGPD · Groupes · Vente groupement · Dispo/Doc · RDV atelier · Relances · Images · Archives · E-mail / SMS.
 * Chaque onglet dit clairement quand sa migration n'est pas encore appliquée.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Loader2, Plus, Trash2, Ban, ShieldCheck, ShieldX, ShieldAlert, Clock, Search, ImagePlus, FlaskConical,
  CheckCircle2, MinusCircle, Mail, MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { listContacts, contactDisplayName, type Contact } from '../api';
import { listAttachments, uploadAttachment, deleteAttachment, signedThumb, type Attachment } from '@/modules/documents/ged-api';
import {
  listConsents, addConsent, revokeConsent, deleteConsent, listGroupDefs, listContactGroups, setContactGroup,
  listGroupSales, addGroupSale, deleteGroupSale, listDispo, listAppointments, listFollowups, listArchiveLines,
  listContactCampaigns, errorCode, type GroupDef,
} from './api';
import { CONSENT_CHANNELS, CONSENT_FORMS, consentStatus, channelState, consentDraftError, type ConsentStatus } from './rules';

const today = () => new Date().toISOString().slice(0, 10);
const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('fr-BE') : '—');
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Message d'erreur lisible : code métier traduit si connu, sinon le message brut. */
export function g8ErrorMessage(e: unknown): string {
  const code = errorCode(e);
  if (code) {
    const k = `g8c.err.${code}`;
    const v = t(k);
    if (v !== k) return v;
  }
  return e instanceof Error ? e.message : String(e);
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
export function Spinner() {
  return <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">{children}</p>;
}
export function MissingMigration() {
  return <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('g8c.missingMigration')}</p>;
}
function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[40rem] border-collapse font-data text-[13px]">
        <thead className="bg-muted"><tr>{head}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const Td = ({ children, className = '' }: { children?: ReactNode; className?: string }) => <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;

/* =================================================================== RGPD */

const STATUS_TONE: Record<ConsentStatus, { tone: StatusTone; icon: typeof ShieldCheck }> = {
  active: { tone: 'success', icon: ShieldCheck },
  expiree: { tone: 'warning', icon: Clock },
  revoquee: { tone: 'neutral', icon: Ban },
  future: { tone: 'info', icon: Clock },
};

export function RgpdTab({ contact, companyId }: { contact: Contact; companyId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { isAdmin } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['g8-consents', contact.id], queryFn: () => listConsents(contact.id) });
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['g8-consents', contact.id] });

  const revoke = useMutation({
    meta: { success: false, error: false },
    mutationFn: ({ id, reason }: { id: string; reason: string | null }) => revokeConsent(id, reason),
    onSuccess: () => { toast.success(t('g8c.rgpd.revoked')); refresh(); },
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });
  const del = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => deleteConsent(id),
    onSuccess: () => { toast.success(t('g8c.rgpd.deleted')); refresh(); },
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });

  if (isLoading) return <Spinner />;
  if (data?.missing) return <MissingMigration />;
  const rows = data?.rows ?? [];
  const d = today();
  const signup = (contact as { marketing_consent_at?: string | null }).marketing_consent_at ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('g8c.rgpd.stateTitle')}</span>
        {CONSENT_CHANNELS.map((ch) => {
          const st = channelState(rows, ch, d, signup);
          return (
            <StatusBadge
              key={ch}
              tone={st === 'accepte' ? 'success' : st === 'refuse' ? 'danger' : 'neutral'}
              icon={st === 'accepte' ? ShieldCheck : st === 'refuse' ? ShieldX : ShieldAlert}
              label={`${t(`g8c.channel.${ch}`)} : ${st ? t(`g8c.rgpd.state_${st}`) : t('g8c.rgpd.state_none')}`}
            />
          );
        })}
        {contact.marketing_opt_out && <StatusBadge tone="danger" icon={Ban} label={t('g8c.rgpd.optOutFlag')} />}
        <div className="ml-auto"><Button size="sm" onClick={() => setOpen(true)}><Plus /> {t('g8c.rgpd.newDeclaration')}</Button></div>
      </div>
      {signup && <p className="text-[12px] text-muted-foreground">{t('g8c.rgpd.signupConsent').replace('{date}', fmtDate(signup))}</p>}
      {rows.length === 0 ? <Empty>{t('g8c.rgpd.none')}</Empty> : (
        <Table head={<><Th>{t('g8c.rgpd.colDate')}</Th><Th>{t('g8c.rgpd.colStatus')}</Th><Th>{t('g8c.rgpd.colAccepted')}</Th><Th>{t('g8c.rgpd.colRefused')}</Th><Th>{t('g8c.rgpd.colForm')}</Th><Th>{t('g8c.rgpd.colExpiry')}</Th><Th /></>}>
          {rows.map((r) => {
            const st = consentStatus(r, d);
            const { tone, icon } = STATUS_TONE[st];
            return (
              <tr key={r.id} className="border-b border-border last:border-0">
                <Td className="tabular-nums">{fmtDate(r.declared_at)}</Td>
                <Td>
                  <StatusBadge tone={tone} icon={icon} label={t(`g8c.rgpd.status_${st}`)} />
                  {r.revoked_at && <div className="mt-1 text-[11px] text-muted-foreground">{fmtDate(r.revoked_at)}{r.revoke_reason ? ` — ${r.revoke_reason}` : ''}</div>}
                </Td>
                <Td>{r.accepted.map((c) => t(`g8c.channel.${c}`)).join(', ') || '—'}</Td>
                <Td>{r.refused.map((c) => t(`g8c.channel.${c}`)).join(', ') || '—'}</Td>
                <Td>{r.form ? t(`g8c.form.${r.form}`) : '—'}{r.form_ref ? <div className="text-[11px] text-muted-foreground">{r.form_ref}</div> : null}{r.note ? <div className="text-[11px] text-muted-foreground">{r.note}</div> : null}</Td>
                <Td className="tabular-nums">{fmtDate(r.expires_at)}</Td>
                <Td className="whitespace-nowrap text-right">
                  {!r.revoked_at && (
                    <Button variant="outline" size="sm" disabled={revoke.isPending} onClick={async () => {
                      const reason = window.prompt(t('g8c.rgpd.revokeReason'));
                      if (reason === null) return;
                      revoke.mutate({ id: r.id, reason: reason.trim() || null });
                    }}><Ban /> {t('g8c.rgpd.revoke')}</Button>
                  )}
                  {isAdmin(companyId) && (
                    <Button variant="ghost" size="sm" title={t('g8c.rgpd.deleteHint')} disabled={del.isPending} onClick={async () => {
                      if (await confirm({ title: t('g8c.rgpd.deleteTitle'), message: t('g8c.rgpd.deleteMessage'), variant: 'delete' })) del.mutate(r.id);
                    }}><Trash2 className="text-danger" /></Button>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
      <p className="text-[12px] text-muted-foreground">{t('g8c.rgpd.rule')}</p>
      <ConsentDialog open={open} onOpenChange={setOpen} contactId={contact.id} companyId={companyId} onDone={refresh} />
    </div>
  );
}

function ConsentDialog({ open, onOpenChange, contactId, companyId, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; contactId: string; companyId: string; onDone: () => void;
}) {
  const [declared, setDeclared] = useState(today());
  const [choice, setChoice] = useState<Record<string, '' | 'accepte' | 'refuse'>>({});
  const [form, setForm] = useState<string>('comptoir');
  const [formRef, setFormRef] = useState('');
  const [expires, setExpires] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setDeclared(today()); setChoice({}); setForm('comptoir'); setFormRef(''); setExpires(''); setNote(''); } }, [open]);
  const accepted = CONSENT_CHANNELS.filter((c) => choice[c] === 'accepte');
  const refused = CONSENT_CHANNELS.filter((c) => choice[c] === 'refuse');
  const err = consentDraftError({ accepted, refused, declared_at: declared, expires_at: expires });
  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => addConsent({ contactId, companyId, declared_at: declared, accepted, refused, form, form_ref: formRef.trim() || null, expires_at: expires || null, note: note.trim() || null }),
    onSuccess: () => { toast.success(t('g8c.rgpd.saved')); onDone(); onOpenChange(false); },
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('g8c.rgpd.newDeclaration')}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <label className="block"><span className="mb-1 block font-medium">{t('g8c.rgpd.colDate')}</span>
            <Input type="date" value={declared} onChange={(e) => setDeclared(e.target.value)} /></label>
          <div>
            <span className="mb-1 block font-medium">{t('g8c.rgpd.channels')}</span>
            <div className="space-y-1">
              {CONSENT_CHANNELS.map((c) => (
                <div key={c} className="flex items-center gap-3">
                  <span className="w-28">{t(`g8c.channel.${c}`)}</span>
                  {(['accepte', 'refuse', ''] as const).map((v) => (
                    <label key={v || 'none'} className="flex items-center gap-1">
                      <input type="radio" name={`consent-${c}`} checked={(choice[c] ?? '') === v} onChange={() => setChoice((p) => ({ ...p, [c]: v }))} />
                      {v === '' ? t('g8c.rgpd.notAsked') : t(`g8c.rgpd.state_${v}`)}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <label className="block"><span className="mb-1 block font-medium">{t('g8c.rgpd.colForm')}</span>
            <Select value={form} onValueChange={setForm}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CONSENT_FORMS.map((f) => <SelectItem key={f} value={f}>{t(`g8c.form.${f}`)}</SelectItem>)}</SelectContent>
            </Select></label>
          <label className="block"><span className="mb-1 block font-medium">{t('g8c.rgpd.formRef')}</span>
            <Input value={formRef} onChange={(e) => setFormRef(e.target.value)} placeholder={t('g8c.rgpd.formRefHint')} /></label>
          <label className="block"><span className="mb-1 block font-medium">{t('g8c.rgpd.colExpiry')}</span>
            <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block font-medium">{t('g8c.rgpd.note')}</span>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {err && <p className="text-[12px] text-danger">{t(`g8c.rgpd.draft_${err}`)}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('g8c.cancel')}</Button>
          <Button disabled={!!err || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t('g8c.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* =================================================================== Groupes */

const GROUP_CATEGORIES = ['interets', 'origine', 'situation', 'autre'] as const;

export function GroupsTab({ contactId, companyId }: { contactId: string; companyId: string }) {
  const qc = useQueryClient();
  const defsQ = useQuery({ queryKey: ['g8-group-defs', companyId], queryFn: () => listGroupDefs(companyId) });
  const memQ = useQuery({ queryKey: ['g8-groups', contactId], queryFn: () => listContactGroups(contactId) });
  const toggle = useMutation({
    meta: { success: false, error: false },
    mutationFn: ({ code, on }: { code: string; on: boolean }) => setContactGroup(contactId, companyId, code, on),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['g8-groups', contactId] }),
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });
  if (defsQ.isLoading || memQ.isLoading) return <Spinner />;
  if (memQ.data?.missing) return <MissingMigration />;
  const defs = (defsQ.data ?? []).filter((g) => g.is_active);
  const codes = new Set(memQ.data?.codes ?? []);
  if (defs.length === 0) return <Empty>{t('g8c.groups.noneDefined')}</Empty>;
  const byCat = (cat: string) => defs.filter((g: GroupDef) => (GROUP_CATEGORIES as readonly string[]).includes(g.category) ? g.category === cat : cat === 'autre');
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {GROUP_CATEGORIES.map((cat) => {
          const list = byCat(cat);
          if (list.length === 0) return null;
          return (
            <div key={cat} className="rounded-md border border-border bg-card p-3">
              <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(`g8c.groups.cat_${cat}`)}</div>
              <div className="space-y-1.5">
                {list.map((g) => (
                  <label key={g.code} className="flex cursor-pointer items-center gap-2 text-[13px]">
                    <Checkbox checked={codes.has(g.code)} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate({ code: g.code, on: v === true })} />
                    {g.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[12px] text-muted-foreground">{t('g8c.groups.hint')}</p>
    </div>
  );
}

/* =================================================================== Vente groupement */

export function GroupSalesTab({ contactId, companyId }: { contactId: string; companyId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ['g8-group-sales', contactId], queryFn: () => listGroupSales(contactId) });
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  const [picked, setPicked] = useState<Contact | null>(null);
  const [rate, setRate] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const searchQ = useQuery({ queryKey: ['g8-group-sale-pick', companyId, deb], queryFn: () => listContacts(companyId, deb), enabled: deb.length >= 2 && !picked });
  const refresh = () => qc.invalidateQueries({ queryKey: ['g8-group-sales', contactId] });
  const add = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => addGroupSale(contactId, companyId, picked!.id, Number(rate.replace(',', '.'))),
    onSuccess: () => { toast.success(t('g8c.groupSales.added')); setPicked(null); setTerm(''); setRate(''); refresh(); },
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });
  const del = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => deleteGroupSale(id),
    onSuccess: refresh,
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });
  if (isLoading) return <Spinner />;
  if (data?.missing) return <MissingMigration />;
  const rows = data?.rows ?? [];
  const total = rows.reduce((s, r) => s + r.participation_rate, 0);
  const rateNum = Number(rate.replace(',', '.'));
  const rateOk = Number.isFinite(rateNum) && rateNum > 0 && rateNum <= 100;
  return (
    <div className="space-y-4">
      {rows.length === 0 ? <Empty>{t('g8c.groupSales.none')}</Empty> : (
        <Table head={<><Th>{t('g8c.groupSales.colCode')}</Th><Th>{t('g8c.groupSales.colName')}</Th><Th className="text-right">{t('g8c.groupSales.colRate')}</Th><Th /></>}>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <Td className="font-mono text-muted-foreground">{r.member_code ?? '—'}</Td>
              <Td>{r.member_name}</Td>
              <Td className="text-right tabular-nums">{r.participation_rate.toFixed(2).replace('.', ',')} %</Td>
              <Td className="text-right"><Button variant="ghost" size="sm" onClick={async () => {
                if (await confirm({ title: t('g8c.groupSales.removeTitle'), message: t('g8c.groupSales.removeMessage'), variant: 'delete' })) del.mutate(r.id);
              }}><Trash2 className="text-danger" /></Button></Td>
            </tr>
          ))}
          <tr className="bg-muted/40"><Td /><Td className="font-medium">{t('g8c.groupSales.total')}</Td><Td className={`text-right font-bold tabular-nums ${total > 100.005 ? 'text-danger' : ''}`}>{total.toFixed(2).replace('.', ',')} %</Td><Td /></tr>
        </Table>
      )}
      {total > 100.005 && <p className="text-[12px] text-danger">{t('g8c.groupSales.over100')}</p>}
      <div className="rounded-md border border-border bg-card p-3">
        <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('g8c.groupSales.add')}</div>
        <div className="flex flex-wrap items-start gap-2">
          {picked ? (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="font-medium">{contactDisplayName(picked)}</span>
              <Button variant="outline" size="sm" onClick={() => setPicked(null)}>{t('g8c.change')}</Button>
            </div>
          ) : (
            <div className="relative w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('g8c.groupSales.searchPlaceholder')} />
              {deb.length >= 2 && (
                <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow">
                  {(searchQ.data ?? []).filter((c) => c.id !== contactId).slice(0, 30).map((c) => (
                    <button key={c.id} type="button" className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-accent" onClick={() => setPicked(c)}>
                      {contactDisplayName(c)} {c.code ? <span className="ml-1 font-mono text-[11px] text-muted-foreground">{c.code}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Input className="w-28" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={t('g8c.groupSales.ratePlaceholder')} />
          <Button size="sm" disabled={!picked || !rateOk || add.isPending} onClick={() => add.mutate()}><Plus /> {t('g8c.groupSales.addBtn')}</Button>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">{t('g8c.groupSales.hint')}</p>
      </div>
    </div>
  );
}

/* =================================================================== Dispo/Doc */

export function DispoTab({ contactId }: { contactId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['g8-dispo', contactId], queryFn: () => listDispo(contactId) });
  if (isLoading) return <Spinner />;
  const rows = data ?? [];
  if (rows.length === 0) return <Empty>{t('g8c.dispo.none')}</Empty>;
  const statusLabel = (r: (typeof rows)[number]) => r.kind === 'reservation'
    ? t(`g8c.dispo.res_${r.status}`)
    : (r.status ? t(`orders.dispatch_${r.status}`) : '—');
  return (
    <Table head={<><Th>{t('g8c.dispo.colKind')}</Th><Th>{t('g8c.dispo.colDocument')}</Th><Th>{t('g8c.dispo.colDate')}</Th><Th>{t('g8c.dispo.colRef')}</Th><Th>{t('g8c.dispo.colDesignation')}</Th><Th className="text-right">{t('g8c.dispo.colQty')}</Th><Th>{t('g8c.dispo.colAvailability')}</Th></>}>
      {rows.map((r) => (
        <tr key={r.key} className="border-b border-border last:border-0">
          <Td>{t(`g8c.dispo.kind_${r.kind}`)}</Td>
          <Td className="font-mono text-[12px]">{r.document ?? '—'}</Td>
          <Td className="tabular-nums">{fmtDate(r.date)}</Td>
          <Td className="font-mono text-[12px]">{r.reference || '—'}</Td>
          <Td>{r.designation}</Td>
          <Td className="text-right tabular-nums">{r.qty}</Td>
          <Td><StatusBadge tone={r.status === 'reservee' || r.status === 'envoyee' ? 'success' : 'warning'} label={statusLabel(r)} /></Td>
        </tr>
      ))}
    </Table>
  );
}

/* =================================================================== RDV atelier */

const APPT_TONE: Record<string, StatusTone> = { demande: 'warning', prevu: 'info', arrive: 'warning', en_cours: 'warning', termine: 'success', annule: 'neutral' };

export function AppointmentsTab({ contactId }: { contactId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['g8-appointments', contactId], queryFn: () => listAppointments(contactId) });
  if (isLoading) return <Spinner />;
  const rows = data ?? [];
  if (rows.length === 0) return <Empty>{t('g8c.appt.none')}</Empty>;
  const now = Date.now();
  return (
    <div className="space-y-2">
      <Table head={<><Th>{t('g8c.appt.colDate')}</Th><Th>{t('g8c.appt.colPlanned')}</Th><Th>{t('g8c.appt.colWork')}</Th><Th>{t('g8c.appt.colMechanic')}</Th><Th>{t('g8c.appt.colVehicle')}</Th><Th>{t('g8c.appt.colVin')}</Th><Th>{t('g8c.appt.colPlate')}</Th><Th>{t('g8c.appt.colStatus')}</Th></>}>
        {rows.map((r) => (
          <tr key={r.id} className={`cursor-pointer border-b border-border last:border-0 hover:bg-accent ${new Date(r.starts_at).getTime() > now ? 'font-medium' : ''}`}
            onClick={() => navigate({ to: '/workshop/planning', search: { week: undefined } })}>
            <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(r.starts_at)}</Td>
            <Td className="tabular-nums">{(r.planned_minutes / 60).toFixed(2).replace('.', ',')} h</Td>
            <Td>{r.work_description ?? '—'}</Td>
            <Td>{r.mechanic_name ?? '—'}</Td>
            <Td>{[r.vehicle?.brand, r.vehicle?.model].filter(Boolean).join(' ') || '—'}</Td>
            <Td className="font-mono text-[12px]">{r.vehicle?.vin ?? '—'}</Td>
            <Td className="font-mono text-[12px]">{r.vehicle?.plate ?? '—'}</Td>
            <Td><StatusBadge tone={APPT_TONE[r.status] ?? 'neutral'} label={t(`g8c.appt.status_${r.status}`)} /></Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

/* =================================================================== Relances */

export function FollowupsTab({ contactId }: { contactId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['g8-followups', contactId], queryFn: () => listFollowups(contactId) });
  if (isLoading) return <Spinner />;
  const rows = data ?? [];
  return (
    <div className="space-y-3">
      {rows.length === 0 ? <Empty>{t('g8c.followups.none')}</Empty> : (
        <Table head={<><Th>{t('g8c.followups.colKind')}</Th><Th>{t('g8c.followups.colLabel')}</Th><Th>{t('g8c.followups.colDue')}</Th><Th>{t('g8c.followups.colSendAt')}</Th><Th>{t('g8c.followups.colChannel')}</Th><Th>{t('g8c.followups.colTo')}</Th><Th>{t('g8c.followups.colStatus')}</Th></>}>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <Td>{t(`g8c.followups.kind_${r.kind}`)}</Td>
              <Td>{r.label ?? '—'}</Td>
              <Td className="tabular-nums">{fmtDate(r.due_date)}</Td>
              <Td className="tabular-nums">{fmtDate(r.sent_at ?? r.send_at)}</Td>
              <Td>{t(`g8c.channel.${r.channel === 'sms' ? 'sms' : 'email'}`)}</Td>
              <Td>{r.to_email ?? '—'}</Td>
              <Td><StatusBadge tone={r.status === 'envoyee' || r.status === 'repondue' ? 'success' : r.status === 'annulee' || r.status === 'close' ? 'neutral' : 'info'} label={t(`g8c.followups.status_${r.status}`)} /></Td>
            </tr>
          ))}
        </Table>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span>{t('g8c.followups.hint')}</span>
        <Button variant="outline" size="sm" onClick={() => navigate({ to: '/crm/relances' })}>{t('g8c.followups.open')}</Button>
      </div>
    </div>
  );
}

/* =================================================================== Images */

function Thumb({ att }: { att: Attachment }) {
  const { data } = useQuery({ queryKey: ['g8-thumb', att.storage_path], queryFn: () => signedThumb(att.storage_path), staleTime: 30 * 60 * 1000 });
  return data
    ? <a href={data} target="_blank" rel="noopener noreferrer"><img src={data} alt={att.alt_text ?? att.file_name} className="h-36 w-full rounded-md object-cover" /></a>
    : <div className="grid h-36 place-items-center rounded-md bg-muted"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
}

export function ImagesTab({ contactId, companyId }: { contactId: string; companyId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery({ queryKey: ['attachments', 'contact', contactId], queryFn: () => listAttachments('contact', contactId) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['attachments', 'contact', contactId] });
  const up = useMutation({
    meta: { success: false, error: false },
    mutationFn: async (files: File[]) => { for (const f of files) await uploadAttachment(companyId, 'contact', contactId, f, Date.now(), undefined, 'Images'); },
    onSuccess: () => { toast.success(t('g8c.images.added')); refresh(); },
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });
  const del = useMutation({
    meta: { success: false, error: false },
    mutationFn: (a: Attachment) => deleteAttachment(a),
    onSuccess: refresh,
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });
  if (isLoading) return <Spinner />;
  const images = (data ?? []).filter((a) => (a.content_type ?? '').startsWith('image/'));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input ref={input} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) up.mutate(f); }} />
        <Button size="sm" disabled={up.isPending} onClick={() => input.current?.click()}>{up.isPending ? <Loader2 className="animate-spin" /> : <ImagePlus />} {t('g8c.images.add')}</Button>
        <span className="text-[12px] text-muted-foreground">{t('g8c.images.hint')}</span>
      </div>
      {images.length === 0 ? <Empty>{t('g8c.images.none')}</Empty> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {images.map((a) => (
            <figure key={a.id} className="space-y-1">
              <Thumb att={a} />
              <figcaption className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                <span className="truncate" title={a.file_name}>{a.file_name}</span>
                <Button variant="ghost" size="sm" className="h-6 px-1" onClick={async () => {
                  if (await confirm({ title: t('g8c.images.deleteTitle'), message: t('g8c.images.deleteMessage'), variant: 'delete' })) del.mutate(a);
                }}><Trash2 className="size-3.5 text-danger" /></Button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

/* =================================================================== Archives */

export function ArchivesTab({ contactId }: { contactId: string }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['g8-archives', contactId], queryFn: () => listArchiveLines(contactId) });
  if (isLoading) return <Spinner />;
  const norm = q.trim().toLowerCase();
  const rows = (data ?? []).filter((r) => !norm || `${r.reference ?? ''} ${r.designation} ${r.number ?? ''}`.toLowerCase().includes(norm));
  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('g8c.archives.search')} />
      </div>
      {rows.length === 0 ? <Empty>{t('g8c.archives.none')}</Empty> : (
        <Table head={<><Th>{t('g8c.archives.colDocument')}</Th><Th>{t('g8c.archives.colDate')}</Th><Th>{t('g8c.archives.colRef')}</Th><Th>{t('g8c.archives.colDesignation')}</Th><Th className="text-right">{t('g8c.archives.colQty')}</Th><Th className="text-right">{t('g8c.archives.colHt')}</Th><Th className="text-right">{t('g8c.archives.colTtc')}</Th><Th>{t('g8c.archives.colStatus')}</Th></>}>
          {rows.map((r) => (
            <tr key={r.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent"
              onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: r.document_id } })}>
              <Td className="whitespace-nowrap"><span className="font-mono text-[12px] text-info underline">{r.number ?? '—'}</span> <span className="text-muted-foreground">{t(`sales.type_${r.doc_type}`)}</span></Td>
              <Td className="tabular-nums">{fmtDate(r.issue_date)}</Td>
              <Td className="font-mono text-[12px]">{r.reference ?? '—'}</Td>
              <Td>{r.designation}</Td>
              <Td className="text-right tabular-nums">{r.quantity}</Td>
              <Td className="text-right tabular-nums">{eur(r.line_ht)}</Td>
              <Td className="text-right tabular-nums">{eur(r.line_ttc)}</Td>
              <Td><StatusBadge tone={r.status === 'payee' ? 'success' : 'neutral'} label={t(`sales.status_${r.status}`)} /></Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="text-[12px] text-muted-foreground">{t('g8c.archives.hint')}</p>
    </div>
  );
}

/* =================================================================== Historique e-mail / SMS (campagnes d'essai) */

export function CampaignHistoryTab({ contactId }: { contactId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['g8-contact-campaigns', contactId], queryFn: () => listContactCampaigns(contactId) });
  if (isLoading) return <Spinner />;
  const rows = data ?? [];
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info"><FlaskConical className="size-4 shrink-0" /> {t('g8c.campaign.testBanner')}</p>
      {rows.length === 0 ? <Empty>{t('g8c.mailHistory.none')}</Empty> : (
        <Table head={<><Th>{t('g8c.mailHistory.colDate')}</Th><Th>{t('g8c.mailHistory.colChannel')}</Th><Th>{t('g8c.mailHistory.colCampaign')}</Th><Th>{t('g8c.mailHistory.colTo')}</Th><Th>{t('g8c.mailHistory.colMessage')}</Th><Th>{t('g8c.mailHistory.colStatus')}</Th></>}>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(r.created_at)}</Td>
              <Td>{r.campaign?.channel === 'sms' ? <MessageSquare className="size-4" /> : <Mail className="size-4" />}</Td>
              <Td>{r.campaign?.name ?? '—'}</Td>
              <Td>{r.address ?? '—'}</Td>
              <Td className="max-w-md">{r.rendered_subject ? <div className="font-medium">{r.rendered_subject}</div> : null}<div className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">{r.rendered_body ?? ''}</div></Td>
              <Td>
                {r.status === 'pret'
                  ? <StatusBadge tone="info" icon={FlaskConical} label={t('g8c.campaign.recipientTest')} />
                  : <StatusBadge tone="neutral" icon={MinusCircle} label={t(`g8c.campaign.skip_${r.skip_reason ?? 'archive'}`)} />}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="flex items-center gap-1 text-[12px] text-muted-foreground"><CheckCircle2 className="size-3.5" /> {t('g8c.mailHistory.hint')}</p>
    </div>
  );
}
