/**
 * M1 / M8 — Onglet « Entretiens de ses motos » de la fiche client
 * (mission 07, carte 4). Une ligne par moto du client avec son entretien dû.
 */
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import { listDueForContact } from './maintenance-due-api';
import { ContactMaintenanceDuePanel } from './maintenance-due-panel';

export function ContactMaintenanceTab({ contactId }: { contactId: string }) {
  const q = useQuery({
    queryKey: ['due', 'contact', contactId],
    queryFn: () => listDueForContact(contactId),
  });
  if (q.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (q.error) return <p className="text-sm text-danger">{t('maintenanceDue.loadErr')}</p>;
  return <ContactMaintenanceDuePanel rows={q.data ?? []} />;
}
