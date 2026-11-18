/**
 * M1 / M6 — Bandeaux des cases de la fiche client a la vente (rattrapage G8 du 18/11/2026) :
 * client bloque (vente refusee), client a surveiller (alerte + motif), detaxe, mode HT, encours
 * autorise depasse (alerte ou blocage), tarif commun du client. Partage par l'editeur de vente et la
 * caisse. Tout statut = couleur + icone + libelle (charte).
 */
import { useQuery } from '@tanstack/react-query';
import { Ban, Eye, Globe2, Receipt, AlertTriangle, Tag } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { t, fillVars } from '@/lib/i18n';
import type { CustomerPricer } from './customer-pricing-api';
import { isBlockedSale, creditRefuses, type CreditCheck, type SaleClientFlags } from './customer-pricing';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

export function ClientSaleBanners({ contact, credit, docType, pricer, compact }: {
  contact: SaleClientFlags; credit: CreditCheck; docType: string; pricer: CustomerPricer; compact?: boolean;
}) {
  const { data: list } = useQuery({
    queryKey: ['client-price-list', pricer.companyId, pricer.contact?.id ?? null, pricer.contact?.price_list_id ?? null, pricer.contact?.price_list ?? null],
    queryFn: () => pricer.priceList(),
    enabled: !!pricer.contact,
  });
  const box = 'flex gap-2 rounded-md px-3 py-2 text-[13px]';
  return (
    <div className={compact ? 'space-y-2' : 'space-y-2'}>
      {contact.is_blocked && (
        <div className={`${box} border border-danger bg-danger-bg text-danger`} role="alert">
          <Ban className="mt-0.5 size-4 shrink-0" />
          <div><b>{t('clientRules.blockedTitle')}</b> — {isBlockedSale(contact, docType) ? t('clientRules.blockedBody') : t('clientRules.blockedQuoteOk')}</div>
        </div>
      )}
      {contact.is_watch && (
        <div className={`${box} bg-warning-bg text-warning`}>
          <Eye className="mt-0.5 size-4 shrink-0" />
          <div><b>{t('clientRules.watchTitle')}</b> — <span className="text-foreground">{contact.watch_note?.trim() || t('clientRules.watchNoNote')}</span></div>
        </div>
      )}
      {credit.exceeded && (
        <div className={`${box} ${creditRefuses(credit, docType) ? 'border border-danger bg-danger-bg text-danger' : 'bg-warning-bg text-warning'}`}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <b>{t('clientRules.creditTitle')}</b> — {fillVars(t('clientRules.creditBody'), { balance: eur(credit.balance), doc: eur(credit.documentDue), total: eur(credit.total), limit: eur(credit.limit) })}
            {credit.blocking && <span className="block">{t('clientRules.creditBlocking')}</span>}
          </div>
        </div>
      )}
      {(contact.is_detaxe || contact.mode_ht || list) && (
        <div className="flex flex-wrap items-center gap-2">
          {contact.is_detaxe && <StatusBadge tone="info" icon={Globe2} label={t('clientRules.detaxeBadge')} />}
          {!contact.is_detaxe && contact.mode_ht && <StatusBadge tone="info" icon={Receipt} label={t('clientRules.modeHtBadge')} />}
          {list && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Tag className="size-3.5" /> {t('clientRules.priceList')} : <b className="text-foreground">{list.code}</b>{list.label ? ` — ${list.label}` : ''}
              {list.is_promo && <StatusBadge tone="info" icon={Tag} label={t('clientRules.promo')} />}
            </span>
          )}
          {contact.is_detaxe && <span className="text-[12px] text-muted-foreground">{t('clientRules.detaxeBanner')}</span>}
        </div>
      )}
    </div>
  );
}
