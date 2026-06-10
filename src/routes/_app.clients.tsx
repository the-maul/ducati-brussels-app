import { createFileRoute } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/clients')({ component: () => <ModulePlaceholder title={t('nav.clients')} icon={Users} /> });
