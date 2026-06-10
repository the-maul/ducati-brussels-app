import { createFileRoute } from '@tanstack/react-router';
import { Store } from 'lucide-react';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/eshop')({ component: () => <ModulePlaceholder title={t('nav.eshop')} icon={Store} /> });
