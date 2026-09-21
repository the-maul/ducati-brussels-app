/**
 * Aperçu d'un e-mail tel que le client le recevra (message + signature + pied de mail),
 * à partir du HTML renvoyé par `graph-send-email` en mode simulation (`dryRun`).
 * Composant PARTAGÉ : envoi CRM, document de vente, fournisseur.
 *
 * Le HTML est affiché dans un cadre isolé (`sandbox` sans droits : aucun script, aucun
 * formulaire, liens inactifs). Les couleurs du mail viennent de son gabarit
 * (supabase/functions/_shared/mail-message.ts), pas de l'application.
 */
import { t } from '@/lib/i18n';

export function MailPreview({ html }: { html: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('mailSignature.preview')}</p>
      <iframe
        title={t('mailSignature.preview')}
        sandbox=""
        srcDoc={`<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:12px">${html}</body></html>`}
        className="h-72 w-full rounded-md border border-border bg-card"
      />
      <p className="text-[11px] text-muted-foreground">{t('mailSignature.previewHint')}</p>
    </div>
  );
}
