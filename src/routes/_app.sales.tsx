import { createFileRoute } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/sales')({ component: () => <ModulePlaceholder title={t('nav.sales')} icon={FileText} /> });
