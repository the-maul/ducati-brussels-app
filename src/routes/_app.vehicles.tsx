import { createFileRoute } from '@tanstack/react-router';
import { Bike } from 'lucide-react';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/vehicles')({ component: () => <ModulePlaceholder title={t('nav.vehicles')} icon={Bike} /> });
