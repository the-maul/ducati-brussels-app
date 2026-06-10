import { createFileRoute } from '@tanstack/react-router';
import { Package } from 'lucide-react';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/parts')({ component: () => <ModulePlaceholder title={t('nav.parts')} icon={Package} /> });
