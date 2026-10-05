/**
 * M1 — La fiche liée affichée SOUS la ligne d'un contact, en plus clair.
 * Retour de Simon du 05/10 : « dans la fiche contact, si je cherche un contact,
 * il faut voir la fiche liée en dessous en plus clair ».
 *
 * Un seul composant pour la liste des clients et pour les sélecteurs de contact
 * (devis/facture, OR, planning) : la même ligne partout, et un seul endroit à
 * corriger. Cliquer sur la fiche liée ouvre SA fiche, pas celle du dessus.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { User, Building2, CornerDownRight } from 'lucide-react';
import { listLinkedBrief, type LinkedBrief } from './subobjects-api';
import { t } from '@/lib/i18n';

/**
 * Fiches liées de toutes les lignes affichées, en un appel.
 * `ids` doit être la page affichée (25 à 200 lignes), pas les 8 141 fiches.
 */
export function useLinkedBrief(ids: string[]) {
  // Clé triée et jointe : deux rendus de la même page ne refont pas la requête.
  const key = [...ids].sort().join(',');
  const q = useQuery({
    queryKey: ['contacts-linked-brief', key],
    queryFn: () => listLinkedBrief(ids),
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
  return q.data ?? new Map<string, LinkedBrief[]>();
}

function TypeIcon({ type }: { type: string }) {
  const Icon = type === 'particulier' ? User : Building2;
  return <Icon className="size-3 shrink-0" />;
}

/**
 * Les fiches liées d'un contact, une par ligne, atténuées et en retrait.
 *
 * `clickable` : vrai dans la liste des clients (cliquer ouvre la fiche liée).
 * FAUX dans un sélecteur de contact d'un document : là, la fiche liée est un repère
 * pour reconnaître la bonne personne ; quitter l'écran perdrait le document en cours.
 */
export function LinkedLines({
  links, onOpen, clickable = true,
}: { links: LinkedBrief[] | undefined; onOpen?: (id: string) => void; clickable?: boolean }) {
  const navigate = useNavigate();
  if (!links || links.length === 0) return null;
  const open = onOpen ?? ((id: string) => navigate({ to: '/clients/$contactId', params: { contactId: id } }));
  const base = 'flex w-full items-center gap-1.5 pl-4 text-left text-[12px] text-muted-foreground';
  return (
    <>
      {links.map((l) => {
        const inner = (
          <>
            <CornerDownRight className="size-3 shrink-0 opacity-70" />
            <TypeIcon type={l.type} />
            <span className="truncate">{l.name}</span>
            <span className="shrink-0 rounded bg-muted px-1 text-[10px]">{t(`contacts.type_${l.type}`)}</span>
          </>
        );
        if (!clickable) return <span key={l.linkedId} className={base}>{inner}</span>;
        return (
          <button
            key={l.linkedId}
            type="button"
            // stopPropagation : la ligne parente ouvre la fiche du contact ; ici on
            // veut la fiche LIÉE.
            onClick={(e) => { e.stopPropagation(); open(l.linkedId); }}
            title={t('contacts.openLinkedFiche')}
            className={`${base} hover:text-foreground hover:underline`}
          >
            {inner}
          </button>
        );
      })}
    </>
  );
}
