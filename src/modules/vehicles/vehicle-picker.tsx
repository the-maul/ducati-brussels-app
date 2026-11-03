/**
 * Selecteur de moto apres choix du client — un seul composant pour l'OR, le RDV et les documents
 * de vente (ATE001, 03/11/2026). A l'ouverture : les motos dont le client est le proprietaire
 * courant ; des 2 caracteres : recherche VIN / plaque / modele dans tout le parc. Un client sans
 * moto le voit en clair avec un bouton pour lui en ajouter une (fiche client → Parc → Ajouter une
 * moto). Une erreur de chargement passe par un toast : le formulaire garde son client.
 * Logique pure dans `vehicle-pick.ts`.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Bike, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { listContactCurrentVehicles, searchVehiclesForSale, vehiclePickLabel, type Vehicle } from './api';
import { buildVehicleChoices, vehiclePickEmptyState } from './vehicle-pick';
import { t } from '@/lib/i18n';

export function VehiclePicker({ companyId, contactId, onPick, placeholder }: {
  companyId: string;
  /** Client deja choisi : ses motos passent en tete. `null` : recherche dans le parc seulement. */
  contactId: string | null;
  /** Ne recoit que la moto : le client de l'ecran appelant n'est jamais touche. */
  onPick: (v: Vehicle) => void;
  placeholder?: string;
}) {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);

  const ownQ = useQuery({
    queryKey: ['contact-vehicles', contactId],
    queryFn: () => listContactCurrentVehicles(contactId as string),
    enabled: !!contactId, staleTime: 60_000,
  });
  const searchQ = useQuery({
    queryKey: ['vehicle-pick', companyId, deb],
    queryFn: () => searchVehiclesForSale(companyId, deb),
    enabled: deb.length >= 2, staleTime: 60_000,
  });
  // Une erreur de chargement se dit (toast) et ne vide rien : le client reste choisi.
  useEffect(() => { if (ownQ.error) toast.error(t('vehiclePick.loadError')); }, [ownQ.error]);
  useEffect(() => { if (searchQ.error) toast.error(t('vehiclePick.loadError')); }, [searchQ.error]);

  const choices = buildVehicleChoices<Vehicle>({ own: ownQ.data ?? [], found: searchQ.data ?? [], term: deb });
  const empty = vehiclePickEmptyState({
    contactId, ownLoaded: !contactId || ownQ.isFetched, searchLoaded: searchQ.isFetched, choices,
  });
  const loading = (!!contactId && ownQ.isLoading) || (choices.searching && searchQ.isLoading);

  const pick = (v: Vehicle) => { onPick(v); setTerm(''); setOpen(false); };
  const addForClient = () => {
    if (!contactId) return;
    navigate({ to: '/vehicles/new', search: { contact: contactId, declaration: undefined } });
  };
  const row = (v: Vehicle) => (
    <button key={v.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(v)}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
      <Bike className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{vehiclePickLabel(v)}</span>
    </button>
  );
  const section = (label: string) => (
    <p className="px-3 pt-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
  );

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? t('vehiclePick.placeholder')} className="h-9 pl-9" />
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {choices.own.length > 0 && section(t('vehiclePick.ofClient'))}
          {choices.own.map(row)}
          {choices.park.length > 0 && section(t('vehiclePick.park'))}
          {choices.park.map(row)}
          {loading && <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('vehiclePick.loading')}</p>}
          {!loading && empty === 'noClient' && <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('vehiclePick.noClient')}</p>}
          {!loading && empty === 'noneFound' && <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('vehiclePick.noneFound')}</p>}
          {!loading && empty === 'noneForClient' && (
            <div className="space-y-2 px-3 py-2">
              <p className="text-[12px] text-muted-foreground">{t('vehiclePick.noneForClient')}</p>
              <Button type="button" size="sm" variant="outline" onMouseDown={(e) => e.preventDefault()} onClick={addForClient}>
                <Plus /> {t('vehiclePick.addForClient')}
              </Button>
            </div>
          )}
          {!loading && empty === 'none' && !choices.searching && choices.own.length > 0 && (
            <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('vehiclePick.searchHint')}</p>
          )}
        </div>
      )}
    </div>
  );
}
