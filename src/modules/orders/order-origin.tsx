/**
 * Écran d'une commande de pièces : d'où elle vient (mission 02, carte 3). Client, véhicule et
 * document de vente d'origine (`part_orders.source_document_id`), cliquables — le lien inverse
 * du bloc « Commandes de pièces liées » de la fiche du document.
 */
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { FileText, User, Bike } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import { getContact, contactDisplayName } from '@/modules/contacts/api';
import { getVehicle, vehicleLabel } from '@/modules/vehicles/api';

async function getSourceDocument(id: string) {
  const { data, error } = await supabase.from('documents').select('id, doc_type, number, status').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export function OrderOrigin({ contactId, vehicleId, sourceDocumentId }: {
  contactId: string | null; vehicleId: string | null; sourceDocumentId: string | null;
}) {
  const contactQ = useQuery({ queryKey: ['doc-contact', contactId], queryFn: () => getContact(contactId!), enabled: !!contactId });
  const vehicleQ = useQuery({ queryKey: ['doc-vehicle', vehicleId], queryFn: () => getVehicle(vehicleId!), enabled: !!vehicleId });
  const docQ = useQuery({ queryKey: ['order-source-doc', sourceDocumentId], queryFn: () => getSourceDocument(sourceDocumentId!), enabled: !!sourceDocumentId });
  if (!contactId && !vehicleId && !sourceDocumentId) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-border bg-card px-4 py-3 text-[13px]">
      {sourceDocumentId && (
        <span className="flex items-center gap-1.5">
          <FileText className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t('orderFromDoc.originDoc')}</span>
          <Link to="/sales/$documentId" params={{ documentId: sourceDocumentId }} className="font-medium text-info underline">
            {docQ.data ? `${t(`sales.type_${docQ.data.doc_type}`)} ${docQ.data.number ?? t('sales.draftSuffix')}` : '…'}
          </Link>
        </span>
      )}
      {contactId && (
        <span className="flex items-center gap-1.5">
          <User className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t('orderFromDoc.originClient')}</span>
          <Link to="/clients/$contactId" params={{ contactId }} className="font-medium text-info underline">
            {contactQ.data ? contactDisplayName(contactQ.data) : '…'}
          </Link>
        </span>
      )}
      {vehicleId && (
        <span className="flex items-center gap-1.5">
          <Bike className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t('orderFromDoc.originVehicle')}</span>
          <Link to="/vehicles/$vehicleId" params={{ vehicleId }} className="font-medium text-info underline">
            {vehicleQ.data ? `${vehicleLabel(vehicleQ.data)}${vehicleQ.data.vin ? ` · ${vehicleQ.data.vin}` : ''}` : '…'}
          </Link>
        </span>
      )}
    </div>
  );
}
