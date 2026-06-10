import { createFileRoute } from '@tanstack/react-router';
import { Settings } from 'lucide-react';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings')({ component: () => <ModulePlaceholder title={t('nav.settings')} icon={Settings} /> });
