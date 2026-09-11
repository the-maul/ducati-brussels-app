/**
 * M1 — Barre d'actions groupées de la liste des contacts.
 *
 * Apparaît dès qu'une fiche est cochée. Toutes les actions sont réversibles ou
 * auditées : archivage, statut, drapeaux, liaison, fusion. Pas de suppression
 * physique ici — elle reste sur la fiche, où le détail des dépendances peut être
 * présenté avant de décider (règle 4).
 *
 * Lier et Fusionner partagent le même geste : on désigne une fiche principale parmi
 * la sélection, les autres lui sont rattachées ou fusionnées dedans.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Flag, Link2, Merge, Tag, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SaveButton } from '@/components/ui/save-button';
import { useConfirm } from '@/components/confirm-provider';
import { t } from '@/lib/i18n';
import { useSaveMutation } from '@/lib/use-save-mutation';

import { contactDisplayName, type Contact, type ContactStatus } from './api';
import {
  bulkLink, bulkMerge, bulkSetActive, bulkSetFlags, bulkSetStatus,
  type ContactFlags,
} from './bulk-api';
import { LINK_LIMIT } from './subobjects-api';

const STATUSES: ContactStatus[] = ['prospect', 'client', 'client_piece', 'client_atelier'];
const FLAGS: { key: keyof ContactFlags; label: () => string }[] = [
  { key: 'is_vip', label: () => t('contacts.flagVip') },
  { key: 'is_watch', label: () => t('contacts.flagWatch') },
  { key: 'is_blocked', label: () => t('contacts.blocked') },
  { key: 'marketing_opt_out', label: () => t('contacts.marketingOptOut') },
];

const n = (key: string, count: number) => t(key).replace('{n}', String(count));

export function BulkActionsBar({ companyId, selected, onClear }: {
  companyId: string;
  selected: Contact[];
  onClear: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [mainDialog, setMainDialog] = useState<'link' | 'merge' | null>(null);
  const [mainId, setMainId] = useState<string | null>(null);

  const ids = selected.map((c) => c.id);
  const count = ids.length;
  // Une sélection peut mêler fiches actives et archivées : les deux actions restent
  // proposées, chacune n'agissant que sur ce qui la concerne.
  const activeIds = selected.filter((c) => c.is_active).map((c) => c.id);
  const archivedIds = selected.filter((c) => !c.is_active).map((c) => c.id);

  /** Rafraîchit la liste et vide la sélection : les lignes ont changé sous les pieds. */
  const done = () => {
    qc.invalidateQueries({ queryKey: ['contacts'] });
    onClear();
  };

  const archive = useSaveMutation({
    mutationFn: () => bulkSetActive(activeIds, false),
    success: n('contacts.bulkArchiveDone', activeIds.length),
    onSuccess: done,
  });
  const unarchive = useSaveMutation({
    mutationFn: () => bulkSetActive(archivedIds, true),
    success: n('contacts.bulkUnarchiveDone', archivedIds.length),
    onSuccess: done,
  });
  const setStatus = useSaveMutation({
    mutationFn: (s: ContactStatus) => bulkSetStatus(ids, s),
    success: n('contacts.bulkStatusDone', count),
    onSuccess: done,
  });
  const setFlags = useSaveMutation({
    mutationFn: (f: ContactFlags) => bulkSetFlags(ids, f),
    success: n('contacts.bulkFlagsDone', count),
    onSuccess: done,
  });

  // Lier et fusionner rendent un bilan partiel : on compose le message nous-mêmes
  // plutôt que de laisser le toast générique annoncer une réussite en bloc.
  const link = useSaveMutation({
    mutationFn: () => bulkLink(companyId, mainId!, ids.filter((id) => id !== mainId)),
    success: false,
    onSuccess: (r) => {
      const parts: string[] = [];
      if (r.linked.length) parts.push(n('contacts.bulkLinkDone', r.linked.length));
      if (r.already.length) parts.push(n('contacts.bulkLinkAlready', r.already.length));
      if (r.full.length) {
        parts.push(n('contacts.bulkLinkFull', r.full.length).replace('{max}', String(LINK_LIMIT)));
      }
      if (r.mainFull) parts.push(t('contacts.bulkLinkMainFull').replace('{max}', String(LINK_LIMIT)));
      const msg = parts.join(' · ') || t('contacts.bulkLinkNothing');
      if (r.linked.length) toast.success(msg); else toast.warning(msg);
      setMainDialog(null);
      done();
    },
  });

  const merge = useSaveMutation({
    mutationFn: () => bulkMerge(mainId!, ids.filter((id) => id !== mainId)),
    success: false,
    onSuccess: (r) => {
      const parts = [n('contacts.bulkMergeDone', r.merged.length)];
      if (r.failed.length) parts.push(n('contacts.bulkMergeFailed', r.failed.length));
      if (r.tableIssues.length) {
        parts.push(t('contacts.bulkMergeTableIssues').replace('{tables}', r.tableIssues.join(', ')));
      }
      const msg = parts.join(' · ');
      if (r.failed.length || r.tableIssues.length) toast.warning(msg); else toast.success(msg);
      setMainDialog(null);
      done();
    },
  });

  async function askArchive() {
    const ok = await confirm({
      title: t('contacts.bulkArchive'),
      message: n('contacts.bulkArchiveConfirm', activeIds.length),
    });
    if (ok) archive.mutate();
  }
  async function askUnarchive() {
    const ok = await confirm({
      title: t('contacts.bulkUnarchive'),
      message: n('contacts.bulkUnarchiveConfirm', archivedIds.length),
    });
    if (ok) unarchive.mutate();
  }

  function openMain(kind: 'link' | 'merge') {
    if (count < 2) { toast.warning(t('contacts.bulkNeedTwo')); return; }
    setMainId(selected[0]?.id ?? null);
    setMainDialog(kind);
  }

  const busy = link.status === 'saving' || merge.status === 'saving';

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
        <span className="text-[13px] font-medium tabular-nums">{n('contacts.bulkSelected', count)}</span>
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="size-4" /> {t('contacts.bulkClear')}
        </Button>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden />

        {activeIds.length > 0 && (
          <Button variant="outline" size="sm" onClick={askArchive} disabled={archive.status === 'saving'}>
            <Archive className="size-4" /> {t('contacts.bulkArchive')}
          </Button>
        )}
        {archivedIds.length > 0 && (
          <Button variant="outline" size="sm" onClick={askUnarchive} disabled={unarchive.status === 'saving'}>
            <ArchiveRestore className="size-4" /> {t('contacts.bulkUnarchive')}
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={setStatus.status === 'saving'}>
              <Tag className="size-4" /> {t('contacts.bulkStatus')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{t('contacts.status')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {STATUSES.map((s) => (
              <DropdownMenuItem key={s} onSelect={() => setStatus.mutate(s)}>
                {t(`contacts.status_${s}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={setFlags.status === 'saving'}>
              <Flag className="size-4" /> {t('contacts.bulkFlags')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {FLAGS.map(({ key, label }) => (
              <div key={key}>
                <DropdownMenuLabel className="text-[11px] uppercase tracking-widest text-muted-foreground">
                  {label()}
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setFlags.mutate({ [key]: true } as ContactFlags)}>
                  {t('contacts.bulkFlagOn')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setFlags.mutate({ [key]: false } as ContactFlags)}>
                  {t('contacts.bulkFlagOff')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" onClick={() => openMain('link')} disabled={busy}>
          <Link2 className="size-4" /> {t('contacts.bulkLink')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => openMain('merge')} disabled={busy}>
          <Merge className="size-4" /> {t('contacts.bulkMerge')}
        </Button>
      </div>

      <Dialog open={mainDialog !== null} onOpenChange={(o) => !o && setMainDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('contacts.bulkMainTitle')}</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            {mainDialog === 'merge' ? t('contacts.bulkMainHintMerge') : t('contacts.bulkMainHintLink')}
          </p>
          <RadioGroup
            value={mainId ?? undefined}
            onValueChange={setMainId}
            className="max-h-72 overflow-y-auto"
          >
            {selected.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-[13px] hover:bg-accent"
              >
                <RadioGroupItem value={c.id} />
                <span className="font-mono text-muted-foreground">{c.code ?? '—'}</span>
                <span className="font-medium">{contactDisplayName(c)}</span>
                {c.city && <span className="text-muted-foreground">· {c.city}</span>}
              </label>
            ))}
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMainDialog(null)}>{t('action.cancel')}</Button>
            <SaveButton
              status={mainDialog === 'merge' ? merge.status : link.status}
              disabled={!mainId}
              onClick={() => {
                if (!mainId) { toast.warning(t('contacts.bulkMainRequired')); return; }
                if (mainDialog === 'merge') merge.mutate(); else link.mutate();
              }}
            >
              {mainDialog === 'merge' ? t('contacts.bulkMerge') : t('contacts.bulkLink')}
            </SaveButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
