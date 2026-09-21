/**
 * Espace client — « Ajouter ma moto » (mission 04, carte 8).
 * Le client déclare marque, modèle, année, VIN et plaque (facultatifs) et peut joindre
 * la photo de sa carte grise. La moto n'apparaît dans « Mes motos » qu'après validation
 * par l'équipe ; en attendant, elle est listée « En attente de validation ».
 * Mission 06, carte 4 : le VIN en premier ; dès qu'il est complet, la moto est reconnue et
 * marque, modèle et année sont proposés (le client choisit sa version s'il y en a plusieurs).
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, Clock, FileText, Loader2, Plus, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { declareVehicle, listDeclaredVehicles, uploadDeclarationScan } from './api';
import { Card, SectionTitle, dateFr, vehicleName } from './ui';
import { VinIdentifyPanel } from '@/modules/vehicles/vin-identify-panel';

/** Motos déclarées, en attente de validation (ou non retenues). */
export function DeclaredVehiclesCard() {
  const { data } = useQuery({ queryKey: ['portal', 'declared-vehicles'], queryFn: listDeclaredVehicles });
  if (!data || data.length === 0) return null;
  return (
    <Card>
      <SectionTitle>{t('motoClient.portalDeclTitle')}</SectionTitle>
      <ul className="divide-y divide-border">
        {data.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
            <Bike className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{vehicleName(d)}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {[d.model_year, d.plate, dateFr(d.created_at)].filter(Boolean).join(' · ')}
              </p>
            </div>
            {d.status === 'a_valider'
              ? <StatusBadge tone="warning" icon={Clock} label={t('motoClient.portalPending')} />
              : <StatusBadge tone="neutral" icon={XCircle} label={t('motoClient.portalIgnored')} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Formulaire « Ajouter ma moto ». */
export function DeclareVehicleForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [brand, setBrand] = useState('Ducati');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [vin, setVin] = useState('');
  const [plate, setPlate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const send = useMutation({
    mutationFn: async () => {
      const id = await declareVehicle({
        brand: brand.trim(), model: model.trim(),
        modelYear: year.trim() ? Number(year) : null,
        vin: vin.trim() || null, plate: plate.trim() || null,
      });
      if (file) {
        try { await uploadDeclarationScan(id, file); } catch { return 'scan_failed' as const; }
      }
      return 'ok' as const;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['portal', 'declared-vehicles'] });
      if (r === 'scan_failed') toast.warning(t('motoClient.portalCgFailed'));
      else toast.success(t('motoClient.portalSent'));
      onDone();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!brand.trim() || !model.trim()) { setErr(t('motoClient.portalRequired')); return; }
    send.mutate();
  };

  const field = 'text-[13px] font-medium';
  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <SectionTitle>{t('motoClient.portalAddTitle')}</SectionTitle>
        <p className="text-[12px] text-muted-foreground">{t('motoClient.portalAddHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className={field}>{t('motoClient.portalVin')}</Label>
            <Input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} maxLength={25}
              className="font-mono" autoCapitalize="characters" spellCheck={false} />
            <p className="text-[12px] text-muted-foreground">{t('motoClient.portalVinHint')}</p>
            {/* Mission 06 carte 4 : VIN complet → marque, modèle et année proposés (jamais écrasés). */}
            <VinIdentifyPanel variant="portal" vin={vin}
              values={{ brand, model, model_year: year }}
              onApply={(p) => {
                if (p.brand != null) setBrand(p.brand);
                if (p.model != null) setModel(p.model);
                if (p.model_year != null) setYear(p.model_year);
              }} />
          </div>
          <div className="space-y-1.5">
            <Label className={field}>{t('motoClient.portalBrand')}</Label>
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={60} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label className={field}>{t('motoClient.portalModel')}</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} maxLength={100} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label className={field}>{t('motoClient.portalYear')}</Label>
            <Input type="number" inputMode="numeric" min={1920} max={new Date().getFullYear() + 1}
              value={year} onChange={(e) => setYear(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label className={field}>{t('motoClient.portalPlate')}</Label>
            <Input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} maxLength={15} className="font-mono" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className={field}>{t('motoClient.portalCg')}</Label>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                <FileText /> {t('motoClient.portalCgChoose')}
              </Button>
              {file && <span className="truncate text-[12px] text-muted-foreground">{file.name}</span>}
            </div>
          </div>
        </div>
        {err && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{err}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>{t('action.cancel')}</Button>
          <Button type="submit" disabled={send.isPending}>
            {send.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('motoClient.portalSend')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
