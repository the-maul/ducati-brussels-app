import { createFileRoute } from '@tanstack/react-router';
import { CreditCard } from 'lucide-react';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/pos')({ component: () => <ModulePlaceholder title={t('nav.pos')} icon={CreditCard} /> });
