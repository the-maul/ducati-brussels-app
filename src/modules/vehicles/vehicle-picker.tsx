/**
 * Selecteur de moto apres choix du client — un seul composant pour l'OR, le RDV et les documents
 * de vente (ATE001, 03/11/2026). A l'ouverture : les motos dont le client est le proprietaire
 * courant ; des 2 caracteres : recherche VIN / plaque / modele dans tout le parc. Un client sans
 * moto le voit en clair avec un bouton pour lui en ajouter une (fiche client → Parc → Ajouter une
 * moto). Une erreur de chargement passe par un toast : le formulaire garde son client.
 * Logique pure dans `vehicle-pick.ts`.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Bike, Link2, Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-provider';
import { errorMessage } from '@/lib/mutation-feedback';
import { attachVehicleOwner, listContactCurrentVehicles, searchVehiclesForPick, vehicleLabel, vehiclePickLabel, type Vehicle, type VehiclePickResult } from './api';
import { vinAttachMessage } from './vin-suggestions';
import { buildVehicleChoices, vehiclePickEmptyState } from './vehicle-pick';
import { fillVars, t } from '@/lib/i18n';

export function VehiclePicker({ companyId, contactId, attachTo = null, onPick, placeholder }: {
  companyId: string;
  /** Client deja choisi : ses motos passent en tete. `null` : recherche dans le parc seulement. */
  contactId: string | null;
  /** Atelier : une moto du stock ou d'un autre client peut être attribuée à ce client. */
  attachTo?: { id: string; name: string } | null;
  /** Ne recoit que la moto : le client de l'ecran appelant n'est jamais touche. */
  onPick: (v: Vehicle) => void;
  placeholder?: string;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [attaching, setAttaching] = useState<string | null>(null);
  const location = useLocation();
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
    queryFn: () => searchVehiclesForPick(companyId, deb),
    enabled: deb.length >= 2, staleTime: 60_000,
  });
  // Une erreur de chargement se dit (toast) et ne vide rien : le client reste choisi.
  useEffect(() => { if (ownQ.error) toast.error(t('vehiclePick.loadError')); }, [ownQ.error]);
  useEffect(() => { if (searchQ.error) toast.error(t('vehiclePick.loadError')); }, [searchQ.error]);

  const choices = buildVehicleChoices<VehiclePickResult>({ own: ownQ.data ?? [], found: searchQ.data ?? [], term: deb });
  const empty = vehiclePickEmptyState({
    contactId, ownLoaded: !contactId || ownQ.isFetched, searchLoaded: searchQ.isFetched, choices,
  });
  const loading = (!!contactId && ownQ.isLoading) || (choices.searching && searchQ.isLoading);

  const pick = (v: Vehicle) => { onPick(v); setTerm(''); setOpen(false); };
  const attach = async (v: VehiclePickResult) => {
    if (!attachTo) return;
    setOpen(false);
    const ok = await confirm({
      title: fillVars(t('motoClient.vinAttachTitle'), { client: attachTo.name }),
      message: vinAttachMessage(v), confirmLabel: t('motoClient.vinAttach'), cancelLabel: t('action.cancel'),
    });
    if (!ok) return;
    setAttaching(v.id);
    try {
      await attachVehicleOwner(v.id, attachTo.id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['contact-vehicles'] }),
        qc.invalidateQueries({ queryKey: ['vehicle-pick', companyId] }),
      ]);
      toast.success(fillVars(t('dossier.pickAttached'), { client: attachTo.name }));
      pick(v);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAttaching(null);
    }
  };
  const addForClient = () => {
    if (!contactId) return;
    // `retour` (UX011) : une fois la moto creee, on revient sur cet ecran (OR, document)
    // avec la nouvelle moto choisie et la saisie restauree (brouillon du formulaire).
    navigate({ to: '/vehicles/new', search: { contact: contactId, declaration: undefined, retour: location.href } });
  };
  const row = (v: Vehicle) => (
    <button key={v.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(v)}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
      <Bike className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{vehiclePickLabel(v)}</span>
    </button>
  );
  // Moto du parc : la prendre telle quelle, ou l'attribuer à ce client.
  const parkRow = (v: VehiclePickResult) => (!attachTo ? row(v) : (
    <div key={v.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent">
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(v)} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2 text-sm"><Bike className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{[vehicleLabel(v), v.model_year, v.plate].filter(Boolean).join(' · ')}</span></span>
        <span className="flex min-w-0 gap-2 pl-5 text-[11px] text-muted-foreground">
          <span className="shrink-0 font-data">{v.vin}</span>
          <span className="truncate">{v.owner_id ? `${t('motoClient.currentOwner')}${v.owner_name ?? t('motoClient.noOwner')}` : t(`vehicles.status_${v.status}`)}</span>
        </span>
      </button>
      <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={!!attaching}
        onMouseDown={(e) => e.preventDefault()} onClick={() => { void attach(v); }}>
        {attaching === v.id ? <Loader2 className="animate-spin" /> : <Link2 />} {t('motoClient.vinAttach')}
      </Button>
    </div>
  ));
  const section = (label: string) => (
    <p className="px-3 pt-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
  );

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? t('vehiclePick.placeholder')} className="h-9 pl-9" />
      {open && (
        <div className={`absolute z-20 mt-1 max-h-80 overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)] ${attachTo ? 'left-1/2 w-[min(38rem,calc(100vw-3rem))] -translate-x-1/2' : 'w-full'}`}>
          {choices.own.length > 0 && section(t('vehiclePick.ofClient'))}
          {choices.own.map(row)}
          {choices.park.length > 0 && section(t('vehiclePick.park'))}
          {attachTo && choices.park.length > 0 && <p className="px-3 pb-1 text-[11px] text-muted-foreground">{t('dossier.pickUseHint')}</p>}
          {choices.park.map(parkRow)}
          {loading && <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('vehiclePick.loading')}</p>}
          {!loading && empty === 'noClient' && <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('vehiclePick.noClient')}</p>}
          {!loading && empty === 'noneFound' && <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('vehiclePick.noneFound')}</p>}
          {!loading && empty === 'noneForClient' && (
            <div className="space-y-2 px-3 py-2">
              <p className="text-[12px] text-muted-foreground">{t('vehiclePick.noneForClient')}</p>
              {attachTo && <p className="text-[12px] text-muted-foreground">{t('dossier.pickSearchPark')}</p>}
              {attachTo && <p className="font-data text-[11px] text-muted-foreground">{t('motoClient.vinHelp')}</p>}
            </div>
          )}
          {!loading && empty === 'none' && !choices.searching && choices.own.length > 0 && (
            <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('vehiclePick.searchHint')}</p>
          )}
          {!!contactId && !loading && (!!attachTo || empty === 'noneForClient') && (
            <div className="border-t border-border px-3 py-2">
              <Button type="button" size="sm" variant="outline" onMouseDown={(e) => e.preventDefault()} onClick={addForClient}>
                <Plus /> {t('vehiclePick.addForClient')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
