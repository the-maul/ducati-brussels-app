/**
 * M6 -- Ecran client sur un document de vente (PDV020). Bouton « Ecran client » avec son etat ;
 * l affichage se fait d UN CLIC (le vendeur consulte aussi des documents d autres clients : rien ne
 * part tout seul sur la tablette depuis un document, decision M-105). Le QR de virement (bloc
 * « Paiement par QR ») continue de s afficher seul a l ecran comme avant.
 */
import { useState } from 'react';
import { contactDisplayName, type Contact } from '@/modules/contacts/api';
import { contactLocale } from '@/lib/i18n/client-locale';
import { t } from '@/lib/i18n';
import { CustomerScreenButton, useCustomerScreenPush, type ScreenAction } from './customer-screen-control';
import { documentForScreen } from './customer-screen';
import { isMargeDocument, type DocumentFull } from './write-api';

export function DocumentCustomerScreen({ full, contact, clientDue, onSendTicket }: {
  full: DocumentFull; contact: Contact | null; clientDue: number; onSendTicket?: (email: string) => void;
}) {
  const { doc, lines } = full;
  const push = useCustomerScreenPush(doc.company_id);
  const [allowEmail, setAllowEmail] = useState(true);
  const validated = doc.status !== 'brouillon';
  const locale = contact ? contactLocale(contact) : null;

  const onAction = (a: ScreenAction) => {
    const payload = documentForScreen(
      doc,
      lines.map((l) => ({
        designation: l.designation, quantity: Number(l.quantity), unit_price_ht: Number(l.unit_price_ht),
        vat_rate: Number(l.vat_rate), discount_pct: Number(l.discount_pct ?? 0), line_type: l.line_type,
      })),
      {
        noVat: isMargeDocument(doc) || !!(doc as { tax_exempt?: boolean }).tax_exempt,
        customerName: contact ? contactDisplayName(contact) : null, locale, due: validated ? clientDue : null,
      },
    );
    if (a === 'accueil') push('accueil', {}, { force: true, immediate: true });
    else if (a === 'ticket') push('ticket', { ...payload, stage: validated && clientDue > 0.005 ? 'a_payer' : 'saisie', methods: ['card', 'cash', 'qr_sepa'] }, { force: true, immediate: true });
    else if (a === 'terminal') push('terminal', payload, { force: true, immediate: true });
    else push('merci', { document_number: doc.number, locale, amount: Number(doc.total_ttc), allow_email: allowEmail && validated }, { force: true, immediate: true });
  };

  return (
    <CustomerScreenButton
      companyId={doc.company_id} onAction={onAction} hint={t('customerScreen.documentHint')}
      signatureFor={validated ? { documentId: doc.id, number: doc.number } : null}
      allowEmail={allowEmail} onAllowEmail={setAllowEmail} onSendTicket={onSendTicket}
    />
  );
}
