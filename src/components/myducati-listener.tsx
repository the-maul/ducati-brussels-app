/**
 * Écoute les données envoyées par l'extension « Import My Ducati » (via postMessage) et les
 * enregistre (par VIN) sous la session de l'utilisateur. Monté une fois dans le shell authentifié.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth/auth-context';
import { applyMyDucatiData, saveBulletinPdf, type MyDucatiPayload, type BulletinPdfPayload } from '@/lib/myducati';

export function MyDucatiListener() {
  const { activeCompanyId } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    const handler = async (ev: MessageEvent) => {
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
      console.info('[MyDucati] données reçues de l’extension :', d.payload);
      try {
        const r = await applyMyDucatiData(activeCompanyId, d.payload);
        if (!r.matched) { toast.error(`Moto introuvable dans le DMS (VIN ${d.payload.vin}).`); return; }
        toast.success(`Infos My Ducati importées${r.bulletins ? ` · ${r.bulletins} bulletin(s)` : ''}.`);
        qc.invalidateQueries();
      } catch {
        toast.error('Import My Ducati échoué.');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [activeCompanyId, qc]);
  return null;
}
