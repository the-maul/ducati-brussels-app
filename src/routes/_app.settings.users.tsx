import { createFileRoute } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Loader2, ShieldAlert, Check } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useAuth, type AppRole } from '@/lib/auth/auth-context';
import { listOrgUsers, createOrgUser, setUserRoles, setUserActive } from '@/lib/auth/admin.functions';
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
  companies,
  value,
  onChange,
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
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={(v) => toggle(c.id, role, v === true)}
                  />
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
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['org-users'],
    queryFn: () => listOrgUsers(),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<null | { id: string; name: string }>(null);

  if (!isAdmin()) return <NotAdmin />;

  const companies: Company[] = (data?.companies ?? []).filter((c) =>
    (data?.adminCompanies ?? []).includes(c.id),
  );
  const companyName = (id: string) =>
    data?.companies.find((c) => c.id === id)?.name ?? id;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['org-users'] });

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.subtitle')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus /> {t('users.newUser')}
          </Button>
        }
      />

      {isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
          <p>{t('users.errorLoad')}</p>
          <p className="mt-1 font-mono text-[11px] opacity-80">{(error as Error).message}</p>
        </div>
      )}

      {data && (
        <div className="overflow-hidden rounded-md border border-border">
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
              {data.users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{u.full_name ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{u.email}</td>
                  <td className="px-3 py-2">
                    {u.roles.length === 0 ? (
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
                    {u.is_active ? (
                      <StatusBadge tone="success" label={t('users.active')} />
                    ) : (
                      <StatusBadge tone="neutral" label={t('users.inactive')} />
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditUser({ id: u.id, name: u.full_name ?? u.email ?? '' })}>
                        {t('users.editRoles')}
                      </Button>
                      <ActiveToggle userId={u.id} isActive={u.is_active} onDone={invalidate} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateUserDialog
          companies={companies}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); invalidate(); }}
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

function CreateUserDialog({
  companies, onClose, onCreated,
}: { companies: Company[]; onClose: () => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<Record<string, AppRole[]>>({});
  const [err, setErr] = useState<string | null>(null);

  const flatRoles = Object.entries(roles).flatMap(([company_id, rs]) => rs.map((role) => ({ company_id, role })));

  const m = useMutation({
    mutationFn: () => createOrgUser({ data: { email, password, full_name: fullName, roles: flatRoles } }),
    onSuccess: onCreated,
    onError: () => setErr(t('users.errorCreate')),
  });

  const submit = () => {
    setErr(null);
    if (flatRoles.length === 0) { setErr(t('users.atLeastOneRole')); return; }
    m.mutate();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('users.createTitle')}</DialogTitle>
          <DialogDescription>{t('users.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t('users.name')}>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label={t('users.email')}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('users.password')} hint={t('users.passwordHint')}>
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div>
            <p className="mb-2 font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              {t('users.rolesByCompany')}
            </p>
            <RolePicker companies={companies} value={roles} onChange={setRoles} />
          </div>
          {err && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={submit} disabled={m.isPending}>
            {m.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            {m.isPending ? t('users.creating') : t('users.create')}
          </Button>
        </DialogFooter>
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
