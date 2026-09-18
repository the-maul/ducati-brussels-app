/**
 * Mission 04, carte 3 — « Mobiles à compléter » (Clients → Mobiles à compléter).
 *
 * Fiches reprises de G8 dont le mobile est vide mais dont le « téléphone » est un GSM
 * belge (04xx / +324xx) : G8 obligeait à recopier téléphone → portable pour les SMS.
 * Pas de correction en masse : l'employé vérifie la ligne et clique « Utiliser comme
 * mobile » (fonction SQL contact_use_phone_as_mobile, tracée dans events).
 */
import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { errorMessage } from '@/lib/mutation-feedback';
import { t } from '@/lib/i18n';
import { contactDisplayName } from './api';

// Fonctions SQL récentes : appel non typé localisé, lié au client (tests/rpc-bound.test.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcUntyped = supabase.rpc.bind(supabase) as any;

export type PhoneGsmCandidate = {
  id: string;
  code: string | null;
  type: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  city: string | null;
  phone: string;
  proposed_mobile: string;
  total: number;
};

export async function listPhoneGsmCandidates(companyId: string, limit: number, offset: number): Promise<PhoneGsmCandidate[]> {
  const { data, error } = await rpcUntyped('contacts_phone_gsm_candidates', { _company: companyId, _limit: limit, _offset: offset });
  if (error) throw error;
  return (data as PhoneGsmCandidate[]) ?? [];
}

export async function applyPhoneAsMobile(contactId: string): Promise<string> {
  const { data, error } = await rpcUntyped('contact_use_phone_as_mobile', { _id: contactId });
  if (error) throw error;
  return data as string;
}

/** Message lisible d'un refus de contact_use_phone_as_mobile. */
function phoneToMobileError(e: unknown): string {
  const raw = errorMessage(e);
  if (raw.includes('PHONE_TO_MOBILE_ALREADY_SET')) return t('contacts.mobileFix.errAlreadySet');
  if (raw.includes('PHONE_TO_MOBILE_NOT_GSM')) return t('contacts.mobileFix.errNotGsm');
  return raw;
}

const PAGE_SIZE = 50;

export function MobileFixList({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [done, setDone] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<string | null>(null);
  const key = ['contacts-phone-gsm', companyId, page];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => listPhoneGsmCandidates(companyId, PAGE_SIZE, page * PAGE_SIZE),
  });

  const apply = useMutation({
    mutationFn: (id: string) => applyPhoneAsMobile(id),
    meta: { success: t('contacts.mobileFix.done'), error: false },
    onSuccess: (mobile, id) => {
      setDone((d) => ({ ...d, [id]: mobile }));
      qc.invalidateQueries({ queryKey: ['contacts'] });
      // La ligne reste affichée (coche) ; les autres pages seront relues à l'ouverture.
      qc.invalidateQueries({ queryKey: ['contacts-phone-gsm', companyId], refetchType: 'none' });
    },
    onError: (e) => setRowError(phoneToMobileError(e)),
  });

  const rows = data ?? [];
  const total = rows[0]?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const refresh = () => {
    setDone({});
    qc.invalidateQueries({ queryKey: ['contacts-phone-gsm', companyId] });
  };

  return (
    <div className="space-y-3">
      <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('contacts.mobileFix.intro')}</p>
      {rowError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{rowError}</p>}
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorMessage(error)}</p>}

      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="tabular-nums text-muted-foreground">
          {t('contacts.mobileFix.total').replace('{n}', String(total))}
        </span>
        {Object.keys(done).length > 0 && (
          <Button variant="outline" size="sm" onClick={refresh}>{t('contacts.mobileFix.refresh')}</Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('contacts.colCode')}</Th>
              <Th>{t('contacts.colName')}</Th>
              <Th>{t('contacts.colCity')}</Th>
              <Th>{t('contacts.mobileFix.colPhone')}</Th>
              <Th>{t('contacts.mobileFix.colProposed')}</Th>
              <Th>{''}</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                <Loader2 className="mx-auto size-5 animate-spin" />
              </td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('contacts.mobileFix.empty')}</td></tr>
            )}
            {rows.map((r) => {
              const saved = done[r.id];
              return (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-muted-foreground">{r.code ?? '—'}</td>
                  <td className="px-3 py-2 font-medium">
                    <Link to="/clients/$contactId" params={{ contactId: r.id }} className="hover:underline">
                      {contactDisplayName(r)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.city ?? '—'}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{r.phone}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{saved ?? r.proposed_mobile}</td>
                  <td className="px-3 py-2 text-right">
                    {saved ? (
                      <span className="inline-flex items-center gap-1 rounded-[var(--radius-badge)] bg-success-bg px-2 py-0.5 text-[12px] font-bold text-success">
                        <Smartphone className="size-3.5" /> {t('contacts.mobileFix.saved')}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={apply.isPending}
                        onClick={() => { setRowError(null); apply.mutate(r.id); }}
                      >
                        {apply.isPending && apply.variables === r.id ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
                        {t('contacts.mobileFix.use')}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-3 text-[13px]">
        <span className="tabular-nums text-muted-foreground">{t('contacts.page')} {page + 1} / {pageCount}</span>
        <Button variant="outline" size="sm" disabled={page <= 0 || isLoading} onClick={() => { setDone({}); setPage((p) => Math.max(0, p - 1)); }}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pageCount - 1 || isLoading} onClick={() => { setDone({}); setPage((p) => p + 1); }}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
      {children}
    </th>
  );
}
