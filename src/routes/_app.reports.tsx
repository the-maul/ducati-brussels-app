import { createFileRoute } from '@tanstack/react-router';
import { BarChart3 } from 'lucide-react';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/reports')({ component: () => <ModulePlaceholder title={t('nav.reports')} icon={BarChart3} /> });
