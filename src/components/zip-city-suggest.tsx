/**
 * Mission 04, carte 4 — le code postal propose la localité (comme G8 : 5000 → NAMUR).
 * Composant PARTAGÉ : fiche client (comptoir) et « Mon profil » de l'espace client.
 *
 * Table de référence `be_postal_codes` (migration 20260919264000, lecture pour les
 * utilisateurs connectés). Belgique seulement (pays vide ou BE), 4 chiffres.
 *  - une seule localité : elle est inscrite si la ville est vide, ou si elle avait
 *    été remplie automatiquement pour un code précédent ;
 *  - plusieurs localités (ex. 4000 : Glain, Liège, Rocourt) : liste de boutons, on choisit.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export async function listBePostalCities(code: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('be_postal_codes')
    .select('city')
    .eq('code', code)
    .order('city');
  if (error) throw error;
  return (data ?? []).map((r) => r.city);
}

/** Code postal belge exploitable (4 chiffres, pays vide ou BE). */
export function isBeZip(zip: string, country: string | null | undefined): boolean {
  const c = (country ?? '').trim().toUpperCase();
  return (c === '' || c === 'BE') && /^\d{4}$/.test(zip.trim());
}

export function ZipCitySuggest({ zip, country, city, onPick, className, large }: {
  zip: string;
  country: string | null | undefined;
  city: string;
  onPick: (city: string) => void;
  className?: string;
  /** Cibles tactiles de 44 px (espace client). */
  large?: boolean;
}) {
  const code = zip.trim();
  const enabled = isBeZip(code, country);
  const { data } = useQuery({
    queryKey: ['be-postal-codes', code],
    queryFn: () => listBePostalCities(code),
    enabled,
    staleTime: Infinity,
  });
  const cities = enabled ? data ?? [] : [];
  const autoFilled = useRef<string | null>(null);

  useEffect(() => {
    if (cities.length !== 1) return;
    const only = cities[0];
    const current = city.trim().toUpperCase();
    if (current === only.toUpperCase()) return;
    if (current === '' || current === autoFilled.current) {
      autoFilled.current = only.toUpperCase();
      onPick(only);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cities.join('|')]);

  if (cities.length < 2) return null;
  const current = city.trim().toUpperCase();
  return (
    <div className={cn('space-y-1', className)}>
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <MapPin className="size-3" /> {t('contacts.zipPick')}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {cities.map((c) => {
          const on = c.toUpperCase() === current;
          return (
            <button
              key={c}
              type="button"
              onClick={() => { autoFilled.current = null; onPick(c); }}
              aria-pressed={on}
              className={cn(
                'rounded-md border px-2 text-[12px]',
                large ? 'h-11 px-3 text-[14px]' : 'h-7',
                on ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:bg-accent',
              )}
            >
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}
