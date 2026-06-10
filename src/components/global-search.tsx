/**
 * GlobalSearch — recherche globale de la topbar (charte §5.9).
 * Champ unique + raccourci Ctrl/⌘+K. Reconnaissance auto :
 *   - 17 caractères alphanumériques  → VIN
 *   - format BE0xxxxxxxxx            → n° TVA
 * Les résultats (véhicules/clients/pièces/documents) seront branchés sur la base
 * au fil des modules ; ici la coquille est fonctionnelle (clavier + détection).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Search, LayoutDashboard, Palette, Bike, Building2 } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { t } from '@/lib/i18n';

const VIN_RE = /^[A-Za-z0-9]{17}$/;
const VAT_BE_RE = /^BE\s?0?\d{8,10}$/i;

type Detection = { kind: 'vin' | 'vat'; value: string } | null;

function detect(raw: string): Detection {
  const v = raw.trim().replace(/\s+/g, '');
  if (VIN_RE.test(v)) return { kind: 'vin', value: v.toUpperCase() };
  if (VAT_BE_RE.test(v)) return { kind: 'vat', value: v.toUpperCase() };
  return null;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  // Raccourci Ctrl/⌘+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform),
    [],
  );

  const detection = detect(query);

  const go = (to: string) => {
    setOpen(false);
    navigate({ to });
  };

  return (
    <>
      {/* Déclencheur (charte §5.9 : 320px, placeholder, raccourci) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-80 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-ring/40"
        aria-label={t('action.search')}
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">{t('search.placeholder')}</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-border px-1.5 font-mono text-[11px] text-muted-foreground sm:inline-block">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder={t('search.placeholder')}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{t('search.empty')}</CommandEmpty>

          {detection && (
            <>
              <CommandGroup
                heading={
                  detection.kind === 'vin' ? t('search.detectedVin') : t('search.detectedVat')
                }
              >
                <CommandItem
                  value={`detected-${detection.value}`}
                  onSelect={() => go(detection.kind === 'vin' ? '/vehicles' : '/clients')}
                >
                  {detection.kind === 'vin' ? <Bike /> : <Building2 />}
                  <span className="font-mono">{detection.value}</span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          <CommandGroup heading={t('app.shortName')}>
            <CommandItem value="dashboard" onSelect={() => go('/dashboard')}>
              <LayoutDashboard />
              {t('nav.dashboard')}
            </CommandItem>
            <CommandItem value="demo charte" onSelect={() => go('/demo')}>
              <Palette />
              {t('nav.demo')}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
