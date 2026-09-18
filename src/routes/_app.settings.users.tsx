/**
 * M0 — Utilisateurs de la plateforme.
 *
 * Retour client du 18/09 :
 *   - créer des comptes pour l'ÉQUIPE (commercial, technicien, manager… = les rôles
 *     existants, rien de nouveau) et pour des CLIENTS, rattachés à leur fiche ;
 *   - soit on fixe un mot de passe (ex. commun et provisoire), soit on envoie une
 *     invitation par e-mail pour que la personne choisisse le sien ;
 *   - choisir qui reçoit par défaut les nouvelles demandes du CRM commercial.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Loader2, ShieldAlert, Check, Mail, UserRound, Users, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useAuth, type AppRole } from '@/lib/auth/auth-context';
import { listOrgUsers, createOrgUser, setUserRoles, setUserActive } from '@/lib/auth/admin.functions';
import { listCompanyMembers, getDefaultAssignee, setDefaultAssignee, countOpenTasksOf } from '@/modules/crm/api';
import { sendAccountInvitation, searchContactsForAccount, type ContactHit } from '@/modules/settings/users-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/users')({
  head: () => ({ meta: [{ title: 'Utilisateurs — Ducati Bruxelles' }] }),
  component: UsersAdmin,
});

const ALL_ROLES: AppRole[] = [
  'admin', 'vendeur', 'magasinier', 'mecanicien', 'chef_atelier', 'comptable', 'marketing',
];

type Company = { id: string; code: string; name: string };

/** Sélecteur de rôles par société (cases à cocher). */
function RolePicker({
  companies, value, onChange,
}: {
  companies: Company[];
  value: Record<string, AppRole[]>;
  onChange: (next: Record<string, AppRole[]>) => void;
}) {
  const toggle = (companyId: string, role: AppRole, checked: boolean) => {
    const cur = new Set(value[companyId] ?? []);
    if (checked) cur.add(role);
    else cur.delete(role);
    onChange({ ...value, [companyId]: [...cur] });
  };

  return (
    <div className="space-y-4">
      {companies.map((c) => (
        <div key={c.id} className="rounded-md border border-border p-3">
          <p className="mb-2 font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
            {c.name}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ALL_ROLES.map((role) => {
              const id = `${c.id}-${role}`;
              const checked = (value[c.id] ?? []).includes(role);
              return (
                <label key={id} htmlFor={id} className="flex items-center gap-2 text-sm">
                  <Checkbox id={id} checked={checked} onCheckedChange={(v) => toggle(c.id, role, v === true)} />
                  {t(`role.${role}`)}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function NotAdmin() {
  return (
    <>
      <PageHeader title={t('users.title')} />
      <div className="flex items-center gap-3 rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
        <ShieldAlert className="size-5 text-warning" />
        {t('settings.notAdmin')}
      </div>
    </>
  );
}

function UsersAdmin() {
  const { isAdmin, companies: myCompanies, roles: myRoles, activeCompanyId } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['org-users'],
    queryFn: () => listOrgUsers(),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<null | { id: string; name: string }>(null);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  if (!isAdmin()) return <NotAdmin />;

  // Sociétés administrées : dérivées de la session (fiable, indépendant de l'appel serveur).
  const adminCompanyIds = new Set(myRoles.filter((r) => r.role === 'admin').map((r) => r.company_id));
  const companies: Company[] = myCompanies.filter((c) => adminCompanyIds.has(c.id));
  const companyName = (id: string) => myCompanies.find((c) => c.id === id)?.name ?? id;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['org-users'] });

  /** La société au nom de laquelle on (ré)invite quelqu'un : une société qu'on administre. */
  const inviteCompanyOf = (u: { roles: { company_id: string }[]; client: { company_id: string } | null }) => {
    const candidates = u.client ? [u.client.company_id] : u.roles.map((r) => r.company_id);
    return candidates.find((c) => c === activeCompanyId && adminCompanyIds.has(c))
      ?? candidates.find((c) => adminCompanyIds.has(c)) ?? null;
  };

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.subtitle')}
        actions={<Button onClick={() => setCreateOpen(true)}><UserPlus /> {t('users.newUser')}</Button>}
      />

      {activeCompanyId && adminCompanyIds.has(activeCompanyId) && <DefaultAssigneeCard companyId={activeCompanyId} />}

      {inviteMsg && <p className="mb-3 rounded-md bg-muted px-3 py-2 text-[13px]">{inviteMsg}</p>}
      {isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
          <p>{t('users.errorLoad')}</p>
          <p className="mt-1 font-mono text-[11px] opacity-80">{(error as Error).message}</p>
        </div>
      )}

      {data && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th>{t('users.colName')}</Th>
                <Th>{t('users.colEmail')}</Th>
                <Th>{t('users.colRoles')}</Th>
                <Th>{t('users.colStatus')}</Th>
                <Th className="text-right">{t('users.colActions')}</Th>
              </tr>
            </thead>
            <tbody>
              {data.users.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('users.empty')}</td></tr>
              )}
              {data.users.map((u) => {
                const invCo = inviteCompanyOf(u);
                return (
                  <tr key={u.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{u.full_name ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{u.email}</td>
                    <td className="px-3 py-2">
                      {u.client ? (
                        <span className="inline-flex items-center gap-1 rounded-[var(--radius-badge)] bg-muted px-1.5 py-0.5 text-[11px]">
                          <UserRound className="size-3" /> {t('users.kindClient')}{u.client.name ? ` · ${u.client.name}` : ''}
                        </span>
                      ) : u.roles.length === 0 ? (
                        <span className="text-muted-foreground">{t('users.none')}</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((r, i) => (
                            <span key={i} className="rounded-[var(--radius-badge)] bg-muted px-1.5 py-0.5 text-[11px]">
                              {companyName(r.company_id).split(' ')[0]} · {t(`role.${r.role}`)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {u.is_active
                        ? <StatusBadge tone="success" label={t('users.active')} />
                        : <StatusBadge tone="neutral" label={t('users.inactive')} />}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {!u.client && (
                          <Button size="sm" variant="ghost" onClick={() => setEditUser({ id: u.id, name: u.full_name ?? u.email ?? '' })}>
                            {t('users.editRoles')}
                          </Button>
                        )}
                        {invCo && (
                          <ResendInvite companyId={invCo} userId={u.id} onDone={setInviteMsg} />
                        )}
                        <ActiveToggle userId={u.id} isActive={u.is_active} onDone={invalidate} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateUserDialog
          companies={companies}
          defaultCompanyId={activeCompanyId && adminCompanyIds.has(activeCompanyId) ? activeCompanyId : companies[0]?.id ?? ''}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { invalidate(); qc.invalidateQueries({ queryKey: ['company-members'] }); }}
        />
      )}

      {editUser && data && (
        <EditRolesDialog
          user={editUser}
          companies={companies}
          current={data.users.find((u) => u.id === editUser.id)?.roles ?? []}
          onClose={() => setEditUser(null)}
          onSaved={() => { setEditUser(null); invalidate(); }}
        />
      )}
    </>
  );
}

/**
 * Qui reçoit par défaut les nouvelles demandes du CRM commercial.
 * La tâche « Recontacter le client » lui est confiée à l'arrivée de chaque demande ;
 * on peut toujours la réattribuer à quelqu'un d'autre depuis la carte.
 */
function DefaultAssigneeCard({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['company-members', companyId], queryFn: () => listCompanyMembers(companyId) });
  const current = useQuery({ queryKey: ['default-assignee', companyId], queryFn: () => getDefaultAssignee(companyId) });
  const [pick, setPick] = useState('');
  const [transfer, setTransfer] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (current.data && !pick) setPick(current.data); }, [current.data]); // eslint-disable-line

  const oldId = current.data ?? '';
  const changing = !!pick && pick !== oldId;
  const oldCount = useQuery({
    queryKey: ['open-tasks-of', companyId, oldId],
    queryFn: () => countOpenTasksOf(companyId, oldId),
    enabled: changing && !!oldId,
  });
  const nameOf = (id: string) => members.data?.find((m) => m.user_id === id)?.name ?? '—';

  const save = useMutation({
    mutationFn: () => setDefaultAssignee(companyId, pick, transfer),
    onSuccess: (n) => {
      setMsg(n > 0 ? t('users.defaultSavedTransferred').replace('{n}', String(n)) : t('users.defaultSaved'));
      qc.invalidateQueries({ queryKey: ['default-assignee', companyId] });
      qc.invalidateQueries({ queryKey: ['lead-open-tasks'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="mb-4 rounded-md border border-border bg-card p-3">
      <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
        <Users className="size-3.5" /> {t('users.defaultTitle')}
      </p>
      <p className="mb-2 text-[12px] text-muted-foreground">{t('users.defaultHelp')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={pick} onValueChange={(v) => { setPick(v); setMsg(null); }}>
          <SelectTrigger className="w-72"><SelectValue placeholder={t('users.defaultPick')} /></SelectTrigger>
          <SelectContent>{members.data?.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button onClick={() => save.mutate()} disabled={!changing || save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} {t('users.save')}
        </Button>
      </div>
      {changing && oldId && (oldCount.data ?? 0) > 0 && (
        <label className="mt-2 flex items-center gap-2 text-[13px]">
          <Checkbox checked={transfer} onCheckedChange={(v) => setTransfer(v === true)} />
          {t('users.defaultTransfer').replace('{n}', String(oldCount.data)).replace('{name}', nameOf(oldId))}
        </label>
      )}
      {msg && <p className="mt-2 text-[12px] text-success">{msg}</p>}
    </div>
  );
}

function ResendInvite({ companyId, userId, onDone }: { companyId: string; userId: string; onDone: (m: string) => void }) {
  const m = useMutation({
    mutationFn: () => sendAccountInvitation(companyId, userId),
    onSuccess: (r) => onDone(r.error ? `${t('users.inviteFailed')} (${r.error})` : t('users.inviteSent').replace('{email}', r.to ?? '')),
  });
  return (
    <Button size="sm" variant="ghost" disabled={m.isPending} onClick={() => m.mutate()} title={t('users.resendInvite')}>
      {m.isPending ? <Loader2 className="animate-spin" /> : <Mail className="size-3.5" />} {t('users.resendInvite')}
    </Button>
  );
}

function ActiveToggle({ userId, isActive, onDone }: { userId: string; isActive: boolean; onDone: () => void }) {
  const m = useMutation({
    mutationFn: () => setUserActive({ data: { user_id: userId, is_active: !isActive } }),
    onSuccess: onDone,
  });
  return (
    <Button size="sm" variant="ghost" disabled={m.isPending} onClick={() => m.mutate()}>
      {m.isPending ? <Loader2 className="animate-spin" /> : isActive ? t('users.deactivate') : t('users.activate')}
    </Button>
  );
}

type Kind = 'staff' | 'client';
type Access = 'invite' | 'password';

function CreateUserDialog({
  companies, defaultCompanyId, onClose, onCreated,
}: { companies: Company[]; defaultCompanyId: string; onClose: () => void; onCreated: () => void }) {
  const [kind, setKind] = useState<Kind>('staff');
  const [access, setAccess] = useState<Access>('invite');
  const [password, setPassword] = useState('');
  // Équipe
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<Record<string, AppRole[]>>({});
  // Client
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [clientMode, setClientMode] = useState<'existing' | 'new'>('existing');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<ContactHit | null>(null);
  const [nc, setNc] = useState({ first_name: '', last_name: '', email: '', phone: '' });
  const hits = useQuery({
    queryKey: ['account-contact-search', companyId, q],
    queryFn: () => searchContactsForAccount(companyId, q),
    enabled: kind === 'client' && clientMode === 'existing' && q.trim().length >= 2 && !picked,
  });

  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const flatRoles = Object.entries(roles).flatMap(([company_id, rs]) => rs.map((role) => ({ company_id, role })));

  const m = useMutation({
    mutationFn: async () => {
      const created = await createOrgUser({
        data: kind === 'staff'
          ? { kind, email, full_name: fullName, roles: flatRoles, ...(access === 'password' ? { password } : {}) }
          : {
              kind, company_id: companyId,
              ...(clientMode === 'existing' ? { contact_id: picked?.id } : { new_contact: nc }),
              ...(access === 'password' ? { password } : {}),
            },
      });
      if (!created.invite) return t('users.createdNoMail').replace('{email}', created.email);
      const inviteCo = kind === 'client' ? companyId : (created.companyId ?? companyId);
      const r = await sendAccountInvitation(inviteCo, created.id);
      return r.error
        ? t('users.createdInviteFailed').replace('{email}', created.email).replace('{err}', r.error)
        : t('users.createdInvited').replace('{email}', created.email);
    },
    onSuccess: (text) => { setDone(text); onCreated(); },
    onError: (e) => setErr(e instanceof Error ? e.message : t('users.errorCreate')),
  });

  const submit = () => {
    setErr(null);
    if (access === 'password' && password.length < 8) { setErr(t('users.passwordTooShort')); return; }
    if (kind === 'staff') {
      if (!fullName.trim() || !email.trim()) { setErr(t('users.nameEmailRequired')); return; }
      if (flatRoles.length === 0) { setErr(t('users.atLeastOneRole')); return; }
    } else if (clientMode === 'existing' && !picked) { setErr(t('users.pickContact')); return; }
    else if (clientMode === 'new' && (!nc.first_name.trim() || !nc.last_name.trim() || !nc.email.trim())) { setErr(t('users.newContactRequired')); return; }
    m.mutate();
  };

  const contactLabel = (c: ContactHit) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '—';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('users.createTitle')}</DialogTitle>
          <DialogDescription>{t('users.createHelp')}</DialogDescription>
        </DialogHeader>

        {done ? (
          <>
            <p className="rounded-md bg-muted px-3 py-2 text-[13px]">{done}</p>
            <DialogFooter><Button onClick={onClose}>{t('users.close')}</Button></DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              {/* 1. Qui est-ce ? */}
              <div className="flex gap-2">
                <Button type="button" variant={kind === 'staff' ? 'default' : 'outline'} onClick={() => setKind('staff')}>
                  <Users className="size-4" /> {t('users.kindStaff')}
                </Button>
                <Button type="button" variant={kind === 'client' ? 'default' : 'outline'} onClick={() => setKind('client')}>
                  <UserRound className="size-4" /> {t('users.kindClient')}
                </Button>
              </div>

              {kind === 'staff' && (
                <>
                  <Field label={t('users.name')}><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
                  <Field label={t('users.email')}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                  <div>
                    <p className="mb-1 font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('users.rolesByCompany')}</p>
                    <p className="mb-2 text-[12px] text-muted-foreground">{t('users.rolesHint')}</p>
                    <RolePicker companies={companies} value={roles} onChange={setRoles} />
                  </div>
                </>
              )}

              {kind === 'client' && (
                <>
                  {companies.length > 1 && (
                    <Field label={t('users.company')}>
                      <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setPicked(null); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                  )}
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant={clientMode === 'existing' ? 'default' : 'outline'} onClick={() => setClientMode('existing')}>
                      {t('users.contactExisting')}
                    </Button>
                    <Button type="button" size="sm" variant={clientMode === 'new' ? 'default' : 'outline'} onClick={() => { setClientMode('new'); setPicked(null); }}>
                      {t('users.contactNew')}
                    </Button>
                  </div>

                  {clientMode === 'existing' && (
                    picked ? (
                      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[13px]">
                        <span><b>{contactLabel(picked)}</b> · {picked.email ?? t('users.noEmailOnFile')}</span>
                        <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>{t('users.change')}</Button>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                          <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('users.searchContact')} />
                        </div>
                        {hits.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                        {hits.data?.length === 0 && <p className="text-[12px] text-muted-foreground">{t('users.noContactFound')}</p>}
                        <div className="max-h-48 overflow-auto">
                          {hits.data?.map((c) => (
                            <button key={c.id} type="button" onClick={() => setPicked(c)}
                              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent">
                              <span className="font-medium">{contactLabel(c)}</span>
                              <span className="text-[12px] text-muted-foreground">{c.email ?? t('users.noEmailOnFile')}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  )}

                  {clientMode === 'new' && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={t('users.firstName')}><Input value={nc.first_name} onChange={(e) => setNc({ ...nc, first_name: e.target.value })} /></Field>
                      <Field label={t('users.lastName')}><Input value={nc.last_name} onChange={(e) => setNc({ ...nc, last_name: e.target.value })} /></Field>
                      <Field label={t('users.email')}><Input type="email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></Field>
                      <Field label={t('users.phone')}><Input value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} /></Field>
                    </div>
                  )}
                </>
              )}

              {/* 2. Comment la personne obtient-elle son mot de passe ? */}
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('users.accessTitle')}</p>
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="radio" className="mt-1" checked={access === 'invite'} onChange={() => setAccess('invite')} />
                  <span>{t('users.accessInvite')}</span>
                </label>
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="radio" className="mt-1" checked={access === 'password'} onChange={() => setAccess('password')} />
                  <span>{t('users.accessPassword')}</span>
                </label>
                {access === 'password' && (
                  <Field label={t('users.password')} hint={t('users.passwordHint')}>
                    <Input type="text" data-case="preserve" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </Field>
                )}
              </div>

              {err && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{err}</p>}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
              <Button onClick={submit} disabled={m.isPending}>
                {m.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                {m.isPending ? t('users.creating') : access === 'invite' ? t('users.createAndInvite') : t('users.create')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditRolesDialog({
  user, companies, current, onClose, onSaved,
}: {
  user: { id: string; name: string };
  companies: Company[];
  current: { company_id: string; role: AppRole }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial: Record<string, AppRole[]> = {};
  for (const r of current) {
    initial[r.company_id] = [...(initial[r.company_id] ?? []), r.role];
  }
  const [roles, setRoles] = useState<Record<string, AppRole[]>>(initial);

  const m = useMutation({
    mutationFn: async () => {
      // Une mise à jour par société administrée
      for (const c of companies) {
        await setUserRoles({ data: { user_id: user.id, company_id: c.id, roles: roles[c.id] ?? [] } });
      }
    },
    onSuccess: onSaved,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('users.editRolesTitle').replace('{name}', user.name)}</DialogTitle>
        </DialogHeader>
        <RolePicker companies={companies} value={roles} onChange={setRoles} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            {m.isPending ? t('users.saving') : t('users.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>
      {children}
    </th>
  );
}
