/**
 * M1 — Boutons G8 de la barre de la fiche client (18/11/2026) :
 *   « RGPD » : Édition de la fiche (PDF) · Portabilité (JSON + Excel) ;
 *   « Mail / SMS (essai) » : prépare un e-mail ou un SMS au client, en mode essai (rien n'est envoyé).
 */
import { useState } from 'react';
import { FileText, Download, ShieldCheck, Loader2, Mail, MessageSquare, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { t } from '@/lib/i18n';
import type { Contact } from '../api';
import { downloadGdprSheetPdf, downloadPortability } from './rgpd-export';
import { CampaignDialog } from './campaign-dialog';
import { g8ErrorMessage } from './client-g8-tabs';

export function RgpdMenu({ contactId }: { contactId: string }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); } catch (e) { toast.error(g8ErrorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t('g8c.rgpd.menu')}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void run(() => downloadGdprSheetPdf(contactId), t('g8c.rgpd.sheetDone'))}>
          <FileText className="size-4" /> {t('g8c.rgpd.sheet')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run(() => downloadPortability(contactId), t('g8c.rgpd.portabilityDone'))}>
          <Download className="size-4" /> {t('g8c.rgpd.portability')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MessageTestMenu({ contact, companyId }: { contact: Contact; companyId: string }) {
  const [channel, setChannel] = useState<'email' | 'sms' | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline"><FlaskConical /> {t('g8c.campaign.menu')}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setChannel('email')}><Mail className="size-4" /> {t('g8c.campaign.oneEmail')}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setChannel('sms')}><MessageSquare className="size-4" /> {t('g8c.campaign.oneSms')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {channel && (
        <CampaignDialog open={!!channel} onOpenChange={(o) => { if (!o) setChannel(null); }} companyId={companyId} channel={channel}
          targets={[contact]} criteria={{ contact_id: contact.id }} />
      )}
    </>
  );
}
