/**
 * Catalogue Ducati — « Créer l'article » pour une pièce qui n'existe pas encore dans le DMS.
 * Ouvre l'écran de création d'article habituel (/parts/new), pré-rempli avec la référence et la
 * désignation Ducati et le type de gestion choisi (A stockée, M non stockée). Rien n'est écrit
 * tant que l'utilisateur n'a pas cliqué « Créer » sur la fiche.
 */
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { t } from '@/lib/i18n';

export function CreateArticleButton({ reference, designation, size = 'sm' }: { reference: string; designation: string | null; size?: 'sm' | 'default' }) {
  const navigate = useNavigate();
  const go = (mgmt: 'A' | 'M') => navigate({
    to: '/parts/new',
    search: { reference, designation: designation ?? '', mgmt, from: 'catalog' },
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} title={t('catalog.createArticleHint')} onClick={(e) => e.stopPropagation()}>
          <Plus /> {t('catalog.createArticle')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => go('A')}>{t('catalog.createTypeA')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => go('M')}>{t('catalog.createTypeM')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
