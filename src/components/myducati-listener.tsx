/**
 * Écoute les données envoyées par l'extension « Import My Ducati » (via postMessage) et les
 * enregistre (par VIN) sous la session de l'utilisateur. Monté une fois dans le shell authentifié.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { applyMyDucatiData, saveBulletinPdf, setDcsActiveCompany, takeDcsRequest, type MyDucatiPayload, type BulletinPdfPayload } from '@/lib/myducati';
import { checkDcsPayload, dcsCompanyCheck, type DcsRefusal } from '@/lib/dcs-rules';

const REFUSAL_KEY: Record<DcsRefusal, Parameters<typeof t>[0]> = {
  old_extension: 'dossier.dcsRefusedOldExtension',
  no_vin: 'dossier.dcsRefusedNoVin',
  vin_mismatch: 'dossier.dcsRefusedVin',
  bad_read: 'dossier.dcsRefusedRead',
  not_loaded: 'dossier.dcsRefusedNotLoaded',
  company_mismatch: 'dossier.dcsRefusedCompany',
  duplicate_vin: 'dossier.dcsRefusedDuplicate',
};

export function MyDucatiListener() {
  const { activeCompanyId, activeCompany } = useAuth();
  const qc = useQueryClient();
  useEffect(() => { setDcsActiveCompany(activeCompanyId); }, [activeCompanyId]);
  useEffect(() => {
    const runImport = async (companyId: string, payload: MyDucatiPayload) => {
      try {
        const r = await applyMyDucatiData(companyId, payload);
        if (r.refused) { toast.error(t(REFUSAL_KEY[r.refused])); return; }
        if (!r.matched) { toast.error(t('dossier.dcsNotFound').replace('{vin}', String(payload.read_vin ?? payload.vin ?? ''))); return; }
        const n = r.counts ?? { confirmed: 0, replaced: 0, filled: 0, conflicts: 0 };
        const summary = t('dossier.dcsSummary')
          .replace('{confirmed}', String(n.confirmed)).replace('{replaced}', String(n.replaced))
          .replace('{filled}', String(n.filled)).replace('{conflicts}', String(n.conflicts))
          .replace('{events}', String(r.events ?? 0)).replace('{bulletins}', String(r.bulletins ?? 0));
        if (n.conflicts > 0 || (r.invalid?.length ?? 0) > 0) toast.warning(summary);
        else toast.success(summary);
        if (r.ownerMismatch) toast.warning(t('dossier.dcsOwnerMismatch'));
        qc.invalidateQueries();
      } catch (e) {
        const message = (e as { message?: string } | null)?.message ?? '';
        toast.error(t(message.includes('dcs_stale') ? 'dossier.dcsStale' : 'dossier.dcsFailed'));
      }
    };

    const handler = async (ev: MessageEvent) => {
      // Un cadre d'un autre site ne peut pas injecter de données dans le DMS.
      if (ev.origin !== window.location.origin) return;
      const d = ev.data as { source?: string; action?: string; payload?: MyDucatiPayload & BulletinPdfPayload } | null;
      if (!d || d.source !== 'dms-ducati-ext' || !d.payload) return;
      if (!activeCompanyId) { toast.error('Société non sélectionnée — impossible d’importer.'); return; }

      // PDF d'un bulletin (depuis bulletins.ducati.com) → rangé par numéro sur les motos.
      if (d.action === 'bulletin-pdf') {
        try {
          const r = await saveBulletinPdf(activeCompanyId, d.payload);
          if (r.updated) { toast.success(`Bulletin ${d.payload.number ?? ''} enregistré sur ${r.updated} moto(s).`); qc.invalidateQueries(); }
          else toast.info(`Aucune moto ne référence le bulletin ${d.payload.number ?? ''}.`);
        } catch { toast.error('Enregistrement du bulletin échoué.'); }
        return;
      }

      if (d.action !== 'myducati-data') return;
      const payload = d.payload;
      const refusal = checkDcsPayload(payload);
      const vin = String(payload.requested_vin ?? payload.read_vin ?? payload.vin ?? '');
      const requestedCompany = takeDcsRequest(vin);
      if (refusal) { toast.error(t(REFUSAL_KEY[refusal])); return; }
      const company = dcsCompanyCheck(requestedCompany, activeCompanyId);
      if (company === 'mismatch') { toast.error(t(REFUSAL_KEY.company_mismatch)); return; }
      if (company === 'confirm') {
        // Import lancé depuis le portail : c'est l'utilisateur qui confirme la société.
        toast(t('dossier.dcsConfirmCompany').replace('{vin}', vin).replace('{company}', activeCompany?.name ?? ''), {
          duration: 30000,
          action: { label: t('dossier.dcsConfirmAction'), onClick: () => { void runImport(activeCompanyId, payload); } },
        });
        return;
      }
      await runImport(activeCompanyId, payload);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [activeCompanyId, activeCompany, qc]);
  return null;
}
