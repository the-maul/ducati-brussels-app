import { createFileRoute } from '@tanstack/react-router';
import { Wrench } from 'lucide-react';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop')({ component: () => <ModulePlaceholder title={t('nav.workshop')} icon={Wrench} /> });
