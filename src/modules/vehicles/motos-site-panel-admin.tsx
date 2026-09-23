/**
 * Mission 03 / M03 — « Motos à vendre », zéro travail manuel (retour de Simon du 23/09).
 *
 * Encadré administrateur de l'écran Produits Shopify :
 *   - « Mettre les motos du site à jour » : crée la fiche moto + l'article des annonces en ligne
 *     qu'aucune moto du parc ne reconnaît (M-40 : VIN vide + marqueur « à compléter », vente
 *     bloquée tant que le VIN n'est pas saisi), puis purifie les propositions restantes ;
 *   - liste des **annonces obsolètes** (motos déjà vendues, annonces en brouillon) avec le bouton
 *     unique « Retirer ces annonces du site » — qui **n'écrit rien sur Shopify** : il enregistre la
 *     demande, le retrait réel attend l'accord explicite de Simon.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bike, EyeOff, Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import {
  creerMotosDepuisLeSite, demanderRetraitAnnonces, listAnnoncesObsoletes,
  purifierPropositions, ParcUnavailableError,
} from './parc-api';

function fill(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);
}

export function MotosDuSitePanel({ companyId }: { companyId: string }) {
  const { isAdmin } = useAuth();
  const admin = isAdmin();
  const qc = useQueryClient();

  const obsoletes = useQuery({
    queryKey: ['motos-annonces-obsoletes', companyId],
    queryFn: () => listAnnoncesObsoletes(companyId),
    retry: false,
  });

  const majMutation = useMutation({
    mutationFn: async () => {
      const created = await creerMotosDepuisLeSite(companyId, true);
      const purified = await purifierPropositions(companyId, true);
      return { created, purified };
    },
    onSuccess: ({ created, purified }) => {
      toast.success(fill(t('motoParc.majDone'), {
        motos: created.motos_creees, rejets: purified.rejetees_doublon + purified.rejetees_annonce_obsolete + purified.rejetees_ambigues,
      }));
      qc.invalidateQueries({ queryKey: ['motos-annonces-obsoletes', companyId] });
      qc.invalidateQueries({ queryKey: ['shopify-products', companyId] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (e) => toast.error(`${t('motoParc.majErr')} : ${(e as Error)?.message ?? e}`),
  });

  const retraitMutation = useMutation({
    mutationFn: () => demanderRetraitAnnonces(companyId),
    onSuccess: (r) => {
      toast.success(fill(t('motoParc.retraitAsked'), { n: r.annonces_a_retirer }));
      qc.invalidateQueries({ queryKey: ['motos-annonces-obsoletes', companyId] });
    },
    onError: (e) => toast.error(`${t('motoParc.retraitErr')} : ${(e as Error)?.message ?? e}`),
  });

  if (obsoletes.error instanceof ParcUnavailableError) return null;

  const rows = obsoletes.data ?? [];
  const aRetirer = rows.filter((r) => r.state === 'a_retirer').length;

  return (
    <div className="mb-4 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-ui text-[15px] font-bold">
          <Bike className="size-4 text-muted-foreground" /> {t('motoParc.sitePanelTitle')}
        </h2>
        {admin && (
          <Button variant="outline" disabled={majMutation.isPending} onClick={() => majMutation.mutate()}>
            {majMutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} {t('motoParc.majBtn')}
          </Button>
        )}
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">{t('motoParc.sitePanelHint')}</p>

      {rows.length > 0 && (
        <div className="mt-3 rounded-md border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-3 py-2">
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <AlertTriangle className="size-4 text-warning" aria-hidden />
              {fill(t('motoParc.obsoleteCount'), { n: rows.length })}
            </span>
            {admin && aRetirer < rows.length && (
              <Button size="sm" variant="outline" disabled={retraitMutation.isPending} onClick={() => retraitMutation.mutate()}>
                {retraitMutation.isPending ? <Loader2 className="animate-spin" /> : <EyeOff />} {t('motoParc.retraitBtn')}
              </Button>
            )}
            {aRetirer > 0 && <StatusBadge tone="warning" label={fill(t('motoParc.obsoleteAsked'), { n: aRetirer })} />}
          </div>
          <ul className="max-h-64 overflow-auto px-3 py-2 text-[13px]">
            {rows.slice(0, 200).map((r) => (
              <li key={r.shopify_variant_id} className="flex flex-wrap items-center gap-2 border-b border-border py-1 last:border-0">
                <span className="font-medium">{r.product_title ?? '—'}</span>
                <span className="tabular-nums text-muted-foreground">
                  {r.price == null ? '—' : `${Number(r.price).toFixed(2).replace('.', ',')} €`}
                </span>
                <StatusBadge tone={r.state === 'a_retirer' ? 'warning' : 'neutral'}
                  label={t(r.state === 'a_retirer' ? 'motoParc.stateARetirer' : 'motoParc.stateObsolete')} />
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
            {t('motoParc.retraitNoWrite')}
          </p>
        </div>
      )}
    </div>
  );
}
