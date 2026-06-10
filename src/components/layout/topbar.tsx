/**
 * Topbar — barre supérieure 56px (charte §4.1).
 * Toggle sidebar · recherche globale (Ctrl+K) · bascule de société (COM005)
 * · notifications · menu utilisateur.
 * NB : la société active et l'utilisateur sont des placeholders ; ils seront
 * branchés sur l'auth Supabase + le contexte multi-société en M0.
 */
import { useState } from 'react';
import { PanelLeft, Bell, Building2, ChevronDown, CircleUser } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GlobalSearch } from '@/components/global-search';
import { t } from '@/lib/i18n';

const COMPANIES = [
  { id: 'italbike', labelKey: 'company.italbike' },
  { id: 'nlinvest', labelKey: 'company.nlinvest' },
] as const;

function CompanySwitcher() {
  const [active, setActive] = useState<(typeof COMPANIES)[number]['id']>('italbike');
  const current = COMPANIES.find((c) => c.id === active)!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-9 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent">
        <Building2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="hidden max-w-40 truncate sm:inline">{t(current.labelKey)}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('company.switch')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {COMPANIES.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => setActive(c.id)}>
            <Building2 className="size-4" />
            {t(c.labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        aria-label="Menu"
      >
        <PanelLeft className="size-5" />
      </button>

      <div className="flex flex-1 justify-start">
        <GlobalSearch />
      </div>

      <CompanySwitcher />

      <button
        type="button"
        className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        aria-label="Notifications"
      >
        <Bell className="size-5" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent"
          aria-label="Utilisateur"
        >
          <CircleUser className="size-6" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('app.name')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>{t('nav.settings')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
