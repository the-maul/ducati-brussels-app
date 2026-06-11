/**
 * GlobalSearch — recherche globale de la topbar (charte §5.9, M0).
 * Champ unique + raccourci Ctrl/⌘+K. Reconnaissance auto VIN (17 car.) / n° TVA.
 * Branchée sur la base : interroge clients, véhicules et articles (RLS par société),
 * résultats groupés et cliquables. Recherche croisée véhicule↔client↔documents (B9).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, LayoutDashboard, Palette, Bike, Users, Package, Loader2 } from 'lucide-react';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import { useAuth } from '@/lib/auth/auth-context';
import { listContacts, contactDisplayName } from '@/modules/contacts/api';
import { listVehicles, vehicleLabel } from '@/modules/vehicles/api';
import { listArticles } from '@/modules/articles/api';
import { t } from '@/lib/i18n';

const VIN_RE = /^[A-Za-z0-9]{17}$/;
const VAT_BE_RE = /^BE\s?0?\d{8,10}$/i;

function detect(raw: string): { kind: 'vin' | 'vat'; value: string } | null {
  const v = raw.trim().replace(/\s+/g, '');
  if (VIN_RE.test(v)) return { kind: 'vin', value: v.toUpperCase() };
  if (VAT_BE_RE.test(v)) return { kind: 'vat', value: v.toUpperCase() };
  return null;
}

async function runSearch(companyId: string, q: string) {
  const [contacts, vehicles, articles] = await Promise.all([
    listContacts(companyId, q).then((r) => r.slice(0, 6)).catch(() => []),
    listVehicles(companyId, q).then((r) => r.slice(0, 6)).catch(() => []),
    listArticles(companyId, q).then((r) => r.slice(0, 6)).catch(() => []),
  ]);
  return { contacts, vehicles, articles };
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const navigate = useNavigate();
  const { activeCompanyId } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform),
    [],
  );

  const enabled = open && !!activeCompanyId && debounced.length >= 2;
  const { data, isFetching } = useQuery({
    queryKey: ['global-search', activeCompanyId, debounced],
    queryFn: () => runSearch(activeCompanyId!, debounced),
    enabled,
  });

  const detection = detect(query);
  const go = (to: string, params?: Record<string, string>) => {
    setOpen(false);
    setQuery('');
    navigate({ to, params } as never);
  };

  return (
    <>
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

      <CommandDialog open={open} onOpenChange={setOpen} commandProps={{ shouldFilter: false }}>
        <CommandInput placeholder={t('search.placeholder')} value={query} onValueChange={setQuery} />
        <CommandList>
          {isFetching && (
            <div className="flex items-center justify-center py-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
          )}
          {!isFetching && enabled && <CommandEmpty>{t('search.empty')}</CommandEmpty>}

          {detection && (
            <CommandGroup heading={detection.kind === 'vin' ? t('search.detectedVin') : t('search.detectedVat')}>
              <CommandItem value={`det-${detection.value}`} onSelect={() => go('/vehicles')}>
                <Bike /><span className="font-mono">{detection.value}</span>
              </CommandItem>
            </CommandGroup>
          )}

          {data && data.vehicles.length > 0 && (
            <CommandGroup heading={t('search.groupVehicles')}>
              {data.vehicles.map((v) => (
                <CommandItem key={v.id} value={`veh-${v.id}`} onSelect={() => go('/vehicles/$vehicleId', { vehicleId: v.id })}>
                  <Bike />
                  <span>{vehicleLabel(v)}</span>
                  {v.vin && <span className="ml-auto font-mono text-[11px] text-muted-foreground">{v.vin}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {data && data.contacts.length > 0 && (
            <CommandGroup heading={t('search.groupClients')}>
              {data.contacts.map((c) => (
                <CommandItem key={c.id} value={`con-${c.id}`} onSelect={() => go('/clients/$contactId', { contactId: c.id })}>
                  <Users />
                  <span>{contactDisplayName(c)}</span>
                  {c.city && <span className="ml-auto text-[11px] text-muted-foreground">{c.city}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {data && data.articles.length > 0 && (
            <CommandGroup heading={t('search.groupParts')}>
              {data.articles.map((a) => (
                <CommandItem key={a.id} value={`art-${a.id}`} onSelect={() => go('/parts/$articleId', { articleId: a.id })}>
                  <Package />
                  <span className="font-mono text-[12px]">{a.reference}</span>
                  <span className="truncate">{a.designation}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandSeparator />
          <CommandGroup heading={t('app.shortName')}>
            <CommandItem value="nav-dashboard" onSelect={() => go('/dashboard')}><LayoutDashboard />{t('nav.dashboard')}</CommandItem>
            <CommandItem value="nav-demo" onSelect={() => go('/demo')}><Palette />{t('nav.demo')}</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
