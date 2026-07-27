/**
 * M1 — Panneau « comptes liés » d'une fiche : lier une fiche existante (pro ↔ privé),
 * en créer une pré-remplie, ouvrir la fiche liée, délier. Vue M:N non destructive.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Plus, Link2, Unlink, Search, ExternalLink, User, Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { listLinkedContacts, linkContact, unlinkContact, createLinkedContact, searchContactsToLink } from './subobjects-api';
import { contactDisplayName, type Contact } from './api';
import { t } from '@/lib/i18n';

const LINK_LIMIT = 2;

export function ContactLinksPanel({ companyId, contact }: { companyId: string; contact: Contact }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = ['contact-links', contact.id];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => listLinkedContacts(contact.id) });
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['client-parc', contact.id] }); };
  const [q, setQ] = useState('');
  const searchQ = useQuery({ queryKey: ['link-search', companyId, q], queryFn: () => searchContactsToLink(companyId, q, contact.id), enabled: q.trim().length >= 2 });
  const isPro = contact.type === 'professionnel' || contact.type === 'fournisseur' || contact.type === 'banque_leasing';
  const targetType: 'particulier' | 'professionnel' = isPro ? 'particulier' : 'professionnel';
  const limitReached = (data ?? []).length >= LINK_LIMIT;

  const [inheritDialogOpen, setInheritDialogOpen] = useState(false);
  const [inheritContact, setInheritContact] = useState(true);
  const [inheritAddress, setInheritAddress] = useState(true);

  const link = useMutation({ mutationFn: (otherId: string) => linkContact(companyId, contact.id, otherId), onSuccess: () => { setQ(''); refresh(); } });
  const unlink = useMutation({ mutationFn: (linkId: string) => unlinkContact(linkId), onSuccess: refresh });
  const create = useMutation({
    mutationFn: (opts: { inheritContact: boolean; inheritAddress: boolean }) => createLinkedContact(companyId, contact, targetType, opts),
    onSuccess: (id) => { setInheritDialogOpen(false); refresh(); navigate({ to: '/clients/$contactId', params: { contactId: id } }); },
  });

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <p className="text-[13px] text-muted-foreground">{t('contacts.linksHint')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => setInheritDialogOpen(true)} disabled={create.isPending || limitReached}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {targetType === 'particulier' ? t('contacts.createLinkedPrivate') : t('contacts.createLinkedPro')}
        </Button>
        {limitReached && <span className="text-[12px] text-danger">{t('contacts.linkLimitReached')}</span>}
      </div>

      <Dialog open={inheritDialogOpen} onOpenChange={setInheritDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{targetType === 'particulier' ? t('contacts.createLinkedPrivate') : t('contacts.createLinkedPro')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <Checkbox checked={inheritContact} onCheckedChange={(v) => setInheritContact(v === true)} />
              {t('contacts.inheritContact')}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <Checkbox checked={inheritAddress} onCheckedChange={(v) => setInheritAddress(v === true)} />
              {t('contacts.inheritAddress')}
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInheritDialogOpen(false)}>{t('action.cancel')}</Button>
            <Button type="button" onClick={() => create.mutate({ inheritContact, inheritAddress })} disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} {t('action.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lier une fiche existante */}
      <div className="space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('contacts.linkSearchPlaceholder')} className="pl-8" disabled={limitReached} />
        </div>
        {!limitReached && q.trim().length >= 2 && (
          <div className="max-h-48 overflow-auto rounded-md border border-border">
            {searchQ.isLoading && <Loader2 className="mx-auto my-2 size-4 animate-spin text-muted-foreground" />}
            {searchQ.data && searchQ.data.length === 0 && <p className="p-2 text-[12px] text-muted-foreground">{t('contacts.linkNoResult')}</p>}
            {searchQ.data?.map((c) => (
              <button key={c.id} type="button" onClick={() => link.mutate(c.id)} className="flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-left text-[13px] last:border-0 hover:bg-accent">
                <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{contactDisplayName(c)}</span>
                <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{t(`contacts.type_${c.type}`)}</span>
                {c.code && <span className="font-mono text-[11px] text-muted-foreground">{c.code}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Fiches déjà liées */}
      {isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : (
        (data ?? []).length === 0 ? <p className="text-[13px] text-muted-foreground">{t('contacts.noLinks')}</p> : (
          <div className="space-y-1.5">
            {data!.map(({ linkId, contact: c }) => {
              const Icon = c.type === 'particulier' ? User : Building2;
              return (
                <div key={linkId} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate font-medium">{contactDisplayName(c)}</span>
                  <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{t(`contacts.type_${c.type}`)}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => navigate({ to: '/clients/$contactId', params: { contactId: c.id } })} title={t('contacts.openFiche')}><ExternalLink className="size-4 text-info" /></Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => unlink.mutate(linkId)} disabled={unlink.isPending} title={t('contacts.unlink')}><Unlink className="size-4 text-danger" /></Button>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
